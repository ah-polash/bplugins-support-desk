'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { StatusBadge } from '@/components/ui/Badge'
import { timeAgo } from '@/lib/utils'

interface TicketSummary {
  id: string
  ticketNumber: number
  subject: string
  status: string
  createdAt: string
}

export default function CustomerHistory({ fromEmail, currentTicketId }: { fromEmail: string; currentTicketId: string }) {
  const [tickets, setTickets] = useState<TicketSummary[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch(`/api/tickets?fromEmail=${encodeURIComponent(fromEmail)}&limit=10`)
        const data = await res.json()
        setTickets((data.tickets || []).filter((t: TicketSummary) => t.id !== currentTicketId))
      } catch { /* ignore */ }
      finally { setLoading(false) }
    }
    load()
  }, [fromEmail, currentTicketId])

  if (loading) return <div className="h-12 animate-pulse rounded bg-gray-100 dark:bg-gray-700" />
  if (tickets.length === 0) return <p className="text-xs text-gray-400">No previous tickets.</p>

  return (
    <div className="flex flex-col gap-2">
      {tickets.map((t) => (
        <Link
          key={t.id}
          href={`/tickets/${t.ticketNumber}`}
          className="block rounded-md border border-gray-100 dark:border-gray-700 p-2 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
        >
          <p className="text-xs font-medium text-gray-700 dark:text-gray-300 line-clamp-1">{t.subject}</p>
          <div className="mt-1 flex items-center justify-between">
            <StatusBadge status={t.status} />
            <span className="text-xs text-gray-400">{timeAgo(t.createdAt)}</span>
          </div>
        </Link>
      ))}
    </div>
  )
}
