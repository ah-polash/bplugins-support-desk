'use client'
import { useEffect, useState, useCallback } from 'react'
import Header from '@/components/layout/Header'
import { RefreshCw } from 'lucide-react'

interface ReportData {
  status: { open: number; pending: number; resolved: number; closed: number }
  today: { created: number; resolved: number }
  last7: { created: number; resolved: number }
  last30: { created: number; resolved: number }
  agents: Array<{ id: string; name: string; openTickets: number }>
  daily: Array<{ date: string; count: number }>
}

function StatCard({ label, value, sub, color }: { label: string; value: number; sub?: string; color?: string }) {
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5">
      <p className="text-xs font-medium uppercase tracking-wider text-gray-400 dark:text-gray-500">{label}</p>
      <p className={`mt-2 text-3xl font-bold ${color || 'text-gray-900 dark:text-gray-100'}`}>{value}</p>
      {sub && <p className="mt-1 text-xs text-gray-400">{sub}</p>}
    </div>
  )
}

export default function ReportsPage() {
  const [data, setData] = useState<ReportData | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/reports')
      if (res.ok) setData(await res.json())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const maxDaily = data ? Math.max(...data.daily.map((d) => d.count), 1) : 1

  return (
    <div className="flex h-full flex-col">
      <Header title="Reports" />
      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-24 animate-pulse rounded-lg bg-gray-100 dark:bg-gray-700" />
            ))}
          </div>
        ) : !data ? (
          <p className="text-gray-400">Failed to load reports.</p>
        ) : (
          <div className="space-y-6">
            {/* Today */}
            <div>
              <h2 className="mb-3 text-sm font-semibold text-gray-700 dark:text-gray-300">Today</h2>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <StatCard label="New" value={data.today.created} color="text-blue-600 dark:text-blue-400" />
                <StatCard label="Resolved" value={data.today.resolved} color="text-green-600 dark:text-green-400" />
              </div>
            </div>

            {/* Ticket Status */}
            <div>
              <h2 className="mb-3 text-sm font-semibold text-gray-700 dark:text-gray-300">Current Status</h2>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <StatCard label="Open" value={data.status.open} color="text-red-600 dark:text-red-400" />
                <StatCard label="Pending" value={data.status.pending} color="text-yellow-600 dark:text-yellow-400" />
                <StatCard label="Resolved" value={data.status.resolved} color="text-green-600 dark:text-green-400" />
                <StatCard label="Closed" value={data.status.closed} />
              </div>
            </div>

            {/* 7 / 30 days */}
            <div>
              <h2 className="mb-3 text-sm font-semibold text-gray-700 dark:text-gray-300">Volume</h2>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <StatCard label="Created (7d)" value={data.last7.created} />
                <StatCard label="Resolved (7d)" value={data.last7.resolved} />
                <StatCard label="Created (30d)" value={data.last30.created} />
                <StatCard label="Resolved (30d)" value={data.last30.resolved} />
              </div>
            </div>

            {/* Daily chart */}
            {data.daily.length > 0 && (
              <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5">
                <h2 className="mb-4 text-sm font-semibold text-gray-700 dark:text-gray-300">Daily Tickets (Last 7 Days)</h2>
                <div className="flex items-end gap-2 h-32">
                  {data.daily.map((d) => (
                    <div key={d.date} className="flex flex-1 flex-col items-center gap-1">
                      <span className="text-xs text-gray-500">{d.count}</span>
                      <div
                        className="w-full rounded-t-sm bg-indigo-500"
                        style={{ height: `${Math.max((d.count / maxDaily) * 100, 4)}%` }}
                      />
                      <span className="text-xs text-gray-400 truncate w-full text-center">
                        {new Date(d.date).toLocaleDateString('en', { weekday: 'short' })}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Agent workload */}
            {data.agents.length > 0 && (
              <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Agent Workload</h2>
                  <button onClick={fetchData} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                    <RefreshCw className="h-4 w-4" />
                  </button>
                </div>
                <div className="space-y-3">
                  {data.agents.sort((a, b) => b.openTickets - a.openTickets).map((agent) => (
                    <div key={agent.id} className="flex items-center gap-3">
                      <div className="w-36 shrink-0">
                        <p className="truncate text-sm text-gray-700 dark:text-gray-300">{agent.name}</p>
                      </div>
                      <div className="flex-1 rounded-full bg-gray-100 dark:bg-gray-700 h-2">
                        <div
                          className="h-2 rounded-full bg-indigo-500"
                          style={{ width: `${Math.min((agent.openTickets / Math.max(...data.agents.map(a => a.openTickets), 1)) * 100, 100)}%` }}
                        />
                      </div>
                      <span className="w-10 text-right text-sm font-medium text-gray-700 dark:text-gray-300">
                        {agent.openTickets}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
