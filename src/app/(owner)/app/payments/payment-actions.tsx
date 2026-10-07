'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { HandCoins, MoreHorizontal, Pencil, Undo2 } from 'lucide-react'
import { api } from '@/lib/client'
import { formatMoney } from '@/lib/utils'
import { useToast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown'
import { Field, Input, Select, Textarea } from '@/components/ui/input'
import { ProofUpload } from './payment-fields'

export type PaymentRow = {
  id: string
  residentId: string
  receiptNumber: string
  amount: number
  status: string
  purpose: string
  method: string
  reference: string | null
  utr: string | null
  notes: string | null
  attachmentUrl: string | null
  refundedAmount: number
  /** Money not applied to any invoice and not refunded. */
  unallocated: number
}

/** "Reversed" / "Refunded" chip for a payment that is not plainly received. */
export function PaymentStatusBadge({ status, refundedAmount }: { status: string; refundedAmount: number }) {
  if (status === 'REVERSED') return <Badge variant="danger" size="sm">Reversed</Badge>
  if (status === 'REFUNDED') return <Badge variant="warning" size="sm">Refunded</Badge>
  if (status === 'FAILED') return <Badge variant="danger" size="sm">Failed</Badge>
  if (status === 'PENDING') return <Badge variant="warning" size="sm">Pending</Badge>
  if (refundedAmount > 0) return <Badge variant="warning" size="sm">{formatMoney(refundedAmount)} refunded</Badge>
  return null
}

/**
 * Per-payment menu: edit the non-money details, refund unapplied money, or
 * reverse the whole payment. Nothing here deletes a payment.
 */
export function PaymentActions({
  payment,
  can,
}: {
  payment: PaymentRow
  can: { edit: boolean; reverse: boolean }
}) {
  const [dialog, setDialog] = React.useState<'edit' | 'reverse' | 'refund' | null>(null)
  const live = payment.status === 'SUCCESS' && payment.purpose === 'RENT'
  const canRefund = can.reverse && live && payment.unallocated > 0
  const canReverse = can.reverse && live && payment.refundedAmount === 0
  if (!can.edit && !canRefund && !canReverse) return null

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label={`Actions for ${payment.receiptNumber}`}
          >
            <MoreHorizontal className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {can.edit && (
            <DropdownMenuItem onSelect={() => setDialog('edit')}>
              <Pencil className="size-4" /> Edit details
            </DropdownMenuItem>
          )}
          {canRefund && (
            <DropdownMenuItem onSelect={() => setDialog('refund')}>
              <HandCoins className="size-4" /> Refund advance
            </DropdownMenuItem>
          )}
          {canReverse && (
            <DropdownMenuItem onSelect={() => setDialog('reverse')} className="text-red-600">
              <Undo2 className="size-4" /> Reverse payment
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {dialog === 'edit' && <EditDialog payment={payment} onClose={() => setDialog(null)} />}
      {dialog === 'reverse' && <ReverseDialog payment={payment} onClose={() => setDialog(null)} />}
      {dialog === 'refund' && <RefundDialog payment={payment} onClose={() => setDialog(null)} />}
    </>
  )
}

function useSubmit(onClose: () => void) {
  const router = useRouter()
  const toast = useToast()
  const [busy, setBusy] = React.useState(false)
  async function run(fn: () => Promise<{ message: string }>, title: string, action: string) {
    setBusy(true)
    try {
      const result = await fn()
      toast.success(title, result.message)
      onClose()
      router.refresh()
    } catch (error) {
      toast.fromError(error, action)
    } finally {
      setBusy(false)
    }
  }
  return { busy, run }
}

function EditDialog({ payment, onClose }: { payment: PaymentRow; onClose: () => void }) {
  const [utr, setUtr] = React.useState(payment.utr ?? '')
  const [reference, setReference] = React.useState(payment.reference ?? '')
  const [notes, setNotes] = React.useState(payment.notes ?? '')
  const [proof, setProof] = React.useState(payment.attachmentUrl ?? '')
  const [uploading, setUploading] = React.useState(false)
  const { busy, run } = useSubmit(onClose)

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Edit {payment.receiptNumber}</DialogTitle>
          <DialogDescription>
            Fix the reference, UTR, notes or proof. The amount and date can&apos;t be edited — reverse
            the payment and record it again instead. Every change is kept in the audit log.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="UTR / transaction ID">
              <Input value={utr} onChange={(e) => setUtr(e.target.value)} />
            </Field>
            <Field label="Reference">
              <Input value={reference} onChange={(e) => setReference(e.target.value)} />
            </Field>
          </div>
          <Field label="Notes">
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          <ProofUpload value={proof} onChange={setProof} residentId={payment.residentId} onBusyChange={setUploading} />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={uploading}
            onClick={() =>
              run(
                () =>
                  api.patch<{ message: string }>(`/api/payments/${payment.id}`, {
                    utr,
                    reference,
                    notes,
                    attachmentUrl: proof,
                  }),
                'Payment updated',
                'update the payment',
              )
            }
          >
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ReverseDialog({ payment, onClose }: { payment: PaymentRow; onClose: () => void }) {
  const [reason, setReason] = React.useState('')
  const { busy, run } = useSubmit(onClose)
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Reverse {payment.receiptNumber}?</DialogTitle>
          <DialogDescription>
            Use this for a wrong entry or a bounced cheque. {formatMoney(payment.amount)} will be
            taken off the invoices it paid, those invoices reopen, and the receipt is marked
            REVERSED. The payment stays on record — nothing is deleted.
          </DialogDescription>
        </DialogHeader>
        <Field label="Reason" required hint="e.g. Cheque bounced, entered twice">
          <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
        </Field>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Keep payment
          </Button>
          <Button
            variant="destructive"
            loading={busy}
            disabled={reason.trim().length < 3}
            onClick={() =>
              run(
                () => api.post<{ message: string }>(`/api/payments/${payment.id}`, { action: 'REVERSE', reason }),
                'Payment reversed',
                'reverse the payment',
              )
            }
          >
            Reverse {formatMoney(payment.amount)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RefundDialog({ payment, onClose }: { payment: PaymentRow; onClose: () => void }) {
  const [amount, setAmount] = React.useState(String(payment.unallocated))
  const [method, setMethod] = React.useState('UPI')
  const [reference, setReference] = React.useState('')
  const [reason, setReason] = React.useState('')
  const { busy, run } = useSubmit(onClose)
  const value = Math.round(Number(amount)) || 0
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Refund from {payment.receiptNumber}</DialogTitle>
          <DialogDescription>
            {formatMoney(payment.unallocated)} of this payment is not applied to any invoice (an
            overpayment or advance). Record the money you returned.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Amount" required>
              <Input
                type="number"
                inputMode="numeric"
                min={1}
                max={payment.unallocated}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </Field>
            <Field label="Paid by" required>
              <Select value={method} onChange={(e) => setMethod(e.target.value)}>
                <option value="UPI">UPI</option>
                <option value="CASH">Cash</option>
                <option value="BANK_TRANSFER">Bank transfer</option>
                <option value="CHEQUE">Cheque</option>
              </Select>
            </Field>
          </div>
          <Field label="Reference">
            <Input value={reference} onChange={(e) => setReference(e.target.value)} />
          </Field>
          <Field label="Reason" required>
            <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Paid twice by mistake" />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={value <= 0 || value > payment.unallocated || reason.trim().length < 3}
            onClick={() =>
              run(
                () =>
                  api.post<{ message: string }>(`/api/payments/${payment.id}`, {
                    action: 'REFUND',
                    amount: value,
                    method,
                    reference: reference || undefined,
                    reason,
                  }),
                'Refund recorded',
                'record the refund',
              )
            }
          >
            Refund {formatMoney(value)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
