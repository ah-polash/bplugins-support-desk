import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions, isAdminRole } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { sendReply } from '@/lib/smtp'
import { saveFile } from '@/lib/storage'
import { buildReplySubject } from '@/lib/utils'
import path from 'path'

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB per attachment

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id: numStr } = await params
    const ticketNumber = parseInt(numStr)
    if (isNaN(ticketNumber)) return NextResponse.json({ error: 'Invalid ticket ID' }, { status: 400 })
    const ticket = await prisma.ticket.findUnique({
      where: { ticketNumber },
      include: {
        emailAccount: true,
        // Fetch all messages to get first (for References) and last (for In-Reply-To)
        messages: {
          orderBy: { createdAt: 'asc' },
          select: { emailMsgId: true },
        },
      },
    })
    if (!ticket) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const assignees = await prisma.ticketAssignee.findMany({ where: { ticketId: ticket.id }, select: { userId: true } })
    const isAssigned = assignees.some(a => a.userId === session.user.id)
    if (!isAdminRole(session.user.role) && !isAssigned) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Fetch sender's signature
    const sender = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { name: true, signature: true },
    })

    const formData = await req.formData()
    const body = formData.get('body') as string
    const htmlBody = formData.get('htmlBody') as string
    const files = formData.getAll('attachments') as File[]

    if (!body?.trim()) return NextResponse.json({ error: 'Body is required' }, { status: 400 })

    // Validate file sizes
    for (const file of files) {
      if (file instanceof File && file.size > MAX_FILE_SIZE) {
        return NextResponse.json({ error: `File "${file.name}" exceeds 10 MB limit` }, { status: 400 })
      }
    }

    const signatureHtml = sender?.signature
      ? `<div class="signature" style="margin-top:16px;color:#6b7280;font-size:13px;">${sender.signature}</div>`
      : ''

    // Save attachments
    const savedFiles: Array<{ filename: string; path: string; contentType: string; url: string; size: number }> = []
    for (const file of files) {
      if (file instanceof File && file.size > 0) {
        const stored = await saveFile(file)
        savedFiles.push({
          filename: stored.filename,
          path: path.join(process.cwd(), 'public', stored.url),
          contentType: stored.mimeType,
          url: stored.url,
          size: stored.size,
        })
      }
    }

    // Use last message ID for In-Reply-To (proper threading)
    // and first message ID for References (so mail clients can thread the whole conversation)
    const msgs = ticket.messages
    const lastMsgId = msgs.length > 0 ? msgs[msgs.length - 1].emailMsgId : null
    const firstMsgId = msgs.length > 0 ? msgs[0].emailMsgId : null
    const replySubject = buildReplySubject(ticket.subject)

    // Build References header: chain all known message IDs
    const references = [firstMsgId, lastMsgId]
      .filter((id, i, arr) => id && arr.indexOf(id) === i)
      .join(' ') || undefined

    // Send email via SMTP
    const outMsgId = await sendReply({
      accountId: ticket.emailAccountId,
      to: ticket.fromEmail,
      toName: ticket.fromName || undefined,
      subject: replySubject,
      text: body,
      html: (htmlBody || `<p>${body.replace(/\n/g, '<br>')}</p>`) + signatureHtml,
      inReplyTo: lastMsgId || undefined,
      references,
      attachments: savedFiles.map((f) => ({
        filename: f.filename,
        path: f.path,
        contentType: f.contentType,
      })),
    })

    // Save message to DB
    const message = await prisma.message.create({
      data: {
        ticketId: ticket.id,
        body,
        htmlBody: htmlBody || undefined,
        fromEmail: ticket.emailAccount.email,
        fromName: sender?.name || 'bPlugins Support',
        isIncoming: false,
        emailMsgId: outMsgId,
      },
    })

    // Save attachments to DB
    for (const f of savedFiles) {
      await prisma.attachment.create({
        data: {
          ticketId: ticket.id,
          messageId: message.id,
          filename: f.filename,
          mimeType: f.contentType,
          size: f.size,
          url: f.url,
        },
      })
    }

    // Update ticket status to PENDING (waiting for customer)
    await prisma.ticket.update({
      where: { id: ticket.id },
      data: { status: 'PENDING' },
    })

    await prisma.activity.create({
      data: {
        ticketId: ticket.id,
        userId: session.user.id,
        action: 'replied',
        metadata: { to: ticket.fromEmail },
      },
    })

    return NextResponse.json({ message, success: true })
  } catch (err) {
    console.error('Reply POST error:', err)
    return NextResponse.json({ error: 'Failed to send reply' }, { status: 500 })
  }
}
