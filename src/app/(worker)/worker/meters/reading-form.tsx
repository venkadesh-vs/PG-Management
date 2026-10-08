'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, Loader2 } from 'lucide-react'
import { api, ApiError } from '@/lib/client'
import { formatDate, toISODate } from '@/lib/utils'
import { useToast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Field, Input, Select } from '@/components/ui/input'
import { PhotoUpload } from '@/components/app/photo-upload'

type Meter = { id: string; label: string; meterNumber: string; last: { value: number; date: string } | null }

const units = (n: number) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 }).format(n)

/** One reading at a time, built for a phone at the meter board. */
export function ReadingForm({ meters }: { meters: Meter[] }) {
  const router = useRouter()
  const toast = useToast()
  const [meterId, setMeterId] = React.useState(meters[0]?.id ?? '')
  const [value, setValue] = React.useState('')
  const [readingDate, setReadingDate] = React.useState(() => toISODate(new Date()))
  const [photos, setPhotos] = React.useState<string[]>([])
  const [uploading, setUploading] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [saved, setSaved] = React.useState<string[]>([])

  const meter = meters.find((m) => m.id === meterId)
  const below = meter?.last && value !== '' && Number(value) < meter.last.value

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      await api.post('/api/electricity/readings', { meterId, readingDate, value, photoUrl: photos[0] ?? '' })
      toast.success('Reading saved', `${meter?.label}: ${value}`)
      setSaved((s) => [...s, meterId])
      setValue('')
      setPhotos([])
      // Move on to the next room not yet read.
      const next = meters.find((m) => m.id !== meterId && !saved.includes(m.id))
      if (next) setMeterId(next.id)
      router.refresh()
    } catch (error) {
      toast.error('Could not save the reading', error instanceof ApiError ? error.message : 'Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardContent className="p-4">
        <form onSubmit={submit} className="space-y-4">
          <Field label="Room" htmlFor="reading-room">
            <Select id="reading-room" value={meterId} onChange={(e) => setMeterId(e.target.value)}>
              {meters.map((m) => (
                <option key={m.id} value={m.id}>
                  {saved.includes(m.id) ? '✓ ' : ''}
                  {m.label}
                </option>
              ))}
            </Select>
          </Field>
          {meter && (
            <p className="text-sm text-slate-600">
              Meter <span className="font-mono">{meter.meterNumber}</span> · last reading{' '}
              {meter.last ? (
                <span className="font-medium tabular-nums text-slate-900">
                  {units(meter.last.value)} on {formatDate(meter.last.date)}
                </span>
              ) : (
                'none yet'
              )}
            </p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Reading" required htmlFor="reading-value" error={below ? 'Lower than the last reading. Check the number again.' : undefined}>
              <Input
                id="reading-value"
                inputMode="decimal"
                autoComplete="off"
                value={value}
                onChange={(e) => setValue(e.target.value.replace(/[^\d.]/g, ''))}
                className="h-12 text-lg tabular-nums"
              />
            </Field>
            <Field label="Date" htmlFor="reading-date">
              <Input id="reading-date" type="date" value={readingDate} max={toISODate(new Date())} onChange={(e) => setReadingDate(e.target.value)} className="h-12" />
            </Field>
          </div>
          <PhotoUpload value={photos} onChange={setPhotos} purpose="OTHER" max={1} label="Photo of the meter" onBusyChange={setUploading} />
          <Button type="submit" variant="primary" size="lg" className="w-full" disabled={busy || uploading || !meterId || !value || Boolean(below)}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
            Save reading
          </Button>
          {saved.length > 0 && (
            <p className="text-center text-xs text-slate-500">
              {saved.length} of {meters.length} rooms read today
            </p>
          )}
        </form>
      </CardContent>
    </Card>
  )
}
