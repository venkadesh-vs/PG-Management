'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AirVent,
  Bath,
  Bed as BedIcon,
  DoorOpen,
  Phone,
  Sun,
  UserPlus,
  UserRound,
  Wallet,
  Wrench,
} from 'lucide-react'
import type { BedStatus } from '@prisma/client'
import { BED_STATUS_STYLE, PROPERTY_THEMES } from '@/lib/theme'
import { cn, formatDate, formatMoney, formatPhone } from '@/lib/utils'
import { api, ApiError } from '@/lib/client'
import { useToast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge, StatusChip } from '@/components/ui/badge'
import { Field, Select, Textarea } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/feedback'
import { OccupancyBar } from '@/components/app/occupancy-ring'

type BedRow = {
  id: string
  label: string
  status: BedStatus
  rent: number | null
  notes: string | null
  blockedReason: string | null
  resident: {
    id: string
    fullName: string
    code: string
    phone: string
    joiningDate: string
    rentAmount: number
    status: string
    outstanding: number
  } | null
}

type RoomRow = {
  id: string
  number: string
  type: string
  capacity: number
  baseRent: number | null
  hasAC: boolean
  hasBalcony: boolean
  hasAttachedBath: boolean
  beds: BedRow[]
}

type FloorRow = { id: string; name: string; level: number; rooms: RoomRow[] }

const STATUSES: BedStatus[] = ['AVAILABLE', 'OCCUPIED', 'RESERVED', 'MAINTENANCE', 'BLOCKED']

/**
 * The visual room and bed map. Occupancy here is not a separate number to
 * maintain — it is counted from the same bed rows the rest of the product
 * reads, so it can never disagree with the dashboard.
 */
