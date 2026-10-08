'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, Loader2 } from 'lucide-react'
import { api, ApiError } from '@/lib/client'
import { cn, formatDate, toISODate } from '@/lib/utils'
import { liveEstimate } from '@/lib/electricity-setup'
import { useToast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/input'
import { PhotoUpload } from '@/components/app/photo-upload'

export type WorkerMeter = {
  id: string
  roomNumber: string
  floor: string
  meterNumber: string
  baseline: { value: number; date: string } | null
  pending: { value: number; date: string } | null
}

type Result = { ok: boolean; message: string }

const units = (n: number) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 }).format(n)

/**
 * Every room on one screen: type what each meter shows, then save them all.
 * The owner checks the split and adds it to rent; staff only record readings.
 */
export function ReadingForm({ meters }: { meters: WorkerMeter[] }) {
  const router = useRouter()
  const toast = useToast()
  const [readingDate, setReadingDate] = React.useState(() => toISODate(new Date()))
  const [values, setValues] = React.useState<Record<string, string>>({})
  const [results, setResults] = React.useState<Record<string, Result>>({})
  const [photos, setPhotos] = React.useState<Record<string, string[]>>({})
  const [uploading, setUploading] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const inputs = React.useRef<Record<string, HTMLInputElement | null>>({})

  const typed = meters.filter((m) => (values[m.id] ?? '').trim())
  const problems = typed.filter((m) => {
    const est = m.baseline ? liveEstimate(m.baseline.value, values[m.id], null) : null
    return est?.state === 'lower' || est?.state === 'invalid'
  })
  const doneCount = meters.filter((m) => m.pending || results[m.id]?.ok).length

  function nextOnEnter(e: React.KeyboardEvent<HTMLInputElement>, id: string) {
    if (e.key !== 'Enter') return
    e.preventDefault()
    const order = meters.map((m) => m.id)
    const next = order[order.indexOf(id) + 1]
    if (next) inputs.current[next]?.focus()
  }

  async function saveAll() {
    setBusy(true)
    const next: Record<string, Result> = {}
    for (const m of typed) {
      try {
        await api.post('/api/electricity/readings', {
          meterId: m.id,
          // A reading already taken this cycle is corrected on its own date.
          readingDate: m.pending ? toISODate(new Date(m.pending.date)) : readingDate,
          value: values[m.id].trim(),
          photoUrl: photos[m.id]?.[0] ?? '',
        })
        next[m.id] = { ok: true, message: 'Saved' }
      } catch (error) {
        next[m.id] = { ok: false, message: error instanceof ApiError ? error.message : 'Could not save' }
      }
    }
    setResults((prev) => ({ ...prev, ...next }))
    const saved = Object.values(next).filter((r) => r.ok).length
    const failed = typed.length - saved
    if (saved) toast.success(`${saved} reading${saved === 1 ? '' : 's'} saved`, 'The PG owner will check and add them to rent.')
    if (failed) toast.warning(`${failed} room${failed === 1 ? '' : 's'} not saved`, 'See the note under each room.')
    setValues((prev) => Object.fromEntries(Object.entries(prev).filter(([id]) => !next[id]?.ok)))
    setPhotos((prev) => Object.fromEntries(Object.entries(prev).filter(([id]) => !next[id]?.ok)))
    setBusy(false)
    router.refresh()
  }

  return (
    <div className="space-y-4">
      <Field label="Reading date" htmlFor="reading-date" hint="The day you read the meters">
        <Input id="reading-date" type="date" value={readingDate} max={toISODate(new Date())} onChange={(e) => setReadingDate(e.target.value)} className="h-11" />
      </Field>

      <ul className="space-y-2">
        {meters.map((m) => {
          const value = values[m.id] ?? ''
          const est = m.baseline ? liveEstimate(m.baseline.value, value, null) : null
          const result = results[m.id]
          const wrong = est?.state === 'lower' || est?.state === 'invalid'
          return (
            <li key={m.id} className={cn('rounded-xl border bg-white p-3', wrong || (result && !result.ok) ? 'border-rose-200' : m.pending || result?.ok ? 'border-emerald-200' : 'border-slate-200')}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900">
                    Room {m.roomNumber} <span className="font-normal text-slate-500">· {m.floor}</span>
                  </p>
                  <p className="text-xs text-slate-500">
                    {m.meterNumber} · last {m.baseline ? `${units(m.baseline.value)} on ${formatDate(m.baseline.date)}` : 'none'}
                  </p>
                  {m.pending && (
                    <p className="mt-0.5 flex items-center gap-1 text-xs text-emerald-700">
                      <CheckCircle2 className="size-3.5" /> Read: {units(m.pending.value)} on {formatDate(m.pending.date)}
                    </p>
                  )}
                </div>
                <Input
                  ref={(el) => {
                    inputs.current[m.id] = el
                  }}
                  inputMode="decimal"
                  aria-label={`Reading for room ${m.roomNumber}`}
                  placeholder={m.pending ? 'Correct it' : 'Reading'}
                  value={value}
                  disabled={!m.baseline}
                  onKeyDown={(e) => nextOnEnter(e, m.id)}
                  onChange={(e) => setValues((prev) => ({ ...prev, [m.id]: e.target.value.replace(/[^\d.]/g, '') }))}
                  className="h-11 w-32 shrink-0 text-base tabular-nums"
                />
              </div>
              {est?.state === 'ok' && <p className="mt-1 text-xs text-slate-500">{units(est.units)} units used</p>}
              {value && (
                <div className="mt-2">
                  <PhotoUpload value={photos[m.id] ?? []} onChange={(p) => setPhotos((prev) => ({ ...prev, [m.id]: p }))} purpose="OTHER" max={1} label="Meter photo (optional)" onBusyChange={setUploading} />
                </div>
              )}
              {est?.state === 'lower' && <p className="mt-1 text-xs text-rose-600">Lower than last time. Check the meter again.</p>}
              {est?.state === 'invalid' && <p className="mt-1 text-xs text-rose-600">Numbers only, with at most one decimal.</p>}
              {result && !result.ok && <p className="mt-1 text-xs text-rose-600">{result.message}</p>}
            </li>
          )
        })}
      </ul>

      <div className="sticky bottom-20 z-10 flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white/95 p-3 shadow-sm backdrop-blur">
        <p className="text-sm text-slate-700">
          <span className="font-semibold text-slate-900">
            {doneCount} of {meters.length}
          </span>{' '}
          rooms read
        </p>
        <Button variant="primary" onClick={saveAll} disabled={busy || uploading || !typed.length || problems.length > 0}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
          Save {typed.length || ''} reading{typed.length === 1 ? '' : 's'}
        </Button>
      </div>
    </div>
  )
}
