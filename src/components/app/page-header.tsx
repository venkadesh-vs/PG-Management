import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { resolveIcon, type IconLike } from '@/lib/icons'

/**
 * The standard page frame: breadcrumb, title, subtitle and an action slot.
 * Every module page in the product uses it so headings never drift.
 */
export function PageHeader({
  title,
  subtitle,
  breadcrumbs,
  actions,
  icon,
  className,
}: {
  title: string
  subtitle?: string
  breadcrumbs?: { label: string; href?: string }[]
  actions?: React.ReactNode
  icon?: IconLike
  className?: string
}) {
  const Icon = resolveIcon(icon)
  return (
    <div className={cn('space-y-3', className)}>
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav aria-label="Breadcrumb">
          <ol className="flex flex-wrap items-center gap-1 text-xs text-slate-500">
            {breadcrumbs.map((crumb, i) => (
              <li key={`${crumb.label}-${i}`} className="flex items-center gap-1">
                {i > 0 && <ChevronRight className="size-3 text-slate-300" />}
                {crumb.href ? (
                  <Link href={crumb.href} className="transition-colors hover:text-slate-900">
                    {crumb.label}
                  </Link>
                ) : (
                  <span className="font-medium text-slate-700">{crumb.label}</span>
                )}
              </li>
            ))}
          </ol>
        </nav>
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          {Icon && (
            <div className="hidden size-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white shadow-sm sm:flex">
              <Icon className="size-5 text-slate-500" />
            </div>
          )}
          <div className="min-w-0">
            <h1 className="font-display text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">
              {title}
            </h1>
            {subtitle && (
              <p className="mt-1 text-sm leading-relaxed text-slate-500 text-pretty">{subtitle}</p>
            )}
          </div>
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  )
}

/** Section heading used inside a page. */
export function SectionHeader({
  title,
  description,
  actions,
  icon,
  className,
}: {
  title: string
  description?: string
  actions?: React.ReactNode
  icon?: IconLike
  className?: string
}) {
  const Icon = resolveIcon(icon)
  return (
    <div className={cn('flex flex-wrap items-end justify-between gap-3', className)}>
      <div className="min-w-0">
        <h2 className="flex items-center gap-2 font-display text-base font-semibold tracking-tight text-slate-900">
          {Icon && <Icon className="size-4 text-slate-400" />}
          {title}
        </h2>
        {description && <p className="mt-0.5 text-sm text-slate-500">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  )
}
