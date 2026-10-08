'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { AlertTriangle, Calculator, Camera, CheckCircle2, Loader2, PartyPopper } from 'lucide-react'
import { api, ApiError } from '@/lib/client'
import { cn, formatDate, formatMoney, toISODate } from '@/lib/utils'
import { liveEstimate } from '@/lib/electricity-setup'
import { useToast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, Input, Select } from '@/components/ui/input'
import { PhotoUpload } from '@/components/app/photo-upload'
import type { ElectricityBillRow } from './page'

export type MonthlyRoom = {
  meterId: string
  meterNumber: string
  roomNumber: string
  floor: string
  people: number
  /** The reading the bill starts from. */
  baseline: { value: number; date: string } | null
  /** A reading already typed this cycle (e.g. by the warden), not yet billed. */
  pending: { value: number; date: string } | null
}

type PreviewShare = { residentId: string; residentName: string; bedLabel: string | null; daysStayed: number; share: number; collectible: boolean }
type PreviewRow = {
  meterId: string
  roomNumber: string
  units: number
  ratePerUnit: number
  amount: number
  occupantCount: number
  periodDays: number
  ownerAbsorbed: boolean
  shares: PreviewShare[]
  warnings: string[]
}
type Preview = {
  rows: PreviewRow[]
  errors: { meterId: string; roomNumber: string; error: string }[]
  totals: { units: number; amount: number; residents: number }
}
type Entry = { value: string; photos: string[]; ownerAbsorbs: boolean }

const units = (n: number) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 }).format(n)
const rateText = (n: number) => `₹${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(n)}`

/**
 * The monthly routine on one screen: type each room's reading, see the
 * units and an estimate as you type, check the split, then add it to rent.
 */
