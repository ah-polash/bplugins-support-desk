'use client'
import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { StatusBadge, PriorityBadge } from '@/components/ui/Badge'
import { timeAgo, stripHtml, getInitials, cn } from '@/lib/utils'
import { Paperclip, Settings2, Check } from 'lucide-react'

interface Assignee {
  user: { id: string; name: string; email: string }
}

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
  assignees?: Assignee[]
  _count?: { messages: number; attachments: number }
  messages?: Array<{ body: string; createdAt: string; isIncoming: boolean }>
}

interface TicketListProps {
  tickets: Ticket[]
  loading?: boolean
  activeId?: string
  selectedIds?: Set<string>
  onToggleSelect?: (id: string) => void
  onToggleAll?: (allIds: string[]) => void
  onTagClick?: (tag: string) => void
}

const TOGGLEABLE_COLS = [
  { key: 'status',    label: 'Status' },
  { key: 'priority',  label: 'Priority' },
  { key: 'tags',      label: 'Tags' },
  { key: 'assignee',  label: 'Assignee' },
  { key: 'messages',  label: 'Messages' },
  { key: 'updated',   label: 'Last Updated' },
  { key: 'email',     label: 'Email' },
]

const LS_KEY = 'tickets:hidden_cols'

function getHidden(): Set<string> {
  if (typeof window === 'undefined') return new Set()
  try {
    const raw = localStorage.getItem(LS_KEY)
    return raw ? new Set(JSON.parse(raw)) : new Set()
  } catch { return new Set() }
}

function saveHidden(hidden: Set<string>) {
  localStorage.setItem(LS_KEY, JSON.stringify(Array.from(hidden)))
}

