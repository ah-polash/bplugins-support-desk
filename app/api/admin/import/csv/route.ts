import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { parseCSV } from '@/lib/csv-parser'
import { getActiveSpamRules, checkIsSpam } from '@/lib/spam'
import type { TicketStatus, Priority } from '@prisma/client'

export const maxDuration = 300

// ── Status/Priority mapping for Freshdesk CSV values ──────────────────────────
function mapStatus(raw: string): TicketStatus {
  const s = raw.toLowerCase().trim()
  if (s === 'open')    return 'OPEN'
  if (s === 'pending' || s === 'waiting on customer' || s === 'waiting on third party') return 'PENDING'
  if (s === 'resolved') return 'RESOLVED'
  if (s === 'closed')   return 'CLOSED'
  return 'OPEN'
}

function mapPriority(raw: string): Priority {
  const p = raw.toLowerCase().trim()
  if (p === 'low')    return 'LOW'
  if (p === 'high')   return 'HIGH'
  if (p === 'urgent') return 'URGENT'
  return 'MEDIUM'
}

function parseDate(raw: string): Date | null {
  if (!raw || raw.trim() === '') return null
  const d = new Date(raw.trim())
  return isNaN(d.getTime()) ? null : d
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (session.user.role !== 'SUPER_ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const body = await req.json()
    const { csvText, emailAccountId, assigneeId, overrideExisting, importLast7Days } = body

    if (!csvText) return NextResponse.json({ error: 'No CSV data provided' }, { status: 400 })
    if (!emailAccountId) return NextResponse.json({ error: 'emailAccountId is required' }, { status: 400 })

    const account = await prisma.emailAccount.findUnique({ where: { id: emailAccountId } })
    if (!account) return NextResponse.json({ error: 'Email account not found' }, { status: 404 })

    const since = importLast7Days ? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) : null

    let { rows } = parseCSV(csvText)
    if (rows.length === 0) return NextResponse.json({ error: 'CSV is empty or has no data rows' }, { status: 400 })

    if (since) {
      rows = rows.filter(row => {
        const raw = row['Created time'] || row['Created Time'] || row['created_at'] || ''
        const d = raw ? new Date(raw.trim()) : null
        return d && !isNaN(d.getTime()) && d >= since
      })
    }

    const enc = new TextEncoder()
    const userId = session.user.id

    const stream = new ReadableStream({
      async start(controller) {
        const push = (obj: object) => {
          try { controller.enqueue(enc.encode(JSON.stringify(obj) + '\n')) } catch { /* closed */ }
        }

        try {
          push({ type: 'total', count: rows.length })
          const spamRules = await getActiveSpamRules()

          let imported = 0
          let skipped = 0
          const errors: string[] = []

          for (let i = 0; i < rows.length; i++) {
            const row = rows[i]
            const ticketId = row['Ticket ID'] || row['ticket_id'] || row['id'] || ''
            const subject   = row['Subject'] || row['subject'] || '(no subject)'
            const statusRaw = row['Status'] || row['status'] || 'Open'
            const priorityRaw = row['Priority'] || row['priority'] || 'Medium'
            const createdRaw  = row['Created time'] || row['created_at'] || row['Created Time'] || ''
            const resolvedRaw = row['Resolved time'] || row['Resolved Time'] || ''
            const closedRaw   = row['Closed time'] || row['Closed Time'] || ''
            const tagsRaw     = row['Tags'] || row['tags'] || ''
            const fromName    = row['Full name'] || row['full_name'] || row['Name'] || null
            const fromEmail   = row['Email'] || row['email'] || ''
            const phone       = row['Work phone'] || row['work_phone'] || ''
            const twitterId   = row['Twitter ID'] || row['twitter_id'] || ''
            const facebookId  = row['Facebook ID'] || row['facebook_id'] || ''
            const contactExtId = row['Contact ID'] || row['contact_id'] || ''

            if (!fromEmail) {
              errors.push(`Row ${i + 2}: missing Email — skipped`)
              push({ type: 'progress', done: i + 1, total: rows.length })
              continue
            }

            const externalId = ticketId ? `freshdesk-csv-${ticketId}` : null
            const status = mapStatus(statusRaw)
            const priority = mapPriority(priorityRaw)
            const createdAt = parseDate(createdRaw) ?? new Date()
            const resolvedRawDate = resolvedRaw || closedRaw
            const resolvedAt = parseDate(resolvedRawDate) ?? ((['RESOLVED', 'CLOSED'].includes(status)) ? new Date() : null)
            const tags = tagsRaw ? tagsRaw.split(',').map(t => t.trim()).filter(Boolean) : []

            try {
              // Upsert contact
              let contactId: string | null = null
              const emailLower = fromEmail.toLowerCase()
              try {
                const contact = await prisma.contact.upsert({
                  where: { email: emailLower },
                  update: {
                    name: fromName || undefined,
                    phone: phone || undefined,
                    twitterId: twitterId || undefined,
                    facebookId: facebookId || undefined,
                    externalId: contactExtId || undefined,
                  },
                  create: {
                    email: emailLower,
                    name: fromName || null,
                    phone: phone || null,
                    twitterId: twitterId || null,
                    facebookId: facebookId || null,
                    externalId: contactExtId || null,
                  },
                })
                contactId = contact.id
              } catch {
                // Contact upsert failed (e.g. duplicate email race) — continue without it
              }

              // Check for existing ticket by messageId
              const existing = externalId
                ? await prisma.ticket.findUnique({ where: { messageId: externalId } })
                : null

              if (existing && !overrideExisting) {
                skipped++
                push({ type: 'progress', done: i + 1, total: rows.length })
                continue
              }

              let dbTicketId: string

              if (existing && overrideExisting) {
                await prisma.ticket.update({
                  where: { id: existing.id },
                  data: { subject, status, priority, fromEmail: emailLower, fromName: fromName || null, tags, resolvedAt, contactId },
                })
                await prisma.message.deleteMany({ where: { ticketId: existing.id } })
                if (assigneeId) await prisma.ticketAssignee.deleteMany({ where: { ticketId: existing.id } })
                dbTicketId = existing.id
              } else {
                const spamCheck = checkIsSpam(spamRules, subject, emailLower, fromName, '')
                const effectiveStatus = spamCheck.isSpam ? 'SPAM' : status

                const ticket = await prisma.ticket.create({
                  data: {
                    subject,
                    status: effectiveStatus,
                    priority,
                    fromEmail: emailLower,
                    fromName: fromName || null,
                    messageId: externalId,
                    tags,
                    emailAccountId,
                    importSource: 'freshdesk-csv',
                    contactId,
                    createdAt,
                    resolvedAt: effectiveStatus !== 'SPAM' ? resolvedAt : null,
                  },
                })
                dbTicketId = ticket.id
              }

              // Create an informational note — CSV exports don't include message bodies
              await prisma.message.create({
                data: {
                  ticketId: dbTicketId,
                  body: 'This ticket was imported from a Freshdesk CSV export. Full conversation history is not available in CSV exports.\n\nTo import complete reply threads, use the API Import option instead.',
                  htmlBody: '<p style="color:#6b7280;font-style:italic;">This ticket was imported from a Freshdesk CSV export. Full conversation history is not available in CSV exports.</p><p style="color:#6b7280;">To import complete reply threads, use the <strong>API Import</strong> option instead.</p>',
                  fromEmail: emailLower,
                  fromName: fromName || null,
                  isIncoming: true,
                  createdAt,
                },
              })

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
                  metadata: { source: 'freshdesk-csv', externalId },
                },
              })

              imported++
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err)
              errors.push(`Row ${i + 2} (${subject}): ${msg}`)
            }

            push({ type: 'progress', done: i + 1, total: rows.length })
          }

          push({ type: 'done', imported, skipped, errors })
        } catch (err) {
          const message = err instanceof Error ? err.message : 'CSV import failed'
          console.error('CSV import error:', err)
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
    const message = err instanceof Error ? err.message : 'CSV import failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
