'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { MoreHorizontal } from 'lucide-react'
import { api, ApiError } from '@/lib/client'
import { formatMoney } from '@/lib/utils'
import { useToast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { Field, Input, Select } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

type Action = 'EXTEND_TRIAL' | 'APPLY_CREDIT' | 'MARK_PAID' | 'CANCEL' | 'REACTIVATE'

const LABEL: Record<Action, string> = {
  EXTEND_TRIAL: 'Extend trial',
  APPLY_CREDIT: 'Apply credit',
  MARK_PAID: 'Mark invoice paid',
  CANCEL: 'Cancel subscription',
  REACTIVATE: 'Reactivate',
}

/**
 * Per-subscription Super Admin actions. Every one is audited server-side
 * (ADMIN_ACTION with before/after).
 */
export function SubscriptionAdminActions({
  subscriptionId,
  label,
  status,
  cancelAtPeriodEnd,
  openInvoice,
  owed,
}: {
  subscriptionId: string
  label: string
  status: string
  cancelAtPeriodEnd: boolean
  openInvoice: { id: string; number: string; due: number } | null
  owed: number
}) {
  const router = useRouter()
  const toast = useToast()
  const [action, setAction] = React.useState<Action | null>(null)
  const [days, setDays] = React.useState('7')
  const [amount, setAmount] = React.useState('')
  const [note, setNote] = React.useState('')
  const [method, setMethod] = React.useState('BANK_TRANSFER')
  const [busy, setBusy] = React.useState(false)

  const available: Action[] = []
  if (status !== 'CANCELLED') available.push('EXTEND_TRIAL')
  if (owed > 0) available.push('APPLY_CREDIT')
  if (openInvoice) available.push('MARK_PAID')
  if (status !== 'CANCELLED') available.push('CANCEL')
  if (status === 'CANCELLED' || status === 'SUSPENDED' || cancelAtPeriodEnd) available.push('REACTIVATE')

  async function submit() {
    if (!action) return
    setBusy(true)
    try {
      const body =
        action === 'MARK_PAID'
          ? { action, invoiceId: openInvoice?.id, method, reference: note || undefined }
          : action === 'EXTEND_TRIAL'
            ? { action, subscriptionId, days: Number(days) }
            : action === 'APPLY_CREDIT'
              ? { action, subscriptionId, amount: Number(amount), note: note || undefined }
              : action === 'CANCEL'
                ? { action, subscriptionId, reason: note || undefined }
                : { action, subscriptionId }
      const result = await api.post<{ message: string }>('/api/admin/billing', body)
      toast.success(LABEL[action], result.message)
      setAction(null)
      setNote('')
      setAmount('')
      router.refresh()
    } catch (error) {
      toast.error(`Unable to ${LABEL[action].toLowerCase()}`, error instanceof ApiError ? error.message : 'Please try again.')
    } finally {
      setBusy(false)
    }
  }

  if (!available.length) return null

  return (
    <>
      <Select
        aria-label={`Actions for ${label}`}
        value=""
        onChange={(e) => e.target.value && setAction(e.target.value as Action)}
        className="h-8 w-auto text-xs"
      >
        <option value="">Actions…</option>
        {available.map((a) => (
          <option key={a} value={a}>
            {LABEL[a]}
          </option>
        ))}
      </Select>

      <Dialog open={action !== null} onOpenChange={(o) => !o && setAction(null)}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MoreHorizontal className="size-4 text-slate-400" />
              {action ? LABEL[action] : ''}
            </DialogTitle>
            <DialogDescription>{label}. This is recorded in the audit log.</DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {action === 'EXTEND_TRIAL' && (
              <Field label="Extra days" hint="A lapsed, never-paid trial is restarted and its open invoices withdrawn">
                <Input type="number" inputMode="numeric" min={1} max={180} value={days} onChange={(e) => setDays(e.target.value)} />
              </Field>
            )}
            {action === 'APPLY_CREDIT' && (
              <>
                <Field label="Credit amount" hint={`Up to ${formatMoney(owed)} owed`}>
                  <Input type="number" inputMode="numeric" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} />
                </Field>
                <Field label="Note">
                  <Input value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
                </Field>
              </>
            )}
            {action === 'MARK_PAID' && openInvoice && (
              <>
                <p className="text-sm text-slate-600">
                  {openInvoice.number} · {formatMoney(openInvoice.due)} due
                </p>
                <Field label="Paid by">
                  <Select value={method} onChange={(e) => setMethod(e.target.value)}>
                    <option value="BANK_TRANSFER">Bank transfer</option>
                    <option value="UPI">UPI</option>
                    <option value="CASH">Cash</option>
                    <option value="CARD">Card</option>
                  </Select>
                </Field>
                <Field label="Reference">
                  <Input value={note} maxLength={60} onChange={(e) => setNote(e.target.value)} />
                </Field>
              </>
            )}
            {action === 'CANCEL' && (
              <Field label="Reason">
                <Input value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
              </Field>
            )}
            {action === 'REACTIVATE' && (
              <p className="text-sm text-slate-600">
                Access comes back now. Anything still unpaid gets a fresh grace period.
              </p>
            )}
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setAction(null)}>
              Close
            </Button>
            <Button
              variant={action === 'CANCEL' ? 'destructive' : 'primary'}
              loading={busy}
              disabled={action === 'APPLY_CREDIT' && !(Number(amount) > 0)}
              onClick={submit}
            >
              {action ? LABEL[action] : 'Confirm'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
