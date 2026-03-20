'use client'
import { useEffect, useState, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import Header from '@/components/layout/Header'
import { Select } from '@/components/ui/Input'
import { Users, Phone, Twitter, Facebook, ExternalLink, Mail, Globe } from 'lucide-react'

interface Contact {
  id: string
  externalId: string | null
  name: string | null
  email: string
  phone: string | null
  twitterId: string | null
  facebookId: string | null
  createdAt: string
  latestSource: string | null
  _count: { tickets: number }
}

export default function ContactsPage() {
  const { data: session, status: authStatus } = useSession()
  const router = useRouter()
  const role = session?.user?.role
  const isAllowed = role === 'SUPER_ADMIN' || role === 'SUPPORT_ADMIN'

  const [contacts, setContacts] = useState<Contact[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [hasTickets, setHasTickets] = useState('')
  const [source, setSource] = useState('')
  const [sortBy, setSortBy] = useState('newest')
  const [limit, setLimit] = useState<number>(() => {
    if (typeof window === 'undefined') return 50
    return parseInt(localStorage.getItem('contacts:limit') ?? '50', 10) || 50
  })

  useEffect(() => {
    if (authStatus === 'authenticated' && !isAllowed) {
      router.replace('/inbox')
    }
  }, [authStatus, isAllowed, router])

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(limit), sortBy })
      if (search) params.set('search', search)
      if (hasTickets) params.set('hasTickets', hasTickets)
      if (source) params.set('source', source)
      const res = await fetch(`/api/admin/contacts?${params}`)
      if (res.ok) {
        const data = await res.json()
        setContacts(data.contacts ?? [])
        setTotal(data.total ?? 0)
      }
    } finally {
      setLoading(false)
    }
  }, [page, limit, search, hasTickets, source, sortBy])

  useEffect(() => {
    const t = setTimeout(() => fetchData(), 200)
    return () => clearTimeout(t)
  }, [fetchData])

  const totalPages = Math.ceil(total / limit)

  const handleLimitChange = (newLimit: number) => {
    setLimit(newLimit)
    localStorage.setItem('contacts:limit', String(newLimit))
    setPage(1)
  }

  const formatDate = (iso: string) => {
    const d = new Date(iso)
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  const sourceLabel = (src: string | null) => {
    if (!src) return 'Email'
    if (src === 'embed-form') return 'Form'
    if (src.startsWith('freshdesk')) return 'Import'
    if (src === 'helpscout') return 'Import'
    return src
  }

  const sourceColor = (src: string | null) => {
    if (src === 'embed-form') return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
    if (src && (src.startsWith('freshdesk') || src === 'helpscout')) return 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
    return 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
  }

  return (
    <div className="flex h-full flex-col">
      <Header title={`Contacts (${total})`} onSearch={setSearch} />

      {/* Filters */}
      <div className="flex items-center gap-3 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-6 py-3">
        <Select value={hasTickets} onChange={e => { setHasTickets(e.target.value); setPage(1) }} className="w-40 py-1.5 text-xs">
          <option value="">All Contacts</option>
          <option value="yes">With Tickets</option>
          <option value="no">Without Tickets</option>
        </Select>
        <Select value={source} onChange={e => { setSource(e.target.value); setPage(1) }} className="w-36 py-1.5 text-xs">
          <option value="">All Sources</option>
          <option value="email">Email</option>
          <option value="embed-form">Embed Form</option>
          <option value="import">Import</option>
        </Select>
        <Select value={sortBy} onChange={e => { setSortBy(e.target.value); setPage(1) }} className="w-40 py-1.5 text-xs">
          <option value="newest">Newest First</option>
          <option value="oldest">Oldest First</option>
          <option value="most-tickets">Most Tickets</option>
          <option value="name-asc">Name A → Z</option>
          <option value="name-desc">Name Z → A</option>
        </Select>
      </div>

      {/* Contact List */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex justify-center py-20">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
          </div>
        ) : contacts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20">
            <Users className="h-10 w-10 text-gray-300 dark:text-gray-600 mb-3" />
            <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
              {search || hasTickets || source ? 'No contacts match your filters' : 'No contacts yet'}
            </p>
            <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
              Contacts are created automatically from tickets, imports, and the embed form.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {contacts.map(contact => (
              <div
                key={contact.id}
                className="flex items-center gap-4 px-6 py-3.5 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors cursor-pointer"
                onClick={() => router.push(`/tickets?search=${encodeURIComponent(contact.email)}`)}
              >
                {/* Avatar */}
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400 text-sm font-semibold uppercase">
                  {(contact.name?.[0] || contact.email[0])}
                </div>

                {/* Name & Email */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                      {contact.name || <span className="text-gray-400 italic">No name</span>}
                    </p>
                    <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${sourceColor(contact.latestSource)}`}>
                      {contact.latestSource === 'embed-form' ? <Globe className="h-2.5 w-2.5" /> : <Mail className="h-2.5 w-2.5" />}
                      {sourceLabel(contact.latestSource)}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{contact.email}</p>
                </div>

                {/* Phone */}
                <div className="hidden md:flex items-center gap-1 w-32 shrink-0">
                  {contact.phone ? (
                    <span className="inline-flex items-center gap-1 text-xs text-gray-600 dark:text-gray-300 truncate">
                      <Phone className="h-3 w-3 text-gray-400 shrink-0" /> {contact.phone}
                    </span>
                  ) : (
                    <span className="text-xs text-gray-300 dark:text-gray-600">—</span>
                  )}
                </div>

                {/* Social */}
                <div className="hidden lg:flex items-center gap-2 w-36 shrink-0">
                  {contact.twitterId && (
                    <span className="inline-flex items-center gap-1 text-xs text-sky-600 dark:text-sky-400 truncate">
                      <Twitter className="h-3 w-3 shrink-0" /> {contact.twitterId}
                    </span>
                  )}
                  {contact.facebookId && (
                    <span className="inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 truncate">
                      <Facebook className="h-3 w-3 shrink-0" /> {contact.facebookId}
                    </span>
                  )}
                  {!contact.twitterId && !contact.facebookId && (
                    <span className="text-xs text-gray-300 dark:text-gray-600">—</span>
                  )}
                </div>

                {/* Tickets count */}
                <div className="w-16 shrink-0 text-center">
                  <span className="inline-flex items-center rounded-full bg-indigo-50 dark:bg-indigo-900/30 px-2 py-0.5 text-xs font-medium text-indigo-700 dark:text-indigo-300">
                    {contact._count.tickets} {contact._count.tickets === 1 ? 'ticket' : 'tickets'}
                  </span>
                </div>

                {/* Date */}
                <div className="hidden sm:block w-24 shrink-0 text-right">
                  <span className="text-xs text-gray-400">{formatDate(contact.createdAt)}</span>
                </div>

                {/* View arrow */}
                <ExternalLink className="h-3.5 w-3.5 text-gray-300 dark:text-gray-600 shrink-0" />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Pagination footer */}
      <div className="flex items-center justify-between gap-4 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-2.5">
        {/* Per-page selector */}
        <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
          <span>Showing</span>
          <div className="relative">
            <select
              value={limit}
              onChange={e => handleLimitChange(Number(e.target.value))}
              className="appearance-none rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 pl-2 pr-6 py-1 text-xs text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer"
            >
              {[25, 50, 100, 200, 500].map(n => (
                <option key={n} value={n}>{n} / page</option>
              ))}
            </select>
            <span className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400">▾</span>
          </div>
          <span className="text-gray-400">of {total.toLocaleString()}</span>
        </div>

        {/* Page navigation */}
        {totalPages > 1 && (
          <div className="flex items-center gap-1">
            <button onClick={() => setPage(1)} disabled={page === 1}
              className="rounded border border-gray-300 dark:border-gray-600 px-2 py-1 text-xs text-gray-700 dark:text-gray-300 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-800">«</button>
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
              className="rounded border border-gray-300 dark:border-gray-600 px-2.5 py-1 text-xs text-gray-700 dark:text-gray-300 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-800">‹</button>

            {Array.from({ length: Math.min(7, totalPages) }, (_, i) => {
              let p: number
              if (totalPages <= 7) {
                p = i + 1
              } else if (page <= 4) {
                p = i < 5 ? i + 1 : i === 5 ? -1 : totalPages
              } else if (page >= totalPages - 3) {
                p = i === 0 ? 1 : i === 1 ? -1 : totalPages - 6 + i
              } else {
                p = i === 0 ? 1 : i === 1 ? -1 : i === 5 ? -2 : i === 6 ? totalPages : page + i - 3
              }
              if (p < 0) return <span key={`ellipsis-${i}`} className="px-1 text-xs text-gray-400">…</span>
              return (
                <button key={p} onClick={() => setPage(p)} disabled={page === p}
                  className={`rounded border px-2.5 py-1 text-xs transition-colors ${page === p ? 'border-indigo-500 bg-indigo-600 text-white' : 'border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-40'}`}>
                  {p}
                </button>
              )
            })}

            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
              className="rounded border border-gray-300 dark:border-gray-600 px-2.5 py-1 text-xs text-gray-700 dark:text-gray-300 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-800">›</button>
            <button onClick={() => setPage(totalPages)} disabled={page === totalPages}
              className="rounded border border-gray-300 dark:border-gray-600 px-2 py-1 text-xs text-gray-700 dark:text-gray-300 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-800">»</button>
          </div>
        )}
      </div>
    </div>
  )
}
