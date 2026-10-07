'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { motion } from 'framer-motion'
import { Building2, Check, Plus, Sparkles, X } from 'lucide-react'
import type { z } from 'zod'
import { propertySchema } from '@/lib/validation'
import { api, ApiError } from '@/lib/client'
import {
  cn,
  formatMoney,
} from '@/lib/utils'
import { PROPERTY_THEMES } from '@/lib/theme'
import { useToast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, Input, Select, Textarea } from '@/components/ui/input'
import { Switch } from '@/components/ui/primitives'

type Values = z.infer<typeof propertySchema>

type Plan = {
  name: string
  pricingBasis: 'STANDARD_RENT' | 'PER_BED' | 'FLAT'
  multiplier: number
  perBedPrice: number
  flatPrice: number
  minAmount: number
  maxAmount: number
  trialDays: number
} | null

const AMENITY_SUGGESTIONS = [
  'WiFi', 'Three meals', 'Power backup', 'Washing machine', 'CCTV', 'Hot water',
  'Housekeeping', 'Parking', '24×7 security', 'Warden', 'Lift', 'Study table',
  'Refrigerator', 'Water purifier',
]

const RULE_SUGGESTIONS = [
  'Entry closes at 11:00 PM',
  'Visitors allowed between 9 AM and 8 PM',
  'No smoking or alcohol inside the premises',
  'One month notice before vacating',
  'Keep the common areas clean',
]

/** An existing PG, passed in to switch the form into edit mode. */
export type EditableProperty = Values & { id: string }

/**
 * Creating a PG. The subscription preview updates live from the standard
 * rent, so the owner knows what the PG will cost before they commit.
 *
 * With `property` set the same form edits an existing PG: the short code is
 * locked (it is part of issued invoice numbers) and the save is a PATCH.
 */
