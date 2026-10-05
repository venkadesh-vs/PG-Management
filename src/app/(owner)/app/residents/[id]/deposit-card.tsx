'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { Banknote, CircleCheck, Clock, ShieldCheck } from 'lucide-react'
import { api, ApiError } from '@/lib/client'
import { cn, formatDate, formatMoney, toISODate } from '@/lib/utils'
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
import { Field, Input, Select, Textarea } from '@/components/ui/input'

export type DepositInfo = {
  amount: number
  collected: number
  deductions: number
  refunded: number
  status: 'PENDING' | 'COLLECTED' | 'PARTIALLY_REFUNDED' | 'REFUNDED' | 'FORFEITED'
  collectedAt: string | null
  refundedAt: string | null
  refundMethod: string | null
  refundReference: string | null
  refundNote: string | null
}

const STATUS: Record<DepositInfo['status'], { label: string; chip: string }> = {
  PENDING: { label: 'Not collected', chip: 'bg-amber-50 text-amber-700 border-amber-200' },
  COLLECTED: { label: 'Held', chip: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  PARTIALLY_REFUNDED: { label: 'Part adjusted', chip: 'bg-blue-50 text-blue-700 border-blue-200' },
  REFUNDED: { label: 'Refunded', chip: 'bg-slate-100 text-slate-700 border-slate-200' },
  FORFEITED: { label: 'Adjusted in full', chip: 'bg-slate-100 text-slate-700 border-slate-200' },
}

const METHODS = [
  { value: 'UPI', label: 'UPI' },
  { value: 'CASH', label: 'Cash' },
  { value: 'BANK_TRANSFER', label: 'Bank transfer' },
  { value: 'CHEQUE', label: 'Cheque' },
]

const methodLabel = (m: string | null) =>
  m ? (METHODS.find((x) => x.value === m)?.label ?? m.replace('_', ' ').toLowerCase()) : null

/**
 * The security deposit at a glance, with the two follow-ups an owner needs:
 * collecting a deposit that was skipped at check-in, and paying out a refund
 * that was left pending at checkout.
 */
export function DepositCard({
  residentId,
  residentName,
  checkedOut,
  deposit,
  depositAmount,
  pendingRefund,
  can,
}: {
  residentId: string
  residentName: string
  checkedOut: boolean
  deposit: DepositInfo | null
  depositAmount: number
  /** Refund decided at checkout but not paid yet. */
  pendingRefund: number
  can: { refund: boolean; collect: boolean }
}) {
  const [dialog, setDialog] = React.useState<'refund' | 'collect' | null>(null)
  const status = deposit?.status ?? 'PENDING'
  const expected = deposit?.amount ?? depositAmount
  const collected = deposit?.collected ?? 0
  const due = Math.max(0, expected - collected)
  const style = STATUS[status]

  return (
    <Card className={cn(pendingRefund > 0 && 'border-amber-300')}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between gap-2 text-sm">
          <span className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-slate-400" />
            Security deposit
          </span>
          <span className={cn('rounded-full border px-2 py-0.5 text-[11px] font-medium', style.chip)}>
            {pendingRefund > 0 ? 'Refund pending' : style.label}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2.5">
        <Row label="Agreed" value={formatMoney(expected)} />
        <Row
          label="Collected"
          value={`${formatMoney(collected)}${deposit?.collectedAt ? ` · ${formatDate(deposit.collectedAt)}` : ''}`}
        />
        {(deposit?.deductions ?? 0) > 0 && (
          <Row label="Adjusted against dues" value={`− ${formatMoney(deposit!.deductions)}`} />
        )}
        {(deposit?.refunded ?? 0) > 0 && (
          <Row
            label="Refunded"
            value={`${formatMoney(deposit!.refunded)}${deposit?.refundedAt ? ` · ${formatDate(deposit.refundedAt)}` : ''}`}
          />
        )}
        {deposit?.refundMethod && status === 'REFUNDED' && (
          <p className="text-xs text-slate-500">
            Paid by {methodLabel(deposit.refundMethod)}
            {deposit.refundReference ? ` · ref ${deposit.refundReference}` : ''}
            {deposit.refundNote ? ` — ${deposit.refundNote}` : ''}
          </p>
        )}

        {pendingRefund > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-xl border border-amber-200 bg-amber-50 p-3"
          >
            <p className="flex items-center gap-1.5 text-sm font-medium text-amber-800">
              <Clock className="size-4" />
              {formatMoney(pendingRefund)} to refund
            </p>
            <p className="mt-0.5 text-xs text-amber-700">
              Settled at checkout — mark it paid once the money reaches {residentName.split(' ')[0]}.
            </p>
            {can.refund && (
              <Button variant="default" size="sm" className="mt-2 w-full" onClick={() => setDialog('refund')}>
                <CircleCheck className="size-4" />
                Mark refund paid
              </Button>
            )}
          </motion.div>
        )}

        {!checkedOut && due > 0 && can.collect && (
          <Button variant="outline" size="sm" className="w-full" onClick={() => setDialog('collect')}>
            <Banknote className="size-4" />
            Collect {formatMoney(due)} deposit
          </Button>
        )}
      </CardContent>

      <RefundDialog
        open={dialog === 'refund'}
        onClose={() => setDialog(null)}
        residentId={residentId}
        residentName={residentName}
        amount={pendingRefund}
      />
      <CollectDialog
        open={dialog === 'collect'}
        onClose={() => setDialog(null)}
        residentId={residentId}
        residentName={residentName}
        due={due}
      />
    </Card>
  )
}

