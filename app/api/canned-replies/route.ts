import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'

export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const isSuperAdmin = session.user.role === 'SUPER_ADMIN'

    // SUPER_ADMIN sees everything; others see global replies + their own local replies
    const where = isSuperAdmin
      ? {}
      : { OR: [{ isGlobal: true }, { isGlobal: false, createdById: session.user.id }] }

    const replies = await prisma.cannedReply.findMany({
      where,
      orderBy: [{ isGlobal: 'desc' }, { title: 'asc' }],
      include: { createdBy: { select: { id: true, name: true } } },
    })
    return NextResponse.json(replies)
  } catch (err) {
    console.error('Canned replies GET error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { title, body, htmlBody } = await req.json()
    if (!title?.trim() || !body?.trim()) return NextResponse.json({ error: 'Title and body are required' }, { status: 400 })

    const isGlobal = session.user.role === 'SUPER_ADMIN'

    const reply = await prisma.cannedReply.create({
      data: { title, body, htmlBody, isGlobal, createdById: session.user.id },
      include: { createdBy: { select: { id: true, name: true } } },
    })
    return NextResponse.json(reply)
  } catch (err) {
    console.error('Canned replies POST error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
