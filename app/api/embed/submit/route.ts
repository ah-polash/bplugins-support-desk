import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getActiveSpamRules, checkIsSpam } from '@/lib/spam'
import { safeDecrypt } from '@/lib/crypto'

const RATE_LIMIT_WINDOW = 60 * 1000 // 1 minute
const RATE_LIMIT_MAX = 5
const rateLimitMap = new Map<string, { count: number; resetAt: number }>()

function checkRateLimit(ip: string): boolean {
  const now = Date.now()
  const entry = rateLimitMap.get(ip)
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW })
    return true
  }
  if (entry.count >= RATE_LIMIT_MAX) return false
  entry.count++
  return true
}

export async function GET() {
  try {
    const settings = await prisma.appSettings.findUnique({
      where: { id: 'singleton' },
      select: { embedFormEnabled: true, embedFormProducts: true, recaptchaEnabled: true, recaptchaSiteKey: true },
    })
    if (!settings?.embedFormEnabled) {
      return NextResponse.json({ error: 'Form is disabled' }, { status: 403 })
    }
    return NextResponse.json({
      products: settings.embedFormProducts,
      recaptchaEnabled: settings.recaptchaEnabled && !!settings.recaptchaSiteKey,
      recaptchaSiteKey: settings.recaptchaEnabled ? settings.recaptchaSiteKey : null,
    })
  } catch {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    // Rate limit by IP
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
    if (!checkRateLimit(ip)) {
      return NextResponse.json({ error: 'Too many requests. Please wait a moment.' }, { status: 429 })
    }

    const settings = await prisma.appSettings.findUnique({
      where: { id: 'singleton' },
      select: { embedFormEnabled: true, embedFormProducts: true, defaultAssigneeId: true, recaptchaEnabled: true, recaptchaSecretKey: true },
    })
    if (!settings?.embedFormEnabled) {
      return NextResponse.json({ error: 'Form is disabled' }, { status: 403 })
    }

    const body = await req.json()
    const { name, email, product, hasPaidLicense, subject: rawSubject, message, recaptchaToken } = body

    // Verify reCAPTCHA if enabled
    if (settings.recaptchaEnabled && settings.recaptchaSecretKey) {
      if (!recaptchaToken) {
        return NextResponse.json({ error: 'Please complete the reCAPTCHA verification' }, { status: 400 })
      }
      try {
        const verifyRes = await fetch('https://www.google.com/recaptcha/api/siteverify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `secret=${encodeURIComponent(safeDecrypt(settings.recaptchaSecretKey))}&response=${encodeURIComponent(recaptchaToken)}`,
        })
        const verifyData = await verifyRes.json()
        if (!verifyData.success) {
          return NextResponse.json({ error: 'reCAPTCHA verification failed. Please try again.' }, { status: 400 })
        }
      } catch {
        return NextResponse.json({ error: 'reCAPTCHA verification error' }, { status: 500 })
      }
    }

    // Validate
    if (!name || typeof name !== 'string' || name.trim().length < 1) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 })
    }
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return NextResponse.json({ error: 'Valid email is required' }, { status: 400 })
    }
    if (!product || typeof product !== 'string') {
      return NextResponse.json({ error: 'Product is required' }, { status: 400 })
    }
    if (typeof hasPaidLicense !== 'boolean') {
      return NextResponse.json({ error: 'License status is required' }, { status: 400 })
    }
    if (!rawSubject || typeof rawSubject !== 'string' || rawSubject.trim().length < 1) {
      return NextResponse.json({ error: 'Subject is required' }, { status: 400 })
    }
    if (!message || typeof message !== 'string' || message.trim().length < 10) {
      return NextResponse.json({ error: 'Message must be at least 10 characters' }, { status: 400 })
    }

    const trimmedName = name.trim().slice(0, 200)
    const trimmedEmail = email.trim().toLowerCase().slice(0, 320)
    const trimmedProduct = product.trim().slice(0, 200)
    const trimmedSubject = rawSubject.trim().slice(0, 500)
    const trimmedMessage = message.trim().slice(0, 10000)

    // Build subject
    const subject = `[${trimmedProduct}] ${trimmedSubject}`

    // Spam check
    const spamRules = await getActiveSpamRules()
    const spamCheck = checkIsSpam(spamRules, subject, trimmedEmail, trimmedName, trimmedMessage)
    const status = spamCheck.isSpam ? 'SPAM' : 'OPEN'

    // Find an email account to associate
    const emailAccount = await prisma.emailAccount.findFirst({ where: { isActive: true }, orderBy: { createdAt: 'asc' } })
    if (!emailAccount) {
      return NextResponse.json({ error: 'No active email account configured' }, { status: 500 })
    }

    // Upsert contact
    let contactId: string | null = null
    try {
      const contact = await prisma.contact.upsert({
        where: { email: trimmedEmail },
        update: { name: trimmedName },
        create: { email: trimmedEmail, name: trimmedName },
      })
      contactId = contact.id
    } catch { /* ignore */ }

    // Build message body
    const licenseLabel = hasPaidLicense ? 'Yes' : 'No'
    const bodyText = `Product: ${trimmedProduct}\nPaid License: ${licenseLabel}\n\n${trimmedMessage}`
    const htmlBody = `<p><strong>Product:</strong> ${trimmedProduct}<br><strong>Paid License:</strong> ${licenseLabel}</p><hr><p>${trimmedMessage.replace(/\n/g, '<br>')}</p>`

    // Create tags
    const tags = [trimmedProduct.toLowerCase().replace(/\s+/g, '-')]
    if (hasPaidLicense) tags.push('paid-license')

    // Create ticket
    const ticket = await prisma.ticket.create({
      data: {
        subject,
        status,
        priority: 'MEDIUM',
        fromEmail: trimmedEmail,
        fromName: trimmedName,
        emailAccountId: emailAccount.id,
        importSource: 'embed-form',
        contactId,
        tags,
      },
    })

    // Create message
    await prisma.message.create({
      data: {
        ticketId: ticket.id,
        body: bodyText,
        htmlBody,
        fromEmail: trimmedEmail,
        fromName: trimmedName,
        isIncoming: true,
      },
    })

    // Assign default assignee
    if (settings.defaultAssigneeId) {
      await prisma.ticketAssignee.create({
        data: { ticketId: ticket.id, userId: settings.defaultAssigneeId },
      }).catch(() => { /* ignore */ })
    }

    await prisma.activity.create({
      data: {
        ticketId: ticket.id,
        action: 'ticket_created',
        metadata: { source: 'embed-form', product: trimmedProduct, hasPaidLicense },
      },
    })

    return NextResponse.json({
      success: true,
      ticketNumber: ticket.ticketNumber,
      message: 'Your support ticket has been created successfully.',
    })
  } catch (err) {
    console.error('Embed form submit error:', err)
    return NextResponse.json({ error: 'Failed to create ticket' }, { status: 500 })
  }
}
