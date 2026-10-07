'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import {
  Calculator,
  Pencil,
  Plus,
  Save,
  Star,
} from 'lucide-react'
import { OPTIONAL_MODULES } from '@/lib/modules'
import { isModuleEntitlementList } from '@/lib/plan-entitlements'
import { cyclePrice } from '@/lib/subscription-math'
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
  tagline: string | null
  yearlyDiscountPercent: number
  maxProperties: number | null
  maxBeds: number | null
  maxResidents: number | null
  maxStaff: number | null
  whatsappMonthlyLimit: number | null
  storageLimitMb: number | null
  sortOrder: number
  highlighted: boolean
}

const BLANK_PLAN: Plan = {
  id: '',
  name: '',
  slug: '',
  description: null,
  pricingBasis: 'STANDARD_RENT',
  multiplier: 100,
  perBedPrice: 0,
  flatPrice: 0,
  minAmount: 2000,
  maxAmount: 25000,
  trialDays: 14,
  graceDays: 7,
  active: true,
  isDefault: false,
  features: [],
  subscriberCount: 0,
  tagline: null,
  yearlyDiscountPercent: 17,
  maxProperties: null,
  maxBeds: null,
  maxResidents: null,
  maxStaff: null,
  whatsappMonthlyLimit: null,
  storageLimitMb: null,
  sortOrder: 0,
  highlighted: false,
}

