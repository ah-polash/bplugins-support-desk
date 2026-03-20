'use client'
import { useEffect, useState, useCallback, useRef } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import Header from '@/components/layout/Header'
import TicketList from '@/components/tickets/TicketList'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import toast from 'react-hot-toast'
import { Trash2, ShieldOff, AlertTriangle } from 'lucide-react'

interface Ticket {
  id: string
  ticketNumber: number
  subject: string
  fromEmail: string
  fromName?: string
  status: string
  priority: string
  updatedAt: string
  tags?: string[]
  importSource?: string | null
  assignees: Array<{ user: { id: string; name: string; email: string } }>
  _count?: { messages: number; attachments: number }
  messages?: Array<{ body: string; createdAt: string; isIncoming: boolean }>
}

const POLL_INTERVAL = 30 * 1000

export default function SpamPage() {
  const { data: session, status } = useSession()
  const router = useRouter()

  const [tickets, setTickets] = useState<Ticket[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState<number>(() => {
    if (typeof window === 'undefined') return 25
    return parseInt(localStorage.getItem('spam:limit') ?? '25', 10) || 25
  })
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulking, setBulking] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [deleteAllConfirmOpen, setDeleteAllConfirmOpen] = useState(false)
  const [deletingAll, setDeletingAll] = useState(false)
  const intervalRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    const role = session?.user?.role
    if (status === 'authenticated' && role !== 'SUPPORT_ADMIN' && role !== 'SUPER_ADMIN') {
      router.replace('/inbox')
    }
  }, [status, session, router])

  const fetchTickets = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(limit), status: 'SPAM' })
      if (search) params.set('search', search)
      const res = await fetch(`/api/tickets?${params}`)
      const data = await res.json()
      setTickets(data.tickets || [])
      setTotal(data.total || 0)
    } catch {
      // ignore
    } finally {
      if (!silent) setLoading(false)
    }
  }, [search, page, limit])

  useEffect(() => {
    const t = setTimeout(() => fetchTickets(), 300)
    return () => clearTimeout(t)
  }, [fetchTickets])

  useEffect(() => {
    intervalRef.current = setInterval(() => fetchTickets(true), POLL_INTERVAL)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [fetchTickets])

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

  const totalPages = Math.ceil(total / limit)

  const deleteAllSpam = async () => {
    setDeletingAll(true)
    try {
      const res = await fetch('/api/admin/danger/delete-all-spam', { method: 'POST' })
      if (!res.ok) throw new Error()
      const data = await res.json()
      toast.success(`Deleted ${data.count} spam ticket(s)`)
      setSelectedIds(new Set())
      await fetchTickets()
    } catch {
      toast.error('Failed to delete spam tickets')
    } finally {
      setDeletingAll(false)
      setDeleteAllConfirmOpen(false)
    }
  }

  const handleLimitChange = (newLimit: number) => {
    setLimit(newLimit)
    localStorage.setItem('spam:limit', String(newLimit))
    setPage(1)
  }

  return (
    <div className="flex h-full flex-col">
      <Header title={`Spam Folder (${total})`} onSearch={setSearch} />

      {/* Info banner */}
      <div className="flex items-center justify-between gap-3 border-b border-gray-200 dark:border-gray-700 bg-yellow-50 dark:bg-yellow-900/20 px-6 py-2.5">
        <div className="flex items-start gap-3">
          <AlertTriangle className="h-4 w-4 shrink-0 text-yellow-600 dark:text-yellow-400 mt-0.5" />
          <p className="text-xs text-yellow-700 dark:text-yellow-300">
            <span className="font-medium">These tickets were filtered by your spam rules.</span>
            {' '}Mark as &quot;Not Spam&quot; to restore to Open, or delete permanently.
          </p>
        </div>
        {total > 0 && (
          <button
            onClick={() => setDeleteAllConfirmOpen(true)}
            className="shrink-0 rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 transition-colors flex items-center gap-1.5"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete all spam messages now
          </button>
        )}
      </div>

      {/* Bulk action toolbar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 border-b border-indigo-200 dark:border-indigo-700 bg-indigo-50 dark:bg-indigo-900/20 px-6 py-2">
          <span className="text-sm font-medium text-indigo-700 dark:text-indigo-300">{selectedIds.size} selected</span>
          <div className="flex items-center gap-2">
            <button disabled={bulking} onClick={() => bulkAction('status', 'OPEN')}
              className="rounded-md bg-green-100 dark:bg-green-900/30 px-3 py-1 text-xs font-medium text-green-700 dark:text-green-400 hover:bg-green-200 disabled:opacity-50 flex items-center gap-1">
              <ShieldOff className="h-3 w-3" />
              Not Spam
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

      <div className="flex items-center justify-between gap-4 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-2.5">
        {/* Per-page selector */}
        <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
          <span>Showing</span>
          <div className="relative">
            <select
              value={limit}
              onChange={e => handleLimitChange(Number(e.target.value))}
              className="appearance-none rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 pl-2 pr-6 py-1 text-xs text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer"
            >
              {[25, 50, 100, 200, 500].map(n => (
                <option key={n} value={n}>{n} / page</option>
              ))}
            </select>
            <span className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400">▾</span>
          </div>
          <span className="text-gray-400">of {total}</span>
        </div>

        {/* Page navigation */}
        {totalPages > 1 && (
          <div className="flex items-center gap-1">
            <button onClick={() => setPage(1)} disabled={page === 1}
              className="rounded border border-gray-300 dark:border-gray-600 px-2 py-1 text-xs text-gray-700 dark:text-gray-300 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-800">«</button>
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
              className="rounded border border-gray-300 dark:border-gray-600 px-2.5 py-1 text-xs text-gray-700 dark:text-gray-300 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-800">‹</button>

            {Array.from({ length: Math.min(7, totalPages) }, (_, i) => {
              let p: number
              if (totalPages <= 7) {
                p = i + 1
              } else if (page <= 4) {
                p = i < 5 ? i + 1 : i === 5 ? -1 : totalPages
              } else if (page >= totalPages - 3) {
                p = i === 0 ? 1 : i === 1 ? -1 : totalPages - 6 + i
              } else {
                p = i === 0 ? 1 : i === 1 ? -1 : i === 5 ? -2 : i === 6 ? totalPages : page + i - 3
              }
              if (p < 0) return <span key={`ellipsis-${i}`} className="px-1 text-xs text-gray-400">…</span>
              return (
                <button key={p} onClick={() => setPage(p)} disabled={page === p}
                  className={`rounded border px-2.5 py-1 text-xs transition-colors ${page === p ? 'border-indigo-500 bg-indigo-600 text-white' : 'border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-40'}`}>
                  {p}
                </button>
              )
            })}

            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
              className="rounded border border-gray-300 dark:border-gray-600 px-2.5 py-1 text-xs text-gray-700 dark:text-gray-300 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-800">›</button>
            <button onClick={() => setPage(totalPages)} disabled={page === totalPages}
              className="rounded border border-gray-300 dark:border-gray-600 px-2 py-1 text-xs text-gray-700 dark:text-gray-300 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-800">»</button>
          </div>
        )}
      </div>

      <ConfirmModal
        open={deleteConfirmOpen}
        onClose={() => setDeleteConfirmOpen(false)}
        onConfirm={() => bulkAction('delete')}
        title={`Delete ${selectedIds.size} Spam Ticket${selectedIds.size !== 1 ? 's' : ''}`}
        message={`Permanently delete ${selectedIds.size} selected spam ticket${selectedIds.size !== 1 ? 's' : ''}? This cannot be undone.`}
        confirmLabel={`Delete ${selectedIds.size} Ticket${selectedIds.size !== 1 ? 's' : ''}`}
        loading={bulking}
      />

      <ConfirmModal
        open={deleteAllConfirmOpen}
        onClose={() => setDeleteAllConfirmOpen(false)}
        onConfirm={deleteAllSpam}
        title="Delete All Spam Tickets"
        message={`Permanently delete all ${total} spam ticket${total !== 1 ? 's' : ''}? This cannot be undone.`}
        confirmLabel={`Delete All ${total} Spam Ticket${total !== 1 ? 's' : ''}`}
        loading={deletingAll}
      />
    </div>
  )
}
