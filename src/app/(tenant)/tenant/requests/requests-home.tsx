'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { ChevronRight, UtensilsCrossed } from 'lucide-react'
import type { ResidentRequestKind, ResidentRequestStatus } from '@prisma/client'
import { api } from '@/lib/client'
import { cn, formatDate, formatDateTime, relativeTime } from '@/lib/utils'
import { useToast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { StatusChip } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/feedback'
import { Stagger, StaggerItem } from '@/components/motion/reveal'
import { RequestFormDialog, type FormKind } from './request-form'
import { KIND_META, STATUS_META, cleanDetails, hasMealsPaused } from './request-meta'

export type TenantRequest = {
  id: string
  kind: ResidentRequestKind
  status: ResidentRequestStatus
  title: string
  details: string | null
  fromDate: string | null
  toDate: string | null
  visitorCount: number | null
  decisionNote: string | null
  decidedBy: string | null
  decidedAt: string | null
  createdAt: string
}

const TILES: { kind: FormKind; title: string; hint: string; meta: ResidentRequestKind }[] = [
  { kind: 'LEAVE', title: 'Going home / leave', hint: 'Tell us when you are away', meta: 'LEAVE' },
  { kind: 'VISITOR', title: 'Expecting a visitor', hint: 'Get them approved at the gate', meta: 'VISITOR' },
  { kind: 'ROOM_CHANGE', title: 'Change my room', hint: 'Ask for a different room or bed', meta: 'ROOM_CHANGE' },
  { kind: 'SERVICE', title: 'Something else', hint: 'Cleaning, keys, repairs and more', meta: 'SERVICE' },
]

export function RequestsHome({
  requests,
  canPauseMeals,
}: {
  requests: TenantRequest[]
  canPauseMeals: boolean
  /** Kept for callers; tiles use the single brand accent. */
  accent?: 'blue' | 'pink'
}) {
  const [kind, setKind] = React.useState<FormKind | null>(null)
  const waiting = requests.filter((r) => r.status === 'PENDING').length

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-xl font-semibold tracking-tight text-slate-900">Requests</h1>
        <p className="mt-0.5 text-sm text-slate-500">
          {waiting > 0 ? `${waiting} waiting for an answer` : 'Ask your PG for anything, right from here.'}
        </p>
      </div>

      <Stagger onView={false} className="grid grid-cols-2 gap-3">
        {TILES.map((tile) => {
          const meta = KIND_META[tile.meta]
          const Icon = meta.icon
          return (
            <StaggerItem key={tile.kind}>
              <button
                type="button"
                onClick={() => setKind(tile.kind)}
                className={cn(
                  'group flex h-full w-full flex-col items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 text-left shadow-card transition-all active:scale-[0.98]',
                  'hover:border-blue-200',
                  'hover:shadow-sm',
                )}
              >
                <span className={cn('flex size-11 items-center justify-center rounded-xl', meta.tint)}>
                  <Icon className={cn('size-5', meta.iconTint)} />
                </span>
                <span>
                  <span className="block font-display text-[15px] font-semibold leading-tight text-slate-900">
                    {tile.title}
                  </span>
                  <span className="mt-1 block text-xs text-slate-500">{tile.hint}</span>
                </span>
              </button>
            </StaggerItem>
          )
        })}
      </Stagger>

      <section className="space-y-2">
        <h2 className="font-display text-sm font-semibold text-slate-900">Your requests</h2>
        {requests.length === 0 ? (
          <EmptyState
            compact
            icon="list"
            title="No requests yet"
            description="Going home for the weekend or expecting family? Tap a tile above and your PG will be told straight away."
          />
        ) : (
          <ul className="space-y-2">
            {requests.map((request) => (
              <RequestItem key={request.id} request={request} />
            ))}
          </ul>
        )}
      </section>

      <RequestFormDialog kind={kind} onClose={() => setKind(null)} canPauseMeals={canPauseMeals} />
    </div>
  )
}

