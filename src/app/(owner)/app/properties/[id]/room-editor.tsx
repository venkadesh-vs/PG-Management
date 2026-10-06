'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react'
import { api, ApiError } from '@/lib/client'
import { cn, formatMoney } from '@/lib/utils'
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown'
import { ConfirmAction } from '@/components/app/confirm-action'

/**
 * Editing an existing layout: rename/delete floors, edit rooms, add beds and
 * delete unused rooms and beds. The server is the source of truth for every
 * refusal; the flags here only decide which buttons are worth showing.
 */

export type BedRow = {
  id: string
  label: string
  status: string
  rent: number | null
  residentName: string | null
  /** Held for a live booking (code), or null. */
  bookingCode: string | null
  /** Past stays or bookings on file — cannot be deleted. */
  hasHistory: boolean
}

export type EditableRoom = {
  id: string
  floorId: string
  number: string
  type: string
  baseRent: number | null
  hasAC: boolean
  hasBalcony: boolean
  hasAttachedBath: boolean
  notes: string | null
  beds: BedRow[]
  /** Past residents, complaints or tasks point at the room itself. */
  hasHistory: boolean
}

export function bedBlocker(bed: BedRow): string | null {
  if (bed.residentName || bed.status === 'OCCUPIED') return bed.residentName ? `${bed.residentName} lives here` : 'Occupied'
  if (bed.bookingCode || bed.status === 'RESERVED') return bed.bookingCode ? `Booked (${bed.bookingCode})` : 'Reserved'
  if (bed.hasHistory) return 'Has past residents or bookings'
  return null
}

export function roomBlocker(room: EditableRoom): string | null {
  if (room.beds.some((b) => b.residentName || b.status === 'OCCUPIED')) return 'Residents live here'
  if (room.beds.some((b) => b.bookingCode || b.status === 'RESERVED')) return 'A bed is booked'
  if (room.hasHistory || room.beds.some((b) => b.hasHistory)) return 'Has past residents or complaints'
  return null
}

function useSubmit() {
  const router = useRouter()
  const toast = useToast()
  const [busy, setBusy] = React.useState(false)
  async function run(
    send: () => Promise<{ message?: string } | null>,
    titles: { ok: string; fail: string },
    after?: () => void,
  ) {
    setBusy(true)
    try {
      const result = await send()
      toast.success(titles.ok, result?.message)
      after?.()
      router.refresh()
    } catch (error) {
      toast.error(titles.fail, error instanceof ApiError ? error.message : 'Please try again.')
    } finally {
      setBusy(false)
    }
  }
  return { busy, run }
}

// ----------------------------------------------------------------- floors --

export function FloorMenu({
  floor,
  roomCount,
}: {
  floor: { id: string; name: string; level: number }
  roomCount: number
}) {
  const [dialog, setDialog] = React.useState<'rename' | 'delete' | null>(null)
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${floor.name}`}>
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setDialog('rename')}>
            <Pencil />
            Rename floor
          </DropdownMenuItem>
          <DropdownMenuItem
            destructive
            disabled={roomCount > 0}
            onSelect={() => setDialog('delete')}
          >
            <Trash2 />
            {roomCount > 0 ? 'Delete (remove its rooms first)' : 'Delete floor'}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <FloorRenameDialog
        open={dialog === 'rename'}
        onClose={() => setDialog(null)}
        floor={floor}
      />
      <ConfirmAction
        open={dialog === 'delete'}
        onOpenChange={(open) => setDialog(open ? 'delete' : null)}
        title={`Delete ${floor.name}?`}
        description="The floor has no rooms, so nothing else changes."
        endpoint={`/api/floors/${floor.id}`}
        confirmLabel="Delete floor"
        successTitle="Floor deleted"
      />
    </>
  )
}

function FloorRenameDialog({
  open,
  onClose,
  floor,
}: {
  open: boolean
  onClose: () => void
  floor: { id: string; name: string; level: number }
}) {
  const { busy, run } = useSubmit()
  const [name, setName] = React.useState(floor.name)
  const [level, setLevel] = React.useState(String(floor.level))

  React.useEffect(() => {
    if (open) {
      setName(floor.name)
      setLevel(String(floor.level))
    }
  }, [open, floor.name, floor.level])

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Rename floor</DialogTitle>
          <DialogDescription>Rooms and beds on this floor stay as they are.</DialogDescription>
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
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!name.trim()}
            onClick={() =>
              run(
                () =>
                  api.patch(`/api/floors/${floor.id}`, { name: name.trim(), level: Number(level) }),
                { ok: 'Floor saved', fail: 'Unable to save this floor' },
                onClose,
              )
            }
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ------------------------------------------------------------------ rooms --

export function RoomMenu({
  room,
  onEdit,
}: {
  room: EditableRoom
  onEdit: () => void
}) {
  const { busy, run } = useSubmit()
  const [confirmDelete, setConfirmDelete] = React.useState(false)
  const blocker = roomBlocker(room)
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            className="-mr-1.5 -mt-1.5 size-7"
            aria-label={`Actions for room ${room.number}`}
            disabled={busy}
          >
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={onEdit}>
            <Pencil />
            Edit room & beds
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={room.beds.length >= 12}
            onSelect={() =>
              run(() => api.post(`/api/rooms/${room.id}`, { action: 'ADD_BED' }), {
                ok: 'Bed added',
                fail: 'Unable to add a bed',
              })
            }
          >
            <Plus />
            Add a bed
          </DropdownMenuItem>
          <DropdownMenuItem destructive disabled={Boolean(blocker)} onSelect={() => setConfirmDelete(true)}>
            <Trash2 />
            {blocker ? `Delete (${blocker.toLowerCase()})` : 'Delete room'}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmAction
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete room ${room.number}?`}
        description={`Room ${room.number} and its ${room.beds.length} bed${room.beds.length === 1 ? '' : 's'} are removed. Nobody has ever stayed here, so no history is lost.`}
        endpoint={`/api/rooms/${room.id}`}
        confirmLabel="Delete room"
        successTitle="Room deleted"
      />
    </>
  )
}

