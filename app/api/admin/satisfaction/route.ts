import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (session.user.role !== 'SUPER_ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const { searchParams } = new URL(req.url)
    const ratingFilter = searchParams.get('rating') // DISSATISFIED | NEUTRAL | SATISFIED | null
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'))
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '25')))

    const where = ratingFilter
      ? { rating: ratingFilter, ratedAt: { not: null } }
      : {}

    const [ratings, total] = await Promise.all([
      prisma.satisfactionRating.findMany({
        where,
        include: {
          ticket: {
            select: {
              id: true,
              subject: true,
              fromEmail: true,
              fromName: true,
              createdAt: true,
              resolvedAt: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.satisfactionRating.count({ where }),
    ])

    return NextResponse.json({ ratings, total, page, limit })
  } catch (err) {
    console.error('Satisfaction GET error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
