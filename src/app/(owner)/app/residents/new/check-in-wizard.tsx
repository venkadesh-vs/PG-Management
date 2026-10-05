'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowLeft,
  ArrowRight,
  Bed,
  BadgeCheck,
  Building2,
  Check,
  CircleCheck,
  FileText,
  IdCard,
  Loader2,
  Sparkles,
  UserRound,
  Users,
  Utensils,
  Wallet,
} from 'lucide-react'
import { checkInSchema, type CheckInValues } from '@/lib/validation'
import { api, ApiError } from '@/lib/client'
import { cn, formatMoney, toISODate } from '@/lib/utils'
import { BED_STATUS_STYLE, themeFor } from '@/lib/theme'
import { useToast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { Field, Input, Select, Textarea } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox, Progress, Switch } from '@/components/ui/primitives'
import { EmptyState } from '@/components/ui/feedback'
import { InviteLinkPanel, type AccessLink } from '@/components/app/invite-link'

type PropertyOption = {
  id: string
  name: string
  type: 'MENS' | 'WOMENS' | 'COLIVE'
  standardRent: number
  standardDeposit: number
  maintenanceFee: number
  foodCharge: number
  foodIncluded: boolean
  foodPlans: { id: string; name: string; monthlyCharge: number; isDefault: boolean }[]
}

type LookupOption = { value: string; label: string }

type BedOption = {
  id: string
  label: string
  status: 'AVAILABLE' | 'OCCUPIED' | 'RESERVED' | 'MAINTENANCE' | 'BLOCKED'
  rent: number | null
  resident: { id: string; fullName: string } | null
}

type RoomOption = {
  id: string
  number: string
  type: string
  capacity: number
  baseRent: number | null
  hasAC: boolean
  beds: BedOption[]
}

type FloorOption = { id: string; name: string; level: number; rooms: RoomOption[] }

/** What POST /api/residents returns once the check-in transaction commits. */
type CheckInResult = {
  resident: { id: string; code: string; fullName: string }
  bed: { label: string; room: string }
  invoice: { number: string; total: number } | null
  tenantLogin: AccessLink | null
}

const STEPS = [
  { title: 'Personal', description: 'Who is moving in', icon: UserRound },
  { title: 'Guardian', description: 'Emergency contact', icon: Users },
  { title: 'KYC', description: 'ID and occupation', icon: IdCard },
  { title: 'Room & bed', description: 'Where they will stay', icon: Bed },
  { title: 'Rent & food', description: 'What they will pay', icon: Wallet },
  { title: 'Review', description: 'Confirm check-in', icon: BadgeCheck },
] as const

/** Which fields each step owns, so "Continue" validates only that step. */
const STEP_FIELDS: (keyof CheckInValues)[][] = [
  ['fullName', 'phone', 'whatsappPhone', 'email', 'dateOfBirth', 'bloodGroup', 'qualification'],
  ['guardianName', 'guardianRelation', 'guardianPhone', 'permanentAddress', 'city', 'pincode'],
  ['idType', 'idNumber', 'occupationType', 'companyName', 'designation'],
  ['propertyId', 'bedId', 'joiningDate'],
  ['rentAmount', 'depositAmount', 'maintenanceFee', 'foodCharge', 'rentDueDay'],
  [],
]

