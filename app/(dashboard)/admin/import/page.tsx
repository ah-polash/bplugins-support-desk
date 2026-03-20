'use client'
import { useEffect, useState, useCallback, useRef } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import Header from '@/components/layout/Header'
import { Button } from '@/components/ui/Button'
import { CheckCircle2, XCircle, AlertCircle, Download, ExternalLink, FileSpreadsheet, Plug, Upload, FileJson, FileDown } from 'lucide-react'
import toast from 'react-hot-toast'
import { parseCSV } from '@/lib/csv-parser'

type Source = 'helpscout' | 'freshdesk'
type ImportTab = 'api' | 'csv' | 'ndjson' | 'export'

interface EmailAccount { id: string; name: string; email: string }
interface User { id: string; name: string; email: string }

interface ImportResult {
  imported: number
  skipped: number
  errors: string[]
}

interface ImportProgress {
  phase: 'fetching' | 'saving' | 'importing'
  done: number
  total: number
  current: string
  statusMessage: string
}

const SOURCE_INFO = {
  helpscout: {
    label: 'HelpScout',
    logo: '🔵',
    fields: [
      { key: 'appId',     label: 'App ID',     placeholder: 'Your HelpScout App ID',     type: 'text' },
      { key: 'appSecret', label: 'App Secret',  placeholder: 'Your HelpScout App Secret', type: 'password' },
    ],
    help: 'Create an App in HelpScout → Your Profile → My Apps → Create My App. Use Client Credentials grant.',
    docsUrl: 'https://developer.helpscout.com/mailbox-api/overview/authentication/',
  },
  freshdesk: {
    label: 'Freshdesk',
    logo: '🟢',
    fields: [
      { key: 'domain',  label: 'Subdomain',   placeholder: 'yourcompany (without .freshdesk.com)', type: 'text' },
      { key: 'apiKey',  label: 'API Key',      placeholder: 'Your Freshdesk API key',               type: 'password' },
    ],
    help: 'Find your API key in Freshdesk → Profile Settings → API Key (top-right).',
    docsUrl: 'https://developers.freshdesk.com/api/#authentication',
  },
}

const FRESHDESK_CSV_COLUMNS = ['Ticket ID', 'Subject', 'Status', 'Priority', 'Email', 'Full name', 'Created time', 'Resolved time', 'Tags', 'Contact ID']

