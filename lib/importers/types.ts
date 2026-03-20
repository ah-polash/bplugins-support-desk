export interface ImportTicket {
  externalId: string          // e.g. "helpscout-123" or "freshdesk-456" used for dedup
  subject: string
  status: 'OPEN' | 'PENDING' | 'RESOLVED' | 'CLOSED'
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'
  fromEmail: string
  fromName: string | null
  tags: string[]
  createdAt: Date
  messages: ImportMessage[]
}

export interface ImportMessage {
  body: string
  htmlBody: string | null
  fromEmail: string
  fromName: string | null
  isIncoming: boolean
  createdAt: Date
}

export interface ImportResult {
  imported: number
  skipped: number   // duplicates
  errors: string[]
}

export interface HelpScoutCredentials {
  appId: string
  appSecret: string
}

export interface FreshdeskCredentials {
  domain: string     // e.g. "mycompany" (without .freshdesk.com)
  apiKey: string
}
