'use client'

import { motion, useReducedMotion } from 'framer-motion'
import { AlertTriangle, CheckCircle2, Clock } from 'lucide-react'
import { AnimatedNumber } from '@/components/ui/feedback'
import { cn, formatMoney } from '@/lib/utils'

/**
 * The month's money at a glance: what landed, what is still coming and what
 * is late. A dark ledger panel so the most important number on the page reads
 * first and feels like a statement, not another tile.
 */
export function CollectionHero({
  collected,
  billed,
  pending,
  pendingCount,
  overdue,
  overdueCount,
}: {
  collected: number
  billed: number
  pending: number
  pendingCount: number
  overdue: number
  overdueCount: number
}) {
  const reduce = useReducedMotion()
  const rate = billed ? Math.round((collected / billed) * 100) : 0
  const width = Math.min(100, Math.max(0, rate))

  return (
    <section
      aria-label="Collection summary"
      className="relative isolate overflow-hidden rounded-2xl bg-ink-950 p-5 text-white shadow-lift sm:p-6"
    >
      <div aria-hidden className="pointer-events-none absolute -right-20 -top-24 -z-10 size-72 rounded-full bg-blue-600/25 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute -bottom-28 left-1/3 -z-10 size-72 rounded-full bg-marigold-400/10 blur-3xl" />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:items-center lg:gap-10">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-white/55">Collected this month</p>
          <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <AnimatedNumber
              value={collected}
              format="money"
              className="font-display text-[34px] font-semibold leading-none tracking-tight tabular-nums sm:text-[42px]"
            />
            <span className="text-sm text-white/55 tabular-nums">of {formatMoney(billed)} billed</span>
          </div>

          <div className="mt-5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-white/60">Collection rate</span>
              <span className="font-semibold text-marigold-300 tabular-nums">{rate}%</span>
            </div>
            <div
              className="mt-2 h-2 overflow-hidden rounded-full bg-white/10"
              role="meter"
              aria-label="Collection rate"
              aria-valuenow={rate}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <motion.div
                className="h-full rounded-full bg-gradient-to-r from-marigold-400 to-marigold-300"
                initial={reduce ? false : { width: 0 }}
                animate={{ width: `${width}%` }}
                transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1], delay: 0.15 }}
                style={reduce ? { width: `${width}%` } : undefined}
              />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Figure
            icon={<Clock className="size-3.5" />}
            label="Pending"
            value={pending}
            hint={`${pendingCount} invoice${pendingCount === 1 ? '' : 's'} not yet due`}
            tone="amber"
          />
          <Figure
            icon={<AlertTriangle className="size-3.5" />}
            label="Overdue"
            value={overdue}
            hint={`${overdueCount} invoice${overdueCount === 1 ? '' : 's'} past due`}
            tone={overdue > 0 ? 'rose' : 'emerald'}
          />
        </div>
      </div>
    </section>
  )
}

function Figure({
  icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: React.ReactNode
  label: string
  value: number
  hint: string
  tone: 'amber' | 'rose' | 'emerald'
}) {
  return (
    <div className="min-w-0 rounded-xl bg-white/[0.06] p-3.5 ring-1 ring-inset ring-white/10 sm:p-4">
      <p className="flex items-center gap-1.5 text-xs font-medium text-white/70">
        <span
          className={cn(
            'flex size-5 items-center justify-center rounded-md',
            tone === 'amber' && 'bg-amber-400/15 text-amber-300',
            tone === 'rose' && 'bg-rose-400/15 text-rose-300',
            tone === 'emerald' && 'bg-emerald-400/15 text-emerald-300',
          )}
        >
          {tone === 'emerald' ? <CheckCircle2 className="size-3.5" /> : icon}
        </span>
        {label}
      </p>
      <AnimatedNumber
        value={value}
        format="money"
        className="mt-2 block font-display text-xl font-semibold tracking-tight tabular-nums sm:text-2xl"
      />
      <p className="mt-0.5 truncate text-[11px] text-white/50 sm:text-xs">{hint}</p>
    </div>
  )
}
