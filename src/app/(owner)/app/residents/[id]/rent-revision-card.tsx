'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { History, TrendingDown, TrendingUp } from 'lucide-react'
import { api } from '@/lib/client'
import { formatDate, formatMoney, toISODate } from '@/lib/utils'
import { useToast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, Input, Textarea } from '@/components/ui/input'

export type RevisionItem = {
  id: string
  oldRent: number
  newRent: number
  effectiveFrom: string
  reason: string
  createdBy: string | null
  createdAt: string
}

/** Rent history with a "Change rent" action that takes an effective date. */
export function RentRevisionCard({
  residentId,
  rentAmount,
  revisions,
  canManage,
  checkedOut,
}: {
  residentId: string
  rentAmount: number
  revisions: RevisionItem[]
  canManage: boolean
  checkedOut: boolean
}) {
  const [open, setOpen] = React.useState(false)
  const today = toISODate(new Date())
  const scheduled = revisions.find((r) => r.effectiveFrom.slice(0, 10) > today)

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between gap-2 text-sm">
          <span className="flex items-center gap-2">
            <History className="size-4 text-slate-400" />
            Rent history
          </span>
          {canManage && !checkedOut && (
            <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
              Change rent
            </Button>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {scheduled && (
          <p className="mb-2 rounded-xl bg-blue-50 px-3 py-2 text-xs text-blue-800">
            {formatMoney(scheduled.oldRent)} until {formatDate(new Date(new Date(scheduled.effectiveFrom).getTime() - 86400000))}, then{' '}
            {formatMoney(scheduled.newRent)}.
          </p>
        )}
        {revisions.length === 0 ? (
          <p className="text-sm text-slate-500">
            {formatMoney(rentAmount)} a month since joining. Changes you make here keep a dated
            history; invoices already raised are never rewritten.
          </p>
        ) : (
          <ol className="space-y-2.5">
            {revisions.map((r) => {
              const up = r.newRent > r.oldRent
              return (
                <li key={r.id} className="flex items-start gap-2.5">
                  <span className={`mt-0.5 rounded-full p-1 ${up ? 'bg-amber-50 text-amber-600' : 'bg-emerald-50 text-emerald-600'}`}>
                    {up ? <TrendingUp className="size-3.5" /> : <TrendingDown className="size-3.5" />}
                  </span>
                  <div className="min-w-0 text-sm">
                    <p className="font-medium text-slate-800 tabular">
                      {formatMoney(r.oldRent)} → {formatMoney(r.newRent)}
                    </p>
                    <p className="text-xs text-slate-500">
                      from {formatDate(r.effectiveFrom)} · {r.reason}
                    </p>
                    <p className="text-[11px] text-slate-400">
                      {r.createdBy ? `by ${r.createdBy} · ` : ''}
                      {formatDate(r.createdAt)}
                    </p>
                  </div>
                </li>
              )
            })}
          </ol>
        )}
      </CardContent>
      {open && (
        <ReviseDialog
          residentId={residentId}
          rentAmount={rentAmount}
          minDate={revisions.length ? revisions[0].effectiveFrom.slice(0, 10) : undefined}
          onClose={() => setOpen(false)}
        />
      )}
    </Card>
  )
}

function firstOfNextMonth() {
  const d = new Date()
  return toISODate(new Date(d.getFullYear(), d.getMonth() + 1, 1))
}

function ReviseDialog({
  residentId,
  rentAmount,
  minDate,
  onClose,
}: {
  residentId: string
  rentAmount: number
  /** The latest existing revision's date; a new one must come after it. */
  minDate?: string
  onClose: () => void
}) {
  const router = useRouter()
  const toast = useToast()
  const [newRent, setNewRent] = React.useState('')
  const [effectiveFrom, setEffectiveFrom] = React.useState(firstOfNextMonth())
  const [reason, setReason] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const value = Math.round(Number(newRent)) || 0
  const midMonth = effectiveFrom && !effectiveFrom.endsWith('-01')
  const past = effectiveFrom && effectiveFrom < toISODate(new Date())

  async function submit() {
    setBusy(true)
    try {
      const result = await api.post<{ message: string }>('/api/rent-revisions', {
        residentId,
        newRent: value,
        effectiveFrom,
        reason,
      })
      toast.success('Rent updated', result.message)
      onClose()
      router.refresh()
    } catch (error) {
      toast.fromError(error, 'change the rent')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Change rent</DialogTitle>
          <DialogDescription>
            Currently {formatMoney(rentAmount)} a month. Invoices from the effective date use the
            new rent; a month that is already invoiced gets a credit or debit note for the
            difference — the original invoice is never rewritten.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="New monthly rent" required>
              <Input type="number" inputMode="numeric" min={1} value={newRent} onChange={(e) => setNewRent(e.target.value)} autoFocus />
            </Field>
            <Field label="Effective from" required>
              <Input
                type="date"
                value={effectiveFrom}
                min={minDate}
                onChange={(e) => setEffectiveFrom(e.target.value)}
              />
            </Field>
          </div>
          {(midMonth || past) && (
            <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {past ? 'This date is in the past. ' : ''}
              {midMonth ? 'The month it falls in is split by days at the old and new rent. ' : ''}
              If that month is already invoiced, the pro-rata difference is added as a note on it.
            </p>
          )}
          <Field label="Reason" required hint="e.g. Annual revision, moved to a single room">
            <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={value <= 0 || value === rentAmount || !effectiveFrom || reason.trim().length < 3}
            onClick={submit}
          >
            Set rent to {value > 0 ? formatMoney(value) : '…'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
