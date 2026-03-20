import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { getActiveSpamRules, checkIsSpam } from '@/lib/spam'

export const maxDuration = 300

export async function POST() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role !== 'SUPER_ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => {
        controller.enqueue(encoder.encode(JSON.stringify(data) + '\n'))
      }

      try {
        const spamRules = await getActiveSpamRules()

        if (spamRules.length === 0) {
          send({ done: true, processed: 0, total: 0, moved: 0, message: 'No active spam rules to scan with.' })
          controller.close()
          return
        }

        // Count all non-spam tickets
        const total = await prisma.ticket.count({ where: { status: { not: 'SPAM' } } })
        send({ processed: 0, total, moved: 0 })

        const BATCH = 100
        let cursor: string | undefined = undefined
        let processed = 0
        let moved = 0

        while (true) {
          const queryArgs: { where: object; select: object; orderBy: object; take: number; skip?: number; cursor?: object } = {
            where: { status: { not: 'SPAM' } },
            select: {
              id: true,
              subject: true,
              fromEmail: true,
              fromName: true,
              messages: {
                orderBy: { createdAt: 'asc' },
                take: 1,
                select: { body: true },
              },
            },
            orderBy: { id: 'asc' },
            take: BATCH,
          }
          if (cursor) {
            queryArgs.skip = 1
            queryArgs.cursor = { id: cursor }
          }
          const tickets = await (prisma.ticket.findMany(queryArgs as never) as unknown as Promise<Array<{ id: string; subject: string; fromEmail: string; fromName: string | null; messages: Array<{ body: string }> }>>)

          if (tickets.length === 0) break

          for (const ticket of tickets) {
            const body = ticket.messages[0]?.body ?? ''
            const check = checkIsSpam(spamRules, ticket.subject, ticket.fromEmail, ticket.fromName, body)

            if (check.isSpam) {
              await prisma.ticket.update({
                where: { id: ticket.id },
                data: { status: 'SPAM' },
              })
              await prisma.activity.create({
                data: {
                  ticketId: ticket.id,
                  userId: session.user.id,
                  action: 'status_changed',
                  metadata: { from: 'scan', to: 'SPAM', spamRule: check.ruleType, spamValue: check.ruleValue },
                },
              })
              moved++
            }

            processed++
          }

          cursor = tickets[tickets.length - 1].id
          send({ processed, total, moved })

          if (tickets.length < BATCH) break
        }

        send({ done: true, processed, total, moved })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Scan failed'
        send({ error: message })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    },
  })
}
