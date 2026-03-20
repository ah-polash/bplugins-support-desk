'use client'
import { useState, useRef, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/Button'
import { Send, Paperclip, X, ChevronDown, Globe, Lock, Sparkles } from 'lucide-react'
import RichTextEditor from './RichTextEditor'
import toast from 'react-hot-toast'

interface CannedReply { id: string; title: string; body: string; htmlBody?: string; isGlobal: boolean }

interface ReplyFormProps {
  ticketId: string
  onReply?: () => void
}

export default function ReplyForm({ ticketId, onReply }: ReplyFormProps) {
  const [htmlBody, setHtmlBody] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [sending, setSending] = useState(false)
  const [suggesting, setSuggesting] = useState(false)
  const [aiEnabled, setAiEnabled] = useState(false)
  const [signature, setSignature] = useState('')
  const [cannedReplies, setCannedReplies] = useState<CannedReply[]>([])
  const [cannedOpen, setCannedOpen] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const cannedRef = useRef<HTMLDivElement>(null)

  const fetchData = useCallback(async () => {
    const [profileRes, cannedRes, settingsRes] = await Promise.allSettled([
      fetch('/api/profile'),
      fetch('/api/canned-replies'),
      fetch('/api/ai/status'),
    ])
    if (profileRes.status === 'fulfilled' && profileRes.value.ok) {
      const p = await profileRes.value.json()
      if (p.signature) setSignature(p.signature)
    }
    if (cannedRes.status === 'fulfilled' && cannedRes.value.ok) {
      setCannedReplies(await cannedRes.value.json())
    }
    if (settingsRes.status === 'fulfilled' && settingsRes.value.ok) {
      const s = await settingsRes.value.json()
      setAiEnabled(!!s.aiEnabled)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (cannedRef.current && !cannedRef.current.contains(e.target as Node)) setCannedOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const applyCannedReply = (cr: CannedReply) => {
    setHtmlBody(cr.htmlBody || `<p>${cr.body}</p>`)
    setCannedOpen(false)
  }

  const stripHtml = (html: string) => {
    if (typeof window === 'undefined') return html.replace(/<[^>]+>/g, '')
    const div = document.createElement('div')
    div.innerHTML = html
    return div.textContent || div.innerText || ''
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!stripHtml(htmlBody).trim()) return toast.error('Reply cannot be empty')

    setSending(true)
    try {
      const fd = new FormData()
      fd.append('body', stripHtml(htmlBody))
      fd.append('htmlBody', htmlBody)
      files.forEach((f) => fd.append('attachments', f))

      const res = await fetch(`/api/tickets/${ticketId}/reply`, { method: 'POST', body: fd })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Failed to send reply')
      }
      toast.success('Reply sent')
      setHtmlBody('')
      setFiles([])
      onReply?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setSending(false)
    }
  }

  const handleAiSuggest = async () => {
    setSuggesting(true)
    try {
      const res = await fetch('/api/ai/suggest-reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'AI request failed')
      setHtmlBody(data.html || `<p>${data.text}</p>`)
      toast.success('AI reply generated')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'AI request failed')
    } finally {
      setSuggesting(false)
    }
  }

  const addFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return
    setFiles((prev) => [...prev, ...Array.from(e.target.files!)])
    e.target.value = ''
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-900 p-4">
      {cannedReplies.length > 0 && (
        <div ref={cannedRef} className="relative mb-2">
          <button
            type="button"
            onClick={() => setCannedOpen((o) => !o)}
            className="flex items-center gap-1.5 rounded-md border border-gray-200 dark:border-gray-600 px-2.5 py-1 text-xs text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            Canned Replies <ChevronDown className="h-3 w-3" />
          </button>
          {cannedOpen && (
            <div className="absolute left-0 top-full z-20 mt-1 w-80 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 shadow-lg max-h-72 overflow-y-auto">
              {cannedReplies.map((cr) => (
                <button
                  key={cr.id}
                  type="button"
                  onClick={() => applyCannedReply(cr)}
                  className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-700 border-b border-gray-100 dark:border-gray-700 last:border-0"
                >
                  <div className="flex items-center gap-1.5">
                    {cr.isGlobal
                      ? <Globe className="h-3 w-3 shrink-0 text-indigo-500" />
                      : <Lock className="h-3 w-3 shrink-0 text-gray-400" />
                    }
                    <p className="font-medium text-gray-800 dark:text-gray-200 truncate">{cr.title}</p>
                  </div>
                  <p className="mt-0.5 text-xs text-gray-400 truncate pl-4">{cr.body}</p>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <RichTextEditor value={htmlBody} onChange={setHtmlBody} minHeight={120} />

      {signature && (
        <div className="mt-2 pt-1">
          <p className="mb-1 text-xs text-gray-400">Signature (appended automatically)</p>
          <div className="prose text-xs text-gray-500 dark:text-gray-400 line-clamp-2" dangerouslySetInnerHTML={{ __html: signature }} />
        </div>
      )}

      {files.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {files.map((f, i) => (
            <div key={i} className="flex items-center gap-1.5 rounded-md bg-gray-100 dark:bg-gray-700 px-2 py-1 text-xs text-gray-600 dark:text-gray-300">
              <Paperclip className="h-3 w-3" />
              <span className="max-w-[120px] truncate">{f.name}</span>
              <button type="button" onClick={() => setFiles((p) => p.filter((_, j) => j !== i))} className="text-gray-400 hover:text-gray-600">
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="mt-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex items-center gap-1.5 rounded px-2 py-1 text-sm text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <Paperclip className="h-4 w-4" />
            Attach
          </button>
          {aiEnabled && (
            <button
              type="button"
              onClick={handleAiSuggest}
              disabled={suggesting}
              className="flex items-center gap-1.5 rounded px-2 py-1 text-sm text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 disabled:opacity-50"
            >
              <Sparkles className={`h-4 w-4 ${suggesting ? 'animate-pulse' : ''}`} />
              {suggesting ? 'Generating…' : 'AI Suggest'}
            </button>
          )}
        </div>
        <input ref={fileRef} type="file" multiple className="hidden" onChange={addFiles} />
        <Button type="submit" loading={sending} size="sm">
          <Send className="h-4 w-4" />
          Send Reply
        </Button>
      </div>
    </form>
  )
}
