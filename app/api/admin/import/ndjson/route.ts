import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { getActiveSpamRules, checkIsSpam } from '@/lib/spam'
import type { TicketStatus, Priority } from '@prisma/client'

export const maxDuration = 300

// ── Freshdesk status/priority mapping (numeric API values + string labels) ───
function mapStatus(raw: unknown): TicketStatus {
  if (typeof raw === 'number') {
    if (raw === 3) return 'PENDING'
    if (raw === 4) return 'RESOLVED'
    if (raw === 5) return 'CLOSED'
    return 'OPEN'
  }
  const s = String(raw).toLowerCase().trim()
  if (s === 'open') return 'OPEN'
  if (s === 'pending' || s === 'waiting on customer' || s === 'waiting on third party') return 'PENDING'
  if (s === 'resolved') return 'RESOLVED'
  if (s === 'closed') return 'CLOSED'
  return 'OPEN'
}

function mapPriority(raw: unknown): Priority {
  if (typeof raw === 'number') {
    if (raw === 1) return 'LOW'
    if (raw === 3) return 'HIGH'
    if (raw === 4) return 'URGENT'
    return 'MEDIUM'
  }
  const p = String(raw).toLowerCase().trim()
  if (p === 'low') return 'LOW'
  if (p === 'high') return 'HIGH'
  if (p === 'urgent') return 'URGENT'
  return 'MEDIUM'
}

