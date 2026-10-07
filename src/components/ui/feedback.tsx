'use client'

import * as React from 'react'
import { motion, useInView, useMotionValue, useSpring } from 'framer-motion'
import { cn, compactNumber, formatMoney, formatNumber } from '@/lib/utils'
import { resolveIcon, type IconLike } from '@/lib/icons'

// ---------------------------------------------------- Animated counters -----

/**
 * Counts up to `value` when it scrolls into view. Numbers that animate make a
 * dashboard feel alive; they never change the underlying value.
 */
export function AnimatedNumber({
  value,
  format = 'number',
  className,
  duration = 1,
}: {
  value: number
  format?: 'number' | 'money' | 'compact' | 'percent' | 'moneyCompact'
  className?: string
  duration?: number
}) {
  const ref = React.useRef<HTMLSpanElement>(null)
  const inView = useInView(ref, { once: true, margin: '-40px' })
  const motionValue = useMotionValue(0)
  const spring = useSpring(motionValue, { duration: duration * 1000, bounce: 0 })
  const [display, setDisplay] = React.useState(0)

  React.useEffect(() => {
    if (inView) motionValue.set(value)
  }, [inView, value, motionValue])

  React.useEffect(() => spring.on('change', (v) => setDisplay(v)), [spring])

  const shown = Math.round(display)
  const text =
    format === 'money'
      ? formatMoney(shown)
      : format === 'moneyCompact'
        ? formatMoney(shown, { compact: true })
        : format === 'compact'
          ? compactNumber(shown)
          : format === 'percent'
            ? `${shown}%`
            : formatNumber(shown)

  return (
    <span ref={ref} className={cn('tabular', className)}>
      {text}
    </span>
  )
}

// ------------------------------------------------------------ Skeletons -----

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton', className)} />
}

export function CardSkeleton() {
  return (
    <div className="surface space-y-3 p-5">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-8 w-32" />
      <Skeleton className="h-3 w-40" />
    </div>
  )
}

export function StatGridSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <CardSkeleton key={i} />
      ))}
    </div>
  )
}

export function TableSkeleton({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="surface divide-y divide-slate-100 overflow-hidden">
      <div className="flex gap-4 bg-slate-50/60 p-4">
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} className="h-3 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center gap-4 p-4">
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} className={cn('h-4 flex-1', c === 0 && 'max-w-[180px]')} />
          ))}
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------- Empty state -----

/**
 * Empty states carry an illustration and a next action — never a bare
 * "No data" line.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  compact,
}: {
  icon?: IconLike
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
  compact?: boolean
}) {
  const Icon = resolveIcon(icon)
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className={cn(
        'flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-white text-center',
        compact ? 'gap-2 p-6' : 'gap-3 p-10',
        className,
      )}
    >
      {Icon && (
        <div className="relative">
          
          <div className="relative flex size-11 items-center justify-center rounded-xl bg-slate-50 ring-1 ring-inset ring-slate-200">
            <Icon className="size-5 text-slate-400" />
          </div>
        </div>
      )}
      <div className="space-y-1">
        <p className="font-display text-sm font-semibold text-slate-800">{title}</p>
        {description && (
          <p className="mx-auto max-w-sm text-sm leading-relaxed text-slate-500">{description}</p>
        )}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </motion.div>
  )
}

// ---------------------------------------------------------- Error state -----

// ----------------------------------------------------- Motion container -----

/** Staggered entrance for dashboard grids. Subtle — 8px and 0.35s. */
export const listVariants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.05 } },
}

export const itemVariants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.16, 1, 0.3, 1] as const } },
}

export function MotionGrid({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <motion.div variants={listVariants} initial="hidden" animate="show" className={className}>
      {children}
    </motion.div>
  )
}

export function MotionItem({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <motion.div variants={itemVariants} className={className}>
      {children}
    </motion.div>
  )
}
