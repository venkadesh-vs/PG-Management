import Link from 'next/link'
import { cn } from '@/lib/utils'
import { publicEnv } from '@/lib/env'

/**
 * StayFlow mark — a stacked bed/building glyph that reads as PG
 * accommodation rather than a generic app icon.
 */
export function LogoMark({ className, variant = 'dark' }: { className?: string; variant?: 'dark' | 'light' }) {
  return (
    <span
      className={cn(
        'relative flex size-9 shrink-0 items-center justify-center rounded-xl shadow-sm',
        variant === 'light'
          ? 'bg-white/10 ring-1 ring-inset ring-white/20 backdrop-blur'
          : 'bg-gradient-to-br from-blue-600 to-blue-700 shadow-blue-600/25',
        className,
      )}
    >
      <svg viewBox="0 0 24 24" fill="none" className="size-5" aria-hidden="true">
        {/* Building outline */}
        <path
          d="M4 20V7.5a1 1 0 0 1 .55-.9l7-3.4a1 1 0 0 1 .9 0l7 3.4a1 1 0 0 1 .55.9V20"
          stroke="white"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Bed inside — the PG signal */}
        <path d="M8 16.5v-3.2h8v3.2" stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M7 16.5h10" stroke="white" strokeWidth="1.6" strokeLinecap="round" />
        <circle cx="10" cy="11.4" r="1.15" fill="white" />
        <path d="M3 20h18" stroke="white" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    </span>
  )
}

export function Logo({
  variant = 'dark',
  href = '/',
  className,
  showWordmark = true,
}: {
  variant?: 'dark' | 'light'
  href?: string | null
  className?: string
  showWordmark?: boolean
}) {
  const content = (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <LogoMark variant={variant} />
      {showWordmark && (
        <span
          className={cn(
            'font-display text-lg font-bold tracking-tight',
            variant === 'light' ? 'text-white' : 'text-slate-900',
          )}
        >
          {publicEnv.appName}
        </span>
      )}
    </span>
  )

  if (!href) return content
  return (
    <Link href={href} className="inline-flex rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30">
      {content}
    </Link>
  )
}