function parseDate(raw: unknown): Date | null {
  if (!raw) return null
  const d = new Date(String(raw))
  return isNaN(d.getTime()) ? null : d
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractMessages(ticket: any, ticketFromEmail: string, ticketFromName: string | null): Array<{ body: string; htmlBody: string | null; fromEmail: string; fromName: string | null; isIncoming: boolean; createdAt: Date }> {
  const messages: Array<{ body: string; htmlBody: string | null; fromEmail: string; fromName: string | null; isIncoming: boolean; createdAt: Date }> = []

  // The ticket description is the first message
  // Support both camelCase (our export) and snake_case (Freshdesk raw API)
  const descText = ticket.descriptionText || ticket.description_text || ''
  const descHtml = ticket.descriptionHtml || ticket.description || null
  if (descText || descHtml) {
    messages.push({
      body: descText,
      htmlBody: descHtml,
      fromEmail: ticketFromEmail,
      fromName: ticketFromName,
      isIncoming: true,
      createdAt: parseDate(ticket.createdAt || ticket.created_at) ?? new Date(),
    })
  }

  // Conversations (replies) if present
  const convos = ticket.conversations || ticket.replies || []
  for (const c of convos) {
    if (c.private || c.isPrivate) continue // Skip private notes
    messages.push({
      body: c.body_text || c.bodyText || c.body || '',
      htmlBody: c.htmlBody || c.body || null,
      fromEmail: c.fromEmail || c.from_email || c.user?.email || ticketFromEmail,
      fromName: c.fromName || c.user?.name || null,
      isIncoming: c.isIncoming ?? c.incoming ?? (c.source === 0),
      createdAt: parseDate(c.createdAt || c.created_at) ?? new Date(),
    })
  }

  return messages
}

/** Read an NDJSON file line-by-line from a ReadableStream without loading it all into memory */
async function* streamLines(fileStream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = fileStream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed) yield trimmed
    }
  }
  // Flush remaining buffer
  const trimmed = buffer.trim()
  if (trimmed) yield trimmed
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (session.user.role !== 'SUPER_ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const formData = await req.formData()
    const file = formData.get('file') as File | null
    const emailAccountId = formData.get('emailAccountId') as string | null
    const assigneeId = formData.get('assigneeId') as string | null
    const overrideExisting = formData.get('overrideExisting') === 'true'
    const importLast7Days = formData.get('importLast7Days') === 'true'

    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    if (!emailAccountId) return NextResponse.json({ error: 'emailAccountId is required' }, { status: 400 })

    const account = await prisma.emailAccount.findUnique({ where: { id: emailAccountId } })
    if (!account) return NextResponse.json({ error: 'Email account not found' }, { status: 404 })

    const since = importLast7Days ? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) : null

    // Stream the file — first pass to count lines for progress
    // For large files we estimate from file size (avg ~2KB per ticket line)
    const estimatedTotal = Math.max(1, Math.round(file.size / 2048))

    const enc = new TextEncoder()
    const userId = session.user.id

    // We need to read the file stream — get it from the File object
    const fileStream = file.stream()

    const stream = new ReadableStream({
      async start(controller) {
        const push = (obj: object) => {
          try { controller.enqueue(enc.encode(JSON.stringify(obj) + '\n')) } catch { /* closed */ }
        }

        try {
          push({ type: 'total', count: estimatedTotal })
          push({ type: 'status', message: 'Reading NDJSON file…' })
          const spamRules = await getActiveSpamRules()

          let imported = 0
          let skipped = 0
          let lineNum = 0
          const errors: string[] = []

          for await (const line of streamLines(fileStream)) {
            lineNum++

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            let t: any
            try {
              t = JSON.parse(line)
            } catch {
              errors.push(`Line ${lineNum}: invalid JSON — skipped`)
              push({ type: 'progress', done: lineNum, total: estimatedTotal })
              continue
            }

            const ticketId = t.freshdeskId || t.id || t.ticket_id || ''
            const subject = t.subject || '(no subject)'
            const status = mapStatus(t.status)
            const priority = mapPriority(t.priority)
            const fromEmail = (t.fromEmail || t.email || t.requester?.email || '').toLowerCase()
            const fromName = t.fromName || t.requester?.name || t.name || null
            const createdAt = parseDate(t.createdAt || t.created_at) ?? new Date()
            const resolvedAt = parseDate(t.resolvedAt || t.resolved_at) ?? parseDate(t.closedAt || t.closed_at) ?? ((['RESOLVED', 'CLOSED'].includes(status)) ? new Date() : null)
            const tags = Array.isArray(t.tags) ? t.tags : (typeof t.tags === 'string' ? t.tags.split(',').map((s: string) => s.trim()).filter(Boolean) : [])

            // Date filter
            if (since && createdAt < since) {
              push({ type: 'progress', done: lineNum, total: estimatedTotal })
              continue
            }

            if (!fromEmail) {
              errors.push(`Line ${lineNum}: missing email — skipped`)
              push({ type: 'progress', done: lineNum, total: estimatedTotal })
              continue
            }

            const externalId = ticketId ? `freshdesk-${ticketId}` : null

            try {
              // Upsert contact
              let contactId: string | null = null
              try {
                const contact = await prisma.contact.upsert({
                  where: { email: fromEmail },
                  update: { name: fromName || undefined },
                  create: { email: fromEmail, name: fromName || null },
                })
                contactId = contact.id
              } catch { /* ignore */ }

              // Check for existing
              const existing = externalId
                ? await prisma.ticket.findUnique({ where: { messageId: externalId } })
                : null

              if (existing && !overrideExisting) {
                skipped++
                push({ type: 'progress', done: lineNum, total: estimatedTotal })
                continue
              }

              let dbTicketId: string

              if (existing && overrideExisting) {
                await prisma.ticket.update({
                  where: { id: existing.id },
                  data: { subject, status, priority, fromEmail, fromName, tags, resolvedAt, contactId },
                })
                await prisma.message.deleteMany({ where: { ticketId: existing.id } })
                if (assigneeId) await prisma.ticketAssignee.deleteMany({ where: { ticketId: existing.id } })
                dbTicketId = existing.id
              } else {
                const spamCheck = checkIsSpam(spamRules, subject, fromEmail, fromName, '')
                const effectiveStatus = spamCheck.isSpam ? 'SPAM' : status

                const ticket = await prisma.ticket.create({
                  data: {
                    subject,
                    status: effectiveStatus,
                    priority,
                    fromEmail,
                    fromName,
                    messageId: externalId,
                    tags,
                    emailAccountId,
                    importSource: 'freshdesk-api',
                    contactId,
                    createdAt,
                    resolvedAt: effectiveStatus !== 'SPAM' ? resolvedAt : null,
                  },
                })
                dbTicketId = ticket.id
              }

              // Import messages/conversations
              const msgs = extractMessages(t, fromEmail, fromName)
              for (const msg of msgs) {
                await prisma.message.create({
                  data: {
                    ticketId: dbTicketId,
                    body: msg.body,
                    htmlBody: msg.htmlBody,
                    fromEmail: msg.fromEmail || fromEmail,
                    fromName: msg.fromName,
                    isIncoming: msg.isIncoming,
                    createdAt: msg.createdAt,
                  },
                })
              }

              // If no messages were extracted, add a placeholder
              if (msgs.length === 0) {
                await prisma.message.create({
                  data: {
                    ticketId: dbTicketId,
                    body: 'This ticket was imported from a Freshdesk NDJSON export.',
                    fromEmail,
                    fromName,
                    isIncoming: true,
                    createdAt,
                  },
                })
              }

              if (assigneeId) {
                await prisma.ticketAssignee.upsert({
                  where: { ticketId_userId: { ticketId: dbTicketId, userId: assigneeId } },
                  update: {},
                  create: { ticketId: dbTicketId, userId: assigneeId },
                })
              }

              await prisma.activity.create({
                data: {
                  ticketId: dbTicketId,
                  userId,
                  action: 'ticket_created',
                  metadata: { source: 'freshdesk-ndjson', externalId },
                },
              })

              imported++
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err)
              errors.push(`Line ${lineNum} (${subject}): ${msg}`)
            }

            // Update total estimate once we have the real count
            push({ type: 'progress', done: lineNum, total: Math.max(lineNum, estimatedTotal) })
          }

          push({ type: 'done', imported, skipped, errors })
        } catch (err) {
          const message = err instanceof Error ? err.message : 'NDJSON import failed'
          console.error('NDJSON import error:', err)
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
  } catch (err) {
    const message = err instanceof Error ? err.message : 'NDJSON import failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
