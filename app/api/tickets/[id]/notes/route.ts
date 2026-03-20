import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions, isAdminRole } from '@/lib/auth'
import { prisma } from '@/lib/db'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id: numStr } = await params
    const ticketNumber = parseInt(numStr)
    if (isNaN(ticketNumber)) return NextResponse.json({ error: 'Invalid ticket ID' }, { status: 400 })
    const { body } = await req.json()
    if (!body?.trim()) return NextResponse.json({ error: 'Body is required' }, { status: 400 })

    const ticket = await prisma.ticket.findUnique({ where: { ticketNumber }, include: { assignees: { select: { userId: true } } } })
    if (!ticket) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const ticketId = ticket.id

    const isAssigned = ticket.assignees.some(a => a.userId === session.user.id)
    if (!isAdminRole(session.user.role) && !isAssigned) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const note = await prisma.note.create({
      data: { ticketId, userId: session.user.id, body: body.trim() },
      include: { user: { select: { id: true, name: true } } },
    })

    await prisma.activity.create({
      data: { ticketId, userId: session.user.id, action: 'note_added' },
    })

    return NextResponse.json(note)
  } catch (err) {
    console.error('Notes POST error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