export function PropertyForm({
  plan,
  existingCount,
  property,
}: {
  plan: Plan
  existingCount: number
  property?: EditableProperty
}) {
  const router = useRouter()
  const toast = useToast()
  const editing = Boolean(property)
  const [amenityInput, setAmenityInput] = React.useState('')
  const [ruleInput, setRuleInput] = React.useState('')

  const form = useForm<Values>({
    resolver: zodResolver(propertySchema),
    defaultValues: property ?? {
      name: '',
      code: '',
      type: 'MENS',
      addressLine: '',
      city: '',
      state: 'Tamil Nadu',
      pincode: '',
      contactName: '',
      contactPhone: '',
      description: '',
      standardRent: 8000,
      standardDeposit: 10000,
      maintenanceFee: 0,
      foodCharge: 2500,
      foodIncluded: true,
      electricityMode: 'SHARED',
      electricityRate: 9,
      noticePeriodDays: 30,
      amenities: ['WiFi', 'Three meals', 'Power backup', 'CCTV', 'Hot water'],
      rules: RULE_SUGGESTIONS.slice(0, 3),
    },
  })

  const values = form.watch()
  const theme = PROPERTY_THEMES[values.type]

  // Derive the short code from the name until the owner types their own.
  const [codeTouched, setCodeTouched] = React.useState(editing)
  React.useEffect(() => {
    if (codeTouched || !values.name) return
    const auto = values.name
      .split(/\s+/)
      .map((w) => w[0])
      .join('')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 4)
    form.setValue('code', auto)
  }, [values.name, codeTouched, form])

  const subscription = React.useMemo(() => {
    if (!plan) return null
    let raw = 0
    let explanation = ''
    if (plan.pricingBasis === 'STANDARD_RENT') {
      raw = Math.round((values.standardRent * plan.multiplier) / 100)
      explanation = `${plan.multiplier}% of the standard rent (${formatMoney(values.standardRent || 0)})`
    } else if (plan.pricingBasis === 'PER_BED') {
      explanation = `${formatMoney(plan.perBedPrice)} per bed, once beds are added`
      raw = plan.minAmount
    } else {
      raw = plan.flatPrice
      explanation = 'Flat monthly fee'
    }
    const amount = Math.min(plan.maxAmount, Math.max(plan.minAmount, raw))
    return { amount, explanation, clamped: amount !== raw }
  }, [plan, values.standardRent])

  function addTag(field: 'amenities' | 'rules', value: string) {
    const trimmed = value.trim()
    if (!trimmed) return
    const current = form.getValues(field)
    if (current.includes(trimmed)) return
    form.setValue(field, [...current, trimmed])
  }

  function removeTag(field: 'amenities' | 'rules', value: string) {
    form.setValue(
      field,
      form.getValues(field).filter((v) => v !== value),
    )
  }

  async function onSubmit(data: Values) {
    if (property) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { code, ...changes } = data
        const result = await api.patch<{ message: string }>(
          `/api/properties/${property.id}`,
          changes,
        )
        toast.success('PG updated', result.message)
        router.push(`/app/properties/${property.id}`)
        router.refresh()
      } catch (error) {
        toast.error(
          'Unable to save this PG',
          error instanceof ApiError ? error.message : 'Please try again.',
        )
      }
      return
    }
    try {
      const result = await api.post<{
        property: { id: string; name: string }
        subscription: { amount: number; plan: string; explanation: string }
        message: string
      }>('/api/properties', data)
      toast.success('PG created successfully', result.message)
      router.push(`/app/properties/${result.property.id}`)
      router.refresh()
    } catch (error) {
      toast.error(
        'Unable to create this PG',
        error instanceof ApiError ? error.message : 'Please try again.',
      )
    }
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-5 lg:grid-cols-[1fr_320px]">
      <div className="space-y-5">
        {/* -------------------------------------------------- Identity */}
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-sm">The property</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
              <Field label="PG name" required error={form.formState.errors.name?.message}>
                <Input placeholder="StayFlow Men's Residence" {...form.register('name')} />
              </Field>
              <Field
                label="Short code"
                required
                hint={editing ? 'Fixed — used in issued invoice numbers' : 'Used in invoice numbers'}
                error={form.formState.errors.code?.message}
              >
                <Input
                  placeholder="SFM"
                  maxLength={8}
                  readOnly={editing}
                  className={editing ? 'bg-slate-50 text-slate-500' : undefined}
                  {...form.register('code')}
                  onInput={() => setCodeTouched(true)}
                />
              </Field>
            </div>

            <Field label="PG type" required>
              <div className="grid gap-2 sm:grid-cols-3">
                {(['MENS', 'WOMENS', 'COLIVE'] as const).map((type) => {
                  const t = PROPERTY_THEMES[type]
                  const active = values.type === type
                  return (
                    <button
                      key={type}
                      type="button"
                      onClick={() => form.setValue('type', type)}
                      className={cn(
                        'flex items-center gap-2.5 rounded-xl border p-3 text-left transition-all',
                        active
                          ? cn(t.border, t.bg, 'ring-2', t.ring)
                          : 'border-slate-200 hover:border-slate-300',
                      )}
                    >
                      <span className={cn('size-3 shrink-0 rounded-full', t.bgSolid)} />
                      <span className="min-w-0">
                        <span
                          className={cn(
                            'block text-sm font-medium',
                            active ? t.text : 'text-slate-700',
                          )}
                        >
                          {t.label}
                        </span>
                        <span className="block text-[11px] text-slate-500">
                          {type === 'MENS'
                            ? 'Blue theme'
                            : type === 'WOMENS'
                              ? 'Pink theme'
                              : 'Violet theme'}
                        </span>
                      </span>
                      {active && <Check className={cn('ml-auto size-4', t.text)} />}
                    </button>
                  )
                })}
              </div>
            </Field>

            <Field label="Address" required error={form.formState.errors.addressLine?.message}>
              <Input placeholder="No. 42, 2nd Main Road, Thoraipakkam" {...form.register('addressLine')} />
            </Field>

            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="City" required error={form.formState.errors.city?.message}>
                <Input {...form.register('city')} />
              </Field>
              <Field label="State" required error={form.formState.errors.state?.message}>
                <Input {...form.register('state')} />
              </Field>
              <Field label="PIN code" required error={form.formState.errors.pincode?.message}>
                <Input inputMode="numeric" maxLength={6} {...form.register('pincode')} />
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Contact person">
                <Input {...form.register('contactName')} />
              </Field>
              <Field label="Contact number" error={form.formState.errors.contactPhone?.message}>
                <Input inputMode="tel" {...form.register('contactPhone')} />
              </Field>
            </div>

            <Field label="Description" hint="Shown to residents in their app">
              <Textarea rows={2} {...form.register('description')} />
            </Field>
          </CardContent>
        </Card>

        {/* ----------------------------------------------------- Money */}
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-sm">Rent & charges</CardTitle>
            <p className="text-xs text-slate-500">
              These become the defaults for every resident checked into this PG. Individual
              residents can still be given a different rent.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Standard monthly rent"
                required
                error={form.formState.errors.standardRent?.message}
              >
                <Input type="number" inputMode="numeric" {...form.register('standardRent')} />
              </Field>
              <Field label="Standard deposit" required>
                <Input type="number" inputMode="numeric" {...form.register('standardDeposit')} />
              </Field>
              <Field label="Maintenance (per month)">
                <Input type="number" inputMode="numeric" {...form.register('maintenanceFee')} />
              </Field>
              <Field label="Notice period (days)">
                <Input type="number" inputMode="numeric" {...form.register('noticePeriodDays')} />
              </Field>
            </div>

            <div className="rounded-xl border border-slate-200 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-800">Food included</p>
                  <p className="text-xs text-slate-500">
                    Creates a default full-board plan for this PG.
                  </p>
                </div>
                <Switch
                  checked={values.foodIncluded}
                  onCheckedChange={(c) => form.setValue('foodIncluded', c)}
                />
              </div>
              {values.foodIncluded && (
                <div className="mt-3">
                  <Field label="Food charge (per month)">
                    <Input type="number" inputMode="numeric" {...form.register('foodCharge')} />
                  </Field>
                </div>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Electricity">
                <Select {...form.register('electricityMode')}>
                  <option value="INCLUDED">Included in rent</option>
                  <option value="SHARED">Shared across residents</option>
                  <option value="METERED">Metered per room</option>
                </Select>
              </Field>
              {values.electricityMode !== 'INCLUDED' && (
                <Field label="Rate per unit">
                  <Input type="number" inputMode="numeric" {...form.register('electricityRate')} />
                </Field>
              )}
            </div>
          </CardContent>
        </Card>

        {/* ------------------------------------------- Amenities & rules */}
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-sm">Amenities & house rules</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <TagEditor
              label="Amenities"
              values={values.amenities}
              suggestions={AMENITY_SUGGESTIONS}
              input={amenityInput}
              onInput={setAmenityInput}
              onAdd={(v) => {
                addTag('amenities', v)
                setAmenityInput('')
              }}
              onRemove={(v) => removeTag('amenities', v)}
            />
            <TagEditor
              label="House rules"
              values={values.rules}
              suggestions={RULE_SUGGESTIONS}
              input={ruleInput}
              onInput={setRuleInput}
              onAdd={(v) => {
                addTag('rules', v)
                setRuleInput('')
              }}
              onRemove={(v) => removeTag('rules', v)}
            />
          </CardContent>
        </Card>
      </div>

      {/* ---------------------------------------------------- Sidebar */}
      <div className="space-y-4">
        <Card className="overflow-hidden lg:sticky lg:top-24">
          <div className={cn('h-1', theme.bgSolid)} />
          <CardContent className="space-y-4 p-5">
            <div className="flex items-center gap-2.5">
              <div className={cn('flex size-9 items-center justify-center rounded-xl', theme.bg)}>
                <Building2 className={cn('size-4', theme.text)} />
              </div>
              <div className="min-w-0">
                <p className="truncate font-display text-sm font-semibold text-slate-900">
                  {values.name || 'Your new PG'}
                </p>
                <p className="text-xs text-slate-500">
                  {theme.label} · {values.city || 'city'}
                </p>
              </div>
            </div>

            <div className="space-y-2 border-t border-slate-100 pt-3 text-sm">
              <Row label="Standard rent" value={formatMoney(values.standardRent || 0)} />
              <Row label="Deposit" value={formatMoney(values.standardDeposit || 0)} />
              {values.foodIncluded && (
                <Row label="Food" value={formatMoney(values.foodCharge || 0)} />
              )}
            </div>

            {!editing && subscription && plan && (
              <motion.div
                layout
                className="rounded-xl border border-blue-100 bg-blue-50/70 p-4"
              >
                <p className="flex items-center gap-1.5 text-xs font-semibold text-blue-800">
                  <Sparkles className="size-3.5" />
                  StayFlow subscription
                </p>
                <p className="mt-1.5 font-display text-2xl font-semibold text-blue-900 tabular">
                  {formatMoney(subscription.amount)}
                  <span className="text-sm font-medium text-blue-700">/month</span>
                </p>
                <p className="mt-1 text-xs leading-relaxed text-blue-800/80">
                  {plan.name} plan · {subscription.explanation}
                  {subscription.clamped && ' (adjusted to the plan limits)'}
                </p>
                {plan.trialDays > 0 && (
                  <p className="mt-2 rounded-lg bg-white/70 px-2 py-1 text-[11px] font-medium text-blue-900">
                    {plan.trialDays}-day free trial before the first charge
                  </p>
                )}
                {existingCount > 0 && (
                  <p className="mt-2 text-[11px] text-blue-800/70">
                    This is PG number {existingCount + 1}. Each PG is billed separately.
                  </p>
                )}
              </motion.div>
            )}

            <Button
              type="submit"
              variant={values.type === 'WOMENS' ? 'pink' : 'primary'}
              size="lg"
              className="w-full"
              loading={form.formState.isSubmitting}
            >
              <Building2 className="size-4" />
              {editing ? 'Save changes' : 'Create this PG'}
            </Button>
            <p className="text-center text-[11px] text-slate-400">
              {editing
                ? 'Changing the standard rent may change this PG’s subscription price.'
                : 'You can add floors, rooms and beds on the next screen.'}
            </p>
          </CardContent>
        </Card>
      </div>
    </form>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium text-slate-800 tabular">{value}</span>
    </div>
  )
}

