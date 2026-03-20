import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'

export const maxDuration = 300

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

    const enc = new TextEncoder()

    const stream = new ReadableStream({
      async start(controller) {
        try {
          const batchSize = 100
          let skip = 0

          while (true) {
            const tickets = await prisma.ticket.findMany({
              where: { status: { not: 'SPAM' } },
              include: {
                messages: { orderBy: { createdAt: 'asc' } },
                contact: { select: { externalId: true, phone: true, twitterId: true, facebookId: true } },
              },
              orderBy: { createdAt: 'asc' },
              skip,
              take: batchSize,
            })

            if (tickets.length === 0) break

            for (const t of tickets) {
              // First message = description, rest = conversations
              const firstMsg = t.messages[0] || null
              const conversations = t.messages.slice(1).map(m => ({
                body: m.htmlBody || m.body,
                bodyText: m.body,
                htmlBody: m.htmlBody || null,
                fromEmail: m.fromEmail,
                fromName: m.fromName || null,
                isIncoming: m.isIncoming,
                isPrivate: false,
                createdAt: m.createdAt.toISOString(),
              }))

              const line: Record<string, unknown> = {
                freshdeskId: t.ticketNumber,
                subject: t.subject,
                status: mapStatusToLabel(t.status),
                priority: mapPriorityToLabel(t.priority),
                fromEmail: t.fromEmail,
                fromName: t.fromName || null,
                tags: t.tags || [],
                descriptionText: firstMsg?.body || '',
                descriptionHtml: firstMsg?.htmlBody || null,
                conversations,
                createdAt: t.createdAt.toISOString(),
                resolvedAt: t.resolvedAt?.toISOString() || null,
                closedAt: t.status === 'CLOSED' ? (t.resolvedAt?.toISOString() || null) : null,
                contactId: t.contact?.externalId || null,
                phone: t.contact?.phone || null,
                twitterId: t.contact?.twitterId || null,
                facebookId: t.contact?.facebookId || null,
              }

              controller.enqueue(enc.encode(JSON.stringify(line) + '\n'))
            }

            skip += batchSize
            if (tickets.length < batchSize) break
          }
        } catch (err) {
          console.error('NDJSON export error:', err)
        } finally {
          controller.close()
        }
      },
    })

    const filename = `tickets-export-${new Date().toISOString().slice(0, 10)}.ndjson`

    return new Response(stream, {
      headers: {
        'Content-Type': 'application/x-ndjson',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-cache',
        'X-Accel-Buffering': 'no',
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Export failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
