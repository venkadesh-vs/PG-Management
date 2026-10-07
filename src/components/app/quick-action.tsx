'use client'

import * as React from 'react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowLeft,
  ChevronRight,
  ClipboardList,
  DoorOpen,
  Loader2,
  Megaphone,
  Plus,
  Receipt,
  Search,
  UserCheck,
  UserPlus,
  Wallet,
  Wrench,
  X,
} from 'lucide-react'
import { api } from '@/lib/client'
import { cn } from '@/lib/utils'

export type ShellAccess = { role: string; modules: string[]; permissions: string[] }

type QuickActionDef = {
  key: string
  label: string
  hint: string
  href: string
  icon: React.ComponentType<{ className?: string }>
  tone: string
  module?: string
  permission?: string
  /** Opens a picker inside the sheet instead of navigating straight away. */
  picker?: 'checkout'
}

const ACTIONS: QuickActionDef[] = [
  { key: 'checkin', label: 'Add resident', hint: 'Check in — bed, rent and deposit', href: '/app/residents/new', icon: UserPlus, tone: 'bg-blue-50 text-blue-600', module: 'residents', permission: 'residents.manage' },
  // The payments page has no ?record=1 hook yet, so this lands on the page
  // where the "Record payment" button lives.
  { key: 'payment', label: 'Collect rent', hint: 'Record cash, UPI or bank payment', href: '/app/payments', icon: Wallet, tone: 'bg-emerald-50 text-emerald-600', module: 'rent', permission: 'payments.record' },
  { key: 'expense', label: 'Add expense', hint: 'Bills, groceries, repairs', href: '/app/expenses?new=1', icon: Receipt, tone: 'bg-red-50 text-red-600', module: 'expenses', permission: 'expenses.manage' },
  { key: 'complaint', label: 'Complaint', hint: 'Log an issue and assign it', href: '/app/complaints?new=1', icon: Wrench, tone: 'bg-amber-50 text-amber-600', module: 'complaints', permission: 'complaints.manage' },
  { key: 'visitor', label: 'Visitor', hint: 'Sign a guest in', href: '/app/visitors?new=1', icon: UserCheck, tone: 'bg-sky-50 text-sky-600', module: 'visitors', permission: 'visitors.manage' },
  { key: 'checkout', label: 'Checkout', hint: 'Pick a resident and settle their deposit', href: '/app/residents', icon: DoorOpen, tone: 'bg-rose-50 text-rose-600', module: 'residents', permission: 'residents.checkout', picker: 'checkout' },
  { key: 'announcement', label: 'Announcement', hint: 'Notify residents of a PG', href: '/app/announcements', icon: Megaphone, tone: 'bg-indigo-50 text-indigo-600', module: 'announcements', permission: 'announcements.send' },
  { key: 'enquiry', label: 'Add enquiry', hint: 'Someone asked about a bed', href: '/app/leads?new=1', icon: ClipboardList, tone: 'bg-violet-50 text-violet-600', module: 'leads', permission: 'leads.manage' },
]

/** The quick actions this person may take (owners hold every permission). */
export function quickActionsFor(access: ShellAccess): QuickActionDef[] {
  return ACTIONS.filter((a) => {
    if (a.module && !access.modules.includes(a.module)) return false
    if (a.permission && access.role !== 'OWNER' && !access.permissions.includes(a.permission)) return false
    return true
  })
}

/** Keep the selected PG (?property=) when jumping to an action. */
function withProperty(href: string, propertyId: string | null) {
  if (!propertyId) return href
  return `${href}${href.includes('?') ? '&' : '?'}property=${encodeURIComponent(propertyId)}`
}

/**
 * "+ Quick action": a floating button above the bottom nav on phones, a
 * header button on desktop. Both open the same staggered list; it closes on
 * navigation, Escape or a tap outside.
 */
