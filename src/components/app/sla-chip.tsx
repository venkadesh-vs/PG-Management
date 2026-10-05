'use client'

import * as React from 'react'
import { AlarmClock, CheckCircle2, Timer } from 'lucide-react'
import { slaState, type SlaTone } from '@/lib/sla'
import { cn } from '@/lib/utils'

/** PRD §11 tones: critical red, high orange, medium amber, resolved green. */
const TONE: Record<SlaTone, string> = {
  critical: 'border-red-200 bg-red-50 text-red-700',
  high: 'border-orange-200 bg-orange-50 text-orange-700',
  medium: 'border-amber-200 bg-amber-50 text-amber-700',
  calm: 'border-slate-200 bg-slate-50 text-slate-600',
  resolved: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  none: 'border-slate-200 bg-white text-slate-400',
}

/** Live SLA countdown chip ("Due in 3h 20m" / "Overdue by 1h"). Ticks every 30s. */
export function SlaChip({
  status,
  slaDueAt,
  createdAt,
  resolvedAt,
  size = 'default',
  className,
}: {
  status: string
  slaDueAt: Date | string | null | undefined
  createdAt?: Date | string | null
  resolvedAt?: Date | string | null
  size?: 'default' | 'lg'
  className?: string
}) {
  const [now, setNow] = React.useState<number | null>(null)
  React.useEffect(() => {
    setNow(Date.now())
    const t = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(t)
  }, [])

  // Before hydration, render from the server's clock-free view to avoid mismatch.
  const state = slaState({ status, slaDueAt, createdAt, resolvedAt, now: now ?? undefined })
  if (state.tone === 'none') return null
  const Icon = state.tone === 'resolved' ? CheckCircle2 : state.overdue ? AlarmClock : Timer

  return (
    <span
      suppressHydrationWarning
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full border font-medium tabular-nums',
        size === 'lg' ? 'px-3 py-1 text-sm' : 'px-2 py-0.5 text-[11px]',
        TONE[state.tone],
        state.overdue && 'animate-[pulse_2.5s_ease-in-out_infinite]',
        className,
      )}
      title={slaDueAt ? `SLA due ${new Date(slaDueAt).toLocaleString()}` : undefined}
    >
      <Icon className={size === 'lg' ? 'size-4' : 'size-3'} />
      {state.label}
    </span>
  )
}