const LIMIT_FIELDS = [
  ['maxProperties', 'PGs'],
  ['maxBeds', 'Beds'],
  ['maxResidents', 'Active residents'],
  ['maxStaff', 'Staff'],
  ['whatsappMonthlyLimit', 'WhatsApp msgs / month'],
  ['storageLimitMb', 'Storage (MB)'],
] as const

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
      <div className="flex justify-end">
        <Button variant="primary" size="sm" onClick={() => setEditing({ ...BLANK_PLAN })}>
          <Plus className="size-3.5" />
          New plan
        </Button>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        {plans.map((plan) => (
          <Card
            key={plan.id}
            className={cn(plan.isDefault && 'border-blue-200', plan.highlighted && 'ring-2 ring-blue-200')}
          >
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <CardTitle className="flex items-center gap-1.5 text-sm">
                    {plan.name}
                    {plan.isDefault && <Star className="size-3.5 fill-amber-400 text-amber-400" />}
                  </CardTitle>
                  <p className="text-xs text-slate-500">
                    {plan.slug} · order {plan.sortOrder}
                    {plan.highlighted ? ' · highlighted' : ''}
                  </p>
                  {plan.tagline && <p className="mt-0.5 text-xs text-slate-600">{plan.tagline}</p>}
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
                <p className="text-sm font-semibold text-slate-900">
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
                <Mini label="Yearly off" value={`${plan.yearlyDiscountPercent}%`} />
                <Mini label="Max PGs" value={plan.maxProperties == null ? '∞' : String(plan.maxProperties)} />
                <Mini label="Max beds" value={plan.maxBeds == null ? '∞' : String(plan.maxBeds)} />
              </div>

              <p className="text-[11px] text-slate-500">
                Features:{' '}
                {isModuleEntitlementList(plan.features)
                  ? OPTIONAL_MODULES.filter((m) => plan.features.includes(m.key))
                      .map((m) => m.label)
                      .join(', ') || 'core only'
                  : 'everything included'}
              </p>
              {plan.features.length > 0 && !isModuleEntitlementList(plan.features) && (
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
                Edit plan
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
      <p className="text-[11px] font-medium text-slate-500">{label}</p>
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
    tagline: plan.tagline ?? '',
    yearlyDiscountPercent: String(plan.yearlyDiscountPercent),
    maxProperties: plan.maxProperties == null ? '' : String(plan.maxProperties),
    maxBeds: plan.maxBeds == null ? '' : String(plan.maxBeds),
    maxResidents: plan.maxResidents == null ? '' : String(plan.maxResidents),
    maxStaff: plan.maxStaff == null ? '' : String(plan.maxStaff),
    whatsappMonthlyLimit: plan.whatsappMonthlyLimit == null ? '' : String(plan.whatsappMonthlyLimit),
    storageLimitMb: plan.storageLimitMb == null ? '' : String(plan.storageLimitMb),
    sortOrder: String(plan.sortOrder),
    highlighted: plan.highlighted,
    allFeatures: !isModuleEntitlementList(plan.features),
    modules: OPTIONAL_MODULES.filter(
      (m) => !isModuleEntitlementList(plan.features) || plan.features.includes(m.key),
    ).map((m) => m.key as string),
  })
  const creating = !plan.id
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
        planId: plan.id || undefined,
        tagline: form.tagline || undefined,
        yearlyDiscountPercent: Number(form.yearlyDiscountPercent),
        maxProperties: form.maxProperties === '' ? null : Number(form.maxProperties),
        maxBeds: form.maxBeds === '' ? null : Number(form.maxBeds),
        maxResidents: form.maxResidents === '' ? null : Number(form.maxResidents),
        maxStaff: form.maxStaff === '' ? null : Number(form.maxStaff),
        whatsappMonthlyLimit: form.whatsappMonthlyLimit === '' ? null : Number(form.whatsappMonthlyLimit),
        storageLimitMb: form.storageLimitMb === '' ? null : Number(form.storageLimitMb),
        sortOrder: Number(form.sortOrder),
        highlighted: form.highlighted,
        allFeatures: form.allFeatures,
        features: form.allFeatures ? undefined : form.modules,
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
          <DialogTitle>{creating ? 'New plan' : plan.name}</DialogTitle>
          <DialogDescription>
            {creating
              ? 'Set the pricing rule, limits and features. Owners see active plans on their subscription page.'
              : plan.subscriberCount > 0
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
              <p className="mb-3 text-sm font-semibold text-slate-900">
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

            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Yearly discount (%)" hint="Yearly = 12 × monthly less this">
                <Input
                  type="number"
                  inputMode="numeric"
                  value={form.yearlyDiscountPercent}
                  onChange={(e) => set('yearlyDiscountPercent', e.target.value)}
                />
              </Field>
              <Field label="Tagline" className="sm:col-span-2">
                <Input value={form.tagline} maxLength={120} onChange={(e) => set('tagline', e.target.value)} />
              </Field>
            </div>

            <div className="rounded-xl border border-slate-200 p-4">
              <p className="mb-3 text-sm font-semibold text-slate-900">
                Limits (blank = unlimited)
              </p>
              <div className="grid gap-3 sm:grid-cols-3">
                {LIMIT_FIELDS.map(([key, label]) => (
                  <Field key={key} label={label}>
                    <Input
                      type="number"
                      inputMode="numeric"
                      placeholder="Unlimited"
                      value={form[key]}
                      onChange={(e) => set(key, e.target.value)}
                    />
                  </Field>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-slate-900">Features included</p>
                <label className="flex items-center gap-2 text-xs text-slate-600">
                  Everything
                  <Switch checked={form.allFeatures} onCheckedChange={(c) => set('allFeatures', c)} />
                </label>
              </div>
              {form.allFeatures ? (
                <p className="text-xs text-slate-500">
                  Every module, including ones added later. Core modules are always included.
                </p>
              ) : (
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {OPTIONAL_MODULES.map((m) => (
                    <label key={m.key} className="flex items-center gap-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={form.modules.includes(m.key)}
                        onChange={(e) =>
                          set(
                            'modules',
                            e.target.checked
                              ? [...form.modules, m.key]
                              : form.modules.filter((k) => k !== m.key),
                          )
                        }
                      />
                      {m.label}
                    </label>
                  ))}
                </div>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Display order" hint="Lower shows first">
                <Input
                  type="number"
                  inputMode="numeric"
                  value={form.sortOrder}
                  onChange={(e) => set('sortOrder', e.target.value)}
                />
              </Field>
              <label className="flex cursor-pointer items-center justify-between self-end rounded-xl border border-slate-200 p-3">
                <span className="text-sm font-medium text-slate-800">Highlight as popular</span>
                <Switch checked={form.highlighted} onCheckedChange={(c) => set('highlighted', c)} />
              </label>
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
            <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-4">
              <p className="flex items-center gap-1.5 text-sm font-semibold text-blue-800">
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
                <p className="mt-1 text-xs text-blue-800">
                  {formatMoney(cyclePrice(preview.amount, 'YEARLY', Number(form.yearlyDiscountPercent) || 0))} per year
                </p>
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
