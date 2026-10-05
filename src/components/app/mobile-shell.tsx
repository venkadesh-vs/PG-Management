'use client'

import * as React from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { Bell, LogOut, MoreHorizontal } from 'lucide-react'
import { cn, initials } from '@/lib/utils'
import { isActive, type NavItem } from '@/lib/navigation'
import { Icon } from '@/lib/icons'
import { LogoMark } from '@/components/marketing/logo'
import { api } from '@/lib/client'
import { useToast } from '@/components/ui/toast'
import { Avatar, AvatarFallback } from '@/components/ui/primitives'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown'

/**
 * The shell for the resident and worker apps. Both are phone-first: a compact
 * header, a bottom tab bar that clears the home indicator, and nothing that
 * belongs to the owner's dashboard.
 */
export function MobileShell({
  nav,
  moreNav,
  user,
  subtitle,
  unread,
  accent = 'blue',
  children,
}: {
  nav: NavItem[]
  moreNav?: NavItem[]
  user: { name: string; email: string }
  subtitle?: string
  unread: number
  accent?: 'blue' | 'pink' | 'violet' | 'amber'
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const router = useRouter()
  const toast = useToast()

  const accents = {
    blue: { text: 'text-blue-600', bg: 'bg-blue-600', soft: 'bg-blue-50' },
    pink: { text: 'text-pink-600', bg: 'bg-pink-600', soft: 'bg-pink-50' },
    violet: { text: 'text-violet-600', bg: 'bg-violet-600', soft: 'bg-violet-50' },
    amber: { text: 'text-amber-600', bg: 'bg-amber-600', soft: 'bg-amber-50' },
  }[accent]

  async function signOut() {
    try {
      await api.post('/api/auth/logout')
      toast.info('Signed out', 'See you soon.')
      router.push('/login')
      router.refresh()
    } catch {
      toast.error('Unable to sign out', 'Please try again.')
    }
  }

  return (
    <div className="flex min-h-dvh flex-col bg-slate-50/70">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur-lg">
        <div className="mx-auto flex h-14 w-full max-w-3xl items-center gap-3 px-4">
          <LogoMark className="size-8" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-slate-900">{user.name}</p>
            {subtitle && <p className="truncate text-[11px] text-slate-500">{subtitle}</p>}
          </div>

          <Link
            href={`${nav[0].href === '/tenant' ? '/tenant' : '/worker'}/notifications`}
            aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}
            className="relative rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100"
          >
            <Bell className="size-[18px]" />
            {unread > 0 && (
              <motion.span
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                className="absolute right-1 top-1 flex size-4 items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white tabular"
              >
                {unread > 9 ? '9+' : unread}
              </motion.span>
            )}
          </Link>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Account menu"
                className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30"
              >
                <Avatar className="size-8">
                  <AvatarFallback className={cn(accents.soft, accents.text, 'text-[11px]')}>
                    {initials(user.name)}
                  </AvatarFallback>
                </Avatar>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuLabel>{user.email}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {moreNav?.map((item) => (
                <DropdownMenuItem key={item.href} asChild>
                  <Link href={item.href}>
                    <Icon name={item.icon} />
                    {item.label}
                  </Link>
                </DropdownMenuItem>
              ))}
              {moreNav && moreNav.length > 0 && <DropdownMenuSeparator />}
              <DropdownMenuItem destructive onSelect={signOut}>
                <LogOut />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-28 pt-5 sm:pb-8">{children}</main>

      {/* Bottom tab bar — the primary navigation on a phone. */}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 pb-safe backdrop-blur-lg sm:static sm:border-t-0 sm:bg-transparent sm:pb-0">
        <div className="mx-auto flex w-full max-w-3xl items-stretch justify-around px-2 pt-1.5 sm:hidden">
          {nav.map((item) => {
            const active = isActive(pathname, item)
            return (
              <Link
                key={item.href}
                href={item.href}
                className="relative flex flex-1 flex-col items-center gap-0.5 rounded-xl px-1 py-1.5"
              >
                {active && (
                  <motion.span
                    layoutId="tab-pill"
                    className={cn('absolute inset-x-2 -top-1.5 h-0.5 rounded-full', accents.bg)}
                    transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                  />
                )}
                <Icon
                  name={item.icon}
                  className={cn('size-5', active ? accents.text : 'text-slate-400')}
                />
                <span
                  className={cn(
                    'text-[10px] font-medium',
                    active ? accents.text : 'text-slate-500',
                  )}
                >
                  {item.label}
                </span>
              </Link>
            )
          })}
        </div>

        {/* On a tablet or wider the tabs read better as a pill row at the top. */}
        <div className="mx-auto hidden w-full max-w-3xl gap-1 px-4 pb-6 sm:flex">
          {[...nav, ...(moreNav ?? [])].map((item) => {
            const active = isActive(pathname, item)
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
                  active
                    ? cn(accents.bg, 'text-white')
                    : 'bg-white text-slate-600 hover:bg-slate-100',
                )}
              >
                <Icon name={item.icon} className="size-3.5" />
                {item.label}
              </Link>
            )
          })}
        </div>
      </nav>

      <MoreHorizontal className="sr-only" />
    </div>
  )
}
