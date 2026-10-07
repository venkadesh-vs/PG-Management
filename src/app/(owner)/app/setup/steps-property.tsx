'use client'

import * as React from 'react'
import { BadgeCheck, Clock, MailWarning, Rocket } from 'lucide-react'
import { api } from '@/lib/client'
import { useToast } from '@/components/ui/toast'
import { Field, Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Choice, Note, PHONE_RE, StepFooter, StepHeading, hasErrors, type Errors, type StepContext } from './ui'
import { SHARING_OPTIONS } from './steps'

type Draft = {
  name?: string
  code?: string
  type?: 'MENS' | 'WOMENS' | 'COLIVE'
  addressLine?: string
  city?: string
  state?: string
  pincode?: string
  contactName?: string
  contactPhone?: string
}

/** Values typed before the PG exists live in onboardingData.answers.draft. */
function useDraft(ctx: StepContext): Draft {
  const p = ctx.snapshot.property
  const saved = (ctx.answers.draft ?? {}) as Draft
  if (!p) return saved
  return {
    name: p.name,
    code: p.code,
    type: p.type,
    addressLine: p.addressLine,
    city: p.city,
    state: p.state,
    pincode: p.pincode,
    contactName: p.contactName,
    contactPhone: p.contactPhone,
  }
}

function suggestCode(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean)
  const initials = words.map((w) => w[0]).join('')
  const base = (initials.length >= 2 ? initials : name.replace(/[^A-Za-z0-9]/g, '')).toUpperCase()
  return base.replace(/[^A-Z0-9]/g, '').slice(0, 6)
}

// ------------------------------------------------------------- welcome ----