export default function TicketList({ tickets, loading, activeId, selectedIds, onToggleSelect, onToggleAll, onTagClick }: TicketListProps) {
  const selectable = !!selectedIds && !!onToggleSelect
  const [hidden, setHidden] = useState<Set<string>>(getHidden)
  const [colMenuOpen, setColMenuOpen] = useState(false)
  const colMenuRef = useRef<HTMLDivElement>(null)

  const isVisible = (key: string) => !hidden.has(key)

  const toggleCol = (key: string) => {
    setHidden((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      saveHidden(next)
      return next
    })
  }

  // Close column menu on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (colMenuRef.current && !colMenuRef.current.contains(e.target as Node)) {
        setColMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const allIds = tickets.map((t) => t.id)
  const allSelected = allIds.length > 0 && allIds.every((id) => selectedIds?.has(id))

  if (loading) {
    return (
      <div className="w-full overflow-x-auto">
        <table className="w-full text-sm">
          <tbody>
            {Array.from({ length: 8 }).map((_, i) => (
              <tr key={i} className="border-b border-gray-100 dark:border-gray-700/60">
                <td className="px-4 py-3"><div className="h-4 w-32 animate-pulse rounded bg-gray-200 dark:bg-gray-700" /></td>
                <td className="px-4 py-3"><div className="h-4 w-64 animate-pulse rounded bg-gray-200 dark:bg-gray-700" /></td>
                <td className="px-4 py-3"><div className="h-4 w-16 animate-pulse rounded bg-gray-200 dark:bg-gray-700" /></td>
                <td className="px-4 py-3"><div className="h-4 w-16 animate-pulse rounded bg-gray-200 dark:bg-gray-700" /></td>
                <td className="px-4 py-3"><div className="h-4 w-20 animate-pulse rounded bg-gray-200 dark:bg-gray-700" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  if (!tickets.length) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-gray-400">
        <p className="text-sm">No tickets found</p>
      </div>
    )
  }

  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60">
            {selectable && (
              <th className="w-10 px-4 py-2.5">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-gray-300 text-indigo-600"
                  checked={allSelected}
                  onChange={() => onToggleAll?.(allIds)}
                />
              </th>
            )}
            <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider w-44">
              Customer
            </th>
            <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              Conversation
            </th>
            {isVisible('status') && (
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider w-24">Status</th>
            )}
            {isVisible('priority') && (
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider w-24">Priority</th>
            )}
            {isVisible('tags') && (
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider w-40">Tags</th>
            )}
            {isVisible('assignee') && (
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider w-28">Assignee</th>
            )}
            {isVisible('messages') && (
              <th className="px-4 py-2.5 text-center text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider w-20">Msgs</th>
            )}
            {isVisible('updated') && (
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider w-32">Updated</th>
            )}
            {isVisible('email') && (
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider w-44">Email</th>
            )}
            {/* Column toggle */}
            <th className="w-10 px-2 py-2.5 text-right">
              <div ref={colMenuRef} className="relative inline-block">
                <button
                  onClick={() => setColMenuOpen((v) => !v)}
                  title="Show/hide columns"
                  className="rounded p-1 text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                >
                  <Settings2 className="h-3.5 w-3.5" />
                </button>
                {colMenuOpen && (
                  <div className="absolute right-0 top-full z-50 mt-1 w-44 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg py-1">
                    <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">Columns</p>
                    {TOGGLEABLE_COLS.map((col) => (
                      <button
                        key={col.key}
                        onClick={() => toggleCol(col.key)}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                      >
                        <span className={cn(
                          'flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors',
                          isVisible(col.key)
                            ? 'border-indigo-500 bg-indigo-500 text-white'
                            : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800'
                        )}>
                          {isVisible(col.key) && <Check className="h-2.5 w-2.5" />}
                        </span>
                        {col.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-700/60">
          {tickets.map((ticket) => {
            const lastMsg = ticket.messages?.[0]
            const preview = lastMsg ? stripHtml(lastMsg.body).slice(0, 90) : ''
            const isActive = ticket.id === activeId
            const isSelected = selectedIds?.has(ticket.id)
            const initials = getInitials(ticket.fromName || ticket.fromEmail)

            return (
              <tr
                key={ticket.id}
                className={cn(
                  'group transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/50',
                  isActive && 'bg-indigo-50 dark:bg-indigo-900/20',
                  isSelected && !isActive && 'bg-indigo-50/60 dark:bg-indigo-900/10'
                )}
              >
                {selectable && (
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-gray-300 text-indigo-600"
                      checked={!!isSelected}
                      onChange={() => onToggleSelect(ticket.id)}
                    />
                  </td>
                )}

                {/* Customer */}
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2.5">
                    <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-100 dark:bg-indigo-900/50 text-xs font-semibold text-indigo-700 dark:text-indigo-300">
                      {initials}
                    </span>
                    <span className="truncate max-w-[110px] text-xs font-medium text-gray-800 dark:text-gray-200" title={ticket.fromName || ticket.fromEmail}>
                      {ticket.fromName || ticket.fromEmail}
                    </span>
                  </div>
                </td>

                {/* Conversation */}
                <td className="px-4 py-3">
                  <Link href={`/tickets/${ticket.ticketNumber}`} className="block group/link">
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium text-gray-900 dark:text-gray-100 group-hover/link:text-indigo-600 dark:group-hover/link:text-indigo-400 transition-colors line-clamp-1">
                        {ticket.subject}
                      </span>
                      {ticket._count?.attachments ? <Paperclip className="h-3 w-3 shrink-0 text-gray-400" /> : null}
                      {ticket.importSource && (
                        <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300">
                          imported
                        </span>
                      )}
                    </div>
                    {preview && (
                      <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-500 line-clamp-1">{preview}</p>
                    )}
                  </Link>
                </td>

                {/* Status */}
                {isVisible('status') && (
                  <td className="px-4 py-3">
                    <StatusBadge status={ticket.status} />
                  </td>
                )}

                {/* Priority */}
                {isVisible('priority') && (
                  <td className="px-4 py-3">
                    <PriorityBadge priority={ticket.priority} />
                  </td>
                )}

                {/* Tags */}
                {isVisible('tags') && (
                  <td className="px-4 py-3">
                    {ticket.tags && ticket.tags.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {ticket.tags.slice(0, 3).map(tag => (
                          <button
                            key={tag}
                            onClick={() => onTagClick?.(tag)}
                            className="rounded-full bg-indigo-50 dark:bg-indigo-900/30 px-2 py-0.5 text-[10px] font-medium text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 transition-colors"
                          >
                            {tag}
                          </button>
                        ))}
                        {ticket.tags.length > 3 && (
                          <span className="text-[10px] text-gray-400">+{ticket.tags.length - 3}</span>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-gray-400">—</span>
                    )}
                  </td>
                )}

                {/* Assignee */}
                {isVisible('assignee') && (
                  <td className="px-4 py-3">
                    {ticket.assignees && ticket.assignees.length > 0 ? (
                      <div className="flex -space-x-1.5">
                        {ticket.assignees.slice(0, 3).map(({ user }) => (
                          <span key={user.id} title={user.name}
                            className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-gray-200 dark:bg-gray-700 text-xs font-medium text-gray-600 dark:text-gray-300 ring-1.5 ring-white dark:ring-gray-900">
                            {getInitials(user.name)}
                          </span>
                        ))}
                        {ticket.assignees.length > 3 && (
                          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-800 text-xs text-gray-500 ring-1.5 ring-white dark:ring-gray-900">
                            +{ticket.assignees.length - 3}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-gray-400">—</span>
                    )}
                  </td>
                )}

                {/* Messages */}
                {isVisible('messages') && (
                  <td className="px-4 py-3 text-center">
                    {ticket._count?.messages ? (
                      <span className="inline-flex items-center justify-center min-w-[1.5rem] rounded-full bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 text-xs font-medium text-gray-600 dark:text-gray-300">
                        {ticket._count.messages}
                      </span>
                    ) : (
                      <span className="text-xs text-gray-400">—</span>
                    )}
                  </td>
                )}

                {/* Last Updated */}
                {isVisible('updated') && (
                  <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                    {timeAgo(ticket.updatedAt)}
                  </td>
                )}

                {/* Email */}
                {isVisible('email') && (
                  <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400 truncate max-w-[160px]" title={ticket.fromEmail}>
                    {ticket.fromEmail}
                  </td>
                )}

                <td />
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
