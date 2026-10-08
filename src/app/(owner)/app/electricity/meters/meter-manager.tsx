'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { History, Loader2, MoreHorizontal, Plus, Repeat, Wrench, CheckCircle2 } from 'lucide-react'
import { api, ApiError } from '@/lib/client'
import { formatDate, toISODate } from '@/lib/utils'
import { useToast } from '@/components/ui/toast'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/feedback'
import { Field, Input, Select, Textarea } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown'

type Meter = {
  id: string
  meterNumber: string
  status: string
  installedOn: string
  initialReading: number
  notes: string | null
  propertyName: string
  propertyId: string
  roomId: string
  roomNumber: string
  floor: string
  lastReading: { value: number; date: string } | null
}
type RoomOption = { id: string; label: string; propertyId: string; propertyName: string }
type Reading = { id: string; readingDate: string; value: number; kind: string; photoUrl: string | null; note: string | null }

const STATUS: Record<string, { label: string; variant: 'success' | 'danger' | 'default' }> = {
  ACTIVE: { label: 'Active', variant: 'success' },
  FAULTY: { label: 'Faulty', variant: 'danger' },
  REPLACED: { label: 'Replaced', variant: 'default' },
}
const KIND: Record<string, string> = { INITIAL: 'Starting reading', REGULAR: 'Monthly', INTERIM: 'At checkout' }
const units = (n: number) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 }).format(n)

export function MeterManager({ meters, rooms, canManage }: { meters: Meter[]; rooms: RoomOption[]; canManage: boolean }) {
  const [adding, setAdding] = React.useState<{ roomId?: string; replace?: boolean } | null>(null)
  const [history, setHistory] = React.useState<Meter | null>(null)
  const metered = new Set(meters.filter((m) => m.status !== 'REPLACED').map((m) => m.roomId))
  const missing = rooms.filter((r) => !metered.has(r.id))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-600">
          {meters.filter((m) => m.status === 'ACTIVE').length} active meter{meters.filter((m) => m.status === 'ACTIVE').length === 1 ? '' : 's'}
          {missing.length > 0 && <span className="text-amber-700"> · {missing.length} room{missing.length === 1 ? '' : 's'} without a meter</span>}
        </p>
        {canManage && (
          <Button variant="primary" onClick={() => setAdding({})}>
            <Plus className="size-4" />
            Add meter
          </Button>
        )}
      </div>

      {!meters.length ? (
        <EmptyState icon="zap" title="No meters yet" description="Add each room's meter with the number printed on it and today's reading as the starting point." />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {meters.map((m) => {
            const status = STATUS[m.status] ?? STATUS.ACTIVE
            return (
              <li key={m.id} className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900">Room {m.roomNumber}</p>
                    <p className="truncate text-xs text-slate-500">
                      {m.propertyName} · {m.floor}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Badge variant={status.variant} size="sm">
                      {status.label}
                    </Badge>
                    <MeterMenu meter={m} canManage={canManage} onHistory={() => setHistory(m)} onReplace={() => setAdding({ roomId: m.roomId, replace: true })} />
                  </div>
                </div>
                <dl className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <dt className="text-[11px] font-medium text-slate-500">Meter number</dt>
                    <dd className="font-mono text-slate-900">{m.meterNumber}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] font-medium text-slate-500">Last reading</dt>
                    <dd className="tabular-nums text-slate-900">
                      {m.lastReading ? `${units(m.lastReading.value)} · ${formatDate(m.lastReading.date)}` : '—'}
                    </dd>
                  </div>
                </dl>
              </li>
            )
          })}
        </ul>
      )}

      <AddMeterDialog state={adding} rooms={rooms} onClose={() => setAdding(null)} />
      <HistoryDialog meter={history} onClose={() => setHistory(null)} />
    </div>
  )
}