export function WelcomeStep({ ctx }: { ctx: StepContext }) {
  const toast = useToast()
  const [busy, setBusy] = React.useState(false)
  const { owner } = ctx.snapshot
  const first = owner.name.split(' ')[0]

  async function start() {
    setBusy(true)
    try {
      await ctx.advance()
    } catch (error) {
      toast.fromError(error, 'start setup')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="space-y-3">
        <span className="inline-flex size-12 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
          <Rocket className="size-6" />
        </span>
        <h2 className="font-display text-2xl font-semibold text-slate-900">Welcome, {first}! Let’s get your PG live.</h2>
        <p className="text-sm leading-relaxed text-slate-500">
          We’ll walk you through your PG, rooms and beds, rent rules, payments and team. Most owners finish in
          30–60 minutes — and you can save and come back any time.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-slate-200 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Your account</p>
          <p className="mt-1 font-medium text-slate-900">{owner.name}</p>
          <p className="break-all text-sm text-slate-500">{owner.email}</p>
          {owner.phone && <p className="text-sm text-slate-500">{owner.phone}</p>}
          <p className="mt-2 flex items-center gap-1.5 text-xs font-medium">
            {owner.emailVerified ? (
              <>
                <BadgeCheck className="size-3.5 text-emerald-600" />
                <span className="text-emerald-700">Email verified</span>
              </>
            ) : (
              <>
                <MailWarning className="size-3.5 text-amber-600" />
                <span className="text-amber-700">Email not verified yet — check your inbox</span>
              </>
            )}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Have these handy</p>
          <ul className="mt-2 space-y-1.5 text-sm text-slate-600">
            <li>• PG address and a contact number</li>
            <li>• Floors and room numbers</li>
            <li>• Rent, deposit and food charges</li>
            <li>• Your UPI ID (optional)</li>
          </ul>
        </div>
      </div>

      <p className="flex items-center gap-1.5 text-xs text-slate-500">
        <Clock className="size-3.5" />
        Steps marked <span className="font-semibold text-blue-700">Required</span> are needed for a working PG; the
        rest can be skipped.
      </p>

      <StepFooter hideBack onNext={start} busy={busy} nextLabel="Let’s start" />
    </>
  )
}

// -------------------------------------------------------------- basics ----

const TYPES = [
  { value: 'MENS', label: 'Men’s PG' },
  { value: 'WOMENS', label: 'Women’s PG' },
  { value: 'COLIVE', label: 'Co-living' },
] as const

export function BasicsStep({ ctx }: { ctx: StepContext }) {
  const toast = useToast()
  const draft = useDraft(ctx)
  const property = ctx.snapshot.property
  const [name, setName] = React.useState(draft.name ?? '')
  const [code, setCode] = React.useState(draft.code ?? '')
  const [codeTouched, setCodeTouched] = React.useState(Boolean(draft.code))
  const [type, setType] = React.useState<Draft['type']>(draft.type)
  const [errors, setErrors] = React.useState<Errors>({})
  const [busy, setBusy] = React.useState(false)

  function onName(v: string) {
    setName(v)
    if (!codeTouched && !property) setCode(suggestCode(v))
  }

  async function next() {
    const e: Errors = {
      name: name.trim().length < 3 ? 'Give your PG a name (at least 3 letters)' : undefined,
      code:
        property
          ? undefined
          : !/^[A-Za-z0-9-]{2,8}$/.test(code.trim())
            ? 'Use 2–8 letters, numbers or dashes'
            : undefined,
      type: !type ? 'Choose who the PG is for' : undefined,
    }
    setErrors(e)
    if (hasErrors(e)) return
    setBusy(true)
    try {
      if (property) await api.patch(`/api/properties/${property.id}`, { name: name.trim(), type })
      await ctx.advance({
        answers: { draft: { ...(ctx.answers.draft as Draft), name: name.trim(), code: code.trim().toUpperCase(), type } },
      })
    } catch (error) {
      toast.fromError(error, 'save the PG basics')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <StepHeading title="PG basics" body="What residents and your team will see on receipts, the resident app and reports." />
      <div className="grid gap-4 sm:grid-cols-[1fr_160px]">
        <Field label="PG name" required error={errors.name} htmlFor="pg-name">
          <Input
            id="pg-name"
            value={name}
            onChange={(e) => onName(e.target.value)}
            placeholder="e.g. Sunrise Residency"
            aria-invalid={Boolean(errors.name)}
            autoFocus
          />
        </Field>
        <Field
          label="Short code"
          required
          error={errors.code}
          hint={property ? 'Fixed — it’s on invoices already' : 'Used in invoice numbers'}
          htmlFor="pg-code"
        >
          <Input
            id="pg-code"
            value={code}
            disabled={Boolean(property)}
            onChange={(e) => {
              setCodeTouched(true)
              setCode(e.target.value.toUpperCase())
            }}
            placeholder="SUNR"
            maxLength={8}
            aria-invalid={Boolean(errors.code)}
          />
        </Field>
      </div>
      <Field label="Who is it for?" required error={errors.type}>
        <div className="grid gap-2 sm:grid-cols-3">
          {TYPES.map((t) => (
            <Choice key={t.value} selected={type === t.value} onClick={() => setType(t.value)}>
              {t.label}
            </Choice>
          ))}
        </div>
      </Field>
      <StepFooter onBack={ctx.back} onNext={next} busy={busy} />
    </>
  )
}

// ------------------------------------------------------------- address ----

export function AddressStep({ ctx }: { ctx: StepContext }) {
  const toast = useToast()
  const draft = useDraft(ctx)
  const property = ctx.snapshot.property
  const [v, setV] = React.useState({
    addressLine: draft.addressLine ?? '',
    city: draft.city ?? '',
    state: draft.state ?? '',
    pincode: draft.pincode ?? '',
    contactName: draft.contactName ?? ctx.snapshot.owner.name,
    contactPhone: draft.contactPhone ?? ctx.snapshot.owner.phone ?? '',
  })
  const [errors, setErrors] = React.useState<Errors>({})
  const [busy, setBusy] = React.useState(false)
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV((s) => ({ ...s, [k]: e.target.value }))

  async function next() {
    const e: Errors = {
      addressLine: v.addressLine.trim().length < 5 ? 'Enter the street address' : undefined,
      city: v.city.trim().length < 2 ? 'Enter the city' : undefined,
      state: v.state.trim().length < 2 ? 'Enter the state' : undefined,
      pincode: !/^\d{6}$/.test(v.pincode.trim()) ? 'PIN code must be 6 digits' : undefined,
      contactPhone: v.contactPhone.trim() && !PHONE_RE.test(v.contactPhone.trim()) ? 'Enter a valid 10-digit mobile number' : undefined,
    }
    setErrors(e)
    if (hasErrors(e)) return
    const clean = Object.fromEntries(Object.entries(v).map(([k, val]) => [k, val.trim()]))
    setBusy(true)
    try {
      if (property) await api.patch(`/api/properties/${property.id}`, clean)
      await ctx.advance({ answers: { draft: { ...(ctx.answers.draft as Draft), ...clean } } })
    } catch (error) {
      toast.fromError(error, 'save the address')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <StepHeading title="Address & contact" body="Shown to residents and used on receipts and agreements." />
      <Field label="Street address" required error={errors.addressLine} htmlFor="addr">
        <Input id="addr" value={v.addressLine} onChange={set('addressLine')} placeholder="No. 12, 4th Cross, HSR Layout" aria-invalid={Boolean(errors.addressLine)} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="City" required error={errors.city} htmlFor="city">
          <Input id="city" value={v.city} onChange={set('city')} placeholder="Bengaluru" aria-invalid={Boolean(errors.city)} />
        </Field>
        <Field label="State" required error={errors.state} htmlFor="state">
          <Input id="state" value={v.state} onChange={set('state')} placeholder="Karnataka" aria-invalid={Boolean(errors.state)} />
        </Field>
        <Field label="PIN code" required error={errors.pincode} htmlFor="pin">
          <Input id="pin" value={v.pincode} onChange={set('pincode')} inputMode="numeric" maxLength={6} placeholder="560102" aria-invalid={Boolean(errors.pincode)} />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Contact person" hint="Optional — warden or manager" htmlFor="cname">
          <Input id="cname" value={v.contactName} onChange={set('contactName')} />
        </Field>
        <Field label="Contact phone" error={errors.contactPhone} hint="Optional" htmlFor="cphone">
          <Input id="cphone" value={v.contactPhone} onChange={set('contactPhone')} inputMode="tel" placeholder="98765 43210" aria-invalid={Boolean(errors.contactPhone)} />
        </Field>
      </div>
      <StepFooter onBack={ctx.back} onNext={next} busy={busy} />
    </>
  )
}

// -------------------------------------------------------------- config ----

const AMENITIES = [
  'WiFi', 'Three meals', 'Power backup', 'Washing machine', 'CCTV', 'Hot water',
  'Housekeeping', 'Parking', '24×7 security', 'Warden', 'Lift', 'Study table',
  'Refrigerator', 'Water purifier',
]

/** Placeholder until the Rent step sets the real figures. */
const PROVISIONAL_RENT = 8000
const PROVISIONAL_DEPOSIT = 10000

export function ConfigStep({ ctx }: { ctx: StepContext }) {
  const toast = useToast()
  const property = ctx.snapshot.property
  const draft = useDraft(ctx)
  const savedSharing = (ctx.answers.sharingTypes as string[] | undefined) ?? ['DOUBLE', 'TRIPLE']
  const [sharing, setSharing] = React.useState<string[]>(savedSharing)
  const [amenities, setAmenities] = React.useState<string[]>(property?.amenities ?? ['WiFi', 'Power backup', 'Hot water'])
  const [error, setError] = React.useState<string>()
  const [busy, setBusy] = React.useState(false)

  const toggle = (list: string[], set: (v: string[]) => void, value: string) =>
    set(list.includes(value) ? list.filter((x) => x !== value) : [...list, value])

  async function next() {
    if (sharing.length === 0) {
      setError('Pick at least one room type you offer')
      return
    }
    setError(undefined)
    setBusy(true)
    try {
      let propertyId = property?.id
      if (property) {
        await api.patch(`/api/properties/${property.id}`, { amenities })
      } else {
        const missing = !draft.name || !draft.code || !draft.type || !draft.addressLine || !draft.city || !draft.state || !draft.pincode
        if (missing) {
          toast.error('A few details are missing', 'Go back and fill in the PG basics and address.')
          ctx.goTo(!draft.name || !draft.code || !draft.type ? 'basics' : 'address')
          return
        }
        const created = await api.post<{ property: { id: string }; message: string }>('/api/properties', {
          name: draft.name,
          code: draft.code,
          type: draft.type,
          addressLine: draft.addressLine,
          city: draft.city,
          state: draft.state,
          pincode: draft.pincode,
          contactName: draft.contactName ?? '',
          contactPhone: draft.contactPhone ?? '',
          standardRent: PROVISIONAL_RENT,
          standardDeposit: PROVISIONAL_DEPOSIT,
          foodIncluded: false,
          amenities,
        })
        propertyId = created.property.id
        toast.success('Your PG is created', created.message)
      }
      await ctx.advance({ propertyId, answers: { sharingTypes: sharing } })
    } catch (error) {
      toast.fromError(error, 'create the PG')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <StepHeading
        title="PG configuration"
        body="Which room types you offer and what’s included. We’ll create your PG when you continue."
      />
      <Field label="Sharing types you offer" required error={error}>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {SHARING_OPTIONS.map((o) => (
            <Choice key={o.type} selected={sharing.includes(o.type)} onClick={() => toggle(sharing, setSharing, o.type)}>
              {o.label}
            </Choice>
          ))}
        </div>
      </Field>
      <Field label="Amenities" hint="Optional — shown to residents and enquiries">
        <div className="flex flex-wrap gap-2">
          {AMENITIES.map((a) => (
            <Button
              key={a}
              type="button"
              size="sm"
              variant={amenities.includes(a) ? 'primary' : 'outline'}
              onClick={() => toggle(amenities, setAmenities, a)}
              aria-pressed={amenities.includes(a)}
            >
              {a}
            </Button>
          ))}
        </div>
      </Field>
      {!property && (
        <Note>
          Your free trial starts when the PG is created. You’ll set the actual rent and deposit in a couple of steps.
        </Note>
      )}
      <StepFooter onBack={ctx.back} onNext={next} busy={busy} nextLabel={property ? 'Next' : 'Create PG & continue'} />
    </>
  )
}
