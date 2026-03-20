import type { ImportTicket, ImportMessage, FreshdeskCredentials } from './types'

function baseUrl(domain: string) {
  return `https://${domain}.freshdesk.com/api/v2`
}

function authHeader(apiKey: string): string {
  return 'Basic ' + Buffer.from(`${apiKey}:X`).toString('base64')
}

function mapStatus(s: number): ImportTicket['status'] {
  if (s === 3) return 'PENDING'
  if (s === 4) return 'RESOLVED'
  if (s === 5) return 'CLOSED'
  return 'OPEN'
}

function mapPriority(p: number): ImportTicket['priority'] {
  if (p === 1) return 'LOW'
  if (p === 3) return 'HIGH'
  if (p === 4) return 'URGENT'
  return 'MEDIUM'
}

// Fetch with automatic retry on Freshdesk rate limits (429)
async function freshdeskFetch(url: string, apiKey: string): Promise<Response> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(url, {
      headers: { Authorization: authHeader(apiKey) },
    })
    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get('Retry-After') ?? '60', 10)
      const waitMs = (isNaN(retryAfter) ? 60 : retryAfter) * 1000
      await new Promise(r => setTimeout(r, waitMs))
      continue
    }
    return res
  }
  throw new Error('Freshdesk rate limit exceeded after multiple retries')
}

// Fetch all ticket pages
export async function fetchAllTickets(creds: FreshdeskCredentials, since?: Date): Promise<unknown[]> {
  const all: unknown[] = []
  let page = 1
  const sinceStr = since ? since.toISOString().replace(/\.\d{3}Z$/, 'Z') : '2010-01-01T00:00:00Z'

  while (true) {
    // updated_since forces Freshdesk to return all tickets, not just the last 30 days (API default)
    const url = `${baseUrl(creds.domain)}/tickets?include=requester,description&per_page=100&page=${page}&order_by=created_at&order_type=asc&updated_since=${sinceStr}`
    const res = await freshdeskFetch(url, creds.apiKey)
    if (!res.ok) throw new Error(`Freshdesk tickets fetch failed: ${res.status}`)
    const data = await res.json()
    if (!Array.isArray(data) || data.length === 0) break
    all.push(...data)

    const link = res.headers.get('Link') ?? ''
    if (!link.includes('rel="next"')) break
    page++
  }

  return all
}

// Fetch conversations for a single ticket
export async function fetchConversations(creds: FreshdeskCredentials, ticketId: number): Promise<unknown[]> {
  const res = await freshdeskFetch(
    `${baseUrl(creds.domain)}/tickets/${ticketId}/conversations`,
    creds.apiKey
  )
  if (!res.ok) return []
  const data = await res.json()
  return Array.isArray(data) ? data : []
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function ticketToImport(ticket: any, conversations: any[]): ImportTicket {
  const fromEmail: string = ticket.requester?.email ?? ticket.email ?? 'unknown@unknown.com'
  const fromName: string | null = ticket.requester?.name ?? null

  const messages: ImportMessage[] = []

  // First message = original ticket description
  if (ticket.description_text || ticket.description) {
    messages.push({
      body: ticket.description_text ?? ticket.description?.replace(/<[^>]+>/g, '') ?? '',
      htmlBody: ticket.description ?? null,
      fromEmail,
      fromName,
      isIncoming: true,
      createdAt: new Date(ticket.created_at ?? Date.now()),
    })
  }

  // Subsequent messages = conversations (replies + notes)
  for (const conv of conversations) {
    // Skip private notes
    if (conv.private) continue

    const body: string = conv.body_text ?? conv.body?.replace(/<[^>]+>/g, '') ?? ''
    messages.push({
      body,
      htmlBody: conv.body ?? null,
      fromEmail: conv.from_email ?? (conv.incoming ? fromEmail : 'support@unknown.com'),
      fromName: null,
      isIncoming: !!conv.incoming,
      createdAt: new Date(conv.created_at ?? Date.now()),
    })
  }

  if (messages.length === 0) {
    messages.push({
      body: ticket.subject ?? '(no content)',
      htmlBody: null,
      fromEmail,
      fromName,
      isIncoming: true,
      createdAt: new Date(ticket.created_at ?? Date.now()),
    })
  }

  return {
    externalId: `freshdesk-${ticket.id}`,
    subject: ticket.subject ?? '(no subject)',
    status: mapStatus(ticket.status),
    priority: mapPriority(ticket.priority),
    fromEmail,
    fromName,
    tags: Array.isArray(ticket.tags) ? ticket.tags : [],
    createdAt: new Date(ticket.created_at ?? Date.now()),
    messages,
  }
}

export async function testFreshdesk(creds: FreshdeskCredentials): Promise<void> {
  const res = await freshdeskFetch(
    `${baseUrl(creds.domain)}/tickets?per_page=1&page=1`,
    creds.apiKey
  )
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Freshdesk connection failed: ${res.status} ${body}`)
  }
}

export async function fetchFreshdeskTickets(creds: FreshdeskCredentials): Promise<ImportTicket[]> {
  const raw = await fetchAllTickets(creds)
  const tickets: ImportTicket[] = []

  for (const t of raw) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ticket = t as any
    const conversations = await fetchConversations(creds, ticket.id)
    tickets.push(ticketToImport(ticket, conversations))
  }

  return tickets
}