export function QuickAction({ access, variant }: { access: ShellAccess; variant: 'fab' | 'header' }) {
  const actions = React.useMemo(() => quickActionsFor(access), [access])
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const propertyId = searchParams.get('property')
  const [open, setOpen] = React.useState(false)
  const [view, setView] = React.useState<'list' | 'checkout'>('list')
  const rootRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => setOpen(false), [pathname, searchParams])
  // Every opening starts from the action list.
  React.useEffect(() => {
    if (!open) setView('list')
  }, [open])

  React.useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    function onPointer(e: PointerEvent) {
      if (variant === 'header' && rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onPointer)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onPointer)
    }
  }, [open, variant])

  if (actions.length === 0) return null

  const list = (
    <motion.ul
      initial="hidden"
      animate="show"
      variants={{ show: { transition: { staggerChildren: 0.04, delayChildren: 0.04 } } }}
      className="space-y-1"
    >
      {actions.map((action) => (
        <motion.li
          key={action.key}
          variants={{
            hidden: { opacity: 0, y: 8 },
            show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 420, damping: 30 } },
          }}
        >
          {action.picker ? (
            <button
              type="button"
              onClick={() => setView(action.picker!)}
              className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors hover:bg-slate-50 active:bg-slate-100"
            >
              <ActionRow action={action} />
              <ChevronRight className="ml-auto size-4 shrink-0 text-slate-300" />
            </button>
          ) : (
            <Link
              href={withProperty(action.href, propertyId)}
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 rounded-xl px-2.5 py-2.5 transition-colors hover:bg-slate-50 active:bg-slate-100"
            >
              <ActionRow action={action} />
            </Link>
          )}
        </motion.li>
      ))}
    </motion.ul>
  )

  const content =
    view === 'checkout' ? (
      <CheckoutPicker propertyId={propertyId} onBack={() => setView('list')} onPick={() => setOpen(false)} />
    ) : (
      list
    )

  if (variant === 'header') {
    return (
      <div ref={rootRef} className="relative hidden lg:block">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-haspopup="menu"
          className="flex h-9 items-center gap-1.5 rounded-xl bg-blue-600 px-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700"
        >
          <motion.span animate={{ rotate: open ? 45 : 0 }} transition={{ type: 'spring', stiffness: 400, damping: 22 }}>
            <Plus className="size-4" />
          </motion.span>
          Quick action
        </button>
        <AnimatePresence>
          {open && (
            <motion.div
              role="menu"
              initial={{ opacity: 0, y: -6, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.97 }}
              transition={{ type: 'spring', stiffness: 420, damping: 32 }}
              className="absolute right-0 top-11 z-40 w-80 origin-top-right rounded-2xl border border-slate-200 bg-white p-2 shadow-elevated"
            >
              {content}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    )
  }

  return (
    <div className="lg:hidden">
      <AnimatePresence>
        {open && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setOpen(false)}
              className="fixed inset-0 z-40 bg-slate-950/40 backdrop-blur-[2px]"
            />
            <motion.div
              role="dialog"
              aria-label="Quick actions"
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', stiffness: 380, damping: 34 }}
              className="pb-safe fixed inset-x-0 bottom-0 z-50 rounded-t-3xl bg-white px-3 pt-2 shadow-elevated"
            >
              <div className="mx-auto mb-2 h-1.5 w-10 rounded-full bg-slate-200" />
              <div className="flex items-center justify-between px-2.5 pb-2">
                <p className="font-display text-base font-semibold text-slate-900">Quick action</p>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close quick actions"
                  className="rounded-lg p-2 text-slate-400 hover:bg-slate-100"
                >
                  <X className="size-5" />
                </button>
              </div>
              <div className="max-h-[70vh] overflow-y-auto pb-3">{content}</div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <motion.button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Quick action"
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        whileTap={{ scale: 0.92 }}
        transition={{ type: 'spring', stiffness: 460, damping: 24 }}
        style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 5.25rem)' }}
        className="fixed right-4 z-30 flex size-14 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-elevated ring-4 ring-white/70 transition-colors active:bg-blue-700"
      >
        <Plus className="size-6" />
      </motion.button>
    </div>
  )
}

function ActionRow({ action }: { action: QuickActionDef }) {
  return (
    <>
      <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-xl', action.tone)}>
        <action.icon className="size-[18px]" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold text-slate-800">{action.label}</span>
        <span className="block truncate text-xs text-slate-500">{action.hint}</span>
      </span>
    </>
  )
}

type PickerResident = {
  id: string
  code: string
  fullName: string
  room: { number: string } | null
  bed: { label: string } | null
  property: { name: string }
}

/**
 * Checkout from anywhere: pick an active (or on-notice) resident, then land
 * on their page with the checkout dialog already open (?checkout=1).
 */
function CheckoutPicker({
  propertyId,
  onBack,
  onPick,
}: {
  propertyId: string | null
  onBack: () => void
  onPick: () => void
}) {
  const [residents, setResidents] = React.useState<PickerResident[] | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [query, setQuery] = React.useState('')

  React.useEffect(() => {
    let alive = true
    const url = propertyId ? `/api/residents?propertyId=${encodeURIComponent(propertyId)}` : '/api/residents'
    api
      .get<{ residents: PickerResident[] }>(url)
      .then((res) => {
        if (alive) setResidents(res.residents)
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : 'Could not load residents')
      })
    return () => {
      alive = false
    }
  }, [propertyId])

  const q = query.trim().toLowerCase()
  const shown = (residents ?? []).filter(
    (r) =>
      !q ||
      r.fullName.toLowerCase().includes(q) ||
      r.code.toLowerCase().includes(q) ||
      (r.room?.number ?? '').toLowerCase().includes(q),
  )

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1 px-1">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to quick actions"
          className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
        >
          <ArrowLeft className="size-4" />
        </button>
        <p className="text-sm font-semibold text-slate-800">Who is checking out?</p>
      </div>
      <label className="relative block px-1">
        <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Name, code or room"
          aria-label="Search residents"
          className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-[15px] focus-visible:border-blue-500 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-500/15 sm:text-sm"
        />
      </label>
      <div className="max-h-80 overflow-y-auto">
        {error ? (
          <p className="px-3 py-6 text-center text-sm text-red-600">{error}</p>
        ) : !residents ? (
          <p className="flex items-center justify-center gap-2 px-3 py-6 text-sm text-slate-500">
            <Loader2 className="size-4 animate-spin" />
            Loading residents…
          </p>
        ) : shown.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-slate-500">
            {residents.length === 0 ? 'No active residents.' : 'No one matches that search.'}
          </p>
        ) : (
          <ul className="space-y-0.5">
            {shown.slice(0, 50).map((r) => (
              <li key={r.id}>
                <Link
                  href={`/app/residents/${r.id}?checkout=1`}
                  onClick={onPick}
                  className="flex items-center gap-3 rounded-xl px-2.5 py-2.5 transition-colors hover:bg-slate-50 active:bg-slate-100"
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">
                    {r.fullName
                      .split(' ')
                      .map((w) => w[0])
                      .slice(0, 2)
                      .join('')
                      .toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-slate-800">{r.fullName}</span>
                    <span className="block truncate text-xs text-slate-500">
                      {r.room ? `Room ${r.room.number}${r.bed ? `-${r.bed.label}` : ''} · ` : ''}
                      {r.property.name}
                    </span>
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-slate-300" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
