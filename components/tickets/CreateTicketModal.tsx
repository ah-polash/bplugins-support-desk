'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Modal } from '@/components/ui/Modal'
import { Input, Select } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import RichTextEditor from './RichTextEditor'
import toast from 'react-hot-toast'

interface EmailAccount { id: string; name: string; email: string; isActive: boolean }
interface Agent { id: string; name: string; email: string; role: string; isActive: boolean }

interface Props {
  open: boolean
  onClose: () => void
  onCreated?: () => void
}

export default function CreateTicketModal({ open, onClose, onCreated }: Props) {
  const router = useRouter()
  const [accounts, setAccounts] = useState<EmailAccount[]>([])
  const [agents, setAgents] = useState<Agent[]>([])

  const [fromEmail, setFromEmail] = useState('')
  const [fromName, setFromName] = useState('')
  const [emailAccountId, setEmailAccountId] = useState('')
  const [subject, setSubject] = useState('')
  const [priority, setPriority] = useState('MEDIUM')
  const [status, setStatus] = useState('OPEN')
  const [tags, setTags] = useState('')
  const [assigneeIds, setAssigneeIds] = useState<string[]>([])
  const [htmlBody, setHtmlBody] = useState('')
  const [sendEmail, setSendEmail] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open) return
    // Reset form when (re)opening
    setFromEmail('')
    setFromName('')
    setSubject('')
    setPriority('MEDIUM')
    setStatus('OPEN')
    setTags('')
    setAssigneeIds([])
    setHtmlBody('')
    setSendEmail(true)

    fetch('/api/email-accounts')
      .then(r => r.ok ? r.json() : [])
      .then((list: EmailAccount[]) => {
        const active = (list || []).filter(a => a.isActive)
        setAccounts(active)
        if (active.length > 0) setEmailAccountId(active[0].id)
      })
      .catch(() => { /* non-superadmin will get 403 — leave empty */ })

    fetch('/api/users')
      .then(r => r.ok ? r.json() : [])
      .then((list: Agent[]) => setAgents((list || []).filter(u => u.isActive)))
      .catch(() => { /* ignore */ })
  }, [open])

  const stripHtml = (html: string) => {
    if (typeof window === 'undefined') return html.replace(/<[^>]+>/g, '')
    const div = document.createElement('div')
    div.innerHTML = html
    return div.textContent || div.innerText || ''
  }

  const toggleAgent = (id: string) => {
    setAssigneeIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const plainBody = stripHtml(htmlBody).trim()
    if (!subject.trim()) return toast.error('Subject is required')
    if (!fromEmail.trim() || !fromEmail.includes('@')) return toast.error('Valid customer email is required')
    if (!plainBody) return toast.error('Message is required')

    setSubmitting(true)
    try {
      const res = await fetch('/api/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject: subject.trim(),
          fromEmail: fromEmail.trim(),
          fromName: fromName.trim() || undefined,
          emailAccountId: emailAccountId || undefined,
          priority,
          status,
          tags: tags.split(',').map(t => t.trim()).filter(Boolean),
          assigneeIds,
          body: plainBody,
          htmlBody,
          sendEmail,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to create ticket')

      if (sendEmail && !data.emailSent) {
        toast.error(`Ticket #${data.ticket.ticketNumber} created, but email delivery failed${data.emailError ? `: ${data.emailError}` : ''}`)
      } else if (sendEmail) {
        toast.success(`Ticket #${data.ticket.ticketNumber} created and email sent`)
      } else {
        toast.success(`Ticket #${data.ticket.ticketNumber} created`)
      }
      onCreated?.()
      onClose()
      router.push(`/tickets/${data.ticket.ticketNumber}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create ticket')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Create New Ticket" size="lg">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label="Customer Email *"
            type="email"
            value={fromEmail}
            onChange={e => setFromEmail(e.target.value)}
            placeholder="customer@example.com"
            required
          />
          <Input
            label="Customer Name"
            value={fromName}
            onChange={e => setFromName(e.target.value)}
            placeholder="Optional"
          />
        </div>

        <Input
          label="Subject *"
          value={subject}
          onChange={e => setSubject(e.target.value)}
          placeholder="Short summary of the issue"
          required
        />

        <div className={cn('grid grid-cols-1 gap-4', accounts.length > 0 ? 'sm:grid-cols-3' : 'sm:grid-cols-2')}>
          {accounts.length > 0 && (
            <Select label="From Mailbox" value={emailAccountId} onChange={e => setEmailAccountId(e.target.value)}>
              {accounts.map(a => (
                <option key={a.id} value={a.id}>{a.name} ({a.email})</option>
              ))}
            </Select>
          )}
          <Select label="Priority" value={priority} onChange={e => setPriority(e.target.value)}>
            <option value="LOW">Low</option>
            <option value="MEDIUM">Medium</option>
            <option value="HIGH">High</option>
            <option value="URGENT">Urgent</option>
          </Select>
          <Select label="Status" value={status} onChange={e => setStatus(e.target.value)}>
            <option value="OPEN">Open</option>
            <option value="PENDING">Pending</option>
            <option value="RESOLVED">Resolved</option>
            <option value="CLOSED">Closed</option>
          </Select>
        </div>

        <Input
          label="Tags"
          value={tags}
          onChange={e => setTags(e.target.value)}
          placeholder="comma-separated, e.g. billing, refund"
        />

        {agents.length > 0 && (
          <div>
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Assign Agents</label>
            <div className="mt-1 max-h-32 overflow-y-auto rounded-md border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 p-1">
              {agents.map(agent => {
                const sel = assigneeIds.includes(agent.id)
                return (
                  <button
                    type="button"
                    key={agent.id}
                    onClick={() => toggleAgent(agent.id)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded px-2 py-1.5 text-left text-sm transition-colors',
                      sel
                        ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300'
                        : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600'
                    )}
                  >
                    <div className={cn('flex h-4 w-4 items-center justify-center rounded border', sel ? 'border-indigo-500 bg-indigo-500' : 'border-gray-300 dark:border-gray-500')}>
                      {sel && <Check className="h-3 w-3 text-white" />}
                    </div>
                    <span className="font-medium">{agent.name}</span>
                    <span className="text-xs text-gray-400">{agent.email}</span>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Message *</label>
          <RichTextEditor value={htmlBody} onChange={setHtmlBody} placeholder="Describe the issue..." minHeight={140} />
        </div>

        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
          <input
            type="checkbox"
            checked={sendEmail}
            onChange={e => setSendEmail(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
          />
          Send this message to the customer by email
          <span className="text-xs text-gray-400">(otherwise ticket is logged silently)</span>
        </label>

        <div className="flex justify-end gap-2 border-t border-gray-200 dark:border-gray-700 pt-4">
          <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button type="submit" loading={submitting}>Create Ticket</Button>
        </div>
      </form>
    </Modal>
  )
}
