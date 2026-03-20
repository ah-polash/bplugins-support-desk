'use client'
import { useEffect, useState, useCallback, useRef } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import Header from '@/components/layout/Header'
import TicketList from '@/components/tickets/TicketList'
import { Select } from '@/components/ui/Input'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import toast from 'react-hot-toast'
import { Trash2 } from 'lucide-react'

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

const POLL_INTERVAL = 30 * 1000

export default function OthersTicketsPage() {
  const { data: session, status: sessionStatus } = useSession()
  const router = useRouter()
  const role = session?.user?.role
  const isAdmin = role === 'SUPPORT_ADMIN' || role === 'SUPER_ADMIN'

  const [tickets, setTickets] = useState<Ticket[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [priority, setPriority] = useState('')
  const [page, setPage] = useState(1)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulking, setBulking] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const intervalRef = useRef<NodeJS.Timeout | null>(null)

  // Redirect non-admins away
  useEffect(() => {
    if (sessionStatus === 'authenticated' && !isAdmin) router.replace('/inbox')
  }, [sessionStatus, isAdmin, router])

  const fetchTickets = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const params = new URLSearchParams({ page: String(page), limit: '25', othersTickets: 'true' })
      if (search) params.set('search', search)
      if (status) params.set('status', status)
      if (priority) params.set('priority', priority)
      const res = await fetch(`/api/tickets?${params}`)
      const data = await res.json()
      setTickets(data.tickets || [])
      setTotal(data.total || 0)
    } catch {
      // ignore
    } finally {
      if (!silent) setLoading(false)
    }
  }, [search, status, priority, page])

  useEffect(() => {
    if (!isAdmin) return
    const t = setTimeout(() => fetchTickets(), 300)
    return () => clearTimeout(t)
  }, [fetchTickets, isAdmin])

  useEffect(() => {
    if (!isAdmin) return
    intervalRef.current = setInterval(() => fetchTickets(true), POLL_INTERVAL)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [fetchTickets, isAdmin])

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const toggleAll = (allIds: string[]) => {
    setSelectedIds((prev) => {
      const allSelected = allIds.every((id) => prev.has(id))
      return allSelected ? new Set() : new Set(allIds)
    })
  }

  const bulkAction = async (action: string, value = '') => {
    if (selectedIds.size === 0) return
    setBulking(true)
    try {
      const res = await fetch('/api/tickets/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selectedIds), action, value }),
      })
      if (!res.ok) throw new Error('Bulk action failed')
      const data = await res.json()
      toast.success(action === 'delete' ? `Deleted ${data.count} ticket(s)` : `Updated ${data.count} ticket(s)`)
      setSelectedIds(new Set())
      await fetchTickets()
    } catch {
      toast.error('Bulk action failed')
    } finally {
      setBulking(false)
      setDeleteConfirmOpen(false)
    }
  }

  const totalPages = Math.ceil(total / 25)

  return (
    <div className="flex h-full flex-col">
      <Header title={`Others' Tickets (${total})`} onSearch={setSearch} showSync onSynced={() => fetchTickets()} />

      {/* Filters */}
      <div className="flex items-center gap-3 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-6 py-3">
        <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1) }} className="w-36 py-1.5 text-xs">
          <option value="">All Status</option>
          <option value="OPEN">Open</option>
          <option value="PENDING">Pending</option>
          <option value="RESOLVED">Resolved</option>
          <option value="CLOSED">Closed</option>
        </Select>
        <Select value={priority} onChange={(e) => { setPriority(e.target.value); setPage(1) }} className="w-36 py-1.5 text-xs">
          <option value="">All Priority</option>
          <option value="LOW">Low</option>
          <option value="MEDIUM">Medium</option>
          <option value="HIGH">High</option>
          <option value="URGENT">Urgent</option>
        </Select>
      </div>

      {/* Bulk action toolbar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 border-b border-indigo-200 dark:border-indigo-700 bg-indigo-50 dark:bg-indigo-900/20 px-6 py-2">
          <span className="text-sm font-medium text-indigo-700 dark:text-indigo-300">{selectedIds.size} selected</span>
          <div className="flex items-center gap-2">
            <button disabled={bulking} onClick={() => bulkAction('status', 'RESOLVED')}
              className="rounded-md bg-green-100 dark:bg-green-900/30 px-3 py-1 text-xs font-medium text-green-700 dark:text-green-400 hover:bg-green-200 disabled:opacity-50">
              Mark Resolved
            </button>
            <button disabled={bulking} onClick={() => bulkAction('status', 'CLOSED')}
              className="rounded-md bg-gray-100 dark:bg-gray-700 px-3 py-1 text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-200 disabled:opacity-50">
              Close
            </button>
            <button disabled={bulking} onClick={() => bulkAction('status', 'OPEN')}
              className="rounded-md bg-blue-100 dark:bg-blue-900/30 px-3 py-1 text-xs font-medium text-blue-700 dark:text-blue-400 hover:bg-blue-200 disabled:opacity-50">
              Reopen
            </button>
            <button disabled={bulking} onClick={() => setDeleteConfirmOpen(true)}
              className="rounded-md bg-red-100 dark:bg-red-900/30 px-3 py-1 text-xs font-medium text-red-700 dark:text-red-400 hover:bg-red-200 disabled:opacity-50 flex items-center gap-1">
              <Trash2 className="h-3 w-3" />Delete
            </button>
            <button onClick={() => setSelectedIds(new Set())} className="ml-1 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
              Clear
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        <TicketList
          tickets={tickets}
          loading={loading}
          selectedIds={selectedIds}
          onToggleSelect={toggleSelect}
          onToggleAll={toggleAll}
        />
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 py-3">
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}
            className="rounded border border-gray-300 dark:border-gray-600 px-3 py-1 text-sm text-gray-700 dark:text-gray-300 disabled:opacity-40">Prev</button>
          <span className="text-sm text-gray-600 dark:text-gray-400">Page {page} of {totalPages}</span>
          <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}
            className="rounded border border-gray-300 dark:border-gray-600 px-3 py-1 text-sm text-gray-700 dark:text-gray-300 disabled:opacity-40">Next</button>
        </div>
      )}

      <ConfirmModal
        open={deleteConfirmOpen}
        onClose={() => setDeleteConfirmOpen(false)}
        onConfirm={() => bulkAction('delete')}
        title={`Delete ${selectedIds.size} Ticket${selectedIds.size !== 1 ? 's' : ''}`}
        message={`Permanently delete ${selectedIds.size} selected ticket${selectedIds.size !== 1 ? 's' : ''}? All messages, notes, and attachments will be lost. This cannot be undone.`}
        confirmLabel={`Delete ${selectedIds.size} Ticket${selectedIds.size !== 1 ? 's' : ''}`}
        loading={bulking}
      />
    </div>
  )
}
