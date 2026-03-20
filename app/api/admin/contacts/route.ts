import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { Prisma } from '@prisma/client'

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const role = session.user.role
    if (role !== 'SUPER_ADMIN' && role !== 'SUPPORT_ADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { searchParams } = new URL(req.url)
    const page   = Math.max(1, parseInt(searchParams.get('page') ?? '1'))
    const limit  = Math.min(500, Math.max(1, parseInt(searchParams.get('limit') ?? '50')))
    const search = searchParams.get('search')?.trim() ?? ''
    const hasTickets = searchParams.get('hasTickets') ?? '' // 'yes' | 'no' | ''
    const source = searchParams.get('source') ?? '' // 'embed-form' | 'import' | ''
    const sortBy = searchParams.get('sortBy') ?? 'newest' // 'newest' | 'oldest' | 'most-tickets' | 'name-asc' | 'name-desc'

    // Build where clause
    const conditions: Prisma.ContactWhereInput[] = []

    if (search) {
      conditions.push({
        OR: [
          { email:      { contains: search, mode: 'insensitive' } },
          { name:       { contains: search, mode: 'insensitive' } },
          { phone:      { contains: search, mode: 'insensitive' } },
          { externalId: { contains: search, mode: 'insensitive' } },
        ],
      })
    }

    if (hasTickets === 'yes') {
      conditions.push({ tickets: { some: {} } })
    } else if (hasTickets === 'no') {
      conditions.push({ tickets: { none: {} } })
    }

    if (source === 'embed-form') {
      conditions.push({ tickets: { some: { importSource: 'embed-form' } } })
    } else if (source === 'import') {
      conditions.push({ tickets: { some: { importSource: { in: ['freshdesk-csv', 'freshdesk-api', 'helpscout'] } } } })
    } else if (source === 'email') {
      conditions.push({ tickets: { some: { importSource: null } } })
    }

    const where: Prisma.ContactWhereInput = conditions.length > 0 ? { AND: conditions } : {}

    // Build orderBy
    let orderBy: Prisma.ContactOrderByWithRelationInput
    switch (sortBy) {
      case 'oldest':
        orderBy = { createdAt: 'asc' }; break
      case 'most-tickets':
        orderBy = { tickets: { _count: 'desc' } }; break
      case 'name-asc':
        orderBy = { name: { sort: 'asc', nulls: 'last' } }; break
      case 'name-desc':
        orderBy = { name: { sort: 'desc', nulls: 'last' } }; break
      default:
        orderBy = { createdAt: 'desc' }
    }

    const [contacts, total] = await Promise.all([
      prisma.contact.findMany({
        where,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          externalId: true,
          name: true,
          email: true,
          phone: true,
          twitterId: true,
          facebookId: true,
          createdAt: true,
          _count: { select: { tickets: true } },
          tickets: {
            select: { importSource: true },
            take: 1,
            orderBy: { createdAt: 'desc' },
          },
        },
      }),
      prisma.contact.count({ where }),
    ])

    // Flatten tickets to just provide the latest source
    const result = contacts.map(c => ({
      ...c,
      latestSource: c.tickets[0]?.importSource ?? null,
      tickets: undefined,
    }))

    return NextResponse.json({ contacts: result, total })
  } catch (err) {
    console.error('Contacts GET error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
