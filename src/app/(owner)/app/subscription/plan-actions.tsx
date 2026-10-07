'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, ArrowUpDown, CheckCircle2, RotateCcw, XCircle } from 'lucide-react'
import { api, ApiError } from '@/lib/client'
import { cn, formatDate, formatMoney } from '@/lib/utils'
import { CANCEL_CATEGORIES, CYCLE_LABEL, cyclePrice } from '@/lib/subscription-math'
import { useToast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { Field, Select, Textarea } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

type Cycle = 'MONTHLY' | 'YEARLY'

export type PlanOption = {
  id: string
  name: string
  tagline: string | null
  /** What this PG would pay per month on this plan. */
  monthly: number
  yearlyDiscountPercent: number
  highlighted: boolean
}

type Preview = {
  kind: 'upgrade' | 'downgrade' | 'cycle' | 'clear' | 'none'
  effective: 'now' | 'period_end'
  targetPlan: { id: string; name: string }
  targetCycle: string
  dueNow: { taxable: number; tax: number; total: number; remainingDays: number }
  nextCharge: { date: string; taxable: number; tax: number; total: number }
  blockers: string[]
  notes: string[]
}

function message(error: unknown) {
  return error instanceof ApiError ? error.message : 'Please try again.'
}

/**
 * Change plan / billing cycle with a billing preview before confirming:
 * what is paid now (prorated upgrade) and what the next renewal costs.
 */
export function ChangePlanButton({
  subscriptionId,
  propertyName,
  currentPlanId,
  currentCycle,
  plans,
}: {
  subscriptionId: string
  propertyName: string
  currentPlanId: string
  currentCycle: string
  plans: PlanOption[]
}) {
  const router = useRouter()
  const toast = useToast()
  const [open, setOpen] = React.useState(false)
  const [planId, setPlanId] = React.useState(currentPlanId)
  const [cycle, setCycle] = React.useState<Cycle>(currentCycle === 'YEARLY' ? 'YEARLY' : 'MONTHLY')
  const [preview, setPreview] = React.useState<Preview | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!open) return
    let live = true
    setLoading(true)
    setError(null)
    api
      .post<{ preview: Preview }>('/api/subscription', {
        action: 'PREVIEW_CHANGE',
        subscriptionId,
        planId,
        billingCycle: cycle,
      })
      .then((r) => live && setPreview(r.preview))
      .catch((e) => {
        if (!live) return
        setPreview(null)
        setError(message(e))
      })
      .finally(() => live && setLoading(false))
    return () => {
      live = false
    }
  }, [open, planId, cycle, subscriptionId])

  async function confirm() {
    setBusy(true)
    try {
      const result = await api.post<{ message: string; invoice: { number: string; total: number } | null }>(
        '/api/subscription',
        { action: 'CHANGE_PLAN', subscriptionId, planId, billingCycle: cycle },
      )
      toast.success(
        result.message,
        result.invoice ? `${result.invoice.number} · ${formatMoney(result.invoice.total)} — pay it from the invoices below.` : undefined,
      )
      setOpen(false)
      router.refresh()
    } catch (e) {
      toast.error('Unable to change the plan', message(e))
    } finally {
      setBusy(false)
    }
  }

  const blocked = Boolean(preview?.blockers.length)
  const nothing = preview?.kind === 'none'

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <ArrowUpDown className="size-3.5" />
        Change plan
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>Change plan · {propertyName}</DialogTitle>
            <DialogDescription>
              Upgrades start now — you pay only the difference for the days left. Downgrades and
              switching between monthly and yearly start at your next renewal.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="inline-flex rounded-xl border border-slate-200 p-1">
              {(['MONTHLY', 'YEARLY'] as const).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCycle(c)}
                  className={cn(
                    'rounded-lg px-3 py-1.5 text-sm font-medium',
                    cycle === c ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50',
                  )}
                >
                  {CYCLE_LABEL[c]}
                </button>
              ))}
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              {plans.map((plan) => {
                const price = cyclePrice(plan.monthly, cycle, plan.yearlyDiscountPercent)
                const selected = plan.id === planId
                return (
                  <button
                    key={plan.id}
                    type="button"
                    onClick={() => setPlanId(plan.id)}
                    className={cn(
                      'rounded-xl border p-3 text-left transition',
                      selected ? 'border-blue-500 ring-2 ring-blue-100' : 'border-slate-200 hover:border-slate-300',
                    )}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-slate-900">{plan.name}</span>
                      {plan.id === currentPlanId ? (
                        <span className="text-[10px] font-semibold uppercase text-slate-400">Current</span>
                      ) : plan.highlighted ? (
                        <span className="text-[10px] font-semibold uppercase text-blue-600">Popular</span>
                      ) : null}
                    </span>
                    {plan.tagline && <span className="mt-0.5 block text-xs text-slate-500">{plan.tagline}</span>}
                    <span className="mt-1.5 block font-display text-lg font-semibold tabular text-slate-900">
                      {formatMoney(price)}
                      <span className="text-xs font-normal text-slate-500">
                        {cycle === 'YEARLY' ? '/year' : '/month'}
                      </span>
                    </span>
                    {cycle === 'YEARLY' && plan.yearlyDiscountPercent > 0 && (
                      <span className="text-[11px] text-emerald-700">Save {plan.yearlyDiscountPercent}% vs monthly</span>
                    )}
                  </button>
                )
              })}
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 text-sm">
              {loading ? (
                <p className="text-slate-500">Working out the price…</p>
              ) : error ? (
                <p className="text-red-600">{error}</p>
              ) : preview ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-slate-600">You pay now</span>
                    <span className="font-semibold tabular text-slate-900">
                      {formatMoney(preview.dueNow.total)}
                      {preview.dueNow.tax > 0 && (
                        <span className="ml-1 text-xs font-normal text-slate-500">incl. {formatMoney(preview.dueNow.tax)} GST</span>
                      )}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-slate-600">Next renewal · {formatDate(preview.nextCharge.date)}</span>
                    <span className="font-semibold tabular text-slate-900">{formatMoney(preview.nextCharge.total)}</span>
                  </div>
                  {preview.notes.map((n) => (
                    <p key={n} className="flex items-start gap-1.5 text-xs text-slate-600">
                      <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-500" />
                      {n}
                    </p>
                  ))}
                  {preview.blockers.length > 0 && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                      <p className="flex items-center gap-1.5 font-semibold">
                        <AlertTriangle className="size-3.5" />
                        You can&apos;t move to {preview.targetPlan.name} yet
                      </p>
                      <ul className="mt-1 list-disc pl-5">
                        {preview.blockers.map((b) => (
                          <li key={b}>{b}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Close
            </Button>
            <Button variant="primary" loading={busy} disabled={loading || blocked || nothing || !preview} onClick={confirm}>
              {preview?.kind === 'upgrade' && preview.dueNow.total > 0
                ? `Upgrade · pay ${formatMoney(preview.dueNow.total)}`
                : preview?.kind === 'clear'
                  ? 'Cancel scheduled change'
                  : 'Confirm change'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

/** Cancel now or at the end of the paid period, with a reason. */
export function CancelSubscriptionButton({
  subscriptionId,
  propertyName,
  periodEnd,
  trial,
}: {
  subscriptionId: string
  propertyName: string
  periodEnd: string
  trial: boolean
}) {
  const router = useRouter()
  const toast = useToast()
  const [open, setOpen] = React.useState(false)
  const [when, setWhen] = React.useState<'period_end' | 'now'>('period_end')
  const [category, setCategory] = React.useState<string>('PRICE')
  const [reason, setReason] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  async function submit() {
    setBusy(true)
    try {
      const result = await api.post<{ message: string }>('/api/subscription', {
        action: 'CANCEL_SUBSCRIPTION',
        subscriptionId,
        when,
        category,
        reason: reason.trim() || undefined,
      })
      toast.success('Done', result.message)
      setOpen(false)
      router.refresh()
    } catch (e) {
      toast.error('Unable to cancel', message(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button variant="ghost" size="sm" className="text-red-600 hover:text-red-700" onClick={() => setOpen(true)}>
        <XCircle className="size-3.5" />
        Cancel
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel {propertyName}&apos;s subscription?</DialogTitle>
            <DialogDescription>
              Your data stays safe. You can change your mind before the {trial ? 'trial' : 'period'} ends.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-2">
              {(
                [
                  ['period_end', `At the end of the ${trial ? 'trial' : 'paid period'} (${formatDate(periodEnd)})`],
                  ['now', 'Right now'],
                ] as const
              ).map(([value, label]) => (
                <label
                  key={value}
                  className={cn(
                    'flex cursor-pointer items-center gap-2 rounded-xl border p-3 text-sm',
                    when === value ? 'border-blue-500 bg-blue-50/40' : 'border-slate-200',
                  )}
                >
                  <input type="radio" name="when" checked={when === value} onChange={() => setWhen(value)} />
                  {label}
                </label>
              ))}
            </div>
            <Field label="Main reason" required>
              <Select value={category} onChange={(e) => setCategory(e.target.value)}>
                {CANCEL_CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Anything we could do better?">
              <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Keep subscription
            </Button>
            <Button variant="destructive" loading={busy} onClick={submit}>
              {when === 'now' ? 'Cancel now' : 'Cancel at period end'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

/** Withdraw a scheduled cancellation. */
export function ResumeSubscriptionButton({ subscriptionId }: { subscriptionId: string }) {
  const router = useRouter()
  const toast = useToast()
  const [busy, setBusy] = React.useState(false)
  async function resume() {
    setBusy(true)
    try {
      const result = await api.post<{ message: string }>('/api/subscription', {
        action: 'RESUME_SUBSCRIPTION',
        subscriptionId,
      })
      toast.success('Subscription kept', result.message)
      router.refresh()
    } catch (e) {
      toast.error('Unable to keep the subscription', message(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Button variant="outline" size="sm" loading={busy} onClick={resume}>
      <RotateCcw className="size-3.5" />
      Keep subscription
    </Button>
  )
}
