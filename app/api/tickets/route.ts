import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions, isAdminRole } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { sendSystemEmail } from '@/lib/smtp'
import { sendAssignmentNotifications } from '@/lib/assignment-notification'

const VALID_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const
const VALID_STATUSES = ['OPEN', 'PENDING', 'RESOLVED', 'CLOSED'] as const
type Priority = typeof VALID_PRIORITIES[number]
type TicketStatus = typeof VALID_STATUSES[number]

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = new URL(req.url)
    const status = searchParams.get('status')
    const priority = searchParams.get('priority')
    const assignedTo = searchParams.get('assignedTo')
    const search = searchParams.get('search')
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'))
    const limit = Math.min(500, Math.max(1, parseInt(searchParams.get('limit') || '25')))
    const myInbox = searchParams.get('myInbox') === 'true'
    const myTickets = searchParams.get('myTickets') === 'true'
    const othersTickets = searchParams.get('othersTickets') === 'true'
    const excludeStatus = searchParams.get('excludeStatus')
    const fromEmail = searchParams.get('fromEmail')
    const tag = searchParams.get('tag')
    const minReplies = searchParams.get('minReplies')
    const maxReplies = searchParams.get('maxReplies')
    const isAdmin = isAdminRole(session.user.role)

    const where: Record<string, unknown> = {}

    if (myInbox) {
      // My Inbox = OPEN tickets assigned to me
      where.status = 'OPEN'
      where.assignees = { some: { userId: session.user.id } }
    } else if (othersTickets) {
      // Tickets assigned to others but NOT to the current user (admin only)
      where.AND = [
        { assignees: { some: {} } },
        { assignees: { none: { userId: session.user.id } } },
      ]
      if (status) where.status = status
      if (priority) where.priority = priority
      if (search) {
        const q = search.slice(0, 200)
        where.OR = [
          { subject: { contains: q, mode: 'insensitive' } },
          { fromEmail: { contains: q, mode: 'insensitive' } },
          { fromName: { contains: q, mode: 'insensitive' } },
        ]
      }
    } else if (myTickets) {
      // All tickets assigned to me (any status)
      where.assignees = { some: { userId: session.user.id } }
      if (status) where.status = status
      if (priority) where.priority = priority
      if (search) {
        const q = search.slice(0, 200)
        where.OR = [
          { subject: { contains: q, mode: 'insensitive' } },
          { fromEmail: { contains: q, mode: 'insensitive' } },
          { fromName: { contains: q, mode: 'insensitive' } },
        ]
      }
    } else {
      // Admin: all tickets. Agent: only their assigned tickets
      if (!isAdmin) {
        where.assignees = { some: { userId: session.user.id } }
      }
      if (status) where.status = status
      if (priority) where.priority = priority
      if (assignedTo) where.assignees = { some: { userId: assignedTo } }
      if (fromEmail) where.fromEmail = { equals: fromEmail, mode: 'insensitive' }
      if (search) {
        const q = search.slice(0, 200)
        where.OR = [
          { subject: { contains: q, mode: 'insensitive' } },
          { fromEmail: { contains: q, mode: 'insensitive' } },
          { fromName: { contains: q, mode: 'insensitive' } },
        ]
      }
    }

    // Tag filter (works across all branches)
    if (tag) where.tags = { has: tag }

    // Apply excludeStatus filter (e.g. hide CLOSED tickets)
    if (excludeStatus && !where.status) {
      where.status = { not: excludeStatus }
    }

    // Always exclude SPAM from normal views unless explicitly requested
    if (status !== 'SPAM') {
      if (!where.status) {
        where.status = { not: 'SPAM' }
      } else if (where.status && typeof where.status === 'object' && 'not' in (where.status as object)) {
        const notVal = (where.status as { not: string }).not
        if (notVal !== 'SPAM') {
          where.status = { notIn: [notVal, 'SPAM'] }
        }
      }
    }

    // Filter by reply (message) count
    if (minReplies !== null || maxReplies !== null) {
      const min = minReplies ? parseInt(minReplies, 10) : 0
      const max = maxReplies ? parseInt(maxReplies, 10) : null

      const havingParts: string[] = []
      if (min > 0) havingParts.push(`COUNT(m.id) >= ${min}`)
      if (max !== null) havingParts.push(`COUNT(m.id) <= ${max}`)

      let query: string
      if (min === 0 && max !== null && max === 0) {
        // Special case: tickets with zero messages
        query = `SELECT t.id FROM "Ticket" t LEFT JOIN "Message" m ON m."ticketId" = t.id GROUP BY t.id HAVING COUNT(m.id) = 0`
      } else if (havingParts.length > 0) {
        query = `SELECT t.id FROM "Ticket" t LEFT JOIN "Message" m ON m."ticketId" = t.id GROUP BY t.id HAVING ${havingParts.join(' AND ')}`
      } else {
        query = ''
      }

      if (query) {
        const rows = await prisma.$queryRawUnsafe<{ id: string }[]>(query)
        const ids = rows.map((r) => r.id)
        if (where.id) {
          // Merge with existing id filter
          where.AND = [...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []), { id: { in: ids } }]
        } else {
          where.id = { in: ids }
        }
      }
    }

    const [tickets, total] = await Promise.all([
      prisma.ticket.findMany({
        where,
        include: {
          assignees: { include: { user: { select: { id: true, name: true, email: true } } } },
          emailAccount: { select: { id: true, name: true, email: true } },
          _count: { select: { messages: true, attachments: true } },
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { body: true, createdAt: true, isIncoming: true },
          },
        },
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.ticket.count({ where }),
    ])

    return NextResponse.json({ tickets, total, page, limit })
  } catch (err) {
    console.error('Tickets GET error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!isAdminRole(session.user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await req.json()
    const {
      subject: rawSubject,
      fromEmail: rawFromEmail,
      fromName: rawFromName,
      emailAccountId,
      priority,
      status,
      tags,
      assigneeIds,
      body: rawBody,
      htmlBody: rawHtmlBody,
      sendEmail,
    } = body || {}

    if (!rawSubject || typeof rawSubject !== 'string' || !rawSubject.trim()) {
      return NextResponse.json({ error: 'Subject is required' }, { status: 400 })
    }
    if (!rawFromEmail || typeof rawFromEmail !== 'string' || !rawFromEmail.includes('@')) {
      return NextResponse.json({ error: 'Valid customer email is required' }, { status: 400 })
    }
    if (!rawBody || typeof rawBody !== 'string' || !rawBody.trim()) {
      return NextResponse.json({ error: 'Message body is required' }, { status: 400 })
    }
    if (priority && !VALID_PRIORITIES.includes(priority)) {
      return NextResponse.json({ error: 'Invalid priority' }, { status: 400 })
    }
    if (status && !VALID_STATUSES.includes(status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }

    const trimmedSubject = rawSubject.trim().slice(0, 500)
    const trimmedFromEmail = rawFromEmail.trim().toLowerCase().slice(0, 320)
    const trimmedFromName = typeof rawFromName === 'string' ? rawFromName.trim().slice(0, 200) : ''
    const trimmedBody = rawBody.trim().slice(0, 50000)
    const trimmedHtml = typeof rawHtmlBody === 'string' && rawHtmlBody.trim() ? rawHtmlBody : null
    const finalPriority: Priority = (priority as Priority) || 'MEDIUM'
    const finalStatus: TicketStatus = (status as TicketStatus) || 'OPEN'
    const tagList: string[] = Array.isArray(tags)
      ? tags.map(t => String(t).trim().toLowerCase()).filter(Boolean).slice(0, 30)
      : []
    const assigneeList: string[] = Array.isArray(assigneeIds)
      ? assigneeIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
      : []

    // Resolve email account
    const account = emailAccountId
      ? await prisma.emailAccount.findUnique({ where: { id: emailAccountId } })
      : await prisma.emailAccount.findFirst({ where: { isActive: true }, orderBy: { createdAt: 'asc' } })
    if (!account) {
      return NextResponse.json({ error: 'No email account available' }, { status: 400 })
    }

    // Upsert contact
    let contactId: string | null = null
    try {
      const contact = await prisma.contact.upsert({
        where: { email: trimmedFromEmail },
        update: trimmedFromName ? { name: trimmedFromName } : {},
        create: { email: trimmedFromEmail, name: trimmedFromName || null },
      })
      contactId = contact.id
    } catch { /* ignore */ }

    const willSendEmail = !!sendEmail
    const ticket = await prisma.ticket.create({
      data: {
        subject: trimmedSubject,
        status: willSendEmail && finalStatus === 'OPEN' ? 'PENDING' : finalStatus,
        priority: finalPriority,
        fromEmail: trimmedFromEmail,
        fromName: trimmedFromName || null,
        emailAccountId: account.id,
        importSource: 'admin-created',
        contactId,
        tags: tagList,
      },
    })

    // Get sender info for outgoing message attribution
    const sender = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { name: true, signature: true },
    })

    const message = await prisma.message.create({
      data: {
        ticketId: ticket.id,
        body: trimmedBody,
        htmlBody: trimmedHtml || `<p>${trimmedBody.replace(/\n/g, '<br>')}</p>`,
        fromEmail: willSendEmail ? account.email : trimmedFromEmail,
        fromName: willSendEmail ? (sender?.name || 'Support') : (trimmedFromName || null),
        isIncoming: !willSendEmail,
      },
    })

    // Optionally send the initial email to the customer
    if (willSendEmail) {
      try {
        const signatureHtml = sender?.signature
          ? `<div class="signature" style="margin-top:16px;color:#6b7280;font-size:13px;">${sender.signature}</div>`
          : ''
        const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000'
        const trackingPixel = `<img src="${baseUrl}/api/track/open/${message.id}/pixel.gif" width="1" height="1" alt="" style="display:none;border:0;outline:0;" />`
        const finalHtml = (trimmedHtml || `<p>${trimmedBody.replace(/\n/g, '<br>')}</p>`) + signatureHtml + trackingPixel
        const outMsgId = await sendSystemEmail({
          accountId: account.id,
          to: trimmedFromEmail,
          toName: trimmedFromName || undefined,
          subject: trimmedSubject,
          text: trimmedBody,
          html: finalHtml,
        })
        await prisma.message.update({ where: { id: message.id }, data: { emailMsgId: outMsgId } })
      } catch (err) {
        console.error('Initial email send failed:', err)
      }
    }

    // Assign agents
    if (assigneeList.length) {
      const validAgents = await prisma.user.findMany({
        where: { id: { in: assigneeList }, isActive: true },
        select: { id: true },
      })
      const validIds = validAgents.map(a => a.id)
      if (validIds.length) {
        await prisma.ticketAssignee.createMany({
          data: validIds.map(userId => ({ ticketId: ticket.id, userId })),
          skipDuplicates: true,
        })
        sendAssignmentNotifications(ticket.id, validIds).catch(err =>
          console.error('Assignment notification error:', err)
        )
      }
    }

    await prisma.activity.create({
      data: {
        ticketId: ticket.id,
        userId: session.user.id,
        action: 'ticket_created',
        metadata: { source: 'admin-created', emailSent: willSendEmail },
      },
    })

    return NextResponse.json({ ticket, success: true }, { status: 201 })
  } catch (err) {
    console.error('Tickets POST error:', err)
    return NextResponse.json({ error: 'Failed to create ticket' }, { status: 500 })
  }
}
