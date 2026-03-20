import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'

export async function POST() {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (session.user.role !== 'SUPER_ADMIN' && session.user.role !== 'SUPPORT_ADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const result = await prisma.ticket.deleteMany({ where: { status: 'SPAM' } })

    return NextResponse.json({ success: true, count: result.count })
  } catch (err) {
    console.error('Delete all spam error:', err)
    return NextResponse.json({ error: 'Failed to delete spam tickets' }, { status: 500 })
  }
}
