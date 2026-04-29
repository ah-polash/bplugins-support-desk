'use client'
import { useEffect, useState, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import Header from '@/components/layout/Header'
import { Button } from '@/components/ui/Button'
import RichTextEditor from '@/components/tickets/RichTextEditor'
import { AI_PROVIDERS, AI_MODELS, DEFAULT_SYSTEM_PROMPT, type AiProvider } from '@/lib/ai'
import { SPAM_RULE_TYPES, type SpamRuleType } from '@/lib/spam'
import { Sparkles, Eye, EyeOff, CheckCircle2, Shield, Plus, Trash2, ToggleLeft, ToggleRight, AlertTriangle, Clock, Code2, X, Copy, Check, UserPlus } from 'lucide-react'
import toast from 'react-hot-toast'

interface User { id: string; name: string; email: string }

interface Settings {
  defaultAssigneeId: string | null
  autoReplyBody: string | null
  satisfactionSurveyEnabled: boolean
  satisfactionSurveyBody: string | null
  trustpilotUrl: string | null
  aiEnabled: boolean
  aiProvider: AiProvider
  aiApiKey: string | null
  aiApiKeySet: boolean
  aiModel: string
  aiSystemPrompt: string | null
  autoCloseEnabled: boolean
  autoCloseDays: number
  autoCloseEmailBody: string | null
  embedFormEnabled: boolean
  embedFormProducts: string[]
  recaptchaEnabled: boolean
  recaptchaSiteKey: string | null
  recaptchaSecretKey: string | null
  recaptchaSecretKeySet: boolean
  assignmentEmailEnabled: boolean
  assignmentEmailSubject: string | null
  assignmentEmailBody: string | null
}

const defaultSettings: Settings = {
  defaultAssigneeId: null,
  autoReplyBody: null,
  satisfactionSurveyEnabled: false,
  satisfactionSurveyBody: null,
  trustpilotUrl: null,
  aiEnabled: false,
  aiProvider: 'gemini',
  aiApiKey: null,
  aiApiKeySet: false,
  aiModel: 'gemini-2.0-flash',
  aiSystemPrompt: null,
  autoCloseEnabled: false,
  autoCloseDays: 7,
  autoCloseEmailBody: null,
  embedFormEnabled: false,
  embedFormProducts: [],
  recaptchaEnabled: false,
  recaptchaSiteKey: null,
  recaptchaSecretKey: null,
  recaptchaSecretKeySet: false,
  assignmentEmailEnabled: false,
  assignmentEmailSubject: null,
  assignmentEmailBody: null,
}

const ASSIGNMENT_PLACEHOLDERS: { token: string; label: string }[] = [
  { token: '{{agent_name}}',     label: 'Agent name' },
  { token: '{{agent_email}}',    label: 'Agent email' },
  { token: '{{ticket_number}}',  label: 'Ticket #' },
  { token: '{{ticket_subject}}', label: 'Ticket subject' },
  { token: '{{ticket_url}}',     label: 'Ticket URL' },
  { token: '{{ticket_priority}}',label: 'Ticket priority' },
  { token: '{{ticket_status}}',  label: 'Ticket status' },
  { token: '{{customer_name}}',  label: 'Customer name' },
  { token: '{{customer_email}}', label: 'Customer email' },
]

const PROVIDER_LABELS: Record<AiProvider, string> = {
  gemini:     'Powered by Google Gemini',
  openai:     'Powered by OpenAI',
  openrouter: 'Powered by OpenRouter',
}

const KEY_META: Record<AiProvider, { label: string; placeholder: string; href: string; linkText: string }> = {
  gemini:     { label: 'Google AI Studio API Key', placeholder: 'AIza...',    href: 'https://aistudio.google.com/app/apikey', linkText: 'aistudio.google.com' },
  openai:     { label: 'OpenAI API Key',            placeholder: 'sk-...',    href: 'https://platform.openai.com/api-keys',  linkText: 'platform.openai.com' },
  openrouter: { label: 'OpenRouter API Key',        placeholder: 'sk-or-...', href: 'https://openrouter.ai/keys',            linkText: 'openrouter.ai/keys' },
}

export default function AppSettingsPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [settings, setSettings] = useState<Settings>(defaultSettings)
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [showKey, setShowKey] = useState(false)
  const [newApiKey, setNewApiKey] = useState('')
  // Spam rules state
  const [spamRules, setSpamRules] = useState<{ id: string; type: SpamRuleType; value: string; isActive: boolean }[]>([])
  const [newRuleType, setNewRuleType] = useState<SpamRuleType>('subject_keyword')
  const [newRuleValue, setNewRuleValue] = useState('')
  const [addingRule, setAddingRule] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [scanProgress, setScanProgress] = useState<{ processed: number; total: number; moved: number; done?: boolean; message?: string } | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [onlyFreshdesk, setOnlyFreshdesk] = useState(false)
  const [newProduct, setNewProduct] = useState('')
  const [embedCopied, setEmbedCopied] = useState(false)
  const [newRecaptchaSecret, setNewRecaptchaSecret] = useState('')
  const [showRecaptchaSecret, setShowRecaptchaSecret] = useState(false)

  useEffect(() => {
    if (status === 'authenticated' && session?.user?.role !== 'SUPER_ADMIN') {
      router.replace('/inbox')
    }
  }, [status, session, router])

  const fetchSpamRules = useCallback(async () => {
    const res = await fetch('/api/admin/spam-rules')
    if (res.ok) setSpamRules(await res.json())
  }, [])

  useEffect(() => { fetchSpamRules() }, [fetchSpamRules])

  const handleAddRule = async () => {
    if (!newRuleValue.trim()) return toast.error('Enter a value for the rule')
    setAddingRule(true)
    try {
      const res = await fetch('/api/admin/spam-rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: newRuleType, value: newRuleValue.trim() }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Failed')
      const rule = await res.json()
      setSpamRules(prev => [...prev, rule])
      setNewRuleValue('')
      toast.success('Rule added')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add rule')
    } finally {
      setAddingRule(false)
    }
  }

  const handleDeleteRule = async (id: string) => {
    const res = await fetch(`/api/admin/spam-rules/${id}`, { method: 'DELETE' })
    if (res.ok) {
      setSpamRules(prev => prev.filter(r => r.id !== id))
      toast.success('Rule deleted')
    }
  }

  const handleToggleRule = async (id: string, current: boolean) => {
    const res = await fetch(`/api/admin/spam-rules/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !current }),
    })
    if (res.ok) {
      const updated = await res.json()
      setSpamRules(prev => prev.map(r => r.id === id ? { ...r, isActive: updated.isActive } : r))
    }
  }

  const handleScanNow = async () => {
    setScanning(true)
    setScanProgress({ processed: 0, total: 0, moved: 0 })
    try {
      const res = await fetch('/api/admin/spam-rules/scan', { method: 'POST' })
      if (!res.ok || !res.body) throw new Error('Scan request failed')

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.trim()) continue
          try {
            const data = JSON.parse(line)
            if (data.error) { toast.error(data.error); break }
            setScanProgress(data)
          } catch { /* ignore malformed lines */ }
        }
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Scan failed')
      setScanProgress(null)
    } finally {
      setScanning(false)
    }
  }

  const fetchData = useCallback(async () => {
    try {
      const [settingsRes, usersRes] = await Promise.all([
        fetch('/api/admin/app-settings'),
        fetch('/api/users'),
      ])
      if (settingsRes.ok) {
        const s = await settingsRes.json()
        const provider: AiProvider = s.aiProvider || 'gemini'
        setSettings({
          defaultAssigneeId: s.defaultAssigneeId ?? null,
          autoReplyBody: s.autoReplyBody ?? '',
          satisfactionSurveyEnabled: s.satisfactionSurveyEnabled ?? false,
          satisfactionSurveyBody: s.satisfactionSurveyBody ?? '',
          trustpilotUrl: s.trustpilotUrl ?? '',
          aiEnabled: s.aiEnabled ?? false,
          aiProvider: provider,
          aiApiKey: s.aiApiKey ?? null,
          aiApiKeySet: s.aiApiKeySet ?? false,
          aiModel: s.aiModel || AI_MODELS[provider][0].id,
          aiSystemPrompt: s.aiSystemPrompt ?? '',
          autoCloseEnabled: s.autoCloseEnabled ?? false,
          autoCloseDays: s.autoCloseDays ?? 7,
          autoCloseEmailBody: s.autoCloseEmailBody ?? '',
          embedFormEnabled: s.embedFormEnabled ?? false,
          embedFormProducts: s.embedFormProducts ?? [],
          recaptchaEnabled: s.recaptchaEnabled ?? false,
          recaptchaSiteKey: s.recaptchaSiteKey ?? '',
          recaptchaSecretKey: s.recaptchaSecretKey ?? null,
          recaptchaSecretKeySet: s.recaptchaSecretKeySet ?? false,
          assignmentEmailEnabled: s.assignmentEmailEnabled ?? false,
          assignmentEmailSubject: s.assignmentEmailSubject ?? '',
          assignmentEmailBody: s.assignmentEmailBody ?? '',
        })
      }
      if (usersRes.ok) {
        const u = await usersRes.json()
        setUsers((u.users ?? u).filter((x: User & { isActive: boolean }) => x.isActive))
      }
    } catch {
      toast.error('Failed to load settings')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const set = <K extends keyof Settings>(key: K, val: Settings[K]) =>
    setSettings(s => ({ ...s, [key]: val }))

  const handleProviderChange = (provider: AiProvider) => {
    setSettings(s => ({ ...s, aiProvider: provider, aiModel: AI_MODELS[provider][0].id }))
    setNewApiKey('')
    setShowKey(false)
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const payload = {
        ...settings,
        aiApiKey: newApiKey.trim() || settings.aiApiKey,
        aiSystemPrompt: settings.aiSystemPrompt || null,
        recaptchaSecretKey: newRecaptchaSecret.trim() || settings.recaptchaSecretKey,
      }
      const res = await fetch('/api/admin/app-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to save')
      const saved = await res.json()
      setSettings(s => ({ ...s, aiApiKey: saved.aiApiKey, aiApiKeySet: saved.aiApiKeySet, recaptchaSecretKey: saved.recaptchaSecretKey, recaptchaSecretKeySet: saved.recaptchaSecretKeySet }))
      setNewApiKey('')
      setShowKey(false)
      setNewRecaptchaSecret('')
      setShowRecaptchaSecret(false)
      toast.success('Settings saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const handleTestAi = async () => {
    setTesting(true)
    try {
      const res = await fetch('/api/ai/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: newApiKey.trim() || undefined,
          model: settings.aiModel,
          provider: settings.aiProvider,
        }),
      })
      const data = await res.json()
      if (res.ok && data.success) {
        toast.success('API key is valid and working!')
      } else {
        toast.error(data.error || 'Connection test failed')
      }
    } catch {
      toast.error('Test request failed')
    } finally {
      setTesting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex h-full flex-col">
        <Header title="App Settings" />
        <div className="flex flex-1 items-center justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
        </div>
      </div>
    )
  }

  const keyMeta = KEY_META[settings.aiProvider]
  const models = AI_MODELS[settings.aiProvider]

  return (
    <div className="flex h-full flex-col">
      <Header title="App Settings" />
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-2xl space-y-6">

          {/* Default Assignee */}
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6">
            <h2 className="mb-1 text-sm font-semibold text-gray-900 dark:text-gray-100">Default Assignee</h2>
            <p className="mb-4 text-xs text-gray-500 dark:text-gray-400">
              Who gets assigned new tickets automatically when no rule matches.
            </p>
            <select
              value={settings.defaultAssigneeId ?? ''}
              onChange={(e) => set('defaultAssigneeId', e.target.value || null)}
              className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            >
              <option value="">— Least-loaded agent (default) —</option>
              {users.map(u => (
                <option key={u.id} value={u.id}>{u.name} ({u.email})</option>
              ))}
            </select>
          </div>

          {/* Auto Reply */}
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6">
            <h2 className="mb-1 text-sm font-semibold text-gray-900 dark:text-gray-100">Auto Reply Email</h2>
            <p className="mb-4 text-xs text-gray-500 dark:text-gray-400">
              Automatically sent when a new ticket is created. Leave blank to disable.
            </p>
            <RichTextEditor
              value={settings.autoReplyBody ?? ''}
              onChange={(val) => set('autoReplyBody', val)}
              placeholder="e.g. Thank you for contacting us..."
              minHeight={160}
            />
          </div>

          {/* Satisfaction Survey */}
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Satisfaction Survey Email</h2>
              <button
                type="button"
                onClick={() => set('satisfactionSurveyEnabled', !settings.satisfactionSurveyEnabled)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  settings.satisfactionSurveyEnabled ? 'bg-indigo-500' : 'bg-gray-300 dark:bg-gray-600'
                }`}
                aria-label="Toggle satisfaction survey email"
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                  settings.satisfactionSurveyEnabled ? 'translate-x-6' : 'translate-x-1'
                }`} />
              </button>
            </div>

            {!settings.satisfactionSurveyEnabled ? (
              <p className="text-xs text-gray-400 dark:text-gray-500">
                Enable to automatically email customers a rating request when their ticket is resolved or closed.
              </p>
            ) : (
              <>
                <p className="mb-4 text-xs text-gray-500 dark:text-gray-400">
                  Automatically sent when a ticket is resolved or closed. Rating buttons are appended below this body.
                </p>
                <RichTextEditor
                  value={settings.satisfactionSurveyBody ?? ''}
                  onChange={(val) => set('satisfactionSurveyBody', val)}
                  placeholder="e.g. Your ticket has been resolved. We'd love your feedback..."
                  minHeight={160}
                />
              </>
            )}
          </div>

          {/* Trustpilot URL */}
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6">
            <h2 className="mb-1 text-sm font-semibold text-gray-900 dark:text-gray-100">Trustpilot Review Link</h2>
            <p className="mb-4 text-xs text-gray-500 dark:text-gray-400">
              When a customer rates their experience as Satisfied, they&apos;ll be invited to leave a review here.
            </p>
            <input
              type="url"
              value={settings.trustpilotUrl ?? ''}
              onChange={(e) => set('trustpilotUrl', e.target.value || null)}
              placeholder="https://www.trustpilot.com/review/yourcompany.com"
              className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          {/* Auto Close Ticket */}
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-orange-500" />
                <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Auto Close Tickets</h2>
              </div>
              <button
                type="button"
                onClick={() => set('autoCloseEnabled', !settings.autoCloseEnabled)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  settings.autoCloseEnabled ? 'bg-orange-500' : 'bg-gray-300 dark:bg-gray-600'
                }`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                  settings.autoCloseEnabled ? 'translate-x-6' : 'translate-x-1'
                }`} />
              </button>
            </div>

            {!settings.autoCloseEnabled && (
              <p className="text-xs text-gray-400 dark:text-gray-500">
                Enable to automatically close resolved tickets after a set number of days with no new customer replies.
              </p>
            )}

            {settings.autoCloseEnabled && (
              <div className="space-y-5">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                    Close after (days)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={365}
                    value={settings.autoCloseDays}
                    onChange={(e) => set('autoCloseDays', Math.max(1, Math.min(365, parseInt(e.target.value, 10) || 7)))}
                    className="w-32 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500"
                  />
                  <p className="mt-1 text-xs text-gray-400">
                    Resolved tickets with no customer reply for this many days will be automatically closed.
                  </p>
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                    Auto Close Email Template
                  </label>
                  <p className="mb-2 text-xs text-gray-400">
                    Sent to the customer when their ticket is auto-closed. Leave blank to close silently without sending an email.
                  </p>
                  <RichTextEditor
                    value={settings.autoCloseEmailBody ?? ''}
                    onChange={(val) => set('autoCloseEmailBody', val)}
                    placeholder="e.g. Your ticket has been automatically closed due to inactivity. If you still need help, simply reply to reopen it."
                    minHeight={120}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Agent Assignment Email */}
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <UserPlus className="h-4 w-4 text-blue-500" />
                <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Agent Assignment Email</h2>
              </div>
              <button
                type="button"
                onClick={() => set('assignmentEmailEnabled', !settings.assignmentEmailEnabled)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  settings.assignmentEmailEnabled ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'
                }`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                  settings.assignmentEmailEnabled ? 'translate-x-6' : 'translate-x-1'
                }`} />
              </button>
            </div>

            {!settings.assignmentEmailEnabled && (
              <p className="text-xs text-gray-400 dark:text-gray-500">
                Enable to email an agent every time a ticket is assigned to them — manual assign, bulk assign, or auto-assign.
              </p>
            )}

            {settings.assignmentEmailEnabled && (
              <div className="space-y-5">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                    Subject
                  </label>
                  <input
                    type="text"
                    value={settings.assignmentEmailSubject ?? ''}
                    onChange={(e) => set('assignmentEmailSubject', e.target.value)}
                    placeholder="New ticket assigned to you: #{{ticket_number}} — {{ticket_subject}}"
                    className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                  <p className="mt-1 text-xs text-gray-400">
                    Leave blank to use the default subject.
                  </p>
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                    Email Body
                  </label>
                  <p className="mb-2 text-xs text-gray-400">
                    Sent to the agent when a ticket is assigned. Leave blank to use the default template.
                  </p>
                  <RichTextEditor
                    value={settings.assignmentEmailBody ?? ''}
                    onChange={(val) => set('assignmentEmailBody', val)}
                    placeholder="Hi {{agent_name}}, ticket #{{ticket_number}} has been assigned to you..."
                    minHeight={180}
                  />
                </div>

                <div className="rounded-md border border-blue-100 dark:border-blue-900 bg-blue-50/60 dark:bg-blue-900/10 px-3 py-3">
                  <p className="text-xs font-medium text-blue-700 dark:text-blue-300 mb-2">
                    Available placeholders
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {ASSIGNMENT_PLACEHOLDERS.map(p => (
                      <span
                        key={p.token}
                        title={p.label}
                        className="rounded bg-white dark:bg-gray-800 border border-blue-200 dark:border-blue-800 px-2 py-0.5 text-[11px] font-mono text-blue-700 dark:text-blue-300"
                      >
                        {p.token}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Embed Form */}
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Code2 className="h-4 w-4 text-emerald-500" />
                <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Embed Form</h2>
              </div>
              <button
                type="button"
                onClick={() => set('embedFormEnabled', !settings.embedFormEnabled)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  settings.embedFormEnabled ? 'bg-emerald-500' : 'bg-gray-300 dark:bg-gray-600'
                }`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                  settings.embedFormEnabled ? 'translate-x-6' : 'translate-x-1'
                }`} />
              </button>
            </div>

            {!settings.embedFormEnabled && (
              <p className="text-xs text-gray-400 dark:text-gray-500">
                Enable to allow embedding a support ticket form on your external websites via iframe.
              </p>
            )}

            {settings.embedFormEnabled && (
              <div className="space-y-5">
                {/* Product Names */}
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                    Product Names
                  </label>
                  <p className="mb-2 text-xs text-gray-400">
                    These appear as a dropdown in the embed form. Add at least one product.
                  </p>
                  <div className="flex gap-2 mb-3">
                    <input
                      type="text"
                      value={newProduct}
                      onChange={(e) => setNewProduct(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          const val = newProduct.trim()
                          if (val && !settings.embedFormProducts.includes(val)) {
                            setSettings(s => ({ ...s, embedFormProducts: [...s.embedFormProducts, val] }))
                            setNewProduct('')
                          }
                        }
                      }}
                      placeholder="e.g. Post Starter Templates"
                      className="flex-1 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                    />
                    <Button
                      size="sm"
                      onClick={() => {
                        const val = newProduct.trim()
                        if (val && !settings.embedFormProducts.includes(val)) {
                          setSettings(s => ({ ...s, embedFormProducts: [...s.embedFormProducts, val] }))
                          setNewProduct('')
                        }
                      }}
                      disabled={!newProduct.trim()}
                    >
                      <Plus className="h-4 w-4" /> Add
                    </Button>
                  </div>

                  {settings.embedFormProducts.length === 0 ? (
                    <p className="text-sm text-gray-400 dark:text-gray-500 py-2">No products added yet.</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {settings.embedFormProducts.map((p, i) => (
                        <span
                          key={i}
                          className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 dark:bg-emerald-900/30 px-3 py-1 text-sm text-emerald-700 dark:text-emerald-300"
                        >
                          {p}
                          <button
                            type="button"
                            onClick={() => setSettings(s => ({ ...s, embedFormProducts: s.embedFormProducts.filter((_, j) => j !== i) }))}
                            className="text-emerald-400 hover:text-emerald-600 dark:hover:text-emerald-200"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Embed Code */}
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                    Embed Code
                  </label>
                  <p className="mb-2 text-xs text-gray-400">
                    Copy this HTML snippet and paste it into your website to show the support form.
                  </p>
                  <div className="relative">
                    <pre className="rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 p-3 text-xs text-gray-700 dark:text-gray-300 overflow-x-auto whitespace-pre-wrap break-all">
{`<iframe
  src="${typeof window !== 'undefined' ? window.location.origin : ''}/embed/form"
  width="100%"
  height="600"
  frameborder="0"
  style="border: none; max-width: 520px;"
