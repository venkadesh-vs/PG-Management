'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowRight, Check, Loader2 } from 'lucide-react'
import { api, ApiError } from '@/lib/client'
import { cn, formatMoney, toISODate } from '@/lib/utils'
import { checkBulkMeterRows, suggestMeterNumber } from '@/lib/electricity-setup'
import { useToast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, Input } from '@/components/ui/input'

export type SetupRoom = {
  id: string
  number: string
  floor: string
  people: number
  meterNumber: string | null
}

type Row = { include: boolean; meterNumber: string; initialReading: string }

const monthInput = (d: Date) => toISODate(d).slice(0, 7)

/**
 * First-time electricity setup for one PG, in three steps that stay ticked:
 * the rate per unit, every room's meter in one table, then "you're ready".
 */
export function ElectricitySetup({
  propertyId,
  propertyName,
  currentRate,
  rooms,
  canManage,
}: {
  propertyId: string
  propertyName: string
  currentRate: number | null
  rooms: SetupRoom[]
  canManage: boolean
}) {
  const router = useRouter()
  const toast = useToast()
  const pending = rooms.filter((r) => !r.meterNumber)
  const metered = rooms.length - pending.length
  const rateDone = currentRate !== null
  const metersDone = pending.length === 0 && metered > 0
  const [justFinished, setJustFinished] = React.useState(false)

  // ---------------------------------------------------------------- step 1
  const [rate, setRate] = React.useState('')
  const [fromMonth, setFromMonth] = React.useState(() => monthInput(new Date()))
  const [savingRate, setSavingRate] = React.useState(false)

  async function saveRate(e: React.FormEvent) {
    e.preventDefault()
    setSavingRate(true)
    try {
      await api.post('/api/electricity/rates', { propertyId, effectiveFrom: fromMonth, ratePerUnit: rate.trim() })
      toast.success('Rate saved', `₹${rate.trim()} per unit from ${fromMonth}`)
      router.refresh()
    } catch (error) {
      toast.error('Could not save the rate', error instanceof ApiError ? error.message : 'Please try again.')
    } finally {
      setSavingRate(false)
    }
  }

  // ---------------------------------------------------------------- step 2
  const [installedOn, setInstalledOn] = React.useState(() => toISODate(new Date()))
  const [rows, setRows] = React.useState<Record<string, Row>>(() =>
    Object.fromEntries(pending.map((r) => [r.id, { include: true, meterNumber: suggestMeterNumber(r.number), initialReading: '' }])),
  )
  const [serverErrors, setServerErrors] = React.useState<Record<string, string>>({})
  const [savingMeters, setSavingMeters] = React.useState(false)
  const inputs = React.useRef<Record<string, HTMLInputElement | null>>({})

  React.useEffect(() => {
    // Rooms added elsewhere since the last render get a row too.
    setRows((prev) => {
      const next = { ...prev }
      for (const r of pending) next[r.id] ??= { include: true, meterNumber: suggestMeterNumber(r.number), initialReading: '' }
      return next
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rooms])

  const chosen = pending.filter((r) => rows[r.id]?.include)
  const batch = chosen.map((r) => ({ roomId: r.id, roomNumber: r.number, meterNumber: rows[r.id].meterNumber, initialReading: rows[r.id].initialReading }))
  const problems = checkBulkMeterRows(batch)
  const ready = chosen.filter((r) => !problems[r.id]).length

  function update(roomId: string, patch: Partial<Row>) {
    setRows((prev) => ({ ...prev, [roomId]: { ...prev[roomId], ...patch } }))
    setServerErrors((prev) => {
      if (!prev[roomId]) return prev
      const next = { ...prev }
      delete next[roomId]
      return next
    })
  }

  /** Enter jumps to the next room's starting reading, like a spreadsheet. */
  function nextOnEnter(e: React.KeyboardEvent<HTMLInputElement>, roomId: string) {
    if (e.key !== 'Enter') return
    e.preventDefault()
    const order = chosen.map((r) => r.id)
    const next = order[order.indexOf(roomId) + 1]
    if (next) inputs.current[next]?.focus()
  }

  async function saveMeters() {
    if (!chosen.length || Object.keys(problems).length) return
    setSavingMeters(true)
    try {
      const result = await api.post<{ created: { roomId: string }[]; errors: { roomId: string; error: string }[]; message: string }>('/api/electricity/meters', {
        action: 'BULK',
        propertyId,
        installedOn,
        meters: batch.map(({ roomId, meterNumber, initialReading }) => ({ roomId, meterNumber: meterNumber.trim(), initialReading: initialReading.trim() })),
      })
      setServerErrors(Object.fromEntries(result.errors.map((e) => [e.roomId, e.error])))
      if (result.errors.length) toast.warning(result.message, 'Fix the rooms marked in red and save again.')
      else {
        toast.success(result.message, 'Every room is ready for this month’s readings.')
        setJustFinished(true)
      }
      router.refresh()
    } catch (error) {
      toast.error('Could not save the meters', error instanceof ApiError ? error.message : 'Please try again.')
    } finally {
      setSavingMeters(false)
    }
  }

  const floors = [...new Set(pending.map((r) => r.floor))]
  const showReady = (rateDone && metersDone) || justFinished

  return (
    <Card className="min-w-0">
      <CardHeader className="space-y-1">
        <CardTitle className="text-base">Set up electricity for {propertyName}</CardTitle>
        <p className="text-sm text-slate-500">Three quick steps, once. After that you only type each room’s reading once a month.</p>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* ---------------------------------------------- Step 1: rate */}
        <Step n={1} title="Price per unit" done={rateDone} summary={rateDone ? `₹${currentRate} per unit for this month` : undefined}>
          {canManage ? (
            <form onSubmit={saveRate} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
              <Field label="₹ per unit" htmlFor="setup-rate" hint="What the electricity board charges you, e.g. 13 or 13.50">
                <Input id="setup-rate" inputMode="decimal" placeholder="e.g. 13" value={rate} onChange={(e) => setRate(e.target.value.replace(/[^\d.]/g, ''))} required />
              </Field>
              <Field label="From month" htmlFor="setup-rate-month" hint="Older bills never change">
                <Input id="setup-rate-month" type="month" value={fromMonth} onChange={(e) => setFromMonth(e.target.value)} required />
              </Field>
              <Button type="submit" variant="primary" disabled={savingRate || !rate}>
                {savingRate && <Loader2 className="size-4 animate-spin" />}
                Save rate
              </Button>
            </form>
          ) : (
            <p className="text-sm text-slate-500">The PG owner sets the price per unit.</p>
          )}
        </Step>

        {/* ------------------------------------ Step 2: all room meters */}
        <Step
          n={2}
          title="Meters for every room"
          done={metersDone}
          summary={metersDone ? `${metered} room${metered === 1 ? '' : 's'} have a meter` : `${metered} of ${rooms.length} rooms have a meter`}
        >
          {!rooms.length ? (
            <p className="text-sm text-slate-500">
              This PG has no rooms yet.{' '}
              <Link href={`/app/properties/${propertyId}`} className="font-medium text-blue-700 hover:underline">
                Add rooms first
              </Link>
              .
            </p>
          ) : !canManage ? (
            <p className="text-sm text-slate-500">The PG owner adds the meters.</p>
          ) : pending.length === 0 ? null : (
            <div className="space-y-4">
              <p className="text-sm text-slate-600">
                Untick rooms that share one meter or have none. For the others, type the number printed on the meter and what it shows today.
              </p>
              <div className="grid gap-3 sm:max-w-xs">
                <Field label="Reading date (for all rooms)" htmlFor="setup-date">
                  <Input id="setup-date" type="date" value={installedOn} max={toISODate(new Date())} onChange={(e) => setInstalledOn(e.target.value)} />
                </Field>
              </div>

              {floors.map((floor) => (
                <div key={floor} className="space-y-2">
                  <p className="text-xs font-semibold text-slate-500">{floor}</p>
                  {/* Header row, wide screens only */}
                  <div className="hidden grid-cols-[6rem_5rem_6rem_minmax(0,1fr)_minmax(0,1fr)] gap-3 px-3 text-xs font-medium text-slate-500 md:grid">
                    <span>Room</span>
                    <span>People now</span>
                    <span>Own meter</span>
                    <span>Meter number</span>
                    <span>Starting reading</span>
                  </div>
                  <ul className="space-y-2">
                    {pending
                      .filter((r) => r.floor === floor)
                      .map((r) => {
                        const row = rows[r.id] ?? { include: true, meterNumber: suggestMeterNumber(r.number), initialReading: '' }
                        const problem = row.include ? serverErrors[r.id] ?? (row.initialReading || row.meterNumber.trim() === '' ? problems[r.id] : undefined) : undefined
                        return (
                          <li
                            key={r.id}
                            className={cn(
                              'grid grid-cols-2 gap-3 rounded-xl border bg-white p-3 md:grid-cols-[6rem_5rem_6rem_minmax(0,1fr)_minmax(0,1fr)] md:items-center',
                              problem ? 'border-rose-200' : row.include && !problems[r.id] ? 'border-emerald-200' : 'border-slate-200',
                              !row.include && 'opacity-60',
                            )}
                          >
                            <span className="text-sm font-semibold text-slate-900">Room {r.number}</span>
                            <span className="text-right text-sm text-slate-600 md:text-left">
                              {r.people} <span className="md:hidden">{r.people === 1 ? 'person' : 'people'} now</span>
                            </span>
                            <label className="col-span-2 flex items-center gap-2 text-sm text-slate-700 md:col-span-1">
                              <input
                                type="checkbox"
                                className="size-4 accent-blue-600"
                                checked={row.include}
                                onChange={(e) => update(r.id, { include: e.target.checked })}
                                aria-label={`Room ${r.number} has its own meter`}
                              />
                              <span className="md:sr-only">Has its own meter</span>
                            </label>
                            <Input
                              aria-label={`Meter number for room ${r.number}`}
                              value={row.meterNumber}
                              disabled={!row.include}
                              onChange={(e) => update(r.id, { meterNumber: e.target.value })}
                              className="col-span-2 font-mono md:col-span-1"
                            />
                            <Input
                              ref={(el) => {
                                inputs.current[r.id] = el
                              }}
                              aria-label={`Starting reading for room ${r.number}`}
                              inputMode="decimal"
                              placeholder="Reading today"
                              value={row.initialReading}
                              disabled={!row.include}
                              onKeyDown={(e) => nextOnEnter(e, r.id)}
                              onChange={(e) => update(r.id, { initialReading: e.target.value.replace(/[^\d.]/g, '') })}
                              className="col-span-2 tabular-nums md:col-span-1"
                            />
                            {problem && <p className="col-span-2 text-xs text-rose-600 md:col-span-5">{problem}</p>}
                          </li>
                        )
                      })}
                  </ul>
                </div>
              ))}

              <div className="sticky bottom-20 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white/95 p-3 shadow-sm backdrop-blur md:bottom-4">
                <p className="text-sm text-slate-700">
                  <span className="font-semibold text-slate-900">
                    {ready} of {chosen.length}
                  </span>{' '}
                  room{chosen.length === 1 ? '' : 's'} ready
                  {metered > 0 && <span className="text-slate-500"> · {metered} already set up</span>}
                </p>
                <Button variant="primary" onClick={saveMeters} disabled={savingMeters || !chosen.length || ready !== chosen.length}>
                  {savingMeters ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                  Save all meters
                </Button>
              </div>
            </div>
          )}
        </Step>

        {/* ------------------------------------------ Step 3: ready */}
        <Step n={3} title="You’re ready" done={showReady}>
          <div className="space-y-3 text-sm text-slate-600">
            <p>Once a month, read every room’s meter and type the numbers on the Electricity page. StayFlow does the rest:</p>
            <ol className="list-decimal space-y-1 pl-5">
              <li>Units used = this month’s reading − last month’s.</li>
              <li>Room bill = units × your price per unit.</li>
              <li>The bill is shared only by the people who actually stayed, by their days in the room.</li>
              <li>Each share is added to that person’s next rent invoice.</li>
            </ol>
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-slate-700">
              Example: 1,250 → 1,340 is 90 units. At ₹13 that’s {formatMoney(1170)}; three people who stayed all month pay {formatMoney(390)} each.
            </p>
            {showReady && (
              <Button variant="primary" onClick={() => router.push(`/app/electricity?property=${propertyId}`)}>
                Enter this month’s readings
                <ArrowRight className="size-4" />
              </Button>
            )}
          </div>
        </Step>
      </CardContent>
    </Card>
  )
}

function Step({ n, title, done, summary, children }: { n: number; title: string; done: boolean; summary?: string; children: React.ReactNode }) {
  return (
    <section className={cn('rounded-xl border p-4', done ? 'border-emerald-200 bg-emerald-50/40' : 'border-slate-200 bg-white')}>
      <div className="flex items-center gap-3">
        <span
          className={cn(
            'flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold',
            done ? 'bg-emerald-600 text-white' : 'bg-blue-600 text-white',
          )}
          aria-hidden
        >
          {done ? <Check className="size-4" /> : n}
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-900">
            Step {n} · {title}
          </h3>
          {summary && <p className="text-xs text-slate-500">{summary}</p>}
        </div>
      </div>
      {(!done || n === 3) && <div className="mt-4">{children}</div>}
      {done && n === 2 && <div className="mt-2">{children}</div>}
    </section>
  )
}