export function CheckInWizard({
  properties,
  defaultPropertyId,
  defaultBedId,
  rentDueDay,
  idTypes,
  relations,
  foodEnabled = true,
}: {
  /** The org's ID_TYPE lookup list. */
  idTypes: LookupOption[]
  /** The org's GUARDIAN_RELATION lookup list. */
  relations: LookupOption[]
  /** False when the Food module is switched off. */
  foodEnabled?: boolean
  properties: PropertyOption[]
  defaultPropertyId: string
  defaultBedId?: string
  rentDueDay: number
}) {
  const router = useRouter()
  const toast = useToast()
  const [step, setStep] = React.useState(0)
  const [floors, setFloors] = React.useState<FloorOption[]>([])
  const [loadingBeds, setLoadingBeds] = React.useState(false)
  const [done, setDone] = React.useState<CheckInResult | null>(null)

  const defaultProperty = properties.find((p) => p.id === defaultPropertyId) ?? properties[0]

  const form = useForm<CheckInValues>({
    resolver: zodResolver(checkInSchema),
    mode: 'onBlur',
    defaultValues: {
      fullName: '',
      phone: '',
      whatsappPhone: '',
      email: '',
      dateOfBirth: '',
      gender: '',
      bloodGroup: '',
      qualification: '',
      guardianName: '',
      guardianRelation: relations[0]?.value ?? '',
      guardianPhone: '',
      guardianAddress: '',
      permanentAddress: '',
      city: '',
      state: 'Tamil Nadu',
      pincode: '',
      idType: idTypes[0]?.value ?? '',
      idNumber: '',
      occupationType: 'WORKING',
      companyName: '',
      companyAddress: '',
      designation: '',
      propertyId: defaultProperty.id,
      bedId: defaultBedId ?? '',
      joiningDate: toISODate(new Date()),
      rentAmount: defaultProperty.standardRent,
      depositAmount: defaultProperty.standardDeposit,
      maintenanceFee: defaultProperty.maintenanceFee,
      foodOptIn: foodEnabled,
      foodCharge: defaultProperty.foodCharge,
      foodPlanId: defaultProperty.foodPlans.find((p) => p.isDefault)?.id ?? '',
      rentDueDay,
      discountAmount: 0,
      discountNote: '',
      depositCollected: true,
      createTenantAccount: true,
      whatsappConsent: true,
      notes: '',
    },
  })

  const values = form.watch()
  const property = properties.find((p) => p.id === values.propertyId) ?? defaultProperty
  const theme = themeFor(property.type)

  // Load the bed map whenever the chosen PG changes.
  React.useEffect(() => {
    let cancelled = false
    setLoadingBeds(true)
    api
      .get<{ floors: FloorOption[] }>(`/api/rooms?propertyId=${values.propertyId}`)
      .then((data) => {
        if (!cancelled) setFloors(data.floors)
      })
      .catch(() => {
        if (!cancelled) setFloors([])
      })
      .finally(() => {
        if (!cancelled) setLoadingBeds(false)
      })
    return () => {
      cancelled = true
    }
  }, [values.propertyId])

  // Property defaults flow into the money step — the owner can still override.
  function selectProperty(id: string) {
    const next = properties.find((p) => p.id === id)
    if (!next) return
    form.setValue('propertyId', id)
    form.setValue('bedId', '')
    form.setValue('rentAmount', next.standardRent)
    form.setValue('depositAmount', next.standardDeposit)
    form.setValue('maintenanceFee', next.maintenanceFee)
    form.setValue('foodCharge', next.foodCharge)
    form.setValue('foodPlanId', next.foodPlans.find((p) => p.isDefault)?.id ?? '')
  }

  function selectBed(bed: BedOption, room: RoomOption) {
    if (bed.status === 'OCCUPIED') {
      toast.warning('This bed is already occupied', `${bed.resident?.fullName} is staying here.`)
      return
    }
    if (bed.status === 'MAINTENANCE' || bed.status === 'BLOCKED') {
      toast.warning(`Bed marked ${bed.status.toLowerCase()}`, 'Free it up from the bed map first.')
      return
    }
    form.setValue('bedId', bed.id, { shouldValidate: true })
    const rent = bed.rent ?? room.baseRent ?? property.standardRent
    form.setValue('rentAmount', rent)
    toast.success('Bed selected', `Room ${room.number} · Bed ${bed.label} — ${formatMoney(rent)}/month`)
  }

  async function next() {
    const fields = STEP_FIELDS[step]
    const valid = fields.length ? await form.trigger(fields) : true
    if (!valid) {
      toast.error('Check the highlighted fields', 'A few details still need filling in.')
      return
    }
    setStep((s) => Math.min(s + 1, STEPS.length - 1))
  }

  async function onSubmit(data: CheckInValues) {
    try {
      const result = await api.post<CheckInResult>('/api/residents', data)
      setDone(result)
      toast.success(
        'Resident checked in successfully',
        `${data.fullName} is now in Room ${result?.bed.room}, Bed ${result?.bed.label}.`,
      )
      router.refresh()
    } catch (error) {
      const message = error instanceof ApiError ? error.message : 'Unable to check in right now'
      toast.error('Check-in failed', message)
      if (message.toLowerCase().includes('bed')) setStep(3)
    }
  }

  if (done) return <SuccessPanel result={done} onAddAnother={() => window.location.reload()} />

  const selectedBed = floors
    .flatMap((f) => f.rooms)
    .flatMap((r) => r.beds.map((b) => ({ bed: b, room: r })))
    .find((entry) => entry.bed.id === values.bedId)

  const monthlyTotal =
    (values.rentAmount || 0) +
    (values.maintenanceFee || 0) +
    (values.foodOptIn ? values.foodCharge || 0 : 0) -
    (values.discountAmount || 0)

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-6 lg:grid-cols-[260px_1fr]">
      {/* --------------------------------------------------- Step rail */}
      <div className="space-y-4">
        <Card className="overflow-hidden">
          <div className={cn('h-1.5 bg-gradient-to-r', theme.gradient)} />
          <CardContent className="p-4">
            <Progress
              value={((step + 1) / STEPS.length) * 100}
              indicatorClass={theme.bgSolid}
              className="mb-4"
            />
            <ol className="space-y-1">
              {STEPS.map((s, i) => {
                const active = i === step
                const complete = i < step
                return (
                  <li key={s.title}>
                    <button
                      type="button"
                      onClick={() => i <= step && setStep(i)}
                      disabled={i > step}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors',
                        active && 'bg-slate-100',
                        i > step && 'cursor-not-allowed opacity-50',
                        i < step && 'hover:bg-slate-50',
                      )}
                    >
                      <span
                        className={cn(
                          'flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors',
                          complete
                            ? 'bg-emerald-500 text-white'
                            : active
                              ? cn(theme.bgSolid, 'text-white')
                              : 'bg-slate-100 text-slate-400',
                        )}
                      >
                        {complete ? <Check className="size-3.5" strokeWidth={3} /> : i + 1}
                      </span>
                      <span className="min-w-0">
                        <span
                          className={cn(
                            'block truncate text-sm font-medium',
                            active ? 'text-slate-900' : 'text-slate-600',
                          )}
                        >
                          {s.title}
                        </span>
                        <span className="block truncate text-[11px] text-slate-400">
                          {s.description}
                        </span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ol>
          </CardContent>
        </Card>

        {/* Live summary — the owner always sees what they are committing to. */}
        <Card className="hidden lg:block">
          <CardContent className="space-y-2.5 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Summary</p>
            <SummaryRow label="PG" value={property.name} />
            <SummaryRow
              label="Bed"
              value={
                selectedBed
                  ? `Room ${selectedBed.room.number} · ${selectedBed.bed.label}`
                  : 'Not selected'
              }
            />
            <SummaryRow label="Rent" value={formatMoney(values.rentAmount || 0)} />
            {values.foodOptIn && (values.foodCharge || 0) > 0 && (
              <SummaryRow label="Food" value={formatMoney(values.foodCharge || 0)} />
            )}
            {(values.maintenanceFee || 0) > 0 && (
              <SummaryRow label="Maintenance" value={formatMoney(values.maintenanceFee || 0)} />
            )}
            {(values.discountAmount || 0) > 0 && (
              <SummaryRow label="Discount" value={`− ${formatMoney(values.discountAmount || 0)}`} />
            )}
            <div className="flex items-center justify-between border-t border-slate-100 pt-2">
              <span className="text-xs font-semibold text-slate-600">Monthly</span>
              <span className={cn('font-display text-base font-semibold tabular', theme.text)}>
                {formatMoney(monthlyTotal)}
              </span>
            </div>
            <SummaryRow label="Deposit" value={formatMoney(values.depositAmount || 0)} />
          </CardContent>
        </Card>
      </div>

      {/* ------------------------------------------------------- Steps */}
      <Card className="min-h-[520px]">
        <CardContent className="p-5 sm:p-6">
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -12 }}
              transition={{ duration: 0.22 }}
            >
              <StepHeading step={STEPS[step]} index={step} />

              {/* ---------------------------------------- Step 1 personal */}
              {step === 0 && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field
                    className="sm:col-span-2"
                    label="Full name"
                    required
                    error={form.formState.errors.fullName?.message}
                  >
                    <Input placeholder="As on the ID proof" {...form.register('fullName')} />
                  </Field>
                  <Field label="Mobile number" required error={form.formState.errors.phone?.message}>
                    <Input placeholder="10-digit number" inputMode="tel" {...form.register('phone')} />
                  </Field>
                  <Field
                    label="WhatsApp number"
                    hint="Rent reminders go here. Leave blank to use the mobile number."
                    error={form.formState.errors.whatsappPhone?.message}
                  >
                    <Input placeholder="Same as mobile" inputMode="tel" {...form.register('whatsappPhone')} />
                  </Field>
                  <Field label="Email" error={form.formState.errors.email?.message} hint="Used as their app login">
                    <Input type="email" placeholder="name@example.com" {...form.register('email')} />
                  </Field>
                  <Field label="Date of birth">
                    <Input type="date" {...form.register('dateOfBirth')} />
                  </Field>
                  <Field label="Blood group">
                    <Select {...form.register('bloodGroup')}>
                      <option value="">Select</option>
                      {['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-'].map((g) => (
                        <option key={g} value={g}>
                          {g}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Qualification">
                    <Input placeholder="B.E Computer Science" {...form.register('qualification')} />
                  </Field>
                </div>
              )}

              {/* ---------------------------------------- Step 2 guardian */}
              {step === 1 && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Guardian name">
                    <Input placeholder="Parent or guardian" {...form.register('guardianName')} />
                  </Field>
                  <Field label="Relationship">
                    <Select {...form.register('guardianRelation')}>
                      {relations.map((r) => (
                        <option key={r.value} value={r.value}>
                          {r.label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field
                    label="Guardian mobile"
                    error={form.formState.errors.guardianPhone?.message}
                    hint="Called only in an emergency"
                  >
                    <Input inputMode="tel" {...form.register('guardianPhone')} />
                  </Field>
                  <Field label="City" error={form.formState.errors.city?.message}>
                    <Input placeholder="Home town" {...form.register('city')} />
                  </Field>
                  <Field className="sm:col-span-2" label="Permanent address">
                    <Textarea rows={3} placeholder="House number, street, area" {...form.register('permanentAddress')} />
                  </Field>
                  <Field label="State">
                    <Input {...form.register('state')} />
                  </Field>
                  <Field label="PIN code" error={form.formState.errors.pincode?.message}>
                    <Input inputMode="numeric" maxLength={6} {...form.register('pincode')} />
                  </Field>
                </div>
              )}

              {/* --------------------------------------------- Step 3 KYC */}
              {step === 2 && (
                <div className="space-y-5">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="ID type">
                      <Select {...form.register('idType')}>
                        {idTypes.map(({ value, label }) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="ID number" hint="Stored masked in lists and receipts">
                      <Input placeholder="XXXX XXXX 1234" {...form.register('idNumber')} />
                    </Field>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Occupation">
                      <Select {...form.register('occupationType')}>
                        <option value="WORKING">Working professional</option>
                        <option value="STUDENT">Student</option>
                        <option value="OTHER">Other</option>
                      </Select>
                    </Field>
                    <Field label={values.occupationType === 'STUDENT' ? 'College' : 'Company'}>
                      <Input
                        placeholder={values.occupationType === 'STUDENT' ? 'Anna University' : 'Zoho Corporation'}
                        {...form.register('companyName')}
                      />
                    </Field>
                    {values.occupationType !== 'STUDENT' && (
                      <Field label="Designation">
                        <Input placeholder="Software Engineer" {...form.register('designation')} />
                      </Field>
                    )}
                    <Field
                      className="sm:col-span-2"
                      label={values.occupationType === 'STUDENT' ? 'College address' : 'Office address'}
                    >
                      <Input placeholder="Area, city" {...form.register('companyAddress')} />
                    </Field>
                  </div>

                  <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 p-4">
                    <div className="flex items-start gap-3">
                      <FileText className="mt-0.5 size-5 shrink-0 text-slate-400" />
                      <div>
                        <p className="text-sm font-medium text-slate-800">Documents</p>
                        <p className="mt-0.5 text-sm text-slate-500">
                          This demo does not upload files to cloud storage. Document records are
                          created against the resident so you can see the KYC workflow; connect an
                          S3-compatible bucket to store the real files.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* -------------------------------------- Step 4 room & bed */}
              {step === 3 && (
                <div className="space-y-5">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="PG" required>
                      <Select
                        value={values.propertyId}
                        onChange={(e) => selectProperty(e.target.value)}
                      >
                        {properties.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Joining date" required error={form.formState.errors.joiningDate?.message}>
                      <Input type="date" {...form.register('joiningDate')} />
                    </Field>
                  </div>

                  {form.formState.errors.bedId && (
                    <p className="text-xs font-medium text-red-600">
                      {form.formState.errors.bedId.message}
                    </p>
                  )}

                  <div className="flex flex-wrap items-center gap-3 text-xs">
                    {(['AVAILABLE', 'OCCUPIED', 'RESERVED', 'MAINTENANCE'] as const).map((s) => (
                      <span key={s} className="flex items-center gap-1.5 text-slate-500">
                        <span className={cn('size-2 rounded-full', BED_STATUS_STYLE[s].dot)} />
                        {BED_STATUS_STYLE[s].label}
                      </span>
                    ))}
                  </div>

                  {loadingBeds ? (
                    <div className="flex items-center justify-center py-12 text-sm text-slate-500">
                      <Loader2 className="mr-2 size-4 animate-spin" /> Loading the bed map…
                    </div>
                  ) : floors.length === 0 ? (
                    <EmptyState
                      icon={Bed}
                      title="No rooms in this PG yet"
                      description="Add floors, rooms and beds before checking anyone in."
                      action={
                        <Button variant="outline" size="sm" asChild>
                          <a href={`/app/properties/${values.propertyId}`}>Set up rooms</a>
                        </Button>
                      }
                    />
                  ) : (
                    <div className="max-h-[420px] space-y-5 overflow-y-auto pr-1 scrollbar-slim">
                      {floors.map((floor) => (
                        <div key={floor.id} className="space-y-2">
                          <p className="sticky top-0 z-10 bg-white py-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
                            {floor.name}
                          </p>
                          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                            {floor.rooms.map((room) => (
                              <div
                                key={room.id}
                                className="rounded-xl border border-slate-200 bg-white p-3"
                              >
                                <div className="mb-2 flex items-center justify-between">
                                  <p className="text-sm font-semibold text-slate-800">
                                    Room {room.number}
                                  </p>
                                  <span className="text-[11px] text-slate-400">
                                    {room.type.toLowerCase()}
                                    {room.hasAC ? ' · AC' : ''}
                                  </span>
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                  {room.beds.map((bed) => {
                                    const selected = values.bedId === bed.id
                                    const style = BED_STATUS_STYLE[bed.status]
                                    return (
                                      <button
                                        key={bed.id}
                                        type="button"
                                        onClick={() => selectBed(bed, room)}
                                        title={
                                          bed.resident
                                            ? `${bed.resident.fullName}`
                                            : `${style.label} — ${formatMoney(bed.rent ?? room.baseRent ?? property.standardRent)}`
                                        }
                                        className={cn(
                                          'flex size-10 items-center justify-center rounded-lg border text-sm font-semibold transition-all',
                                          style.tile,
                                          style.tileText,
                                          selected &&
                                            cn('ring-2 ring-offset-1', theme.ring, theme.bgSolid, 'text-white border-transparent'),
                                        )}
                                      >
                                        {selected ? <Check className="size-4" strokeWidth={3} /> : bed.label}
                                      </button>
                                    )
                                  })}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* ------------------------------------- Step 5 rent & food */}
              {step === 4 && (
                <div className="space-y-5">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Monthly rent" required error={form.formState.errors.rentAmount?.message}>
                      <Input type="number" inputMode="numeric" {...form.register('rentAmount')} />
                    </Field>
                    <Field label="Security deposit" required error={form.formState.errors.depositAmount?.message}>
                      <Input type="number" inputMode="numeric" {...form.register('depositAmount')} />
                    </Field>
                    <Field label="Maintenance (per month)">
                      <Input type="number" inputMode="numeric" {...form.register('maintenanceFee')} />
                    </Field>
                    <Field label="Rent due day" hint="Day of the month the invoice falls due">
                      <Select {...form.register('rentDueDay')}>
                        {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                          <option key={d} value={d}>
                            {d}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  </div>

                  {foodEnabled && (
                  <div className="rounded-2xl border border-slate-200 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-start gap-3">
                        <Utensils className="mt-0.5 size-5 text-orange-500" />
                        <div>
                          <p className="text-sm font-medium text-slate-800">Food plan</p>
                          <p className="text-xs text-slate-500">
                            Adds them to the daily meal count automatically.
                          </p>
                        </div>
                      </div>
                      <Switch
                        checked={values.foodOptIn}
                        onCheckedChange={(checked) => form.setValue('foodOptIn', checked)}
                      />
                    </div>
                    {values.foodOptIn && (
                      <div className="mt-4 grid gap-4 sm:grid-cols-2">
                        <Field label="Plan">
                          <Select {...form.register('foodPlanId')}>
                            {property.foodPlans.length === 0 && <option value="">No plans set up</option>}
                            {property.foodPlans.map((plan) => (
                              <option key={plan.id} value={plan.id}>
                                {plan.name} — {formatMoney(plan.monthlyCharge)}
                              </option>
                            ))}
                          </Select>
                        </Field>
                        <Field label="Food charge (per month)">
                          <Input type="number" inputMode="numeric" {...form.register('foodCharge')} />
                        </Field>
                      </div>
                    )}
                  </div>
                  )}

                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Discount (per month)" hint="Applied to every invoice">
                      <Input type="number" inputMode="numeric" {...form.register('discountAmount')} />
                    </Field>
                    <Field label="Discount reason">
                      <Input placeholder="Long-stay discount" {...form.register('discountNote')} />
                    </Field>
                  </div>

                  <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
                    <Checkbox
                      checked={values.depositCollected}
                      onCheckedChange={(checked) => form.setValue('depositCollected', checked === true)}
                      className="mt-0.5"
                    />
                    <span>
                      <span className="block text-sm font-medium text-slate-800">
                        Deposit collected today
                      </span>
                      <span className="block text-xs text-slate-500">
                        Creates the receipt and the deposit ledger entry now. Leave unticked to
                        collect later.
                      </span>
                    </span>
                  </label>
                </div>
              )}

              {/* ------------------------------------------ Step 6 review */}
              {step === 5 && (
                <div className="space-y-5">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <ReviewBlock
                      title="Resident"
                      rows={[
                        ['Name', values.fullName],
                        ['Mobile', values.phone],
                        ['WhatsApp', values.whatsappPhone || values.phone],
                        ['Email', values.email || '—'],
                        ['Guardian', values.guardianName ? `${values.guardianName} (${labelOf(relations, values.guardianRelation)})` : '—'],
                        ['ID', values.idNumber ? `${labelOf(idTypes, values.idType)} · ${values.idNumber}` : 'Not provided'],
                      ]}
                    />
                    <ReviewBlock
                      title="Placement"
                      rows={[
                        ['PG', property.name],
                        [
                          'Room / bed',
                          selectedBed
                            ? `Room ${selectedBed.room.number} · Bed ${selectedBed.bed.label}`
                            : 'Not selected',
                        ],
                        ['Joining date', values.joiningDate],
                        ['Rent due day', `${values.rentDueDay} of every month`],
                      ]}
                    />
                  </div>

                  <div className={cn('rounded-2xl border p-4', theme.border, theme.bg)}>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Monthly charges
                    </p>
                    <div className="mt-2 space-y-1.5">
                      <ChargeRow label="Room rent" value={values.rentAmount || 0} />
                      {(values.maintenanceFee || 0) > 0 && (
                        <ChargeRow label="Maintenance" value={values.maintenanceFee || 0} />
                      )}
                      {values.foodOptIn && (values.foodCharge || 0) > 0 && (
                        <ChargeRow label="Food plan" value={values.foodCharge || 0} />
                      )}
                      {(values.discountAmount || 0) > 0 && (
                        <ChargeRow label="Discount" value={-(values.discountAmount || 0)} />
                      )}
                      <div className="flex items-center justify-between border-t border-white/60 pt-1.5">
                        <span className="text-sm font-semibold text-slate-700">Total per month</span>
                        <span className={cn('font-display text-lg font-semibold tabular', theme.text)}>
                          {formatMoney(monthlyTotal)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-slate-500">
                          Security deposit {values.depositCollected ? '(collecting now)' : '(pending)'}
                        </span>
                        <span className="text-sm font-semibold text-slate-700 tabular">
                          {formatMoney(values.depositAmount || 0)}
                        </span>
                      </div>
                    </div>
                  </div>

                  <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-3">
                    <Checkbox
                      checked={values.createTenantAccount}
                      onCheckedChange={(checked) =>
                        form.setValue('createTenantAccount', checked === true)
                      }
                      className="mt-0.5"
                    />
                    <span>
                      <span className="block text-sm font-medium text-slate-800">
                        Create a resident app account
                      </span>
                      <span className="block text-xs text-slate-500">
                        They can pay rent, raise complaints and see the menu themselves. We send
                        them a link to set their own password.
                      </span>
                    </span>
                  </label>

                  <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-3">
                    <Checkbox
                      checked={values.whatsappConsent}
                      onCheckedChange={(checked) =>
                        form.setValue('whatsappConsent', checked === true)
                      }
                      className="mt-0.5"
                    />
                    <span>
                      <span className="block text-sm font-medium text-slate-800">
                        Resident agrees to receive rent reminders and updates on WhatsApp
                      </span>
                      <span className="block text-xs text-slate-500">
                        Ask them first. They can reply STOP at any time to opt out.
                      </span>
                    </span>
                  </label>

                  <Field label="Internal notes" hint="Only visible to you and your managers">
                    <Textarea rows={2} placeholder="Anything worth remembering" {...form.register('notes')} />
                  </Field>

                  <div className="rounded-2xl border border-blue-100 bg-blue-50/60 p-4">
                    <p className="flex items-center gap-2 text-sm font-semibold text-blue-900">
                      <Sparkles className="size-4" />
                      What happens when you press Check in
                    </p>
                    <ul className="mt-2 grid gap-1.5 text-sm text-blue-800/90 sm:grid-cols-2">
                      {[
                        'Bed marked occupied',
                        'Room, floor and PG occupancy updated',
                        'Rent schedule created from the joining date',
                        'First invoice generated and pro-rated',
                        'Deposit ledger opened',
                        values.foodOptIn ? 'Food plan activated' : 'No food plan',
                        values.createTenantAccount ? 'Resident app account created' : 'No app account',
                        values.whatsappConsent ? 'Welcome message queued' : 'No WhatsApp messages',
                      ].map((line) => (
                        <li key={line} className="flex items-start gap-1.5">
                          <CircleCheck className="mt-0.5 size-3.5 shrink-0" />
                          {line}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
            </motion.div>
          </AnimatePresence>

          {/* ------------------------------------------------ Navigation */}
          <div className="mt-8 flex items-center justify-between gap-3 border-t border-slate-100 pt-5">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setStep((s) => Math.max(0, s - 1))}
              disabled={step === 0}
            >
              <ArrowLeft className="size-4" />
              Back
            </Button>

            {step < STEPS.length - 1 ? (
              <Button type="button" variant="primary" onClick={next}>
                Continue
                <ArrowRight className="size-4" />
              </Button>
            ) : (
              <Button
                type="submit"
                variant={property.type === 'WOMENS' ? 'pink' : 'primary'}
                size="lg"
                loading={form.formState.isSubmitting}
              >
                {!form.formState.isSubmitting && <BadgeCheck className="size-4" />}
                Check in {values.fullName ? values.fullName.split(' ')[0] : 'resident'}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </form>
  )
}

function StepHeading({
  step,
  index,
}: {
  step: (typeof STEPS)[number]
  index: number
}) {
  const Icon = step.icon
  return (
    <div className="mb-6 flex items-start gap-3">
      <div className="flex size-10 items-center justify-center rounded-xl border border-slate-200 bg-slate-50">
        <Icon className="size-5 text-slate-500" />
      </div>
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          Step {index + 1} of {STEPS.length}
        </p>
        <h2 className="font-display text-lg font-semibold tracking-tight text-slate-900">
          {step.title}
        </h2>
      </div>
    </div>
  )
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 text-xs">
      <span className="text-slate-500">{label}</span>
      <span className="text-right font-medium text-slate-800">{value}</span>
    </div>
  )
}

function ChargeRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-slate-600">{label}</span>
      <span className="font-medium text-slate-800 tabular">{formatMoney(value)}</span>
    </div>
  )
}

function ReviewBlock({ title, rows }: { title: string; rows: [string, string][] }) {
  return (
    <div className="rounded-2xl border border-slate-200 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</p>
      <dl className="mt-2 space-y-1.5">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-start justify-between gap-3 text-sm">
            <dt className="shrink-0 text-slate-500">{label}</dt>
            <dd className="text-right font-medium text-slate-800">{value || '—'}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

function SuccessPanel({
  result,
  onAddAnother,
}: {
  result: CheckInResult
  onAddAnother: () => void
}) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: 'spring', stiffness: 260, damping: 24 }}
      className="mx-auto max-w-2xl"
    >
      <Card className="overflow-hidden">
        <div className="bg-gradient-to-br from-emerald-500 to-teal-600 p-8 text-center text-white">
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.15, type: 'spring', stiffness: 300, damping: 18 }}
            className="mx-auto flex size-16 items-center justify-center rounded-full bg-white/20 backdrop-blur"
          >
            <Check className="size-8" strokeWidth={3} />
          </motion.div>
          <h2 className="mt-4 font-display text-2xl font-semibold tracking-tight">
            {result.resident.fullName} is checked in
          </h2>
          <p className="mt-1 text-sm text-white/80">
            Room {result.bed.room} · Bed {result.bed.label} · {result.resident.code}
          </p>
        </div>

        <CardContent className="space-y-4 p-6">
          <p className="text-sm font-semibold text-slate-700">Everything that just happened</p>
          <ul className="grid gap-2 sm:grid-cols-2">
            {[
              'Bed marked occupied',
              'PG occupancy recalculated',
              result.invoice
                ? `Invoice ${result.invoice.number} for ${formatMoney(result.invoice.total)}`
                : 'Rent schedule started',
              'Deposit ledger opened',
              'Food plan activated',
              result.tenantLogin?.sentVia.length
                ? 'Welcome and login link sent'
                : 'Welcome message queued',
            ].map((line) => (
              <li key={line} className="flex items-start gap-2 text-sm text-slate-600">
                <CircleCheck className="mt-0.5 size-4 shrink-0 text-emerald-500" />
                {line}
              </li>
            ))}
          </ul>

          {result.tenantLogin && (
            <InviteLinkPanel link={result.tenantLogin} title="Resident app login" />
          )}

          <div className="flex flex-wrap gap-2 pt-1">
            <Button variant="primary" asChild>
              <a href="/app/residents">
                <Users className="size-4" />
                View all residents
              </a>
            </Button>
            <Button variant="outline" onClick={onAddAnother}>
              Check in another
            </Button>
            <Button variant="ghost" asChild>
              <a href="/app">
                <Building2 className="size-4" />
                Back to dashboard
              </a>
            </Button>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  )
}

function labelOf(options: LookupOption[], value: string | undefined) {
  if (!value) return '—'
  return options.find((o) => o.value === value)?.label ?? value
}
