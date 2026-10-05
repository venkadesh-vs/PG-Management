'use client'

import * as React from 'react'
import { api } from '@/lib/client'
import { cn } from '@/lib/utils'
import { useToast } from '@/components/ui/toast'
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
import { LOST_REASONS, toLocalInput } from './lead-meta'

type ActionResult = { message: string }

/** Sends one pipeline action and toasts the outcome. Returns true on success. */
export function useLeadAction() {
  const toast = useToast()
  return React.useCallback(
    async (leadId: string, body: Record<string, unknown>, successTitle = 'Saved') => {
      try {
        const result = await api.patch<ActionResult>(`/api/resident-leads/${leadId}`, body)
        toast.success(successTitle, result.message)
        return true
      } catch (error) {
        toast.fromError(error, 'update the enquiry')
        return false
      }
    },
    [toast],
  )
}

export function LostDialog({
  lead,
  open,
  onOpenChange,
  onDone,
}: {
  lead: { id: string; name: string } | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onDone?: () => void
}) {
  const send = useLeadAction()
  const [reason, setReason] = React.useState<(typeof LOST_REASONS)[number] | ''>('')
  const [note, setNote] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    if (open) {
      setReason('')
      setNote('')
    }
  }, [open])

  async function submit() {
    if (!lead || !reason) return
    setBusy(true)
    const ok = await send(lead.id, { action: 'MARK_LOST', reason, note }, `${lead.name.split(' ')[0]} marked lost`)
    setBusy(false)
    if (ok) {
      onOpenChange(false)
      onDone?.()
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Why didn’t it work out?</DialogTitle>
          <DialogDescription>
            Knowing why {lead?.name.split(' ')[0] ?? 'they'} said no helps you fix pricing and fill more beds.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-2">
          {LOST_REASONS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setReason(r)}
              className={cn(
                'rounded-full border px-3 py-1.5 text-sm font-medium transition-colors',
                reason === r
                  ? 'border-blue-600 bg-blue-600 text-white'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300',
              )}
            >
              {r}
            </button>
          ))}
        </div>
        <Field label="Anything to add?">
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Keep open
          </Button>
          <Button variant="destructive" disabled={!reason} loading={busy} onClick={submit}>
            Mark lost
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function VisitDialog({
  lead,
  open,
  onOpenChange,
  onDone,
}: {
  lead: { id: string; name: string } | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onDone?: () => void
}) {
  const send = useLeadAction()
  const [visitAt, setVisitAt] = React.useState('')
  const [note, setNote] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    if (open) {
      const tomorrow = new Date()
      tomorrow.setDate(tomorrow.getDate() + 1)
      tomorrow.setHours(11, 0, 0, 0)
      setVisitAt(toLocalInput(tomorrow))
      setNote('')
    }
  }, [open])

  async function submit() {
    if (!lead || !visitAt) return
    setBusy(true)
    const ok = await send(
      lead.id,
      { action: 'SCHEDULE_VISIT', visitAt: new Date(visitAt).toISOString(), note },
      'Visit scheduled',
    )
    setBusy(false)
    if (ok) {
      onOpenChange(false)
      onDone?.()
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Schedule a visit</DialogTitle>
          <DialogDescription>
            When is {lead?.name.split(' ')[0] ?? 'they'} coming to see the PG? We’ll put it on your follow-up list.
          </DialogDescription>
        </DialogHeader>
        <Field label="Date and time" required>
          <Input type="datetime-local" value={visitAt} min={toLocalInput(new Date())} onChange={(e) => setVisitAt(e.target.value)} />
        </Field>
        <Field label="Note">
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Coming with parents, wants to see AC rooms…" />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!visitAt} loading={busy} onClick={submit}>
            Schedule visit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
