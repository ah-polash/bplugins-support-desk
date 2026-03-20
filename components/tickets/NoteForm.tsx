'use client'
import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import toast from 'react-hot-toast'

interface NoteFormProps {
  ticketId: string
  onNote?: () => void
}

export default function NoteForm({ ticketId, onNote }: NoteFormProps) {
  const [body, setBody] = useState('')
  const [saving, setSaving] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!body.trim()) return

    setSaving(true)
    try {
      const res = await fetch(`/api/tickets/${ticketId}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      })
      if (!res.ok) throw new Error('Failed to add note')
      toast.success('Note added')
      setBody('')
      onNote?.()
    } catch {
      toast.error('Failed to add note')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2">
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Add an internal note (not visible to the customer)..."
        rows={3}
        className="w-full resize-none rounded-lg border border-yellow-300 bg-yellow-50 px-3 py-2 text-sm text-gray-800 placeholder-gray-400 focus:border-yellow-400 focus:outline-none focus:ring-1 focus:ring-yellow-400"
      />
      <div className="flex justify-end">
        <Button type="submit" loading={saving} size="sm" variant="secondary">
          Add Note
        </Button>
      </div>
    </form>
  )
}