export function MonthlyReadings({
  propertyId,
  propertyName,
  month,
  monthLabel,
  monthOptions,
  rate,
  rooms,
  drafts,
  roomsWithoutMeter,
  canReadings,
  canManage,
  splitText,
  modeText,
}: {
  propertyId: string
  propertyName: string
  month: string
  monthLabel: string
  monthOptions: { value: string; label: string }[]
  rate: number | null
  rooms: MonthlyRoom[]
  drafts: ElectricityBillRow[]
  roomsWithoutMeter: number
  canReadings: boolean
  canManage: boolean
  splitText: string
  modeText: string
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const toast = useToast()
  const [readingDate, setReadingDate] = React.useState(() => toISODate(new Date()))
  const [entries, setEntries] = React.useState<Record<string, Entry>>(() =>
    Object.fromEntries(rooms.filter((r) => r.pending).map((r) => [r.meterId, { value: String(r.pending!.value), photos: [], ownerAbsorbs: false }])),
  )
  const [preview, setPreview] = React.useState<Preview | null>(null)
  const [busy, setBusy] = React.useState<'preview' | 'confirm' | 'draft' | 'drafts' | null>(null)
  const [uploading, setUploading] = React.useState(false)
  const [done, setDone] = React.useState<{ amount: number; residents: number; rooms: number; finalized: boolean } | null>(null)
  const inputs = React.useRef<Record<string, HTMLInputElement | null>>({})

  const entryOf = (id: string): Entry => entries[id] ?? { value: '', photos: [], ownerAbsorbs: false }
  const estimates = rooms.map((r) => ({ room: r, est: r.baseline ? liveEstimate(r.baseline.value, entryOf(r.meterId).value, rate) : null }))
  const entered = estimates.filter((e) => e.est?.state === 'ok')
  const hasProblems = estimates.some((e) => e.est?.state === 'lower' || e.est?.state === 'invalid')
  const liveUnits = entered.reduce((s, e) => s + (e.est?.state === 'ok' ? e.est.units : 0), 0)
  const liveAmount = entered.reduce((s, e) => s + (e.est?.state === 'ok' && e.est.amount !== null ? e.est.amount : 0), 0)

  function update(meterId: string, patch: Partial<Entry>) {
    setEntries((prev) => ({ ...prev, [meterId]: { ...entryOf(meterId), ...patch } }))
    setPreview(null)
  }

  function nextOnEnter(e: React.KeyboardEvent<HTMLInputElement>, meterId: string) {
    if (e.key !== 'Enter') return
    e.preventDefault()
    const order = rooms.map((r) => r.meterId)
    const next = order[order.indexOf(meterId) + 1]
    if (next) inputs.current[next]?.focus()
  }

  function changeMonth(next: string) {
    const params = new URLSearchParams(searchParams.toString())
    params.set('month', next)
    router.push(`/app/electricity?${params.toString()}`, { scroll: false })
  }

  function body(action: 'PREVIEW' | 'GENERATE') {
    return {
      action,
      propertyId,
      billingMonth: month,
      readingDate,
      readings: entered.map(({ room }) => ({
        meterId: room.meterId,
        value: entryOf(room.meterId).value.trim(),
        // A reading already saved this cycle (e.g. by the warden) keeps its date,
        // so a correction replaces it instead of starting a second period.
        ...(room.pending ? { readingDate: toISODate(new Date(room.pending.date)) } : {}),
        photoUrl: entryOf(room.meterId).photos[0] ?? '',
        ownerAbsorbs: entryOf(room.meterId).ownerAbsorbs || undefined,
      })),
    }
  }

  async function calculate() {
    setBusy('preview')
    try {
      const result = await api.post<{ preview: Preview }>('/api/electricity/bills', body('PREVIEW'))
      setPreview(result.preview)
      if (result.preview.errors.length) {
        const n = result.preview.errors.length
        toast.warning(`${n} room${n === 1 ? '' : 's'} need a look`, 'The reason is written under each room.')
      }
    } catch (error) {
      toast.error('Could not work out the split', error instanceof ApiError ? error.message : 'Please try again.')
    } finally {
      setBusy(null)
    }
  }

  /** Saves the bills and, for the owner, charges them straight away. */
  async function save(finalize: boolean) {
    if (!preview) return
    setBusy(finalize ? 'confirm' : 'draft')
    try {
      const created = await api.post<{ created: { billId: string; roomNumber: string; amount: number }[]; errors: { roomNumber: string; error: string }[] }>(
        '/api/electricity/bills',
        body('GENERATE'),
      )
      if (created.errors.length) {
        toast.warning(`${created.errors.length} room${created.errors.length === 1 ? '' : 's'} not saved`, created.errors.map((e) => `Room ${e.roomNumber}: ${e.error}`).join(' · '))
      }
      const billIds = created.created.map((c) => c.billId)
      if (finalize && billIds.length) {
        await api.post('/api/electricity/bills', { action: 'FINALIZE', billIds })
      }
      const roomsDone = new Set(created.created.map((c) => c.roomNumber))
      const rows = preview.rows.filter((r) => roomsDone.has(r.roomNumber))
      const charged = rows.flatMap((r) => r.shares.filter((s) => s.collectible))
      setDone({
        amount: charged.reduce((s, x) => s + x.share, 0),
        residents: new Set(charged.map((s) => s.residentId)).size,
        rooms: rows.length,
        finalized: finalize,
      })
      setEntries({})
      setPreview(null)
      router.refresh()
    } catch (error) {
      toast.error('Could not save', error instanceof ApiError ? error.message : 'Please try again.')
    } finally {
      setBusy(null)
    }
  }

  async function confirmDrafts() {
    setBusy('drafts')
    try {
      await api.post('/api/electricity/bills', { action: 'FINALIZE', billIds: drafts.map((d) => d.id) })
      const charged = drafts.flatMap((d) => d.shares)
      setDone({
        amount: charged.reduce((s, x) => s + x.shareAmount, 0),
        residents: new Set(charged.map((s) => s.residentId)).size,
        rooms: drafts.length,
        finalized: true,
      })
      router.refresh()
    } catch (error) {
      toast.error('Could not add to rent', error instanceof ApiError ? error.message : 'Please try again.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card className="min-w-0">
      <CardHeader className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="text-base">
              {monthLabel} readings · {propertyName}
            </CardTitle>
            <p className="mt-1 text-sm text-slate-500">
              {rate !== null ? (
                <>
                  Price this month: <span className="font-medium text-slate-900">{rateText(rate)} per unit</span>.{' '}
                </>
              ) : null}
              {splitText} {modeText}
            </p>
          </div>
          <Select value={month} onChange={(e) => changeMonth(e.target.value)} className="w-auto" aria-label="Billing month">
            {monthOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </div>
        {rate === null && (
          <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span>
              No price per unit for {monthLabel} yet.{' '}
              {canManage && (
                <Link href="/app/electricity/rates" className="font-medium underline">
                  Set the rate
                </Link>
              )}
            </span>
          </p>
        )}
        {roomsWithoutMeter > 0 && canManage && (
          <p className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
            <span>
              {roomsWithoutMeter} room{roomsWithoutMeter === 1 ? ' has' : 's have'} no meter yet.
            </span>
            <Link href={`/app/electricity?property=${propertyId}&setup=1`} className="font-medium text-blue-700 hover:underline">
              Add them all in one screen
            </Link>
          </p>
        )}
      </CardHeader>

      <CardContent className="space-y-4">
        {done && (
          <div className="flex flex-wrap items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4" role="status">
            <PartyPopper className="mt-0.5 size-5 shrink-0 text-emerald-700" />
            <div className="min-w-0 flex-1 text-sm text-emerald-900">
              {done.finalized ? (
                <p className="font-semibold">
                  {formatMoney(done.amount)} added to {done.residents} resident{done.residents === 1 ? '’s' : 's’'} next rent invoice{done.residents === 1 ? '' : 's'}.
                </p>
              ) : (
                <p className="font-semibold">
                  {done.rooms} room bill{done.rooms === 1 ? '' : 's'} saved as draft. Nothing is charged until you confirm.
                </p>
              )}
              <p className="text-emerald-800">
                <a href="#electricity-history" className="underline">
                  See the bills below
                </a>
              </p>
            </div>
          </div>
        )}

        {drafts.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50/60 p-4">
            <p className="text-sm text-slate-800">
              <span className="font-semibold">
                {drafts.length} room bill{drafts.length === 1 ? '' : 's'} saved, not yet charged
              </span>{' '}
              · {formatMoney(drafts.reduce((s, d) => s + d.amount, 0))}
            </p>
            {canManage ? (
              <Button variant="primary" onClick={confirmDrafts} disabled={busy !== null}>
                {busy === 'drafts' ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
                Confirm and add to rent
              </Button>
            ) : (
              <span className="text-xs text-slate-600">The PG owner confirms these.</span>
            )}
          </div>
        )}

        {!canReadings ? (
          <p className="text-sm text-slate-500">Your role can see electricity bills but not enter readings.</p>
        ) : (
          <>
            <div className="grid gap-3 sm:max-w-xs">
              <Field label="Reading date" htmlFor="reading-date" hint="The day you read the meters">
                <Input
                  id="reading-date"
                  type="date"
                  value={readingDate}
                  max={toISODate(new Date())}
                  onChange={(e) => {
                    setReadingDate(e.target.value)
                    setPreview(null)
                  }}
                />
              </Field>
            </div>

            <div className="hidden grid-cols-[minmax(0,1.2fr)_minmax(0,1.2fr)_minmax(0,1fr)_5rem_6rem_4rem] gap-3 px-3 text-xs font-medium text-slate-500 md:grid">
              <span>Room</span>
              <span>Last reading</span>
              <span>This month’s reading</span>
              <span className="text-right">Units</span>
              <span className="text-right">Amount</span>
              <span className="text-right">People</span>
            </div>
            <ul className="space-y-2">
              {estimates.map(({ room, est }) => {
                const entry = entryOf(room.meterId)
                const row = preview?.rows.find((r) => r.meterId === room.meterId)
                const error = preview?.errors.find((e) => e.meterId === room.meterId)?.error
                const lower = est?.state === 'lower'
                const canAbsorb = Boolean(error && /owner pays/i.test(error)) || entry.ownerAbsorbs
                return (
                  <li
                    key={room.meterId}
                    className={cn(
                      'rounded-xl border bg-white p-3',
                      error || lower ? 'border-rose-200' : row ? 'border-emerald-200' : 'border-slate-200',
                    )}
                  >
                    <div className="grid grid-cols-2 items-center gap-x-3 gap-y-2 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1.2fr)_minmax(0,1fr)_5rem_6rem_4rem]">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-900">Room {room.roomNumber}</p>
                        <p className="truncate text-xs text-slate-500">
                          {room.floor} · {room.meterNumber}
                        </p>
                      </div>
                      <p className="text-right text-xs text-slate-500 md:text-left">
                        {room.baseline ? (
                          <>
                            <span className="text-sm font-medium tabular-nums text-slate-800">{units(room.baseline.value)}</span>
                            <br />
                            {formatDate(room.baseline.date)}
                          </>
                        ) : (
                          'No starting reading'
                        )}
                      </p>
                      <div className="col-span-2 md:col-span-1">
                        <Input
                          ref={(el) => {
                            inputs.current[room.meterId] = el
                          }}
                          inputMode="decimal"
                          aria-label={`This month's reading for room ${room.roomNumber}`}
                          placeholder="Type the meter reading"
                          value={entry.value}
                          disabled={!room.baseline}
                          onKeyDown={(e) => nextOnEnter(e, room.meterId)}
                          onChange={(e) => update(room.meterId, { value: e.target.value.replace(/[^\d.]/g, '') })}
                          className={cn('tabular-nums', lower && 'border-rose-300')}
                        />
                        {room.pending && (
                          <p className="mt-1 text-[11px] text-slate-500">
                            Read on {formatDate(room.pending.date)}
                            {entry.value !== String(room.pending.value) && ` (was ${units(room.pending.value)})`}
                          </p>
                        )}
                      </div>
                      <p className="text-sm tabular-nums text-slate-700 md:text-right">
                        <span className="text-xs text-slate-500 md:hidden">Units </span>
                        {est?.state === 'ok' ? units(est.units) : '–'}
                      </p>
                      <p className="text-right text-sm font-semibold tabular-nums text-slate-900">
                        {est?.state === 'ok' && est.amount !== null ? formatMoney(est.amount) : '–'}
                      </p>
                      <p className="col-span-2 text-xs text-slate-500 md:col-span-1 md:text-right md:text-sm">
                        <span className="md:hidden">Living here now: </span>
                        {room.people}
                      </p>
                    </div>

                    {lower && room.baseline && (
                      <p className="mt-2 text-xs text-rose-600">Lower than last time ({units(room.baseline.value)}). Check the number on the meter.</p>
                    )}
                    {est?.state === 'invalid' && <p className="mt-2 text-xs text-rose-600">Numbers only, with at most one decimal.</p>}

                    {entry.value && (
                      <div className="mt-2 flex flex-wrap items-center gap-3">
                        <PhotoUpload value={entry.photos} onChange={(photos) => update(room.meterId, { photos })} purpose="OTHER" max={1} label="Meter photo (optional)" onBusyChange={setUploading} />
                        {canAbsorb && (
                          <label className="flex items-center gap-2 text-sm text-slate-700">
                            <input type="checkbox" className="size-4 accent-blue-600" checked={entry.ownerAbsorbs} onChange={(e) => update(room.meterId, { ownerAbsorbs: e.target.checked })} />
                            I’ll pay this room’s bill (nobody stayed)
                          </label>
                        )}
                      </div>
                    )}

                    {error && (
                      <p role="alert" className="mt-2 flex items-start gap-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
                        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                        {error}
                      </p>
                    )}
                    {row && <SplitSummary row={row} />}
                  </li>
                )
              })}
            </ul>

            {/* ------------------------------------------- sticky action bar */}
            <div className="sticky bottom-20 z-10 space-y-2 rounded-xl border border-slate-200 bg-white/95 p-3 shadow-sm backdrop-blur md:bottom-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-slate-700">
                  <span className="font-semibold text-slate-900">
                    {entered.length} of {rooms.length}
                  </span>{' '}
                  rooms entered
                  {entered.length > 0 && (
                    <span className="text-slate-500">
                      {' '}
                      · {units(liveUnits)} units{rate !== null ? ` · about ${formatMoney(liveAmount)}` : ''}
                    </span>
                  )}
                </p>
                {!preview ? (
                  <Button variant="primary" onClick={calculate} disabled={busy !== null || uploading || !entered.length || hasProblems}>
                    {busy === 'preview' ? <Loader2 className="size-4 animate-spin" /> : <Calculator className="size-4" />}
                    Calculate split
                  </Button>
                ) : (
                  <div className="flex flex-wrap items-center gap-3">
                    {canManage ? (
                      <>
                        <button type="button" className="text-sm font-medium text-slate-600 hover:text-slate-900" onClick={() => save(false)} disabled={busy !== null || !preview.rows.length}>
                          {busy === 'draft' ? 'Saving…' : 'Save as draft instead'}
                        </button>
                        <Button variant="primary" onClick={() => save(true)} disabled={busy !== null || !preview.rows.length}>
                          {busy === 'confirm' ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
                          Confirm and add to rent
                        </Button>
                      </>
                    ) : (
                      <Button variant="primary" onClick={() => save(false)} disabled={busy !== null || !preview.rows.length}>
                        {busy === 'draft' ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
                        Send to the owner to confirm
                      </Button>
                    )}
                  </div>
                )}
              </div>
              {preview && (
                <p className="text-xs text-slate-600">
                  {formatMoney(preview.totals.amount)} for {units(preview.totals.units)} units in {preview.rows.length} room{preview.rows.length === 1 ? '' : 's'}, shared by {preview.totals.residents} resident
                  {preview.totals.residents === 1 ? '' : 's'}.
                  {preview.errors.length > 0 && ` ${preview.errors.length} room${preview.errors.length === 1 ? ' is' : 's are'} left out until fixed.`}
                </p>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

/** Who pays what for one room, in plain words. */
function SplitSummary({ row }: { row: PreviewRow }) {
  return (
    <div className="mt-3 space-y-2 rounded-lg bg-slate-50 p-3">
      <p className="text-sm text-slate-700">
        {units(row.units)} units × {rateText(row.ratePerUnit)} = <span className="font-semibold text-slate-900">{formatMoney(row.amount)}</span>
        {row.ownerAbsorbed ? ' · paid by you' : ` · shared by ${row.occupantCount} over ${row.periodDays} days`}
      </p>
      {row.warnings.map((w) => (
        <p key={w} className="flex items-start gap-2 text-xs text-amber-800">
          <AlertTriangle className="mt-px size-3.5 shrink-0" />
          {w}
        </p>
      ))}
      {row.shares.length > 0 && (
        <ul className="divide-y divide-slate-200/70">
          {row.shares.map((s) => (
            <li key={s.residentId} className="flex items-center justify-between gap-2 py-1.5 text-sm">
              <span className="min-w-0 truncate text-slate-700">
                {s.residentName}
                <span className="text-slate-500">
                  {' '}
                  · {s.daysStayed} of {row.periodDays} days
                  {!s.collectible && ' · already left, you pay'}
                </span>
              </span>
              <span className="font-medium tabular-nums text-slate-900">{formatMoney(s.share)}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="flex items-center gap-1 text-[11px] text-slate-500">
        <Camera className="size-3" aria-hidden /> Readings and the split are saved with the bill, so later rate changes never alter it.
      </p>
    </div>
  )
}
