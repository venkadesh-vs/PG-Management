'use client'

import * as React from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Bell,
  Building2,
  Check,
  ChevronsUpDown,
  LogOut,
  Menu,
  Search,
  Settings,
  X,
  KeyRound,
} from 'lucide-react'
import { cn, initials } from '@/lib/utils'
import { isActive, type NavSection } from '@/lib/navigation'
import { Icon } from '@/lib/icons'
import { PROPERTY_THEMES } from '@/lib/theme'
import { Logo, LogoMark } from '@/components/marketing/logo'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/primitives'
import { useToast } from '@/components/ui/toast'
import { api } from '@/lib/client'
import { GlobalSearch } from './global-search'
import { InstallPrompt } from '@/components/pwa/install-prompt'
import { RestrictedGate } from './restricted-gate'

export type ShellProperty = {
  id: string
  name: string
  type: 'MENS' | 'WOMENS' | 'COLIVE'
  city: string
}

export type ShellUser = {
  name: string
  email: string
  role: string
  avatarUrl: string | null
  organizationName: string | null
}

export type ShellBadges = {
  complaints: number
  notifications: number
  tasks: number
  leads: number
}

/**
 * The owner/admin application frame: a fixed sidebar on desktop, a slide-over
 * on mobile, plus the property switcher that re-themes the whole dashboard
 * blue (Men's PG) or pink (Women's PG).
 */
export function AppShell({
  nav,
  user,
  properties,
  badges,
  children,
  showPropertySwitcher = true,
  searchScope = 'org',
  installName,
  restricted = false,
}: {
  nav: NavSection[]
  user: ShellUser
  properties: ShellProperty[]
  badges: ShellBadges
  children: React.ReactNode
  showPropertySwitcher?: boolean
  searchScope?: 'org' | 'platform'
  installName?: string
  /** Organization suspended for non-payment: only billing pages render. */
  restricted?: boolean
}) {
  const pathname = usePathname()
  const [mobileOpen, setMobileOpen] = React.useState(false)
  const [searchOpen, setSearchOpen] = React.useState(false)

  // Close the mobile drawer whenever the route changes.
  React.useEffect(() => setMobileOpen(false), [pathname])

  // ⌘K / Ctrl+K opens global search.
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setSearchOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="min-h-dvh bg-slate-50/70">
      {/* ------------------------------------------------ Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-slate-200 bg-white lg:flex">
        <div className="flex h-16 items-center border-b border-slate-100 px-5">
          <Logo href={null} />
        </div>
        <SidebarNav nav={nav} pathname={pathname} badges={badges} />
        <UserPanel user={user} />
      </aside>

      {/* ------------------------------------------------- Mobile drawer */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMobileOpen(false)}
              className="fixed inset-0 z-40 bg-slate-950/40 backdrop-blur-[2px] lg:hidden"
            />
            <motion.aside
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', stiffness: 380, damping: 36 }}
              className="fixed inset-y-0 left-0 z-50 flex w-[85%] max-w-xs flex-col bg-white lg:hidden"
            >
              <div className="flex h-16 items-center justify-between border-b border-slate-100 px-5">
                <Logo href={null} />
                <button
                  type="button"
                  onClick={() => setMobileOpen(false)}
                  aria-label="Close menu"
                  className="rounded-lg p-2 text-slate-400 hover:bg-slate-100"
                >
                  <X className="size-5" />
                </button>
              </div>
              <SidebarNav nav={nav} pathname={pathname} badges={badges} />
              <UserPanel user={user} />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* ---------------------------------------------------- Main column */}
      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-slate-200 bg-white/85 px-4 backdrop-blur-lg sm:px-6">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
            className="-ml-1 rounded-lg p-2 text-slate-500 hover:bg-slate-100 lg:hidden"
          >
            <Menu className="size-5" />
          </button>

          <div className="lg:hidden">
            <LogoMark className="size-8" />
          </div>

          {showPropertySwitcher && properties.length > 0 && (
            <PropertySwitcher properties={properties} />
          )}

          <div className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              className="flex h-9 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-400 transition-colors hover:border-slate-300 hover:text-slate-600"
            >
              <Search className="size-4" />
              <span className="hidden sm:inline">Search</span>
              <kbd className="hidden rounded border border-slate-200 bg-slate-50 px-1.5 font-sans text-[10px] font-medium text-slate-400 sm:inline">
                ⌘K
              </kbd>
            </button>

            <NotificationBell count={badges.notifications} />
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 sm:py-8">
          {installName && <InstallPrompt appName={installName} className="mb-6 lg:hidden" />}
          {restricted ? <RestrictedGate pathname={pathname}>{children}</RestrictedGate> : children}
        </main>
      </div>

      <GlobalSearch open={searchOpen} onOpenChange={setSearchOpen} scope={searchScope} />
    </div>
  )
}

