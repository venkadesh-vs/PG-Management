'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { BedDouble, CalendarPlus, CheckCircle2, IndianRupee, LogIn, MoreHorizontal, XCircle } from 'lucide-react'
import { api } from '@/lib/client'
import { cn, formatDate, formatMoney, toISODate } from '@/lib/utils'
import { useToast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { Field, Input, Select, Textarea } from '@/components/ui/input'
import { EmptyState } from '@/components/ui/feedback'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown'
import { BOOKING_STATUS, TOKEN_METHODS } from '../leads/lead-meta'
import { ContactButtons } from '../leads/lead-card'

export type BookingRow = {
  id: string
  code: string
  name: string
  phone: string
  status: string
  checkInDate: string
  expiresAt: string | null
  rent: number
  deposit: number
  tokenAmount: number
  tokenPaidAt: string | null
  tokenMethod: string | null
  cancelReason: string | null
  bed: string | null
  property: { id: string; name: string }
  leadId: string | null
  residentId: string | null
}

type Dialogs = 'token' | 'extend' | 'cancel' | null

export function BookingsList({
  bookings,
  canBook,
  canCheckIn,
  filtered,
  newButton,
}: {
  bookings: BookingRow[]
  canBook: boolean
  canCheckIn: boolean
  filtered: boolean
  newButton: React.ReactNode
}) {
  const router = useRouter()
  const toast = useToast()
  // Read the clock once per mount so "expiring soon" is stable across renders.
  const [now] = React.useState(() => Date.now())
  const [active, setActive] = React.useState<BookingRow | null>(null)
  const [dialog, setDialog] = React.useState<Dialogs>(null)
  const [busyId, setBusyId] = React.useState<string | null>(null)

  async function act(booking: BookingRow, body: Record<string, unknown>, title: string) {
    setBusyId(booking.id)
    try {
      const result = await api.patch<{ message: string }>(`/api/bookings/${booking.id}`, body)
      toast.success(title, result.message)
      setDialog(null)
      router.refresh()
      return true
    } catch (error) {
      toast.fromError(error, 'update the booking')
      return false
    } finally {
      setBusyId(null)
    }
  }

  function open(booking: BookingRow, which: Dialogs) {
    setActive(booking)
    setDialog(which)
  }

  if (!bookings.length) {
    return filtered ? (
      <EmptyState compact icon="calendar" title="No bookings here" description="Try another status or clear the search." />
    ) : (
      <EmptyState
        icon="bed"
        title="No beds on hold yet"
        description="When someone is ready to move in, hold their bed with a booking. Take a token and they’re sorted — check-in later is one tap."
        action={newButton}
      />
    )
  }

  return (
    <>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {bookings.map((b, i) => {
          const meta = BOOKING_STATUS[b.status] ?? BOOKING_STATUS.PENDING
          const live = b.status === 'PENDING' || b.status === 'CONFIRMED'
          const expiring = live && b.expiresAt && new Date(b.expiresAt).getTime() - now < 2 * 86400000
          return (
            <motion.div
              key={b.id}
              layout
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i * 0.03, 0.3) }}
              className="flex flex-col rounded-xl border border-slate-200/80 bg-white p-4 shadow-xs"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-slate-400 tabular">{b.code}</p>
                  <p className="truncate font-display text-base font-semibold text-slate-900">
                    {b.leadId ? (
                      <Link href={`/app/leads/${b.leadId}`} className="hover:text-blue-700">
                        {b.name}
                      </Link>
                    ) : (
                      b.name
                    )}
                  </p>
                  <p className="truncate text-xs text-slate-500">{b.property.name}</p>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold', meta.chip)}>
                    <span className={cn('size-1.5 rounded-full', meta.dot)} /> {meta.label}
                  </span>
                  {canBook && live && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button type="button" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="More actions">
                          <MoreHorizontal className="size-4" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {!b.tokenPaidAt && (
                          <DropdownMenuItem onSelect={() => open(b, 'token')}>
                            <IndianRupee className="size-4" /> Record token
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem onSelect={() => open(b, 'extend')}>
                          <CalendarPlus className="size-4" /> Extend hold
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => open(b, 'cancel')} className="text-rose-600">
                          <XCircle className="size-4" /> Cancel booking
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              </div>

              <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                <div>
                  <dt className="text-[11px] text-slate-500">Bed</dt>
                  <dd className="flex items-center gap-1 font-semibold text-slate-800">
                    <BedDouble className="size-3.5 text-slate-400" /> {b.bed ?? 'Not chosen'}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] text-slate-500">Moves in</dt>
                  <dd className="text-slate-800">{formatDate(b.checkInDate)}</dd>
                </div>
                <div>
                  <dt className="text-[11px] text-slate-500">Rent · Deposit</dt>
                  <dd className="text-slate-800 tabular">
                    {formatMoney(b.rent)} · {formatMoney(b.deposit)}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] text-slate-500">Token</dt>
                  <dd className={cn('tabular', b.tokenPaidAt ? 'font-semibold text-emerald-700' : 'text-slate-400')}>
                    {b.tokenPaidAt ? formatMoney(b.tokenAmount) : 'Not paid'}
                  </dd>
                </div>
              </dl>

              {live && b.expiresAt && (
                <p className={cn('mt-3 rounded-lg px-2.5 py-1.5 text-xs', expiring ? 'bg-rose-50 font-semibold text-rose-700' : 'bg-slate-50 text-slate-500')}>
                  {b.status === 'CONFIRMED' ? 'Bed held' : 'Pending'} until {formatDate(b.expiresAt)}
                  {expiring ? ' — expiring soon' : ''}
                </p>
              )}
              {b.status === 'CANCELLED' && b.cancelReason && (
                <p className="mt-3 rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs text-slate-500">Cancelled: {b.cancelReason}</p>
              )}

              <div className="mt-auto flex flex-wrap items-center gap-2 pt-4">
                <ContactButtons lead={b} compact />
                <div className="ml-auto flex gap-2">
                  {canBook && b.status === 'PENDING' && (
                    <Button
                      size="sm"
                      variant="outline"
                      loading={busyId === b.id}
                      onClick={() => act(b, { action: 'CONFIRM' }, 'Booking confirmed')}
                      disabled={!b.bed}
                      title={b.bed ? undefined : 'Pick a bed first'}
                    >
                      <CheckCircle2 /> Confirm
                    </Button>
                  )}
                  {canCheckIn && live && (
                    <Button size="sm" variant="success" asChild>
                      <Link href={`/app/residents/new?booking=${b.id}`}>
                        <LogIn /> Check in
                      </Link>
                    </Button>
                  )}
                  {b.residentId && (
                    <Button size="sm" variant="outline" asChild>
                      <Link href={`/app/residents/${b.residentId}`}>View resident</Link>
                    </Button>
                  )}
                </div>
              </div>
            </motion.div>
          )
        })}
      </div>

      <TokenDialog booking={dialog === 'token' ? active : null} onClose={() => setDialog(null)} busy={busyId !== null} onSubmit={(body) => active && act(active, { action: 'RECORD_TOKEN', ...body }, 'Token recorded')} />
      <ExtendDialog booking={dialog === 'extend' ? active : null} onClose={() => setDialog(null)} busy={busyId !== null} onSubmit={(expiresAt) => active && act(active, { action: 'EXTEND', expiresAt }, 'Hold extended')} />
      <CancelDialog booking={dialog === 'cancel' ? active : null} onClose={() => setDialog(null)} busy={busyId !== null} onSubmit={(reason) => active && act(active, { action: 'CANCEL', reason }, 'Booking cancelled')} />
    </>
  )
}

