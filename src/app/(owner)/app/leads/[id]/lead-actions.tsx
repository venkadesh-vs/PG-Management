'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  BedDouble,
  CalendarClock,
  CheckCircle2,
  Heart,
  PhoneCall,
  RotateCcw,
  StickyNote,
  XCircle,
} from 'lucide-react'
import { toISODate } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Field, Input, Textarea } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { LostDialog, useLeadAction, VisitDialog } from '../lead-dialogs'
import { SYSTEM_STATUSES, type LeadStatus } from '../lead-meta'

export function LeadActions({
  lead,
  canManage,
  canBook,
  openBookingId,
}: {
  lead: { id: string; name: string; status: LeadStatus }
  canManage: boolean
  canBook: boolean
  openBookingId: string | null
}) {
  const router = useRouter()
  const send = useLeadAction()
  const [busy, setBusy] = React.useState<string | null>(null)
  const [callOpen, setCallOpen] = React.useState(false)
  const [visitOpen, setVisitOpen] = React.useState(false)
  const [lostOpen, setLostOpen] = React.useState(false)
  const first = lead.name.split(' ')[0]
  const closed = lead.status === 'CHECKED_IN'
  const lost = lead.status === 'LOST'
  const booked = SYSTEM_STATUSES.includes(lead.status)

  async function quick(key: string, body: Record<string, unknown>, title: string) {
    setBusy(key)
    const ok = await send(lead.id, body, title)
    setBusy(null)
    if (ok) router.refresh()
  }

  if (!canManage && !canBook) return null

  return (
    <div className="space-y-3">
      {canBook && !closed && !lost && !booked && (
        <Button variant="primary" className="w-full" asChild>
          <Link href={`/app/bookings?new=1&lead=${lead.id}`}>
            <BedDouble /> Create booking
          </Link>
        </Button>
      )}
      {booked && openBookingId && (
        <Button variant="success" className="w-full" asChild>
          <Link href={`/app/residents/new?booking=${openBookingId}`}>
            <CheckCircle2 /> Check {first} in
          </Link>
        </Button>
      )}

      {canManage && !closed && (
        <div className="grid grid-cols-2 gap-2">
          {!lost && (
            <>
              <Button variant="outline" size="sm" onClick={() => setCallOpen(true)}>
                <PhoneCall /> Log call
              </Button>
              <Button variant="outline" size="sm" onClick={() => setVisitOpen(true)} disabled={booked}>
                <CalendarClock /> Schedule visit
              </Button>
              <Button
                variant="outline"
                size="sm"
                loading={busy === 'visited'}
                disabled={booked}
                onClick={() => quick('visited', { action: 'MARK_VISITED' }, `${first} visited`)}
              >
                <CheckCircle2 /> Mark visited
              </Button>
              <Button
                variant="outline"
                size="sm"
                loading={busy === 'interested'}
                disabled={booked || lead.status === 'INTERESTED'}
                onClick={() => quick('interested', { action: 'MARK_INTERESTED' }, `${first} is interested`)}
              >
                <Heart /> Interested
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="col-span-2 text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                disabled={booked}
                onClick={() => setLostOpen(true)}
              >
                <XCircle /> Mark lost
              </Button>
            </>
          )}
          {lost && (
            <Button
              variant="outline"
              size="sm"
              className="col-span-2"
              loading={busy === 'reopen'}
              onClick={() => quick('reopen', { action: 'REOPEN' }, 'Enquiry reopened')}
            >
              <RotateCcw /> Reopen enquiry
            </Button>
          )}
        </div>
      )}

      <LogCallDialog
        open={callOpen}
        onOpenChange={setCallOpen}
        name={first}
        onSubmit={async (note, next) => {
          const ok = await send(
            lead.id,
            { action: 'LOG_CALL', note, nextFollowUpAt: next ? new Date(`${next}T10:00`).toISOString() : '' },
            'Call logged',
          )
          if (ok) {
            setCallOpen(false)
            router.refresh()
          }
        }}
      />
      <VisitDialog lead={lead} open={visitOpen} onOpenChange={setVisitOpen} onDone={() => router.refresh()} />
      <LostDialog lead={lead} open={lostOpen} onOpenChange={setLostOpen} onDone={() => router.refresh()} />
    </div>
  )
}

function LogCallDialog({
  open,
  onOpenChange,
  name,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  name: string
  onSubmit: (note: string, nextFollowUp: string) => Promise<void>
}) {
  const [note, setNote] = React.useState('')
  const [next, setNext] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    if (open) {
      const d = new Date()
      d.setDate(d.getDate() + 2)
      setNote('')
      setNext(toISODate(d))
    }
  }, [open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Log a call with {name}</DialogTitle>
          <DialogDescription>What did you talk about? Set when to call back so nobody slips through.</DialogDescription>
        </DialogHeader>
        <Field label="What happened?">
          <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Asked about AC double sharing, will visit on Saturday…" />
        </Field>
        <Field label="Next follow-up" hint="Leave empty if no call-back is needed">
          <Input type="date" min={toISODate(new Date())} value={next} onChange={(e) => setNext(e.target.value)} />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={busy}
            onClick={async () => {
              setBusy(true)
              await onSubmit(note, next)
              setBusy(false)
            }}
          >
            Save call
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function AddNote({ leadId }: { leadId: string }) {
  const router = useRouter()
  const send = useLeadAction()
  const [note, setNote] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!note.trim()) return
    setBusy(true)
    const ok = await send(leadId, { action: 'ADD_NOTE', note }, 'Note added')
    setBusy(false)
    if (ok) {
      setNote('')
      router.refresh()
    }
  }

  return (
    <form onSubmit={submit} className="flex items-start gap-2">
      <div className="relative flex-1">
        <StickyNote className="pointer-events-none absolute left-3 top-3 size-4 text-slate-400" />
        <Textarea rows={1} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note…" className="min-h-10 pl-9" />
      </div>
      <Button type="submit" variant="default" loading={busy} disabled={!note.trim()}>
        Add
      </Button>
    </form>
  )
}
