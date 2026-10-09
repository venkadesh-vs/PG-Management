'use client'

import * as React from 'react'
import Link from 'next/link'
import { AlertTriangle, X } from 'lucide-react'
import { cn, formatDate, formatMoney } from '@/lib/utils'

const KEY = 'stayflow:grace-banner-dismissed'

/**
 * Shown to owners and managers while a StayFlow payment is overdue but the
 * account is still fully active. Dismissing hides it for this browser
 * session only — it comes back next time until the invoice is paid.
 */
export function SubscriptionGraceBanner({
  amount,
  invoiceNumber,
  lastActiveDay,
  daysLeft,
  tone,
  canPay,
}: {
  amount: number
  invoiceNumber: string
  lastActiveDay: string
  daysLeft: number
  tone: 'amber' | 'rose'
  canPay: boolean
}) {
  const [hidden, setHidden] = React.useState(false)

  React.useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- read once from session storage after mount
      if (sessionStorage.getItem(KEY) === invoiceNumber) setHidden(true)
    } catch {
      /* storage blocked: keep showing */
    }
  }, [invoiceNumber])

  if (hidden) return null

  function dismiss() {
    setHidden(true)
    try {
      sessionStorage.setItem(KEY, invoiceNumber)
    } catch {
      /* storage blocked: hidden until reload */
    }
  }

  const left = daysLeft === 1 ? 'last day' : `${daysLeft} days left`
  return (
    <div
      role="status"
      className={cn(
        'mb-4 flex items-start gap-3 rounded-xl border px-4 py-3 text-sm',
        tone === 'rose' ? 'border-rose-200 bg-rose-50 text-rose-900' : 'border-amber-200 bg-amber-50 text-amber-900',
      )}
    >
      <AlertTriangle className={cn('mt-0.5 size-4 shrink-0', tone === 'rose' ? 'text-rose-600' : 'text-amber-600')} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-medium">
          StayFlow payment of {formatMoney(amount)} is pending.
        </p>
        <p className="mt-0.5 text-[13px] opacity-90">
          Your account stays fully active until {formatDate(lastActiveDay)} ({left}).
          {canPay ? ' Pay now to avoid a pause.' : ' Please ask the PG owner to pay.'}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {canPay && (
          <Link
            href="/app/subscription"
            className={cn(
              'rounded-lg px-3 py-1.5 text-xs font-semibold text-white',
              tone === 'rose' ? 'bg-rose-600 hover:bg-rose-700' : 'bg-amber-600 hover:bg-amber-700',
            )}
          >
            Pay now
          </Link>
        )}
        <button
          type="button"
          onClick={dismiss}
          aria-label="Hide until next visit"
          className="rounded-md p-1 opacity-70 hover:bg-black/5 hover:opacity-100"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  )
}
