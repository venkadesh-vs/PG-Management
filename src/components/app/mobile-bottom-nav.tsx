'use client'

import * as React from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { Menu } from 'lucide-react'
import { cn } from '@/lib/utils'
import { isActive, type NavItem, type NavSection } from '@/lib/navigation'
import { Icon, type IconName } from '@/lib/icons'
import type { ShellBadges } from './app-shell'

/** Preferred phone tabs, in order. Labels are shortened for the bar. */
const PRIMARY: { href: string; label: string; icon?: IconName }[] = [
  { href: '/app', label: 'Home', icon: 'home' },
  { href: '/app/residents', label: 'Residents' },
  { href: '/app/beds', label: 'Beds' },
  { href: '/app/complaints', label: 'Tasks' },
]

/** Never promoted into the bar when filling empty slots. */
const NOT_A_TAB = new Set(['/app/notifications', '/app/settings', '/app/subscription'])

const TAB_SLOTS = 4

/**
 * Tabs come from the already-filtered menu, so a tab exists only when the
 * person can open that page. Missing preferred tabs are back-filled with the
 * next pages they can see, so the bar is never half empty.
 */
export function bottomTabs(nav: NavSection[]): NavItem[] {
  const items = nav.flatMap((s) => s.items)
  const byHref = new Map(items.map((i) => [i.href, i]))
  const tabs: NavItem[] = []
  for (const p of PRIMARY) {
    const item = byHref.get(p.href)
    if (item) tabs.push({ ...item, label: p.label, icon: p.icon ?? item.icon })
  }
  for (const item of items) {
    if (tabs.length >= TAB_SLOTS) break
    if (NOT_A_TAB.has(item.href) || tabs.some((t) => t.href === item.href)) continue
    tabs.push(item)
  }
  return tabs.slice(0, TAB_SLOTS)
}

export function MobileBottomNav({
  nav,
  pathname,
  badges,
  moreOpen,
  onMore,
}: {
  nav: NavSection[]
  pathname: string
  badges: ShellBadges
  moreOpen: boolean
  onMore: () => void
}) {
  const tabs = React.useMemo(() => bottomTabs(nav), [nav])
  const activeHref = moreOpen ? null : (tabs.find((t) => isActive(pathname, t))?.href ?? null)
  const moreActive = moreOpen || activeHref === null

  return (
    <nav
      aria-label="Primary"
      className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/90 backdrop-blur-lg lg:hidden"
    >
      <ul className="mx-auto flex max-w-md items-stretch justify-around px-2 pt-1.5">
        {tabs.map((tab) => {
          const active = tab.href === activeHref
          const count = tab.badge ? badges[tab.badge] : 0
          return (
            <li key={tab.href} className="flex-1">
              <Link
                href={tab.href}
                aria-current={active ? 'page' : undefined}
                className="relative flex flex-col items-center gap-0.5 rounded-2xl px-1 py-1.5"
              >
                <TabIcon active={active} count={count}>
                  <Icon name={tab.icon} className="size-5" />
                </TabIcon>
                <span
                  className={cn(
                    'text-[11px] font-medium transition-colors',
                    active ? 'text-blue-700' : 'text-slate-500',
                  )}
                >
                  {tab.label}
                </span>
              </Link>
            </li>
          )
        })}
        <li className="flex-1">
          <button
            type="button"
            onClick={onMore}
            aria-label="More — open the full menu"
            aria-expanded={moreOpen}
            className="relative flex w-full flex-col items-center gap-0.5 rounded-2xl px-1 py-1.5"
          >
            <TabIcon active={moreActive} count={0}>
              <Menu className="size-5" />
            </TabIcon>
            <span
              className={cn(
                'text-[11px] font-medium transition-colors',
                moreActive ? 'text-blue-700' : 'text-slate-500',
              )}
            >
              More
            </span>
          </button>
        </li>
      </ul>
    </nav>
  )
}

function TabIcon({ active, count, children }: { active: boolean; count: number; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        'relative flex h-8 w-14 items-center justify-center transition-colors',
        active ? 'text-blue-700' : 'text-slate-400',
      )}
    >
      {active && (
        <motion.span
          layoutId="owner-bottom-nav-pill"
          transition={{ type: 'spring', stiffness: 500, damping: 36 }}
          className="absolute inset-0 rounded-full bg-blue-100/80"
        />
      )}
      <span className="relative">{children}</span>
      {count > 0 && (
        <motion.span
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', stiffness: 500, damping: 18 }}
          className="absolute right-2 top-0 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white tabular ring-2 ring-white"
        >
          {count > 99 ? '99+' : count}
        </motion.span>
      )}
    </span>
  )
}