export default function ImportPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [tab, setTab] = useState<ImportTab>('api')
  const [accounts, setAccounts] = useState<EmailAccount[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [emailAccountId, setEmailAccountId] = useState('')
  const [assigneeId, setAssigneeId] = useState('')
  const [overrideExisting, setOverrideExisting] = useState(false)
  const [importLast7Days, setImportLast7Days] = useState(false)
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [progress, setProgress] = useState<ImportProgress | null>(null)

  // API import state
  const [source, setSource] = useState<Source>('helpscout')
  const [creds, setCreds] = useState<Record<string, string>>({})
  const [testing, setTesting] = useState(false)
  const [tested, setTested] = useState(false)
  const [skipConversations, setSkipConversations] = useState(false)

  // CSV import state
  const [csvText, setCsvText] = useState<string | null>(null)
  const [csvPreview, setCsvPreview] = useState<{ headers: string[]; rows: Record<string, string>[] } | null>(null)
  const [csvFileName, setCsvFileName] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  // NDJSON import state
  const [ndjsonFile, setNdjsonFile] = useState<File | null>(null)
  const [ndjsonPreview, setNdjsonPreview] = useState<Record<string, unknown>[]>([])
  const [ndjsonFileName, setNdjsonFileName] = useState('')
  const [ndjsonLineCount, setNdjsonLineCount] = useState(0)
  const ndjsonFileInputRef = useRef<HTMLInputElement>(null)

  // Export state
  const [exporting, setExporting] = useState(false)
  const [exportingNdjson, setExportingNdjson] = useState(false)

  useEffect(() => {
    if (status === 'authenticated' && session?.user?.role !== 'SUPER_ADMIN') {
      router.replace('/inbox')
    }
  }, [status, session, router])

  const fetchAccounts = useCallback(async () => {
    const [accountsRes, usersRes] = await Promise.allSettled([
      fetch('/api/email-accounts'),
      fetch('/api/users'),
    ])
    if (accountsRes.status === 'fulfilled' && accountsRes.value.ok) {
      const data = await accountsRes.value.json()
      const list: EmailAccount[] = (data.accounts ?? data).filter((a: EmailAccount & { isActive: boolean }) => a.isActive)
      setAccounts(list)
      if (list.length > 0) setEmailAccountId(list[0].id)
    }
    if (usersRes.status === 'fulfilled' && usersRes.value.ok) {
      const data = await usersRes.value.json()
      setUsers((data.users ?? data).filter((u: User & { isActive: boolean }) => u.isActive))
    }
  }, [])

  useEffect(() => { fetchAccounts() }, [fetchAccounts])

  // ── CSV file handling ──────────────────────────────────────────────────────
  const handleFileChange = (file: File | null) => {
    if (!file) return
    setCsvFileName(file.name)
    setResult(null)
    setProgress(null)
    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target?.result as string
      setCsvText(text)
      try {
        const parsed = parseCSV(text)
        setCsvPreview({ headers: parsed.headers, rows: parsed.rows.slice(0, 5) })
      } catch {
        toast.error('Failed to parse CSV file')
        setCsvText(null)
        setCsvPreview(null)
      }
    }
    reader.readAsText(file)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file?.name.endsWith('.csv')) handleFileChange(file)
    else toast.error('Please drop a .csv file')
  }

  // ── Shared stream reader ───────────────────────────────────────────────────
  const readStream = async (res: Response) => {
    if (!res.body) throw new Error('No response body')
    const reader = res.body.getReader()
    const dec = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += dec.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const msg = JSON.parse(line)
          if (msg.type === 'total') {
            setProgress({ phase: 'fetching', done: 0, total: msg.count, current: '', statusMessage: `Processing ${msg.count} tickets…` })
          } else if (msg.type === 'status') {
            setProgress(prev => ({ phase: 'fetching', done: 0, total: 0, current: '', statusMessage: msg.message, ...(prev ?? {}) }))
          } else if (msg.type === 'fetch_progress') {
            setProgress({ phase: 'fetching', done: msg.done, total: msg.total, current: msg.current ?? '', statusMessage: 'Fetching conversations…' })
          } else if (msg.type === 'progress') {
            setProgress({ phase: 'importing', done: msg.done, total: msg.total, current: '', statusMessage: 'Importing tickets…' })
          } else if (msg.type === 'save_progress') {
            setProgress({ phase: 'saving', done: msg.done, total: msg.total, current: '', statusMessage: 'Saving to database…' })
          } else if (msg.type === 'done') {
            setResult({ imported: msg.imported, skipped: msg.skipped, errors: msg.errors })
            setProgress(null)
          } else if (msg.type === 'error') {
            throw new Error(msg.message)
          }
        } catch (parseErr) {
          if (parseErr instanceof SyntaxError) continue
          throw parseErr
        }
      }
    }
  }

  // ── API import ─────────────────────────────────────────────────────────────
  const credPayload = () => source === 'helpscout'
    ? { helpscout: { appId: creds.appId ?? '', appSecret: creds.appSecret ?? '' } }
    : { freshdesk: { domain: (creds.domain ?? '').trim().replace(/\.freshdesk\.com$/, ''), apiKey: creds.apiKey ?? '' } }

  const handleTest = async () => {
    setTesting(true); setTested(false)
    try {
      const res = await fetch('/api/admin/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'test', source, ...credPayload() }),
      })
      const data = await res.json()
      if (res.ok && data.success) { setTested(true); toast.success('Connection successful!') }
      else toast.error(data.error || 'Connection failed')
    } catch { toast.error('Request failed') }
    finally { setTesting(false) }
  }

  const handleApiImport = async () => {
    if (!emailAccountId) return toast.error('Select an email account first')
    setImporting(true); setResult(null); setProgress(null)
    try {
      const res = await fetch('/api/admin/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'run', source, emailAccountId, assigneeId: assigneeId || null, overrideExisting, skipConversations, importLast7Days, ...credPayload() }),
      })
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({ error: 'Import failed' }))
        throw new Error(data.error || 'Import failed')
      }
      await readStream(res)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Import failed')
    } finally { setImporting(false); setProgress(null) }
  }

  // ── CSV import ─────────────────────────────────────────────────────────────
  const handleCsvImport = async () => {
    if (!csvText) return toast.error('Please select a CSV file first')
    if (!emailAccountId) return toast.error('Select an email account first')
    setImporting(true); setResult(null); setProgress(null)
    try {
      const res = await fetch('/api/admin/import/csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csvText, emailAccountId, assigneeId: assigneeId || null, overrideExisting, importLast7Days }),
      })
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({ error: 'Import failed' }))
        throw new Error(data.error || 'Import failed')
      }
      await readStream(res)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'CSV import failed')
    } finally { setImporting(false); setProgress(null) }
  }

  // ── NDJSON file handling ──────────────────────────────────────────────────
  const handleNdjsonFileChange = (file: File | null) => {
    if (!file) return
    setNdjsonFileName(file.name)
    setNdjsonFile(file)
    setResult(null)
    setProgress(null)
    // Only read first 64KB for preview — don't load the whole file into memory
    const PREVIEW_SIZE = 64 * 1024
    const slice = file.slice(0, PREVIEW_SIZE)
    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target?.result as string
      try {
        const lines = text.split('\n').filter(l => l.trim())
        // If we only read a partial file, last line may be truncated — drop it
        if (file.size > PREVIEW_SIZE && lines.length > 1) lines.pop()
        const preview: Record<string, unknown>[] = []
        for (let i = 0; i < Math.min(5, lines.length); i++) {
          preview.push(JSON.parse(lines[i]))
        }
        setNdjsonPreview(preview)
        // Estimate total lines from file size and avg line length
        if (lines.length > 0) {
          const avgLineSize = text.length / lines.length
          setNdjsonLineCount(Math.round(file.size / avgLineSize))
        }
      } catch {
        toast.error('Failed to parse NDJSON file')
        setNdjsonFile(null)
        setNdjsonPreview([])
        setNdjsonLineCount(0)
      }
    }
    reader.readAsText(slice)
  }

  const handleNdjsonDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file?.name.endsWith('.ndjson') || file?.name.endsWith('.jsonl') || file?.name.endsWith('.json')) handleNdjsonFileChange(file)
    else toast.error('Please drop a .ndjson, .jsonl, or .json file')
  }

  const handleNdjsonImport = async () => {
    if (!ndjsonFile) return toast.error('Please select an NDJSON file first')
    if (!emailAccountId) return toast.error('Select an email account first')
    setImporting(true); setResult(null); setProgress(null)
    try {
      const formData = new FormData()
      formData.append('file', ndjsonFile)
      formData.append('emailAccountId', emailAccountId)
      if (assigneeId) formData.append('assigneeId', assigneeId)
      formData.append('overrideExisting', String(overrideExisting))
      formData.append('importLast7Days', String(importLast7Days))
      const res = await fetch('/api/admin/import/ndjson', {
        method: 'POST',
        body: formData,
      })
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({ error: 'Import failed' }))
        throw new Error(data.error || 'Import failed')
      }
      await readStream(res)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'NDJSON import failed')
    } finally { setImporting(false); setProgress(null) }
  }

  const info = SOURCE_INFO[source]
  const apiFieldsComplete = info.fields.every(f => (creds[f.key] ?? '').trim().length > 0)

  // Shared options panel (used in both tabs)
  const OptionsPanel = () => (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6">
      <h2 className="mb-1 text-sm font-semibold text-gray-900 dark:text-gray-100">Import Options</h2>
      <p className="mb-4 text-xs text-gray-500 dark:text-gray-400">Configure where imported tickets land.</p>
      <div className="space-y-4">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Target Inbox</label>
          {accounts.length === 0 ? (
            <p className="text-sm text-yellow-600 dark:text-yellow-400">No active email accounts. Add one in Email Accounts settings.</p>
          ) : (
            <select value={emailAccountId} onChange={e => setEmailAccountId(e.target.value)}
              className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500">
              {accounts.map(a => <option key={a.id} value={a.id}>{a.name} ({a.email})</option>)}
            </select>
          )}
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Assign To</label>
          <select value={assigneeId} onChange={e => setAssigneeId(e.target.value)}
            className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500">
            <option value="">— Unassigned —</option>
            {users.map(u => <option key={u.id} value={u.id}>{u.name} ({u.email})</option>)}
          </select>
          <p className="mt-1 text-xs text-gray-400">Leave blank to import as unassigned.</p>
        </div>
      </div>
      <div className="mt-4 flex items-center gap-2">
        <input id="override-existing" type="checkbox" checked={overrideExisting} onChange={e => setOverrideExisting(e.target.checked)}
          className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" />
        <label htmlFor="override-existing" className="text-sm text-gray-700 dark:text-gray-300">Override existing tickets</label>
        <span className="text-xs text-gray-400">(re-import tickets already imported)</span>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <input id="last-7-days" type="checkbox" checked={importLast7Days} onChange={e => setImportLast7Days(e.target.checked)}
          className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" />
        <label htmlFor="last-7-days" className="text-sm text-gray-700 dark:text-gray-300">Import last 7 days only</label>
        <span className="text-xs text-gray-400">(for testing — skips older tickets)</span>
      </div>
      <p className="mt-2 text-xs text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20 rounded px-3 py-2">
        ✓ <strong>Safe to re-run.</strong> If a previous import was interrupted, just run it again with Override unchecked —
        already-imported tickets are automatically skipped and only the remaining ones are processed.
      </p>
    </div>
  )

  const ProgressPanel = () => (
    importing ? (
      <div className="mt-4 rounded-md border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 px-4 py-3">
        <p className="text-sm font-medium text-blue-700 dark:text-blue-300 mb-2">{progress?.statusMessage ?? 'Starting…'}</p>
        {progress && progress.total > 0 && (
          <>
            <div className="w-full bg-blue-200 dark:bg-blue-900 rounded-full h-2 mb-1.5">
              <div className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }} />
            </div>
            <p className="text-xs text-blue-600 dark:text-blue-400">
              {progress.done} / {progress.total}
              {progress.current ? ` — ${progress.current}` : ''}
            </p>
          </>
        )}
        {progress && progress.total === 0 && (
          <p className="text-xs text-blue-500 italic">Please wait…</p>
        )}
      </div>
    ) : null
  )

  const ResultPanel = () => result ? (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6">
      <h2 className="mb-4 text-sm font-semibold text-gray-900 dark:text-gray-100">Import Results</h2>
      <div className="grid grid-cols-3 gap-4 mb-4">
        <div className="rounded-md bg-green-50 dark:bg-green-900/20 p-4 text-center">
          <CheckCircle2 className="h-6 w-6 text-green-500 mx-auto mb-1" />
          <p className="text-2xl font-bold text-green-700 dark:text-green-300">{result.imported}</p>
          <p className="text-xs text-green-600 dark:text-green-400">Imported</p>
        </div>
        <div className="rounded-md bg-yellow-50 dark:bg-yellow-900/20 p-4 text-center">
          <AlertCircle className="h-6 w-6 text-yellow-500 mx-auto mb-1" />
          <p className="text-2xl font-bold text-yellow-700 dark:text-yellow-300">{result.skipped}</p>
          <p className="text-xs text-yellow-600 dark:text-yellow-400">Skipped (duplicates)</p>
        </div>
        <div className="rounded-md bg-red-50 dark:bg-red-900/20 p-4 text-center">
          <XCircle className="h-6 w-6 text-red-500 mx-auto mb-1" />
          <p className="text-2xl font-bold text-red-700 dark:text-red-300">{result.errors.length}</p>
          <p className="text-xs text-red-600 dark:text-red-400">Errors</p>
        </div>
      </div>
      {result.errors.length > 0 && (
        <div className="rounded-md border border-red-200 dark:border-red-800 p-3 max-h-48 overflow-y-auto">
          <p className="mb-2 text-xs font-semibold text-red-700 dark:text-red-400">Error details:</p>
          {result.errors.map((e, i) => (
            <p key={i} className="text-xs text-red-600 dark:text-red-400 py-0.5 border-b border-red-100 dark:border-red-900 last:border-0">{e}</p>
          ))}
        </div>
      )}
      {result.imported > 0 && (
        <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
          Imported tickets are now available in All Tickets{assigneeId ? ` and assigned to ${users.find(u => u.id === assigneeId)?.name ?? 'the selected agent'}.` : '.'}
        </p>
      )}
    </div>
  ) : null

  return (
    <div className="flex h-full flex-col">
      <Header title="Import Export" />
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-2xl space-y-6">

          {/* Tab switcher */}
          <div className="flex rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-1 gap-1">
            <button onClick={() => { setTab('api'); setResult(null); setProgress(null) }}
              className={`flex flex-1 items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors ${tab === 'api' ? 'bg-indigo-600 text-white' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'}`}>
              <Plug className="h-4 w-4" /> API Import
            </button>
            <button onClick={() => { setTab('csv'); setResult(null); setProgress(null) }}
              className={`flex flex-1 items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors ${tab === 'csv' ? 'bg-indigo-600 text-white' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'}`}>
              <FileSpreadsheet className="h-4 w-4" /> CSV Import
            </button>
            <button onClick={() => { setTab('ndjson'); setResult(null); setProgress(null) }}
              className={`flex flex-1 items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors ${tab === 'ndjson' ? 'bg-indigo-600 text-white' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'}`}>
              <FileJson className="h-4 w-4" /> NDJSON Import
            </button>
            <button onClick={() => { setTab('export'); setResult(null); setProgress(null) }}
              className={`flex flex-1 items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors ${tab === 'export' ? 'bg-indigo-600 text-white' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'}`}>
              <FileDown className="h-4 w-4" /> Export
            </button>
          </div>

          {/* ── API IMPORT TAB ── */}
          {tab === 'api' && (
            <>
              {/* Source selector */}
              <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6">
                <h2 className="mb-1 text-sm font-semibold text-gray-900 dark:text-gray-100">Import Source</h2>
                <p className="mb-4 text-xs text-gray-500 dark:text-gray-400">Choose the platform to import via API.</p>
                <div className="grid grid-cols-2 gap-3">
                  {(['helpscout', 'freshdesk'] as Source[]).map(s => (
                    <button key={s} type="button"
                      onClick={() => { setSource(s); setCreds({}); setTested(false); setResult(null); setSkipConversations(false) }}
                      className={`flex items-center gap-3 rounded-lg border-2 p-4 text-left transition-colors ${source === s ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20' : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'}`}>
                      <span className="text-2xl">{SOURCE_INFO[s].logo}</span>
                      <div>
                        <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{SOURCE_INFO[s].label}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">API Import</p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Credentials */}
              <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{info.label} Credentials</h2>
                  <a href={info.docsUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-indigo-500 hover:underline">
                    Docs <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
                <p className="mb-4 text-xs text-gray-500 dark:text-gray-400">{info.help}</p>
                <div className="space-y-4">
                  {info.fields.map(f => (
                    <div key={f.key}>
                      <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{f.label}</label>
                      <input type={f.type} value={creds[f.key] ?? ''} onChange={e => { setCreds(prev => ({ ...prev, [f.key]: e.target.value })); setTested(false) }}
                        placeholder={f.placeholder}
                        className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
                    </div>
                  ))}
                </div>
                <div className="mt-4 flex items-center gap-3">
                  <Button variant="outline" size="sm" loading={testing} onClick={handleTest} disabled={!apiFieldsComplete}>Test Connection</Button>
                  {tested && <span className="flex items-center gap-1.5 text-sm text-green-600 dark:text-green-400"><CheckCircle2 className="h-4 w-4" /> Connected</span>}
                </div>
              </div>

              <OptionsPanel />

              {/* Freshdesk-specific option */}
              {source === 'freshdesk' && (
                <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-4">
                  <div className="flex items-start gap-2">
                    <input id="skip-conv" type="checkbox" checked={skipConversations} onChange={e => setSkipConversations(e.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" />
                    <div>
                      <label htmlFor="skip-conv" className="text-sm font-medium text-amber-800 dark:text-amber-200 cursor-pointer">
                        Skip conversation history <span className="font-semibold">(recommended for large accounts)</span>
                      </label>
                      <p className="text-xs text-amber-700 dark:text-amber-300 mt-0.5">
                        Freshdesk requires 1 extra API call per ticket for replies. For 1,000+ tickets this takes hours.
                        Use CSV import instead for fastest results with large ticket volumes.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              <div className="flex items-center gap-3">
                <Button loading={importing} onClick={handleApiImport} disabled={!apiFieldsComplete || !emailAccountId || accounts.length === 0}>
                  <Download className="h-4 w-4" /> {importing ? 'Importing…' : 'Start API Import'}
                </Button>
              </div>
              <ProgressPanel />
            </>
          )}

          {/* ── CSV IMPORT TAB ── */}
          {tab === 'csv' && (
            <>
              {/* Info banner */}
              <div className="rounded-lg border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-900/20 p-4">
                <p className="text-sm font-medium text-indigo-800 dark:text-indigo-200 mb-1">Freshdesk CSV Export</p>
                <p className="text-xs text-indigo-700 dark:text-indigo-300">
                  In Freshdesk: go to <strong>Reports → Export</strong> → select all tickets → download CSV.
                  The following columns are used: <span className="font-mono">{FRESHDESK_CSV_COLUMNS.join(', ')}</span>.
                  Contacts are automatically created/updated.
                </p>
              </div>

              {/* File picker */}
              <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6">
                <h2 className="mb-4 text-sm font-semibold text-gray-900 dark:text-gray-100">Select CSV File</h2>
                <div
                  onDrop={handleDrop}
                  onDragOver={e => e.preventDefault()}
                  onClick={() => fileInputRef.current?.click()}
                  className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-600 p-8 text-center cursor-pointer hover:border-indigo-400 dark:hover:border-indigo-500 transition-colors"
                >
                  <Upload className="h-8 w-8 text-gray-400 mb-2" />
                  {csvFileName ? (
                    <>
                      <p className="text-sm font-medium text-gray-700 dark:text-gray-300">{csvFileName}</p>
                      <p className="text-xs text-gray-400 mt-1">Click to change file</p>
                    </>
                  ) : (
                    <>
                      <p className="text-sm font-medium text-gray-600 dark:text-gray-300">Drop your CSV file here or click to browse</p>
                      <p className="text-xs text-gray-400 mt-1">Freshdesk exported CSV (.csv)</p>
                    </>
                  )}
                </div>
                <input ref={fileInputRef} type="file" accept=".csv" className="hidden"
                  onChange={e => handleFileChange(e.target.files?.[0] ?? null)} />
              </div>

              {/* Preview */}
              {csvPreview && csvPreview.rows.length > 0 && (
                <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6">
                  <h2 className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">
                    Preview <span className="text-xs font-normal text-gray-400">(first 5 rows)</span>
                  </h2>
                  <div className="overflow-x-auto">
                    <table className="text-xs">
                      <thead>
                        <tr className="border-b border-gray-100 dark:border-gray-700">
                          {['Ticket ID', 'Subject', 'Status', 'Email', 'Created time'].map(col => (
                            <th key={col} className="px-2 py-1 text-left text-gray-500 dark:text-gray-400 whitespace-nowrap">{col}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {csvPreview.rows.map((row, i) => (
                          <tr key={i} className="border-b border-gray-50 dark:border-gray-800">
                            <td className="px-2 py-1 text-gray-600 dark:text-gray-300 whitespace-nowrap">{row['Ticket ID'] || '—'}</td>
                            <td className="px-2 py-1 text-gray-600 dark:text-gray-300 max-w-[200px] truncate">{row['Subject'] || '—'}</td>
                            <td className="px-2 py-1 text-gray-600 dark:text-gray-300 whitespace-nowrap">{row['Status'] || '—'}</td>
                            <td className="px-2 py-1 text-gray-600 dark:text-gray-300 whitespace-nowrap">{row['Email'] || '—'}</td>
                            <td className="px-2 py-1 text-gray-600 dark:text-gray-300 whitespace-nowrap">{row['Created time'] || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <OptionsPanel />

              <div className="flex items-center gap-3">
                <Button loading={importing} onClick={handleCsvImport} disabled={!csvText || !emailAccountId || accounts.length === 0}>
                  <FileSpreadsheet className="h-4 w-4" /> {importing ? 'Importing…' : 'Start CSV Import'}
                </Button>
              </div>
              <ProgressPanel />
            </>
          )}

          {/* ── NDJSON IMPORT TAB ── */}
          {tab === 'ndjson' && (
            <>
              {/* Info banner */}
              <div className="rounded-lg border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-900/20 p-4">
                <p className="text-sm font-medium text-indigo-800 dark:text-indigo-200 mb-1">Freshdesk NDJSON Import</p>
                <p className="text-xs text-indigo-700 dark:text-indigo-300">
                  Upload an NDJSON file (<span className="font-mono">.ndjson</span> / <span className="font-mono">.jsonl</span>) where each line is a JSON object representing a Freshdesk ticket.
                  Supports Freshdesk API format with <span className="font-mono">id</span>, <span className="font-mono">subject</span>, <span className="font-mono">status</span>, <span className="font-mono">priority</span>,
                  <span className="font-mono">email</span>, <span className="font-mono">description</span>, <span className="font-mono">conversations</span>, etc.
                  Unlike CSV, this format preserves full conversation history.
                </p>
              </div>

              {/* File picker */}
              <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6">
                <h2 className="mb-4 text-sm font-semibold text-gray-900 dark:text-gray-100">Select NDJSON File</h2>
                <div
                  onDrop={handleNdjsonDrop}
                  onDragOver={e => e.preventDefault()}
                  onClick={() => ndjsonFileInputRef.current?.click()}
                  className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-600 p-8 text-center cursor-pointer hover:border-indigo-400 dark:hover:border-indigo-500 transition-colors"
                >
                  <Upload className="h-8 w-8 text-gray-400 mb-2" />
                  {ndjsonFileName ? (
                    <>
                      <p className="text-sm font-medium text-gray-700 dark:text-gray-300">{ndjsonFileName}</p>
                      <p className="text-xs text-gray-400 mt-1">{ndjsonLineCount} ticket{ndjsonLineCount !== 1 ? 's' : ''} found — click to change file</p>
                    </>
                  ) : (
                    <>
                      <p className="text-sm font-medium text-gray-600 dark:text-gray-300">Drop your NDJSON file here or click to browse</p>
                      <p className="text-xs text-gray-400 mt-1">.ndjson, .jsonl, or .json — one JSON object per line</p>
                    </>
                  )}
                </div>
                <input ref={ndjsonFileInputRef} type="file" accept=".ndjson,.jsonl,.json" className="hidden"
                  onChange={e => handleNdjsonFileChange(e.target.files?.[0] ?? null)} />
              </div>

              {/* Preview */}
              {ndjsonPreview.length > 0 && (
                <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6">
                  <h2 className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">
                    Preview <span className="text-xs font-normal text-gray-400">(first {ndjsonPreview.length} ticket{ndjsonPreview.length !== 1 ? 's' : ''})</span>
                  </h2>
                  <div className="overflow-x-auto">
                    <table className="text-xs w-full">
                      <thead>
                        <tr className="border-b border-gray-100 dark:border-gray-700">
                          <th className="px-2 py-1 text-left text-gray-500 dark:text-gray-400 whitespace-nowrap">ID</th>
                          <th className="px-2 py-1 text-left text-gray-500 dark:text-gray-400 whitespace-nowrap">Subject</th>
                          <th className="px-2 py-1 text-left text-gray-500 dark:text-gray-400 whitespace-nowrap">Status</th>
                          <th className="px-2 py-1 text-left text-gray-500 dark:text-gray-400 whitespace-nowrap">Email</th>
                          <th className="px-2 py-1 text-left text-gray-500 dark:text-gray-400 whitespace-nowrap">Replies</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ndjsonPreview.map((t, i) => (
                          <tr key={i} className="border-b border-gray-50 dark:border-gray-800">
                            <td className="px-2 py-1 text-gray-600 dark:text-gray-300 whitespace-nowrap">{String(t.id || t.ticket_id || '—')}</td>
                            <td className="px-2 py-1 text-gray-600 dark:text-gray-300 max-w-[200px] truncate">{String(t.subject || '—')}</td>
                            <td className="px-2 py-1 text-gray-600 dark:text-gray-300 whitespace-nowrap">{String(t.status || '—')}</td>
                            <td className="px-2 py-1 text-gray-600 dark:text-gray-300 whitespace-nowrap">{String(t.email || (t.requester as Record<string, unknown>)?.email || '—')}</td>
                            <td className="px-2 py-1 text-gray-600 dark:text-gray-300 whitespace-nowrap">{Array.isArray(t.conversations) ? t.conversations.length : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <OptionsPanel />

              <div className="flex items-center gap-3">
                <Button loading={importing} onClick={handleNdjsonImport} disabled={!ndjsonFile || !emailAccountId || accounts.length === 0}>
                  <FileJson className="h-4 w-4" /> {importing ? 'Importing…' : 'Start NDJSON Import'}
                </Button>
              </div>
              <ProgressPanel />
            </>
          )}

          {/* ── EXPORT TAB ── */}
          {tab === 'export' && (
            <>
              <div className="rounded-lg border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-900/20 p-4">
                <p className="text-sm font-medium text-indigo-800 dark:text-indigo-200 mb-1">Export Tickets</p>
                <p className="text-xs text-indigo-700 dark:text-indigo-300">
                  Export all tickets (excluding spam). Both formats are re-importable. Use <strong>NDJSON</strong> for a full backup
                  with complete reply threads, or <strong>CSV</strong> for metadata only.
                </p>
              </div>

              {/* NDJSON Export — full backup with threads */}
              <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6">
                <div className="flex items-center gap-2 mb-1">
                  <FileJson className="h-4 w-4 text-indigo-500" />
                  <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">NDJSON Export (Full Backup)</h2>
                </div>
                <p className="mb-4 text-xs text-gray-500 dark:text-gray-400">
                  Exports every ticket with all messages, reply threads, HTML bodies, and metadata.
                  Re-import via the NDJSON Import tab for a complete restore.
                </p>

                <div className="rounded-md bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 p-3 mb-4">
                  <p className="text-xs text-green-700 dark:text-green-300">
                    <strong>Includes:</strong> subject, status, priority, tags, from email/name, timestamps,
                    full description (text + HTML), all conversation replies, contact info
                  </p>
                </div>

                <Button loading={exportingNdjson} onClick={async () => {
                  setExportingNdjson(true)
                  try {
                    const res = await fetch('/api/admin/export/ndjson')
                    if (!res.ok) {
                      const data = await res.json().catch(() => ({ error: 'Export failed' }))
                      throw new Error(data.error || 'Export failed')
                    }
                    const blob = await res.blob()
                    const url = URL.createObjectURL(blob)
                    const a = document.createElement('a')
                    a.href = url
                    a.download = res.headers.get('Content-Disposition')?.match(/filename="(.+)"/)?.[1] || `tickets-export-${new Date().toISOString().slice(0, 10)}.ndjson`
                    document.body.appendChild(a)
                    a.click()
                    a.remove()
                    URL.revokeObjectURL(url)
                    toast.success('NDJSON exported successfully')
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : 'Export failed')
                  } finally {
                    setExportingNdjson(false)
                  }
                }}>
                  <Download className="h-4 w-4" /> {exportingNdjson ? 'Exporting…' : 'Download NDJSON Export'}
                </Button>
              </div>

              {/* CSV Export — metadata only */}
              <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6">
                <div className="flex items-center gap-2 mb-1">
                  <FileSpreadsheet className="h-4 w-4 text-gray-500" />
                  <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">CSV Export (Metadata Only)</h2>
                </div>
                <p className="mb-4 text-xs text-gray-500 dark:text-gray-400">
                  Ticket metadata without message bodies or reply threads. Good for spreadsheets and reporting.
                  Re-import via the CSV Import tab.
                </p>

                <div className="rounded-md bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 p-3 mb-4">
                  <p className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">Columns:</p>
                  <div className="flex flex-wrap gap-1.5">
                    {['Ticket ID', 'Subject', 'Status', 'Priority', 'Email', 'Full name', 'Created time', 'Resolved time', 'Closed time', 'Tags', 'Contact ID', 'Work phone', 'Twitter ID', 'Facebook ID'].map(col => (
                      <span key={col} className="rounded bg-gray-200 dark:bg-gray-700 px-2 py-0.5 text-xs font-mono text-gray-600 dark:text-gray-300">{col}</span>
                    ))}
                  </div>
                </div>

                <Button variant="outline" loading={exporting} onClick={async () => {
                  setExporting(true)
                  try {
                    const res = await fetch('/api/admin/export/csv')
                    if (!res.ok) {
                      const data = await res.json().catch(() => ({ error: 'Export failed' }))
                      throw new Error(data.error || 'Export failed')
                    }
                    const blob = await res.blob()
                    const url = URL.createObjectURL(blob)
                    const a = document.createElement('a')
                    a.href = url
                    a.download = res.headers.get('Content-Disposition')?.match(/filename="(.+)"/)?.[1] || `tickets-export-${new Date().toISOString().slice(0, 10)}.csv`
                    document.body.appendChild(a)
                    a.click()
                    a.remove()
                    URL.revokeObjectURL(url)
                    toast.success('CSV exported successfully')
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : 'Export failed')
                  } finally {
                    setExporting(false)
                  }
                }}>
                  <Download className="h-4 w-4" /> {exporting ? 'Exporting…' : 'Download CSV Export'}
                </Button>
              </div>
            </>
          )}

          <ResultPanel />
        </div>
      </div>
    </div>
  )
}
