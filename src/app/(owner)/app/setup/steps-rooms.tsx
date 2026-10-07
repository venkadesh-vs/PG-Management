'use client'

import * as React from 'react'
import Link from 'next/link'
import { BedDouble, Building, ExternalLink, Layers, Loader2, Plus } from 'lucide-react'
import { api } from '@/lib/client'
import { useToast } from '@/components/ui/toast'
import { Field, Input, Select } from '@/components/ui/input'
import { Switch } from '@/components/ui/primitives'
import { Button } from '@/components/ui/button'
import { Note, StepFooter, StepHeading, toInt, type StepContext } from './ui'
import {
  SHARING_OPTIONS,
  defaultStartNumber,
  floorName,
  missingFloorLevels,
  plannedRoomNumbers,
  type SharingType,
} from './steps'

type LiveRoom = { id: string; number: string; type: string; capacity: number; beds: { id: string }[] }
type LiveFloor = { id: string; name: string; level: number; rooms: LiveRoom[] }

/**
 * Floors/rooms read live from GET /api/rooms, so a step that just wrote
 * doesn't wait for the page snapshot to refresh.
 */
function useFloors(propertyId: string | undefined) {
  const [floors, setFloors] = React.useState<LiveFloor[] | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const load = React.useCallback(async () => {
    if (!propertyId) return
    try {
      const res = await api.get<{ floors: LiveFloor[] }>(`/api/rooms?propertyId=${encodeURIComponent(propertyId)}`)
      setFloors(res.floors)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load floors')
    }
  }, [propertyId])
  React.useEffect(() => {
    void load()
  }, [load])
  return { floors, error, reload: load }
}

function Loading({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  if (error) {
    return (
      <Note tone="warn">
        {error}{' '}
        <button type="button" onClick={onRetry} className="font-semibold underline">
          Try again
        </button>
      </Note>
    )
  }
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500">
      <Loader2 className="size-4 animate-spin" />
      Loading your PG…
    </div>
  )
}

// -------------------------------------------------------------- floors ----

