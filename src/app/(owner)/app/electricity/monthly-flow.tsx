'use client'

import * as React from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { AlertTriangle, ChevronDown, Eye, FileCheck2, Gauge, Loader2, Sparkles } from 'lucide-react'
import { api, ApiError } from '@/lib/client'
import { cn, formatDate, formatMoney, toISODate } from '@/lib/utils'
import { useToast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Field, Input, Select } from '@/components/ui/input'
import { PhotoUpload } from '@/components/app/photo-upload'
import type { ElectricityBillRow } from './page'

type Meter = {
  id: string
  meterNumber: string
  roomNumber: string
  floor: string
  lastReading: { value: number; date: string } | null
}

type PreviewShare = {
  residentId: string
  residentName: string
  bedLabel: string | null
  daysStayed: number
  share: number
  collectible: boolean
}

type PreviewRow = {
  meterId: string
  meterNumber: string
  roomNumber: string
  periodStart: string
  periodEnd: string
  previousReading: number
  currentReading: number
  units: number
  ratePerUnit: number
  amount: number
  occupantCount: number
  periodDays: number
  ownerAbsorbed: boolean
  shares: PreviewShare[]
  uncollectedAmount: number
  warnings: string[]
}

type Preview = {
  rows: PreviewRow[]
  errors: { meterId: string; roomNumber: string; error: string }[]
  totals: { units: number; amount: number; residents: number }
}

type Entry = { value: string; photos: string[]; ownerAbsorbs: boolean }

const EMPTY_ENTRY: Entry = { value: '', photos: [], ownerAbsorbs: false }

const SPLIT_TEXT: Record<string, string> = {
  DAYS_STAYED: 'Shared by the people who stayed, in proportion to their days in the room.',
  EQUAL_PRESENT: 'Shared equally by the people living in the room on the reading date.',
}
const MODE_TEXT: Record<string, string> = {
  NEXT_RENT_INVOICE: "Each share is added to the resident's next rent invoice.",
  SEPARATE_INVOICE: 'Each resident gets a separate electricity bill when you finalize.',
}

const units = (n: number) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 }).format(n)
const rate = (n: number) => `₹${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(n)}`

/**
 * The monthly routine: enter each room's reading → preview → save drafts →
 * finalize. Nothing is charged until bills are finalized.
 */
