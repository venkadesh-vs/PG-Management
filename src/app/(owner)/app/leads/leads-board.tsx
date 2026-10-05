'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AnimatePresence, LayoutGroup, motion } from 'framer-motion'
import { BellRing, ClipboardList, Columns3, List, Search } from 'lucide-react'
import { api } from '@/lib/client'
import { cn, formatDate, formatMoney } from '@/lib/utils'
import { useToast } from '@/components/ui/toast'
import { Input, Select } from '@/components/ui/input'
import { EmptyState } from '@/components/ui/feedback'
import { SPRING } from '@/components/motion/reveal'
import { ContactButtons, followUpState, LeadCard } from './lead-card'
import { LostDialog, VisitDialog } from './lead-dialogs'
import { NewLeadButton } from './new-lead'
import {
  PIPELINE,
  SOURCE_LABEL,
  SOURCES,
  STATUS_META,
  SYSTEM_STATUSES,
  type LeadCardData,
  type LeadStatus,
} from './lead-meta'

type View = 'board' | 'list'

export function LeadsBoard({
  leads: initial,
  properties,
  defaultPropertyId,
  canManage,
  initialFollowUps,
}: {
  leads: LeadCardData[]
  properties: { id: string; name: string }[]
  defaultPropertyId: string | null
  canManage: boolean
  initialFollowUps?: boolean
}) {
  const router = useRouter()
  const toast = useToast()
  const [leads, setLeads] = React.useState(initial)
  const [view, setView] = React.useState<View>('board')
  const [q, setQ] = React.useState('')
  const [source, setSource] = React.useState('')
  const [dueOnly, setDueOnly] = React.useState(Boolean(initialFollowUps))
  const [mobileStatus, setMobileStatus] = React.useState<LeadStatus>('NEW')
  const [dragId, setDragId] = React.useState<string | null>(null)
  const [overCol, setOverCol] = React.useState<LeadStatus | null>(null)
  const [lostFor, setLostFor] = React.useState<LeadCardData | null>(null)
  const [visitFor, setVisitFor] = React.useState<LeadCardData | null>(null)

  React.useEffect(() => setLeads(initial), [initial])

  // Remember the board/list choice on this device.
  React.useEffect(() => {
    try {
      const saved = window.localStorage.getItem('stayflow.leads.view')
      if (saved === 'board' || saved === 'list') setView(saved)
    } catch {
      /* storage unavailable */
    }
  }, [])
  function chooseView(next: View) {
    setView(next)
    try {
      window.localStorage.setItem('stayflow.leads.view', next)
    } catch {
      /* storage unavailable */
    }
  }

  const filtered = React.useMemo(() => {
    const needle = q.trim().toLowerCase()
    const digits = needle.replace(/\D/g, '')
    return leads.filter((lead) => {
      if (source && lead.source !== source) return false
      if (dueOnly) {
        const state = followUpState(lead)
        if (state !== 'overdue' && state !== 'today') return false
      }
      if (!needle) return true
      return lead.name.toLowerCase().includes(needle) || (digits.length > 2 && lead.phone.includes(digits))
    })
  }, [leads, q, source, dueOnly])

  const byStatus = React.useMemo(() => {
    const map = new Map<LeadStatus, LeadCardData[]>()
    for (const col of PIPELINE) map.set(col.status, [])
    for (const lead of filtered) map.get(lead.status)?.push(lead)
    return map
  }, [filtered])

  const dueCount = leads.filter((l) => {
    const s = followUpState(l)
    return s === 'overdue' || s === 'today'
  }).length

  async function move(lead: LeadCardData, status: LeadStatus) {
    if (lead.status === status) return
    if (!canManage) {
      toast.warning('View only', 'Your role can see enquiries but not change them.')
      return
    }
    if (SYSTEM_STATUSES.includes(status)) {
      toast.info(
        status === 'CHECKED_IN' ? 'Check-in moves them there' : 'Bookings move them there',
        status === 'CHECKED_IN'
          ? 'Check them in from their booking and the enquiry closes on its own.'
          : `Open ${lead.name.split(' ')[0]}’s enquiry and tap “Create booking” to hold a bed.`,
      )
      return
    }
    if (SYSTEM_STATUSES.includes(lead.status)) {
      toast.warning('This enquiry has a booking', 'Cancel the booking first to move them back.')
      return
    }
    if (status === 'LOST') return setLostFor(lead)
    if (status === 'VISIT_SCHEDULED') return setVisitFor(lead)

    const previous = leads
    setLeads((list) => list.map((l) => (l.id === lead.id ? { ...l, status } : l)))
    try {
      const result = await api.patch<{ message: string }>(`/api/resident-leads/${lead.id}`, {
        action: 'SET_STATUS',
        status,
      })
      toast.success(`${lead.name.split(' ')[0]} → ${STATUS_META[status].label}`, result.message)
      router.refresh()
    } catch (error) {
      setLeads(previous)
      toast.fromError(error, 'move the enquiry')
    }
  }

  function onDrop(status: LeadStatus) {
    const lead = leads.find((l) => l.id === dragId)
    setDragId(null)
    setOverCol(null)
    if (lead) void move(lead, status)
  }

  if (!leads.length) {
    return (
      <EmptyState
        icon={ClipboardList}
        title="Start filling your beds — add your first enquiry"
        description="Every call, walk-in and WhatsApp message about a bed goes here. Log calls, schedule visits and turn interest into bookings."
        action={canManage ? <NewLeadButton properties={properties} defaultPropertyId={defaultPropertyId} /> : undefined}
      />
    )
  }

  return (
    <div className="space-y-4">
      {/* ------------------------------------------------ toolbar */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or phone" className="pl-9" />
        </div>
        <div className="flex gap-2">
          <Select value={source} onChange={(e) => setSource(e.target.value)} className="sm:w-40" aria-label="Source">
            <option value="">All sources</option>
            {SOURCES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
          <button
            type="button"
            onClick={() => setDueOnly((v) => !v)}
            className={cn(
              'inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl border px-3 text-sm font-semibold transition-colors',
              dueOnly
                ? 'border-red-200 bg-red-50 text-red-700'
                : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50',
            )}
          >
            <BellRing className="size-4" /> Due today
            {dueCount > 0 && (
              <span className="rounded-full bg-red-500 px-1.5 text-[11px] text-white tabular">{dueCount}</span>
            )}
          </button>
          <div className="hidden rounded-xl border border-slate-200 bg-white p-0.5 lg:flex">
            {(
              [
                ['board', Columns3, 'Board'],
                ['list', List, 'List'],
              ] as const
            ).map(([key, Icon, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => chooseView(key)}
                className={cn(
                  'inline-flex h-9 items-center gap-1.5 rounded-[10px] px-3 text-sm font-medium transition-colors',
                  view === key ? 'bg-slate-900 text-white' : 'text-slate-500 hover:text-slate-900',
                )}
              >
                <Icon className="size-4" /> {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ------------------------------------------------ mobile: status picker + list */}
      <div className="space-y-3 lg:hidden">
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 scrollbar-slim">
          {PIPELINE.map((col) => {
            const count = byStatus.get(col.status)?.length ?? 0
            const active = mobileStatus === col.status
            return (
              <button
                key={col.status}
                type="button"
                onClick={() => setMobileStatus(col.status)}
                className={cn(
                  'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors',
                  active ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-600',
                )}
              >
                <span className={cn('size-1.5 rounded-full', col.dot)} />
                {col.label}
                <span className={cn('tabular text-xs', active ? 'text-white/70' : 'text-slate-400')}>{count}</span>
              </button>
            )
          })}
        </div>
        <div className="space-y-2">
          <AnimatePresence initial={false} mode="popLayout">
            {(byStatus.get(mobileStatus) ?? []).map((lead) => (
              <motion.div
                key={lead.id}
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={SPRING}
                className="space-y-1.5"
              >
                <LeadCard lead={lead} />
                {canManage && !SYSTEM_STATUSES.includes(lead.status) && lead.status !== 'LOST' && (
                  <Select
                    aria-label={`Move ${lead.name}`}
                    value={lead.status}
                    onChange={(e) => void move(lead, e.target.value as LeadStatus)}
                    className="h-9 text-xs"
                  >
                    {PIPELINE.filter((p) => !SYSTEM_STATUSES.includes(p.status)).map((p) => (
                      <option key={p.status} value={p.status}>
                        Move to: {p.label}
                      </option>
                    ))}
                  </Select>
                )}
              </motion.div>
            ))}
          </AnimatePresence>
          {(byStatus.get(mobileStatus) ?? []).length === 0 && (
            <EmptyState compact icon={ClipboardList} title={`No one in ${STATUS_META[mobileStatus].label.toLowerCase()}`} description="Pick another stage above." />
          )}
        </div>
      </div>

      {/* ------------------------------------------------ desktop: kanban */}
      {view === 'board' ? (
        <LayoutGroup>
          <div className="hidden gap-3 overflow-x-auto pb-3 scrollbar-slim lg:flex">
            {PIPELINE.map((col) => {
              const items = byStatus.get(col.status) ?? []
              const isSystem = SYSTEM_STATUSES.includes(col.status)
              const isOver = overCol === col.status && dragId !== null
              return (
                <div
                  key={col.status}
                  onDragOver={(e) => {
                    if (!dragId) return
                    e.preventDefault()
                    if (overCol !== col.status) setOverCol(col.status)
                  }}
                  onDragLeave={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOverCol(null)
                  }}
                  onDrop={(e) => {
                    e.preventDefault()
                    onDrop(col.status)
                  }}
                  className={cn(
                    'flex w-64 shrink-0 flex-col rounded-2xl border bg-gradient-to-b to-transparent p-2 transition-colors',
                    col.column,
                    isOver
                      ? isSystem
                        ? 'border-dashed border-slate-300'
                        : 'border-blue-300 ring-2 ring-blue-500/15'
                      : 'border-slate-200/70',
                  )}
                >
                  <div className="flex items-center justify-between px-1.5 pb-2 pt-1">
                    <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
                      <span className={cn('size-2 rounded-full', col.dot)} />
                      {col.label}
                    </p>
                    <span className="rounded-full bg-white px-2 text-xs font-semibold text-slate-500 shadow-sm tabular">
                      {items.length}
                    </span>
                  </div>
                  <div className="flex min-h-24 flex-1 flex-col gap-2">
                    {items.map((lead) => (
                      <div
                        key={lead.id}
                        draggable={canManage}
                        onDragStart={(e) => {
                          e.dataTransfer.effectAllowed = 'move'
                          e.dataTransfer.setData('text/plain', lead.id)
                          setDragId(lead.id)
                        }}
                        onDragEnd={() => {
                          setDragId(null)
                          setOverCol(null)
                        }}
                        className={cn(canManage && 'cursor-grab active:cursor-grabbing')}
                      >
                        <motion.div
                          layout
                          layoutId={`lead-${lead.id}`}
                          transition={SPRING}
                          animate={{ opacity: dragId === lead.id ? 0.45 : 1, scale: dragId === lead.id ? 0.98 : 1 }}
                        >
                          <LeadCard lead={lead} />
                        </motion.div>
                      </div>
                    ))}
                    {items.length === 0 && (
                      <p className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-slate-200 px-3 py-6 text-center text-xs text-slate-400">
                        {isSystem ? 'Moves here from bookings' : 'Drag a card here'}
                      </p>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </LayoutGroup>
      ) : (
        <LeadTable leads={filtered} />
      )}

      <LostDialog
        lead={lostFor}
        open={Boolean(lostFor)}
        onOpenChange={(open) => !open && setLostFor(null)}
        onDone={() => router.refresh()}
      />
      <VisitDialog
        lead={visitFor}
        open={Boolean(visitFor)}
        onOpenChange={(open) => !open && setVisitFor(null)}
        onDone={() => router.refresh()}
      />
    </div>
  )
}

function LeadTable({ leads }: { leads: LeadCardData[] }) {
  return (
    <div className="hidden overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-card lg:block">
      <table className="w-full text-sm">
        <thead className="bg-slate-50/80 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-3">Name</th>
            <th className="px-4 py-3">Stage</th>
            <th className="px-4 py-3">PG</th>
            <th className="px-4 py-3">Budget</th>
            <th className="px-4 py-3">Move-in</th>
            <th className="px-4 py-3">Follow-up</th>
            <th className="px-4 py-3">Source</th>
            <th className="px-4 py-3 text-right">Contact</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {leads.map((lead) => {
            const meta = STATUS_META[lead.status]
            const follow = followUpState(lead)
            return (
              <tr key={lead.id} className="transition-colors hover:bg-slate-50/60">
                <td className="px-4 py-3">
                  <Link href={`/app/leads/${lead.id}`} className="font-semibold text-slate-900 hover:text-blue-700">
                    {lead.name}
                  </Link>
                  <p className="text-xs text-slate-500 tabular">{lead.phone}</p>
                </td>
                <td className="px-4 py-3">
                  <span className={cn('rounded-full border px-2 py-0.5 text-xs font-medium', meta.chip)}>{meta.label}</span>
                </td>
                <td className="px-4 py-3 text-slate-600">{lead.property?.name ?? '—'}</td>
                <td className="px-4 py-3 text-slate-600 tabular">{lead.budget ? formatMoney(lead.budget) : '—'}</td>
                <td className="px-4 py-3 text-slate-600">{formatDate(lead.moveInDate)}</td>
                <td
                  className={cn(
                    'px-4 py-3',
                    follow === 'overdue' ? 'font-semibold text-red-600' : follow === 'today' ? 'font-semibold text-amber-700' : 'text-slate-600',
                  )}
                >
                  {follow ? formatDate(lead.nextFollowUpAt) : '—'}
                </td>
                <td className="px-4 py-3 text-slate-600">{SOURCE_LABEL[lead.source] ?? lead.source}</td>
                <td className="px-4 py-3">
                  <div className="flex justify-end">
                    <ContactButtons lead={lead} compact />
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {leads.length === 0 && <p className="p-8 text-center text-sm text-slate-500">No enquiries match these filters.</p>}
    </div>
  )
}