></iframe>`}
                    </pre>
                    <button
                      type="button"
                      onClick={() => {
                        const code = `<iframe\n  src="${window.location.origin}/embed/form"\n  width="100%"\n  height="600"\n  frameborder="0"\n  style="border: none; max-width: 520px;"\n></iframe>`
                        navigator.clipboard.writeText(code)
                        setEmbedCopied(true)
                        setTimeout(() => setEmbedCopied(false), 2000)
                      }}
                      className="absolute top-2 right-2 rounded-md bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 p-1.5 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                      title="Copy embed code"
                    >
                      {embedCopied ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                {/* reCAPTCHA */}
                <div className="border-t border-gray-100 dark:border-gray-700 pt-5">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <p className="text-sm font-medium text-gray-800 dark:text-gray-200">Google reCAPTCHA v2</p>
                      <p className="text-xs text-gray-400 mt-0.5">Protect your form from spam and bots.</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => set('recaptchaEnabled', !settings.recaptchaEnabled)}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                        settings.recaptchaEnabled ? 'bg-emerald-500' : 'bg-gray-300 dark:bg-gray-600'
                      }`}
                    >
                      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                        settings.recaptchaEnabled ? 'translate-x-6' : 'translate-x-1'
                      }`} />
                    </button>
                  </div>

                  {settings.recaptchaEnabled && (
                    <div className="space-y-4">
                      <div>
                        <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                          Site Key
                        </label>
                        <input
                          type="text"
                          value={settings.recaptchaSiteKey ?? ''}
                          onChange={(e) => set('recaptchaSiteKey', e.target.value || null)}
                          placeholder="6Le..."
                          className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                        />
                      </div>

                      <div>
                        <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                          Secret Key
                        </label>
                        {settings.recaptchaSecretKeySet && !showRecaptchaSecret && !newRecaptchaSecret && (
                          <div className="mb-2 flex items-center gap-2 rounded-md bg-green-50 dark:bg-green-900/20 px-3 py-2 text-xs text-green-700 dark:text-green-400">
                            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                            Secret key is set ({settings.recaptchaSecretKey})
                            <button
                              type="button"
                              onClick={() => setShowRecaptchaSecret(true)}
                              className="ml-auto text-indigo-600 hover:underline"
                            >
                              Replace
                            </button>
                          </div>
                        )}
                        {(!settings.recaptchaSecretKeySet || showRecaptchaSecret) && (
                          <div className="relative">
                            <input
                              type={showRecaptchaSecret ? 'text' : 'password'}
                              value={newRecaptchaSecret}
                              onChange={(e) => setNewRecaptchaSecret(e.target.value)}
                              placeholder="6Le..."
                              className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 pr-10 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                            />
                            <button
                              type="button"
                              onClick={() => setShowRecaptchaSecret(v => !v)}
                              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                            >
                              {showRecaptchaSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                            </button>
                          </div>
                        )}
                        <p className="mt-1 text-xs text-gray-400">
                          Get your keys at{' '}
                          <a
                            href="https://www.google.com/recaptcha/admin"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-emerald-500 hover:underline"
                          >
                            google.com/recaptcha/admin
                          </a>
                          {' '}— choose reCAPTCHA v2 &quot;I&apos;m not a robot&quot; checkbox.
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* AI Reply Settings */}
          <div className="rounded-lg border border-indigo-200 dark:border-indigo-800 bg-white dark:bg-gray-800 p-6">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-indigo-500" />
                <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">AI Reply</h2>
                <span className="rounded-full bg-indigo-100 dark:bg-indigo-900/40 px-2 py-0.5 text-xs font-medium text-indigo-700 dark:text-indigo-300">
                  {PROVIDER_LABELS[settings.aiProvider]}
                </span>
              </div>
              <button
                type="button"
                onClick={() => set('aiEnabled', !settings.aiEnabled)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  settings.aiEnabled ? 'bg-indigo-600' : 'bg-gray-300 dark:bg-gray-600'
                }`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                  settings.aiEnabled ? 'translate-x-6' : 'translate-x-1'
                }`} />
              </button>
            </div>

            {!settings.aiEnabled && (
              <p className="text-xs text-gray-400 dark:text-gray-500">
                Enable to let agents generate AI-drafted replies inside tickets using the configured AI provider.
              </p>
            )}

            {settings.aiEnabled && (
              <div className="space-y-5">
                {/* Provider */}
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">AI Provider</label>
                  <select
                    value={settings.aiProvider}
                    onChange={(e) => handleProviderChange(e.target.value as AiProvider)}
                    className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  >
                    {AI_PROVIDERS.map(p => (
                      <option key={p.id} value={p.id}>{p.label}</option>
                    ))}
                  </select>
                </div>

                {/* API Key */}
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                    {keyMeta.label}
                  </label>
                  {settings.aiApiKeySet && !showKey && !newApiKey && (
                    <div className="mb-2 flex items-center gap-2 rounded-md bg-green-50 dark:bg-green-900/20 px-3 py-2 text-xs text-green-700 dark:text-green-400">
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                      API key is set ({settings.aiApiKey})
                      <button
                        type="button"
                        onClick={() => setShowKey(true)}
                        className="ml-auto text-indigo-600 hover:underline"
                      >
                        Replace
                      </button>
                    </div>
                  )}
                  {(!settings.aiApiKeySet || showKey) && (
                    <div className="relative">
                      <input
                        type={showKey ? 'text' : 'password'}
                        value={newApiKey}
                        onChange={(e) => setNewApiKey(e.target.value)}
                        placeholder={keyMeta.placeholder}
                        className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 pr-10 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      />
                      <button
                        type="button"
                        onClick={() => setShowKey(v => !v)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                      >
                        {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  )}
                  <p className="mt-1 text-xs text-gray-400">
                    Get your key at{' '}
                    <a
                      href={keyMeta.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-indigo-500 hover:underline"
                    >
                      {keyMeta.linkText}
                    </a>
                  </p>
                </div>

                {/* Model */}
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Model</label>
                  <select
                    value={settings.aiModel}
                    onChange={(e) => set('aiModel', e.target.value)}
                    className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  >
                    {models.map(m => (
                      <option key={m.id} value={m.id}>{m.label}</option>
                    ))}
                  </select>
                </div>

                {/* System Prompt */}
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                    System Prompt / AI Persona
                  </label>
                  <textarea
                    rows={4}
                    value={settings.aiSystemPrompt ?? ''}
                    onChange={(e) => set('aiSystemPrompt', e.target.value)}
                    placeholder={DEFAULT_SYSTEM_PROMPT}
                    className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 resize-y"
                  />
                  <p className="mt-1 text-xs text-gray-400">
                    Leave blank to use the default prompt. Customise the AI&apos;s tone and persona here.
                  </p>
                </div>

                {/* Test button */}
                <div className="flex items-center gap-3">
                  <Button
                    variant="outline"
                    size="sm"
                    loading={testing}
                    onClick={handleTestAi}
                    disabled={!settings.aiApiKeySet && !newApiKey.trim()}
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    Test Connection
                  </Button>
                  {!settings.aiApiKeySet && !newApiKey && (
                    <p className="text-xs text-gray-400">Enter an API key first</p>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Spam Rules */}
          <div className="rounded-lg border border-red-200 dark:border-red-900 bg-white dark:bg-gray-800 p-6">
            <div className="mb-4 flex items-center gap-2">
              <Shield className="h-4 w-4 text-red-500" />
              <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Spam Rules</h2>
              <span className="rounded-full bg-red-100 dark:bg-red-900/40 px-2 py-0.5 text-xs font-medium text-red-700 dark:text-red-300">
                {spamRules.filter(r => r.isActive).length} active
              </span>
            </div>
            <p className="mb-4 text-xs text-gray-500 dark:text-gray-400">
              Tickets matching any active rule are automatically moved to the Spam folder — during email sync, inbox import, and manual import. Agents never see them unless you restore them.
            </p>

            {/* Add rule form */}
            <div className="mb-4 flex gap-2">
              <select
                value={newRuleType}
                onChange={(e) => setNewRuleType(e.target.value as SpamRuleType)}
                className="rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-2 py-2 text-sm text-gray-900 dark:text-gray-100 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
              >
                {SPAM_RULE_TYPES.map(t => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
              <input
                type="text"
                value={newRuleValue}
                onChange={(e) => setNewRuleValue(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddRule()}
                placeholder={
                  newRuleType === 'sender_domain' ? 'e.g. spam.com' :
                  newRuleType === 'sender_email'  ? 'e.g. noreply@spam.com' :
                  'e.g. free money'
                }
                className="flex-1 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
              />
              <Button size="sm" loading={addingRule} onClick={handleAddRule}>
                <Plus className="h-4 w-4" /> Add
              </Button>
            </div>
            <p className="mb-3 text-xs text-gray-400">
              {SPAM_RULE_TYPES.find(t => t.value === newRuleType)?.description}
            </p>

            {/* Rules list */}
            {spamRules.length === 0 ? (
              <p className="text-sm text-gray-400 dark:text-gray-500 py-2">No spam rules configured yet.</p>
            ) : (
              <div className="divide-y divide-gray-100 dark:divide-gray-700 rounded-md border border-gray-200 dark:border-gray-700">
                {spamRules.map(rule => {
                  const typeInfo = SPAM_RULE_TYPES.find(t => t.value === rule.type)
                  return (
                    <div key={rule.id} className={`flex items-center gap-3 px-3 py-2.5 ${!rule.isActive ? 'opacity-50' : ''}`}>
                      <span className="rounded bg-red-100 dark:bg-red-900/40 px-1.5 py-0.5 text-xs font-medium text-red-700 dark:text-red-300 shrink-0">
                        {typeInfo?.label ?? rule.type}
                      </span>
                      <span className="flex-1 text-sm text-gray-800 dark:text-gray-200 font-mono truncate">{rule.value}</span>
                      <button
                        onClick={() => handleToggleRule(rule.id, rule.isActive)}
                        className={`shrink-0 ${rule.isActive ? 'text-green-500 hover:text-green-700' : 'text-gray-400 hover:text-gray-600'}`}
                        title={rule.isActive ? 'Disable rule' : 'Enable rule'}
                      >
                        {rule.isActive
                          ? <ToggleRight className="h-5 w-5" />
                          : <ToggleLeft className="h-5 w-5" />
                        }
                      </button>
                      <button
                        onClick={() => handleDeleteRule(rule.id)}
                        className="shrink-0 text-gray-400 hover:text-red-500"
                        title="Delete rule"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Scan Now */}
            <div className="mt-5 border-t border-gray-100 dark:border-gray-700 pt-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-sm font-medium text-gray-800 dark:text-gray-200">Scan Existing Tickets</p>
                  <p className="text-xs text-gray-400 mt-0.5">Apply current spam rules to all non-spam tickets in your inbox.</p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  loading={scanning}
                  onClick={handleScanNow}
                  disabled={spamRules.filter(r => r.isActive).length === 0}
                >
                  <Shield className="h-3.5 w-3.5" />
                  Scan Now
                </Button>
              </div>

              {scanProgress && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                    <span>
                      {scanProgress.done
                        ? scanProgress.message
                          ? scanProgress.message
                          : `Done — ${scanProgress.moved} ticket${scanProgress.moved !== 1 ? 's' : ''} moved to spam`
                        : `Scanning… ${scanProgress.processed} / ${scanProgress.total}`
                      }
                    </span>
                    <span className="tabular-nums">
                      {scanProgress.moved} moved
                    </span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${
                        scanProgress.done ? 'bg-green-500' : 'bg-red-500'
                      }`}
                      style={{
                        width: scanProgress.total > 0
                          ? `${Math.round((scanProgress.processed / scanProgress.total) * 100)}%`
                          : scanProgress.done ? '100%' : '0%'
                      }}
                    />
                  </div>
                  {scanProgress.done && (
                    <p className="text-xs text-green-600 dark:text-green-400">
                      Scan complete. {scanProgress.processed} tickets checked, {scanProgress.moved} moved to spam.
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Danger Zone */}
          <div className="rounded-lg border-2 border-red-300 dark:border-red-800 bg-white dark:bg-gray-800 p-6">
            <div className="mb-4 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-red-500" />
              <h2 className="text-sm font-semibold text-red-600 dark:text-red-400">Danger Zone</h2>
            </div>

            <div className="rounded-md border border-red-200 dark:border-red-900 p-4">
              <p className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-1">Delete All Tickets</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                Permanently delete every ticket, message, note, attachment, and activity. This action <strong>cannot be undone</strong>.
              </p>
              <label className="mb-3 flex items-center gap-2 cursor-pointer select-none text-xs text-gray-600 dark:text-gray-400">
                <input
                  type="checkbox"
                  checked={onlyFreshdesk}
                  onChange={(e) => setOnlyFreshdesk(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-red-600 focus:ring-red-500"
                />
                Only Freshdesk imported
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="text"
                  value={deleteConfirm}
                  onChange={(e) => setDeleteConfirm(e.target.value)}
                  placeholder='Type "DeLeTe" to confirm'
                  className="w-48 rounded-md border border-red-300 dark:border-red-700 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
                />
                <Button
                  variant="danger"
                  size="sm"
                  loading={deleting}
                  disabled={deleteConfirm !== 'DeLeTe'}
                  onClick={async () => {
                    setDeleting(true)
                    try {
                      const res = await fetch('/api/admin/danger/delete-all-tickets', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ confirmation: deleteConfirm, onlyFreshdesk }),
                      })
                      const data = await res.json()
                      if (!res.ok) throw new Error(data.error || 'Failed')
                      toast.success(`Deleted ${data.deleted} ticket(s)`)
                      setDeleteConfirm('')
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : 'Failed to delete')
                    } finally {
                      setDeleting(false)
                    }
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete All Tickets
                </Button>
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <Button loading={saving} onClick={handleSave}>Save Settings</Button>
          </div>
        </div>
      </div>
    </div>
  )
}
