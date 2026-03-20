'use client'
import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import Header from '@/components/layout/Header'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import RichTextEditor from '@/components/tickets/RichTextEditor'
import { Plus, Pencil, Trash2, Globe, Lock } from 'lucide-react'
import { formatDate } from '@/lib/utils'
import toast from 'react-hot-toast'

interface CannedReply {
  id: string
  title: string
  body: string
  htmlBody?: string
  isGlobal: boolean
  createdById: string | null
  createdBy: { id: string; name: string } | null
  createdAt: string
}

const emptyForm = { title: '', body: '', htmlBody: '' }

export default function CannedRepliesPage() {
  const { data: session } = useSession()
  const isSuperAdmin = session?.user?.role === 'SUPER_ADMIN'
  const userId = session?.user?.id

  const [replies, setReplies] = useState<CannedReply[]>([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<CannedReply | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)

  const fetchReplies = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/canned-replies')
      if (!res.ok) return
      setReplies(await res.json())
    } catch {
      // non-fatal
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchReplies() }, [])

  const canModify = (reply: CannedReply) => {
    if (isSuperAdmin) return true
    if (reply.isGlobal) return false
    return reply.createdById === userId
  }

  const openCreate = () => {
    setEditing(null)
    setForm(emptyForm)
    setModalOpen(true)
  }

  const openEdit = (cr: CannedReply) => {
    setEditing(cr)
    setForm({ title: cr.title, body: cr.body, htmlBody: cr.htmlBody || '' })
    setModalOpen(true)
  }

  const handleSave = async () => {
    if (!form.title.trim() || !form.body.trim()) return toast.error('Title and body are required')
    setSaving(true)
    try {
      const url = editing ? `/api/canned-replies/${editing.id}` : '/api/canned-replies'
      const method = editing ? 'PATCH' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Failed to save')
      }
      toast.success(editing ? 'Updated' : 'Created')
      setModalOpen(false)
      fetchReplies()
    } catch (err) {
      toast.error(String(err instanceof Error ? err.message : 'Failed to save canned reply'))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (cr: CannedReply) => {
    if (!confirm(`Delete "${cr.title}"?`)) return
    try {
      const res = await fetch(`/api/canned-replies/${cr.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Failed to delete')
      }
      toast.success('Deleted')
      fetchReplies()
    } catch (err) {
      toast.error(String(err instanceof Error ? err.message : 'Failed to delete'))
    }
  }

  const stripHtml = (html: string) => {
    const div = document.createElement('div')
    div.innerHTML = html
    return div.textContent || div.innerText || ''
  }

  const handleHtmlChange = (html: string) => {
    setForm((prev) => ({ ...prev, htmlBody: html, body: stripHtml(html) }))
  }

  const globalReplies = replies.filter(r => r.isGlobal)
  const localReplies = replies.filter(r => !r.isGlobal)

  return (
    <div className="flex h-full flex-col">
      <Header title={`Canned Replies (${replies.length})`} />

      <div className="flex-1 overflow-y-auto p-6">
        <div className="mb-4 flex items-center justify-between">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Save common responses to quickly insert into replies.
            {isSuperAdmin && (
              <span className="ml-1 text-indigo-600 dark:text-indigo-400 font-medium">
                Your replies are saved as Global and visible to all agents.
              </span>
            )}
          </p>
          <Button onClick={openCreate} size="sm">
            <Plus className="h-4 w-4" />
            Add Canned Reply
          </Button>
        </div>

        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-20 animate-pulse rounded-lg bg-gray-100 dark:bg-gray-700" />
            ))}
          </div>
        ) : replies.length === 0 ? (
          <div className="rounded-lg border-2 border-dashed border-gray-200 dark:border-gray-700 py-16 text-center text-gray-400">
            <p className="text-sm">No canned replies yet.</p>
            <button onClick={openCreate} className="mt-2 text-sm text-indigo-600 hover:underline">
              Create your first one
            </button>
          </div>
        ) : (
          <div className="space-y-6">
            {globalReplies.length > 0 && (
              <div>
                <div className="mb-2 flex items-center gap-2">
                  <Globe className="h-4 w-4 text-indigo-500" />
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                    Global
                  </h2>
                  <span className="text-xs text-gray-400">({globalReplies.length}) — shared with all agents</span>
                </div>
                <div className="space-y-2">
                  {globalReplies.map((cr) => (
                    <ReplyCard
                      key={cr.id}
                      reply={cr}
                      canModify={canModify(cr)}
                      onEdit={() => openEdit(cr)}
                      onDelete={() => handleDelete(cr)}
                    />
                  ))}
                </div>
              </div>
            )}

            {localReplies.length > 0 && (
              <div>
                <div className="mb-2 flex items-center gap-2">
                  <Lock className="h-4 w-4 text-gray-400" />
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    Local
                  </h2>
                  <span className="text-xs text-gray-400">({localReplies.length}) — created by individual agents</span>
                </div>
                <div className="space-y-2">
                  {localReplies.map((cr) => (
                    <ReplyCard
                      key={cr.id}
                      reply={cr}
                      canModify={canModify(cr)}
                      onEdit={() => openEdit(cr)}
                      onDelete={() => handleDelete(cr)}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Edit Canned Reply' : 'Add Canned Reply'}
        size="lg"
      >
        <div className="space-y-4">
          {isSuperAdmin && !editing && (
            <p className="rounded-md bg-indigo-50 dark:bg-indigo-900/20 px-3 py-2 text-xs text-indigo-700 dark:text-indigo-300">
              <Globe className="inline h-3.5 w-3.5 mr-1" />
              This will be saved as a <strong>Global</strong> reply — visible to all agents.
            </p>
          )}
          <Input
            label="Title"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="e.g. Thank you for contacting us"
          />
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Body</label>
            <RichTextEditor
              value={form.htmlBody}
              onChange={handleHtmlChange}
              placeholder="Write your canned reply..."
              minHeight={160}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button size="sm" loading={saving} onClick={handleSave}>
              {editing ? 'Save Changes' : 'Create'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

function ReplyCard({
  reply,
  canModify,
  onEdit,
  onDelete,
}: {
  reply: CannedReply
  canModify: boolean
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <div className="flex items-start justify-between rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-medium text-gray-900 dark:text-gray-100">{reply.title}</p>
          {reply.isGlobal ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-indigo-100 dark:bg-indigo-900/30 px-2 py-0.5 text-xs font-medium text-indigo-700 dark:text-indigo-300">
              <Globe className="h-3 w-3" />Global
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 dark:bg-gray-700 px-2 py-0.5 text-xs font-medium text-gray-500 dark:text-gray-400">
              <Lock className="h-3 w-3" />Local
            </span>
          )}
        </div>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400 line-clamp-2">{reply.body}</p>
        <p className="mt-1 text-xs text-gray-400">
          {formatDate(reply.createdAt)}
          {reply.createdBy && <span className="ml-1">· by {reply.createdBy.name}</span>}
        </p>
      </div>
      <div className="ml-4 flex shrink-0 items-center gap-2">
        {canModify ? (
          <>
            <button onClick={onEdit} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300" title="Edit">
              <Pencil className="h-4 w-4" />
            </button>
            <button onClick={onDelete} className="text-red-400 hover:text-red-600" title="Delete">
              <Trash2 className="h-4 w-4" />
            </button>
          </>
        ) : (
          <span className="text-xs text-gray-400 italic">read-only</span>
        )}
      </div>
    </div>
  )
}
