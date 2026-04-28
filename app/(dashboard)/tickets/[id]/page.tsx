'use client'
import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import MessageThread from '@/components/tickets/MessageThread'
import ReplyForm from '@/components/tickets/ReplyForm'
import NoteForm from '@/components/tickets/NoteForm'
import ActivityFeed from '@/components/tickets/ActivityFeed'
import AssignModal from '@/components/tickets/AssignModal'
import CustomerHistory from '@/components/tickets/CustomerHistory'
import { StatusBadge, PriorityBadge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Input'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { formatDate, getInitials, timeAgo } from '@/lib/utils'
import { ArrowLeft, UserPlus, CheckCircle, RotateCcw, Trash2, Tag, X as XIcon } from 'lucide-react'
import toast from 'react-hot-toast'
import Link from 'next/link'

interface Assignee {
  user: { id: string; name: string; email: string }
}

interface Ticket {
  id: string
  ticketNumber: number
  subject: string
  status: string
  priority: string
  fromEmail: string
  fromName?: string
  tags: string[]
  createdAt: string
  updatedAt: string
  resolvedAt?: string
  emailAccount: { id: string; name: string; email: string }
  assignees: Assignee[]
  messages: Array<{
    id: string; body: string; htmlBody?: string
    fromEmail: string; fromName?: string; isIncoming: boolean
    createdAt: string
    firstOpenedAt?: string | null; lastOpenedAt?: string | null; openCount?: number
    attachments: Array<{ id: string; filename: string; url: string; mimeType: string; size: number }>
  }>
  notes: Array<{ id: string; body: string; createdAt: string; user: { id: string; name: string } }>
  activities: Array<{ id: string; action: string; metadata?: Record<string, unknown>; createdAt: string; user?: { id: string; name: string } | null }>
}

export default function TicketDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { data: session } = useSession()
  const role = session?.user?.role
  const isAdmin = role === 'SUPPORT_ADMIN' || role === 'SUPER_ADMIN'

  const [ticket, setTicket] = useState<Ticket | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'reply' | 'note'>('reply')
  const [assignOpen, setAssignOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [changingStatus, setChangingStatus] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [tagInput, setTagInput] = useState('')
  const [topTags, setTopTags] = useState<{ tag: string; count: number }[]>([])

  const fetchTopTags = useCallback(async () => {
    try {
      const res = await fetch('/api/tags/top')
      if (res.ok) setTopTags(await res.json())
    } catch { /* ignore */ }
  }, [])

  const fetchTicket = useCallback(async () => {
    try {
      const res = await fetch(`/api/tickets/${id}`)
      if (!res.ok) { router.push('/inbox'); return }
      setTicket(await res.json())
    } catch {
      router.push('/inbox')
    } finally {
      setLoading(false)
    }
  }, [id, router])

  useEffect(() => { fetchTicket() }, [fetchTicket])
  useEffect(() => { fetchTopTags() }, [fetchTopTags])

  const deleteTicket = async () => {
    setDeleting(true)
    try {
      const res = await fetch(`/api/tickets/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error()
      toast.success('Ticket deleted')
      router.push('/tickets')
    } catch {
      toast.error('Failed to delete ticket')
      setDeleting(false)
      setDeleteOpen(false)
    }
  }

  const changeStatus = async (status: string) => {
    if (!ticket) return
    setChangingStatus(true)
    try {
      const res = await fetch(`/api/tickets/${id}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      if (!res.ok) throw new Error()
      toast.success(`Ticket marked as ${status.toLowerCase()}`)
      await fetchTicket()
    } catch {
      toast.error('Failed to change status')
    } finally {
      setChangingStatus(false)
    }
  }

  const updateTags = async (newTags: string[]) => {
    await fetch(`/api/tickets/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tags: newTags }),
    })
    await fetchTicket()
    await fetchTopTags()
  }

  const addTag = async () => {
    const tag = tagInput.trim().toLowerCase()
    if (!tag || ticket?.tags.includes(tag)) { setTagInput(''); return }
    await updateTags([...(ticket?.tags ?? []), tag])
    setTagInput('')
  }

  const removeTag = async (tag: string) => {
    await updateTags((ticket?.tags ?? []).filter(t => t !== tag))
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
      </div>
    )
  }

  if (!ticket) return null

  const canResolve = ticket.status === 'OPEN' || ticket.status === 'PENDING'
  const canReopen = ticket.status === 'RESOLVED' || ticket.status === 'CLOSED'
  const currentAgentIds = ticket.assignees.map(a => a.user.id)

  return (
    <div className="flex h-full">
      {/* Main Content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Ticket Header */}
        <div className="flex items-center gap-4 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-6 py-4">
          <Link href="/tickets" className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div className="flex-1 min-w-0">
            <h1 className="truncate text-base font-semibold text-gray-900 dark:text-gray-100">{ticket.subject}</h1>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              From: {ticket.fromName ? `${ticket.fromName} <${ticket.fromEmail}>` : ticket.fromEmail}
              {' · '}
              {timeAgo(ticket.createdAt)}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge status={ticket.status} />
            {canResolve && (
              <Button size="sm" variant="secondary" loading={changingStatus} onClick={() => changeStatus('RESOLVED')}>
                <CheckCircle className="h-4 w-4 text-green-600" />Resolve
              </Button>
            )}
            {canReopen && (
              <Button size="sm" variant="secondary" loading={changingStatus} onClick={() => changeStatus('OPEN')}>
                <RotateCcw className="h-4 w-4" />Reopen
              </Button>
            )}
            {isAdmin && (
              <Button size="sm" variant="secondary" onClick={() => setDeleteOpen(true)}
                className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20">
                <Trash2 className="h-4 w-4" />Delete
              </Button>
            )}
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-950">
          <MessageThread messages={ticket.messages} />
        </div>

        {/* Notes list */}
        {ticket.notes.length > 0 && (
          <div className="border-t border-yellow-200 dark:border-yellow-900/40 bg-yellow-50 dark:bg-yellow-900/10 px-6 py-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-yellow-700 dark:text-yellow-500">Internal Notes</p>
            <div className="flex flex-col gap-3">
              {ticket.notes.map((note) => (
                <div key={note.id} className="flex gap-3">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-yellow-200 dark:bg-yellow-800 text-xs font-medium text-yellow-800 dark:text-yellow-200">
                    {getInitials(note.user.name)}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-gray-700 dark:text-gray-300">{note.user.name}</span>
                      <span className="text-xs text-gray-400">{formatDate(note.createdAt)}</span>
                    </div>
                    <p className="mt-0.5 text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{note.body}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Reply / Note Tabs */}
        {ticket.status !== 'CLOSED' && (
          <div className="border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
            <div className="flex border-b border-gray-200 dark:border-gray-700 px-4">
              <button onClick={() => setActiveTab('reply')}
                className={`px-4 py-2.5 text-sm font-medium transition-colors ${activeTab === 'reply' ? 'border-b-2 border-indigo-600 text-indigo-600' : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'}`}>
                Reply
              </button>
              <button onClick={() => setActiveTab('note')}
                className={`px-4 py-2.5 text-sm font-medium transition-colors ${activeTab === 'note' ? 'border-b-2 border-yellow-500 text-yellow-600' : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'}`}>
                Internal Note
              </button>
            </div>
            {activeTab === 'reply' ? (
              <ReplyForm ticketId={id} onReply={fetchTicket} />
            ) : (
              <div className="p-4"><NoteForm ticketId={id} onNote={fetchTicket} /></div>
            )}
          </div>
        )}
      </div>

      {/* Sidebar */}
      <aside className="w-64 shrink-0 overflow-y-auto border-l border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 p-3 space-y-3">
        {/* Assignees */}
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Assignees</p>
            {isAdmin && (
              <button onClick={() => setAssignOpen(true)} className="text-indigo-600 hover:text-indigo-700" title="Assign">
                <UserPlus className="h-4 w-4" />
              </button>
            )}
          </div>
          {ticket.assignees.length > 0 ? (
            <div className="flex flex-col gap-2">
              {ticket.assignees.map(({ user }) => (
                <div key={user.id} className="flex items-center gap-2">
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-indigo-100 dark:bg-indigo-900 text-xs font-semibold text-indigo-700 dark:text-indigo-300">
                    {getInitials(user.name)}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-800 dark:text-gray-100">{user.name}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{user.email}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-400">Unassigned</p>
          )}
        </div>

        {/* Priority */}
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">Priority</p>
          {isAdmin ? (
            <Select value={ticket.priority} onChange={async (e) => {
              await fetch(`/api/tickets/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ priority: e.target.value }) })
              await fetchTicket()
            }} className="text-xs">
              <option value="LOW">Low</option>
              <option value="MEDIUM">Medium</option>
              <option value="HIGH">High</option>
              <option value="URGENT">Urgent</option>
            </Select>
          ) : (
            <PriorityBadge priority={ticket.priority} />
          )}
        </div>

        {/* Tags */}
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3">
          <div className="flex items-center gap-1 mb-2">
            <Tag className="h-3 w-3 text-gray-400" />
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Tags</p>
          </div>
          <div className="flex flex-wrap gap-1 mb-2">
            {ticket.tags.map(tag => (
              <span key={tag} className="flex items-center gap-0.5 rounded-full bg-indigo-50 dark:bg-indigo-900/30 px-2 py-0.5 text-xs text-indigo-700 dark:text-indigo-300">
                {tag}
                <button onClick={() => removeTag(tag)} className="ml-0.5 hover:text-indigo-900 dark:hover:text-indigo-100">
                  <XIcon className="h-3 w-3" />
                </button>
              </span>
            ))}
            {ticket.tags.length === 0 && <p className="text-xs text-gray-400">No tags</p>}
          </div>
          <div className="flex gap-1">
            <input
              value={tagInput}
              onChange={e => setTagInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addTag()}
              placeholder="Add tag…"
              className="flex-1 min-w-0 rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 px-2 py-1 text-xs text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:border-indigo-400 focus:outline-none"
            />
            <button onClick={addTag} className="rounded bg-indigo-600 px-2 py-1 text-xs text-white hover:bg-indigo-700">Add</button>
          </div>
          {/* Tag Cloud — top 10 most used tags */}
          {topTags.length > 0 && (() => {
            const maxCount = topTags[0].count
            const minCount = topTags[topTags.length - 1].count
            const getSize = (count: number) => {
              if (maxCount === minCount) return 'text-xs'
              const ratio = (count - minCount) / (maxCount - minCount)
              if (ratio > 0.66) return 'text-sm font-medium'
              if (ratio > 0.33) return 'text-xs font-medium'
              return 'text-xs'
            }
            return (
              <div className="mt-2 pt-2 border-t border-gray-100 dark:border-gray-700">
                <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-1.5">Popular Tags</p>
                <div className="flex flex-wrap gap-1">
                  {topTags.map(({ tag, count }) => {
                    const alreadyAdded = ticket.tags.includes(tag)
                    return (
                      <button
                        key={tag}
                        onClick={async () => {
                          if (alreadyAdded) return
                          await updateTags([...ticket.tags, tag])
                          await fetchTopTags()
                        }}
                        disabled={alreadyAdded}
                        title={`${count} ticket${count !== 1 ? 's' : ''}${alreadyAdded ? ' (already added)' : ' — click to add'}`}
                        className={`rounded-full px-2 py-0.5 transition-colors ${getSize(count)} ${
                          alreadyAdded
                            ? 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-400 dark:text-indigo-500 cursor-default opacity-60'
                            : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/30 hover:text-indigo-700 dark:hover:text-indigo-300 cursor-pointer'
                        }`}
                      >
                        {tag}
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })()}
        </div>

        {/* Details */}
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">Details</p>
          <div className="flex flex-col gap-2 text-xs text-gray-600 dark:text-gray-400">
            <div><span className="text-gray-400 dark:text-gray-500">Created</span><p className="text-gray-700 dark:text-gray-300">{formatDate(ticket.createdAt)}</p></div>
            <div><span className="text-gray-400 dark:text-gray-500">Updated</span><p className="text-gray-700 dark:text-gray-300">{formatDate(ticket.updatedAt)}</p></div>
            {ticket.resolvedAt && <div><span className="text-gray-400 dark:text-gray-500">Resolved</span><p className="text-gray-700 dark:text-gray-300">{formatDate(ticket.resolvedAt)}</p></div>}
            <div>
              <span className="text-gray-400 dark:text-gray-500">Inbox</span>
              <p className="text-gray-700 dark:text-gray-300">{ticket.emailAccount.name}</p>
              <p className="text-gray-500 dark:text-gray-400">{ticket.emailAccount.email}</p>
            </div>
            <div><span className="text-gray-400 dark:text-gray-500">Messages</span><p className="text-gray-700 dark:text-gray-300">{ticket.messages.length}</p></div>
          </div>
        </div>

        {/* Customer History */}
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">Customer History</p>
          <CustomerHistory fromEmail={ticket.fromEmail} currentTicketId={ticket.id} />
        </div>

        {/* Activity */}
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">Activity</p>
          <ActivityFeed activities={ticket.activities} />
        </div>
      </aside>

      <AssignModal
        open={assignOpen}
        onClose={() => setAssignOpen(false)}
        ticketId={id}
        currentAgentIds={currentAgentIds}
        onAssigned={fetchTicket}
      />

      <ConfirmModal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={deleteTicket}
        title="Delete Ticket"
        message={`Permanently delete "${ticket.subject}"? All messages, notes, and attachments will be lost. This cannot be undone.`}
        confirmLabel="Delete Ticket"
        loading={deleting}
      />
    </div>
  )
}
