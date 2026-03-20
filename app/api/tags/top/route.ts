import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rows = await prisma.$queryRaw<{ tag: string; count: bigint }[]>`
    SELECT unnest(tags) AS tag, COUNT(*) AS count
    FROM "Ticket"
    GROUP BY tag
    ORDER BY count DESC
    LIMIT 10
  `

  const tags = rows.map(r => ({ tag: r.tag, count: Number(r.count) }))
  return NextResponse.json(tags)
}
