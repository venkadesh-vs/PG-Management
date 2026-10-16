'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { Building, CreditCard, Hourglass, Repeat, ShieldCheck, Smartphone, X } from 'lucide-react'
import { api, ApiError } from '@/lib/client'
import { cn, formatDate, formatMoney } from '@/lib/utils'
import { useToast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { CheckoutDismissed, openRazorpayCheckout } from '@/components/payments/razorpay-checkout'

type Method = 'UPI' | 'EMANDATE' | 'CARD'

export type OwnerAutopayView = {
  mode: 'live' | 'demo' | 'off'
  nextBill: number
  methods: { key: Method; label: string; limit: number | null; ceiling: number }[]
  mandate: {
    status: 'PENDING' | 'ACTIVE' | 'PAUSED' | 'CANCELLED' | 'FAILED'
    methodLabel: string
    maxAmount: number
    isDemo: boolean
    lastError: string | null
    overLimit: boolean
  } | null
  upcoming: { amount: number; chargeDate: string; status: string } | null
  dueDay: number
}

const METHOD_ICON: Record<Method, typeof Smartphone> = { UPI: Smartphone, EMANDATE: Building, CARD: CreditCard }
const METHOD_HINT: Record<Method, string> = {
  UPI: 'Approve once in your UPI app',
  EMANDATE: 'Approve with net banking · confirms in 1–3 days',
  CARD: 'Debit or credit card',
}

/**
 * One AutoPay for the owner's whole monthly StayFlow bill. The owner approves
 * a limit once; every month the exact bill is debited on the due day, with a
 * notice the day before.
 */
export function OwnerAutopayCard({ view }: { view: OwnerAutopayView }) {
  const router = useRouter()
  const toast = useToast()
  const [open, setOpen] = React.useState(false)
  const firstUsable = view.methods.find((m) => m.limit)?.key ?? 'EMANDATE'
  const [method, setMethod] = React.useState<Method>(firstUsable)
  const [busy, setBusy] = React.useState<'setup' | 'cancel' | 'sync' | null>(null)

  const m = view.mandate
  const active = m?.status === 'ACTIVE'
  const pending = m?.status === 'PENDING'
  const failed = m?.status === 'FAILED'
  const chosen = view.methods.find((x) => x.key === method)

  async function setup() {
    setBusy('setup')
    try {
      const start = await api.post<
        | { mode: 'demo'; maxAmount: number }
        | {
            mode: 'live'
            keyId: string
            orderId: string
            customerId: string
            amountPaise: number
            description: string
            prefill: { name: string; email: string; contact: string }
            notes: Record<string, string>
          }
      >('/api/subscription', { action: 'OWNER_AUTOPAY_START', method })
      if (start.mode === 'demo') {
        toast.success('AutoPay is on (demo)', `Up to ${formatMoney(start.maxAmount)} a month. No money moves on this deployment.`)
      } else {
        const result = await openRazorpayCheckout({
          keyId: start.keyId,
          orderId: start.orderId,
          amountPaise: start.amountPaise,
          customerId: start.customerId,
          recurring: true,
          name: 'StayFlow',
          description: start.description,
          prefill: start.prefill,
          notes: start.notes,
        })
        const done = await api.post<{ status: string; message: string }>('/api/subscription', {
          action: 'OWNER_AUTOPAY_CONFIRM',
          ...result,
        })
        if (done.status === 'ACTIVE') toast.success('AutoPay is on', 'Your monthly bill will now be paid automatically.')
        else toast.info('Almost done', done.message)
      }
      setOpen(false)
      router.refresh()
    } catch (error) {
      if (error instanceof CheckoutDismissed) {
        toast.info('AutoPay not set up', 'You closed the window before approving. Try again any time.')
      } else {
        toast.error('Could not set up AutoPay', error instanceof ApiError || error instanceof Error ? error.message : 'Please try again.')
      }
      router.refresh()
    } finally {
      setBusy(null)
    }
  }

  async function cancel() {
    setBusy('cancel')
    try {
      await api.post('/api/subscription', { action: 'OWNER_AUTOPAY_CANCEL' })
      toast.info('AutoPay switched off', 'Pay each monthly bill with Pay now.')
      router.refresh()
    } catch (error) {
      toast.error('Something went wrong', error instanceof ApiError ? error.message : 'Please try again.')
    } finally {
      setBusy(null)
    }
  }

  async function sync() {
    setBusy('sync')
    try {
      await api.post('/api/subscription', { action: 'OWNER_AUTOPAY_SYNC' })
      router.refresh()
    } catch (error) {
      toast.error('Could not check the status', error instanceof ApiError ? error.message : 'Please try again.')
    } finally {
      setBusy(null)
    }
  }

  const title = active
    ? `AutoPay is on${m?.isDemo ? ' (demo)' : ''}`
    : pending
      ? 'Waiting for your bank to confirm AutoPay'
      : failed
        ? 'AutoPay was not approved'
        : 'Pay your bill automatically'
  const body = active
    ? m!.overLimit
      ? `Your bill (${formatMoney(view.nextBill)}) is now above your limit of ${formatMoney(m!.maxAmount)}, so it will not be debited. Switch AutoPay off and set it up again for a higher limit.`
      : view.upcoming
        ? `${m!.methodLabel} · next debit ${formatMoney(view.upcoming.amount)} on ${formatDate(view.upcoming.chargeDate)}.`
        : `${m!.methodLabel} · up to ${formatMoney(m!.maxAmount)} a month, debited on day ${view.dueDay}. You get a notice the day before.`
    : pending
      ? 'Bank-account approvals take 1–3 working days. Until then, pay any open bill with Pay now.'
      : failed
        ? `${m?.lastError ?? 'The approval did not go through'}. You can try again, or use another method.`
        : `One approval covers all your PGs. Each month we debit the exact bill on day ${view.dueDay}, with a notice the day before. Switch it off any time.`

  return (
    <>
      <Card className={cn('overflow-hidden', active && !m?.overLimit ? 'border-emerald-200' : '')}>
        <CardContent className="p-5">
          <motion.div layout className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <span
                className={cn(
                  'flex size-11 shrink-0 items-center justify-center rounded-2xl',
                  active && !m?.overLimit ? 'bg-emerald-100 text-emerald-700' : pending ? 'bg-amber-100 text-amber-700' : 'bg-blue-50 text-blue-700',
                )}
              >
                {active ? <ShieldCheck className="size-5" /> : pending ? <Hourglass className="size-5" /> : <Repeat className="size-5" />}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900">{title}</p>
                <p className="mt-0.5 text-sm leading-relaxed text-slate-500">{body}</p>
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">
              {view.mode === 'off' ? (
                <span className="text-xs text-slate-400">Available once online payment is live</span>
              ) : active ? (
                <Button variant="ghost" size="sm" loading={busy === 'cancel'} onClick={cancel}>
                  <X className="size-3.5" />
                  Switch off
                </Button>
              ) : pending ? (
                <>
                  <Button variant="outline" size="sm" loading={busy === 'sync'} onClick={sync}>
                    Check status
                  </Button>
                  <Button variant="ghost" size="sm" loading={busy === 'cancel'} onClick={cancel}>
                    Cancel
                  </Button>
                </>
              ) : (
                <Button variant="primary" onClick={() => setOpen(true)} disabled={view.nextBill <= 0}>
                  <Repeat className="size-4" />
                  {failed ? 'Try again' : 'Set up AutoPay'}
                </Button>
              )}
            </div>
          </motion.div>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Set up AutoPay</DialogTitle>
            <DialogDescription>
              Your next bill is {formatMoney(view.nextBill)}. Approve a limit once; each month only the exact bill is debited.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {view.methods.map((opt) => {
              const Icon = METHOD_ICON[opt.key]
              const usable = Boolean(opt.limit)
              return (
                <button
                  key={opt.key}
                  type="button"
                  disabled={!usable}
                  onClick={() => setMethod(opt.key)}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition',
                    method === opt.key && usable ? 'border-blue-500 bg-blue-50/70 ring-1 ring-blue-500' : 'border-slate-200 hover:border-slate-300',
                    !usable && 'cursor-not-allowed opacity-50',
                  )}
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-white text-slate-600 ring-1 ring-slate-200">
                    <Icon className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-slate-800">{opt.label}</span>
                    <span className="block text-xs text-slate-500">
                      {usable ? METHOD_HINT[opt.key] : `Up to ${formatMoney(opt.ceiling)} a debit — your bill is higher`}
                    </span>
                  </span>
                  {usable && <span className="shrink-0 text-xs font-medium tabular-nums text-slate-500">limit {formatMoney(opt.limit!)}</span>}
                </button>
              )
            })}
          </div>
          <p className="text-xs leading-relaxed text-slate-500">
            The limit is about twice today&apos;s bill so adding a PG still fits. You can switch AutoPay off here any time, or from your bank or UPI app.
            {view.mode === 'demo' && ' This deployment is in demo mode: no money moves.'}
          </p>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Not now
            </Button>
            <Button variant="primary" loading={busy === 'setup'} disabled={!chosen?.limit} onClick={setup}>
              Continue{chosen?.limit ? ` · up to ${formatMoney(chosen.limit)}` : ''}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
