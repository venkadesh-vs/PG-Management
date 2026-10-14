import { cn } from '@/lib/utils'

/**
 * The one loading spinner: a thin track with a gradient arc. Inherits the
 * text colour, so it works on any button or surface.
 */
export function Spinner({ className, label = 'Loading' }: { className?: string; label?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" role="status" aria-label={label} className={cn('size-4 animate-spin [animation-duration:0.8s]', className)}>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2.5" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  )
}

/**
 * Full-area brand loader: the StayFlow mark with an orbiting indigo-to-gold
 * ring. For waits longer than a skeleton can explain (payments, imports).
 */
export function BrandLoader({ label = 'Loading', className }: { label?: string; className?: string }) {
  return (
    <div role="status" aria-label={label} className={cn('flex flex-col items-center justify-center gap-4 py-16', className)}>
      <span className="relative flex size-16 items-center justify-center">
        <span className="absolute inset-0 animate-spin rounded-full bg-[conic-gradient(from_0deg,transparent_0deg,rgb(82_72_224)_120deg,rgb(252_191_77)_240deg,transparent_360deg)] [animation-duration:1.4s] [mask:radial-gradient(farthest-side,transparent_calc(100%-3px),black_calc(100%-2px))]" />
        <span className="flex size-11 items-center justify-center rounded-2xl bg-ink-950 text-white shadow-lg ring-1 ring-white/10">
          <svg viewBox="0 0 24 24" fill="none" className="size-5" aria-hidden>
            <path d="M4 11.5 12 5l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5h-5v5H5a1 1 0 0 1-1-1v-7.5Z" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" />
          </svg>
        </span>
      </span>
      <span className="text-sm font-medium text-slate-500">{label}…</span>
    </div>
  )
}