function TokenDialog({
  booking,
  onClose,
  onSubmit,
  busy,
}: {
  booking: BookingRow | null
  onClose: () => void
  onSubmit: (body: { amount: number; method: string; reference: string }) => void
  busy: boolean
}) {
  const [amount, setAmount] = React.useState('')
  const [method, setMethod] = React.useState('UPI')
  const [reference, setReference] = React.useState('')
  React.useEffect(() => {
    if (booking) {
      setAmount('')
      setMethod('UPI')
      setReference('')
    }
  }, [booking])
  return (
    <Dialog open={Boolean(booking)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Record token payment</DialogTitle>
          <DialogDescription>
            {booking?.name.split(' ')[0]} paid to hold the bed. It’s adjusted against their first month’s rent at check-in.
          </DialogDescription>
        </DialogHeader>
        <Field label="Amount" required>
          <Input type="number" inputMode="numeric" min={1} autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 2000" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Paid by">
            <Select value={method} onChange={(e) => setMethod(e.target.value)}>
              {TOKEN_METHODS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Reference">
            <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="UTR / note" />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} disabled={!(Number(amount) > 0)} onClick={() => onSubmit({ amount: Number(amount), method, reference })}>
            Save token
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ExtendDialog({
  booking,
  onClose,
  onSubmit,
  busy,
}: {
  booking: BookingRow | null
  onClose: () => void
  onSubmit: (expiresAt: string) => void
  busy: boolean
}) {
  const [date, setDate] = React.useState('')
  React.useEffect(() => {
    if (booking) {
      const base = booking.expiresAt ? new Date(booking.expiresAt) : new Date()
      base.setDate(base.getDate() + 3)
      setDate(toISODate(base))
    }
  }, [booking])
  return (
    <Dialog open={Boolean(booking)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Extend the hold</DialogTitle>
          <DialogDescription>
            Currently held until {formatDate(booking?.expiresAt)}. Pick the new date.
          </DialogDescription>
        </DialogHeader>
        <Field label="Hold until" required>
          <Input type="date" min={toISODate(new Date())} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} disabled={!date} onClick={() => onSubmit(date)}>
            Extend
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const CANCEL_REASONS = ['Changed plans', 'Found another PG', 'Did not pay token', 'Unreachable', 'Other']

function CancelDialog({
  booking,
  onClose,
  onSubmit,
  busy,
}: {
  booking: BookingRow | null
  onClose: () => void
  onSubmit: (reason: string) => void
  busy: boolean
}) {
  const [reason, setReason] = React.useState('')
  const [note, setNote] = React.useState('')
  React.useEffect(() => {
    if (booking) {
      setReason('')
      setNote('')
    }
  }, [booking])
  const full = [reason, note.trim()].filter(Boolean).join(' — ')
  return (
    <Dialog open={Boolean(booking)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Cancel {booking?.code}?</DialogTitle>
          <DialogDescription>
            {booking?.bed ? `Bed ${booking.bed} goes back on the market. ` : ''}
            {booking?.tokenPaidAt ? `Remember to settle the ${formatMoney(booking.tokenAmount)} token.` : ''}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-2">
          {CANCEL_REASONS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setReason(r)}
              className={cn(
                'rounded-full border px-3 py-1.5 text-sm font-medium transition-colors',
                reason === r ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300',
              )}
            >
              {r}
            </button>
          ))}
        </div>
        <Field label="Details">
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Keep booking
          </Button>
          <Button variant="destructive" loading={busy} disabled={full.length < 2} onClick={() => onSubmit(full)}>
            Cancel booking
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
