import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions, isAdminRole } from '@/lib/auth'
import { prisma } from '@/lib/db'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id: numStr } = await params
    const ticketNumber = parseInt(numStr)
    if (isNaN(ticketNumber)) return NextResponse.json({ error: 'Invalid ticket ID' }, { status: 400 })
    const ticket = await prisma.ticket.findUnique({
      where: { ticketNumber },
      include: {
        assignees: { include: { user: { select: { id: true, name: true, email: true } } } },
        emailAccount: { select: { id: true, name: true, email: true } },
        messages: {
          include: { attachments: true },
          orderBy: { createdAt: 'asc' },
        },
        notes: {
          include: { user: { select: { id: true, name: true } } },
          orderBy: { createdAt: 'asc' },
        },
        attachments: true,
        activities: {
          include: { user: { select: { id: true, name: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    })

    if (!ticket) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // Agents can only view their assigned tickets
    if (!isAdminRole(session.user.role)) {
      const isAssigned = ticket.assignees.some(a => a.userId === session.user.id)
      if (!isAssigned) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    return NextResponse.json(ticket)
  } catch (err) {
    console.error('Ticket GET error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!isAdminRole(session.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const { id: numStr } = await params
    const ticketNumber = parseInt(numStr)
    if (isNaN(ticketNumber)) return NextResponse.json({ error: 'Invalid ticket ID' }, { status: 400 })
    const ticket = await prisma.ticket.findUnique({ where: { ticketNumber } })
    if (!ticket) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    await prisma.ticket.delete({ where: { id: ticket.id } })
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Ticket DELETE error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id: numStr } = await params
    const ticketNumber = parseInt(numStr)
    if (isNaN(ticketNumber)) return NextResponse.json({ error: 'Invalid ticket ID' }, { status: 400 })
    const body = await req.json()
    const { priority, tags } = body

    const ticket = await prisma.ticket.findUnique({ where: { ticketNumber } })
    if (!ticket) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // Priority change is admin-only; tags can be updated by anyone
    if (priority && !isAdminRole(session.user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const validPriorities = ['LOW', 'MEDIUM', 'HIGH', 'URGENT']
    if (priority && !validPriorities.includes(priority)) {
      return NextResponse.json({ error: 'Invalid priority' }, { status: 400 })
    }

    const updated = await prisma.ticket.update({
      where: { id: ticket.id },
      data: {
        ...(priority && { priority }),
        ...(tags && Array.isArray(tags) && { tags }),
      },
    })

    return NextResponse.json(updated)
  } catch (err) {
    console.error('Ticket PATCH error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
