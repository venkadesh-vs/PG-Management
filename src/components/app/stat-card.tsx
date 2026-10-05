'use client'

import Link from 'next/link'
import { motion } from 'framer-motion'
import { ArrowDownRight, ArrowUpRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { AnimatedNumber } from '@/components/ui/feedback'
import { resolveIcon, type IconLike } from '@/lib/icons'

export type StatTone = 'default' | 'blue' | 'pink' | 'emerald' | 'amber' | 'red' | 'violet'

const TONE: Record<StatTone, { icon: string; accent: string; ring: string }> = {
  default: { icon: 'bg-slate-100 text-slate-600', accent: 'text-slate-900', ring: 'ring-slate-100' },
  blue: { icon: 'bg-blue-50 text-blue-600', accent: 'text-blue-700', ring: 'ring-blue-100' },
  pink: { icon: 'bg-pink-50 text-pink-600', accent: 'text-pink-700', ring: 'ring-pink-100' },
  emerald: {
    icon: 'bg-emerald-50 text-emerald-600',
    accent: 'text-emerald-700',
    ring: 'ring-emerald-100',
  },
  amber: { icon: 'bg-amber-50 text-amber-600', accent: 'text-amber-700', ring: 'ring-amber-100' },
  red: { icon: 'bg-red-50 text-red-600', accent: 'text-red-700', ring: 'ring-red-100' },
  violet: { icon: 'bg-violet-50 text-violet-600', accent: 'text-violet-700', ring: 'ring-violet-100' },
}

/**
 * The dashboard's atomic metric tile. Values animate in; every number comes
 * from the database via props.
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
  const tokens = TONE[tone]
  const Icon = resolveIcon(icon)
  const body = (
    <motion.div
      whileHover={href ? { y: -2 } : undefined}
      transition={{ type: 'spring', stiffness: 400, damping: 28 }}
      className={cn(
        'group relative h-full overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-4 shadow-card transition-shadow sm:p-5',
        href && 'cursor-pointer hover:shadow-elevated',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2 sm:gap-3">
        <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500 sm:text-xs">{label}</p>
        {Icon && (
          <div className={cn('flex size-7 shrink-0 items-center justify-center rounded-xl sm:size-8', tokens.icon)}>
            <Icon className="size-4" />
          </div>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-baseline gap-x-2 sm:mt-3">
        <AnimatedNumber
          value={value}
          format={format}
          className={cn('font-display text-xl font-semibold tracking-tight sm:text-2xl', tokens.accent)}
        />
        {suffix}
      </div>

      <div className="mt-1.5 flex items-center gap-2">
        {delta && (
          <span
            className={cn(
              'inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-semibold',
              delta.value >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700',
            )}
          >
            {delta.value >= 0 ? (
              <ArrowUpRight className="size-3" />
            ) : (
              <ArrowDownRight className="size-3" />
            )}
            {Math.abs(delta.value)}%
          </span>
        )}
        {hint && <p className="truncate text-xs text-slate-500">{hint}</p>}
      </div>
    </motion.div>
  )

  return href ? (
    <Link href={href} className="block h-full">
      {body}
    </Link>
  ) : (
    body
  )
}

/** A compact metric row used inside cards and the tenant/worker apps. */
export function MiniStat({
  label,
  value,
  icon,
  tone = 'default',
}: {
  label: string
  value: string
  icon?: IconLike
  tone?: StatTone
}) {
  const tokens = TONE[tone]
  const Icon = resolveIcon(icon)
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-200/70 bg-white p-3">
      {Icon && (
        <div className={cn('flex size-8 shrink-0 items-center justify-center rounded-lg', tokens.icon)}>
          <Icon className="size-4" />
        </div>
      )}
      <div className="min-w-0">
        <p className="truncate text-[11px] font-medium uppercase tracking-wide text-slate-500">
          {label}
        </p>
        <p className="truncate font-display text-sm font-semibold text-slate-900 tabular">{value}</p>
      </div>
    </div>
  )
}
