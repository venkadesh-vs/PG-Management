'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { CalendarClock, CheckCircle2, Loader2, Repeat, ShieldCheck } from 'lucide-react'
import { api } from '@/lib/client'
import { cn, formatDate, formatMoney } from '@/lib/utils'
import { ordinal } from '@/lib/autopay'
import { useToast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Select } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { CheckoutDismissed, openRazorpayCheckout } from '@/components/payments/razorpay-checkout'

export type AutopayStatus = {
  offered: boolean
  reason: string | null
  limit: number
  day: number
  dayLabel: string
  window: { min: number; max: number }
  dayOutsideWindow: boolean
  suggestedDay: number
  nextChargeDate: string | Date
  methods: { key: 'UPI' | 'EMANDATE' | 'CARD'; label: string }[]
  mandate: {
    id: string
    status: 'PENDING' | 'ACTIVE' | 'PAUSED' | 'CANCELLED' | 'FAILED'
    methodLabel: string
    maxAmount: number
    lastError: string | null
  } | null
  upcoming: { amount: number; chargeDate: string | Date; status: string; invoice: string } | null
  attempts: { id: string; invoice: string; amount: number; chargeDate: string | Date; status: string; error: string | null }[]
}

const ATTEMPT_LABEL: Record<string, { label: string; tone: string }> = {
  NOTIFIED: { label: 'Scheduled', tone: 'bg-sky-50 text-sky-700' },
  INITIATED: { label: 'Processing', tone: 'bg-amber-50 text-amber-700' },
  SUCCEEDED: { label: 'Paid', tone: 'bg-emerald-50 text-emerald-700' },
  FAILED: { label: 'Failed', tone: 'bg-rose-50 text-rose-700' },
  SKIPPED: { label: 'Not debited', tone: 'bg-slate-100 text-slate-600' },
}

function DayPicker({ id, value, onChange, window }: { id: string; value: number; onChange: (d: number) => void; window: { min: number; max: number } }) {
  const days = Array.from({ length: window.max - window.min + 1 }, (_, i) => window.min + i)
  return (
    <Select id={id} value={String(value)} onChange={(e) => onChange(Number(e.target.value))} className="w-full sm:w-44">
      {days.map((d) => (
        <option key={d} value={d}>
          {ordinal(d)} of every month
        </option>
      ))}
    </Select>
  )
}

/**
 * Resident rent AutoPay: set up once (UPI AutoPay, bank eMandate or card) on the
 * day the resident chooses within the PG's window; the exact invoice amount is
 * debited on that day, with a reminder the day before.
 */
