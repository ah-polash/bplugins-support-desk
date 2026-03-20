import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions, isAdminRole } from '@/lib/auth'
import { prisma } from '@/lib/db'

// POST /api/tickets/[id]/assign
// Body: { agentIds: string[] }  — empty array = unassign all
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!isAdminRole(session.user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id: numStr } = await params
    const ticketNumber = parseInt(numStr)
    if (isNaN(ticketNumber)) return NextResponse.json({ error: 'Invalid ticket ID' }, { status: 400 })
    const { agentIds } = await req.json()

    if (!Array.isArray(agentIds)) {
      return NextResponse.json({ error: 'agentIds must be an array' }, { status: 400 })
    }

    const ticket = await prisma.ticket.findUnique({ where: { ticketNumber } })
    if (!ticket) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const ticketId = ticket.id

    // Validate all agentIds
    for (const agentId of agentIds) {
      const agent = await prisma.user.findUnique({ where: { id: agentId } })
      if (!agent || !agent.isActive) {
        return NextResponse.json({ error: `Agent ${agentId} not found or inactive` }, { status: 400 })
      }
    }

    // Get current assignees for activity log
    const currentAssignees = await prisma.ticketAssignee.findMany({ where: { ticketId }, select: { userId: true } })
    const currentIds = currentAssignees.map(a => a.userId)

    // Replace all assignees atomically
    await prisma.$transaction([
      prisma.ticketAssignee.deleteMany({ where: { ticketId } }),
      ...(agentIds.length > 0
        ? [prisma.ticketAssignee.createMany({
            data: agentIds.map((userId: string) => ({ ticketId, userId })),
          })]
        : []),
    ])

    await prisma.activity.create({
      data: {
        ticketId,
        userId: session.user.id,
        action: 'assigned',
        metadata: { from: currentIds, to: agentIds },
      },
    })

    const updated = await prisma.ticket.findUnique({
      where: { id: ticketId },
      include: { assignees: { include: { user: { select: { id: true, name: true, email: true } } } } },
    })

    return NextResponse.json(updated)
  } catch (err) {
    console.error('Assign POST error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
