import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions, isAdminRole } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { sendAssignmentNotifications } from '@/lib/assignment-notification'

const MAX_BULK_IDS = 100

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!isAdminRole(session.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const { ids, action, value } = await req.json()
    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: 'No ticket IDs provided' }, { status: 400 })
    }
    if (ids.length > MAX_BULK_IDS) {
      return NextResponse.json({ error: `Cannot process more than ${MAX_BULK_IDS} tickets at once` }, { status: 400 })
    }

    const safeIds = ids.filter((id) => typeof id === 'string')

    if (action === 'status') {
      const allowed = ['OPEN', 'PENDING', 'RESOLVED', 'CLOSED']
      if (!allowed.includes(value)) return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
      await prisma.ticket.updateMany({
        where: { id: { in: safeIds } },
        data: {
          status: value,
          ...(value === 'RESOLVED' || value === 'CLOSED' ? { resolvedAt: new Date() } : { resolvedAt: null }),
        },
      })
      for (const id of safeIds) {
        await prisma.activity.create({
          data: { ticketId: id, userId: session.user.id, action: 'status_changed', metadata: { to: value, bulk: true } },
        })
      }
    } else if (action === 'assign') {
      // value = agentId (single) for bulk assign
      for (const ticketId of safeIds) {
        const previous = value
          ? await prisma.ticketAssignee.findUnique({ where: { ticketId_userId: { ticketId, userId: value } } }).catch(() => null)
          : null
        await prisma.ticketAssignee.deleteMany({ where: { ticketId } })
        if (value) {
          await prisma.ticketAssignee.create({ data: { ticketId, userId: value } })
        }
        await prisma.activity.create({
          data: { ticketId, userId: session.user.id, action: 'assigned', metadata: { to: value, bulk: true } },
        })
        if (value && !previous) {
          sendAssignmentNotifications(ticketId, [value]).catch(err =>
            console.error('Assignment notification error:', err)
          )
        }
      }
    } else if (action === 'priority') {
      const allowed = ['LOW', 'MEDIUM', 'HIGH', 'URGENT']
      if (!allowed.includes(value)) return NextResponse.json({ error: 'Invalid priority' }, { status: 400 })
      await prisma.ticket.updateMany({ where: { id: { in: safeIds } }, data: { priority: value } })
    } else if (action === 'delete') {
      await prisma.ticket.deleteMany({ where: { id: { in: safeIds } } })
    } else {
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
    }

    return NextResponse.json({ success: true, count: safeIds.length })
  } catch (err) {
    console.error('Bulk POST error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
