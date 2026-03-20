import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions, isAdminRole } from '@/lib/auth'
import { prisma } from '@/lib/db'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isAdminRole(session.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startOf7Days = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  const startOf30Days = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

  const [
    totalOpen,
    totalPending,
    totalResolved,
    totalClosed,
    createdToday,
    resolvedToday,
    createdLast7,
    resolvedLast7,
    createdLast30,
    resolvedLast30,
    agentStats,
    dailyCounts,
  ] = await Promise.all([
    prisma.ticket.count({ where: { status: 'OPEN' } }),
    prisma.ticket.count({ where: { status: 'PENDING' } }),
    prisma.ticket.count({ where: { status: 'RESOLVED' } }),
    prisma.ticket.count({ where: { status: 'CLOSED' } }),
    prisma.ticket.count({ where: { createdAt: { gte: startOfToday } } }),
    prisma.ticket.count({ where: { resolvedAt: { gte: startOfToday } } }),
    prisma.ticket.count({ where: { createdAt: { gte: startOf7Days } } }),
    prisma.ticket.count({ where: { resolvedAt: { gte: startOf7Days } } }),
    prisma.ticket.count({ where: { createdAt: { gte: startOf30Days } } }),
    prisma.ticket.count({ where: { resolvedAt: { gte: startOf30Days } } }),
    prisma.user.findMany({
      where: { role: 'SUPPORT_AGENT', isActive: true },
      select: {
        id: true,
        name: true,
        _count: {
          select: {
            ticketAssignments: { where: { ticket: { status: { in: ['OPEN', 'PENDING'] } } } },
          },
        },
      },
      orderBy: { name: 'asc' },
    }),
    // Last 7 days daily ticket creation
    prisma.$queryRaw<Array<{ date: string; count: bigint }>>`
      SELECT DATE("createdAt") as date, COUNT(*) as count
      FROM "Ticket"
      WHERE "createdAt" >= ${startOf7Days}
      GROUP BY DATE("createdAt")
      ORDER BY date ASC
    `,
  ])

  return NextResponse.json({
    status: { open: totalOpen, pending: totalPending, resolved: totalResolved, closed: totalClosed },
    today: { created: createdToday, resolved: resolvedToday },
    last7: { created: createdLast7, resolved: resolvedLast7 },
    last30: { created: createdLast30, resolved: resolvedLast30 },
    agents: agentStats.map((a) => ({ id: a.id, name: a.name, openTickets: a._count.ticketAssignments })),
    daily: dailyCounts.map((r) => ({ date: r.date, count: Number(r.count) })),
  })
}
