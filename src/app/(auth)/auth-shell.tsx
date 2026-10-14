import Link from 'next/link'
import { Logo } from '@/components/marketing/logo'
import { BrandPanel } from './brand-panel'

/**
 * The centred card used by every account page (sign-up, reset, invite…),
 * matching /change-password.
 */
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
  wide,
}: {
  title: string
  subtitle?: React.ReactNode
  children: React.ReactNode
  footer?: React.ReactNode
  wide?: boolean
}) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_1fr] xl:grid-cols-[1.05fr_1fr]">
      <BrandPanel />
      <div className="relative isolate flex items-start justify-center overflow-hidden bg-white px-4 py-10 sm:items-center sm:py-14">
        <div className="mesh-blue pointer-events-none absolute inset-x-0 top-0 -z-10 h-72 opacity-40 lg:hidden" aria-hidden />
        <div className={wide ? 'w-full max-w-md space-y-6' : 'w-full max-w-sm space-y-6'}>
          <div className="lg:hidden">
            <Logo />
          </div>
          <div className="space-y-1.5">
            <h1 className="font-display text-[1.75rem] font-semibold tracking-[-0.02em] text-slate-900 text-balance">
              {title}
            </h1>
            {subtitle && <p className="text-sm text-slate-500">{subtitle}</p>}
          </div>
          <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-float sm:p-6">{children}</div>
          {footer && <div className="text-center text-sm text-slate-500">{footer}</div>}
        </div>
      </div>
    </div>
  )
}

export function AuthLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="font-semibold text-blue-600 hover:text-blue-700">
      {children}
    </Link>
  )
}
