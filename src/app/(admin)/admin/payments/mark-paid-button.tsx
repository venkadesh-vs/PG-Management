'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2 } from 'lucide-react'
import { api, ApiError } from '@/lib/client'
import { formatMoney } from '@/lib/utils'
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
  const [busy, setBusy] = React.useState(false)

  async function submit() {
    setBusy(true)
    try {
      const result = await api.post<{ message: string }>('/api/admin/billing', {
        action: 'MARK_PAID',
        invoiceId,
        method,
        reference: reference || undefined,
      })
      toast.success('Invoice settled', result.message)
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
        Mark paid
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Mark {number} as paid</DialogTitle>
            <DialogDescription>
              For {formatMoney(amount)} received outside the gateway — a bank transfer or UPI
              payment made directly to you.
            </DialogDescription>
          </DialogHeader>

          <Field label="How was it paid?" required>
            <Select value={method} onChange={(e) => setMethod(e.target.value)}>
              <option value="BANK_TRANSFER">Bank transfer</option>
              <option value="UPI">UPI</option>
              <option value="CASH">Cash</option>
              <option value="CARD">Card</option>
            </Select>
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
              Mark paid
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
