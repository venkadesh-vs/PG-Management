'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import {
  Calculator,
  Pencil,
  Save,
  Star,
} from 'lucide-react'
import { api, ApiError } from '@/lib/client'
import { cn, formatMoney } from '@/lib/utils'
import { useToast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Field, Input, Select, Textarea } from '@/components/ui/input'
import { Switch } from '@/components/ui/primitives'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

type Plan = {
  id: string
  name: string
  slug: string
  description: string | null
  pricingBasis: 'STANDARD_RENT' | 'PER_BED' | 'FLAT'
  multiplier: number
  perBedPrice: number
  flatPrice: number
  minAmount: number
  maxAmount: number
  trialDays: number
  graceDays: number
  active: boolean
  isDefault: boolean
  features: string[]
  subscriberCount: number
}

const BASIS_LABEL = {
  STANDARD_RENT: "A multiple of the PG's standard rent",
  PER_BED: 'A rate per bed',
  FLAT: 'A flat monthly fee',
} as const

/**
 * Plan editing, with a live calculator so the effect of a rule change on a
 * real PG is visible before it is saved.
 */
export function PlanEditor({ plans }: { plans: Plan[] }) {
  const [editing, setEditing] = React.useState<Plan | null>(null)

  return (
    <>
      <div className="grid gap-4 lg:grid-cols-3">
        {plans.map((plan) => (
          <Card key={plan.id} className={cn(plan.isDefault && 'border-violet-200')}>
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <CardTitle className="flex items-center gap-1.5 text-sm">
                    {plan.name}
                    {plan.isDefault && <Star className="size-3.5 fill-violet-500 text-violet-500" />}
                  </CardTitle>
                  <p className="text-xs text-slate-500">{plan.slug}</p>
                </div>
                <Badge variant={plan.active ? 'success' : 'default'} size="sm">
                  {plan.active ? 'Active' : 'Inactive'}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {plan.description && (
                <p className="text-sm leading-relaxed text-slate-600">{plan.description}</p>
              )}

              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Pricing rule
                </p>
                <p className="mt-1 text-sm font-medium text-slate-800">
                  {plan.pricingBasis === 'STANDARD_RENT'
                    ? `${plan.multiplier}% of the PG's standard rent`
                    : plan.pricingBasis === 'PER_BED'
                      ? `${formatMoney(plan.perBedPrice)} per bed`
                      : `${formatMoney(plan.flatPrice)} flat`}
                </p>
                <p className="mt-0.5 text-xs text-slate-500">
                  Between {formatMoney(plan.minAmount)} and {formatMoney(plan.maxAmount)}
                </p>
              </div>

              <div className="grid grid-cols-3 gap-2 text-center">
                <Mini label="Trial" value={`${plan.trialDays}d`} />
                <Mini label="Grace" value={`${plan.graceDays}d`} />
                <Mini label="PGs on it" value={String(plan.subscriberCount)} />
              </div>

              {plan.features.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {plan.features.slice(0, 6).map((feature) => (
                    <span
                      key={feature}
                      className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600"
                    >
                      {feature.replace('_', ' ')}
                    </span>
                  ))}
                  {plan.features.length > 6 && (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500">
                      +{plan.features.length - 6}
                    </span>
                  )}
                </div>
              )}

              <Button variant="outline" size="sm" className="w-full" onClick={() => setEditing(plan)}>
                <Pencil className="size-3.5" />
                Edit pricing rules
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      {editing && <PlanDialog plan={editing} onClose={() => setEditing(null)} />}
    </>
  )
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-slate-50 px-1.5 py-1.5">
      <p className="font-display text-sm font-semibold text-slate-900 tabular">{value}</p>
      <p className="text-[10px] uppercase tracking-wide text-slate-400">{label}</p>
    </div>
  )
}

function PlanDialog({ plan, onClose }: { plan: Plan; onClose: () => void }) {
  const router = useRouter()
  const toast = useToast()
  const [form, setForm] = React.useState({
    name: plan.name,
    description: plan.description ?? '',
    pricingBasis: plan.pricingBasis,
    multiplier: String(plan.multiplier),
    perBedPrice: String(plan.perBedPrice),
    flatPrice: String(plan.flatPrice),
    minAmount: String(plan.minAmount),
    maxAmount: String(plan.maxAmount),
    trialDays: String(plan.trialDays),
    graceDays: String(plan.graceDays),
    active: plan.active,
    isDefault: plan.isDefault,
  })
  const [sampleRent, setSampleRent] = React.useState('8000')
  const [sampleBeds, setSampleBeds] = React.useState('40')
  const [busy, setBusy] = React.useState(false)

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  // Mirrors priceForProperty on the server so the preview is honest.
  const preview = React.useMemo(() => {
    const raw =
      form.pricingBasis === 'STANDARD_RENT'
        ? Math.round((Number(sampleRent) * Number(form.multiplier)) / 100)
        : form.pricingBasis === 'PER_BED'
          ? Number(sampleBeds) * Number(form.perBedPrice)
          : Number(form.flatPrice)
    const min = Number(form.minAmount)
    const max = Number(form.maxAmount)
    const amount = Math.min(max, Math.max(min, raw))
    return { raw, amount, clamped: amount !== raw }
  }, [form, sampleRent, sampleBeds])

  async function save() {
    setBusy(true)
    try {
      const result = await api.post<{ message: string }>('/api/admin/plans', {
        planId: plan.id,
        name: form.name,
        description: form.description || undefined,
        pricingBasis: form.pricingBasis,
        multiplier: Number(form.multiplier),
        perBedPrice: Number(form.perBedPrice),
        flatPrice: Number(form.flatPrice),
        minAmount: Number(form.minAmount),
        maxAmount: Number(form.maxAmount),
        trialDays: Number(form.trialDays),
        graceDays: Number(form.graceDays),
        active: form.active,
        isDefault: form.isDefault,
      })
      toast.success('Plan saved', result.message)
      onClose()
      router.refresh()
    } catch (error) {
      toast.error(
        'Unable to save this plan',
        error instanceof ApiError ? error.message : 'Please try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{plan.name}</DialogTitle>
          <DialogDescription>
            {plan.subscriberCount > 0
              ? `${plan.subscriberCount} PG${plan.subscriberCount === 1 ? '' : 's'} are on this plan. Changing the rule affects what they are charged from their next billing date.`
              : 'No PGs are on this plan yet.'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-5 lg:grid-cols-[1fr_260px]">
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Plan name" required>
                <Input value={form.name} onChange={(e) => set('name', e.target.value)} />
              </Field>
              <Field label="Pricing basis" required>
                <Select
                  value={form.pricingBasis}
                  onChange={(e) => set('pricingBasis', e.target.value as Plan['pricingBasis'])}
                >
                  <option value="STANDARD_RENT">Multiple of standard rent</option>
                  <option value="PER_BED">Per bed</option>
                  <option value="FLAT">Flat fee</option>
                </Select>
              </Field>
            </div>

            <Field label="Description">
              <Textarea
                rows={2}
                value={form.description}
                onChange={(e) => set('description', e.target.value)}
              />
            </Field>

            <div className="rounded-xl border border-slate-200 p-4">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                {BASIS_LABEL[form.pricingBasis]}
              </p>
              {form.pricingBasis === 'STANDARD_RENT' && (
                <Field
                  label="Percentage of standard rent"
                  hint="100% means one PG costs the same as one resident's rent"
                >
                  <Input
                    type="number"
                    inputMode="numeric"
                    value={form.multiplier}
                    onChange={(e) => set('multiplier', e.target.value)}
                  />
                </Field>
              )}
              {form.pricingBasis === 'PER_BED' && (
                <Field label="Price per bed">
                  <Input
                    type="number"
                    inputMode="numeric"
                    value={form.perBedPrice}
                    onChange={(e) => set('perBedPrice', e.target.value)}
                  />
                </Field>
              )}
              {form.pricingBasis === 'FLAT' && (
                <Field label="Flat monthly fee">
                  <Input
                    type="number"
                    inputMode="numeric"
                    value={form.flatPrice}
                    onChange={(e) => set('flatPrice', e.target.value)}
                  />
                </Field>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Minimum subscription" hint="Floor, whatever the rule works out to">
                <Input
                  type="number"
                  inputMode="numeric"
                  value={form.minAmount}
                  onChange={(e) => set('minAmount', e.target.value)}
                />
              </Field>
              <Field label="Maximum subscription" hint="Ceiling for very high-rent PGs">
                <Input
                  type="number"
                  inputMode="numeric"
                  value={form.maxAmount}
                  onChange={(e) => set('maxAmount', e.target.value)}
                />
              </Field>
              <Field label="Trial period (days)">
                <Input
                  type="number"
                  inputMode="numeric"
                  value={form.trialDays}
                  onChange={(e) => set('trialDays', e.target.value)}
                />
              </Field>
              <Field label="Grace period (days)" hint="After a failed payment, before restriction">
                <Input
                  type="number"
                  inputMode="numeric"
                  value={form.graceDays}
                  onChange={(e) => set('graceDays', e.target.value)}
                />
              </Field>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <label className="flex cursor-pointer items-center justify-between rounded-xl border border-slate-200 p-3">
                <span className="text-sm font-medium text-slate-800">Available to new PGs</span>
                <Switch checked={form.active} onCheckedChange={(c) => set('active', c)} />
              </label>
              <label className="flex cursor-pointer items-center justify-between rounded-xl border border-slate-200 p-3">
                <span className="text-sm font-medium text-slate-800">Default plan</span>
                <Switch checked={form.isDefault} onCheckedChange={(c) => set('isDefault', c)} />
              </label>
            </div>
          </div>

          {/* --------------------------------------------- Live calculator */}
          <div className="space-y-3">
            <div className="rounded-2xl border border-blue-100 bg-blue-50/60 p-4">
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-blue-800">
                <Calculator className="size-3.5" />
                What a PG would pay
              </p>

              {form.pricingBasis === 'STANDARD_RENT' ? (
                <Field label="Their standard rent" className="mt-3">
                  <Input
                    type="number"
                    inputMode="numeric"
                    value={sampleRent}
                    onChange={(e) => setSampleRent(e.target.value)}
                  />
                </Field>
              ) : form.pricingBasis === 'PER_BED' ? (
                <Field label="Their bed count" className="mt-3">
                  <Input
                    type="number"
                    inputMode="numeric"
                    value={sampleBeds}
                    onChange={(e) => setSampleBeds(e.target.value)}
                  />
                </Field>
              ) : null}

              <motion.div
                key={preview.amount}
                initial={{ scale: 0.96, opacity: 0.7 }}
                animate={{ scale: 1, opacity: 1 }}
                className="mt-3 rounded-xl bg-white p-3 text-center shadow-sm"
              >
                <p className="font-display text-2xl font-semibold text-blue-900 tabular">
                  {formatMoney(preview.amount)}
                </p>
                <p className="text-[11px] text-blue-700/70">per month</p>
              </motion.div>

              {preview.clamped && (
                <p className="mt-2 text-[11px] leading-relaxed text-blue-800/80">
                  The rule works out to {formatMoney(preview.raw)}, adjusted to the{' '}
                  {preview.amount === Number(form.minAmount) ? 'minimum' : 'maximum'}.
                </p>
              )}
            </div>

            <p className="text-[11px] leading-relaxed text-slate-500">
              Existing subscriptions keep their current amount until they are re-priced from the
              subscriptions page, so nobody is surprised mid-cycle.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={save}>
            <Save className="size-4" />
            Save plan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
