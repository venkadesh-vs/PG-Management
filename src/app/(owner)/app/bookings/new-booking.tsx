'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { AnimatePresence, motion } from 'framer-motion'
import { BedDouble, Check, Loader2, Plus, Search, UserRound, X } from 'lucide-react'
import { api } from '@/lib/client'
import { cn, formatDate, formatMoney, toISODate } from '@/lib/utils'
import { useToast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
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
import { TOKEN_METHODS } from '../leads/lead-meta'

type PropertyOption = { id: string; name: string; standardRent: number; standardDeposit: number }
type FreeRoom = {
  id: string
  number: string
  type: string
  hasAC: boolean
  floor: string
  beds: { id: string; label: string; rent: number }[]
}
type LeadOption = { id: string; name: string; phone: string; email: string | null; propertyId: string | null; status: string }

export type BookingPrefill = {
  leadId?: string
  name?: string
  phone?: string
  email?: string
  propertyId?: string
  checkInDate?: string
}

function defaultExpiry(checkIn: string, withToken: boolean) {
  const now = new Date()
  const start = checkIn ? new Date(`${checkIn}T00:00`) : now
  const base = start > now ? start : now
  const d = new Date(base)
  d.setDate(d.getDate() + (withToken ? 7 : 3))
  return toISODate(d)
}

function initialState(properties: PropertyOption[], defaultPropertyId: string | null | undefined, prefill: BookingPrefill | null) {
  const property = properties.find((p) => p.id === (prefill?.propertyId ?? defaultPropertyId)) ?? properties[0]
  const checkInDate = prefill?.checkInDate ? toISODate(new Date(prefill.checkInDate)) : toISODate(new Date())
  return {
    leadId: prefill?.leadId ?? '',
    name: prefill?.name ?? '',
    phone: prefill?.phone ?? '',
    email: prefill?.email ?? '',
    propertyId: property?.id ?? '',
    bedId: '',
    checkInDate,
    rent: String(property?.standardRent ?? ''),
    deposit: String(property?.standardDeposit ?? ''),
    tokenReceived: false,
    tokenAmount: '',
    tokenMethod: 'UPI',
    tokenReference: '',
    expiresAt: defaultExpiry(checkInDate, false),
    confirm: true,
    notes: '',
  }
}

export function NewBookingButton({
  properties,
  defaultPropertyId,
  prefill = null,
  label = 'New booking',
}: {
  properties: PropertyOption[]
  defaultPropertyId?: string | null
  prefill?: BookingPrefill | null
  label?: string
}) {
  const router = useRouter()
  const toast = useToast()
  const [open, setOpen] = React.useState(Boolean(prefill))
  const [values, setValues] = React.useState(() => initialState(properties, defaultPropertyId, prefill))
  const [expiryTouched, setExpiryTouched] = React.useState(false)
  const [rooms, setRooms] = React.useState<FreeRoom[]>([])
  const [loadingBeds, setLoadingBeds] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [errors, setErrors] = React.useState<Record<string, string>>({})

  // Reseed each time the dialog is opened again (the prefill only applies to
  // the first, automatic opening).
  const wasOpen = React.useRef(open)
  React.useEffect(() => {
    if (open && !wasOpen.current) {
      setValues(initialState(properties, defaultPropertyId, null))
      setExpiryTouched(false)
      setErrors({})
    }
    wasOpen.current = open
  }, [open, properties, defaultPropertyId])

  // Free beds for the chosen PG.
  React.useEffect(() => {
    if (!open || !values.propertyId) return
    let cancelled = false
    setLoadingBeds(true)
    api
      .get<{ rooms: FreeRoom[] }>(`/api/bookings?view=beds&propertyId=${values.propertyId}`)
      .then((data) => !cancelled && setRooms(data.rooms))
      .catch(() => !cancelled && setRooms([]))
      .finally(() => !cancelled && setLoadingBeds(false))
    return () => {
      cancelled = true
    }
  }, [open, values.propertyId])

  type Values = typeof values
  function set<K extends keyof Values>(key: K, value: Values[K]) {
    setValues((v) => {
      const next = { ...v, [key]: value }
      if (!expiryTouched && (key === 'checkInDate' || key === 'tokenReceived')) {
        next.expiresAt = defaultExpiry(next.checkInDate, next.tokenReceived)
      }
      return next
    })
    setErrors((e) => {
      if (!e[key as string]) return e
      const n = { ...e }
      delete n[key as string]
      return n
    })
  }

  function selectProperty(id: string) {
    const property = properties.find((p) => p.id === id)
    setValues((v) => ({
      ...v,
      propertyId: id,
      bedId: '',
      rent: String(property?.standardRent ?? v.rent),
      deposit: String(property?.standardDeposit ?? v.deposit),
    }))
  }

  function selectBed(bed: FreeRoom['beds'][number]) {
    setValues((v) => ({ ...v, bedId: v.bedId === bed.id ? '' : bed.id, rent: String(bed.rent || v.rent) }))
    setErrors((e) => ({ ...e, bedId: '' }))
  }

  function linkLead(lead: LeadOption | null) {
    if (!lead) {
      setValues((v) => ({ ...v, leadId: '' }))
      return
    }
    setValues((v) => ({
      ...v,
      leadId: lead.id,
      name: lead.name,
      phone: lead.phone,
      email: lead.email ?? '',
      ...(lead.propertyId && lead.propertyId !== v.propertyId ? { propertyId: lead.propertyId, bedId: '' } : {}),
    }))
  }

  function close(next: boolean) {
    setOpen(next)
    // Drop ?new=1&lead=… so a refresh does not reopen the form.
    if (!next && typeof window !== 'undefined' && window.location.search.includes('new=')) {
      router.replace('/app/bookings')
    }
  }

  const selectedBed = rooms.flatMap((r) => r.beds.map((b) => ({ ...b, room: r.number }))).find((b) => b.id === values.bedId)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    const errs: Record<string, string> = {}
    if (values.name.trim().length < 2) errs.name = 'Enter their name'
    if (!/^(\+?91[-\s]?)?[6-9]\d{9}$/.test(values.phone.replace(/\s/g, ''))) errs.phone = 'Enter a valid 10-digit mobile number'
    if (values.confirm && !values.bedId) errs.bedId = 'Pick a free bed to hold'
    if (!(Number(values.rent) > 0)) errs.rent = 'Rent must be greater than zero'
    if (values.tokenReceived && !(Number(values.tokenAmount) > 0)) errs.tokenAmount = 'Enter the token amount'
    if (Object.keys(errs).length) {
      setErrors(errs)
      return
    }
    setBusy(true)
    try {
      const result = await api.post<{ booking: { id: string; code: string }; message: string }>('/api/bookings', {
        ...values,
        phone: values.phone.replace(/\s/g, ''),
        rent: Number(values.rent),
        deposit: Number(values.deposit || 0),
        tokenAmount: values.tokenReceived ? Number(values.tokenAmount) : 0,
        tokenMethod: values.tokenReceived ? values.tokenMethod : undefined,
        bedId: values.bedId || undefined,
        leadId: values.leadId || undefined,
      })
      toast.success(values.confirm ? 'Bed reserved' : 'Booking saved', result.message)
      close(false)
      router.refresh()
    } catch (error) {
      toast.fromError(error, 'create the booking')
      // Someone else grabbed the bed: refresh the picker.
      if (values.propertyId) {
        api
          .get<{ rooms: FreeRoom[] }>(`/api/bookings?view=beds&propertyId=${values.propertyId}`)
          .then((data) => setRooms(data.rooms))
          .catch(() => undefined)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        <Plus /> {label}
      </Button>
      <Dialog open={open} onOpenChange={close}>
        <DialogContent size="xl">
          <DialogHeader>
            <DialogTitle>Hold a bed</DialogTitle>
            <DialogDescription>
              Reserve a free bed for someone moving in. Nobody else can be checked into it until the hold ends.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={submit} className="grid gap-6 lg:grid-cols-2">
            {/* ---------------------------------------- who */}
            <div className="space-y-4">
              <LeadPicker leadId={values.leadId} name={values.name} onPick={linkLead} />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Name" required error={errors.name}>
                  <Input value={values.name} onChange={(e) => set('name', e.target.value)} placeholder="Full name" />
                </Field>
                <Field label="Mobile number" required error={errors.phone}>
                  <Input inputMode="tel" value={values.phone} onChange={(e) => set('phone', e.target.value)} placeholder="10-digit number" />
                </Field>
                <Field label="Email" className="sm:col-span-2">
                  <Input type="email" value={values.email} onChange={(e) => set('email', e.target.value)} placeholder="Optional" />
                </Field>
                <Field label="Check-in date" required>
                  <Input type="date" min={toISODate(new Date())} value={values.checkInDate} onChange={(e) => set('checkInDate', e.target.value)} />
                </Field>
                <Field label="Hold until" hint={expiryTouched ? undefined : values.tokenReceived ? '7 days with a token' : '3 days without a token'}>
                  <Input
                    type="date"
                    min={toISODate(new Date())}
                    value={values.expiresAt}
                    onChange={(e) => {
                      setExpiryTouched(true)
                      set('expiresAt', e.target.value)
                    }}
                  />
                </Field>
                <Field label="Monthly rent" required error={errors.rent}>
                  <Input type="number" inputMode="numeric" min={0} value={values.rent} onChange={(e) => set('rent', e.target.value)} />
                </Field>
                <Field label="Security deposit">
                  <Input type="number" inputMode="numeric" min={0} value={values.deposit} onChange={(e) => set('deposit', e.target.value)} />
                </Field>
              </div>

              <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
                <label className="flex items-center justify-between gap-3">
                  <span>
                    <span className="block text-sm font-semibold text-slate-800">Token received now?</span>
                    <span className="block text-xs text-slate-500">It becomes their first rent payment at check-in.</span>
                  </span>
                  <Switch checked={values.tokenReceived} onCheckedChange={(v) => set('tokenReceived', v)} />
                </label>
                <AnimatePresence initial={false}>
                  {values.tokenReceived && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="grid gap-3 overflow-hidden sm:grid-cols-3"
                    >
                      <Field label="Amount" error={errors.tokenAmount}>
                        <Input type="number" inputMode="numeric" min={0} value={values.tokenAmount} onChange={(e) => set('tokenAmount', e.target.value)} placeholder="e.g. 2000" />
                      </Field>
                      <Field label="Paid by">
                        <Select value={values.tokenMethod} onChange={(e) => set('tokenMethod', e.target.value)}>
                          {TOKEN_METHODS.map((m) => (
                            <option key={m.value} value={m.value}>
                              {m.label}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Field label="Reference">
                        <Input value={values.tokenReference} onChange={(e) => set('tokenReference', e.target.value)} placeholder="UTR / note" />
                      </Field>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>

            {/* ---------------------------------------- where */}
            <div className="space-y-4">
              <Field label="PG" required>
                <Select value={values.propertyId} onChange={(e) => selectProperty(e.target.value)}>
                  {properties.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-slate-700">
                    Free bed {values.confirm && <span className="text-red-500">*</span>}
                  </p>
                  {selectedBed && (
                    <span className="text-xs font-semibold text-blue-700">
                      Room {selectedBed.room} · Bed {selectedBed.label} · {formatMoney(selectedBed.rent)}
                    </span>
                  )}
                </div>
                {errors.bedId && <p className="text-xs font-medium text-red-600">{errors.bedId}</p>}
                <div className="max-h-[320px] space-y-2 overflow-y-auto rounded-2xl border border-slate-200 p-2 scrollbar-slim">
                  {loadingBeds ? (
                    <p className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500">
                      <Loader2 className="size-4 animate-spin" /> Finding free beds…
                    </p>
                  ) : rooms.length === 0 ? (
                    <p className="px-3 py-10 text-center text-sm text-slate-500">
                      No free beds in this PG right now. Save it as pending and confirm when a bed opens up.
                    </p>
                  ) : (
                    rooms.map((room) => (
                      <div key={room.id} className="rounded-xl bg-white p-2.5 ring-1 ring-slate-100">
                        <div className="mb-2 flex items-center justify-between text-xs">
                          <span className="font-semibold text-slate-800">Room {room.number}</span>
                          <span className="text-slate-400">
                            {room.floor} · {room.type.toLowerCase()}
                            {room.hasAC ? ' · AC' : ''}
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {room.beds.map((bed) => {
                            const selected = values.bedId === bed.id
                            return (
                              <motion.button
                                key={bed.id}
                                type="button"
                                whileTap={{ scale: 0.92 }}
                                onClick={() => selectBed(bed)}
                                title={`${formatMoney(bed.rent)} / month`}
                                className={cn(
                                  'flex h-10 min-w-10 items-center justify-center rounded-lg border px-2 text-sm font-semibold transition-colors',
                                  selected
                                    ? 'border-transparent bg-blue-600 text-white ring-2 ring-blue-500/30 ring-offset-1'
                                    : 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:border-emerald-300',
                                )}
                              >
                                {selected ? <Check className="size-4" strokeWidth={3} /> : bed.label}
                              </motion.button>
                            )
                          })}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
              <label className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 p-4">
                <span>
                  <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
                    <BedDouble className="size-4 text-blue-600" /> Reserve the bed now
                  </span>
                  <span className="block text-xs text-slate-500">
                    {values.confirm
                      ? `Confirmed — held until ${formatDate(values.expiresAt)}.`
                      : 'Saved as pending; the bed stays open to others.'}
                  </span>
                </span>
                <Switch checked={values.confirm} onCheckedChange={(v) => set('confirm', v)} />
              </label>
              <Field label="Notes">
                <Textarea rows={2} value={values.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Optional" />
              </Field>
            </div>

            <DialogFooter className="lg:col-span-2">
              <Button type="button" variant="outline" onClick={() => close(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" loading={busy}>
                {values.confirm ? 'Confirm booking' : 'Save as pending'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

/** Optional link to an open enquiry, so the pipeline moves with the booking. */
function LeadPicker({ leadId, name, onPick }: { leadId: string; name: string; onPick: (lead: LeadOption | null) => void }) {
  const [q, setQ] = React.useState('')
  const [results, setResults] = React.useState<LeadOption[]>([])
  const [searching, setSearching] = React.useState(false)

  React.useEffect(() => {
    if (leadId || q.trim().length < 2) {
      setResults([])
      return
    }
    let cancelled = false
    setSearching(true)
    const timer = window.setTimeout(() => {
      api
        .get<{ leads: LeadOption[] }>(`/api/resident-leads?open=1&q=${encodeURIComponent(q.trim())}`)
        .then((data) => !cancelled && setResults(data.leads.filter((l) => !['TOKEN_PAID', 'BOOKED'].includes(l.status)).slice(0, 6)))
        .catch(() => !cancelled && setResults([]))
        .finally(() => !cancelled && setSearching(false))
    }, 250)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [q, leadId])

  if (leadId) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-xl border border-blue-200 bg-blue-50/60 px-3 py-2">
        <p className="flex items-center gap-2 text-sm text-blue-800">
          <UserRound className="size-4" /> From enquiry: <span className="font-semibold">{name}</span>
        </p>
        <button type="button" onClick={() => onPick(null)} className="rounded-md p-1 text-blue-700 hover:bg-blue-100" aria-label="Unlink enquiry">
          <X className="size-4" />
        </button>
      </div>
    )
  }

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-3 size-4 text-slate-400" />
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Link an enquiry (optional) — search name or phone" className="pl-9" />
      {(results.length > 0 || searching) && (
        <div className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-elevated">
          {searching && results.length === 0 ? (
            <p className="px-3 py-2 text-sm text-slate-500">Searching…</p>
          ) : (
            results.map((lead) => (
              <button
                key={lead.id}
                type="button"
                onClick={() => {
                  onPick(lead)
                  setQ('')
                }}
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50"
              >
                <span className="font-medium text-slate-800">{lead.name}</span>
                <span className="text-xs text-slate-500 tabular">{lead.phone}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
