import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { maskApiKey } from '@/lib/ai'
import { encrypt, safeDecrypt } from '@/lib/crypto'

const DEFAULT_SATISFACTION_BODY = `<p>Hi there,</p><p>We wanted to let you know that your support ticket has been <strong>resolved</strong> by our team. We hope we were able to address your concern quickly and effectively.</p><p>Your feedback means a lot to us — it helps us understand what we're doing well and where we can do even better. Could you take just a moment to rate your experience?</p><p>Thank you for choosing bPlugins Support. We're always here if you need us.</p>`

const DEFAULTS = {
  id: 'singleton',
  defaultAssigneeId: null,
  defaultAssignee: null,
  autoReplyBody: null,
  satisfactionSurveyBody: DEFAULT_SATISFACTION_BODY,
  trustpilotUrl: null,
  aiEnabled: false,
  aiProvider: 'gemini',
  aiApiKey: null,
  aiModel: 'gemini-2.0-flash',
  aiSystemPrompt: null,
  autoCloseEnabled: false,
  autoCloseDays: 7,
  autoCloseEmailBody: null,
  embedFormEnabled: false,
  embedFormProducts: [],
  recaptchaEnabled: false,
  recaptchaSiteKey: null,
  recaptchaSecretKey: null,
  assignmentEmailEnabled: false,
  assignmentEmailSubject: null,
  assignmentEmailBody: null,
}

export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (session.user.role !== 'SUPER_ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const settings = await prisma.appSettings.findUnique({
      where: { id: 'singleton' },
      include: { defaultAssignee: { select: { id: true, name: true, email: true } } },
    })

    const data = settings ?? DEFAULTS
    // Decrypt before masking for display
    const decryptedAiKey = data.aiApiKey ? safeDecrypt(data.aiApiKey) : null
    const decryptedRecaptchaKey = data.recaptchaSecretKey ? safeDecrypt(data.recaptchaSecretKey) : null
    return NextResponse.json({
      ...data,
      aiApiKey: decryptedAiKey ? maskApiKey(decryptedAiKey) : null,
      aiApiKeySet: !!data.aiApiKey,
      recaptchaSecretKey: decryptedRecaptchaKey ? maskApiKey(decryptedRecaptchaKey) : null,
      recaptchaSecretKeySet: !!data.recaptchaSecretKey,
    })
  } catch (err) {
    console.error('AppSettings GET error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (session.user.role !== 'SUPER_ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const body = await req.json()
    const {
      defaultAssigneeId,
      autoReplyBody,
      satisfactionSurveyBody,
      trustpilotUrl,
      aiEnabled,
      aiProvider,
      aiApiKey,
      aiModel,
      aiSystemPrompt,
      autoCloseEnabled,
      autoCloseDays,
      autoCloseEmailBody,
      embedFormEnabled,
      embedFormProducts,
      recaptchaEnabled,
      recaptchaSiteKey,
      recaptchaSecretKey,
      assignmentEmailEnabled,
      assignmentEmailSubject,
      assignmentEmailBody,
    } = body

    if (defaultAssigneeId) {
      const user = await prisma.user.findUnique({ where: { id: defaultAssigneeId } })
      if (!user || !user.isActive) {
        return NextResponse.json({ error: 'User not found or inactive' }, { status: 400 })
      }
    }

    // Only update aiApiKey if a real new value was provided (not the masked display value)
    const current = await prisma.appSettings.findUnique({ where: { id: 'singleton' } })
    const resolvedApiKey = aiApiKey && !aiApiKey.includes('•')
      ? encrypt(aiApiKey.trim())
      : (current?.aiApiKey ?? null)

    const data = {
      defaultAssigneeId: defaultAssigneeId || null,
      autoReplyBody: autoReplyBody ?? null,
      satisfactionSurveyBody: satisfactionSurveyBody ?? null,
      trustpilotUrl: trustpilotUrl || null,
      aiEnabled: aiEnabled ?? false,
      aiProvider: aiProvider || 'gemini',
      aiApiKey: resolvedApiKey,
      aiModel: aiModel || null,
      aiSystemPrompt: aiSystemPrompt || null,
      autoCloseEnabled: autoCloseEnabled ?? false,
      autoCloseDays: autoCloseDays ? Math.max(1, Math.min(365, parseInt(autoCloseDays, 10) || 7)) : 7,
      autoCloseEmailBody: autoCloseEmailBody ?? null,
      embedFormEnabled: embedFormEnabled ?? false,
      embedFormProducts: Array.isArray(embedFormProducts) ? embedFormProducts.filter((p: unknown) => typeof p === 'string' && p.trim()) : [],
      recaptchaEnabled: recaptchaEnabled ?? false,
      recaptchaSiteKey: recaptchaSiteKey?.trim() || null,
      recaptchaSecretKey: recaptchaSecretKey && !recaptchaSecretKey.includes('•')
        ? encrypt(recaptchaSecretKey.trim())
        : (current?.recaptchaSecretKey ?? null),
      assignmentEmailEnabled: assignmentEmailEnabled ?? false,
      assignmentEmailSubject: assignmentEmailSubject?.trim() || null,
      assignmentEmailBody: assignmentEmailBody ?? null,
    }

    const settings = await prisma.appSettings.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton', ...data },
      update: data,
      include: { defaultAssignee: { select: { id: true, name: true, email: true } } },
    })

    const savedAiKey = settings.aiApiKey ? safeDecrypt(settings.aiApiKey) : null
    const savedRecaptchaKey = settings.recaptchaSecretKey ? safeDecrypt(settings.recaptchaSecretKey) : null
    return NextResponse.json({
      ...settings,
      aiApiKey: savedAiKey ? maskApiKey(savedAiKey) : null,
      aiApiKeySet: !!settings.aiApiKey,
      recaptchaSecretKey: savedRecaptchaKey ? maskApiKey(savedRecaptchaKey) : null,
      recaptchaSecretKeySet: !!settings.recaptchaSecretKey,
    })
  } catch (err) {
    console.error('AppSettings PATCH error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