export function MonthlyFlow({
  propertyId,
  propertyName,
  month,
  monthOptions,
  meters,
  drafts,
  canReadings,
  canManage,
  splitMethod,
  billingMode,
}: {
  propertyId: string
  propertyName: string
  month: string
  monthOptions: { value: string; label: string }[]
  meters: Meter[]
  drafts: ElectricityBillRow[]
  canReadings: boolean
  canManage: boolean
  splitMethod: string
  billingMode: string
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const toast = useToast()
  const [entries, setEntries] = React.useState<Record<string, Entry>>({})
  const [readingDate, setReadingDate] = React.useState(() => toISODate(new Date()))
  const [rateOverride, setRateOverride] = React.useState('')
  const [preview, setPreview] = React.useState<Preview | null>(null)
  const [busy, setBusy] = React.useState<'preview' | 'generate' | 'finalize' | null>(null)
  const [uploading, setUploading] = React.useState(false)
  const [selected, setSelected] = React.useState<string[]>(() => drafts.map((d) => d.id))

  React.useEffect(() => setSelected(drafts.map((d) => d.id)), [drafts])

  const filled = meters.filter((m) => entries[m.id]?.value.trim())
  const errorFor = (meterId: string) => preview?.errors.find((e) => e.meterId === meterId)?.error
  const step = drafts.length ? 3 : preview ? 2 : 1

  function update(meterId: string, patch: Partial<Entry>) {
    setEntries((prev) => ({ ...prev, [meterId]: { ...EMPTY_ENTRY, ...prev[meterId], ...patch } }))
    setPreview(null)
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
      ...(rateOverride.trim() ? { ratePerUnit: rateOverride.trim() } : {}),
      readings: filled.map((m) => ({
        meterId: m.id,
        value: entries[m.id].value.trim(),
        photoUrl: entries[m.id].photos[0] ?? '',
        ownerAbsorbs: entries[m.id].ownerAbsorbs || undefined,
      })),
    }
  }

  async function runPreview() {
    if (!filled.length) {
      toast.warning('Enter at least one reading', 'Type the number shown on the room meter.')
      return
    }
    setBusy('preview')
    try {
      const result = await api.post<{ preview: Preview }>('/api/electricity/bills', body('PREVIEW'))
      setPreview(result.preview)
      if (result.preview.errors.length) {
        toast.warning(`${result.preview.errors.length} room${result.preview.errors.length === 1 ? '' : 's'} need attention`, 'See the notes under each room.')
      }
    } catch (error) {
      toast.error('Could not work out the bills', error instanceof ApiError ? error.message : 'Please try again.')
    } finally {
      setBusy(null)
    }
  }

  async function generate() {
    setBusy('generate')
    try {
      const result = await api.post<{ message: string; errors: unknown[] }>('/api/electricity/bills', body('GENERATE'))
      toast.success('Drafts saved', result.message)
      setEntries({})
      setPreview(null)
      router.refresh()
    } catch (error) {
      toast.error('Could not save the drafts', error instanceof ApiError ? error.message : 'Please try again.')
    } finally {
      setBusy(null)
    }
  }

  async function finalize() {
    if (!selected.length) return
    setBusy('finalize')
    try {
      const result = await api.post<{ message: string }>('/api/electricity/bills', { action: 'FINALIZE', billIds: selected })
      toast.success('Bills finalized', `${result.message}. ${MODE_TEXT[billingMode] ?? ''}`)
      router.refresh()
    } catch (error) {
      toast.error('Could not finalize', error instanceof ApiError ? error.message : 'Please try again.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card className="min-w-0">
      <CardHeader className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="text-base">Monthly billing · {propertyName}</CardTitle>
            <p className="mt-1 text-sm text-slate-500">{SPLIT_TEXT[splitMethod]} {MODE_TEXT[billingMode]}</p>
          </div>
          <Select value={month} onChange={(e) => changeMonth(e.target.value)} className="w-auto" aria-label="Billing month">
            {monthOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </div>
        <ol className="grid grid-cols-3 gap-2 text-xs font-medium" aria-label="Steps">
          {['Enter readings', 'Check the split', 'Finalize'].map((label, i) => (
            <li
              key={label}
              className={cn(
                'flex items-center gap-2 rounded-lg border px-2.5 py-2',
                step === i + 1 ? 'border-blue-200 bg-blue-50 text-blue-700' : step > i + 1 ? 'border-slate-200 text-slate-500' : 'border-slate-200 text-slate-400',
              )}
              aria-current={step === i + 1 ? 'step' : undefined}
            >
              <span className={cn('flex size-5 shrink-0 items-center justify-center rounded-full text-[11px]', step === i + 1 ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-500')}>
                {i + 1}
              </span>
              <span className="truncate">{label}</span>
            </li>
          ))}
        </ol>
      </CardHeader>

      <CardContent className="space-y-5">
        {/* -------------------------------------------- Step 3: drafts */}
        {drafts.length > 0 && (
          <section className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  {drafts.length} draft bill{drafts.length === 1 ? '' : 's'} waiting
                </h3>
                <p className="text-xs text-slate-600">Check them, then finalize. Finalized bills are locked and charged to residents.</p>
              </div>
              {canManage ? (
                <Button variant="primary" onClick={finalize} disabled={busy !== null || !selected.length}>
                  {busy === 'finalize' ? <Loader2 className="size-4 animate-spin" /> : <FileCheck2 className="size-4" />}
                  Finalize {selected.length} bill{selected.length === 1 ? '' : 's'}
                </Button>
              ) : (
                <Badge variant="warning">The PG owner finalizes these</Badge>
              )}
            </div>
            <ul className="space-y-2">
              {drafts.map((d) => (
                <li key={d.id} className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-3">
                  {canManage && (
                    <input
                      type="checkbox"
                      className="size-4 accent-blue-600"
                      checked={selected.includes(d.id)}
                      onChange={(e) => setSelected((s) => (e.target.checked ? [...s, d.id] : s.filter((x) => x !== d.id)))}
                      aria-label={`Select room ${d.roomNumber}`}
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-900">Room {d.roomNumber}</p>
                    <p className="text-xs text-slate-500">
                      {units(d.units)} units × {rate(d.ratePerUnit)} · {d.ownerAbsorbed ? 'paid by the owner' : `${d.occupantCount} sharing`}
                    </p>
                  </div>
                  <span className="text-sm font-semibold tabular-nums text-slate-900">{formatMoney(d.amount)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* ------------------------------------- Step 1: enter readings */}
        {canReadings ? (
          <section className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Reading date" htmlFor="reading-date" hint="The day you read the meters. Used for every room below.">
                <Input id="reading-date" type="date" value={readingDate} max={toISODate(new Date())} onChange={(e) => { setReadingDate(e.target.value); setPreview(null) }} />
              </Field>
              <Field label="Rate for this run (optional)" htmlFor="rate-override" hint="Leave empty to use the PG's rate for the month.">
                <Input id="rate-override" inputMode="decimal" placeholder="e.g. 13.50" value={rateOverride} onChange={(e) => { setRateOverride(e.target.value); setPreview(null) }} />
              </Field>
            </div>

            <ul className="space-y-3">
              {meters.map((m) => {
                const entry = entries[m.id] ?? EMPTY_ENTRY
                const row = preview?.rows.find((r) => r.meterId === m.id)
                const error = errorFor(m.id)
                const canAbsorb = Boolean(error && /owner pays/i.test(error)) || entry.ownerAbsorbs
                return (
                  <li key={m.id} className={cn('rounded-xl border bg-white p-4', error ? 'border-rose-200' : row ? 'border-emerald-200' : 'border-slate-200')}>
                    <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_12rem] md:items-start">
                      <div className="min-w-0 space-y-1">
                        <p className="text-sm font-semibold text-slate-900">
                          Room {m.roomNumber} <span className="font-normal text-slate-500">· {m.floor}</span>
                        </p>
                        <p className="text-xs text-slate-500">
                          Meter {m.meterNumber} · last reading{' '}
                          {m.lastReading ? (
                            <span className="font-medium tabular-nums text-slate-700">
                              {units(m.lastReading.value)} on {formatDate(m.lastReading.date)}
                            </span>
                          ) : (
                            'none yet'
                          )}
                        </p>
                      </div>
                      <Input
                        inputMode="decimal"
                        aria-label={`New reading for room ${m.roomNumber}`}
                        placeholder="New reading"
                        value={entry.value}
                        onChange={(e) => update(m.id, { value: e.target.value.replace(/[^\d.]/g, '') })}
                        className="tabular-nums"
                      />
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-3">
                      <PhotoUpload
                        value={entry.photos}
                        onChange={(photos) => update(m.id, { photos })}
                        purpose="OTHER"
                        max={1}
                        label="Meter photo"
                        onBusyChange={setUploading}
                      />
                      {canAbsorb && (
                        <label className="flex items-center gap-2 text-sm text-slate-700">
                          <input type="checkbox" className="size-4 accent-blue-600" checked={entry.ownerAbsorbs} onChange={(e) => update(m.id, { ownerAbsorbs: e.target.checked })} />
                          Owner pays this room&apos;s bill
                        </label>
                      )}
                    </div>

                    {error && (
                      <p role="alert" className="mt-3 flex items-start gap-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
                        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                        {error}
                      </p>
                    )}
                    {row && <PreviewDetail row={row} />}
                  </li>
                )
              })}
            </ul>

            {/* ------------------------------- Step 2: preview totals */}
            {preview && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-sm text-slate-700">
                  <span className="font-semibold text-slate-900">{formatMoney(preview.totals.amount)}</span> for {units(preview.totals.units)} units across {preview.rows.length} room
                  {preview.rows.length === 1 ? '' : 's'}, shared by {preview.totals.residents} resident{preview.totals.residents === 1 ? '' : 's'}.
                  {preview.errors.length > 0 && ` ${preview.errors.length} room${preview.errors.length === 1 ? ' is' : 's are'} skipped until fixed.`}
                </p>
                <Button variant="primary" onClick={generate} disabled={busy !== null || uploading || !preview.rows.length}>
                  {busy === 'generate' ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                  Save as drafts
                </Button>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Button variant={preview ? 'outline' : 'primary'} onClick={runPreview} disabled={busy !== null || uploading || !filled.length}>
                {busy === 'preview' ? <Loader2 className="size-4 animate-spin" /> : <Eye className="size-4" />}
                {preview ? 'Preview again' : 'Preview the bills'}
              </Button>
            </div>
          </section>
        ) : (
          <p className="flex items-center gap-2 text-sm text-slate-500">
            <Gauge className="size-4" />
            Your role can see electricity bills but not enter readings.
          </p>
        )}
      </CardContent>
    </Card>
  )
}

function PreviewDetail({ row }: { row: PreviewRow }) {
  const [open, setOpen] = React.useState(false)
  return (
    <div className="mt-3 space-y-2 rounded-lg border border-emerald-100 bg-emerald-50/40 p-3">
      <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <Metric label="Units" value={`${units(row.previousReading)} → ${units(row.currentReading)} = ${units(row.units)}`} />
        <Metric label="Rate" value={`${rate(row.ratePerUnit)} / unit`} />
        <Metric label="Room bill" value={formatMoney(row.amount)} />
        <Metric label={row.ownerAbsorbed ? 'Paid by' : 'Sharing'} value={row.ownerAbsorbed ? 'Owner' : `${row.occupantCount} people`} />
      </div>
      {row.warnings.map((w) => (
        <p key={w} className="flex items-start gap-2 text-xs text-amber-800">
          <AlertTriangle className="mt-px size-3.5 shrink-0" />
          {w}
        </p>
      ))}
      {row.shares.length > 0 && (
        <>
          <button type="button" onClick={() => setOpen((o) => !o)} className="flex items-center gap-1 text-xs font-medium text-blue-700" aria-expanded={open}>
            <ChevronDown className={cn('size-3.5 transition', open && 'rotate-180')} />
            {open ? 'Hide' : 'Show'} who pays what · {formatDate(row.periodStart)} to {formatDate(row.periodEnd)} ({row.periodDays} days)
          </button>
          {open && (
            <ul className="divide-y divide-slate-100 rounded-md bg-white">
              {row.shares.map((s) => (
                <li key={s.residentId} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                  <span className="min-w-0 truncate text-slate-700">
                    {s.residentName}
                    {s.bedLabel ? ` · bed ${s.bedLabel}` : ''}
                    <span className="text-slate-500"> · {s.daysStayed} day{s.daysStayed === 1 ? '' : 's'}</span>
                    {!s.collectible && <Badge size="sm" className="ml-2">Owner pays</Badge>}
                  </span>
                  <span className="font-medium tabular-nums text-slate-900">{formatMoney(s.share)}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-medium text-slate-500">{label}</p>
      <p className="truncate font-medium tabular-nums text-slate-900">{value}</p>
    </div>
  )
}
