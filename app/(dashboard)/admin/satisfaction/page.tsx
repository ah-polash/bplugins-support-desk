'use client'
import { useEffect, useState, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import Header from '@/components/layout/Header'
import { ThumbsDown, ThumbsUp, Minus, ChevronLeft, ChevronRight, ExternalLink, CheckCircle2, XCircle } from 'lucide-react'

type Rating = 'DISSATISFIED' | 'NEUTRAL' | 'SATISFIED'

interface SatisfactionEntry {
  id: string
  rating: Rating | null
  feedback: string | null
  ratedAt: string | null
  reviewClicked: boolean
  createdAt: string
  ticket: {
    id: string
    subject: string
    fromEmail: string
    fromName: string | null
    createdAt: string
    resolvedAt: string | null
  }
}

function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 60000)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ${minutes % 60}m`
  const days = Math.floor(hours / 24)
  return `${days}d ${hours % 24}h`
}

const RATING_CONFIG: Record<Rating, { label: string; icon: React.FC<{ className?: string }>; badgeCls: string }> = {
  DISSATISFIED: {
    label: 'Dissatisfied',
    icon: ThumbsDown,
    badgeCls: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300',
  },
  NEUTRAL: {
    label: 'Neutral',
    icon: Minus,
    badgeCls: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300',
  },
  SATISFIED: {
    label: 'Satisfied',
    icon: ThumbsUp,
    badgeCls: 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300',
  },
}

export default function SatisfactionPage() {
  const { data: session, status } = useSession()
  const router = useRouter()

  const [entries, setEntries] = useState<SatisfactionEntry[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<Rating | ''>('')
  const limit = 25

  useEffect(() => {
    if (status === 'authenticated' && session?.user?.role !== 'SUPER_ADMIN') {
      router.replace('/inbox')
    }
  }, [status, session, router])

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) })
      if (filter) params.set('rating', filter)
      const res = await fetch(`/api/admin/satisfaction?${params}`)
      if (res.ok) {
        const data = await res.json()
        setEntries(data.ratings ?? [])
        setTotal(data.total ?? 0)
      }
    } finally {
      setLoading(false)
    }
  }, [page, filter])

  useEffect(() => { fetchData() }, [fetchData])

  const totalPages = Math.ceil(total / limit)

  return (
    <div className="flex h-full flex-col">
      <Header title="Satisfaction Ratings" />
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-7xl">

          {/* Filter bar */}
          <div className="mb-4 flex items-center gap-2 flex-wrap">
            {(['', 'SATISFIED', 'NEUTRAL', 'DISSATISFIED'] as const).map(f => {
              const cfg = f ? RATING_CONFIG[f] : null
              return (
                <button
                  key={f || 'all'}
                  onClick={() => { setFilter(f); setPage(1) }}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-colors border ${
                    filter === f
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:border-indigo-400'
                  }`}
                >
                  {cfg ? (
                    <span className="flex items-center gap-1">
                      <cfg.icon className="h-3 w-3" />
                      {cfg.label}
                    </span>
                  ) : 'All Ratings'}
                </button>
              )
            })}
            <span className="ml-auto text-xs text-gray-400">{total} survey{total !== 1 ? 's' : ''} sent</span>
          </div>

          {loading ? (
            <div className="flex justify-center py-20">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
            </div>
          ) : entries.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 py-20">
              <ThumbsUp className="h-10 w-10 text-gray-300 dark:text-gray-600 mb-3" />
              <p className="text-sm font-medium text-gray-500 dark:text-gray-400">No ratings yet</p>
              <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                Ratings appear here when customers resolve their tickets and respond to the survey.
              </p>
            </div>
          ) : (
            <>
              <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap">Customer</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap">Subject</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap">Resolved Within</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap">Rating</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap">Review Clicked</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap">Feedback</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap">Rated At</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                    {entries.map(entry => {
                      const cfg = entry.rating ? RATING_CONFIG[entry.rating] : null
                      const resolvedMs = entry.ticket.resolvedAt
                        ? new Date(entry.ticket.resolvedAt).getTime() - new Date(entry.ticket.createdAt).getTime()
                        : null
                      return (
                        <tr key={entry.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                          <td className="px-4 py-3">
                            <p className="font-medium text-gray-900 dark:text-gray-100 truncate max-w-[160px]">
                              {entry.ticket.fromName || '—'}
                            </p>
                            <p className="text-xs text-gray-400 truncate max-w-[160px]">{entry.ticket.fromEmail}</p>
                          </td>
                          <td className="px-4 py-3">
                            <a
                              href={`/tickets/${entry.ticket.id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-indigo-600 dark:text-indigo-400 hover:underline truncate max-w-[220px]"
                              title={entry.ticket.subject}
                            >
                              <span className="truncate">{entry.ticket.subject}</span>
                              <ExternalLink className="h-3 w-3 shrink-0 opacity-60" />
                            </a>
                          </td>
                          <td className="px-4 py-3 text-gray-500 dark:text-gray-400 whitespace-nowrap">
                            {resolvedMs !== null ? formatDuration(resolvedMs) : '—'}
                          </td>
                          <td className="px-4 py-3">
                            {cfg && entry.rating ? (
                              <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${cfg.badgeCls}`}>
                                <cfg.icon className="h-3 w-3" />
                                {cfg.label}
                              </span>
                            ) : (
                              <span className="text-xs text-gray-400 italic">Not rated</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            {entry.reviewClicked ? (
                              <span className="inline-flex items-center gap-1 text-xs font-medium text-green-600 dark:text-green-400">
                                <CheckCircle2 className="h-3.5 w-3.5" /> Clicked
                              </span>
                            ) : entry.rating === 'SATISFIED' ? (
                              <span className="inline-flex items-center gap-1 text-xs text-gray-400">
                                <XCircle className="h-3.5 w-3.5" /> Not clicked
                              </span>
                            ) : (
                              <span className="text-xs text-gray-300 dark:text-gray-600">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <p className="text-gray-600 dark:text-gray-300 text-xs max-w-[220px] line-clamp-2">
                              {entry.feedback || <span className="italic text-gray-400">—</span>}
                            </p>
                          </td>
                          <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">
                            {entry.ratedAt
                              ? new Date(entry.ratedAt).toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' })
                              : <span className="italic">Pending</span>}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="mt-4 flex items-center justify-between text-sm text-gray-500 dark:text-gray-400">
                  <span>Page {page} of {totalPages}</span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setPage(p => Math.max(1, p - 1))}
                      disabled={page === 1}
                      className="flex items-center gap-1 rounded-md border border-gray-200 dark:border-gray-700 px-3 py-1.5 text-xs hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-40"
                    >
                      <ChevronLeft className="h-3.5 w-3.5" /> Prev
                    </button>
                    <button
                      onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                      disabled={page === totalPages}
                      className="flex items-center gap-1 rounded-md border border-gray-200 dark:border-gray-700 px-3 py-1.5 text-xs hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-40"
                    >
                      Next <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