function TagEditor({
  label,
  values,
  suggestions,
  input,
  onInput,
  onAdd,
  onRemove,
}: {
  label: string
  values: string[]
  suggestions: string[]
  input: string
  onInput: (value: string) => void
  onAdd: (value: string) => void
  onRemove: (value: string) => void
}) {
  const unused = suggestions.filter((s) => !values.includes(s))
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-slate-700">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {values.map((value) => (
          <span
            key={value}
            className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 py-1 pl-2.5 pr-1 text-xs text-slate-700"
          >
            {value}
            <button
              type="button"
              onClick={() => onRemove(value)}
              aria-label={`Remove ${value}`}
              className="rounded-full p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-600"
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
        {values.length === 0 && <p className="text-xs text-slate-400">None added yet.</p>}
      </div>
      <div className="flex gap-2">
        <Input
          value={input}
          onChange={(e) => onInput(e.target.value)}
          placeholder={`Add ${label.toLowerCase()}`}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              onAdd(input)
            }
          }}
        />
        <Button type="button" variant="outline" size="icon" onClick={() => onAdd(input)}>
          <Plus className="size-4" />
        </Button>
      </div>
      {unused.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {unused.slice(0, 8).map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => onAdd(suggestion)}
              className="rounded-full border border-dashed border-slate-300 px-2.5 py-0.5 text-[11px] text-slate-500 transition-colors hover:border-blue-300 hover:text-blue-600"
            >
              + {suggestion}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
