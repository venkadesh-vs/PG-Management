import { cn } from '@/lib/utils'

/**
 * Shared look for the resident phone app: one page-title frame and one icon
 * tile so every screen opens the same way.
 */
export function PhoneHeader({
  icon: Icon,
  eyebrow,
  title,
  subtitle,
  action,
  className,
}: {
  icon?: React.ElementType
  eyebrow?: string
  title: string
  subtitle?: React.ReactNode
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex items-start justify-between gap-3', className)}>
      <div className="flex min-w-0 items-start gap-3">
        {Icon && <IconTile icon={Icon} size="lg" />}
        <div className="min-w-0 pt-0.5">
          {eyebrow && (
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-blue-600">
              {eyebrow}
            </p>
          )}
          <h1 className="font-display text-[22px] font-semibold leading-tight tracking-tight text-slate-900">
            {title}
          </h1>
          {subtitle && (
            <p className="mt-1 text-sm leading-relaxed text-slate-500 text-pretty">{subtitle}</p>
          )}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}

const TONES = {
  blue: 'bg-gradient-to-br from-blue-50 to-blue-100/60 text-blue-700 ring-blue-100',
  emerald: 'bg-gradient-to-br from-emerald-50 to-emerald-100/60 text-emerald-700 ring-emerald-100',
  amber: 'bg-gradient-to-br from-amber-50 to-amber-100/60 text-amber-700 ring-amber-100',
  rose: 'bg-gradient-to-br from-rose-50 to-rose-100/60 text-rose-700 ring-rose-100',
  slate: 'bg-gradient-to-br from-slate-50 to-slate-100 text-slate-600 ring-slate-200/70',
  marigold: 'bg-gradient-to-br from-marigold-50 to-marigold-100/70 text-marigold-700 ring-marigold-100',
} as const

export type TileTone = keyof typeof TONES

export function IconTile({
  icon: Icon,
  tone = 'blue',
  size = 'md',
  className,
}: {
  icon: React.ElementType
  tone?: TileTone
  size?: 'sm' | 'md' | 'lg'
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center rounded-xl ring-1 ring-inset',
        size === 'sm' ? 'size-9' : size === 'md' ? 'size-10' : 'size-11',
        TONES[tone],
        className,
      )}
    >
      <Icon className={size === 'sm' ? 'size-4' : 'size-[18px]'} />
    </div>
  )
}

/** Small section title used between card groups. */
export function PhoneSection({
  icon: Icon,
  title,
  action,
  children,
  className,
}: {
  icon?: React.ElementType
  title: string
  action?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={cn('space-y-3', className)}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-display text-[15px] font-semibold tracking-tight text-slate-900">
          {Icon && <Icon className="size-4 text-blue-600" />}
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  )
}

/** Card classes for anything tappable. */
export const TAPPABLE =
  'transition duration-200 hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-lift active:translate-y-0 active:scale-[0.99]'
