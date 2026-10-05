'use client'

import { motion } from 'framer-motion'
import { AnimatedNumber } from '@/components/ui/feedback'
import { cn } from '@/lib/utils'

/**
 * Occupancy dial. Draws on an SVG arc so it sits cleanly on the coloured PG
 * header where a chart library would fight the background.
 */
export function OccupancyRing({
  value,
  occupied,
  total,
  size = 132,
  onDark = true,
  className,
}: {
  value: number
  occupied: number
  total: number
  size?: number
  onDark?: boolean
  className?: string
}) {
  const stroke = 10
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (Math.min(100, Math.max(0, value)) / 100) * circumference

  return (
    <div className={cn('relative shrink-0', className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={stroke}
          fill="none"
          className={onDark ? 'stroke-white/20' : 'stroke-slate-100'}
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          className={onDark ? 'stroke-white' : 'stroke-blue-600'}
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 1.1, ease: [0.16, 1, 0.3, 1] }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <AnimatedNumber
          value={value}
          format="percent"
          className={cn(
            'font-display text-2xl font-semibold tracking-tight',
            onDark ? 'text-white' : 'text-slate-900',
          )}
        />
        <p className={cn('text-[11px]', onDark ? 'text-white/60' : 'text-slate-500')}>
          {occupied}/{total} beds
        </p>
      </div>
    </div>
  )
}

/** A flat occupancy bar used inside property cards and tables. */
export function OccupancyBar({
  occupied,
  available,
  reserved,
  maintenance,
  blocked = 0,
  className,
}: {
  occupied: number
  available: number
  reserved: number
  maintenance: number
  blocked?: number
  className?: string
}) {
  const total = occupied + available + reserved + maintenance + blocked || 1
  const segments = [
    { value: occupied, className: 'bg-slate-700', label: 'Occupied' },
    { value: reserved, className: 'bg-amber-400', label: 'Reserved' },
    { value: maintenance, className: 'bg-orange-400', label: 'Maintenance' },
    { value: blocked, className: 'bg-slate-300', label: 'Blocked' },
    { value: available, className: 'bg-emerald-400', label: 'Available' },
  ].filter((s) => s.value > 0)

  return (
    <div className={cn('flex h-2 overflow-hidden rounded-full bg-slate-100', className)}>
      {segments.map((segment) => (
        <div
          key={segment.label}
          className={segment.className}
          style={{ width: `${(segment.value / total) * 100}%` }}
          title={`${segment.label}: ${segment.value}`}
        />
      ))}
    </div>
  )
}
