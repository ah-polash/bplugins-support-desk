'use client'
import { useEffect, useState, useCallback, useRef } from 'react'
import { useSession } from 'next-auth/react'
import Header from '@/components/layout/Header'
import TicketList from '@/components/tickets/TicketList'
import { Select } from '@/components/ui/Input'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import toast from 'react-hot-toast'
import { Trash2, Tag, X } from 'lucide-react'

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

const POLL_INTERVAL = 30 * 1000 // 30 seconds

export default function AllTicketsPage() {
  const { data: session } = useSession()
  const role = session?.user?.role
  const isAdmin = role === 'SUPPORT_ADMIN' || role === 'SUPER_ADMIN'

  const [tickets, setTickets] = useState<Ticket[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [priority, setPriority] = useState('')
  const [tag, setTag] = useState('')
  const [tagInput, setTagInput] = useState('')
  const [replyFilter, setReplyFilter] = useState('')
  const [page, setPage] = useState(1)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulking, setBulking] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [hideClosed, setHideClosed] = useState(() => {
    if (typeof window === 'undefined') return false
    return localStorage.getItem('tickets:hideResolved') === 'true'
  })
  const [onlyMine, setOnlyMine] = useState(() => {
    if (typeof window === 'undefined') return false
    return localStorage.getItem('tickets:onlyMine') === 'true'
  })
  const [limit, setLimit] = useState<number>(() => {
    if (typeof window === 'undefined') return 25
    return parseInt(localStorage.getItem('tickets:limit') ?? '25', 10) || 25
  })
  const [sort, setSort] = useState<'created' | 'updated'>(() => {
    if (typeof window === 'undefined') return 'created'
    return localStorage.getItem('tickets:sort') === 'updated' ? 'updated' : 'created'
  })
  const intervalRef = useRef<NodeJS.Timeout | null>(null)

  const toggleHideClosed = () => {
    setHideClosed((prev) => {
      const next = !prev
      localStorage.setItem('tickets:hideResolved', String(next))
      setPage(1)
      return next
    })
  }

  const toggleOnlyMine = () => {
    setOnlyMine((prev) => {
      const next = !prev
      localStorage.setItem('tickets:onlyMine', String(next))
      setPage(1)
      return next
    })
  }

  const fetchTickets = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) })
      if (search) params.set('search', search)
      if (status) params.set('status', status)
      if (priority) params.set('priority', priority)
      if (tag) params.set('tag', tag)
      if (replyFilter) {
        // Format: "min-max", "min+", or "0"
        if (replyFilter === '0') {
          params.set('minReplies', '0')
          params.set('maxReplies', '0')
        } else if (replyFilter.endsWith('+')) {
          params.set('minReplies', replyFilter.slice(0, -1))
        } else if (replyFilter.includes('-')) {
          const [min, max] = replyFilter.split('-')
          params.set('minReplies', min)
          params.set('maxReplies', max)
        }
      }
      if (hideClosed) params.set('excludeStatus', 'RESOLVED')
      // Agents always see only their tickets; admins can opt-in with the checkbox
      if (!isAdmin || onlyMine) params.set('myTickets', 'true')
      params.set('sort', sort)
      const res = await fetch(`/api/tickets?${params}`)
      const data = await res.json()
      setTickets(data.tickets || [])
      setTotal(data.total || 0)
    } catch {
      // ignore
    } finally {
      if (!silent) setLoading(false)
    }
  }, [search, status, priority, tag, replyFilter, page, limit, isAdmin, hideClosed, onlyMine, sort])

  useEffect(() => {
    const t = setTimeout(() => fetchTickets(), 300)
    return () => clearTimeout(t)
  }, [fetchTickets])

  // Auto-refresh every 30s
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

  const handleLimitChange = (newLimit: number) => {
    setLimit(newLimit)
    localStorage.setItem('tickets:limit', String(newLimit))
    setPage(1)
  }
  const pageTitle = isAdmin ? `All Tickets (${total})` : `My Tickets (${total})`

  return (
    <div className="flex h-full flex-col">
      <Header title={pageTitle} onSearch={setSearch} showSync onSynced={() => fetchTickets()} onCreated={() => fetchTickets()} />

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
        <Select value={replyFilter} onChange={(e) => { setReplyFilter(e.target.value); setPage(1) }} className="w-36 py-1.5 text-xs">
          <option value="">All Replies</option>
          <option value="0">No replies</option>
          {Array.from({ length: 25 }, (_, i) => (
            <option key={i + 1} value={`${i + 1}-${i + 1}`}>{i + 1} {i + 1 === 1 ? 'reply' : 'replies'}</option>
          ))}
          <option value="26+">26+ replies</option>
        </Select>
        <Select
          value={sort}
          onChange={(e) => {
            const next = e.target.value === 'updated' ? 'updated' : 'created'
            setSort(next)
            localStorage.setItem('tickets:sort', next)
            setPage(1)
          }}
          className="w-44 py-1.5 text-xs"
        >
          <option value="created">Sort: Newest first</option>
          <option value="updated">Sort: Recently updated</option>
        </Select>
        {/* Tag filter */}
        <div className="flex items-center gap-1">
          {tag ? (
            <span className="flex items-center gap-1 rounded-full bg-indigo-100 dark:bg-indigo-900/40 pl-2 pr-1 py-0.5 text-xs font-medium text-indigo-700 dark:text-indigo-300">
              <Tag className="h-3 w-3" />{tag}
              <button onClick={() => { setTag(''); setTagInput(''); setPage(1) }} className="hover:text-indigo-900 dark:hover:text-indigo-100">
                <X className="h-3 w-3" />
              </button>
            </span>
          ) : (
            <div className="flex items-center gap-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1">
              <Tag className="h-3 w-3 text-gray-400" />
              <input
                value={tagInput}
                onChange={e => setTagInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && tagInput.trim()) { setTag(tagInput.trim().toLowerCase()); setPage(1) } }}
                placeholder="Filter by tag…"
                className="w-28 bg-transparent text-xs text-gray-700 dark:text-gray-300 placeholder-gray-400 focus:outline-none"
              />
            </div>
          )}
        </div>
        <label className="ml-2 flex items-center gap-2 cursor-pointer select-none text-xs text-gray-600 dark:text-gray-400">
          <input
            type="checkbox"
            checked={hideClosed}
            onChange={toggleHideClosed}
            className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
          />
          Hide Resolved
        </label>
        {isAdmin && (
          <label className="ml-2 flex items-center gap-2 cursor-pointer select-none text-xs text-gray-600 dark:text-gray-400">
            <input
              type="checkbox"
              checked={onlyMine}
              onChange={toggleOnlyMine}
              className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
            />
            Only My Tickets
          </label>
        )}
      </div>

      {/* Bulk action toolbar — admin only */}
      {isAdmin && selectedIds.size > 0 && (
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
          selectedIds={isAdmin ? selectedIds : undefined}
          onToggleSelect={isAdmin ? toggleSelect : undefined}
          onToggleAll={isAdmin ? toggleAll : undefined}
          onTagClick={(t) => { setTag(t); setTagInput(t); setPage(1) }}
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
        title={`Delete ${selectedIds.size} Ticket${selectedIds.size !== 1 ? 's' : ''}`}
        message={`Permanently delete ${selectedIds.size} selected ticket${selectedIds.size !== 1 ? 's' : ''}? All messages, notes, and attachments will be lost. This cannot be undone.`}
        confirmLabel={`Delete ${selectedIds.size} Ticket${selectedIds.size !== 1 ? 's' : ''}`}
        loading={bulking}
      />
    </div>
  )
}
