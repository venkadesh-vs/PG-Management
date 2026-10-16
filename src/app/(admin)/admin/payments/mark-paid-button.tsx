'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2 } from 'lucide-react'
import { api, ApiError } from '@/lib/client'
import { formatMoney, toISODate } from '@/lib/utils'
import { useToast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, Input, Select } from '@/components/ui/input'

/** Records a subscription invoice as settled outside the gateway. */
export function MarkPaidButton({
  invoiceId,
  number,
  amount,
}: {
  invoiceId: string
  number: string
  amount: number
}) {
  const router = useRouter()
  const toast = useToast()
  const [open, setOpen] = React.useState(false)
  const [method, setMethod] = React.useState('BANK_TRANSFER')
  const [reference, setReference] = React.useState('')
  const [received, setReceived] = React.useState('')
  const [paidOn, setPaidOn] = React.useState(() => toISODate(new Date()))
  const [busy, setBusy] = React.useState(false)

  async function submit() {
    setBusy(true)
    try {
      const result = await api.post<{ message: string }>('/api/admin/billing', {
        action: 'MARK_PAID',
        invoiceId,
        method,
        reference: reference || undefined,
        amount: received ? Number(received) : undefined,
        paidOn,
      })
      toast.success('Payment recorded', result.message)
      setReceived('')
      setOpen(false)
      router.refresh()
    } catch (error) {
      toast.error(
        'Unable to mark paid',
        error instanceof ApiError ? error.message : 'Please try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        Record payment
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Record a payment for {number}</DialogTitle>
            <DialogDescription>
              Money received outside the gateway — cash, GPay / UPI or a bank transfer. It clears
              the owner&apos;s whole bill (all PGs due that day), oldest first; a part payment leaves
              the rest due.
            </DialogDescription>
          </DialogHeader>

          <Field label="How was it paid?" required>
            <Select value={method} onChange={(e) => setMethod(e.target.value)}>
              <option value="BANK_TRANSFER">Bank transfer</option>
              <option value="UPI">UPI / GPay</option>
              <option value="CASH">Cash</option>
              <option value="CARD">Card</option>
            </Select>
          </Field>
          <Field label="Amount received" hint={`Leave empty for the full bill · this PG: ${formatMoney(amount)}`}>
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              value={received}
              onChange={(e) => setReceived(e.target.value.replace(/\D/g, ''))}
              placeholder="Full bill"
            />
          </Field>
          <Field label="Received on" required>
            <Input type="date" value={paidOn} max={toISODate(new Date())} onChange={(e) => setPaidOn(e.target.value)} />
          </Field>
          <Field label="Reference">
            <Input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="UTR or transaction id"
            />
          </Field>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="success" loading={busy} onClick={submit}>
              <CheckCircle2 className="size-4" />
              {received ? `Record ${formatMoney(Number(received))}` : 'Mark bill paid'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
