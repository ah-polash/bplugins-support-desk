/**
 * Freshdesk Full Export Script
 * ─────────────────────────────────────────────────────────────────────────────
 * Exports ALL tickets + conversation history from Freshdesk to a .ndjson file.
 * Each line is a self-contained JSON object with the ticket and all its messages.
 *
 * Usage:
 *   FRESHDESK_DOMAIN=yourcompany FRESHDESK_API_KEY=xxxx npx tsx scripts/export-freshdesk.ts
 *
 * Or add to .env:
 *   FRESHDESK_DOMAIN=yourcompany
 *   FRESHDESK_API_KEY=xxxx
 * Then run:
 *   npm run freshdesk:export
 *
 * Output:
 *   freshdesk-backup-YYYY-MM-DD.ndjson  (in project root)
 *
 * To import later (without Freshdesk API):
 *   npm run freshdesk:import -- freshdesk-backup-YYYY-MM-DD.ndjson
 */

import * as fs from 'fs'
import * as path from 'path'
import * as dotenv from 'dotenv'

// Load .env
dotenv.config({ path: path.join(__dirname, '../.env') })

const FRESHDESK_DOMAIN = process.env.FRESHDESK_DOMAIN || ''
const FRESHDESK_API_KEY = process.env.FRESHDESK_API_KEY || ''
const CONCURRENCY = 5

if (!FRESHDESK_DOMAIN || !FRESHDESK_API_KEY) {
  console.error('ERROR: Set FRESHDESK_DOMAIN and FRESHDESK_API_KEY in .env or environment')
  process.exit(1)
}

function baseUrl() {
  return `https://${FRESHDESK_DOMAIN}.freshdesk.com/api/v2`
}

function authHeader() {
  return 'Basic ' + Buffer.from(`${FRESHDESK_API_KEY}:X`).toString('base64')
}

async function freshdeskFetch(url: string): Promise<Response> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(url, { headers: { Authorization: authHeader() } })
    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get('Retry-After') ?? '60', 10)
      const wait = (isNaN(retryAfter) ? 60 : retryAfter) * 1000
      console.log(`\n  Rate limited. Waiting ${wait / 1000}s…`)
      await new Promise(r => setTimeout(r, wait))
      continue
    }
    return res
  }
  throw new Error('Rate limit exceeded after 6 retries')
}

async function fetchAllTickets(): Promise<unknown[]> {
  const all: unknown[] = []
  let page = 1
  while (true) {
    const url = `${baseUrl()}/tickets?include=requester,description&per_page=100&page=${page}&order_by=created_at&order_type=asc&updated_since=2010-01-01T00:00:00Z`
    const res = await freshdeskFetch(url)
    if (!res.ok) throw new Error(`Tickets fetch failed: ${res.status} ${await res.text()}`)
    const data = await res.json() as unknown[]
    if (!Array.isArray(data) || data.length === 0) break
    all.push(...data)
    const link = res.headers.get('Link') ?? ''
    if (!link.includes('rel="next"')) break
    page++
    process.stdout.write(`\r  Fetching ticket pages… page ${page} (${all.length} so far)`)
  }
  return all
}

async function fetchConversations(ticketId: number): Promise<unknown[]> {
  const res = await freshdeskFetch(`${baseUrl()}/tickets/${ticketId}/conversations`)
  if (!res.ok) return []
  const data = await res.json()
  return Array.isArray(data) ? data : []
}

// Process N tickets in parallel
async function processInBatches<T, R>(items: T[], concurrency: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = []
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency)
    const batchResults = await Promise.all(batch.map((item, j) => fn(item, i + j)))
    results.push(...batchResults)
  }
  return results
}

async function main() {
  const date = new Date().toISOString().slice(0, 10)
  const outputFile = path.join(__dirname, `../freshdesk-backup-${date}.ndjson`)

  console.log(`Freshdesk Full Export`)
  console.log(`Domain: ${FRESHDESK_DOMAIN}.freshdesk.com`)
  console.log(`Output: ${outputFile}`)
  console.log()

  // ── Step 1: Fetch all tickets ──────────────────────────────────────────────
  console.log('Step 1/2 — Fetching ticket list…')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawTickets = await fetchAllTickets() as any[]
  console.log(`\n  ✓ Found ${rawTickets.length} tickets`)
  console.log()

  // ── Step 2: Fetch conversations + write output ─────────────────────────────
  console.log('Step 2/2 — Fetching conversations & writing backup…')
  const writeStream = fs.createWriteStream(outputFile, { encoding: 'utf8' })
  let done = 0
  let errors = 0

  await processInBatches(rawTickets, CONCURRENCY, async (ticket) => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const conversations = await fetchConversations(ticket.id) as any[]

      // Build self-contained export record
      const record = {
        // Freshdesk ticket fields
        freshdeskId:    ticket.id,
        subject:        ticket.subject ?? '(no subject)',
        status:         ticket.status,
        priority:       ticket.priority,
        tags:           Array.isArray(ticket.tags) ? ticket.tags : [],
        createdAt:      ticket.created_at,
        resolvedAt:     ticket.stats?.resolved_at ?? null,
        closedAt:       ticket.stats?.closed_at ?? null,
        // Requester
        fromEmail:      ticket.requester?.email ?? ticket.email ?? 'unknown@unknown.com',
        fromName:       ticket.requester?.name ?? null,
        phone:          ticket.requester?.phone ?? null,
        // Description (first message)
        descriptionText: ticket.description_text ?? null,
        descriptionHtml: ticket.description ?? null,
        // Conversations (replies + notes)
        conversations: conversations.map(c => ({
          id:         c.id,
          body:       c.body_text ?? null,
          htmlBody:   c.body ?? null,
          fromEmail:  c.from_email ?? null,
          isIncoming: !!c.incoming,
          isPrivate:  !!c.private,
          createdAt:  c.created_at,
        })),
      }

      writeStream.write(JSON.stringify(record) + '\n')
      done++
      process.stdout.write(`\r  ${done}/${rawTickets.length} (${errors} errors)`)
    } catch (err) {
      errors++
      console.error(`\n  Error on ticket ${ticket.id}: ${err}`)
    }
  })

  await new Promise<void>((resolve, reject) => {
    writeStream.end((err: Error | null | undefined) => err ? reject(err) : resolve())
  })

  console.log()
  console.log()
  console.log(`✓ Export complete!`)
  console.log(`  Tickets exported: ${done}`)
  console.log(`  Errors:           ${errors}`)
  console.log(`  File:             ${outputFile}`)
  console.log()
  console.log('To import this backup into the system:')
  console.log(`  npm run freshdesk:import -- ${path.basename(outputFile)}`)
}

main().catch(err => {
  console.error('Export failed:', err)
  process.exit(1)
})
