'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useSession, signOut } from 'next-auth/react'
import { Inbox, Ticket, Users, Settings, LogOut, Mail, BarChart2, MessageSquare, Moon, Sun, User, SlidersHorizontal, ShieldCheck, Upload, ShieldAlert, Star, BookUser } from 'lucide-react'
import { cn, getInitials } from '@/lib/utils'
import { useTheme } from '@/components/providers/ThemeProvider'

// Visible to SUPPORT_ADMIN and SUPPORT_AGENT
const supportNavItems = [
  { href: '/inbox',   label: 'My Inbox',    icon: Inbox },
  { href: '/tickets', label: 'All Tickets',  icon: Ticket },
  { href: '/spam',    label: 'Spam Folder',  icon: ShieldAlert, adminOnly: true },
  { href: '/reports', label: 'Reports',      icon: BarChart2, adminOnly: true },
]

// Admin section for SUPPORT_ADMIN
const supportAdminItems = [
  { href: '/admin/canned-replies', label: 'Canned Replies', icon: MessageSquare },
  { href: '/admin/contacts',       label: 'Contacts',       icon: BookUser },
]

// SUPER_ADMIN nav
const superAdminNavItems = [
  { href: '/admin/users',          label: 'Users',               icon: Users },
  { href: '/admin/settings',       label: 'Email Accounts',      icon: Settings },
  { href: '/admin/app-settings',   label: 'App Settings',        icon: SlidersHorizontal },
  { href: '/admin/canned-replies', label: 'Canned Replies',      icon: MessageSquare },
  { href: '/admin/import',         label: 'Import Export',        icon: Upload },
  { href: '/admin/contacts',       label: 'Contacts',            icon: BookUser },
  { href: '/admin/satisfaction',   label: 'Satisfaction Ratings',icon: Star },
  { href: '/tickets',              label: 'All Tickets',         icon: Ticket },
  { href: '/spam',                 label: 'Spam Folder',         icon: ShieldAlert },
  { href: '/reports',              label: 'Reports',             icon: BarChart2 },
]

export default function Sidebar() {
  const pathname = usePathname()
  const { data: session } = useSession()
  const { theme, toggle } = useTheme()
  const role = session?.user?.role
  const isSuperAdmin = role === 'SUPER_ADMIN'
  const isSupportAdmin = role === 'SUPPORT_ADMIN'
  const isAgent = role === 'SUPPORT_AGENT'

  const linkClass = (active: boolean) =>
    cn(
      'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
      active
        ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300'
        : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-gray-100'
    )

  return (
    <aside className="flex h-screen w-60 flex-col border-r border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
      {/* Logo */}
      <div className="flex h-14 items-center gap-2 border-b border-gray-200 dark:border-gray-700 px-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600">
          <Mail className="h-4 w-4 text-white" />
        </div>
        <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">bPlugins Support</span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        {isSuperAdmin ? (
          // Super Admin: only admin management pages
          <ul className="space-y-1">
            {superAdminNavItems.map((item) => {
              const Icon = item.icon
              const active = pathname.startsWith(item.href)
              return (
                <li key={item.href}>
                  <Link href={item.href} className={linkClass(active)}>
                    <Icon className="h-4 w-4 shrink-0" />
                    {item.label}
                  </Link>
                </li>
              )
            })}
          </ul>
        ) : (
          // Support Admin / Agent: ticket-focused nav
          <>
            <ul className="space-y-1">
              {supportNavItems.map((item) => {
                if (item.adminOnly && !isSupportAdmin) return null
                const Icon = item.icon
                const active = pathname === item.href || pathname.startsWith(item.href + '/')
                return (
                  <li key={item.href}>
                    <Link href={item.href} className={linkClass(active)}>
                      <Icon className="h-4 w-4 shrink-0" />
                      {item.label}
                    </Link>
                  </li>
                )
              })}
            </ul>

            {/* Canned Replies accessible to all support roles */}
            <div className="mt-6">
              <p className="mb-1 px-3 text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                {isSupportAdmin ? 'Admin' : 'Tools'}
              </p>
              <ul className="space-y-1">
                {supportAdminItems.map((item) => {
                  const Icon = item.icon
                  const active = pathname.startsWith(item.href)
                  return (
                    <li key={item.href}>
                      <Link href={item.href} className={linkClass(active)}>
                        <Icon className="h-4 w-4 shrink-0" />
                        {item.label}
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </div>
          </>
        )}
      </nav>

      {/* Bottom actions */}
      <div className="border-t border-gray-200 dark:border-gray-700 p-3 space-y-0.5">
        {!isSuperAdmin && (
          <Link href="/profile" className={linkClass(pathname === '/profile')}>
            <User className="h-4 w-4 shrink-0" />
            Profile &amp; Signature
          </Link>
        )}
        <button
          onClick={toggle}
          className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
        >
          {theme === 'dark' ? <Sun className="h-4 w-4 shrink-0" /> : <Moon className="h-4 w-4 shrink-0" />}
          {theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
        </button>
        <div className="flex items-center gap-3 rounded-md px-2 py-2">
          <div className={cn(
            'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
            isSuperAdmin
              ? 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300'
              : 'bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300'
          )}>
            {isSuperAdmin ? <ShieldCheck className="h-4 w-4" /> : getInitials(session?.user?.name || 'U')}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">{session?.user?.name}</p>
            <p className="truncate text-xs text-gray-500 dark:text-gray-400 capitalize">
              {role === 'SUPER_ADMIN' ? 'Super Admin' : role?.replace('_', ' ').toLowerCase()}
            </p>
          </div>
          <button
            onClick={() => signOut({ callbackUrl: '/login' })}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            title="Sign out"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </aside>
  )
}
