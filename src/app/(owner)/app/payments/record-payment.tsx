'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { Check, Receipt, Search, Wallet } from 'lucide-react'
import { api, ApiError } from '@/lib/client'
import { cn, formatDate, formatMoney } from '@/lib/utils'
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
import { Field, Input, Select, Textarea } from '@/components/ui/input'

type ResidentOption = {
  id: string
  fullName: string
  code: string
  rentAmount: number
  outstanding: number
  invoices: { id: string; number: string; balance: number; dueDate: string }[]
}

/**
 * Record a payment for any resident, starting from a searchable picker.
 * Residents with dues are listed first so the common case is one click.
 */
export function RecordPaymentButton({ residents }: { residents: ResidentOption[] }) {
  const router = useRouter()
  const toast = useToast()
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const [selected, setSelected] = React.useState<ResidentOption | null>(null)
  const [amount, setAmount] = React.useState('')
  const [method, setMethod] = React.useState('UPI')
  const [reference, setReference] = React.useState('')
  const [notes, setNotes] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [receipt, setReceipt] = React.useState<{ receiptNumber: string; amount: number } | null>(null)

  const filtered = React.useMemo(() => {
    const term = query.trim().toLowerCase()
    const list = term
      ? residents.filter(
          (r) =>
            r.fullName.toLowerCase().includes(term) || r.code.toLowerCase().includes(term),
        )
      : residents
    return [...list].sort((a, b) => b.outstanding - a.outstanding).slice(0, 40)
  }, [residents, query])

  function reset() {
    setSelected(null)
    setQuery('')
    setAmount('')
    setReference('')
    setNotes('')
    setReceipt(null)
  }

  function choose(resident: ResidentOption) {
    setSelected(resident)
    setAmount(String(resident.outstanding || resident.rentAmount))
  }

  async function submit() {
    if (!selected) return
    const value = Number(amount)
    if (!value || value <= 0) {
      toast.error('Unable to record payment', 'Enter an amount greater than zero.')
      return
    }
    setBusy(true)
    try {
      const result = await api.post<{
        receiptNumber: string
        amount: number
        advance: number
      }>('/api/payments', {
        residentId: selected.id,
        amount: value,
        method,
        reference: reference || undefined,
        notes: notes || undefined,
      })
      setReceipt(result)
      toast.success(
        'Payment recorded successfully',
        `${formatMoney(result.amount)} from ${selected.fullName} — receipt ${result.receiptNumber}.`,
      )
      router.refresh()
    } catch (error) {
      toast.error(
        'Unable to record payment',
        error instanceof ApiError ? error.message : 'Please try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        <Wallet className="size-4" />
        Record payment
      </Button>

      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o)
          if (!o) reset()
        }}
      >
        <DialogContent size="lg">
          {receipt ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              className="space-y-4 text-center"
            >
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', stiffness: 320, damping: 18 }}
                className="mx-auto flex size-14 items-center justify-center rounded-full bg-emerald-100"
              >
                <Check className="size-7 text-emerald-600" strokeWidth={3} />
              </motion.div>
              <DialogTitle>Payment recorded</DialogTitle>
              <DialogDescription>
                {formatMoney(receipt.amount)} from {selected?.fullName}
              </DialogDescription>
              <div className="mx-auto flex max-w-xs items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
                <Receipt className="size-4 text-slate-400" />
                <span className="font-mono text-sm font-semibold text-slate-800">
                  {receipt.receiptNumber}
                </span>
              </div>
              <div className="flex justify-center gap-2">
                <Button variant="outline" onClick={reset}>
                  Record another
                </Button>
                <Button variant="primary" onClick={() => setOpen(false)}>
                  Done
                </Button>
              </div>
            </motion.div>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Record a payment</DialogTitle>
                <DialogDescription>
                  Pick the resident. The amount clears their oldest unpaid invoice first, and the
                  ledger, dashboard and receipt update together.
                </DialogDescription>
              </DialogHeader>

              {!selected ? (
                <div className="space-y-3">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                    <Input
                      autoFocus
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Search by name or resident code…"
                      className="pl-9"
                    />
                  </div>
                  <ul className="max-h-80 space-y-1 overflow-y-auto scrollbar-slim">
                    {filtered.map((resident) => (
                      <li key={resident.id}>
                        <button
                          type="button"
                          onClick={() => choose(resident)}
                          className="flex w-full items-center justify-between gap-3 rounded-xl border border-slate-200 p-3 text-left transition-colors hover:border-blue-300 hover:bg-blue-50/40"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-slate-800">
                              {resident.fullName}
                            </p>
                            <p className="text-xs text-slate-500">
                              {resident.code} · rent {formatMoney(resident.rentAmount)}
                            </p>
                          </div>
                          <span
                            className={cn(
                              'shrink-0 text-sm font-semibold tabular',
                              resident.outstanding > 0 ? 'text-red-600' : 'text-emerald-600',
                            )}
                          >
                            {resident.outstanding > 0
                              ? `${formatMoney(resident.outstanding)} due`
                              : 'No dues'}
                          </span>
                        </button>
                      </li>
                    ))}
                    {filtered.length === 0 && (
                      <li className="py-8 text-center text-sm text-slate-500">
                        No residents match “{query}”.
                      </li>
                    )}
                  </ul>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-800">{selected.fullName}</p>
                      <p className="text-xs text-slate-500">
                        {selected.code} ·{' '}
                        {selected.outstanding > 0
                          ? `${formatMoney(selected.outstanding)} outstanding`
                          : 'no outstanding rent'}
                      </p>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>
                      Change
                    </Button>
                  </div>

                  {selected.invoices.length > 0 && (
                    <div className="rounded-xl border border-slate-200 p-3">
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Open invoices
                      </p>
                      <ul className="space-y-1 text-sm">
                        {selected.invoices.map((invoice) => (
                          <li key={invoice.id} className="flex items-center justify-between gap-3">
                            <span className="truncate text-slate-700">{invoice.number}</span>
                            <span className="text-xs text-slate-400">
                              due {formatDate(invoice.dueDate)}
                            </span>
                            <span className="font-medium text-slate-800 tabular">
                              {formatMoney(invoice.balance)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Amount" required>
                      <Input
                        type="number"
                        inputMode="numeric"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        autoFocus
                      />
                    </Field>
                    <Field label="Method" required>
                      <Select value={method} onChange={(e) => setMethod(e.target.value)}>
                        <option value="UPI">UPI</option>
                        <option value="CASH">Cash</option>
                        <option value="BANK_TRANSFER">Bank transfer</option>
                        <option value="CARD">Card</option>
                        <option value="CHEQUE">Cheque</option>
                      </Select>
                    </Field>
                  </div>
                  <Field label="Reference">
                    <Input
                      value={reference}
                      onChange={(e) => setReference(e.target.value)}
                      placeholder="UPI reference or cheque number"
                    />
                  </Field>
                  <Field label="Notes">
                    <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
                  </Field>
                </div>
              )}

              <DialogFooter>
                <Button variant="ghost" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  loading={busy}
                  onClick={submit}
                  disabled={!selected || !Number(amount)}
                >
                  Record {Number(amount) ? formatMoney(Number(amount)) : 'payment'}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
