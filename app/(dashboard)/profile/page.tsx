'use client'
import { useEffect, useState, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import Header from '@/components/layout/Header'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import RichTextEditor from '@/components/tickets/RichTextEditor'
import toast from 'react-hot-toast'

export default function ProfilePage() {
  const { data: session } = useSession()

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [signature, setSignature] = useState('')
  const [sigLoaded, setSigLoaded] = useState(false)
  const [saving, setSaving] = useState(false)

  // Pre-fill from session immediately (no API call needed for name/email)
  useEffect(() => {
    if (session?.user) {
      setName(session.user.name || '')
      setEmail(session.user.email || '')
    }
  }, [session])

  // Fetch signature separately
  const fetchSignature = useCallback(async () => {
    try {
      const res = await fetch('/api/profile')
      if (!res.ok) return
      const data = await res.json()
      setSignature(data.signature || '')
    } catch {
      // signature stays empty — not fatal
    } finally {
      setSigLoaded(true)
    }
  }, [])

  useEffect(() => { fetchSignature() }, [fetchSignature])

  const handleSave = async () => {
    if (!name.trim()) return toast.error('Name is required')
    setSaving(true)
    try {
      const body: Record<string, string> = { name, email, signature }
      if (password) body.password = password

      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Failed to save')
      }
      toast.success('Profile updated')
      setPassword('')
    } catch (err) {
      toast.error(String(err))
    } finally {
      setSaving(false)
    }
  }

  // Show spinner only until session is available
  if (!session) {
    return (
      <div className="flex h-full flex-col">
        <Header title="Profile" />
        <div className="flex flex-1 items-center justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <Header title="Profile &amp; Signature" />
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-2xl space-y-6">
          {/* Account Info */}
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6">
            <h2 className="mb-4 text-sm font-semibold text-gray-900 dark:text-gray-100">Account Information</h2>
            <div className="space-y-4">
              <Input
                label="Full Name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
              />
              <Input
                label="Email Address"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
              <Input
                label="New Password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Leave blank to keep current password"
              />
              <div>
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Role</span>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400 capitalize">
                  {session.user.role?.replace('_', ' ').toLowerCase()}
                </p>
              </div>
            </div>
          </div>

          {/* Email Signature */}
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6">
            <h2 className="mb-1 text-sm font-semibold text-gray-900 dark:text-gray-100">Email Signature</h2>
            <p className="mb-4 text-xs text-gray-500 dark:text-gray-400">
              Automatically appended to all your outgoing replies.
            </p>
            {sigLoaded ? (
              <RichTextEditor
                value={signature}
                onChange={setSignature}
                placeholder="Write your email signature here..."
                minHeight={120}
              />
            ) : (
              <div className="h-24 animate-pulse rounded-lg bg-gray-100 dark:bg-gray-700" />
            )}
          </div>

          <div className="flex justify-end">
            <Button loading={saving} onClick={handleSave}>
              Save Changes
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
