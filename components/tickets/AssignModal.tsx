'use client'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { X, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import toast from 'react-hot-toast'

interface Agent {
  id: string
  name: string
  email: string
  role: string
  isActive: boolean
}

interface Props {
  open: boolean
  onClose: () => void
  ticketId: string
  currentAgentIds?: string[]
  onAssigned: () => void
}

export default function AssignModal({ open, onClose, ticketId, currentAgentIds = [], onAssigned }: Props) {
  const [agents, setAgents] = useState<Agent[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open) return
    setSelected(currentAgentIds)
    fetch('/api/users')
      .then(r => r.json())
      .then(data => {
        const list = data.users ?? data
        setAgents(list.filter((u: Agent) => u.isActive))
      })
      .catch(() => toast.error('Failed to load agents'))
  }, [open, currentAgentIds])

  const toggle = (id: string) => {
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  const handleSubmit = async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/tickets/${ticketId}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentIds: selected }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Failed')
      toast.success(selected.length === 0 ? 'Ticket unassigned' : `Assigned to ${selected.length} agent${selected.length > 1 ? 's' : ''}`)
      onAssigned()
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to assign')
    } finally {
      setLoading(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-sm mx-4 rounded-xl bg-white dark:bg-gray-800 shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-200 dark:border-gray-700 px-4 py-3">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Assign Ticket</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-72 overflow-y-auto p-2">
          {/* Unassign option */}
          <button
            onClick={() => setSelected([])}
            className={cn(
              'flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
              selected.length === 0
                ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300'
                : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
            )}
          >
            <div className={cn('flex h-4 w-4 items-center justify-center rounded border', selected.length === 0 ? 'border-indigo-500 bg-indigo-500' : 'border-gray-300 dark:border-gray-500')}>
              {selected.length === 0 && <Check className="h-3 w-3 text-white" />}
            </div>
            <span className="text-gray-400 dark:text-gray-500">Unassigned</span>
          </button>

          {agents.map(agent => (
            <button
              key={agent.id}
              onClick={() => toggle(agent.id)}
              className={cn(
                'flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
                selected.includes(agent.id)
                  ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300'
                  : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
              )}
            >
              <div className={cn('flex h-4 w-4 items-center justify-center rounded border', selected.includes(agent.id) ? 'border-indigo-500 bg-indigo-500' : 'border-gray-300 dark:border-gray-500')}>
                {selected.includes(agent.id) && <Check className="h-3 w-3 text-white" />}
              </div>
              <div className="flex flex-col items-start min-w-0">
                <span className="font-medium truncate">{agent.name}</span>
                <span className="text-xs text-gray-400 dark:text-gray-500 truncate">{agent.email}</span>
              </div>
              <span className="ml-auto text-xs text-gray-400 capitalize">{agent.role.replace('SUPPORT_', '').toLowerCase()}</span>
            </button>
          ))}
        </div>

        <div className="flex justify-end gap-2 border-t border-gray-200 dark:border-gray-700 px-4 py-3">
          <Button variant="outline" size="sm" onClick={onClose} disabled={loading}>Cancel</Button>
          <Button size="sm" loading={loading} onClick={handleSubmit}>
            {selected.length === 0 ? 'Unassign' : `Assign (${selected.length})`}
          </Button>
        </div>
      </div>
    </div>
  )
}
