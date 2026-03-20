import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session || session.user.role !== 'SUPER_ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { confirmation, onlyFreshdesk } = await req.json()
    if (confirmation !== 'DeLeTe') {
      return NextResponse.json({ error: 'Invalid confirmation. Type "DeLeTe" exactly.' }, { status: 400 })
    }

    // Delete tickets (optionally only Freshdesk-imported ones)
    const where = onlyFreshdesk
      ? { importSource: { in: ['freshdesk-csv', 'freshdesk-api'] } }
      : {}
    const result = await prisma.ticket.deleteMany({ where })

    return NextResponse.json({ deleted: result.count })
  } catch (err) {
    console.error('Delete all tickets error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