function RefundDialog({
  open,
  onClose,
  residentId,
  residentName,
  amount,
}: {
  open: boolean
  onClose: () => void
  residentId: string
  residentName: string
  amount: number
}) {
  const router = useRouter()
  const toast = useToast()
  const [method, setMethod] = React.useState('UPI')
  const [reference, setReference] = React.useState('')
  const [paidAt, setPaidAt] = React.useState(toISODate(new Date()))
  const [note, setNote] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  async function submit() {
    setBusy(true)
    try {
      const result = await api.post<{ message: string }>('/api/residents/actions', {
        action: 'MARK_REFUND_PAID',
        residentId,
        method,
        reference: reference || undefined,
        paidAt,
        note: note || undefined,
      })
      toast.success('Refund marked as paid', result.message)
      onClose()
      router.refresh()
    } catch (error) {
      toast.error('Could not save the refund', error instanceof ApiError ? error.message : 'Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Mark refund paid</DialogTitle>
          <DialogDescription>
            {formatMoney(amount)} to {residentName}. This closes the deposit and updates the ledger.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Paid by" required>
              <Select value={method} onChange={(e) => setMethod(e.target.value)}>
                {METHODS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Paid on" required>
              <Input type="date" value={paidAt} max={toISODate(new Date())} onChange={(e) => setPaidAt(e.target.value)} />
            </Field>
          </div>
          <Field label="Reference" hint="UPI ref, cheque no. or transaction id">
            <Input value={reference} onChange={(e) => setReference(e.target.value)} />
          </Field>
          <Field label="Note">
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={submit}>
            Mark {formatMoney(amount)} paid
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CollectDialog({
  open,
  onClose,
  residentId,
  residentName,
  due,
}: {
  open: boolean
  onClose: () => void
  residentId: string
  residentName: string
  due: number
}) {
  const router = useRouter()
  const toast = useToast()
  const [amount, setAmount] = React.useState(String(due))
  const [method, setMethod] = React.useState('UPI')
  const [reference, setReference] = React.useState('')
  const [paidAt, setPaidAt] = React.useState(toISODate(new Date()))
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    if (open) setAmount(String(due))
  }, [open, due])

  async function submit() {
    const value = Math.round(Number(amount))
    if (!value || value <= 0) {
      toast.error('Enter the amount received', 'It must be more than zero.')
      return
    }
    setBusy(true)
    try {
      const result = await api.post<{ message: string }>('/api/residents/actions', {
        action: 'COLLECT_DEPOSIT',
        residentId,
        amount: value,
        method,
        reference: reference || undefined,
        paidAt,
      })
      toast.success('Deposit recorded', result.message)
      onClose()
      router.refresh()
    } catch (error) {
      toast.error('Could not record the deposit', error instanceof ApiError ? error.message : 'Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Collect security deposit</DialogTitle>
          <DialogDescription>
            {formatMoney(due)} is still due from {residentName}. The deposit is held money — it is
            never counted as rent.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Amount" required>
              <Input type="number" inputMode="numeric" min={1} max={due} value={amount} onChange={(e) => setAmount(e.target.value)} />
            </Field>
            <Field label="Method" required>
              <Select value={method} onChange={(e) => setMethod(e.target.value)}>
                {[...METHODS, { value: 'CARD', label: 'Card' }].map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Received on" required>
              <Input type="date" value={paidAt} max={toISODate(new Date())} onChange={(e) => setPaidAt(e.target.value)} />
            </Field>
            <Field label="Reference">
              <Input value={reference} onChange={(e) => setReference(e.target.value)} />
            </Field>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={submit}>
            Record {formatMoney(Number(amount) || 0)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="text-right font-medium text-slate-800 tabular">{value}</span>
    </div>
  )
}
