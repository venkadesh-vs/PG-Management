'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import {
  ArrowLeft,
  ArrowRight,
  BedDouble,
  Building2,
  Check,
  CheckCircle2,
  Gauge,
  IndianRupee,
  Layers,
  Minus,
  Plus,
  Snowflake,
  Sparkles,
  Trash2,
  Upload,
  UserPlus,
  Users,
  UtensilsCrossed,
  Zap,
} from 'lucide-react'
import { api, ApiError } from '@/lib/client'
import { cn, formatMoney } from '@/lib/utils'
import {
  capacityFor,
  cardRent,
  normaliseRentCard,
  SHARING,
  standardRentFrom,
  stateFromPincode,
  subscriptionPreview,
  type PlanPricing,
  type RentCard,
  type SharingType,
} from '@/lib/rent-card'
import { useToast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/primitives'

type Group = { key: number; level: number; rooms: number; sharing: SharingType; ac: boolean }
type Food = 'NONE' | 'INCLUDED' | 'SEPARATE'

const STEPS = [
  { title: 'Your PG', icon: Building2 },
  { title: 'Your building', icon: Layers },
  { title: 'Rent & food', icon: IndianRupee },
] as const

const PG_TYPES = [
  { value: 'MENS', label: "Men's PG", icon: Users },
  { value: 'WOMENS', label: "Women's PG", icon: Users },
  { value: 'COLIVE', label: 'Co-living', icon: Users },
] as const

const floorLabel = (level: number) =>
  level === 0 ? 'Ground' : `${level}${level % 10 === 1 && level !== 11 ? 'st' : level % 10 === 2 && level !== 12 ? 'nd' : level % 10 === 3 && level !== 13 ? 'rd' : 'th'} floor`

let seq = 1

/**
 * The PG in three short screens: where it is, how the building is laid out
 * (floor by floor), and one rent card. Rooms and beds are generated, every
 * room is priced from the card, and the standard rent that prices the
 * subscription is worked out, not typed.
 */
export function QuickSetup({
  plan,
  finishOnboarding,
  defaultCity,
  ownerName,
}: {
  plan: PlanPricing | null
  finishOnboarding: boolean
  defaultCity?: string | null
  ownerName: string
}) {
  const router = useRouter()
  const toast = useToast()
  const reduce = useReducedMotion()
  const [step, setStep] = React.useState(0)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [done, setDone] = React.useState<{ propertyId: string; rooms: number; beds: number; standardRent: number; subscription: number } | null>(null)

  // Step 1
  const [name, setName] = React.useState('')
  const [type, setType] = React.useState<'MENS' | 'WOMENS' | 'COLIVE'>('MENS')
  const [addressLine, setAddressLine] = React.useState('')
  const [city, setCity] = React.useState(defaultCity ?? '')
  const [pincode, setPincode] = React.useState('')
  // Step 2
  const [groups, setGroups] = React.useState<Group[]>([
    { key: seq++, level: 0, rooms: 6, sharing: 'DOUBLE', ac: false },
    { key: seq++, level: 1, rooms: 6, sharing: 'DOUBLE', ac: false },
  ])
  // Step 3
  const [card, setCard] = React.useState<RentCard>({})
  const [food, setFood] = React.useState<Food>('SEPARATE')
  const [foodCharge, setFoodCharge] = React.useState('3000')
  const [depositMonths, setDepositMonths] = React.useState(1)
  const [metered, setMetered] = React.useState(false)

  const rooms = groups.reduce((s, g) => s + g.rooms, 0)
  const beds = groups.reduce((s, g) => s + g.rooms * capacityFor(g.sharing), 0)
  const floors = new Set(groups.map((g) => g.level)).size
  // Only the sharing/AC combinations the building really has need a price.
  const needed = SHARING.filter((s) => groups.some((g) => g.sharing === s.type)).map((s) => ({
    ...s,
    nonAc: groups.some((g) => g.sharing === s.type && !g.ac),
    ac: groups.some((g) => g.sharing === s.type && g.ac),
  }))
  const clean = normaliseRentCard(card)
  const bedRents = groups.flatMap((g) => {
    const rent = cardRent(clean, g.sharing, g.ac)
    return rent ? Array.from({ length: g.rooms * capacityFor(g.sharing) }, () => rent) : []
  })
  const standardRent = standardRentFrom(bedRents, clean)
  const subscription = plan && standardRent ? subscriptionPreview(standardRent, beds, plan) : null
  const state = stateFromPincode(pincode)

  function setPrice(t: SharingType, which: 'nonAc' | 'ac', value: string) {
    setCard((c) => ({ ...c, [t]: { ...(c[t] ?? {}), [which]: value === '' ? null : Number(value) } }))
  }

  function updateGroup(key: number, patch: Partial<Group>) {
    setGroups((gs) => gs.map((g) => (g.key === key ? { ...g, ...patch } : g)))
  }

  function addFloor() {
    setGroups((gs) => {
      const last = gs[gs.length - 1]
      const level = gs.length ? Math.max(...gs.map((g) => g.level)) + 1 : 0
      return [...gs, { key: seq++, level, rooms: last?.rooms ?? 6, sharing: last?.sharing ?? 'DOUBLE', ac: last?.ac ?? false }]
    })
  }

  function addTypeToFloor(level: number) {
    setGroups((gs) => {
      const at = gs.map((g) => g.level).lastIndexOf(level)
      // Suggest a sharing type the floor doesn't have yet.
      const used = new Set(gs.filter((g) => g.level === level).map((g) => g.sharing))
      const sharing = SHARING.find((s) => !used.has(s.type))?.type ?? 'TRIPLE'
      const copy: Group = { key: seq++, level, rooms: 2, sharing, ac: false }
      return [...gs.slice(0, at + 1), copy, ...gs.slice(at + 1)]
    })
  }

  /** Moves a whole floor (every room type on it) to another level. */
  function moveFloor(from: number, to: number) {
    setGroups((gs) => gs.map((g) => (g.level === from ? { ...g, level: to } : g)))
  }

  function removeFloor(level: number) {
    setGroups((gs) => gs.filter((g) => g.level !== level))
  }

  // Floors in order, each with its room-type rows.
  const floorList = [...new Set(groups.map((g) => g.level))]
    .sort((a, b) => a - b)
    .map((level) => ({ level, rows: groups.filter((g) => g.level === level) }))

  function validate(s: number): string | null {
    if (s === 0) {
      if (name.trim().length < 3) return 'Give your PG a name'
      if (addressLine.trim().length < 3) return 'Enter the area or street'
      if (city.trim().length < 2) return 'Enter the city'
      if (!/^\d{6}$/.test(pincode)) return 'Enter the 6-digit PIN code'
    }
    if (s === 1 && !groups.length) return 'Add at least one floor'
    if (s === 2) {
      for (const n of needed) {
        if (n.nonAc && !cardRent(clean, n.type, false)) return `Enter the rent for ${n.label}`
        if (n.ac && !clean[n.type]?.ac && !clean[n.type]?.nonAc) return `Enter the rent for ${n.label} AC`
      }
      if (food === 'SEPARATE' && !(Number(foodCharge) > 0)) return 'Enter the monthly food charge'
    }
    return null
  }

  function next() {
    const problem = validate(step)
    setError(problem)
    if (!problem) setStep((s) => s + 1)
  }

  async function submit() {
    const problem = validate(2)
    setError(problem)
    if (problem) return
    setBusy(true)
    try {
      const result = await api.post<{ propertyId: string; rooms: number; beds: number; standardRent: number; subscription: number; message: string }>(
        '/api/setup/quick',
        {
          name,
          type,
          addressLine,
          city,
          pincode,
          groups: groups.map(({ level, rooms, sharing, ac }) => ({ level, rooms, sharing, ac })),
          rentCard: clean,
          food,
          foodCharge: food === 'SEPARATE' ? Number(foodCharge) : 0,
          depositMonths,
          electricity: metered ? 'METERED' : 'INCLUDED',
          finishOnboarding,
        },
      )
      setDone(result)
      router.refresh()
    } catch (e) {
      const message = e instanceof ApiError ? e.message.replace(/^\w+: /, '') : 'Please try again.'
      setError(message)
      toast.error('Could not create your PG', message)
    } finally {
      setBusy(false)
    }
  }

  if (done) return <Success result={done} name={name} ownerName={ownerName} />

  return (
    <div className="mx-auto w-full max-w-3xl">
      {/* Header + stepper */}
      <div className="relative overflow-hidden rounded-3xl bg-ink-950 p-6 text-white shadow-[0_30px_70px_-35px_rgb(11_16_26/0.9)] sm:p-8">
        <div aria-hidden className="pointer-events-none absolute -left-24 -top-24 size-72 rounded-full bg-blue-600/30 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-24 right-0 size-64 rounded-full bg-marigold-400/15 blur-3xl" />
        <div className="relative">
          <p className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.06] px-3 py-1 text-xs font-medium text-white/80">
            <Sparkles className="size-3.5 text-marigold-300" />
            About 3 minutes · one time only
          </p>
          <h1 className="mt-3 font-display text-2xl font-semibold tracking-tight sm:text-3xl">
            {finishOnboarding ? `Welcome, ${ownerName.split(' ')[0]}. Let's set up your PG.` : 'Add a PG'}
          </h1>
          <p className="mt-1 text-sm text-white/60">Three short screens. We create every room and bed, and price them from your rent card.</p>
          <ol className="mt-6 grid grid-cols-3 gap-2">
            {STEPS.map((s, i) => (
              <li key={s.title}>
                <button
                  type="button"
                  disabled={i > step}
                  onClick={() => i < step && setStep(i)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-2xl border px-3 py-2.5 text-left transition',
                    i === step ? 'border-marigold-300/40 bg-white/10' : i < step ? 'border-white/10 bg-white/[0.04] hover:bg-white/[0.08]' : 'border-white/5 bg-transparent opacity-50',
                  )}
                >
                  <span
                    className={cn(
                      'flex size-8 shrink-0 items-center justify-center rounded-xl',
                      i < step ? 'bg-emerald-400/20 text-emerald-300' : i === step ? 'bg-marigold-300/20 text-marigold-200' : 'bg-white/5 text-white/50',
                    )}
                  >
                    {i < step ? <Check className="size-4" /> : <s.icon className="size-4" />}
                  </span>
                  <span className="hidden text-sm font-medium sm:block">{s.title}</span>
                </button>
              </li>
            ))}
          </ol>
        </div>
      </div>

      <div className="mt-5 rounded-3xl border border-slate-200/80 bg-white p-5 shadow-card sm:p-7">
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={reduce ? false : { opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={reduce ? undefined : { opacity: 0, x: -24 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
          >
            {step === 0 && (
              <div className="space-y-5">
                <StepTitle icon={Building2} title="Your PG" hint="Just the basics. Everything else can be added later." />
                <Field label="PG name" required>
                  <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Sri Balaji Men's PG" className="h-12" autoFocus />
                </Field>
                <div>
                  <p className="mb-2 text-[13px] font-semibold text-slate-700">Who stays here?</p>
                  <div className="grid grid-cols-3 gap-2">
                    {PG_TYPES.map((t) => (
                      <button
                        key={t.value}
                        type="button"
                        onClick={() => setType(t.value)}
                        className={cn(
                          'flex flex-col items-center gap-1.5 rounded-2xl border p-3 text-sm font-medium transition',
                          type === t.value ? 'border-blue-500 bg-blue-50/70 text-blue-800 ring-1 ring-blue-500' : 'border-slate-200 text-slate-600 hover:border-slate-300',
                        )}
                      >
                        <t.icon className="size-5" />
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>
                <Field label="Area / street" required>
                  <Input value={addressLine} onChange={(e) => setAddressLine(e.target.value)} placeholder="12, 2nd Main Road, Thoraipakkam" className="h-12" />
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="City" required>
                    <Input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Chennai" className="h-12" />
                  </Field>
                  <Field label="PIN code" required hint={state ? `State: ${state}` : 'We fill the state from it'}>
                    <Input value={pincode} onChange={(e) => setPincode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" placeholder="600097" className="h-12" />
                  </Field>
                </div>
              </div>
            )}

            {step === 1 && (
              <div className="space-y-5">
                <StepTitle
                  icon={Layers}
                  title="Your building"
                  hint="Floor by floor. A floor with different room types? Add each sharing type as its own row."
                />
                <ul className="space-y-3">
                  {floorList.map(({ level, rows }) => {
                    const floorRooms = rows.reduce((s, g) => s + g.rooms, 0)
                    const floorBeds = rows.reduce((s, g) => s + g.rooms * capacityFor(g.sharing), 0)
                    return (
                      <motion.li
                        key={rows[0].key}
                        layout={!reduce}
                        initial={reduce ? false : { opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="rounded-2xl border border-slate-200 bg-slate-50/60 p-3 sm:p-4"
                      >
                        <div className="flex flex-wrap items-center gap-3">
                          <select
                            value={level}
                            onChange={(e) => moveFloor(level, Number(e.target.value))}
                            className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800"
                            aria-label="Floor"
                          >
                            {Array.from({ length: 16 }, (_, l) => l)
                              .filter((l) => l === level || !floorList.some((f) => f.level === l))
                              .map((l) => (
                                <option key={l} value={l}>
                                  {floorLabel(l)}
                                </option>
                              ))}
                          </select>
                          <span className="text-xs text-slate-500 tabular-nums">
                            {floorRooms} room{floorRooms === 1 ? '' : 's'} · {floorBeds} bed{floorBeds === 1 ? '' : 's'}
                          </span>
                          {floorList.length > 1 && (
                            <button
                              type="button"
                              aria-label={`Remove ${floorLabel(level).toLowerCase()}`}
                              onClick={() => removeFloor(level)}
                              className="ml-auto flex size-9 items-center justify-center rounded-xl text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                            >
                              <Trash2 className="size-4" />
                            </button>
                          )}
                        </div>
                        <ul className="mt-3 space-y-2">
                          {rows.map((g) => (
                            <li key={g.key} className="rounded-xl border border-slate-200 bg-white p-2.5 sm:p-3">
                              <div className="flex flex-wrap items-center gap-3">
                                <div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-1">
                                  <button type="button" aria-label="Fewer rooms" onClick={() => updateGroup(g.key, { rooms: Math.max(1, g.rooms - 1) })} className="flex size-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100">
                                    <Minus className="size-4" />
                                  </button>
                                  <input
                                    value={g.rooms}
                                    onChange={(e) => updateGroup(g.key, { rooms: Math.min(60, Math.max(1, Number(e.target.value.replace(/\D/g, '')) || 1)) })}
                                    inputMode="numeric"
                                    aria-label="Rooms"
                                    className="w-10 bg-transparent text-center text-sm font-semibold tabular-nums text-slate-900 outline-none"
                                  />
                                  <button type="button" aria-label="More rooms" onClick={() => updateGroup(g.key, { rooms: Math.min(60, g.rooms + 1) })} className="flex size-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100">
                                    <Plus className="size-4" />
                                  </button>
                                </div>
                                <span className="text-sm text-slate-500">rooms</span>
                                <button
                                  type="button"
                                  onClick={() => updateGroup(g.key, { ac: !g.ac })}
                                  className={cn(
                                    'ml-auto inline-flex h-9 items-center gap-1.5 rounded-xl border px-3 text-xs font-semibold transition',
                                    g.ac ? 'border-sky-300 bg-sky-50 text-sky-700' : 'border-slate-200 bg-white text-slate-500',
                                  )}
                                >
                                  <Snowflake className="size-3.5" />
                                  {g.ac ? 'AC' : 'Non-AC'}
                                </button>
                                {rows.length > 1 && (
                                  <button type="button" aria-label="Remove this room type" onClick={() => setGroups((gs) => gs.filter((x) => x.key !== g.key))} className="flex size-9 items-center justify-center rounded-xl text-slate-400 hover:bg-rose-50 hover:text-rose-600">
                                    <Trash2 className="size-3.5" />
                                  </button>
                                )}
                              </div>
                              <div className="mt-3 flex flex-wrap gap-1.5">
                                {SHARING.map((s) => (
                                  <button
                                    key={s.type}
                                    type="button"
                                    onClick={() => updateGroup(g.key, { sharing: s.type })}
                                    className={cn(
                                      'rounded-xl border px-3 py-1.5 text-xs font-semibold transition',
                                      g.sharing === s.type ? 'border-blue-500 bg-blue-600 text-white shadow-sm' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300',
                                    )}
                                  >
                                    {s.label}
                                  </button>
                                ))}
                              </div>
                            </li>
                          ))}
                        </ul>
                        <button
                          type="button"
                          onClick={() => addTypeToFloor(level)}
                          className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-blue-300 bg-blue-50/50 px-3 py-2 text-xs font-semibold text-blue-700 transition hover:bg-blue-50"
                        >
                          <Plus className="size-3.5" />
                          Add another sharing type on {floorLabel(level).toLowerCase()}
                        </button>
                      </motion.li>
                    )
                  })}
                </ul>
                <Button type="button" variant="outline" className="w-full" onClick={addFloor}>
                  <Plus className="size-4" />
                  Add a floor
                </Button>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    [Layers, floors, floors === 1 ? 'floor' : 'floors'],
                    [Building2, rooms, rooms === 1 ? 'room' : 'rooms'],
                    [BedDouble, beds, beds === 1 ? 'bed' : 'beds'],
                  ].map(([Icon, value, label]) => {
                    const I = Icon as typeof Layers
                    return (
                      <div key={label as string} className="flex items-center gap-2.5 rounded-2xl bg-gradient-to-br from-blue-50 to-white p-3 ring-1 ring-blue-100">
                        <I className="size-5 text-blue-600" />
                        <span>
                          <span className="block font-display text-lg font-semibold tabular-nums text-slate-900">{value as number}</span>
                          <span className="block text-[11px] text-slate-500">{label as string}</span>
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-6">
                <StepTitle icon={IndianRupee} title="Rent card" hint="Monthly rent per bed. Every room takes its price from here; you can change it anytime." />
                <div className="overflow-hidden rounded-2xl border border-slate-200">
                  <div className="grid grid-cols-[1fr_1fr_1fr] bg-slate-50 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    <span>Sharing</span>
                    <span>Non-AC</span>
                    <span className="flex items-center gap-1">
                      <Snowflake className="size-3" /> AC
                    </span>
                  </div>
                  {needed.map((n) => (
                    <div key={n.type} className="grid grid-cols-[1fr_1fr_1fr] items-center gap-2 border-t border-slate-100 px-3 py-2.5">
                      <span className="text-sm font-semibold text-slate-800">{n.label}</span>
                      {(['nonAc', 'ac'] as const).map((which) =>
                        n[which] ? (
                          <div key={which} className="relative">
                            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">₹</span>
                            <Input
                              inputMode="numeric"
                              value={card[n.type]?.[which] ?? ''}
                              onChange={(e) => setPrice(n.type, which, e.target.value.replace(/\D/g, ''))}
                              placeholder={which === 'ac' ? '11000' : '9000'}
                              aria-label={`${n.label} ${which === 'ac' ? 'AC' : 'non-AC'} rent`}
                              className="h-11 pl-7 tabular-nums"
                            />
                          </div>
                        ) : (
                          <span key={which} className="text-xs text-slate-300">
                            No {which === 'ac' ? 'AC' : 'non-AC'} rooms
                          </span>
                        ),
                      )}
                    </div>
                  ))}
                </div>

                <div>
                  <p className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-slate-700">
                    <UtensilsCrossed className="size-4 text-slate-400" /> Food
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    {(
                      [
                        ['NONE', 'No food'],
                        ['INCLUDED', 'In the rent'],
                        ['SEPARATE', 'Charged separately'],
                      ] as const
                    ).map(([v, label]) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => setFood(v)}
                        className={cn(
                          'rounded-2xl border px-3 py-2.5 text-sm font-medium transition',
                          food === v ? 'border-blue-500 bg-blue-50/70 text-blue-800 ring-1 ring-blue-500' : 'border-slate-200 text-slate-600 hover:border-slate-300',
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {food === 'SEPARATE' && (
                    <div className="relative mt-3 max-w-xs">
                      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">₹</span>
                      <Input inputMode="numeric" value={foodCharge} onChange={(e) => setFoodCharge(e.target.value.replace(/\D/g, ''))} className="h-11 pl-7" aria-label="Food charge per month" />
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">per month</span>
                    </div>
                  )}
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <p className="mb-2 text-[13px] font-semibold text-slate-700">Security deposit</p>
                    <div className="flex gap-1.5">
                      {[0, 1, 2, 3].map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setDepositMonths(m)}
                          className={cn(
                            'flex-1 rounded-xl border px-2 py-2 text-xs font-semibold transition',
                            depositMonths === m ? 'border-blue-500 bg-blue-600 text-white' : 'border-slate-200 text-slate-600 hover:border-slate-300',
                          )}
                        >
                          {m === 0 ? 'None' : `${m} month${m > 1 ? 's' : ''}`}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-slate-700">
                      <Zap className="size-4 text-slate-400" /> Electricity
                    </p>
                    <label className="flex h-[38px] items-center justify-between gap-3 rounded-xl border border-slate-200 px-3 text-sm text-slate-600">
                      {metered ? 'Meter in each room, split by days stayed' : 'Included in the rent'}
                      <Switch checked={metered} onCheckedChange={setMetered} aria-label="Separate meter per room" />
                    </label>
                  </div>
                </div>

                {/* Live result */}
                <div className="relative overflow-hidden rounded-2xl bg-ink-950 p-5 text-white">
                  <div aria-hidden className="pointer-events-none absolute -right-10 -top-16 size-48 rounded-full bg-marigold-400/20 blur-3xl" />
                  <div className="relative grid gap-4 sm:grid-cols-2">
                    <div>
                      <p className="flex items-center gap-1.5 text-xs font-medium text-white/60">
                        <Gauge className="size-3.5 text-marigold-300" /> Standard rent (average bed)
                      </p>
                      <p className="mt-1 font-display text-2xl font-semibold tabular-nums">{standardRent ? formatMoney(standardRent) : '—'}</p>
                      <p className="text-[11px] text-white/45">Worked out from your {beds} beds. You never type it.</p>
                    </div>
                    <div>
                      <p className="flex items-center gap-1.5 text-xs font-medium text-white/60">
                        <Sparkles className="size-3.5 text-marigold-300" /> Your StayFlow subscription
                      </p>
                      <p className="mt-1 font-display text-2xl font-semibold tabular-nums text-marigold-200">
                        {subscription ? `${formatMoney(subscription)}/month` : '—'}
                      </p>
                      <p className="text-[11px] text-white/45">One bed&apos;s rent for the whole PG. Free during your trial.</p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>

        {error && (
          <p role="alert" className="mt-5 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">
            {error}
          </p>
        )}

        <div className="mt-6 flex items-center justify-between gap-3 border-t border-slate-100 pt-5">
          {step > 0 ? (
            <Button type="button" variant="ghost" onClick={() => { setError(null); setStep((s) => s - 1) }}>
              <ArrowLeft className="size-4" />
              Back
            </Button>
          ) : (
            <span />
          )}
          {step < 2 ? (
            <Button type="button" variant="primary" size="lg" onClick={next}>
              Continue
              <ArrowRight className="size-4" />
            </Button>
          ) : (
            <Button type="button" variant="primary" size="lg" className="shine" loading={busy} onClick={submit}>
              Create my PG
              {!busy && <Sparkles className="size-4" />}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

function StepTitle({ icon: Icon, title, hint }: { icon: typeof Layers; title: string; hint: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-50 to-blue-100/60 text-blue-700 ring-1 ring-inset ring-blue-100">
        <Icon className="size-5" />
      </span>
      <div>
        <h2 className="font-display text-lg font-semibold tracking-tight text-slate-900">{title}</h2>
        <p className="text-sm text-slate-500">{hint}</p>
      </div>
    </div>
  )
}

function Success({
  result,
  name,
  ownerName,
}: {
  result: { propertyId: string; rooms: number; beds: number; standardRent: number; subscription: number }
  name: string
  ownerName: string
}) {
  const reduce = useReducedMotion()
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      className="relative mx-auto w-full max-w-2xl overflow-hidden rounded-3xl bg-ink-950 p-8 text-center text-white shadow-[0_30px_70px_-35px_rgb(11_16_26/0.9)]"
    >
      <div aria-hidden className="pointer-events-none absolute -left-20 -top-20 size-72 rounded-full bg-blue-600/30 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute -bottom-24 -right-10 size-72 rounded-full bg-marigold-400/20 blur-3xl" />
      <div className="relative">
        <motion.span
          initial={reduce ? false : { scale: 0, rotate: -20 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 15, delay: 0.1 }}
          className="mx-auto flex size-16 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-400 to-emerald-600 shadow-[0_14px_30px_-10px_rgb(16_185_129/0.7)]"
        >
          <CheckCircle2 className="size-8" />
        </motion.span>
        <h2 className="mt-5 font-display text-2xl font-semibold tracking-tight">{name} is ready, {ownerName.split(' ')[0]}.</h2>
        <p className="mt-1 text-sm text-white/60">Every room and bed is created and priced from your rent card.</p>
        <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            ['Rooms', String(result.rooms)],
            ['Beds', String(result.beds)],
            ['Standard rent', formatMoney(result.standardRent)],
            ['Subscription', `${formatMoney(result.subscription)}/mo`],
          ].map(([label, value]) => (
            <div key={label} className="rounded-2xl border border-white/10 bg-white/[0.05] p-3">
              <p className="font-display text-lg font-semibold tabular-nums">{value}</p>
              <p className="text-[11px] text-white/50">{label}</p>
            </div>
          ))}
        </div>
        <p className="mt-6 text-xs font-semibold uppercase tracking-[0.14em] text-white/40">Next, whenever you like</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <Button asChild variant="accent">
            <Link href="/app/residents/new">
              <UserPlus className="size-4" />
              Check in a resident
            </Link>
          </Button>
          <Button asChild variant="outline" className="border-white/15 bg-white/[0.06] text-white hover:bg-white/10 hover:text-white">
            <Link href="/app/import">
              <Upload className="size-4" />
              Import from Excel
            </Link>
          </Button>
          <Button asChild variant="outline" className="border-white/15 bg-white/[0.06] text-white hover:bg-white/10 hover:text-white">
            <Link href="/app">
              Go to dashboard
              <ArrowRight className="size-4" />
            </Link>
          </Button>
        </div>
      </div>
    </motion.div>
  )
}
