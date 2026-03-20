import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'

async function getReplyAndCheckAccess(id: string, userId: string, role: string) {
  const reply = await prisma.cannedReply.findUnique({ where: { id } })
  if (!reply) return { reply: null, forbidden: false }

  // Global replies can only be modified by SUPER_ADMIN
  if (reply.isGlobal && role !== 'SUPER_ADMIN') {
    return { reply, forbidden: true }
  }
  // Local replies can only be modified by their creator or SUPER_ADMIN
  if (!reply.isGlobal && role !== 'SUPER_ADMIN' && reply.createdById !== userId) {
    return { reply, forbidden: true }
  }
  return { reply, forbidden: false }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await params
    const { reply, forbidden } = await getReplyAndCheckAccess(id, session.user.id, session.user.role)
    if (!reply) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (forbidden) return NextResponse.json({ error: 'You can only edit your own canned replies' }, { status: 403 })

    const { title, body, htmlBody } = await req.json()
    const data: Record<string, unknown> = {}
    if (title) data.title = title
    if (body) data.body = body
    if (typeof htmlBody === 'string') data.htmlBody = htmlBody

    const updated = await prisma.cannedReply.update({
      where: { id },
      data,
      include: { createdBy: { select: { id: true, name: true } } },
    })
    return NextResponse.json(updated)
  } catch (err) {
    console.error('Canned reply PATCH error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await params
    const { reply, forbidden } = await getReplyAndCheckAccess(id, session.user.id, session.user.role)
    if (!reply) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (forbidden) return NextResponse.json({ error: 'You can only delete your own canned replies' }, { status: 403 })

    await prisma.cannedReply.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Canned reply DELETE error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
