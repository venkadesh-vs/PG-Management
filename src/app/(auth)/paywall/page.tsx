import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { CreditCard, Landmark, LifeBuoy, Lock, ShieldCheck } from 'lucide-react'
import { getSessionUser, HOME_FOR_ROLE, isOrgRestricted } from '@/lib/auth'
import { LogoMark } from '@/components/marketing/logo'
import { demoPaymentsAllowed, paymentMode } from '@/server/integrations/payments'
import { paywallState } from '@/server/services/owner-billing'
import { formatDate, formatMoney } from '@/lib/utils'
import { PayInvoiceButton } from '@/app/(owner)/app/subscription/pay-invoice-button'
import { SignOutButton } from '../service-paused/sign-out-button'
import { CopyRow, PaidClaimForm, UpiAppButton } from './paywall-actions'

export const metadata: Metadata = {
  title: 'Subscription expired',
  robots: { index: false, follow: false },
}

/**
 * Full-screen paywall for owners and managers once the grace period has run
 * out. Every other owner page redirects here (requireOrgUser); only this page
 * and /app/subscription stay open so the account can be paid.
 */
export default async function PaywallPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  if (user.role === 'SUPER_ADMIN') redirect('/admin')
  if (user.role !== 'OWNER' && user.role !== 'MANAGER') {
    redirect(isOrgRestricted(user) ? '/service-paused' : HOME_FOR_ROLE[user.role])
  }
  if (!user.organizationId || !isOrgRestricted(user)) redirect('/app')

  const state = await paywallState(user.organizationId)
  const canPay = user.role === 'OWNER' || user.permissions.includes('billing.manage')
  const demo = paymentMode() === 'demo'
  const gateway = !demo || demoPaymentsAllowed()
  const pending = state.claims.find((c) => c.status === 'PENDING')
  const rejected = state.claims.find((c) => c.status === 'REJECTED')
  const d = state.details
  const hasBank = Boolean(d.accountNumber && d.ifsc)

  return (
    <div className="min-h-dvh bg-slate-50 px-4 py-8 sm:py-12">
      <div className="mx-auto w-full max-w-2xl space-y-5">
        <div className="flex items-center justify-between">
          <LogoMark className="size-9" />
          <SignOutButton />
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs sm:p-8">
          <div className="flex items-start gap-4">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-rose-50 text-rose-600">
              <Lock className="size-5" />
            </span>
            <div className="min-w-0">
              <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-900">Subscription expired</h1>
              <p className="mt-1 text-sm text-slate-600">
                {state.organizationName}&apos;s StayFlow account is paused because the subscription is unpaid. Pay the amount
                below and everything comes back instantly.
              </p>
            </div>
          </div>

          <div className="mt-6 rounded-xl border border-slate-200">
            {state.invoices.map((inv) => (
              <div key={inv.id} className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3 last:border-b-0">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-900">{inv.propertyName}</p>
                  <p className="text-xs text-slate-500">
                    {inv.number} · {formatDate(inv.periodStart)} – {formatDate(inv.periodEnd)}
                    {inv.tax > 0 ? ` · incl. GST ${formatMoney(inv.tax)}` : ''}
                    {inv.paid > 0 ? ` · paid ${formatMoney(inv.paid)}` : ''}
                  </p>
                </div>
                <span className="shrink-0 font-semibold tabular-nums text-slate-900">{formatMoney(inv.balance)}</span>
              </div>
            ))}
            <div className="flex items-center justify-between rounded-b-xl bg-slate-50 px-4 py-3">
              <span className="text-sm font-medium text-slate-700">Total due</span>
              <span className="font-display text-xl font-semibold tabular-nums text-slate-900">{formatMoney(state.totalDue)}</span>
            </div>
          </div>

          {pending && (
            <p className="mt-4 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">
              We received your payment details (UTR {pending.utr}) and are verifying them. Your account is restored as soon
              as it is confirmed.
            </p>
          )}
          {!pending && rejected && (
            <p className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900">
              We could not verify UTR {rejected.utr}.{rejected.rejectReason ? ` ${rejected.rejectReason}` : ''} Please check
              and send the details again.
            </p>
          )}

          {canPay && gateway && state.invoices.length > 0 && (
            <div className="mt-6 space-y-2">
              <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <CreditCard className="size-4 text-slate-500" /> Pay online now
              </p>
              <div className="flex flex-wrap gap-2">
                {state.invoices.map((inv) => (
                  <PayInvoiceButton key={inv.id} invoiceId={inv.id} number={inv.number} amount={inv.balance} demo={demo} size="default" />
                ))}
              </div>
              <p className="text-xs text-slate-500">UPI, cards or netbanking through Razorpay. Access returns the moment it succeeds.</p>
            </div>
          )}
          {!canPay && (
            <p className="mt-6 text-sm text-slate-600">Please ask the PG owner to pay — you&apos;ll have access again as soon as they do.</p>
          )}
        </div>

        {canPay && (d.upiId || hasBank) && (
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs sm:p-8">
            <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <Landmark className="size-4 text-slate-500" /> Pay by UPI or bank transfer
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Send exactly {formatMoney(state.totalDue)}, then tell us the UTR so we can switch your account back on.
            </p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {d.upiId && (
                <div className="space-y-2 rounded-xl border border-slate-200 p-4">
                  <p className="text-xs font-semibold text-slate-700">UPI</p>
                  <CopyRow label="UPI ID" value={d.upiId} />
                  <CopyRow label="Name" value={d.payeeName} />
                  <CopyRow label="Amount" value={String(state.totalDue)} />
                  {state.upiLink && <UpiAppButton href={state.upiLink} />}
                </div>
              )}
              {hasBank && (
                <div className="space-y-1 rounded-xl border border-slate-200 p-4">
                  <p className="text-xs font-semibold text-slate-700">Bank transfer</p>
                  <CopyRow label="Account name" value={d.accountName || d.payeeName} />
                  <CopyRow label="Account number" value={d.accountNumber} />
                  <CopyRow label="IFSC" value={d.ifsc} />
                  <CopyRow label="Bank" value={d.bankName} />
                </div>
              )}
            </div>
            <div className="mt-4">
              <PaidClaimForm
                canPay={canPay}
                invoices={state.invoices.map((i) => ({ id: i.id, number: i.number, balance: i.balance }))}
              />
            </div>
          </div>
        )}

        <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-5 text-sm sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-start gap-2 text-slate-600">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" />
            Your data is safe. Residents and staff are paused until payment.
          </p>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Link href="/app/subscription" className="rounded-lg border border-slate-200 px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50">
              Invoices
            </Link>
            {(d.supportEmail || d.supportWhatsapp) && (
              <a
                href={d.supportWhatsapp ? `https://wa.me/${d.supportWhatsapp.replace(/\D/g, '')}` : `mailto:${d.supportEmail}`}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50"
              >
                <LifeBuoy className="size-4" /> Contact support
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
