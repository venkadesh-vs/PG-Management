'use client'

import * as React from 'react'
import Link from 'next/link'
import { CheckCircle2, CreditCard, ExternalLink, QrCode } from 'lucide-react'
import { api } from '@/lib/client'
import { formatMoney } from '@/lib/utils'
import { useToast } from '@/components/ui/toast'
import { Field, Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/primitives'
import { Button } from '@/components/ui/button'
import { Choice, Note, StepFooter, StepHeading, hasErrors, toInt, type Errors, type StepContext } from './ui'

function Loading() {
  return <p className="py-8 text-center text-sm text-slate-500">Loading your PG…</p>
}

/** Rent/UPI settings are one form server-side: send the full set, changed fields merged in. */
function saveSettings(ctx: StepContext, patch: Partial<StepContext['snapshot']['settings']>) {
  return api.post('/api/settings', { ...ctx.snapshot.settings, ...patch })
}

function SwitchRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string
  hint?: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 px-3.5 py-3">
      <span>
        <span className="block text-sm font-medium text-slate-800">{label}</span>
        {hint && <span className="block text-xs text-slate-500">{hint}</span>}
      </span>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
    </label>
  )
}

// ---------------------------------------------------------------- rent ----

export function RentStep({ ctx }: { ctx: StepContext }) {
  const toast = useToast()
  const { property, settings } = ctx.snapshot
  const [v, setV] = React.useState({
    standardRent: String(property?.standardRent ?? ''),
    rentDueDay: String(settings.rentDueDay),
    lateFeeEnabled: settings.lateFeeEnabled,
    lateFeeGraceDays: String(settings.lateFeeGraceDays),
    lateFeeAmount: String(settings.lateFeeAmount),
    lateFeePerDay: String(settings.lateFeePerDay),
  })
  const [errors, setErrors] = React.useState<Errors>({})
  const [busy, setBusy] = React.useState(false)
  if (!property) return <Loading />

  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV((s) => ({ ...s, [k]: e.target.value }))
  const rent = toInt(v.standardRent)
  const due = toInt(v.rentDueDay)
  const grace = toInt(v.lateFeeGraceDays)
  const fee = toInt(v.lateFeeAmount)
  const perDay = toInt(v.lateFeePerDay)

  async function next() {
    const e: Errors = {
      standardRent: Number.isNaN(rent) || rent <= 0 ? 'Enter the monthly rent per bed' : undefined,
      rentDueDay: Number.isNaN(due) || due < 1 || due > 28 ? 'Pick a day between 1 and 28' : undefined,
      lateFeeGraceDays: v.lateFeeEnabled && (Number.isNaN(grace) || grace < 0 || grace > 30) ? '0–30 days' : undefined,
      lateFeeAmount: v.lateFeeEnabled && (Number.isNaN(fee) || fee < 0) ? 'Enter a whole rupee amount' : undefined,
      lateFeePerDay: v.lateFeeEnabled && (Number.isNaN(perDay) || perDay < 0) ? 'Enter a whole rupee amount' : undefined,
    }
    setErrors(e)
    if (hasErrors(e) || !property) return
    setBusy(true)
    try {
      if (rent !== property.standardRent) await api.patch(`/api/properties/${property.id}`, { standardRent: rent })
      await saveSettings(ctx, {
        rentDueDay: due,
        rentGenerateDay: Math.min(ctx.snapshot.settings.rentGenerateDay, due),
        lateFeeEnabled: v.lateFeeEnabled,
        lateFeeGraceDays: v.lateFeeEnabled ? grace : ctx.snapshot.settings.lateFeeGraceDays,
        lateFeeAmount: v.lateFeeEnabled ? fee : ctx.snapshot.settings.lateFeeAmount,
        lateFeePerDay: v.lateFeeEnabled ? perDay : ctx.snapshot.settings.lateFeePerDay,
      })
      await ctx.advance()
    } catch (err) {
      toast.fromError(err, 'save the rent rules')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <StepHeading
        title="Rent rules"
        body="The default for every new resident — you can still set a different rent per bed or per resident."
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Standard monthly rent (per bed)" required error={errors.standardRent} htmlFor="rent">
          <Input id="rent" type="number" inputMode="numeric" value={v.standardRent} onChange={set('standardRent')} aria-invalid={Boolean(errors.standardRent)} />
        </Field>
        <Field label="Rent due on day" required error={errors.rentDueDay} hint="Of every month (1–28)" htmlFor="due">
          <Input id="due" type="number" inputMode="numeric" min={1} max={28} value={v.rentDueDay} onChange={set('rentDueDay')} aria-invalid={Boolean(errors.rentDueDay)} />
        </Field>
      </div>
      <SwitchRow
        label="Charge a late fee"
        hint="Added automatically when rent is overdue"
        checked={v.lateFeeEnabled}
        onChange={(c) => setV((s) => ({ ...s, lateFeeEnabled: c }))}
      />
      {v.lateFeeEnabled && (
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Grace period (days)" error={errors.lateFeeGraceDays}>
            <Input type="number" inputMode="numeric" value={v.lateFeeGraceDays} onChange={set('lateFeeGraceDays')} />
          </Field>
          <Field label="Flat late fee (₹)" error={errors.lateFeeAmount}>
            <Input type="number" inputMode="numeric" value={v.lateFeeAmount} onChange={set('lateFeeAmount')} />
          </Field>
          <Field label="Plus per day (₹)" error={errors.lateFeePerDay} hint="0 for none">
            <Input type="number" inputMode="numeric" value={v.lateFeePerDay} onChange={set('lateFeePerDay')} />
          </Field>
        </div>
      )}
      {!Number.isNaN(rent) && rent > 0 && !Number.isNaN(due) && (
        <Note>
          Residents pay {formatMoney(rent)} by the {due}
          {due === 1 ? 'st' : due === 2 ? 'nd' : due === 3 ? 'rd' : 'th'} of each month
          {v.lateFeeEnabled && !Number.isNaN(fee) && !Number.isNaN(grace)
            ? `; after ${grace} grace day${grace === 1 ? '' : 's'} a ${formatMoney(fee)} late fee${perDay > 0 ? ` + ${formatMoney(perDay)}/day` : ''} is added.`
            : '. No late fee.'}
        </Note>
      )}
      <StepFooter onBack={ctx.back} onNext={next} busy={busy} />
    </>
  )
}

// ------------------------------------------------------------- deposit ----

export function DepositStep({ ctx }: { ctx: StepContext }) {
  const toast = useToast()
  const property = ctx.snapshot.property
  const [deposit, setDeposit] = React.useState(String(property?.standardDeposit ?? ''))
  const [notice, setNotice] = React.useState(String(property?.noticePeriodDays ?? 30))
  const [errors, setErrors] = React.useState<Errors>({})
  const [busy, setBusy] = React.useState(false)
  if (!property) return <Loading />

  async function next() {
    const d = toInt(deposit)
    const n = toInt(notice)
    const e: Errors = {
      deposit: Number.isNaN(d) || d < 0 ? 'Enter the deposit (0 if you don’t take one)' : undefined,
      notice: Number.isNaN(n) || n < 0 || n > 120 ? '0–120 days' : undefined,
    }
    setErrors(e)
    if (hasErrors(e) || !property) return
    setBusy(true)
    try {
      await api.patch(`/api/properties/${property.id}`, { standardDeposit: d, noticePeriodDays: n })
      await ctx.advance()
    } catch (err) {
      toast.fromError(err, 'save the deposit')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <StepHeading title="Deposit" body="Collected at check-in and settled at checkout against any dues." />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Standard deposit (₹)" required error={errors.deposit} htmlFor="dep">
          <Input id="dep" type="number" inputMode="numeric" value={deposit} onChange={(e) => setDeposit(e.target.value)} aria-invalid={Boolean(errors.deposit)} />
        </Field>
        <Field label="Notice period (days)" required error={errors.notice} htmlFor="notice">
          <Input id="notice" type="number" inputMode="numeric" value={notice} onChange={(e) => setNotice(e.target.value)} aria-invalid={Boolean(errors.notice)} />
        </Field>
      </div>
      <Note>
        <strong>How refunds work:</strong> at checkout StayFlow deducts unpaid rent, utilities and any damages you
        add, then shows the refund. Residents leaving without serving notice can be charged for the shortfall.
      </Note>
      <StepFooter onBack={ctx.back} onNext={next} busy={busy} />
    </>
  )
}

// ---------------------------------------------------------------- food ----

const MEAL_PLANS = [
  { value: 'ALL', label: 'All 3 meals' },
  { value: 'BREAKFAST_DINNER', label: 'Breakfast & dinner' },
  { value: 'DINNER', label: 'Dinner only' },
] as const

export function FoodStep({ ctx }: { ctx: StepContext }) {
  const toast = useToast()
  const property = ctx.snapshot.property
  const [on, setOn] = React.useState(property?.foodIncluded ?? true)
  const [charge, setCharge] = React.useState(String(property?.foodCharge || 2500))
  const [plan, setPlan] = React.useState<(typeof MEAL_PLANS)[number]['value']>(property?.mealPlan ?? 'ALL')
  const [error, setError] = React.useState<string>()
  const [busy, setBusy] = React.useState(false)
  if (!property) return <Loading />

  async function save(how: 'complete' | 'skip') {
    if (!property) return
    const c = toInt(charge)
    if (how === 'complete' && on && (Number.isNaN(c) || c < 0)) {
      setError('Enter the monthly food charge (0 if it’s in the rent)')
      return
    }
    setError(undefined)
    setBusy(true)
    try {
      if (how === 'complete') {
        await api.patch(`/api/properties/${property.id}`, { foodIncluded: on, foodCharge: on ? c : 0 })
        if (on) {
          await api.post('/api/onboarding', { action: 'FOOD_PLAN', propertyId: property.id, monthlyCharge: c, mealPlan: plan })
        }
      }
      await ctx.advance({ how, answers: { mealPlan: plan } })
    } catch (err) {
      toast.fromError(err, 'save the food settings')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <StepHeading title="Food" optional body="Do you serve meals? The food charge is added to each resident’s monthly bill." />
      <SwitchRow label="We provide food" checked={on} onChange={setOn} />
      {on && (
        <>
          <Field label="Food charge per month (₹)" error={error} hint="0 if food is included in the rent" htmlFor="food">
            <Input id="food" type="number" inputMode="numeric" value={charge} onChange={(e) => setCharge(e.target.value)} aria-invalid={Boolean(error)} />
          </Field>
          <Field label="Meal plan">
            <div className="grid gap-2 sm:grid-cols-3">
              {MEAL_PLANS.map((m) => (
                <Choice key={m.value} selected={plan === m.value} onClick={() => setPlan(m.value)}>
                  {m.label}
                </Choice>
              ))}
            </div>
          </Field>
        </>
      )}
      <StepFooter onBack={ctx.back} onNext={() => save('complete')} onSkip={() => save('skip')} busy={busy} />
    </>
  )
}

// ------------------------------------------------------------ payments ----

const UPI_RE = /^[\w.-]{2,}@[A-Za-z]{2,}$/

export function PaymentsStep({ ctx }: { ctx: StepContext }) {
  const toast = useToast()
  const { settings, facts, isOwner, owner } = ctx.snapshot
  const [upiId, setUpiId] = React.useState(settings.upiId)
  const [payee, setPayee] = React.useState(settings.upiPayeeName || owner.name)
  const [error, setError] = React.useState<string>()
  const [busy, setBusy] = React.useState(false)

  async function save(how: 'complete' | 'skip') {
    const id = upiId.trim()
    if (how === 'complete') {
      if (id && !UPI_RE.test(id)) {
        setError('That doesn’t look like a UPI ID — e.g. name@okhdfcbank')
        return
      }
      if (!id && !facts.razorpay) {
        setError('Add a UPI ID, connect Razorpay, or tap “Skip for now” to collect by cash')
        return
      }
    }
    setError(undefined)
    setBusy(true)
    try {
      if (how === 'complete' && (id !== settings.upiId || payee.trim() !== settings.upiPayeeName)) {
        await saveSettings(ctx, { upiId: id, upiPayeeName: payee.trim() })
      }
      await ctx.advance({ how })
    } catch (err) {
      toast.fromError(err, 'save your payment details')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <StepHeading title="Payment setup" optional body="How residents pay you. Start with UPI today; add online payments whenever you’re ready." />
      <div className="space-y-3 rounded-xl border border-slate-200 p-4">
        <p className="flex items-center gap-2 font-medium text-slate-900">
          <QrCode className="size-4 text-blue-600" />
          UPI — fastest to start
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="UPI ID" error={error} htmlFor="upi">
            <Input id="upi" value={upiId} onChange={(e) => setUpiId(e.target.value)} placeholder="yourname@okhdfcbank" autoCapitalize="none" aria-invalid={Boolean(error)} />
          </Field>
          <Field label="Payee name" hint="Shown in the UPI app" htmlFor="payee">
            <Input id="payee" value={payee} onChange={(e) => setPayee(e.target.value)} />
          </Field>
        </div>
        <p className="text-xs text-slate-500">Rent reminders carry a pay link to this UPI ID. You confirm the payment in StayFlow.</p>
      </div>
      <div className="space-y-2 rounded-xl border border-slate-200 p-4">
        <p className="flex items-center gap-2 font-medium text-slate-900">
          <CreditCard className="size-4 text-blue-600" />
          Razorpay — online payments, auto-recorded
        </p>
        {facts.razorpay ? (
          <p className="flex items-center gap-1.5 text-sm text-emerald-700">
            <CheckCircle2 className="size-4" />
            Connected
          </p>
        ) : isOwner ? (
          <>
            <p className="text-sm text-slate-500">
              Connect your own Razorpay account so money lands in your bank and receipts are recorded automatically.
            </p>
            <Button variant="outline" size="sm" asChild>
              <Link href="/app/settings/payments" target="_blank">
                <ExternalLink className="size-3.5" />
                Connect Razorpay
              </Link>
            </Button>
          </>
        ) : (
          <p className="text-sm text-slate-500">Only the owner can connect Razorpay.</p>
        )}
      </div>
      <Note>
        Not ready? Skip — you can record cash and UPI payments by hand. Until Razorpay is connected, online
        payment screens run in demo mode and no money moves.
      </Note>
      <StepFooter onBack={ctx.back} onNext={() => save('complete')} onSkip={() => save('skip')} busy={busy} />
    </>
  )
}
