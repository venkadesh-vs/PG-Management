import Link from 'next/link'
import { CreditCard, Lock } from 'lucide-react'
import { Button } from '@/components/ui/button'

/** Pages a suspended organization can still open. */
const OPEN_PATHS = ['/app/subscription', '/app/notifications']

/**
 * Shown in place of every dashboard page while the organization is
 * suspended. Data stays intact; the API refuses changes until payment.
 */
export function RestrictedGate({ pathname, children }: { pathname: string; children: React.ReactNode }) {
  if (OPEN_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return (
      <>
        <RestrictedBanner />
        {children}
      </>
    )
  }
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-5 py-16 text-center">
      <div className="flex size-14 items-center justify-center rounded-2xl bg-amber-50 text-amber-600">
        <Lock className="size-6" />
      </div>
      <div className="space-y-2">
        <h1 className="font-display text-xl font-semibold text-slate-900">Your account is suspended</h1>
        <p className="text-sm leading-relaxed text-slate-500">
          A subscription payment is overdue. Your residents, rent records and history are safe — pay
          the pending invoice and everything unlocks immediately.
        </p>
      </div>
      <Button variant="primary" asChild>
        <Link href="/app/subscription">
          <CreditCard className="size-4" />
          View and pay invoice
        </Link>
      </Button>
    </div>
  )
}

function RestrictedBanner() {
  return (
    <div className="mb-6 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
      <Lock className="mt-0.5 size-4 shrink-0" />
      <p>Your account is suspended until the pending subscription invoice is paid. Other pages are locked.</p>
    </div>
  )
}
