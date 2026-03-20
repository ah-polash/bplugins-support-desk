import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { formatDistanceToNow, format } from 'date-fns'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function timeAgo(date: Date | string) {
  return formatDistanceToNow(new Date(date), { addSuffix: true })
}

export function formatDate(date: Date | string) {
  return format(new Date(date), 'MMM d, yyyy h:mm a')
}

export function getInitials(name: string) {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

export function stripHtml(html: string) {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

export function buildReplySubject(subject: string) {
  return subject.startsWith('Re:') ? subject : `Re: ${subject}`
}

export function priorityColor(priority: string) {
  switch (priority) {
    case 'URGENT': return 'text-red-600 bg-red-50'
    case 'HIGH': return 'text-orange-600 bg-orange-50'
    case 'MEDIUM': return 'text-yellow-600 bg-yellow-50'
    case 'LOW': return 'text-green-600 bg-green-50'
    default: return 'text-gray-600 bg-gray-50'
  }
}

export function statusColor(status: string) {
  switch (status) {
    case 'OPEN': return 'text-blue-600 bg-blue-50'
    case 'PENDING': return 'text-yellow-600 bg-yellow-50'
    case 'RESOLVED': return 'text-green-600 bg-green-50'
    case 'CLOSED': return 'text-gray-600 bg-gray-100'
    default: return 'text-gray-600 bg-gray-50'
  }
}
