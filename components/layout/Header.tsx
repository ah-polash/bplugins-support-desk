'use client'
import { Search, RefreshCw, Plus } from 'lucide-react'
import { useState } from 'react'
import { useSession } from 'next-auth/react'
import toast from 'react-hot-toast'
import CreateTicketModal from '@/components/tickets/CreateTicketModal'

interface HeaderProps {
  title: string
  onSearch?: (q: string) => void
  showSync?: boolean
  onSynced?: () => void
  onCreated?: () => void
}

export default function Header({ title, onSearch, showSync, onSynced, onCreated }: HeaderProps) {
  const { data: session } = useSession()
  const [syncing, setSyncing] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const isAdmin = session?.user?.role === 'SUPPORT_ADMIN' || session?.user?.role === 'SUPER_ADMIN'

  const handleSync = async () => {
    setSyncing(true)
    try {
      const res = await fetch('/api/sync', { method: 'POST' })
      const data = await res.json()

      if (!res.ok) {
        toast.error(data.error || 'Sync failed')
        return
      }

      const results: Array<{ account: string; success: boolean; error?: string }> = data.results || []

      if (results.length === 0) {
        toast('No email accounts configured. Add one in Admin → Email Accounts.', { icon: '⚠️' })
        return
      }

      const failed = results.filter((r) => !r.success)
      if (failed.length) {
        toast.error(`Sync failed for: ${failed.map((r) => r.account).join(', ')}`)
      } else {
        toast.success(`Synced ${results.length} account(s) successfully`)
        onSynced?.()
      }
    } catch {
      toast.error('Sync request failed')
    } finally {
      setSyncing(false)
    }
  }

  return (
    <header className="flex h-14 items-center justify-between border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-6">
      <h1 className="text-base font-semibold text-gray-900 dark:text-gray-100">{title}</h1>
      <div className="flex items-center gap-3">
        {onSearch && (
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search tickets..."
              onChange={(e) => onSearch(e.target.value)}
              className="w-60 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 py-1.5 pl-9 pr-3 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
        )}
        {showSync && isAdmin && (
          <>
            <button
              onClick={handleSync}
              disabled={syncing}
              className="flex items-center gap-2 rounded-md border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
              {syncing ? 'Syncing...' : 'Sync Now'}
            </button>
            <button
              onClick={() => setCreateOpen(true)}
              className="flex items-center gap-2 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
            >
              <Plus className="h-4 w-4" />
              Create new Ticket
            </button>
          </>
        )}
      </div>

      {isAdmin && (
        <CreateTicketModal
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          onCreated={onCreated}
        />
      )}
    </header>
  )
}
