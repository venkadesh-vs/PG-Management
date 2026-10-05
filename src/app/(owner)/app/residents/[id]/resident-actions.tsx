'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowRightLeft,
  CalendarClock,
  Check,
  CircleCheck,
  DoorOpen,
  MoreHorizontal,
  Receipt,
  Wallet,
} from 'lucide-react'
import { api, ApiError } from '@/lib/client'
import { cn, formatDate, formatMoney, toISODate } from '@/lib/utils'
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
import { Checkbox } from '@/components/ui/primitives'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown'

type Resident = {
  id: string
  fullName: string
  status: string
  propertyType: 'MENS' | 'WOMENS' | 'COLIVE'
  rentAmount: number
  outstanding: number
  exitDate: string | null
}

type Invoice = { id: string; number: string; balance: number; dueDate: string }

type CheckoutPreview = {
  outstandingRent: number
  proRataRent: number
  foodCharges: number
  utilityCharges: number
  otherCharges: number
  depositHeld: number
  suggestedRefund: number
  suggestedPayable: number
}

/**
 * Everything an owner does to a resident after check-in: record a payment,
 * move them to another bed, mark notice, and run the checkout settlement.
 */
export function ResidentActions({
  resident,
  openInvoices,
  availableBeds,
}: {
  resident: Resident
  openInvoices: Invoice[]
  availableBeds: { id: string; label: string }[]
}) {
  const [dialog, setDialog] = React.useState<'payment' | 'transfer' | 'notice' | 'checkout' | null>(
    null,
  )
  const active = resident.status !== 'CHECKED_OUT'

  return (
    <>
      {active && (
        <Button
          variant={resident.propertyType === 'WOMENS' ? 'pink' : 'primary'}
          onClick={() => setDialog('payment')}
        >
          <Wallet className="size-4" />
          Record payment
        </Button>
      )}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon" aria-label="More actions">
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          {active ? (
            <>
              <DropdownMenuItem onSelect={() => setDialog('transfer')}>
                <ArrowRightLeft />
                Move to another bed
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setDialog('notice')}>
                <CalendarClock />
                Mark notice period
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem destructive onSelect={() => setDialog('checkout')}>
                <DoorOpen />
                Check out & settle
              </DropdownMenuItem>
            </>
          ) : (
            <DropdownMenuItem disabled>
              <CircleCheck />
              Already checked out
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <PaymentDialog
        open={dialog === 'payment'}
        onClose={() => setDialog(null)}
        resident={resident}
        invoices={openInvoices}
      />
      <TransferDialog
        open={dialog === 'transfer'}
        onClose={() => setDialog(null)}
        resident={resident}
        beds={availableBeds}
      />
      <NoticeDialog open={dialog === 'notice'} onClose={() => setDialog(null)} resident={resident} />
      <CheckoutDialog
        open={dialog === 'checkout'}
        onClose={() => setDialog(null)}
        resident={resident}
      />
    </>
  )
}

// --------------------------------------------------------------- payment ----

function PaymentDialog({
  open,
  onClose,
  resident,
  invoices,
}: {
  open: boolean
  onClose: () => void
  resident: Resident
  invoices: Invoice[]
}) {
  const router = useRouter()
  const toast = useToast()
  const [amount, setAmount] = React.useState(String(resident.outstanding || resident.rentAmount))
  const [method, setMethod] = React.useState('UPI')
  const [reference, setReference] = React.useState('')
  const [notes, setNotes] = React.useState('')
  const [selected, setSelected] = React.useState<string[]>(invoices.map((i) => i.id))
  const [busy, setBusy] = React.useState(false)
  const [receipt, setReceipt] = React.useState<{ receiptNumber: string; amount: number } | null>(
    null,
  )

  React.useEffect(() => {
    if (open) {
      setAmount(String(resident.outstanding || resident.rentAmount))
      setReceipt(null)
      setSelected(invoices.map((i) => i.id))
    }
  }, [open, resident, invoices])

  async function submit() {
    const value = Number(amount)
    if (!value || value <= 0) {
      toast.error('Unable to record payment', 'Enter an amount greater than zero.')
      return
    }
    setBusy(true)
    try {
      const result = await api.post<{ receiptNumber: string; amount: number; message: string; advance: number }>(
        '/api/payments',
        {
          residentId: resident.id,
          amount: value,
          method,
          reference: reference || undefined,
          notes: notes || undefined,
          invoiceIds: selected,
        },
      )
      setReceipt(result)
      toast.success(
        'Payment recorded successfully',
        result.advance > 0
          ? `${formatMoney(result.amount)} recorded. ${formatMoney(result.advance)} kept as advance.`
          : `${formatMoney(result.amount)} recorded — receipt ${result.receiptNumber}.`,
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
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <AnimatePresence mode="wait">
          {receipt ? (
            <motion.div
              key="receipt"
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
                {formatMoney(receipt.amount)} from {resident.fullName}
              </DialogDescription>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-left">
                <div className="flex items-center gap-2">
                  <Receipt className="size-4 text-slate-400" />
                  <p className="font-mono text-sm font-semibold text-slate-800">
                    {receipt.receiptNumber}
                  </p>
                </div>
                <ul className="mt-2 space-y-1 text-xs text-slate-500">
                  <li>Invoice balances updated</li>
                  <li>Resident ledger credited</li>
                  <li>Dashboard collection refreshed</li>
                  <li>Receipt queued to the resident&apos;s WhatsApp</li>
                </ul>
              </div>
              <Button variant="primary" className="w-full" onClick={onClose}>
                Done
              </Button>
            </motion.div>
          ) : (
            <motion.div key="form" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <DialogHeader>
                <DialogTitle>Record a payment</DialogTitle>
                <DialogDescription>
                  {resident.outstanding > 0
                    ? `${resident.fullName} owes ${formatMoney(resident.outstanding)}.`
                    : `${resident.fullName} has no outstanding rent — this will be held as an advance.`}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 py-2">
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

                <Field label="Reference" hint="UPI reference, cheque number or transaction id">
                  <Input value={reference} onChange={(e) => setReference(e.target.value)} />
                </Field>

                {invoices.length > 0 && (
                  <div className="rounded-xl border border-slate-200 p-3">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Apply to
                    </p>
                    <ul className="space-y-1.5">
                      {invoices.map((invoice) => (
                        <li key={invoice.id}>
                          <label className="flex cursor-pointer items-center gap-2.5 text-sm">
                            <Checkbox
                              checked={selected.includes(invoice.id)}
                              onCheckedChange={(checked) =>
                                setSelected((current) =>
                                  checked === true
                                    ? [...current, invoice.id]
                                    : current.filter((id) => id !== invoice.id),
                                )
                              }
                            />
                            <span className="flex-1 truncate text-slate-700">{invoice.number}</span>
                            <span className="text-xs text-slate-400">
                              due {formatDate(invoice.dueDate)}
                            </span>
                            <span className="font-medium text-slate-800 tabular">
                              {formatMoney(invoice.balance)}
                            </span>
                          </label>
                        </li>
                      ))}
                    </ul>
                    <p className="mt-2 text-[11px] text-slate-400">
                      Anything left over automatically clears the oldest remaining invoice.
                    </p>
                  </div>
                )}

                <Field label="Notes">
                  <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
                </Field>
              </div>

              <DialogFooter>
                <Button variant="ghost" onClick={onClose}>
                  Cancel
                </Button>
                <Button variant="primary" loading={busy} onClick={submit}>
                  Record {formatMoney(Number(amount) || 0)}
                </Button>
              </DialogFooter>
            </motion.div>
          )}
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  )
}

// -------------------------------------------------------------- transfer ----

function TransferDialog({
  open,
  onClose,
  resident,
  beds,
}: {
  open: boolean
  onClose: () => void
  resident: Resident
  beds: { id: string; label: string }[]
}) {
  const router = useRouter()
  const toast = useToast()
  const [bedId, setBedId] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  async function submit() {
    if (!bedId) {
      toast.error('Please select a valid bed', 'Choose where they are moving to.')
      return
    }
    setBusy(true)
    try {
      const result = await api.post<{ message: string }>('/api/residents/actions', {
        action: 'TRANSFER',
        residentId: resident.id,
        toBedId: bedId,
      })
      toast.success('Bed allocated successfully', result.message)
      onClose()
      router.refresh()
    } catch (error) {
      toast.error(
        'Unable to move this resident',
        error instanceof ApiError ? error.message : 'Please try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Move to another bed</DialogTitle>
          <DialogDescription>
            The old bed becomes available and occupancy updates everywhere immediately.
          </DialogDescription>
        </DialogHeader>
        <Field label="New bed" required>
          <Select value={bedId} onChange={(e) => setBedId(e.target.value)}>
            <option value="">Select an available bed</option>
            {beds.map((bed) => (
              <option key={bed.id} value={bed.id}>
                {bed.label}
              </option>
            ))}
          </Select>
        </Field>
        {beds.length === 0 && (
          <p className="text-xs text-amber-600">
            No vacant beds in this PG right now. Free one up from the bed map first.
          </p>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={submit} disabled={!beds.length}>
            Move resident
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------- notice ----

function NoticeDialog({
  open,
  onClose,
  resident,
}: {
  open: boolean
  onClose: () => void
  resident: Resident
}) {
  const router = useRouter()
  const toast = useToast()
  const [noticeDate, setNoticeDate] = React.useState(toISODate(new Date()))
  const [exitDate, setExitDate] = React.useState(
    toISODate(new Date(Date.now() + 30 * 86400000)),
  )
  const [busy, setBusy] = React.useState(false)

  async function submit() {
    setBusy(true)
    try {
      const result = await api.post<{ message: string }>('/api/residents/actions', {
        action: 'NOTICE',
        residentId: resident.id,
        noticeDate,
        exitDate,
      })
      toast.success('Notice recorded', result.message)
      onClose()
      router.refresh()
    } catch (error) {
      toast.error(
        'Something went wrong',
        error instanceof ApiError ? error.message : 'Please try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Mark notice period</DialogTitle>
          <DialogDescription>
            The bed stays occupied until the exit date, but shows up in upcoming vacancies so you
            can start filling it.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Notice given on" required>
            <Input type="date" value={noticeDate} onChange={(e) => setNoticeDate(e.target.value)} />
          </Field>
          <Field label="Expected exit" required>
            <Input type="date" value={exitDate} onChange={(e) => setExitDate(e.target.value)} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={submit}>
            Save notice
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// -------------------------------------------------------------- checkout ----

function CheckoutDialog({
  open,
  onClose,
  resident,
}: {
  open: boolean
  onClose: () => void
  resident: Resident
}) {
  const router = useRouter()
  const toast = useToast()
  const [exitDate, setExitDate] = React.useState(
    resident.exitDate ? resident.exitDate.slice(0, 10) : toISODate(new Date()),
  )
  const [damage, setDamage] = React.useState('0')
  const [other, setOther] = React.useState('0')
  const [reason, setReason] = React.useState('')
  const [note, setNote] = React.useState('')
  const [refundPaid, setRefundPaid] = React.useState(true)
  const [preview, setPreview] = React.useState<CheckoutPreview | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [loading, setLoading] = React.useState(false)
  const [done, setDone] = React.useState<{ refund: number; payable: number } | null>(null)

  // Recompute the settlement whenever an input that affects it changes.
  React.useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    api
      .post<{ preview: CheckoutPreview }>('/api/residents/actions', {
        action: 'CHECKOUT_PREVIEW',
        residentId: resident.id,
        exitDate,
        damageDeduction: Number(damage) || 0,
        otherCharges: Number(other) || 0,
      })
      .then((data) => {
        if (!cancelled) setPreview(data.preview)
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, resident.id, exitDate, damage, other])

  async function submit() {
    setBusy(true)
    try {
      const result = await api.post<{ message: string; refund: number; payable: number }>(
        '/api/residents/actions',
        {
          action: 'CHECKOUT',
          residentId: resident.id,
          exitDate,
          reason: reason || undefined,
          damageDeduction: Number(damage) || 0,
          otherCharges: Number(other) || 0,
          settlementNote: note || undefined,
          refundPaid,
        },
      )
      setDone({ refund: result.refund, payable: result.payable })
      toast.success('Checkout completed', result.message)
      router.refresh()
    } catch (error) {
      toast.error(
        'Unable to complete checkout',
        error instanceof ApiError ? error.message : 'Please try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="lg">
        {done ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            className="space-y-4 text-center"
          >
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 300, damping: 18 }}
              className="mx-auto flex size-14 items-center justify-center rounded-full bg-emerald-100"
            >
              <Check className="size-7 text-emerald-600" strokeWidth={3} />
            </motion.div>
            <DialogTitle>{resident.fullName} has checked out</DialogTitle>
            <DialogDescription>
              {done.refund > 0
                ? `${formatMoney(done.refund)} refunded from the deposit.`
                : done.payable > 0
                  ? `${formatMoney(done.payable)} is still payable.`
                  : 'Fully settled — nothing outstanding.'}
            </DialogDescription>
            <ul className="mx-auto max-w-sm space-y-1 text-left text-sm text-slate-600">
              {[
                'Bed released and marked available',
                'PG occupancy recalculated',
                'Rent schedule stopped',
                'Food plan ended',
                'Resident app account closed',
                'Final settlement saved to the ledger',
              ].map((line) => (
                <li key={line} className="flex items-start gap-2">
                  <CircleCheck className="mt-0.5 size-4 shrink-0 text-emerald-500" />
                  {line}
                </li>
              ))}
            </ul>
            <Button variant="primary" className="w-full" onClick={onClose}>
              Done
            </Button>
          </motion.div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Check out {resident.fullName}</DialogTitle>
              <DialogDescription>
                The settlement below is calculated from live invoices, the deposit and any unbilled
                utility charges.
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-5 sm:grid-cols-2">
              <div className="space-y-4">
                <Field label="Exit date" required>
                  <Input type="date" value={exitDate} onChange={(e) => setExitDate(e.target.value)} />
                </Field>
                <Field label="Reason for leaving">
                  <Input
                    placeholder="Job relocation"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </Field>
                <Field label="Damage / deduction" hint="Deducted from the deposit">
                  <Input
                    type="number"
                    inputMode="numeric"
                    value={damage}
                    onChange={(e) => setDamage(e.target.value)}
                  />
                </Field>
                <Field label="Other charges">
                  <Input
                    type="number"
                    inputMode="numeric"
                    value={other}
                    onChange={(e) => setOther(e.target.value)}
                  />
                </Field>
                <Field label="Settlement note">
                  <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
                </Field>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Final settlement
                </p>
                {loading || !preview ? (
                  <div className="space-y-2 pt-3">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <div key={i} className="skeleton h-4 w-full" />
                    ))}
                  </div>
                ) : (
                  <div className="mt-3 space-y-2">
                    <SettleRow label="Outstanding rent" value={preview.outstandingRent} />
                    <SettleRow label="Rent till exit date" value={preview.proRataRent} />
                    {preview.foodCharges > 0 && (
                      <SettleRow label="Food charges" value={preview.foodCharges} />
                    )}
                    {preview.utilityCharges > 0 && (
                      <SettleRow label="Utility charges" value={preview.utilityCharges} />
                    )}
                    {preview.otherCharges > 0 && (
                      <SettleRow label="Other charges" value={preview.otherCharges} />
                    )}
                    {Number(damage) > 0 && (
                      <SettleRow label="Damage deduction" value={Number(damage)} />
                    )}
                    <div className="border-t border-slate-200 pt-2">
                      <SettleRow label="Deposit held" value={preview.depositHeld} positive />
                    </div>
                    <div
                      className={cn(
                        'mt-2 rounded-xl p-3 text-center',
                        preview.suggestedRefund > 0
                          ? 'bg-emerald-100/70'
                          : preview.suggestedPayable > 0
                            ? 'bg-red-100/70'
                            : 'bg-slate-200/60',
                      )}
                    >
                      <p className="text-[11px] uppercase tracking-wide text-slate-600">
                        {preview.suggestedRefund > 0
                          ? 'Refund to resident'
                          : preview.suggestedPayable > 0
                            ? 'Resident still owes'
                            : 'Fully settled'}
                      </p>
                      <p className="font-display text-2xl font-semibold text-slate-900 tabular">
                        {formatMoney(
                          preview.suggestedRefund > 0
                            ? preview.suggestedRefund
                            : preview.suggestedPayable,
                        )}
                      </p>
                    </div>
                    {preview.suggestedRefund > 0 && (
                      <label className="flex cursor-pointer items-center gap-2 pt-1 text-sm text-slate-600">
                        <Checkbox
                          checked={refundPaid}
                          onCheckedChange={(c) => setRefundPaid(c === true)}
                        />
                        Refund paid out today
                      </label>
                    )}
                  </div>
                )}
              </div>
            </div>

            <DialogFooter>
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button variant="destructive" loading={busy} onClick={submit}>
                <DoorOpen className="size-4" />
                Complete checkout
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

function SettleRow({
  label,
  value,
  positive,
}: {
  label: string
  value: number
  positive?: boolean
}) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-slate-600">{label}</span>
      <span
        className={cn('font-medium tabular', positive ? 'text-emerald-600' : 'text-slate-800')}
      >
        {positive ? '+' : ''}
        {formatMoney(value)}
      </span>
    </div>
  )
}
