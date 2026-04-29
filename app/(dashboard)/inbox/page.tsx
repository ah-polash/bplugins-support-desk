'use client'
import { useEffect, useState, useCallback, useRef } from 'react'
import { useSession } from 'next-auth/react'
import Header from '@/components/layout/Header'
import TicketList from '@/components/tickets/TicketList'
import { CheckCircle } from 'lucide-react'

interface Ticket {
  id: string
  ticketNumber: number
  subject: string
  fromEmail: string
  fromName?: string
  status: string
  priority: string
  updatedAt: string
  assignees: Array<{ user: { id: string; name: string; email: string } }>
  _count?: { messages: number; attachments: number }
  messages?: Array<{ body: string; createdAt: string; isIncoming: boolean }>
}

const POLL_INTERVAL = 30 * 1000 // 30 seconds

export default function InboxPage() {
  const { data: session } = useSession()
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const intervalRef = useRef<NodeJS.Timeout | null>(null)

  const fetchTickets = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      // My Inbox = OPEN tickets assigned to me
      const res = await fetch('/api/tickets?myInbox=true')
      if (!res.ok) return
      const data = await res.json()
      setTickets(data.tickets || [])
      setTotal(data.total || 0)
    } catch {
      // ignore
    } finally {
      if (!silent) setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchTickets()
    // Auto-refresh every 30 seconds
    intervalRef.current = setInterval(() => fetchTickets(true), POLL_INTERVAL)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [fetchTickets])

  const title = `My Inbox${total > 0 ? ` (${total})` : ''}`

  return (
    <div className="flex h-full flex-col">
      <Header title={title} showSync onSynced={() => fetchTickets()} onCreated={() => fetchTickets()} />
      <div className="flex-1 overflow-y-auto">
        {!loading && tickets.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-32 text-gray-400">
            <CheckCircle className="h-12 w-12 text-green-400" />
            <div className="text-center">
              <p className="font-medium text-gray-600 dark:text-gray-300">All caught up!</p>
              <p className="text-sm">No open tickets assigned to you.</p>
            </div>
          </div>
        ) : (
          <TicketList tickets={tickets} loading={loading} />
        )}
      </div>
    </div>
  )
}
