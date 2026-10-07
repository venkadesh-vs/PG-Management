'use client'

import Link from 'next/link'
import { motion } from 'framer-motion'
import { ArrowDownRight, ArrowUpRight, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { AnimatedNumber } from '@/components/ui/feedback'
import { resolveIcon, type IconLike } from '@/lib/icons'

/**
 * Kept for compatibility. Colour now only carries meaning: emerald = healthy,
 * amber = needs attention, red = critical. Brand-ish tones (blue, pink,
 * violet) are shown as the neutral brand accent instead of a rainbow.
 */
export type StatTone = 'default' | 'blue' | 'pink' | 'emerald' | 'amber' | 'red' | 'violet'

const TONE: Record<StatTone, { dot: string | null }> = {
  default: { dot: null },
  blue: { dot: null },
  pink: { dot: null },
  violet: { dot: null },
  emerald: { dot: 'bg-emerald-500' },
  amber: { dot: 'bg-amber-500' },
  red: { dot: 'bg-rose-500' },
}

/**
 * The atomic metric tile. Numbers are near-black so a row of tiles reads
 * calmly; meaning is a small status dot beside the label. Two tiles fit side
 * by side on a phone — wrap a set in <StatGrid>.
 */
export function StatCard({
  label,
  value,
  format = 'number',
  icon,
  tone = 'default',
  hint,
  delta,
  href,
  suffix,
  className,
}: {
  label: string
  value: number
  format?: 'number' | 'money' | 'compact' | 'percent' | 'moneyCompact'
  icon?: IconLike
  tone?: StatTone
  hint?: string
  delta?: { value: number; label?: string }
  href?: string
  suffix?: React.ReactNode
  className?: string
}) {
  const tokens = TONE[tone] ?? TONE.default
  const Icon = resolveIcon(icon)
  const body = (
    <motion.div
      whileHover={href ? { y: -1 } : undefined}
      transition={{ duration: 0.15 }}
      className={cn(
        'group relative flex h-full min-w-0 flex-col rounded-xl border border-slate-200 bg-white p-3.5 transition-colors sm:p-5',
        href && 'cursor-pointer hover:border-slate-300 hover:shadow-xs',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-slate-500 sm:text-[13px]">
          {tokens.dot && <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', tokens.dot)} />}
          <span className="line-clamp-2">{label}</span>
        </p>
        {Icon && (
          <span className="hidden size-8 shrink-0 items-center justify-center rounded-lg bg-slate-50 text-slate-500 ring-1 ring-inset ring-slate-200/70 sm:flex">
            <Icon className="size-4" strokeWidth={1.75} />
          </span>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-baseline gap-x-2 sm:mt-3">
        <AnimatedNumber
          value={value}
          format={format}
          className="font-display text-lg font-semibold tracking-tight text-slate-900 tabular-nums sm:text-2xl"
        />
        {suffix}
      </div>

      {(delta || hint || href) && (
        <div className="mt-1 flex min-w-0 items-center gap-2 sm:mt-1.5">
          {delta && (
            <span
              className={cn(
                'inline-flex shrink-0 items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[11px] font-semibold tabular-nums',
                delta.value >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700',
              )}
            >
              {delta.value >= 0 ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
              {Math.abs(delta.value)}%
            </span>
          )}
          {hint && <p className="min-w-0 truncate text-xs text-slate-500">{hint}</p>}
          {href && (
            <ChevronRight className="ml-auto size-3.5 shrink-0 text-slate-300 transition-colors group-hover:text-slate-500" />
          )}
        </div>
      )}
    </motion.div>
  )

  return href ? (
    <Link
      href={href}
      className="block h-full min-w-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40"
    >
      {body}
    </Link>
  ) : (
    body
  )
}

/**
 * Standard layout for a row of StatCards: two per row on phones, `cols` on
 * desktop (default 4).
 */
export function StatGrid({
  children,
  cols = 4,
  className,
}: {
  children: React.ReactNode
  cols?: 2 | 3 | 4 | 5
  className?: string
}) {
  const lg = { 2: 'lg:grid-cols-2', 3: 'lg:grid-cols-3', 4: 'lg:grid-cols-4', 5: 'lg:grid-cols-5' }[cols]
  return <div className={cn('grid grid-cols-2 gap-3 sm:gap-4', lg, className)}>{children}</div>
}
