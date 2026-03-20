import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'

export const maxDuration = 300

function escapeCSV(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}

function formatDate(d: Date | null): string {
  if (!d) return ''
  return d.toISOString()
}

function mapStatusToLabel(s: string): string {
  switch (s) {
    case 'OPEN': return 'Open'
    case 'PENDING': return 'Pending'
    case 'RESOLVED': return 'Resolved'
    case 'CLOSED': return 'Closed'
    case 'SPAM': return 'Open'
    default: return 'Open'
  }
}

function mapPriorityToLabel(p: string): string {
  switch (p) {
    case 'LOW': return 'Low'
    case 'MEDIUM': return 'Medium'
    case 'HIGH': return 'High'
    case 'URGENT': return 'Urgent'
    default: return 'Medium'
  }
}

export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (session.user.role !== 'SUPER_ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const tickets = await prisma.ticket.findMany({
      where: { status: { not: 'SPAM' } },
      include: {
        contact: { select: { externalId: true, phone: true, twitterId: true, facebookId: true } },
      },
      orderBy: { createdAt: 'asc' },
    })

    const headers = [
      'Ticket ID', 'Subject', 'Status', 'Priority',
      'Email', 'Full name', 'Created time', 'Resolved time',
      'Closed time', 'Tags', 'Contact ID', 'Work phone',
      'Twitter ID', 'Facebook ID',
    ]

    const rows = tickets.map(t => [
      String(t.ticketNumber),
      t.subject,
      mapStatusToLabel(t.status),
      mapPriorityToLabel(t.priority),
      t.fromEmail,
      t.fromName || '',
      formatDate(t.createdAt),
      t.status === 'RESOLVED' ? formatDate(t.resolvedAt) : '',
      t.status === 'CLOSED' ? formatDate(t.resolvedAt) : '',
      (t.tags || []).join(','),
      t.contact?.externalId || '',
      t.contact?.phone || '',
      t.contact?.twitterId || '',
      t.contact?.facebookId || '',
    ])

    const csv = [
      headers.map(h => escapeCSV(h)).join(','),
      ...rows.map(row => row.map(v => escapeCSV(v)).join(',')),
    ].join('\n')

    const filename = `tickets-export-${new Date().toISOString().slice(0, 10)}.csv`

    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-cache',
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Export failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