export function BedMap({
  floors,
  property,
  themeKey,
  focusRoomId,
  canManage = true,
  canCheckIn = true,
}: {
  /** properties.manage — change a bed's status. */
  canManage?: boolean
  /** residents.manage — check someone into a free bed. */
  canCheckIn?: boolean
  floors: FloorRow[]
  property: { id: string; name: string; type: 'MENS' | 'WOMENS' | 'COLIVE'; standardRent: number }
  themeKey: string
  focusRoomId?: string
}) {
  const theme = PROPERTY_THEMES[property.type]
  const [filter, setFilter] = React.useState<BedStatus | 'ALL'>('ALL')
  const [selected, setSelected] = React.useState<{ bed: BedRow; room: RoomRow } | null>(null)

  const allBeds = floors.flatMap((f) => f.rooms.flatMap((r) => r.beds))
  const count = (status: BedStatus) => allBeds.filter((b) => b.status === status).length
  const occupied = count('OCCUPIED')
  const rate = allBeds.length ? Math.round((occupied / allBeds.length) * 100) : 0

  if (!floors.length) {
    return (
      <EmptyState
        icon="bed"
        title="No floors or rooms yet"
        description="Add a floor, then rooms — beds are created automatically from the room capacity."
        action={
          <Button variant="primary" asChild>
            <Link href={`/app/properties/${property.id}`}>Set up rooms</Link>
          </Button>
        }
      />
    )
  }

  return (
    <div className="space-y-5">
      {/* --------------------------------------------------- Status bar */}
      <Card className="overflow-hidden">
        <div className={cn('h-1.5 bg-gradient-to-r', theme.gradient)} />
        <CardContent className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="font-display text-base font-semibold text-slate-900">{property.name}</p>
              <p className="text-sm text-slate-500">
                {floors.length} floors · {floors.reduce((s, f) => s + f.rooms.length, 0)} rooms ·{' '}
                {allBeds.length} beds
              </p>
            </div>
            <div className="text-right">
              <p className={cn('font-display text-2xl font-semibold tabular', theme.text)}>{rate}%</p>
              <p className="text-xs text-slate-500">
                {occupied} of {allBeds.length} beds occupied
              </p>
            </div>
          </div>

          <OccupancyBar
            className="mt-4"
            occupied={occupied}
            available={count('AVAILABLE')}
            reserved={count('RESERVED')}
            maintenance={count('MAINTENANCE')}
            blocked={count('BLOCKED')}
          />

          <div className="mt-4 flex flex-wrap gap-2">
            <FilterChip
              label={`All (${allBeds.length})`}
              active={filter === 'ALL'}
              onClick={() => setFilter('ALL')}
            />
            {STATUSES.map((status) => (
              <FilterChip
                key={status}
                label={`${BED_STATUS_STYLE[status].label} (${count(status)})`}
                dot={BED_STATUS_STYLE[status].dot}
                active={filter === status}
                onClick={() => setFilter(filter === status ? 'ALL' : status)}
              />
            ))}
          </div>
        </CardContent>
      </Card>

      {/* ----------------------------------------------------- Bed grid */}
      <div className="space-y-6">
        {floors.map((floor) => {
          const rooms = floor.rooms.filter(
            (room) => filter === 'ALL' || room.beds.some((b) => b.status === filter),
          )
          if (!rooms.length) return null

          return (
            <div key={floor.id} className="space-y-3">
              <div className="flex items-center gap-3">
                <h2 className="font-display text-sm font-semibold uppercase tracking-wide text-slate-500">
                  {floor.name}
                </h2>
                <div className="h-px flex-1 bg-slate-200" />
                <span className="text-xs text-slate-400">
                  {rooms.length} rooms · {rooms.reduce((s, r) => s + r.beds.length, 0)} beds
                </span>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {rooms.map((room) => {
                  const roomOccupied = room.beds.filter((b) => b.status === 'OCCUPIED').length
                  const full = roomOccupied === room.beds.length
                  return (
                    <motion.div
                      key={room.id}
                      layout
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.25 }}
                      className={cn(
                        'rounded-2xl border bg-white p-4 shadow-card transition-shadow hover:shadow-elevated',
                        focusRoomId === room.id ? cn(theme.border, 'ring-2', theme.ring) : 'border-slate-200',
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-display text-sm font-semibold text-slate-900">
                            Room {room.number}
                          </p>
                          <p className="text-[11px] capitalize text-slate-500">
                            {room.type.toLowerCase()} · {formatMoney(room.baseRent ?? property.standardRent)}
                          </p>
                        </div>
                        <span
                          className={cn(
                            'rounded-full px-2 py-0.5 text-[10px] font-semibold',
                            full ? 'bg-slate-100 text-slate-500' : 'bg-emerald-50 text-emerald-700',
                          )}
                        >
                          {roomOccupied}/{room.beds.length}
                        </span>
                      </div>

                      <div className="mt-2 flex gap-1.5 text-slate-400">
                        {room.hasAC && <AirVent className="size-3.5" aria-label="Air conditioned" />}
                        {room.hasAttachedBath && <Bath className="size-3.5" aria-label="Attached bathroom" />}
                        {room.hasBalcony && <Sun className="size-3.5" aria-label="Balcony" />}
                      </div>

                      <div className="mt-3 grid grid-cols-4 gap-1.5">
                        {room.beds.map((bed) => {
                          const style = BED_STATUS_STYLE[bed.status]
                          const dimmed = filter !== 'ALL' && bed.status !== filter
                          return (
                            <motion.button
                              key={bed.id}
                              type="button"
                              whileTap={{ scale: 0.94 }}
                              onClick={() => setSelected({ bed, room })}
                              title={
                                bed.resident
                                  ? `${bed.resident.fullName} — ${style.label}`
                                  : style.label
                              }
                              className={cn(
                                'group relative flex aspect-square items-center justify-center rounded-lg border text-sm font-semibold transition-all',
                                style.tile,
                                style.tileText,
                                dimmed && 'opacity-30',
                              )}
                            >
                              {bed.label}
                              <span
                                className={cn(
                                  'absolute bottom-1 right-1 size-1.5 rounded-full',
                                  style.dot,
                                )}
                              />
                              {bed.resident && bed.resident.outstanding > 0 && (
                                <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-red-500 ring-2 ring-white" />
                              )}
                            </motion.button>
                          )
                        })}
                      </div>
                    </motion.div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      <AnimatePresence>
        {selected && (
          <BedDetailDialog
            bed={selected.bed}
            room={selected.room}
            property={property}
            canManage={canManage}
            canCheckIn={canCheckIn}
            onClose={() => setSelected(null)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

function FilterChip({
  label,
  dot,
  active,
  onClick,
}: {
  label: string
  dot?: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors',
        active
          ? 'border-slate-900 bg-slate-900 text-white'
          : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300',
      )}
    >
      {dot && <span className={cn('size-1.5 rounded-full', active ? 'bg-white' : dot)} />}
      {label}
    </button>
  )
}

function BedDetailDialog({
  bed,
  room,
  property,
  canManage,
  canCheckIn,
  onClose,
}: {
  canManage: boolean
  canCheckIn: boolean
  bed: BedRow
  room: RoomRow
  property: { id: string; name: string; type: 'MENS' | 'WOMENS' | 'COLIVE' }
  onClose: () => void
}) {
  const router = useRouter()
  const toast = useToast()
  const [status, setStatus] = React.useState<BedStatus>(bed.status)
  const [reason, setReason] = React.useState(bed.blockedReason ?? '')
  const [busy, setBusy] = React.useState(false)
  const style = BED_STATUS_STYLE[bed.status]

  async function save() {
    setBusy(true)
    try {
      const result = await api.post<{ message: string }>('/api/rooms', {
        action: 'UPDATE_BED',
        bedId: bed.id,
        status,
        blockedReason: status === 'MAINTENANCE' || status === 'BLOCKED' ? reason : '',
      })
      toast.success('Bed updated', result.message)
      onClose()
      router.refresh()
    } catch (error) {
      toast.error(
        'This bed could not be updated',
        error instanceof ApiError ? error.message : 'Please try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BedIcon className="size-4 text-slate-400" />
            Room {room.number} · Bed {bed.label}
          </DialogTitle>
          <DialogDescription>
            {property.name} · {room.type.toLowerCase()} room
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <StatusChip label={style.label} chip={style.chip} dot={style.dot} />
            <span className="text-sm font-semibold text-slate-700 tabular">
              {formatMoney(bed.rent ?? room.baseRent ?? 0)}/month
            </span>
          </div>

          {bed.resident ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
              <div className="flex items-start gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white shadow-sm">
                  <UserRound className="size-5 text-slate-500" />
                </div>
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/app/residents/${bed.resident.id}`}
                    className="font-medium text-slate-900 hover:text-blue-700"
                  >
                    {bed.resident.fullName}
                  </Link>
                  <p className="text-xs text-slate-500">{bed.resident.code}</p>
                  <div className="mt-2 space-y-1 text-xs text-slate-600">
                    <p className="flex items-center gap-1.5">
                      <Phone className="size-3" />
                      {formatPhone(bed.resident.phone)}
                    </p>
                    <p className="flex items-center gap-1.5">
                      <DoorOpen className="size-3" />
                      Since {formatDate(bed.resident.joiningDate)}
                    </p>
                    <p className="flex items-center gap-1.5">
                      <Wallet className="size-3" />
                      {formatMoney(bed.resident.rentAmount)} per month
                      {bed.resident.outstanding > 0 && (
                        <Badge variant="danger" size="sm" className="ml-1">
                          {formatMoney(bed.resident.outstanding)} due
                        </Badge>
                      )}
                    </p>
                  </div>
                </div>
              </div>
              <Button variant="outline" size="sm" className="mt-3 w-full" asChild>
                <Link href={`/app/residents/${bed.resident.id}`}>Open resident</Link>
              </Button>
            </div>
          ) : (
            <>
              <Field label="Bed status">
                <Select value={status} disabled={!canManage} onChange={(e) => setStatus(e.target.value as BedStatus)}>
                  {STATUSES.filter((s) => s !== 'OCCUPIED').map((s) => (
                    <option key={s} value={s}>
                      {BED_STATUS_STYLE[s].label}
                    </option>
                  ))}
                </Select>
              </Field>

              {(status === 'MAINTENANCE' || status === 'BLOCKED') && (
                <Field label="Reason" hint="Shown on the bed map so your team knows why">
                  <Textarea
                    rows={2}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Mattress replacement"
                  />
                </Field>
              )}

              {bed.status === 'AVAILABLE' && canCheckIn && (
                <Button
                  variant={property.type === 'WOMENS' ? 'pink' : 'primary'}
                  className="w-full"
                  asChild
                >
                  <Link href={`/app/residents/new?property=${property.id}&bed=${bed.id}`}>
                    <UserPlus className="size-4" />
                    Check someone into this bed
                  </Link>
                </Button>
              )}
            </>
          )}

          {bed.blockedReason && bed.status !== 'AVAILABLE' && !bed.resident && (
            <p className="flex items-start gap-1.5 text-xs text-slate-500">
              <Wrench className="mt-0.5 size-3 shrink-0" />
              {bed.blockedReason}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          {!bed.resident && canManage && (
            <Button variant="default" loading={busy} onClick={save} disabled={status === bed.status}>
              Save status
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
