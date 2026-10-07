'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { FileMinus, FilePlus, HandHeart, MoreHorizontal } from 'lucide-react'
import { api } from '@/lib/client'
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
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown'
import { Field, Input, Textarea } from '@/components/ui/input'

export type InvoiceRow = {
  id: string
  number: string
  status: string
  total: number
  balance: number
}

type Mode = 'CREDIT' | 'DEBIT' | 'WAIVE'

/**
 * Credit note, debit note or waiver on an issued invoice — the only ways an
 * invoice changes after it is raised. Each one is listed on the invoice,
 * posted to the ledger and audited.
 */
export function InvoiceActions({
  invoice,
  can,
}: {
  invoice: InvoiceRow
  can: { credit: boolean; debit: boolean }
}) {
  const [mode, setMode] = React.useState<Mode | null>(null)
  const adjustable = !['CANCELLED', 'DRAFT'].includes(invoice.status)
  const waivable = can.credit && ['PENDING', 'PARTIALLY_PAID', 'OVERDUE'].includes(invoice.status) && invoice.balance > 0
  if (!adjustable || (!can.credit && !can.debit)) return null

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label={`Actions for ${invoice.number}`}
          >
            <MoreHorizontal className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {can.credit && invoice.total > 0 && (
            <DropdownMenuItem onSelect={() => setMode('CREDIT')}>
              <FileMinus className="size-4" /> Credit note (reduce)
            </DropdownMenuItem>
          )}
          {can.debit && (
            <DropdownMenuItem onSelect={() => setMode('DEBIT')}>
              <FilePlus className="size-4" /> Debit note (add)
            </DropdownMenuItem>
          )}
          {waivable && (
            <DropdownMenuItem onSelect={() => setMode('WAIVE')}>
              <HandHeart className="size-4" /> Waive {formatMoney(invoice.balance)}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {mode && <AdjustDialog invoice={invoice} mode={mode} onClose={() => setMode(null)} />}
    </>
  )
}

const COPY: Record<Mode, { title: string; help: string; cta: string; done: string }> = {
  CREDIT: {
    title: 'Credit note',
    help: 'Reduces what this invoice asks for — a goodwill discount, a billing mistake, days not stayed. If the invoice is already paid, the extra becomes an advance.',
    cta: 'Add credit note',
    done: 'Credit note added',
  },
  DEBIT: {
    title: 'Debit note',
    help: 'Adds an amount to this invoice — a missed charge or a correction. The invoice reopens if it was paid.',
    cta: 'Add debit note',
    done: 'Debit note added',
  },
  WAIVE: {
    title: 'Waive the balance',
    help: 'Writes off what is still owed on this invoice. It is recorded as a credit with your reason and marked Waived.',
    cta: 'Waive',
    done: 'Invoice waived',
  },
}

function AdjustDialog({ invoice, mode, onClose }: { invoice: InvoiceRow; mode: Mode; onClose: () => void }) {
  const router = useRouter()
  const toast = useToast()
  const [amount, setAmount] = React.useState(mode === 'WAIVE' ? String(invoice.balance) : '')
  const [reason, setReason] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const copy = COPY[mode]
  const value = Math.round(Number(amount)) || 0
  const tooBig = mode === 'CREDIT' && value > invoice.total

  async function submit() {
    setBusy(true)
    try {
      const result = await api.post<{ message: string }>(
        '/api/invoices',
        mode === 'WAIVE'
          ? { action: 'WAIVE', invoiceId: invoice.id, reason }
          : { action: 'ADJUST', invoiceId: invoice.id, kind: mode, amount: value, reason },
      )
      toast.success(copy.done, result.message)
      onClose()
      router.refresh()
    } catch (error) {
      toast.fromError(error, mode === 'WAIVE' ? 'waive the invoice' : 'adjust the invoice')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>
            {copy.title} · {invoice.number}
          </DialogTitle>
          <DialogDescription>{copy.help}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex justify-between rounded-xl bg-slate-50 px-3 py-2 text-sm">
            <span className="text-slate-500">Total {formatMoney(invoice.total)}</span>
            <span className="font-medium text-slate-800">Balance {formatMoney(invoice.balance)}</span>
          </div>
          {mode !== 'WAIVE' && (
            <Field label="Amount" required error={tooBig ? `Can't be more than ${formatMoney(invoice.total)}` : undefined}>
              <Input type="number" inputMode="numeric" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
            </Field>
          )}
          <Field label="Reason" required hint="Shown on the invoice and in the audit log">
            <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={mode === 'WAIVE' ? 'destructive' : 'primary'}
            loading={busy}
            disabled={reason.trim().length < 3 || (mode !== 'WAIVE' && (value <= 0 || tooBig))}
            onClick={submit}
          >
            {copy.cta} {mode === 'WAIVE' ? formatMoney(invoice.balance) : value > 0 ? formatMoney(value) : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
