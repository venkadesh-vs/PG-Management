'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { AirVent, Layers, Plus, Rows3 } from 'lucide-react'
import { api, ApiError } from '@/lib/client'
import { cn, formatMoney } from '@/lib/utils'
import { PROPERTY_THEMES } from '@/lib/theme'
import { useToast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, Input, Select } from '@/components/ui/input'
import { Switch } from '@/components/ui/primitives'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/feedback'

type RoomRow = {
  id: string
  number: string
  type: string
  capacity: number
  baseRent: number | null
  hasAC: boolean
  bedCount: number
  occupied: number
}

type FloorRow = { id: string; name: string; level: number; rooms: RoomRow[] }

const CAPACITY_BY_TYPE: Record<string, number> = {
  SINGLE: 1,
  DOUBLE: 2,
  TRIPLE: 3,
  QUAD: 4,
  DORM: 6,
}

/**
 * Floor, room and bed setup. Beds are never created by hand — a room's
 * capacity creates them, which is what keeps bed counts honest.
 */
export function RoomBuilder({
  propertyId,
  propertyType,
  standardRent,
  floors,
  canManage = true,
}: {
  /** False hides every edit control (no properties.manage). */
  canManage?: boolean
  propertyId: string
  propertyType: 'MENS' | 'WOMENS' | 'COLIVE'
  standardRent: number
  floors: FloorRow[]
}) {
  const theme = PROPERTY_THEMES[propertyType]
  const [dialog, setDialog] = React.useState<'floor' | 'room' | 'bulk' | null>(null)

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="text-sm">Floors, rooms & beds</CardTitle>
          <p className="mt-0.5 text-xs text-slate-500">
            Adding a room automatically creates its beds from the capacity.
          </p>
        </div>
        {canManage && (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => setDialog('floor')}>
            <Layers className="size-3.5" />
            Add floor
          </Button>
          {floors.length > 0 && (
            <>
              <Button variant="outline" size="sm" onClick={() => setDialog('bulk')}>
                <Rows3 className="size-3.5" />
                Bulk add rooms
              </Button>
              <Button variant="primary" size="sm" onClick={() => setDialog('room')}>
                <Plus className="size-3.5" />
                Add room
              </Button>
            </>
          )}
        </div>
        )}
      </CardHeader>

      <CardContent>
        {floors.length === 0 ? (
          <EmptyState
            icon="building"
            title="No floors yet"
            description="Start with a floor — ground floor, first floor and so on — then add its rooms."
            action={
              canManage && (
                <Button variant="primary" size="sm" onClick={() => setDialog('floor')}>
                  <Layers className="size-3.5" />
                  Add the first floor
                </Button>
              )
            }
          />
        ) : (
          <div className="space-y-5">
            {floors.map((floor) => (
              <div key={floor.id} className="space-y-2">
                <div className="flex items-center gap-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {floor.name}
                  </h3>
                  <div className="h-px flex-1 bg-slate-100" />
                  <span className="text-[11px] text-slate-400">
                    {floor.rooms.length} rooms ·{' '}
                    {floor.rooms.reduce((s, r) => s + r.bedCount, 0)} beds
                  </span>
                </div>

                {floor.rooms.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-slate-200 p-4 text-center text-xs text-slate-400">
                    No rooms on this floor yet.
                  </p>
                ) : (
                  <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
                    {floor.rooms.map((room) => (
                      <motion.div
                        key={room.id}
                        initial={{ opacity: 0, scale: 0.96 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="rounded-xl border border-slate-200 bg-white p-3"
                      >
                        <div className="flex items-start justify-between">
                          <p className="font-display text-sm font-semibold text-slate-900">
                            {room.number}
                          </p>
                          {room.hasAC && <AirVent className="size-3.5 text-slate-400" />}
                        </div>
                        <p className="text-[11px] capitalize text-slate-500">
                          {room.type.toLowerCase()} · {room.bedCount} beds
                        </p>
                        <p className="mt-1 text-xs font-medium text-slate-700 tabular">
                          {formatMoney(room.baseRent ?? standardRent)}
                        </p>
                        <div className="mt-2 h-1 overflow-hidden rounded-full bg-slate-100">
                          <div
                            className={cn('h-full rounded-full', theme.bgSolid)}
                            style={{
                              width: `${room.bedCount ? (room.occupied / room.bedCount) * 100 : 0}%`,
                            }}
                          />
                        </div>
                      </motion.div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <FloorDialog
        open={dialog === 'floor'}
        onClose={() => setDialog(null)}
        propertyId={propertyId}
        nextLevel={floors.length + 1}
      />
      <RoomDialog
        open={dialog === 'room'}
        onClose={() => setDialog(null)}
        propertyId={propertyId}
        floors={floors}
        standardRent={standardRent}
      />
      <BulkRoomDialog
        open={dialog === 'bulk'}
        onClose={() => setDialog(null)}
        propertyId={propertyId}
        floors={floors}
        standardRent={standardRent}
      />
    </Card>
  )
}

function FloorDialog({
  open,
  onClose,
  propertyId,
  nextLevel,
}: {
  open: boolean
  onClose: () => void
  propertyId: string
  nextLevel: number
}) {
  const router = useRouter()
  const toast = useToast()
  const [name, setName] = React.useState('')
  const [level, setLevel] = React.useState(String(nextLevel))
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    if (open) {
      setLevel(String(nextLevel))
      setName(
        nextLevel === 1
          ? 'Ground Floor'
          : nextLevel === 2
            ? 'First Floor'
            : nextLevel === 3
              ? 'Second Floor'
              : `Floor ${nextLevel - 1}`,
      )
    }
  }, [open, nextLevel])

  async function submit() {
    setBusy(true)
    try {
      const result = await api.post<{ message: string }>('/api/rooms', {
        action: 'ADD_FLOOR',
        propertyId,
        name,
        level: Number(level),
      })
      toast.success('Floor added', result.message)
      onClose()
      router.refresh()
    } catch (error) {
      toast.error(
        'Unable to add this floor',
        error instanceof ApiError ? error.message : 'Please try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Add a floor</DialogTitle>
          <DialogDescription>Floors keep room numbers organised on the bed map.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-[1fr_100px]">
          <Field label="Floor name" required>
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </Field>
          <Field label="Level" required>
            <Input
              type="number"
              inputMode="numeric"
              value={level}
              onChange={(e) => setLevel(e.target.value)}
            />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={submit} disabled={!name}>
            Add floor
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RoomDialog({
  open,
  onClose,
  propertyId,
  floors,
  standardRent,
}: {
  open: boolean
  onClose: () => void
  propertyId: string
  floors: FloorRow[]
  standardRent: number
}) {
  const router = useRouter()
  const toast = useToast()
  const [floorId, setFloorId] = React.useState(floors[0]?.id ?? '')
  const [number, setNumber] = React.useState('')
  const [type, setType] = React.useState('DOUBLE')
  const [capacity, setCapacity] = React.useState('2')
  const [baseRent, setBaseRent] = React.useState(String(standardRent))
  const [hasAC, setHasAC] = React.useState(false)
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    setCapacity(String(CAPACITY_BY_TYPE[type] ?? 2))
  }, [type])

  async function submit() {
    setBusy(true)
    try {
      const result = await api.post<{ message: string }>('/api/rooms', {
        action: 'ADD_ROOM',
        propertyId,
        floorId,
        number,
        type,
        capacity: Number(capacity),
        baseRent: Number(baseRent),
        hasAC,
        hasBalcony: false,
        hasAttachedBath: true,
      })
      toast.success('Room added', result.message)
      setNumber('')
      onClose()
      router.refresh()
    } catch (error) {
      toast.error(
        'Unable to add this room',
        error instanceof ApiError ? error.message : 'Please try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Add a room</DialogTitle>
          <DialogDescription>
            {capacity} bed{Number(capacity) === 1 ? '' : 's'} will be created automatically, labelled
            A, B, C…
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Floor" required>
              <Select value={floorId} onChange={(e) => setFloorId(e.target.value)}>
                {floors.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Room number" required>
              <Input
                value={number}
                onChange={(e) => setNumber(e.target.value)}
                placeholder="204"
                autoFocus
              />
            </Field>
            <Field label="Room type" required>
              <Select value={type} onChange={(e) => setType(e.target.value)}>
                <option value="SINGLE">Single</option>
                <option value="DOUBLE">Double sharing</option>
                <option value="TRIPLE">Triple sharing</option>
                <option value="QUAD">Four sharing</option>
                <option value="DORM">Dormitory</option>
              </Select>
            </Field>
            <Field label="Beds" required>
              <Input
                type="number"
                inputMode="numeric"
                value={capacity}
                onChange={(e) => setCapacity(e.target.value)}
              />
            </Field>
          </div>
          <Field label="Rent for this room" hint="Overrides the PG's standard rent">
            <Input
              type="number"
              inputMode="numeric"
              value={baseRent}
              onChange={(e) => setBaseRent(e.target.value)}
            />
          </Field>
          <label className="flex items-center justify-between rounded-xl border border-slate-200 p-3">
            <span className="text-sm text-slate-700">Air conditioned</span>
            <Switch checked={hasAC} onCheckedChange={setHasAC} />
          </label>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={submit} disabled={!number || !floorId}>
            Add room
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function BulkRoomDialog({
  open,
  onClose,
  propertyId,
  floors,
  standardRent,
}: {
  open: boolean
  onClose: () => void
  propertyId: string
  floors: FloorRow[]
  standardRent: number
}) {
  const router = useRouter()
  const toast = useToast()
  const [floorId, setFloorId] = React.useState(floors[0]?.id ?? '')
  const [prefix, setPrefix] = React.useState('')
  const [start, setStart] = React.useState('101')
  const [count, setCount] = React.useState('6')
  const [type, setType] = React.useState('DOUBLE')
  const [baseRent, setBaseRent] = React.useState(String(standardRent))
  const [hasAC, setHasAC] = React.useState(false)
  const [busy, setBusy] = React.useState(false)

  const capacity = CAPACITY_BY_TYPE[type] ?? 2
  const preview = Array.from({ length: Math.min(Number(count) || 0, 4) }, (_, i) =>
    `${prefix}${Number(start) + i}`,
  )

  async function submit() {
    setBusy(true)
    try {
      const result = await api.post<{ message: string }>('/api/rooms', {
        action: 'BULK_ROOMS',
        propertyId,
        floorId,
        prefix: prefix || undefined,
        startNumber: Number(start),
        count: Number(count),
        capacity,
        type,
        baseRent: Number(baseRent),
        hasAC,
      })
      toast.success('Rooms added', result.message)
      onClose()
      router.refresh()
    } catch (error) {
      toast.error(
        'Unable to add these rooms',
        error instanceof ApiError ? error.message : 'Please try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Bulk add rooms</DialogTitle>
          <DialogDescription>
            The fastest way to set up a floor. Rooms are numbered in sequence and each gets{' '}
            {capacity} beds.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Floor" required>
              <Select value={floorId} onChange={(e) => setFloorId(e.target.value)}>
                {floors.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Room type" required>
              <Select value={type} onChange={(e) => setType(e.target.value)}>
                <option value="SINGLE">Single</option>
                <option value="DOUBLE">Double sharing</option>
                <option value="TRIPLE">Triple sharing</option>
                <option value="QUAD">Four sharing</option>
              </Select>
            </Field>
            <Field label="Prefix" hint="Optional, e.g. A">
              <Input value={prefix} onChange={(e) => setPrefix(e.target.value)} maxLength={4} />
            </Field>
            <Field label="Starting number" required>
              <Input
                type="number"
                inputMode="numeric"
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </Field>
            <Field label="How many rooms" required>
              <Input
                type="number"
                inputMode="numeric"
                value={count}
                onChange={(e) => setCount(e.target.value)}
              />
            </Field>
            <Field label="Rent per room">
              <Input
                type="number"
                inputMode="numeric"
                value={baseRent}
                onChange={(e) => setBaseRent(e.target.value)}
              />
            </Field>
          </div>

          <label className="flex items-center justify-between rounded-xl border border-slate-200 p-3">
            <span className="text-sm text-slate-700">All air conditioned</span>
            <Switch checked={hasAC} onCheckedChange={setHasAC} />
          </label>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Preview</p>
            <p className="mt-1 text-sm text-slate-700">
              {preview.join(', ')}
              {Number(count) > 4 ? `, … (${count} rooms)` : ''} ·{' '}
              <span className="font-semibold">
                {(Number(count) || 0) * capacity} beds in total
              </span>
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={submit} disabled={!floorId || !count}>
            Create {count} rooms
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
