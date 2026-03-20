import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions, isAdminRole } from '@/lib/auth'
import { prisma } from '@/lib/db'

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
