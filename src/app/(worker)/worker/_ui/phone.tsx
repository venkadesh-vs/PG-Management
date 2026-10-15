import Link from 'next/link'
import { ChevronRight, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Page title for the staff phone app: an icon tile, the title and a short
 * line of context. Every staff screen opens with it so headings never drift.
 */
export function PhoneHeader({
  icon: Icon,
  title,
  subtitle,
  action,
}: {
  icon: LucideIcon
  title: string
  subtitle?: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <div className="flex items-start gap-3">
      <IconTile icon={Icon} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <h1 className="font-display text-[22px] font-semibold leading-tight tracking-tight text-slate-900">
          {title}
        </h1>
        {subtitle && (
          <p className="mt-1 text-sm leading-relaxed text-slate-500 text-pretty">{subtitle}</p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}

const TILE_TONES = {
  blue: 'bg-gradient-to-br from-blue-50 to-blue-100/60 text-blue-700 ring-blue-100',
  emerald: 'bg-gradient-to-br from-emerald-50 to-emerald-100/60 text-emerald-700 ring-emerald-100',
  amber: 'bg-gradient-to-br from-amber-50 to-amber-100/60 text-amber-700 ring-amber-100',
  rose: 'bg-gradient-to-br from-rose-50 to-rose-100/60 text-rose-700 ring-rose-100',
  marigold: 'bg-gradient-to-br from-marigold-50 to-marigold-100/70 text-marigold-700 ring-marigold-100',
} as const

export type TileTone = keyof typeof TILE_TONES

export function IconTile({
  icon: Icon,
  tone = 'blue',
  size = 'md',
  className,
}: {
  icon: LucideIcon
  tone?: TileTone
  size?: 'sm' | 'md'
  className?: string
}) {
  return (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center rounded-xl ring-1 ring-inset',
        size === 'sm' ? 'size-9' : 'size-11',
        TILE_TONES[tone],
        className,
      )}
    >
      <Icon className={size === 'sm' ? 'size-4' : 'size-5'} />
    </span>
  )
}

/** A thumb-sized card that opens another staff screen. */
export function ActionCard({
  href,
  icon,
  title,
  description,
  tone = 'blue',
}: {
  href: string
  icon: LucideIcon
  title: string
  description: string
  tone?: TileTone
}) {
  return (
    <Link
      href={href}
      className="group flex min-h-[72px] items-center gap-3 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-card transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-lift active:translate-y-0"
    >
      <IconTile icon={icon} tone={tone} />
      <span className="min-w-0 flex-1">
        <span className="block font-display text-[15px] font-semibold text-slate-900">{title}</span>
        <span className="mt-0.5 block text-xs leading-relaxed text-slate-500">{description}</span>
      </span>
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-slate-50 text-slate-400 transition group-hover:bg-blue-50 group-hover:text-blue-600">
        <ChevronRight className="size-4" />
      </span>
    </Link>
  )
}

/** Section title inside a staff screen, with an optional "See all" link. */
export function PhoneSection({
  icon: Icon,
  title,
  href,
  linkLabel = 'See all',
}: {
  icon?: LucideIcon
  title: string
  href?: string
  linkLabel?: string
}) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="flex items-center gap-2 font-display text-[15px] font-semibold tracking-tight text-slate-900">
        {Icon && <Icon className="size-4 text-slate-400" />}
        {title}
      </h2>
      {href && (
        <Link
          href={href}
          className="-mr-2 inline-flex min-h-[44px] items-center gap-0.5 rounded-lg px-2 text-xs font-semibold text-blue-600 transition-colors hover:text-blue-700"
        >
          {linkLabel}
          <ChevronRight className="size-3.5" />
        </Link>
      )}
    </div>
  )
}

/** Small muted footnote at the bottom of a staff screen. */
export function PhoneFootnote({ children }: { children: React.ReactNode }) {
  return (
    <p className="mx-auto max-w-sm px-2 text-center text-xs leading-relaxed text-slate-400 text-pretty">
      {children}
    </p>
  )
}
