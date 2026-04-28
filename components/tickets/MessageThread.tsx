'use client'
import { formatDate, getInitials, cn } from '@/lib/utils'
import { Paperclip, Eye, EyeOff } from 'lucide-react'

interface Attachment {
  id: string
  filename: string
  url: string
  mimeType: string
  size: number
}

interface Message {
  id: string
  body: string
  htmlBody?: string
  fromEmail: string
  fromName?: string
  isIncoming: boolean
  createdAt: string
  firstOpenedAt?: string | null
  lastOpenedAt?: string | null
  openCount?: number
  attachments?: Attachment[]
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Sanitize HTML to prevent XSS. Strips dangerous tags and event-handler attributes.
 * Runs client-side using DOMParser — zero extra dependencies.
 */
function sanitizeHtml(html: string): string {
  if (typeof window === 'undefined') return ''

  const parser = new DOMParser()
  const doc = parser.parseFromString(html, 'text/html')

  const BLOCKED_TAGS = new Set([
    'script', 'style', 'iframe', 'object', 'embed', 'form', 'input',
    'button', 'textarea', 'select', 'meta', 'link', 'base', 'applet',
  ])

  function walk(node: Element) {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        const el = child as Element
        const tag = el.tagName.toLowerCase()

        if (BLOCKED_TAGS.has(tag)) {
          node.removeChild(el)
          continue
        }

        // Remove event-handler attributes and javascript: URLs
        for (const attr of Array.from(el.attributes)) {
          const name = attr.name.toLowerCase()
          if (name.startsWith('on')) {
            el.removeAttribute(attr.name)
          } else if ((name === 'href' || name === 'src') && /^\s*javascript:/i.test(attr.value)) {
            el.removeAttribute(attr.name)
          }
        }

        walk(el)
      }
    }
  }

  walk(doc.body)
  return doc.body.innerHTML
}

export default function MessageThread({ messages }: { messages: Message[] }) {
  return (
    <div className="flex flex-col gap-4 p-6">
      {messages.map((msg) => (
        <div
          key={msg.id}
          className={cn(
            'flex gap-3',
            !msg.isIncoming && 'flex-row-reverse'
          )}
        >
          {/* Avatar */}
          <div
            className={cn(
              'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
              msg.isIncoming
                ? 'bg-gray-200 text-gray-700'
                : 'bg-indigo-600 text-white'
            )}
          >
            {getInitials(msg.fromName || msg.fromEmail)}
          </div>

          {/* Bubble */}
          <div className={cn('max-w-[75%] flex flex-col gap-1', !msg.isIncoming && 'items-end')}>
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-gray-700">
                {msg.fromName || msg.fromEmail}
              </span>
              <span className="text-xs text-gray-400">{formatDate(msg.createdAt)}</span>
            </div>

            <div
              className={cn(
                'rounded-lg px-4 py-3 text-sm',
                msg.isIncoming
                  ? 'bg-white border border-gray-200 text-gray-800'
                  : 'bg-indigo-600 text-white'
              )}
            >
              {msg.htmlBody ? (
                <div
                  className="prose prose-sm max-w-none"
                  dangerouslySetInnerHTML={{ __html: sanitizeHtml(msg.htmlBody) }}
                />
              ) : (
                <pre className="whitespace-pre-wrap font-sans">{msg.body}</pre>
              )}
            </div>

            {msg.attachments && msg.attachments.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-1">
                {msg.attachments.map((att) => (
                  <a
                    key={att.id}
                    href={att.url}
                    download={att.filename}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
                  >
                    <Paperclip className="h-3 w-3" />
                    <span className="max-w-[120px] truncate">{att.filename}</span>
                    <span className="text-gray-400">({formatBytes(att.size)})</span>
                  </a>
                ))}
              </div>
            )}

            {!msg.isIncoming && (
              msg.firstOpenedAt ? (
                <div
                  className="flex items-center gap-1 text-xs text-gray-500"
                  title={
                    msg.lastOpenedAt && msg.lastOpenedAt !== msg.firstOpenedAt
                      ? `Last viewed ${formatDate(msg.lastOpenedAt)} • ${msg.openCount ?? 1} opens`
                      : undefined
                  }
                >
                  <Eye className="h-3 w-3" />
                  <span>Customer viewed on {formatDate(msg.firstOpenedAt)}</span>
                </div>
              ) : (
                <div className="flex items-center gap-1 text-xs text-gray-400">
                  <EyeOff className="h-3 w-3" />
                  <span>Not viewed yet</span>
                </div>
              )
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