function RequestItem({ request }: { request: TenantRequest }) {
  const router = useRouter()
  const toast = useToast()
  const [busy, setBusy] = React.useState(false)
  const [open, setOpen] = React.useState(false)
  const meta = KIND_META[request.kind]
  const status = STATUS_META[request.status]
  const Icon = meta.icon
  const details = cleanDetails(request.details)

  async function cancel() {
    setBusy(true)
    try {
      await api.patch(`/api/requests/${request.id}`, { action: 'CANCEL' })
      toast.success('Request cancelled')
      router.refresh()
    } catch (error) {
      toast.fromError(error, 'cancel this request')
      setBusy(false)
    }
  }

  return (
    <li>
      <Card>
        <CardContent className="p-0">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="flex w-full items-center gap-3 p-4 text-left"
            aria-expanded={open}
          >
            <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-xl', meta.tint)}>
              <Icon className={cn('size-4', meta.iconTint)} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-slate-900">{request.title}</span>
              <span className="block truncate text-xs text-slate-500">
                {meta.label} · {relativeTime(request.createdAt)}
              </span>
            </span>
            <StatusChip label={status.label} chip={status.chip} dot={status.dot} />
            <ChevronRight className={cn('size-4 shrink-0 text-slate-300 transition-transform', open && 'rotate-90')} />
          </button>

          {open && (
            <div className="space-y-3 border-t border-slate-100 px-4 pb-4 pt-3 text-sm">
              <Timeline request={request} />
              {request.kind === 'VISITOR' && request.fromDate && (
                <p className="text-slate-600">{formatDateTime(request.fromDate)}</p>
              )}
              {request.kind === 'ROOM_CHANGE' && request.fromDate && (
                <p className="text-slate-600">From {formatDate(request.fromDate)}</p>
              )}
              {details && <p className="whitespace-pre-line text-slate-600">{details}</p>}
              {hasMealsPaused(request.kind, request.details) && (
                <p className="flex items-center gap-1.5 text-xs text-slate-500">
                  <UtensilsCrossed className="size-3.5" />
                  Meals paused while you are away
                </p>
              )}
              {request.decisionNote && (
                <p className="rounded-xl bg-slate-50 px-3 py-2 text-slate-700">
                  <span className="font-medium">{request.decidedBy ?? 'Your PG'}:</span> {request.decisionNote}
                </p>
              )}
              {request.status === 'PENDING' && (
                <Button variant="outline" size="sm" loading={busy} onClick={cancel}>
                  Cancel request
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </li>
  )
}

/** Sent → Approved / Declined → Done, as small chips. */
function Timeline({ request }: { request: TenantRequest }) {
  const steps: { label: string; at?: string | null; state: 'done' | 'current' | 'todo' | 'bad' }[] = [
    { label: 'Sent', at: request.createdAt, state: 'done' },
  ]
  if (request.status === 'PENDING') steps.push({ label: 'Waiting for reply', state: 'current' })
  if (request.status === 'CANCELLED') steps.push({ label: 'Cancelled', at: request.decidedAt, state: 'bad' })
  if (request.status === 'REJECTED') steps.push({ label: 'Declined', at: request.decidedAt, state: 'bad' })
  if (request.status === 'APPROVED' || request.status === 'DONE') {
    steps.push({ label: 'Approved', at: request.decidedAt, state: 'done' })
    steps.push({ label: 'Done', state: request.status === 'DONE' ? 'done' : 'todo' })
  }
  return (
    <ol className="flex flex-wrap items-center gap-1.5">
      {steps.map((step, i) => (
        <li key={step.label} className="flex items-center gap-1.5">
          {i > 0 && <span className="h-px w-3 bg-slate-200" />}
          <span
            className={cn(
              'rounded-full border px-2 py-0.5 text-[11px] font-medium',
              step.state === 'done' && 'border-emerald-200 bg-emerald-50 text-emerald-700',
              step.state === 'current' && 'border-amber-200 bg-amber-50 text-amber-700',
              step.state === 'todo' && 'border-dashed border-slate-200 text-slate-400',
              step.state === 'bad' && 'border-rose-200 bg-rose-50 text-rose-700',
            )}
            title={step.at ? formatDateTime(step.at) : undefined}
          >
            {step.label}
            {step.at ? ` · ${formatDate(step.at)}` : ''}
          </span>
        </li>
      ))}
    </ol>
  )
}