function SidebarNav({
  nav,
  pathname,
  badges,
}: {
  nav: NavSection[]
  pathname: string
  badges: ShellBadges
}) {
  return (
    <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-5 scrollbar-slim">
      {nav.map((section, i) => (
        <div key={section.title ?? i} className="space-y-1">
          {section.title && (
            <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              {section.title}
            </p>
          )}
          {section.items.map((item) => {
            const active = isActive(pathname, item)
            const count = item.badge ? badges[item.badge] : 0
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'group relative flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors',
                  active
                    ? 'bg-slate-900 text-white shadow-sm'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
                )}
              >
                <Icon
                  name={item.icon}
                  className={cn(
                    'size-[18px] shrink-0 transition-colors',
                    active ? 'text-white' : 'text-slate-400 group-hover:text-slate-600',
                  )}
                />
                <span className="flex-1 truncate">{item.label}</span>
                {count > 0 && (
                  <span
                    className={cn(
                      'flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold tabular',
                      active ? 'bg-white/15 text-white' : 'bg-red-100 text-red-700',
                    )}
                  >
                    {count > 99 ? '99+' : count}
                  </span>
                )}
              </Link>
            )
          })}
        </div>
      ))}
    </nav>
  )
}

function UserPanel({ user }: { user: ShellUser }) {
  const router = useRouter()
  const toast = useToast()
  const [loading, setLoading] = React.useState(false)

  async function signOut() {
    setLoading(true)
    try {
      await api.post('/api/auth/logout')
      toast.info('Signed out', 'See you soon.')
      router.push('/login')
      router.refresh()
    } catch {
      toast.error('Unable to sign out', 'Please try again.')
      setLoading(false)
    }
  }

  return (
    <div className="border-t border-slate-100 p-3">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center gap-3 rounded-xl p-2 text-left transition-colors hover:bg-slate-100"
          >
            <Avatar className="size-9">
              {user.avatarUrl && <AvatarImage src={user.avatarUrl} alt="" />}
              <AvatarFallback>{initials(user.name)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-slate-800">{user.name}</p>
              <p className="truncate text-xs text-slate-500">
                {user.organizationName ?? user.role.replace('_', ' ').toLowerCase()}
              </p>
            </div>
            <ChevronsUpDown className="size-4 shrink-0 text-slate-400" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="top" className="w-56">
          <DropdownMenuLabel>{user.email}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href="/app/settings">
              <Settings />
              Settings
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/app/notifications">
              <Bell />
              Notifications
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/change-password">
              <KeyRound />
              Change password
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem destructive onSelect={signOut} disabled={loading}>
            <LogOut />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

/**
 * Switching PG re-themes the dashboard and re-scopes every query through the
 * `property` search param, which the server layout reads.
 */
function PropertySwitcher({ properties }: { properties: ShellProperty[] }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const current = searchParams.get('property')
  const selected = properties.find((p) => p.id === current) ?? null
  const theme = selected ? PROPERTY_THEMES[selected.type] : null

  function select(id: string | null) {
    const params = new URLSearchParams(searchParams.toString())
    if (id) params.set('property', id)
    else params.delete('property')
    router.push(`${pathname}?${params.toString()}`)
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            'flex h-9 max-w-[200px] items-center gap-2 rounded-xl border px-2.5 text-sm font-medium transition-colors sm:max-w-none',
            theme ? cn(theme.chip, 'border') : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300',
          )}
        >
          <Building2 className="size-4 shrink-0" />
          <span className="truncate">{selected ? selected.name : 'All PGs'}</span>
          <ChevronsUpDown className="size-3.5 shrink-0 opacity-60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Switch property</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => select(null)}>
          <Building2 />
          <span className="flex-1">All PGs</span>
          {!selected && <Check className="size-4 text-blue-600" />}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {properties.map((property) => {
          const t = PROPERTY_THEMES[property.type]
          return (
            <DropdownMenuItem key={property.id} onSelect={() => select(property.id)}>
              <span className={cn('size-2 rounded-full', t.bgSolid)} />
              <span className="flex-1 truncate">
                <span className="block truncate font-medium text-slate-800">{property.name}</span>
                <span className="block truncate text-[11px] text-slate-500">
                  {t.label} · {property.city}
                </span>
              </span>
              {selected?.id === property.id && <Check className="size-4 text-blue-600" />}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function NotificationBell({ count }: { count: number }) {
  return (
    <Button variant="ghost" size="icon" asChild className="relative">
      <Link href="/app/notifications" aria-label={`Notifications${count ? `, ${count} unread` : ''}`}>
        <Bell className="size-[18px]" />
        {count > 0 && (
          <motion.span
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', stiffness: 500, damping: 18 }}
            className="absolute right-1.5 top-1.5 flex size-4 items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white tabular"
          >
            {count > 9 ? '9+' : count}
          </motion.span>
        )}
      </Link>
    </Button>
  )
}

/** A profile chip used by the tenant and worker headers. */
export function ProfileChip({ name, sub }: { name: string; sub?: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <Avatar className="size-9">
        <AvatarFallback>{initials(name)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-slate-900">{name}</p>
        {sub && <p className="truncate text-xs text-slate-500">{sub}</p>}
      </div>
    </div>
  )
}
