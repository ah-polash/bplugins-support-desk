'use client'
import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import Header from '@/components/layout/Header'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Plus, Pencil, Trash2, CheckCircle2, XCircle, RefreshCw } from 'lucide-react'
import { formatDate } from '@/lib/utils'
import toast from 'react-hot-toast'

interface EmailAccount {
  id: string
  name: string
  email: string
  imapHost: string
  imapPort: number
  imapSecure: boolean
  smtpHost: string
  smtpPort: number
  smtpSecure: boolean
  username: string
  isActive: boolean
  lastSyncAt?: string
  createdAt: string
}

const emptyForm = {
  name: '', email: '', username: '', password: '',
  imapHost: '', imapPort: 993, imapSecure: true,
  smtpHost: '', smtpPort: 587, smtpSecure: false,
}

export default function SettingsPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [accounts, setAccounts] = useState<EmailAccount[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (status === 'authenticated' && session?.user?.role !== 'SUPER_ADMIN') {
      router.replace('/inbox')
    }
  }, [status, session, router])
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<EmailAccount | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState<string | null>(null)

  const fetchAccounts = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/email-accounts')
      if (!res.ok) return
      setAccounts(await res.json())
    } catch {
      // non-fatal
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchAccounts() }, [])

  const openCreate = () => {
    setEditing(null)
    setForm(emptyForm)
    setModalOpen(true)
  }

  const openEdit = (acc: EmailAccount) => {
    setEditing(acc)
    setForm({
      name: acc.name, email: acc.email, username: acc.username, password: '',
      imapHost: acc.imapHost, imapPort: acc.imapPort, imapSecure: acc.imapSecure,
      smtpHost: acc.smtpHost, smtpPort: acc.smtpPort, smtpSecure: acc.smtpSecure,
    })
    setModalOpen(true)
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const url = editing ? `/api/email-accounts/${editing.id}` : '/api/email-accounts'
      const method = editing ? 'PATCH' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error)
      }
      toast.success(editing ? 'Account updated' : 'Account created')
      setModalOpen(false)
      fetchAccounts()
    } catch (err) {
      toast.error(String(err))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this email account?')) return
    try {
      await fetch(`/api/email-accounts/${id}`, { method: 'DELETE' })
      toast.success('Account deleted')
      fetchAccounts()
    } catch {
      toast.error('Failed to delete')
    }
  }

  const handleTest = async (id: string) => {
    setTesting(id)
    try {
      const res = await fetch(`/api/email-accounts/${id}`, { method: 'POST' })
      const data = await res.json()
      if (data.success) toast.success('SMTP connection successful')
      else toast.error('SMTP connection failed')
    } catch {
      toast.error('Test failed')
    } finally {
      setTesting(null)
    }
  }

  const f = (key: string, val: string | number | boolean) => setForm((prev) => ({ ...prev, [key]: val }))

  return (
    <div className="flex h-full flex-col">
      <Header title="Email Accounts" />

      <div className="flex-1 overflow-y-auto p-6">
        <div className="mb-4 flex items-center justify-between">
          <p className="text-sm text-gray-500">
            Configure IMAP and SMTP settings for your support email address(es).
          </p>
          <Button onClick={openCreate} size="sm">
            <Plus className="h-4 w-4" />
            Add Email Account
          </Button>
        </div>

        <div className="flex flex-col gap-4">
          {loading ? (
            <div className="h-24 animate-pulse rounded-lg bg-gray-100" />
          ) : accounts.map((acc) => (
            <div key={acc.id} className="rounded-lg border border-gray-200 bg-white p-5">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-medium text-gray-900">{acc.name}</h3>
                    {acc.isActive
                      ? <CheckCircle2 className="h-4 w-4 text-green-500" />
                      : <XCircle className="h-4 w-4 text-gray-400" />
                    }
                  </div>
                  <p className="text-sm text-gray-500">{acc.email}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    loading={testing === acc.id}
                    onClick={() => handleTest(acc.id)}
                  >
                    <RefreshCw className="h-3 w-3" />
                    Test
                  </Button>
                  <button onClick={() => openEdit(acc)} className="text-gray-400 hover:text-gray-600">
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button onClick={() => handleDelete(acc.id)} className="text-red-400 hover:text-red-600">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-gray-500">
                <span>IMAP: {acc.imapHost}:{acc.imapPort} {acc.imapSecure ? '(SSL)' : ''}</span>
                <span>SMTP: {acc.smtpHost}:{acc.smtpPort} {acc.smtpSecure ? '(SSL)' : ''}</span>
                {acc.lastSyncAt && <span>Last sync: {formatDate(acc.lastSyncAt)}</span>}
              </div>
            </div>
          ))}

          {!loading && accounts.length === 0 && (
            <div className="rounded-lg border-2 border-dashed border-gray-200 py-16 text-center text-gray-400">
              <p className="text-sm">No email accounts configured.</p>
              <button onClick={openCreate} className="mt-2 text-sm text-indigo-600 hover:underline">
                Add your first email account
              </button>
            </div>
          )}
        </div>
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit Email Account' : 'Add Email Account'} size="lg">
        <div className="grid grid-cols-2 gap-4">
          <Input label="Account Name" value={form.name} onChange={(e) => f('name', e.target.value)} placeholder="Support" className="col-span-2" />
          <Input label="Email Address" type="email" value={form.email} onChange={(e) => f('email', e.target.value)} placeholder="support@bplugins.com" className="col-span-2" />
          <Input label="Username" value={form.username} onChange={(e) => f('username', e.target.value)} placeholder="Same as email usually" className="col-span-2" />
          <Input label={editing ? 'Password (leave blank to keep)' : 'Password'} type="password" value={form.password} onChange={(e) => f('password', e.target.value)} placeholder="••••••••" className="col-span-2" />

          <div className="col-span-2 border-t border-gray-100 pt-3">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">IMAP Settings</p>
            <div className="grid grid-cols-2 gap-4">
              <Input label="IMAP Host" value={form.imapHost} onChange={(e) => f('imapHost', e.target.value)} placeholder="imap.gmail.com" />
              <Input label="IMAP Port" type="number" value={form.imapPort} onChange={(e) => f('imapPort', Number(e.target.value))} />
              <label className="flex items-center gap-2 text-sm text-gray-700 col-span-2">
                <input type="checkbox" checked={form.imapSecure} onChange={(e) => f('imapSecure', e.target.checked)} className="h-4 w-4 rounded" />
                Use SSL/TLS
              </label>
            </div>
          </div>

          <div className="col-span-2 border-t border-gray-100 pt-3">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">SMTP Settings</p>
            <div className="grid grid-cols-2 gap-4">
              <Input label="SMTP Host" value={form.smtpHost} onChange={(e) => f('smtpHost', e.target.value)} placeholder="smtp.gmail.com" />
              <Input label="SMTP Port" type="number" value={form.smtpPort} onChange={(e) => f('smtpPort', Number(e.target.value))} />
              <label className="flex items-center gap-2 text-sm text-gray-700 col-span-2">
                <input type="checkbox" checked={form.smtpSecure} onChange={(e) => f('smtpSecure', e.target.checked)} className="h-4 w-4 rounded" />
                Use SSL/TLS (use for port 465)
              </label>
            </div>
          </div>

          <div className="col-span-2 flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button size="sm" loading={saving} onClick={handleSave}>
              {editing ? 'Save Changes' : 'Create Account'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