export function AutopayCard({ status }: { status: AutopayStatus }) {
  const router = useRouter()
  const toast = useToast()
  const [method, setMethod] = React.useState<'UPI' | 'EMANDATE' | 'CARD'>('UPI')
  const [day, setDay] = React.useState(status.suggestedDay)
  const [busy, setBusy] = React.useState<null | 'start' | 'day' | 'cancel'>(null)
  const [editingDay, setEditingDay] = React.useState(false)
  const [confirmCancel, setConfirmCancel] = React.useState(false)

  const mandate = status.mandate
  const live = mandate && ['ACTIVE', 'PENDING', 'PAUSED'].includes(mandate.status)
  if (!status.offered && !live) return null

  async function start() {
    setBusy('start')
    try {
      const { checkout } = await api.post<{
        checkout: {
          keyId: string
          orderId: string
          customerId: string
          amountPaise: number
          name: string
          description: string
          prefill: { name?: string; email?: string; contact?: string }
          notes: Record<string, string>
        }
      }>('/api/tenant/autopay', { action: 'START', method, chargeDay: day })
      const result = await openRazorpayCheckout({ ...checkout, recurring: true })
      const done = await api.post<{ message: string }>('/api/tenant/autopay', { action: 'CONFIRM', ...result })
      toast.success('AutoPay', done.message)
      router.refresh()
    } catch (error) {
      if (!(error instanceof CheckoutDismissed)) toast.error('AutoPay could not be set up', error instanceof Error ? error.message : undefined)
    } finally {
      setBusy(null)
    }
  }

  async function saveDay() {
    setBusy('day')
    try {
      const res = await api.post<{ message: string }>('/api/tenant/autopay', { action: 'CHANGE_DAY', day })
      toast.success('Date saved', res.message)
      setEditingDay(false)
      router.refresh()
    } catch (error) {
      toast.error('Could not change the date', error instanceof Error ? error.message : undefined)
    } finally {
      setBusy(null)
    }
  }

  async function cancel() {
    setBusy('cancel')
    try {
      const res = await api.post<{ message: string }>('/api/tenant/autopay', { action: 'CANCEL' })
      toast.success('AutoPay cancelled', res.message)
      setConfirmCancel(false)
      router.refresh()
    } catch (error) {
      toast.error('Could not cancel AutoPay', error instanceof Error ? error.message : undefined)
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
            <Repeat className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold text-slate-900">AutoPay</p>
              {mandate?.status === 'ACTIVE' && <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">On</span>}
              {mandate?.status === 'PENDING' && <span className="rounded-md bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">Setting up</span>}
              {mandate?.status === 'PAUSED' && <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">Paused</span>}
            </div>
            <p className="mt-0.5 text-xs text-slate-500">
              We debit your rent automatically on your chosen day. You get a reminder a day before. Cancel anytime.
            </p>
          </div>
        </div>

        {live && mandate ? (
          <div className="space-y-3">
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-lg border border-slate-200 p-3">
                <dt className="text-xs text-slate-500">Paying with</dt>
                <dd className="mt-0.5 font-medium text-slate-900">{mandate.methodLabel}</dd>
              </div>
              <div className="rounded-lg border border-slate-200 p-3">
                <dt className="text-xs text-slate-500">Limit per month</dt>
                <dd className="mt-0.5 font-medium tabular-nums text-slate-900">Up to {formatMoney(mandate.maxAmount)}</dd>
              </div>
            </dl>

            <div className="rounded-lg bg-slate-50 p-3 text-sm">
              <p className="flex items-center gap-2 font-medium text-slate-900">
                <CalendarClock className="size-4 text-slate-500" />
                Your rent will be debited on the {status.dayLabel} of every month
              </p>
              {status.upcoming ? (
                <p className="mt-1 text-xs text-slate-600">
                  Next: {formatMoney(status.upcoming.amount)} for {status.upcoming.invoice} on {formatDate(status.upcoming.chargeDate)}
                </p>
              ) : (
                <p className="mt-1 text-xs text-slate-600">Next debit day: {formatDate(status.nextChargeDate)} (if anything is due)</p>
              )}
              {status.dayOutsideWindow && (
                <p className="mt-2 text-xs text-amber-700">
                  Your PG now allows days {status.window.min} to {status.window.max}. Your rent is still debited on the {status.dayLabel} until you pick a new day.
                </p>
              )}
              {editingDay ? (
                <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                  <DayPicker id="autopay-day-edit" value={day} onChange={setDay} window={status.window} />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={saveDay} disabled={busy !== null}>
                      {busy === 'day' && <Loader2 className="size-4 animate-spin" />}Save
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditingDay(false)}>
                      Keep current
                    </Button>
                  </div>
                </div>
              ) : (
                <button type="button" className="mt-2 text-xs font-medium text-blue-700 hover:underline" onClick={() => setEditingDay(true)}>
                  Change date
                </button>
              )}
              <p className="mt-2 text-[11px] text-slate-500">This is also your rent due day, so no late fee applies before it. A new date applies from your next invoice.</p>
            </div>

            {mandate.lastError && mandate.status !== 'ACTIVE' && <p className="text-xs text-rose-600">{mandate.lastError}</p>}

            {status.attempts.length > 0 && (
              <div>
                <p className="mb-1.5 text-xs font-medium text-slate-500">Recent debits</p>
                <ul className="divide-y divide-slate-100 text-sm">
                  {status.attempts.map((a) => {
                    const meta = ATTEMPT_LABEL[a.status] ?? ATTEMPT_LABEL.NOTIFIED
                    return (
                      <li key={a.id} className="flex items-center justify-between gap-3 py-2">
                        <span className="min-w-0">
                          <span className="block text-slate-700">{a.invoice}</span>
                          <span className="block text-xs text-slate-500">
                            {formatDate(a.chargeDate)}
                            {a.error && a.status !== 'SUCCEEDED' ? ` · ${a.error}` : ''}
                          </span>
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          <span className="tabular-nums text-slate-900">{formatMoney(a.amount)}</span>
                          <span className={cn('rounded-md px-1.5 py-0.5 text-[11px] font-medium', meta.tone)}>{meta.label}</span>
                        </span>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}

            <Button variant="outline" size="sm" onClick={() => setConfirmCancel(true)}>
              Cancel AutoPay
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <p className="mb-1.5 text-xs font-medium text-slate-500" id="autopay-method-label">Pay with</p>
              <div role="radiogroup" aria-labelledby="autopay-method-label" className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {status.methods.map((m) => (
                  <button
                    key={m.key}
                    type="button"
                    role="radio"
                    aria-checked={method === m.key}
                    onClick={() => setMethod(m.key)}
                    className={cn(
                      'rounded-lg border px-3 py-2.5 text-left text-sm transition',
                      method === m.key ? 'border-blue-300 bg-blue-50 text-blue-800' : 'border-slate-200 text-slate-700 hover:border-slate-300',
                    )}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label htmlFor="autopay-day" className="mb-1.5 block text-xs font-medium text-slate-500">
                Debit my rent on
              </label>
              <DayPicker id="autopay-day" value={day} onChange={setDay} window={status.window} />
              <p className="mt-1.5 text-xs text-slate-500">
                Pick a day after your salary comes in. Your PG allows the {ordinal(status.window.min)} to the {ordinal(status.window.max)}. It also becomes your rent due day.
              </p>
            </div>
            <p className="flex items-start gap-2 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" />
              You approve a limit of up to {formatMoney(status.limit)} a month. Only the exact invoice amount (rent, electricity and other charges) is
              debited. {method === 'EMANDATE' ? 'Your bank confirms an eMandate within a few days.' : method === 'UPI' ? 'Your UPI app asks you to approve ₹1 once.' : 'Your card is charged ₹1 once to verify it.'}
            </p>
            {mandate?.status === 'FAILED' && <p className="text-xs text-rose-600">Your last AutoPay could not be set up{mandate.lastError ? `: ${mandate.lastError}` : ''}. You can try again.</p>}
            <Button onClick={start} disabled={busy !== null} className="w-full sm:w-auto">
              {busy === 'start' ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
              Set up AutoPay
            </Button>
          </div>
        )}
      </CardContent>

      <Dialog open={confirmCancel} onOpenChange={setConfirmCancel}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel AutoPay?</DialogTitle>
            <DialogDescription>
              Nothing more will be debited. You will need to pay your rent yourself from this page. Your rent due day stays the {status.dayLabel}.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmCancel(false)}>
              Keep AutoPay
            </Button>
            <Button variant="destructive" onClick={cancel} disabled={busy !== null}>
              {busy === 'cancel' && <Loader2 className="size-4 animate-spin" />}Cancel AutoPay
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
