import Link from 'next/link'
import { Logo } from '@/components/marketing/logo'

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
    <div className="flex min-h-dvh items-center justify-center bg-slate-50 px-4 py-10">
      <div className={wide ? 'w-full max-w-md space-y-6' : 'w-full max-w-sm space-y-6'}>
        <Logo />
        <div className="space-y-1.5">
          <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-900">
            {title}
          </h1>
          {subtitle && <p className="text-sm text-slate-500">{subtitle}</p>}
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-card">{children}</div>
        {footer && <div className="text-center text-sm text-slate-500">{footer}</div>}
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
