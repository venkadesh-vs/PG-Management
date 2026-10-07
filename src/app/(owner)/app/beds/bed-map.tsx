'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AirVent,
  Ban,
  Bath,
  Bed as BedIcon,
  CalendarCheck,
  CircleCheck,
  DoorOpen,
  Phone,
  Sun,
  UserPlus,
  UserRound,
  Wallet,
  Wrench,
  X,
} from 'lucide-react'
import type { BedStatus } from '@prisma/client'
import { BED_STATUS_STYLE, PROPERTY_THEMES } from '@/lib/theme'
import { cn, formatDate, formatMoney, formatPhone } from '@/lib/utils'
import { api, ApiError } from '@/lib/client'
import { useToast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge, StatusChip } from '@/components/ui/badge'
import { Field, Textarea } from '@/components/ui/input'
import { EmptyState } from '@/components/ui/feedback'
import { OccupancyBar } from '@/components/app/occupancy-ring'

type BedRow = {
  id: string
  label: string
  status: BedStatus
  rent: number | null
  notes: string | null
  blockedReason: string | null
  booking: {
    id: string
    code: string
    name: string
    phone: string
    checkInDate: string
    status: string
  } | null
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
  focusRoomId,
  canManage = true,
  canCheckIn = true,
}: {
  /** properties.manage — block, maintenance, release. */
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
          <BedPanel
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

function BedPanel({
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
  const [mode, setMode] = React.useState<'BLOCK' | 'MAINTENANCE' | null>(null)
  const [reason, setReason] = React.useState('')
  const [busy, setBusy] = React.useState<string | null>(null)
  const style = BED_STATUS_STYLE[bed.status]
  const outOfService = bed.status === 'BLOCKED' || bed.status === 'MAINTENANCE'
  const actionable = canManage && !bed.resident && !bed.booking

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function run(action: 'BLOCK' | 'MAINTENANCE' | 'RELEASE') {
    if (action !== 'RELEASE' && !reason.trim()) {
      toast.error('Add a reason first', 'A short note helps your team know why this bed is out of use.')
      return
    }
    setBusy(action)
    try {
      const result = await api.post<{ message: string }>('/api/beds', {
        action,
        bedId: bed.id,
        ...(action === 'RELEASE' ? {} : { reason: reason.trim() }),
      })
      toast.success(
        action === 'RELEASE' ? 'Bed is available again' : action === 'BLOCK' ? 'Bed blocked' : 'Sent for maintenance',
        result.message,
      )
      onClose()
      router.refresh()
    } catch (error) {
      toast.error(
        'This bed could not be updated',
        error instanceof ApiError ? error.message : 'Please try again.',
      )
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <motion.div
        key="bed-panel-backdrop"
        className="fixed inset-0 z-40 bg-slate-900/30 backdrop-blur-[1px]"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      />
      <motion.aside
        key="bed-panel"
        role="dialog"
        aria-modal="true"
        aria-label={`Room ${room.number}, bed ${bed.label}`}
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-slate-200 bg-white shadow-2xl"
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', stiffness: 380, damping: 36 }}
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div className="min-w-0">
            <p className="flex items-center gap-2 font-display text-base font-semibold text-slate-900">
              <BedIcon className="size-4 text-slate-400" />
              Room {room.number} · Bed {bed.label}
            </p>
            <p className="mt-0.5 text-xs capitalize text-slate-500">
              {property.name} · {room.type.toLowerCase()} room
            </p>
          </div>
          <Button variant="ghost" size="icon" aria-label="Close" onClick={onClose}>
            <X className="size-4" />
          </Button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <div className="flex items-center justify-between">
            <StatusChip label={style.label} chip={style.chip} dot={style.dot} />
            <span className="text-sm font-semibold text-slate-700 tabular">
              {formatMoney(bed.rent ?? room.baseRent ?? 0)}/month
            </span>
          </div>

          {outOfService && bed.blockedReason && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
              {bed.status === 'MAINTENANCE' ? (
                <Wrench className="mt-0.5 size-4 shrink-0" />
              ) : (
                <Ban className="mt-0.5 size-4 shrink-0" />
              )}
              <span>{bed.blockedReason}</span>
            </div>
          )}

          {bed.resident && (
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
              <p className="mt-2 text-[11px] text-slate-500">
                To free this bed, check the resident out or move them from their profile.
              </p>
            </div>
          )}

          {bed.booking && (
            <div className="rounded-2xl border border-violet-200 bg-violet-50/60 p-4">
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-violet-700">
                <CalendarCheck className="size-3.5" />
                Held for a booking
              </p>
              <p className="mt-2 font-medium text-slate-900">{bed.booking.name}</p>
              <p className="text-xs text-slate-500">
                {bed.booking.code} · {bed.booking.status.toLowerCase()} · moving in{' '}
                {formatDate(bed.booking.checkInDate)}
              </p>
              <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-600">
                <Phone className="size-3" />
                {formatPhone(bed.booking.phone)}
              </p>
              <Button variant="outline" size="sm" className="mt-3 w-full" asChild>
                <Link href="/app/bookings">View bookings</Link>
              </Button>
            </div>
          )}

          {bed.status === 'RESERVED' && !bed.booking && (
            <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs text-slate-600">
              This bed is marked reserved but no active booking holds it. You can release it below.
            </p>
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

          {actionable && (
            <div className="space-y-3 rounded-2xl border border-slate-200 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Bed actions</p>
              <div className="grid grid-cols-2 gap-2">
                {bed.status !== 'BLOCKED' && (
                  <Button
                    variant={mode === 'BLOCK' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setMode(mode === 'BLOCK' ? null : 'BLOCK')}
                  >
                    <Ban className="size-4" />
                    Block
                  </Button>
                )}
                {bed.status !== 'MAINTENANCE' && (
                  <Button
                    variant={mode === 'MAINTENANCE' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setMode(mode === 'MAINTENANCE' ? null : 'MAINTENANCE')}
                  >
                    <Wrench className="size-4" />
                    Maintenance
                  </Button>
                )}
              </div>

              <AnimatePresence initial={false}>
                {mode && (
                  <motion.div
                    key="reason"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="space-y-3 overflow-hidden"
                  >
                    <Field
                      label={mode === 'BLOCK' ? 'Why is it blocked?' : 'What needs fixing?'}
                      hint="Shown on the bed map so your team knows"
                      required
                    >
                      <Textarea
                        rows={2}
                        value={reason}
                        autoFocus
                        maxLength={200}
                        onChange={(e) => setReason(e.target.value)}
                        placeholder={mode === 'BLOCK' ? 'Kept for the owner’s guest' : 'Mattress replacement'}
                      />
                    </Field>
                    <Button
                      variant="default"
                      className="w-full"
                      loading={busy === mode}
                      onClick={() => run(mode)}
                    >
                      {mode === 'BLOCK' ? 'Block this bed' : 'Send for maintenance'}
                    </Button>
                  </motion.div>
                )}
              </AnimatePresence>

              {(outOfService || bed.status === 'RESERVED') && (
                <Button
                  variant="primary"
                  className="w-full"
                  loading={busy === 'RELEASE'}
                  onClick={() => run('RELEASE')}
                >
                  <CircleCheck className="size-4" />
                  Release — make it available
                </Button>
              )}
            </div>
          )}

          {!canManage && !bed.resident && (
            <p className="text-xs text-slate-500">
              Ask the PG owner for “Edit PG details, rooms and beds” access to change this bed.
            </p>
          )}
        </div>
      </motion.aside>
    </>
  )
}