const TYPE_OPTIONS = [
  ['SINGLE', 'Single'],
  ['DOUBLE', 'Double sharing'],
  ['TRIPLE', 'Triple sharing'],
  ['QUAD', 'Four sharing'],
  ['DORM', 'Dormitory'],
] as const

export function RoomEditDialog({
  open,
  onClose,
  room,
  floors,
  standardRent,
}: {
  open: boolean
  onClose: () => void
  room: EditableRoom | null
  floors: { id: string; name: string }[]
  standardRent: number
}) {
  const { busy, run } = useSubmit()
  const [form, setForm] = React.useState({
    number: '',
    floorId: '',
    type: 'DOUBLE',
    baseRent: '',
    hasAC: false,
    hasBalcony: false,
    hasAttachedBath: true,
    notes: '',
  })
  const [bedToDelete, setBedToDelete] = React.useState<BedRow | null>(null)

  React.useEffect(() => {
    if (open && room) {
      setForm({
        number: room.number,
        floorId: room.floorId,
        type: room.type,
        baseRent: room.baseRent === null ? '' : String(room.baseRent),
        hasAC: room.hasAC,
        hasBalcony: room.hasBalcony,
        hasAttachedBath: room.hasAttachedBath,
        notes: room.notes ?? '',
      })
    }
    // Seed once per opening: a refresh after adding a bed must not wipe edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, room?.id])

  if (!room) return null
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((current) => ({ ...current, [key]: value }))

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Room {room.number}</DialogTitle>
            <DialogDescription>
              Rent changes apply to beds without their own rent. Residents keep their agreed rent.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Room number" required>
                <Input value={form.number} onChange={(e) => set('number', e.target.value)} />
              </Field>
              <Field label="Floor" required>
                <Select value={form.floorId} onChange={(e) => set('floorId', e.target.value)}>
                  {floors.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Room type" required>
                <Select value={form.type} onChange={(e) => set('type', e.target.value)}>
                  {TYPE_OPTIONS.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Rent for this room" hint={`Empty = PG standard (${formatMoney(standardRent)})`}>
                <Input
                  type="number"
                  inputMode="numeric"
                  value={form.baseRent}
                  onChange={(e) => set('baseRent', e.target.value)}
                />
              </Field>
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              {(
                [
                  ['hasAC', 'Air conditioned'],
                  ['hasBalcony', 'Balcony'],
                  ['hasAttachedBath', 'Attached bath'],
                ] as const
              ).map(([key, label]) => (
                <label
                  key={key}
                  className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 p-3"
                >
                  <span className="text-sm text-slate-700">{label}</span>
                  <Switch checked={form[key]} onCheckedChange={(v) => set(key, v)} />
                </label>
              ))}
            </div>
            <Field label="Notes">
              <Textarea rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
            </Field>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Beds ({room.beds.length})
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy || room.beds.length >= 12}
                  onClick={() =>
                    run(() => api.post(`/api/rooms/${room.id}`, { action: 'ADD_BED' }), {
                      ok: 'Bed added',
                      fail: 'Unable to add a bed',
                    })
                  }
                >
                  <Plus className="size-3.5" />
                  Add bed
                </Button>
              </div>
              <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                {room.beds.map((bed) => {
                  const blocker = bedBlocker(bed)
                  return (
                    <li key={bed.id} className="flex items-center gap-3 px-3 py-2">
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 font-display text-sm font-semibold text-slate-700">
                        {bed.label}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-slate-800">
                          {blocker ?? 'Free'}
                        </p>
                        <p className="text-[11px] capitalize text-slate-500">
                          {bed.status.toLowerCase()}
                          {bed.rent !== null && ` · ${formatMoney(bed.rent)}`}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Delete bed ${bed.label}`}
                        title={blocker ?? (room.beds.length <= 1 ? 'Last bed — delete the room instead' : 'Delete bed')}
                        disabled={busy || Boolean(blocker) || room.beds.length <= 1}
                        onClick={() => setBedToDelete(bed)}
                        className={cn(!blocker && room.beds.length > 1 && 'text-red-600 hover:bg-red-50')}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </li>
                  )
                })}
              </ul>
              <p className="mt-1.5 text-[11px] text-slate-400">
                Beds with residents, bookings or past stays cannot be deleted — block them from the bed map instead.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={busy}
              disabled={!form.number.trim() || !form.floorId}
              onClick={() =>
                run(
                  () =>
                    api.patch(`/api/rooms/${room.id}`, {
                      ...form,
                      number: form.number.trim(),
                      notes: form.notes.trim(),
                    }),
                  { ok: 'Room saved', fail: 'Unable to save this room' },
                  onClose,
                )
              }
            >
              Save room
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmAction
        open={Boolean(bedToDelete)}
        onOpenChange={(o) => !o && setBedToDelete(null)}
        title={`Delete bed ${bedToDelete?.label ?? ''} in room ${room.number}?`}
        description="The bed has never been used, so no history is lost. The room's capacity drops by one."
        endpoint={`/api/beds/${bedToDelete?.id ?? ''}`}
        confirmLabel="Delete bed"
        successTitle="Bed deleted"
        onSuccess={() => setBedToDelete(null)}
      />
    </>
  )
}
