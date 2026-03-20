import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { testHelpScout, fetchHelpScoutTickets } from '@/lib/importers/helpscout'
import { testFreshdesk, fetchAllTickets, fetchConversations, ticketToImport } from '@/lib/importers/freshdesk'
import type { ImportTicket, ImportResult } from '@/lib/importers/types'
import { getActiveSpamRules, checkIsSpam } from '@/lib/spam'

// Allow longer execution time for large imports
export const maxDuration = 300

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (session.user.role !== 'SUPER_ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const body = await req.json()
    const { mode, source, emailAccountId, assigneeId, overrideExisting, skipConversations, importLast7Days, helpscout, freshdesk } = body

    // Validate email account
    if (mode === 'run' && !emailAccountId) {
      return NextResponse.json({ error: 'emailAccountId is required' }, { status: 400 })
    }

    // --- Test mode: just verify credentials ---
    if (mode === 'test') {
      if (source === 'helpscout') {
        if (!helpscout?.appId || !helpscout?.appSecret) {
          return NextResponse.json({ error: 'App ID and App Secret are required' }, { status: 400 })
        }
        await testHelpScout({ appId: helpscout.appId, appSecret: helpscout.appSecret })
        return NextResponse.json({ success: true })
      }
      if (source === 'freshdesk') {
        if (!freshdesk?.domain || !freshdesk?.apiKey) {
          return NextResponse.json({ error: 'Domain and API key are required' }, { status: 400 })
        }
        await testFreshdesk({ domain: freshdesk.domain, apiKey: freshdesk.apiKey })
        return NextResponse.json({ success: true })
      }
      return NextResponse.json({ error: 'Unknown source' }, { status: 400 })
    }

    // --- Run mode: stream progress via NDJSON ---
    if (mode === 'run') {
      const account = await prisma.emailAccount.findUnique({ where: { id: emailAccountId } })
      if (!account) return NextResponse.json({ error: 'Email account not found' }, { status: 404 })

      const userId = session.user.id
      const enc = new TextEncoder()

      const stream = new ReadableStream({
        async start(controller) {
          const push = (obj: object) => {
            try { controller.enqueue(enc.encode(JSON.stringify(obj) + '\n')) } catch { /* closed */ }
          }

          try {
            let tickets: ImportTicket[] = []

            if (source === 'freshdesk') {
              if (!freshdesk?.domain || !freshdesk?.apiKey) {
                push({ type: 'error', message: 'Domain and API key are required' })
                controller.close()
                return
              }
              const creds = { domain: freshdesk.domain, apiKey: freshdesk.apiKey }

              push({ type: 'status', message: 'Fetching ticket list from Freshdesk…' })
              const since = importLast7Days ? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) : undefined
              const rawTickets = await fetchAllTickets(creds, since)
              push({ type: 'total', count: rawTickets.length })

              if (skipConversations) {
                // Fast path: import tickets only (no per-ticket API calls)
                for (let i = 0; i < rawTickets.length; i++) {
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  const t = rawTickets[i] as any
                  tickets.push(ticketToImport(t, []))
                  if (i % 100 === 0 || i === rawTickets.length - 1) {
                    push({ type: 'fetch_progress', done: i + 1, total: rawTickets.length, current: t.subject ?? '' })
                  }
                }
              } else {
                // Full path: fetch conversations in parallel batches of 5
                const CONCURRENCY = 5
                for (let i = 0; i < rawTickets.length; i += CONCURRENCY) {
                  const batch = rawTickets.slice(i, i + CONCURRENCY)
                  const results = await Promise.all(
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    batch.map(async (t: any) => {
                      const conversations = await fetchConversations(creds, t.id)
                      return ticketToImport(t, conversations)
                    })
                  )
                  tickets.push(...results)
                  const done = Math.min(i + CONCURRENCY, rawTickets.length)
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  push({ type: 'fetch_progress', done, total: rawTickets.length, current: (batch[batch.length - 1] as any).subject ?? '' })
                }
              }
            } else if (source === 'helpscout') {
              if (!helpscout?.appId || !helpscout?.appSecret) {
                push({ type: 'error', message: 'App ID and App Secret are required' })
                controller.close()
                return
              }
              push({ type: 'status', message: 'Fetching tickets from HelpScout…' })
              tickets = await fetchHelpScoutTickets({ appId: helpscout.appId, appSecret: helpscout.appSecret })
              push({ type: 'total', count: tickets.length })
            } else {
              push({ type: 'error', message: 'Unknown source' })
              controller.close()
              return
            }

            // Save to DB
            push({ type: 'status', message: 'Saving to database…' })
            const result = await saveTickets(tickets, emailAccountId, userId, assigneeId || null, !!overrideExisting, (done, total) => {
              push({ type: 'save_progress', done, total })
            })

            push({ type: 'done', imported: result.imported, skipped: result.skipped, errors: result.errors })
          } catch (err) {
            const message = err instanceof Error ? err.message : 'Import failed'
            console.error('Import stream error:', err)
            push({ type: 'error', message })
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

    return NextResponse.json({ error: 'Invalid mode' }, { status: 400 })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Import failed'
    console.error('Import error:', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

async function saveTickets(
  tickets: ImportTicket[],
  emailAccountId: string,
  importedByUserId: string,
  assigneeId: string | null,
  overrideExisting: boolean,
  onProgress: (done: number, total: number) => void
): Promise<ImportResult> {
  const result: ImportResult = { imported: 0, skipped: 0, errors: [] }
  const spamRules = await getActiveSpamRules()

  for (let i = 0; i < tickets.length; i++) {
    const t = tickets[i]
    onProgress(i + 1, tickets.length)
    try {
      const existing = await prisma.ticket.findUnique({ where: { messageId: t.externalId } })

      if (existing && !overrideExisting) {
        result.skipped++
        continue
      }

      let ticketId: string

      if (existing && overrideExisting) {
        await prisma.ticket.update({
          where: { id: existing.id },
          data: {
            subject: t.subject,
            status: t.status,
            priority: t.priority,
            fromEmail: t.fromEmail,
            fromName: t.fromName,
            tags: t.tags,
            resolvedAt: (t.status === 'RESOLVED' || t.status === 'CLOSED') ? existing.resolvedAt ?? new Date() : null,
          },
        })
        await prisma.message.deleteMany({ where: { ticketId: existing.id } })
        if (assigneeId) {
          await prisma.ticketAssignee.deleteMany({ where: { ticketId: existing.id } })
        }
        ticketId = existing.id
      } else {
        const firstBody = t.messages[0]?.body ?? ''
        const spamCheck = checkIsSpam(spamRules, t.subject, t.fromEmail, t.fromName, firstBody)
        const effectiveStatus = spamCheck.isSpam ? 'SPAM' : t.status

        const ticket = await prisma.ticket.create({
          data: {
            subject: t.subject,
            status: effectiveStatus,
            priority: t.priority,
            fromEmail: t.fromEmail,
            fromName: t.fromName,
            messageId: t.externalId,
            tags: t.tags,
            emailAccountId,
            createdAt: t.createdAt,
            resolvedAt: (['RESOLVED', 'CLOSED'].includes(effectiveStatus)) ? new Date() : null,
          },
        })
        ticketId = ticket.id
      }

      for (const msg of t.messages) {
        await prisma.message.create({
          data: {
            ticketId,
            body: msg.body,
            htmlBody: msg.htmlBody,
            fromEmail: msg.fromEmail,
            fromName: msg.fromName,
            isIncoming: msg.isIncoming,
            createdAt: msg.createdAt,
          },
        })
      }

      if (assigneeId) {
        await prisma.ticketAssignee.create({
          data: { ticketId, userId: assigneeId },
        })
      }

      await prisma.activity.create({
        data: {
          ticketId,
          userId: importedByUserId,
          action: 'ticket_created',
          metadata: {
            source: 'import',
            externalId: t.externalId,
            assigneeId: assigneeId ?? undefined,
            overridden: existing ? true : undefined,
          },
        },
      })

      result.imported++
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      result.errors.push(`Ticket "${t.subject}" (${t.externalId}): ${message}`)
    }
  }

  return result
}