function MeterMenu({ meter, canManage, onHistory, onReplace }: { meter: Meter; canManage: boolean; onHistory: () => void; onReplace: () => void }) {
  const router = useRouter()
  const toast = useToast()

  async function setStatus(status: 'ACTIVE' | 'FAULTY') {
    try {
      await api.patch('/api/electricity/meters', { meterId: meter.id, status })
      toast.success(status === 'FAULTY' ? 'Marked as faulty' : 'Marked as working', `Meter ${meter.meterNumber}`)
      router.refresh()
    } catch (error) {
      toast.error('Could not update the meter', error instanceof ApiError ? error.message : 'Please try again.')
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`Actions for meter ${meter.meterNumber}`}>
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onHistory}>
          <History />
          Reading history
        </DropdownMenuItem>
        {canManage && meter.status !== 'REPLACED' && (
          <>
            <DropdownMenuItem onSelect={onReplace}>
              <Repeat />
              Replace meter
            </DropdownMenuItem>
            {meter.status === 'ACTIVE' ? (
              <DropdownMenuItem onSelect={() => void setStatus('FAULTY')}>
                <Wrench />
                Mark as faulty
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onSelect={() => void setStatus('ACTIVE')}>
                <CheckCircle2 />
                Mark as working
              </DropdownMenuItem>
            )}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function AddMeterDialog({
  state,
  rooms,
  onClose,
}: {
  state: { roomId?: string; replace?: boolean } | null
  rooms: RoomOption[]
  onClose: () => void
}) {
  const router = useRouter()
  const toast = useToast()
  const [roomId, setRoomId] = React.useState('')
  const [meterNumber, setMeterNumber] = React.useState('')
  const [installedOn, setInstalledOn] = React.useState(() => toISODate(new Date()))
  const [initialReading, setInitialReading] = React.useState('')
  const [notes, setNotes] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    if (state) {
      setRoomId(state.roomId ?? '')
      setMeterNumber('')
      setInitialReading('')
      setNotes('')
      setInstalledOn(toISODate(new Date()))
    }
  }, [state])

  const room = rooms.find((r) => r.id === roomId)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!room) return
    setBusy(true)
    try {
      const result = await api.post<{ message?: string }>('/api/electricity/meters', {
        propertyId: room.propertyId,
        roomId,
        meterNumber,
        installedOn,
        initialReading,
        notes,
        replaceExisting: state?.replace || undefined,
      })
      toast.success(state?.replace ? 'Meter replaced' : 'Meter added', result?.message)
      onClose()
      router.refresh()
    } catch (error) {
      toast.error('Could not save the meter', error instanceof ApiError ? error.message : 'Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const byPg = [...new Set(rooms.map((r) => r.propertyName))]

  return (
    <Dialog open={Boolean(state)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{state?.replace ? 'Replace the meter' : 'Add a meter'}</DialogTitle>
            <DialogDescription>
              {state?.replace
                ? 'The old meter keeps its readings and bills. The new one starts from the reading you enter here.'
                : 'Enter the number printed on the meter and what it shows today. Billing starts from this reading.'}
            </DialogDescription>
          </DialogHeader>
          <Field label="Room" required htmlFor="meter-room">
            <Select id="meter-room" value={roomId} onChange={(e) => setRoomId(e.target.value)} disabled={Boolean(state?.replace)}>
              <option value="">Choose a room</option>
              {byPg.map((pg) => (
                <optgroup key={pg} label={pg}>
                  {rooms
                    .filter((r) => r.propertyName === pg)
                    .map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.label}
                      </option>
                    ))}
                </optgroup>
              ))}
            </Select>
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Meter number" required htmlFor="meter-number">
              <Input id="meter-number" value={meterNumber} onChange={(e) => setMeterNumber(e.target.value)} placeholder="As printed on the meter" />
            </Field>
            <Field label={state?.replace ? 'Fitted on' : 'Installed on'} required htmlFor="meter-date">
              <Input id="meter-date" type="date" value={installedOn} max={toISODate(new Date())} onChange={(e) => setInstalledOn(e.target.value)} />
            </Field>
          </div>
          <Field label="Starting reading" required htmlFor="meter-start" hint="The number on the meter on that day, up to one decimal place.">
            <Input id="meter-start" inputMode="decimal" value={initialReading} onChange={(e) => setInitialReading(e.target.value.replace(/[^\d.]/g, ''))} className="tabular-nums" />
          </Field>
          <Field label="Notes" htmlFor="meter-notes">
            <Textarea id="meter-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={busy || !roomId || !meterNumber.trim() || !initialReading}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              {state?.replace ? 'Replace meter' : 'Add meter'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function HistoryDialog({ meter, onClose }: { meter: Meter | null; onClose: () => void }) {
  const [readings, setReadings] = React.useState<Reading[] | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!meter) return
    let cancelled = false
    setReadings(null)
    setError(null)
    api
      .get<{ readings: Reading[] }>(`/api/electricity/readings?meterId=${encodeURIComponent(meter.id)}`)
      .then((r) => !cancelled && setReadings(r.readings))
      .catch((e) => !cancelled && setError(e instanceof ApiError ? e.message : 'Could not load the readings'))
    return () => {
      cancelled = true
    }
  }, [meter])

  return (
    <Dialog open={Boolean(meter)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Readings · meter {meter?.meterNumber}</DialogTitle>
          <DialogDescription>Room {meter?.roomNumber}. Newest first.</DialogDescription>
        </DialogHeader>
        {error ? (
          <p className="text-sm text-rose-700">{error}</p>
        ) : !readings ? (
          <p className="flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="size-4 animate-spin" /> Loading…
          </p>
        ) : !readings.length ? (
          <p className="text-sm text-slate-500">No readings yet.</p>
        ) : (
          <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
            {readings.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                <span className="text-slate-700">
                  {formatDate(r.readingDate)} <span className="text-xs text-slate-500">· {KIND[r.kind] ?? r.kind}</span>
                </span>
                <span className="flex items-center gap-2">
                  {r.photoUrl && (
                    <a href={r.photoUrl} target="_blank" rel="noopener" className="text-xs text-blue-700 underline-offset-2 hover:underline">
                      Photo
                    </a>
                  )}
                  <span className="font-medium tabular-nums text-slate-900">{units(r.value)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  )
}
