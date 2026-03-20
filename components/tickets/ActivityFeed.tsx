import { formatDate } from '@/lib/utils'
import { Clock } from 'lucide-react'

interface Activity {
  id: string
  action: string
  metadata?: Record<string, unknown>
  createdAt: string
  user?: { id: string; name: string } | null
}

function activityText(activity: Activity): string {
  const meta = activity.metadata as Record<string, string> | undefined
  const user = activity.user?.name || 'System'
  switch (activity.action) {
    case 'ticket_created': return `Ticket created from ${meta?.from || 'email'}`
    case 'replied': return `${user} sent a reply`
    case 'note_added': return `${user} added an internal note`
    case 'assigned':
      return meta?.to ? `${user} assigned ticket` : `${user} unassigned ticket`
    case 'status_changed':
      return `${user} changed status from ${meta?.from} to ${meta?.to}`
    default: return `${user}: ${activity.action}`
  }
}

export default function ActivityFeed({ activities }: { activities: Activity[] }) {
  if (!activities.length) return null

  return (
    <div className="flex flex-col gap-2">
      {activities.map((a) => (
        <div key={a.id} className="flex items-start gap-2">
          <Clock className="mt-0.5 h-3 w-3 shrink-0 text-gray-300" />
          <div>
            <p className="text-xs text-gray-500">{activityText(a)}</p>
            <p className="text-xs text-gray-400">{formatDate(a.createdAt)}</p>
          </div>
        </div>
      ))}
    </div>
  )
}