export function FloorsStep({ ctx }: { ctx: StepContext }) {
  const toast = useToast()
  const { floors, error, reload } = useFloors(ctx.propertyId)
  const [count, setCount] = React.useState('3')
  const [fromGround, setFromGround] = React.useState(true)
  const [fieldError, setFieldError] = React.useState<string>()
  const [busy, setBusy] = React.useState(false)
  const initialised = React.useRef(false)

  React.useEffect(() => {
    if (!floors || initialised.current) return
    initialised.current = true
    if (floors.length > 0) {
      setCount(String(floors.length))
      setFromGround(floors.some((f) => f.level === 0))
    }
  }, [floors])

  if (!floors) return <Loading error={error} onRetry={reload} />

  const n = toInt(count)
  const toCreate = Number.isNaN(n) ? [] : missingFloorLevels(floors.map((f) => f.level), n, fromGround)

  async function next() {
    if (Number.isNaN(n) || n < 1 || n > 30) {
      setFieldError('Enter between 1 and 30 floors')
      return
    }
    setFieldError(undefined)
    setBusy(true)
    try {
      // Only the missing levels are created, so re-running never duplicates.
      for (const level of toCreate) {
        await api.post('/api/rooms', { action: 'ADD_FLOOR', propertyId: ctx.propertyId, name: floorName(level), level })
      }
      if (toCreate.length) toast.success(`${toCreate.length} floor${toCreate.length === 1 ? '' : 's'} added`)
      await ctx.advance()
    } catch (e) {
      toast.fromError(e, 'add the floors')
      void reload()
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <StepHeading title="Floors" body="How many floors have rooms for residents? You can rename or add floors later." />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Number of floors" required error={fieldError} htmlFor="floors">
          <Input
            id="floors"
            type="number"
            inputMode="numeric"
            min={1}
            max={30}
            value={count}
            onChange={(e) => setCount(e.target.value)}
            aria-invalid={Boolean(fieldError)}
          />
        </Field>
        <Field label="Starts from">
          <label className="flex h-11 items-center justify-between gap-3 rounded-xl border border-slate-200 px-3.5">
            <span className="text-sm text-slate-700">{fromGround ? 'Ground floor' : '1st floor'}</span>
            <Switch checked={fromGround} onCheckedChange={setFromGround} aria-label="Include ground floor" />
          </label>
        </Field>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium text-slate-500">Your floors</p>
        <div className="flex flex-wrap gap-2">
          {floors.map((f) => (
            <span key={f.id} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800">
              <Layers className="size-3.5" />
              {f.name}
            </span>
          ))}
          {toCreate.map((l) => (
            <span key={l} className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-blue-300 px-2.5 py-1 text-xs font-medium text-blue-700">
              <Plus className="size-3.5" />
              {floorName(l)}
            </span>
          ))}
          {floors.length === 0 && toCreate.length === 0 && <span className="text-sm text-slate-400">None yet</span>}
        </div>
      </div>

      <StepFooter
        onBack={ctx.back}
        onNext={next}
        busy={busy}
        nextLabel={toCreate.length ? `Add ${toCreate.length} floor${toCreate.length === 1 ? '' : 's'} & continue` : 'Next'}
      />
    </>
  )
}

// --------------------------------------------------------------- rooms ----

type Plan = { prefix: string; start: string; count: string; type: SharingType; capacity: string }

function capacityOf(type: SharingType) {
  return SHARING_OPTIONS.find((o) => o.type === type)?.capacity ?? 2
}

function freshPlan(floor: LiveFloor, type: SharingType): Plan {
  const used = floor.rooms.map((r) => parseInt(r.number.replace(/\D/g, ''), 10)).filter((x) => !Number.isNaN(x))
  const start = used.length ? Math.max(...used) + 1 : defaultStartNumber(floor.level)
  return { prefix: '', start: String(start), count: floor.rooms.length ? '0' : '4', type, capacity: String(capacityOf(type)) }
}

export function RoomsStep({ ctx }: { ctx: StepContext }) {
  const toast = useToast()
  const { floors, error, reload } = useFloors(ctx.propertyId)
  const offered = ((ctx.answers.sharingTypes as SharingType[] | undefined) ?? []).filter((t) =>
    SHARING_OPTIONS.some((o) => o.type === t),
  )
  const defaultType: SharingType = offered[0] ?? 'DOUBLE'
  const [plans, setPlans] = React.useState<Record<string, Plan>>({})
  const [errors, setErrors] = React.useState<Record<string, string | undefined>>({})
  const [busy, setBusy] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!floors) return
    setPlans((current) => {
      const next = { ...current }
      for (const f of floors) if (!next[f.id]) next[f.id] = freshPlan(f, defaultType)
      return next
    })
  }, [floors, defaultType])

  if (!floors) return <Loading error={error} onRetry={reload} />

  const totalRooms = floors.reduce((s, f) => s + f.rooms.length, 0)
  const typeChoices = SHARING_OPTIONS.filter((o) => offered.length === 0 || offered.includes(o.type))

  function update(floorId: string, patch: Partial<Plan>) {
    setPlans((p) => ({ ...p, [floorId]: { ...p[floorId], ...patch } }))
  }

  function validate(floorId: string): string | undefined {
    const p = plans[floorId]
    if (!p) return undefined
    const count = toInt(p.count)
    if (Number.isNaN(count) || count < 0 || count > 40) return 'Rooms: 0–40 per batch'
    if (count === 0) return undefined
    const start = toInt(p.start)
    if (Number.isNaN(start) || start < 1) return 'Start number must be 1 or more'
    if (p.prefix.length > 4) return 'Prefix: up to 4 characters'
    const cap = toInt(p.capacity)
    if (Number.isNaN(cap) || cap < 1 || cap > 12) return 'Beds per room: 1–12'
    return undefined
  }

  async function addFor(floor: LiveFloor) {
    const p = plans[floor.id]
    const count = toInt(p.count)
    const res = await api.post<{ created: number; skipped: number; message: string }>('/api/rooms', {
      action: 'BULK_ROOMS',
      propertyId: ctx.propertyId,
      floorId: floor.id,
      prefix: p.prefix.trim() || undefined,
      startNumber: toInt(p.start),
      count,
      capacity: toInt(p.capacity),
      type: p.type,
    })
    update(floor.id, { count: '0', start: String(toInt(p.start) + count) })
    return res
  }

  async function addNow(floor: LiveFloor) {
    const err = validate(floor.id)
    setErrors((e) => ({ ...e, [floor.id]: err }))
    if (err || toInt(plans[floor.id].count) === 0) return
    setBusy(floor.id)
    try {
      const res = await addFor(floor)
      toast.success(res.message, res.skipped ? `${res.skipped} already existed and were left as they are.` : undefined)
      await reload()
    } catch (e) {
      toast.fromError(e, 'add the rooms')
    } finally {
      setBusy(null)
    }
  }

  async function next() {
    if (!floors) return
    const errs = Object.fromEntries(floors.map((f) => [f.id, validate(f.id)]))
    setErrors(errs)
    if (Object.values(errs).some(Boolean)) return
    const pending = floors.filter((f) => toInt(plans[f.id]?.count ?? '0') > 0)
    const planned = pending.reduce((s, f) => s + toInt(plans[f.id].count), 0)
    if (totalRooms + planned === 0) {
      toast.error('Add at least one room', 'Set how many rooms each floor has.')
      return
    }
    setBusy('next')
    try {
      for (const f of pending) await addFor(f)
      await ctx.advance()
    } catch (e) {
      toast.fromError(e, 'add the rooms')
      void reload()
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <StepHeading
        title="Rooms"
        body="Add rooms floor by floor. Beds are created automatically from the sharing type — a 3-sharing room gets beds A, B and C."
      />
      {floors.length === 0 && (
        <Note tone="warn">
          No floors yet.{' '}
          <button type="button" className="font-semibold underline" onClick={() => ctx.goTo('floors')}>
            Add floors first
          </button>
        </Note>
      )}
      <div className="space-y-3">
        {floors.map((f) => {
          const p = plans[f.id]
          if (!p) return null
          const count = toInt(p.count)
          const preview = !Number.isNaN(count) && count > 0 ? plannedRoomNumbers(p.prefix.trim(), toInt(p.start), count) : []
          return (
            <div key={f.id} className="space-y-3 rounded-xl border border-slate-200 p-3.5 sm:p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="flex items-center gap-2 font-medium text-slate-900">
                  <Building className="size-4 text-slate-400" />
                  {f.name}
                </p>
                <span className="text-xs text-slate-500">
                  {f.rooms.length} room{f.rooms.length === 1 ? '' : 's'} · {f.rooms.reduce((s, r) => s + r.beds.length, 0)} beds
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-5">
                <Field label="Prefix" hint="Optional">
                  <Input value={p.prefix} maxLength={4} placeholder="A" onChange={(e) => update(f.id, { prefix: e.target.value })} />
                </Field>
                <Field label="Start no.">
                  <Input type="number" inputMode="numeric" value={p.start} onChange={(e) => update(f.id, { start: e.target.value })} />
                </Field>
                <Field label="Rooms">
                  <Input type="number" inputMode="numeric" min={0} max={40} value={p.count} onChange={(e) => update(f.id, { count: e.target.value })} />
                </Field>
                <Field label="Sharing">
                  <Select
                    value={p.type}
                    onChange={(e) => {
                      const type = e.target.value as SharingType
                      update(f.id, { type, capacity: String(capacityOf(type)) })
                    }}
                  >
                    {typeChoices.map((o) => (
                      <option key={o.type} value={o.type}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Beds/room" className="col-span-2 sm:col-span-1">
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={12}
                    value={p.capacity}
                    disabled={p.type !== 'DORM'}
                    onChange={(e) => update(f.id, { capacity: e.target.value })}
                  />
                </Field>
              </div>
              {errors[f.id] && <p className="text-xs font-medium text-rose-600">{errors[f.id]}</p>}
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="min-w-0 truncate text-xs text-slate-500">
                  {preview.length
                    ? `Will add ${preview[0]}${preview.length > 1 ? ` – ${preview[preview.length - 1]}` : ''} · ${preview.length * (toInt(p.capacity) || 0)} beds`
                    : f.rooms.length
                      ? `Rooms: ${f.rooms.map((r) => r.number).slice(0, 8).join(', ')}${f.rooms.length > 8 ? '…' : ''}`
                      : 'No rooms yet'}
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => addNow(f)}
                  loading={busy === f.id}
                  disabled={Boolean(busy) || !preview.length}
                >
                  <Plus className="size-3.5" />
                  Add now
                </Button>
              </div>
            </div>
          )
        })}
      </div>
      <Note>Existing room numbers are skipped, so it’s safe to run a batch again. Mixed floors? Add one batch, change the sharing type, add another.</Note>
      <StepFooter onBack={ctx.back} onNext={next} busy={busy === 'next'} />
    </>
  )
}

// ---------------------------------------------------------------- beds ----

export function BedsStep({ ctx }: { ctx: StepContext }) {
  const toast = useToast()
  const { floors, error, reload } = useFloors(ctx.propertyId)
  const [busy, setBusy] = React.useState(false)
  if (!floors) return <Loading error={error} onRetry={reload} />

  const rooms = floors.flatMap((f) => f.rooms)
  const beds = rooms.reduce((s, r) => s + r.beds.length, 0)
  const byType = SHARING_OPTIONS.map((o) => {
    const list = rooms.filter((r) => r.type === o.type)
    return { ...o, rooms: list.length, beds: list.reduce((s, r) => s + r.beds.length, 0) }
  }).filter((t) => t.rooms > 0)

  async function next() {
    if (beds === 0) {
      toast.error('No beds yet', 'Add rooms first — beds are created with them.')
      ctx.goTo('rooms')
      return
    }
    setBusy(true)
    try {
      await ctx.advance()
    } catch (e) {
      toast.fromError(e, 'save your progress')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <StepHeading title="Beds review" body="Here’s what you’ve built. Check the totals match your PG." />
      <div className="grid grid-cols-3 gap-2.5">
        {[
          { label: 'Floors', value: floors.length },
          { label: 'Rooms', value: rooms.length },
          { label: 'Beds', value: beds },
        ].map((s) => (
          <div key={s.label} className="rounded-xl bg-slate-50 p-3 text-center">
            <p className="font-display text-2xl font-semibold tabular-nums text-slate-900">{s.value}</p>
            <p className="text-xs text-slate-500">{s.label}</p>
          </div>
        ))}
      </div>
      {byType.length > 0 && (
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
          {byType.map((t) => (
            <li key={t.type} className="flex items-center justify-between px-3.5 py-2.5 text-sm">
              <span className="flex items-center gap-2 text-slate-700">
                <BedDouble className="size-4 text-slate-400" />
                {t.label}
              </span>
              <span className="tabular-nums text-slate-500">
                {t.rooms} rooms · {t.beds} beds
              </span>
            </li>
          ))}
        </ul>
      )}
      <ul className="space-y-1.5 text-sm">
        {floors.map((f) => (
          <li key={f.id} className="flex justify-between gap-3 text-slate-600">
            <span>{f.name}</span>
            <span className="tabular-nums">
              {f.rooms.length} rooms · {f.rooms.reduce((s, r) => s + r.beds.length, 0)} beds
            </span>
          </li>
        ))}
      </ul>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button variant="outline" size="sm" onClick={() => ctx.goTo('rooms')}>
          <Plus className="size-3.5" />
          Add more rooms
        </Button>
        {ctx.propertyId && (
          <Button variant="ghost" size="sm" asChild>
            <Link href={`/app/properties/${ctx.propertyId}`} target="_blank">
              <ExternalLink className="size-3.5" />
              Tweak rooms & beds in the room builder
            </Link>
          </Button>
        )}
      </div>
      <StepFooter onBack={ctx.back} onNext={next} busy={busy} nextLabel="Looks right" />
    </>
  )
}
