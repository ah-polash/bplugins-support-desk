import type { ImportTicket, ImportMessage, HelpScoutCredentials } from './types'

const BASE = 'https://api.helpscout.net/v2'

async function getToken(creds: HelpScoutCredentials): Promise<string> {
  const res = await fetch(`${BASE}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: creds.appId,
      client_secret: creds.appSecret,
    }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`HelpScout auth failed: ${res.status} ${body}`)
  }
  const data = await res.json()
  return data.access_token as string
}

function mapStatus(hs: string): ImportTicket['status'] {
  if (hs === 'pending') return 'PENDING'
  if (hs === 'closed') return 'CLOSED'
  return 'OPEN'
}

// Fetch all pages of conversations
async function fetchConversations(token: string): Promise<unknown[]> {
  const all: unknown[] = []
  let page = 1
  let totalPages = 1

  while (page <= totalPages) {
    const res = await fetch(
      `${BASE}/conversations?status=all&page=${page}&sortField=createdAt&sortOrder=asc`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
    if (!res.ok) throw new Error(`HelpScout conversations fetch failed: ${res.status}`)
    const data = await res.json()
    const convs = data._embedded?.conversations ?? []
    all.push(...convs)
    totalPages = data.page?.totalPages ?? 1
    page++
  }
  return all
}

// Fetch threads for a single conversation
async function fetchThreads(token: string, convId: number): Promise<unknown[]> {
  const all: unknown[] = []
  let page = 1
  let totalPages = 1

  while (page <= totalPages) {
    const res = await fetch(
      `${BASE}/conversations/${convId}/threads?page=${page}`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
    if (!res.ok) return all  // non-fatal: return what we have
    const data = await res.json()
    const threads = data._embedded?.threads ?? []
    all.push(...threads)
    totalPages = data.page?.totalPages ?? 1
    page++
  }
  return all
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function threadToMessage(thread: any): ImportMessage | null {
  // Skip internal notes and system line items
  if (thread.type === 'note' || thread.type === 'lineitem') return null
  const body: string = thread.body ?? ''
  const isIncoming = thread.type === 'customer'
  const customer = thread.customer ?? thread.createdBy ?? {}
  const fromEmail: string =
    (isIncoming ? customer.email : (thread.createdBy?.email ?? 'support@unknown.com')) ?? 'unknown@unknown.com'
  const fromName: string | null =
    (isIncoming
      ? [customer.first, customer.last].filter(Boolean).join(' ') || null
      : null)

  return {
    body: body.replace(/<[^>]+>/g, '').trim() || body,
    htmlBody: body || null,
    fromEmail,
    fromName,
    isIncoming,
    createdAt: new Date(thread.createdAt ?? Date.now()),
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function conversationToTicket(conv: any, threads: any[]): ImportTicket {
  const customer = conv.primaryCustomer ?? conv.createdBy ?? {}
  const fromEmail: string = customer.email ?? 'unknown@unknown.com'
  const fromName: string | null =
    [customer.first, customer.last].filter(Boolean).join(' ') || null

  const messages = threads
    .map(threadToMessage)
    .filter((m): m is ImportMessage => m !== null)

  // Ensure at least one message using the conversation preview
  if (messages.length === 0) {
    messages.push({
      body: conv.preview ?? '(no content)',
      htmlBody: null,
      fromEmail,
      fromName,
      isIncoming: true,
      createdAt: new Date(conv.createdAt ?? Date.now()),
    })
  }

  return {
    externalId: `helpscout-${conv.id}`,
    subject: conv.subject ?? '(no subject)',
    status: mapStatus(conv.status),
    priority: 'MEDIUM',
    fromEmail,
    fromName,
    tags: (conv.tags ?? []).map((t: { tag: string }) => t.tag),
    createdAt: new Date(conv.createdAt ?? Date.now()),
    messages,
  }
}

export async function testHelpScout(creds: HelpScoutCredentials): Promise<void> {
  const token = await getToken(creds)
  const res = await fetch(`${BASE}/conversations?status=all&page=1`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`HelpScout test failed: ${res.status}`)
}

export async function fetchHelpScoutTickets(creds: HelpScoutCredentials): Promise<ImportTicket[]> {
  const token = await getToken(creds)
  const conversations = await fetchConversations(token)

  const tickets: ImportTicket[] = []
  for (const conv of conversations) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = conv as any
    const threads = await fetchThreads(token, c.id)
    tickets.push(conversationToTicket(c, threads))
  }
  return tickets
}
