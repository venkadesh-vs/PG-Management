'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { AnimatePresence, animate, motion } from 'framer-motion'
import {
  ArrowRightLeft,
  CalendarClock,
  Check,
  CircleCheck,
  DoorOpen,
  FileText,
  MoreHorizontal,
  Plus,
  Receipt,
  Trash2,
  Wallet,
} from 'lucide-react'
import { api, ApiError } from '@/lib/client'
import { InvoicePicker, ProofUpload } from '../../payments/payment-fields'
import { cn, formatDate, formatMoney, toISODate } from '@/lib/utils'
import { blankChecklist, type Checklist } from '@/lib/checkout-checklist'
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
  noticeDate?: string | null
}

type Invoice = { id: string; number: string; balance: number; dueDate: string }

type RoomAsset = { id: string; name: string; category: string; condition: string; status: string; value: number }

type CheckoutPreview = {
  exitDate: string
  oneTimeCharges: { label: string; amount: number }[]
  oneTimeTotal: number
  futureInvoices: { id: string; number: string; period: string; total: number; amountPaid: number }[]
  roomAssets: RoomAsset[]
  openInvoices: { id: string; number: string; balance: number; dueDate: string }[]
  outstandingRent: number
  utilities: { id: string; label: string; amount: number }[]
  utilityCharges: number
  deductions: { label: string; amount: number }[]
  deductionsTotal: number
  exitMonth: {
    label: string
    invoiced: boolean
    usedDays: number
    unusedDays: number
    charge: number
    credit: number
    lines: { label: string; amount: number }[]
  }
  depositHeld: number
  advance: number
  owed: number
  credits: number
  applied: { unusedCredit: number; advance: number; deposit: number }
  refundable: number
  payable: number
}

type CheckoutResult = {
  message: string
  refund: number
  payable: number
  refundPaid: boolean
  settlementInvoice: { id: string; number: string } | null
}

/**
 * Everything an owner does to a resident after check-in: record a payment,
 * move them to another bed, mark notice, and run the checkout settlement.
 */
export function ResidentActions({
  resident,
  openInvoices,
  availableBeds,
  can = { recordPayment: true, manage: true, checkout: true },
}: {
  resident: Resident
  openInvoices: Invoice[]
  availableBeds: { id: string; label: string; rent?: number }[]
  /** payments.record / residents.manage / residents.checkout / rent.manage */
  can?: { recordPayment: boolean; manage: boolean; checkout: boolean; rent?: boolean }
}) {
  const [dialog, setDialog] = React.useState<'payment' | 'transfer' | 'notice' | 'checkout' | null>(
    null,
  )
  // "Approve & open transfer" on a room-change request links here with ?transfer=1.
  React.useEffect(() => {
    if (new URLSearchParams(window.location.search).get('transfer') === '1') setDialog('transfer')
  }, [])
  // The "Checkout" quick action links here with ?checkout=1.
  React.useEffect(() => {
    if (new URLSearchParams(window.location.search).get('checkout') === '1' && can.checkout && resident.status !== 'CHECKED_OUT') {
      setDialog('checkout')
    }
  }, [can.checkout, resident.status])
  const active = resident.status !== 'CHECKED_OUT'

  return (
    <>
      {active && can.recordPayment && (
        <Button
          variant={resident.propertyType === 'WOMENS' ? 'pink' : 'primary'}
          onClick={() => setDialog('payment')}
        >
          <Wallet className="size-4" />
          Record payment
        </Button>
      )}

      {(can.manage || can.checkout) && (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon" aria-label="More actions">
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          {active ? (
            <>
              {can.manage && (
                <>
                  <DropdownMenuItem onSelect={() => setDialog('transfer')}>
                    <ArrowRightLeft />
                    Move to another bed
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setDialog('notice')}>
                    <CalendarClock />
                    Mark notice period
                  </DropdownMenuItem>
                </>
              )}
              {can.manage && can.checkout && <DropdownMenuSeparator />}
              {can.checkout && (
                <DropdownMenuItem destructive onSelect={() => setDialog('checkout')}>
                  <DoorOpen />
                  Check out & settle
                </DropdownMenuItem>
              )}
            </>
          ) : (
            <DropdownMenuItem disabled>
              <CircleCheck />
              Already checked out
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      )}

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
        canChangeRent={Boolean(can.rent)}
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
  const [utr, setUtr] = React.useState('')
  const [proof, setProof] = React.useState('')
  const [uploading, setUploading] = React.useState(false)
  const [notes, setNotes] = React.useState('')
  // Empty = oldest due first; ticked invoices are paid first, in tick order.
  const [selected, setSelected] = React.useState<string[]>([])
  const [busy, setBusy] = React.useState(false)
  const [receipt, setReceipt] = React.useState<{ receiptNumber: string; amount: number } | null>(
    null,
  )

  React.useEffect(() => {
    if (open) {
      setAmount(String(resident.outstanding || resident.rentAmount))
      setReceipt(null)
      setSelected([])
      setUtr('')
      setProof('')
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
          utr: utr || undefined,
          attachmentUrl: proof || undefined,
          notes: notes || undefined,
          invoiceIds: selected.length ? selected : undefined,
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
      toast.fromError(error, 'record the payment')
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
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-left">
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

                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="UTR / transaction ID" hint="From the UPI app or bank SMS">
                    <Input value={utr} onChange={(e) => setUtr(e.target.value)} />
                  </Field>
                  <Field label="Reference" hint="Cheque number or other ref">
                    <Input value={reference} onChange={(e) => setReference(e.target.value)} />
                  </Field>
                </div>
                <ProofUpload value={proof} onChange={setProof} residentId={resident.id} onBusyChange={setUploading} />

                <InvoicePicker
                  invoices={invoices}
                  value={selected}
                  onChange={setSelected}
                  amount={Number(amount) || 0}
                />

                <Field label="Notes">
                  <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
                </Field>
              </div>

              <DialogFooter>
                <Button variant="ghost" onClick={onClose}>
                  Cancel
                </Button>
                <Button variant="primary" loading={busy} disabled={uploading} onClick={submit}>
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
  canChangeRent,
}: {
  open: boolean
  onClose: () => void
  resident: Resident
  beds: { id: string; label: string; rent?: number }[]
  canChangeRent: boolean
}) {
  const router = useRouter()
  const toast = useToast()
  const [bedId, setBedId] = React.useState('')
  const [moveDate, setMoveDate] = React.useState(toISODate(new Date()))
  const [rentMode, setRentMode] = React.useState<'keep' | 'bed' | 'custom'>('keep')
  const [customRent, setCustomRent] = React.useState('')
  const [reason, setReason] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  const bed = beds.find((b) => b.id === bedId)
  const bedRent = bed?.rent ?? null
  const newRent =
    rentMode === 'bed' ? bedRent : rentMode === 'custom' ? Math.round(Number(customRent) || 0) : null
  const changesRent = newRent != null && newRent > 0 && newRent !== resident.rentAmount

  React.useEffect(() => {
    if (open) {
      setBedId('')
      setRentMode('keep')
      setCustomRent('')
      setReason('')
      setMoveDate(toISODate(new Date()))
    }
  }, [open])

  async function submit() {
    if (!bedId) {
      toast.error('Please select a valid bed', 'Choose where they are moving to.')
      return
    }
    if (rentMode === 'custom' && !(newRent && newRent > 0)) {
      toast.error('Enter the new rent', 'Or keep the current rent.')
      return
    }
    setBusy(true)
    try {
      const result = await api.post<{ message: string }>('/api/residents/actions', {
        action: 'TRANSFER',
        residentId: resident.id,
        toBedId: bedId,
        effectiveDate: moveDate,
        ...(changesRent ? { newRent, rentReason: reason || undefined } : {}),
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
            The old bed becomes available and the move is kept in the resident&apos;s stay history.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="New bed" required className="min-w-0">
            <Select value={bedId} onChange={(e) => setBedId(e.target.value)}>
              <option value="">Select an available bed</option>
              {beds.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.label}
                  {b.rent ? ` · ${formatMoney(b.rent)}` : ''}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Moving on" required className="min-w-0">
            <Input type="date" value={moveDate} onChange={(e) => setMoveDate(e.target.value)} />
          </Field>
        </div>
        {beds.length === 0 && (
          <p className="text-xs text-amber-600">
            No vacant beds in this PG right now. Free one up from the bed map first.
          </p>
        )}

        {canChangeRent && bed && (
          <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
            <p className="text-xs font-medium text-slate-500">Rent after the move</p>
            <div className="grid gap-2">
              {(
                [
                  ['keep', `Keep current rent · ${formatMoney(resident.rentAmount)}`],
                  ...(bedRent && bedRent !== resident.rentAmount
                    ? [['bed', `Use the new bed's rent · ${formatMoney(bedRent)}`]]
                    : []),
                  ['custom', 'Set a different rent'],
                ] as [typeof rentMode, string][]
              ).map(([value, label]) => (
                <label
                  key={value}
                  className={cn(
                    'flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm',
                    rentMode === value ? 'border-slate-900 bg-white' : 'border-slate-200 bg-white/60',
                  )}
                >
                  <input
                    type="radio"
                    name="rent-mode"
                    checked={rentMode === value}
                    onChange={() => setRentMode(value)}
                  />
                  <span className="min-w-0">{label}</span>
                </label>
              ))}
            </div>
            {rentMode === 'custom' && (
              <Field label="New monthly rent" required>
                <Input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={customRent}
                  onChange={(e) => setCustomRent(e.target.value)}
                />
              </Field>
            )}
            {changesRent && (
              <>
                <Field label="Reason" hint="Shown on the rent history and any invoice note">
                  <Input
                    placeholder="Moved to an AC room"
                    value={reason}
                    maxLength={200}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </Field>
                <p className="text-xs text-slate-500">
                  The new rent applies from {formatDate(moveDate)}. A month already invoiced gets a
                  debit or credit note for the days at the new rate — the original invoice is not
                  rewritten.
                </p>
              </>
            )}
          </div>
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
  const [exitDate, setExitDate] = React.useState(() =>
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

type DeductionRow = { key: number; label: string; amount: string }

const REFUND_METHODS = [
  { value: 'UPI', label: 'UPI' },
  { value: 'CASH', label: 'Cash' },
  { value: 'BANK_TRANSFER', label: 'Bank transfer' },
  { value: 'CHEQUE', label: 'Cheque' },
]

const STEPS = ['Exit date', 'Room check', 'Settlement', 'Refund'] as const

type DamageRow = { outcome: 'OK' | 'DAMAGED' | 'MISSING'; amount: string; note: string }

/** A rupee figure that counts to its new value instead of jumping. */
function AnimatedMoney({ value, className }: { value: number; className?: string }) {
  const [display, setDisplay] = React.useState(value)
  const from = React.useRef(value)
  React.useEffect(() => {
    const controls = animate(from.current, value, {
      duration: 0.45,
      ease: 'easeOut',
      onUpdate: (v) => setDisplay(Math.round(v)),
    })
    from.current = value
    return () => controls.stop()
  }, [value])
  return <span className={cn('tabular', className)}>{formatMoney(display)}</span>
}

function daysBetween(a: Date, b: Date) {
  return Math.round((b.getTime() - a.getTime()) / 86400000)
}

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
  const today = toISODate(new Date())
  const [step, setStep] = React.useState(0)
  const [exitDate, setExitDate] = React.useState(
    resident.exitDate ? resident.exitDate.slice(0, 10) : today,
  )
  const [reason, setReason] = React.useState('')
  const [rows, setRows] = React.useState<DeductionRow[]>([])
  const [note, setNote] = React.useState('')
  const [refundMode, setRefundMode] = React.useState<'now' | 'later'>('now')
  const [method, setMethod] = React.useState('UPI')
  const [reference, setReference] = React.useState('')
  const [preview, setPreview] = React.useState<CheckoutPreview | null>(null)
  const [previewError, setPreviewError] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [done, setDone] = React.useState<CheckoutResult | null>(null)
  const [inspection, setInspection] = React.useState<Checklist>(() => blankChecklist('inspection'))
  const [clearance, setClearance] = React.useState<Checklist>(() => blankChecklist('clearance'))
  const [damages, setDamages] = React.useState<Record<string, DamageRow>>({})
  const nextKey = React.useRef(1)

  React.useEffect(() => {
    if (open) {
      setStep(0)
      setDone(null)
      setPreviewError(null)
      setInspection(blankChecklist('inspection'))
      setClearance(blankChecklist('clearance'))
      setDamages({})
    }
  }, [open])

  const assetDamages = React.useMemo(
    () =>
      Object.entries(damages)
        .filter(([, d]) => d.outcome !== 'OK')
        .map(([assetId, d]) => ({
          assetId,
          outcome: d.outcome as 'DAMAGED' | 'MISSING',
          amount: Math.max(0, Math.round(Number(d.amount) || 0)),
          note: d.note.trim() || undefined,
        })),
    [damages],
  )
  const damageKey = JSON.stringify(assetDamages)

  const deductions = React.useMemo(
    () =>
      rows
        .map((r) => ({ label: r.label.trim() || 'Deduction', amount: Math.max(0, Math.round(Number(r.amount) || 0)) }))
        .filter((d) => d.amount > 0),
    [rows],
  )
  const deductionKey = JSON.stringify(deductions)

  // Live settlement: recompute shortly after any input that affects it changes.
  React.useEffect(() => {
    if (!open || !exitDate) return
    let cancelled = false
    setLoading(true)
    const timer = setTimeout(() => {
      api
        .post<{ preview: CheckoutPreview }>('/api/residents/actions', {
          action: 'CHECKOUT_PREVIEW',
          residentId: resident.id,
          exitDate,
          deductions: JSON.parse(deductionKey),
          assetDamages: JSON.parse(damageKey),
        })
        .then((data) => {
          if (cancelled) return
          setPreview(data.preview)
          setPreviewError(null)
        })
        .catch((error) => {
          if (!cancelled) {
            setPreviewError(error instanceof ApiError ? error.message : 'Could not calculate the settlement.')
          }
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [open, resident.id, exitDate, deductionKey, damageKey])

  // Notice check
  const exit = new Date(`${exitDate}T00:00:00`)
  const notice = resident.noticeDate ? new Date(resident.noticeDate) : null
  const noticeDays = notice ? daysBetween(notice, exit) : null
  const futureExit = exitDate > today

  async function submit() {
    if (!preview) return
    if (preview.refundable > 0 && refundMode === 'now' && !method) {
      toast.error('Choose a refund method', 'Pick how the refund was paid, or choose “Pay later”.')
      return
    }
    setBusy(true)
    try {
      const result = await api.post<CheckoutResult>('/api/residents/actions', {
        action: 'CHECKOUT',
        residentId: resident.id,
        exitDate,
        reason: reason || undefined,
        deductions,
        assetDamages,
        inspection,
        clearance,
        settlementNote: note || undefined,
        refund:
          preview.refundable > 0 && refundMode === 'now'
            ? { method, reference: reference || undefined }
            : null,
      })
      setDone(result)
      toast.success(
        'Checkout complete',
        result.refund > 0
          ? result.refundPaid
            ? `${formatMoney(result.refund)} refunded to ${resident.fullName}.`
            : `${formatMoney(result.refund)} refund saved as pending.`
          : result.payable > 0
            ? `${formatMoney(result.payable)} is still payable on the settlement invoice.`
            : `${resident.fullName} is fully settled.`,
      )
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

  const canNext =
    step === 0
      ? Boolean(exitDate) && !previewError
      : step === 1
        ? !previewError
        : Boolean(preview) && !loading

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent size="lg">
        {done ? (
          <CheckoutSuccess done={done} name={resident.fullName} onClose={onClose} />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Check out {resident.fullName}</DialogTitle>
              <DialogDescription>
                We settle everything in one go — dues, utilities, deductions, the deposit and any
                advance — then free up the bed.
              </DialogDescription>
            </DialogHeader>

            <ol className="flex items-center gap-2 text-xs">
              {STEPS.map((label, i) => (
                <li key={label} className="flex flex-1 items-center gap-2">
                  <span
                    className={cn(
                      'flex size-6 shrink-0 items-center justify-center rounded-full font-semibold transition-colors',
                      i < step
                        ? 'bg-emerald-500 text-white'
                        : i === step
                          ? 'bg-slate-900 text-white'
                          : 'bg-slate-100 text-slate-500',
                    )}
                  >
                    {i < step ? <Check className="size-3.5" strokeWidth={3} /> : i + 1}
                  </span>
                  <span className={cn('truncate', i === step ? 'font-medium text-slate-900' : 'text-slate-500')}>
                    {label}
                  </span>
                  {i < STEPS.length - 1 && <span className="h-px flex-1 bg-slate-200" />}
                </li>
              ))}
            </ol>

            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={step}
                initial={{ opacity: 0, x: 16 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -16 }}
                transition={{ duration: 0.18 }}
                className="min-h-[18rem]"
              >
                {step === 0 && (
                  <div className="space-y-4">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field label="Exit date" required hint="The last day they stay">
                        <Input type="date" value={exitDate} onChange={(e) => setExitDate(e.target.value)} />
                      </Field>
                      <Field label="Reason for leaving">
                        <Input
                          placeholder="Job relocation"
                          value={reason}
                          onChange={(e) => setReason(e.target.value)}
                        />
                      </Field>
                    </div>

                    <div
                      className={cn(
                        'flex items-start gap-3 rounded-xl border p-4 text-sm',
                        noticeDays != null && noticeDays >= 30
                          ? 'border-emerald-200 bg-emerald-50/70 text-emerald-800'
                          : 'border-amber-200 bg-amber-50/70 text-amber-800',
                      )}
                    >
                      <CalendarClock className="mt-0.5 size-4 shrink-0" />
                      <div>
                        {notice ? (
                          <>
                            <p className="font-medium">
                              Notice given on {formatDate(notice)} —{' '}
                              {noticeDays != null && noticeDays >= 0
                                ? `${noticeDays} day${noticeDays === 1 ? '' : 's'} before exit`
                                : 'after this exit date'}
                            </p>
                            <p className="mt-0.5 text-xs opacity-80">
                              {noticeDays != null && noticeDays >= 30
                                ? 'Full notice period served.'
                                : 'Shorter than a month. Add a notice-period deduction in the next step if your house rules call for one.'}
                            </p>
                          </>
                        ) : (
                          <>
                            <p className="font-medium">No notice was recorded</p>
                            <p className="mt-0.5 text-xs opacity-80">
                              If they left without notice, you can add a deduction in the next step.
                            </p>
                          </>
                        )}
                      </div>
                    </div>

                    {futureExit && (
                      <p className="text-xs text-slate-500">
                        The exit date is in the future. Checking out now still frees the bed today —
                        if they are staying on, use “Mark notice period” instead.
                      </p>
                    )}
                    {previewError && <p className="text-sm text-rose-600">{previewError}</p>}
                  </div>
                )}

                {step === 1 && (
                  <RoomCheckStep
                    assets={preview?.roomAssets ?? null}
                    inspection={inspection}
                    onInspection={setInspection}
                    clearance={clearance}
                    onClearance={setClearance}
                    damages={damages}
                    onDamages={setDamages}
                  />
                )}

                {step === 2 && (
                  <SettlementStep
                    preview={preview}
                    loading={loading}
                    error={previewError}
                    rows={rows}
                    onRows={setRows}
                    nextKey={() => nextKey.current++}
                  />
                )}

                {step === 3 && preview && (
                  <div className="space-y-4">
                    <SettlementResult preview={preview} />

                    {preview.refundable > 0 ? (
                      <div className="space-y-3">
                        <div className="grid grid-cols-2 gap-2">
                          {(['now', 'later'] as const).map((m) => (
                            <button
                              key={m}
                              type="button"
                              onClick={() => setRefundMode(m)}
                              className={cn(
                                'rounded-xl border p-3 text-left transition-colors',
                                refundMode === m
                                  ? 'border-slate-900 bg-slate-900 text-white'
                                  : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300',
                              )}
                            >
                              <p className="text-sm font-semibold">{m === 'now' ? 'Refund now' : 'Pay later'}</p>
                              <p className={cn('text-xs', refundMode === m ? 'text-white/70' : 'text-slate-500')}>
                                {m === 'now'
                                  ? 'I am paying it today'
                                  : 'Keep it pending on the deposit card'}
                              </p>
                            </button>
                          ))}
                        </div>
                        <AnimatePresence initial={false}>
                          {refundMode === 'now' && (
                            <motion.div
                              key="refund-now"
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: 'auto' }}
                              exit={{ opacity: 0, height: 0 }}
                              className="grid gap-4 overflow-hidden sm:grid-cols-2"
                            >
                              <Field label="Paid by" required>
                                <Select value={method} onChange={(e) => setMethod(e.target.value)}>
                                  {REFUND_METHODS.map((m) => (
                                    <option key={m.value} value={m.value}>
                                      {m.label}
                                    </option>
                                  ))}
                                </Select>
                              </Field>
                              <Field label="Reference" hint="UPI ref, cheque no. or transaction id">
                                <Input value={reference} onChange={(e) => setReference(e.target.value)} />
                              </Field>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    ) : preview.payable > 0 ? (
                      <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
                        {formatMoney(preview.payable)} stays open on their invoices. Record a payment
                        from this page whenever they pay.
                      </p>
                    ) : null}

                    <Field label="Settlement note" hint="Saved with the checkout and shown on the deposit card">
                      <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
                    </Field>
                  </div>
                )}
              </motion.div>
            </AnimatePresence>

            <DialogFooter>
              {step === 0 ? (
                <Button variant="ghost" onClick={onClose}>
                  Cancel
                </Button>
              ) : (
                <Button variant="ghost" onClick={() => setStep(step - 1)} disabled={busy}>
                  Back
                </Button>
              )}
              {step < STEPS.length - 1 ? (
                <Button variant="default" onClick={() => setStep(step + 1)} disabled={!canNext}>
                  Continue
                </Button>
              ) : (
                <Button variant="destructive" loading={busy} onClick={submit} disabled={!preview || loading}>
                  <DoorOpen className="size-4" />
                  Complete checkout
                </Button>
              )}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

const ASSET_OUTCOMES: { value: DamageRow['outcome']; label: string }[] = [
  { value: 'OK', label: 'OK' },
  { value: 'DAMAGED', label: 'Damaged' },
  { value: 'MISSING', label: 'Missing' },
]

function RoomCheckStep({
  assets,
  inspection,
  onInspection,
  clearance,
  onClearance,
  damages,
  onDamages,
}: {
  assets: RoomAsset[] | null
  inspection: Checklist
  onInspection: (c: Checklist) => void
  clearance: Checklist
  onClearance: (c: Checklist) => void
  damages: Record<string, DamageRow>
  onDamages: (d: Record<string, DamageRow>) => void
}) {
  const setDamage = (id: string, patch: Partial<DamageRow>) =>
    onDamages({ ...damages, [id]: { ...(damages[id] ?? { outcome: 'OK', amount: '', note: '' }), ...patch } })

  return (
    <div className="max-h-[24rem] space-y-5 overflow-y-auto pr-1">
      <ChecklistBlock title="Room inspection" list={inspection} onChange={onInspection} withNotes />
      <ChecklistBlock title="Clearance" list={clearance} onChange={onClearance} />

      <div>
        <p className="mb-1.5 text-xs font-medium text-slate-500">
          Items in the room
        </p>
        {assets === null ? (
          <div className="skeleton h-5 w-full" />
        ) : assets.length === 0 ? (
          <p className="text-xs text-slate-500">
            No inventory is recorded against this room or bed. Add any damage as a deduction in the next step.
          </p>
        ) : (
          <ul className="space-y-2">
            {assets.map((asset) => {
              const row = damages[asset.id] ?? { outcome: 'OK', amount: '', note: '' }
              return (
                <li key={asset.id} className="min-w-0 rounded-xl border border-slate-200 bg-white p-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-800">{asset.name}</p>
                      <p className="text-xs text-slate-500">
                        {asset.category}
                        {asset.value ? ` · value ${formatMoney(asset.value)}` : ''}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      {ASSET_OUTCOMES.map((o) => (
                        <button
                          key={o.value}
                          type="button"
                          onClick={() => setDamage(asset.id, { outcome: o.value })}
                          className={cn(
                            'rounded-lg border px-2 py-1 text-xs font-medium transition-colors',
                            row.outcome === o.value
                              ? o.value === 'OK'
                                ? 'border-emerald-600 bg-emerald-600 text-white'
                                : 'border-rose-600 bg-rose-600 text-white'
                              : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300',
                          )}
                        >
                          {o.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  {row.outcome !== 'OK' && (
                    <div className="mt-2 flex gap-2">
                      <Input
                        className="h-9 min-w-0 flex-1"
                        placeholder="What happened"
                        maxLength={200}
                        value={row.note}
                        onChange={(e) => setDamage(asset.id, { note: e.target.value })}
                      />
                      <Input
                        className="h-9 w-28"
                        type="number"
                        inputMode="numeric"
                        min={0}
                        placeholder="Deduct ₹"
                        value={row.amount}
                        onChange={(e) => setDamage(asset.id, { amount: e.target.value })}
                      />
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}

export function ChecklistBlock({
  title,
  list,
  onChange,
  withNotes,
  disabled,
}: {
  title: string
  list: Checklist
  onChange: (c: Checklist) => void
  withNotes?: boolean
  disabled?: boolean
}) {
  const done = list.items.filter((i) => i.ok).length
  const update = (key: string, patch: Partial<Checklist['items'][number]>) =>
    onChange({ ...list, items: list.items.map((i) => (i.key === key ? { ...i, ...patch } : i)) })
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <p className="text-xs font-medium text-slate-500">{title}</p>
        <span className={cn('text-xs font-semibold tabular', done === list.items.length ? 'text-emerald-600' : 'text-slate-500')}>
          {done}/{list.items.length}
        </span>
      </div>
      <ul className="space-y-1.5">
        {list.items.map((item) => (
          <li key={item.key} className="min-w-0">
            <label className="flex cursor-pointer items-start gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                className="mt-0.5 size-4 shrink-0 accent-emerald-600"
                checked={item.ok}
                disabled={disabled}
                onChange={(e) => update(item.key, { ok: e.target.checked })}
              />
              <span className="min-w-0">{item.label}</span>
            </label>
            {withNotes && !item.ok && (item.note !== undefined || !disabled) && (
              <Input
                className="mt-1 h-8 text-xs"
                placeholder="Note (optional)"
                maxLength={200}
                disabled={disabled}
                value={item.note ?? ''}
                onChange={(e) => update(item.key, { note: e.target.value || undefined })}
              />
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

function SettlementStep({
  preview,
  loading,
  error,
  rows,
  onRows,
  nextKey,
}: {
  preview: CheckoutPreview | null
  loading: boolean
  error: string | null
  rows: DeductionRow[]
  onRows: (rows: DeductionRow[]) => void
  nextKey: () => number
}) {
  if (error) return <p className="text-sm text-rose-600">{error}</p>
  if (!preview) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="skeleton h-5 w-full" />
        ))}
      </div>
    )
  }
  const m = preview.exitMonth
  return (
    <div className="grid gap-4 sm:grid-cols-[1fr_15rem]">
      <div className="max-h-[22rem] space-y-4 overflow-y-auto pr-1">
        <Section title="Rent dues" total={preview.outstandingRent}>
          {preview.openInvoices.length ? (
            preview.openInvoices.map((i) => (
              <Line key={i.id} label={`${i.number} · due ${formatDate(i.dueDate)}`} value={i.balance} />
            ))
          ) : (
            <p className="text-xs text-slate-500">No unpaid invoices.</p>
          )}
        </Section>

        <Section title={`Exit month · ${m.label}`} total={m.charge - m.credit}>
          {m.invoiced ? (
            m.credit > 0 ? (
              <Line
                label={`Credit for ${m.unusedDays} unused day${m.unusedDays === 1 ? '' : 's'} (already invoiced)`}
                value={-m.credit}
              />
            ) : (
              <p className="text-xs text-slate-500">Already invoiced in full — no unused days.</p>
            )
          ) : m.lines.length ? (
            m.lines.map((l) => <Line key={l.label} label={l.label} value={l.amount} />)
          ) : (
            <p className="text-xs text-slate-500">Nothing to charge for this month.</p>
          )}
        </Section>

        {preview.oneTimeCharges.length > 0 && (
          <Section title="Unbilled charges" total={preview.oneTimeTotal}>
            {preview.oneTimeCharges.map((c, i) => (
              <Line key={`${c.label}-${i}`} label={c.label} value={c.amount} />
            ))}
          </Section>
        )}

        {preview.utilities.length > 0 && (
          <Section title="Unbilled utilities" total={preview.utilityCharges}>
            {preview.utilities.map((u) => (
              <Line key={u.id} label={u.label} value={u.amount} />
            ))}
          </Section>
        )}

        <Section title="Deductions" total={preview.deductionsTotal}>
          {preview.deductions
            .filter((d) => /^(Damaged|Missing) — /.test(d.label))
            .map((d) => (
              <Line key={d.label} label={d.label} value={d.amount} />
            ))}
          <AnimatePresence initial={false}>
            {rows.map((row) => (
              <motion.div
                key={row.key}
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="flex items-center gap-2 overflow-hidden py-0.5"
              >
                <Input
                  className="h-9 flex-1"
                  placeholder="Broken chair, cleaning…"
                  value={row.label}
                  maxLength={80}
                  onChange={(e) =>
                    onRows(rows.map((r) => (r.key === row.key ? { ...r, label: e.target.value } : r)))
                  }
                />
                <Input
                  className="h-9 w-28"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  placeholder="₹"
                  value={row.amount}
                  onChange={(e) =>
                    onRows(rows.map((r) => (r.key === row.key ? { ...r, amount: e.target.value } : r)))
                  }
                />
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Remove deduction"
                  onClick={() => onRows(rows.filter((r) => r.key !== row.key))}
                >
                  <Trash2 className="size-4" />
                </Button>
              </motion.div>
            ))}
          </AnimatePresence>
          <Button
            variant="outline"
            size="sm"
            className="mt-1"
            onClick={() => onRows([...rows, { key: nextKey(), label: '', amount: '' }])}
          >
            <Plus className="size-3.5" />
            Add deduction
          </Button>
        </Section>

        {preview.futureInvoices.length > 0 && (
          <div className="rounded-xl border border-sky-200 bg-sky-50/70 px-3 py-2.5 text-xs text-sky-800">
            <p className="font-medium">
              {preview.futureInvoices.length} invoice{preview.futureInvoices.length === 1 ? '' : 's'} after the exit
              month will be cancelled
            </p>
            <p className="mt-0.5 opacity-80">
              {preview.futureInvoices.map((i) => `${i.number} (${i.period})`).join(', ')}
              {preview.futureInvoices.some((i) => i.amountPaid > 0)
                ? ' — money already paid on them counts as advance below.'
                : '.'}
            </p>
          </div>
        )}

        <Section title="Credits" total={-preview.credits} positive>
          <Line label="Security deposit held" value={-preview.depositHeld} positive />
          {preview.advance > 0 && <Line label="Advance paid (unused)" value={-preview.advance} positive />}
        </Section>
      </div>

      <div className={cn('transition-opacity', loading && 'opacity-60')}>
        <SettlementResult preview={preview} compact />
      </div>
    </div>
  )
}

function SettlementResult({ preview, compact }: { preview: CheckoutPreview; compact?: boolean }) {
  const tone =
    preview.refundable > 0 ? 'refund' : preview.payable > 0 ? 'payable' : 'settled'
  return (
    <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50/70 p-4">
      <div className="flex items-center justify-between text-sm">
        <span className="text-slate-600">Total dues</span>
        <AnimatedMoney value={preview.owed} className="font-medium text-slate-800" />
      </div>
      <div className="flex items-center justify-between text-sm">
        <span className="text-slate-600">Deposit & credits</span>
        <AnimatedMoney value={preview.credits} className="font-medium text-emerald-600" />
      </div>
      <motion.div
        layout
        className={cn(
          'mt-2 rounded-xl p-3 text-center transition-colors',
          tone === 'refund' ? 'bg-emerald-100/80' : tone === 'payable' ? 'bg-rose-100/70' : 'bg-slate-200/60',
        )}
      >
        <p className="text-[11px] text-slate-500">
          {tone === 'refund' ? 'Refund to resident' : tone === 'payable' ? 'Resident still owes' : 'Fully settled'}
        </p>
        <AnimatedMoney
          value={tone === 'refund' ? preview.refundable : preview.payable}
          className={cn('font-display font-semibold text-slate-900', compact ? 'text-2xl' : 'text-3xl')}
        />
      </motion.div>
      {!compact && preview.applied.deposit > 0 && (
        <p className="text-center text-xs text-slate-500">
          {formatMoney(preview.applied.deposit)} of the deposit goes towards dues.
        </p>
      )}
    </div>
  )
}

function Section({
  title,
  total,
  positive,
  children,
}: {
  title: string
  total: number
  positive?: boolean
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <p className="text-xs font-medium text-slate-500">{title}</p>
        <span className={cn('text-xs font-semibold tabular', positive || total < 0 ? 'text-emerald-600' : 'text-slate-700')}>
          {total < 0 ? `− ${formatMoney(-total)}` : formatMoney(total)}
        </span>
      </div>
      <div className="space-y-1">{children}</div>
    </div>
  )
}

function Line({ label, value, positive }: { label: string; value: number; positive?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 text-sm">
      <span className="min-w-0 text-slate-600">{label}</span>
      <span className={cn('shrink-0 tabular', positive || value < 0 ? 'text-emerald-600' : 'text-slate-800')}>
        {value < 0 ? `− ${formatMoney(-value)}` : formatMoney(value)}
      </span>
    </div>
  )
}

function CheckoutSuccess({
  done,
  name,
  onClose,
}: {
  done: CheckoutResult
  name: string
  onClose: () => void
}) {
  const lines = [
    'Bed released and marked available',
    `Settlement recorded${done.settlementInvoice ? ` on ${done.settlementInvoice.number}` : ''}`,
    done.refund > 0
      ? `Refund ${formatMoney(done.refund)} ${done.refundPaid ? 'paid' : 'pending — mark it paid from the deposit card'}`
      : done.payable > 0
        ? `${formatMoney(done.payable)} still payable`
        : 'Nothing left to pay or refund',
    'Rent schedule stopped and food plan ended',
    'Resident app account closed',
  ]
  return (
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
      <DialogTitle>{name} has checked out</DialogTitle>
      <DialogDescription>Everything is settled and saved. Here is what happened:</DialogDescription>
      <ul className="mx-auto max-w-sm space-y-1.5 text-left text-sm text-slate-600">
        {lines.map((line, i) => (
          <motion.li
            key={line}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.1 + i * 0.07 }}
            className="flex items-start gap-2"
          >
            <CircleCheck
              className={cn(
                'mt-0.5 size-4 shrink-0',
                i === 2 && done.refund > 0 && !done.refundPaid ? 'text-amber-500' : 'text-emerald-500',
              )}
            />
            {line}
          </motion.li>
        ))}
      </ul>
      <div className="flex flex-col gap-2 sm:flex-row">
        {done.settlementInvoice && (
          <Button variant="outline" className="flex-1" asChild>
            <a href={`/api/documents/rent-invoice/${done.settlementInvoice.id}.pdf`} target="_blank" rel="noopener">
              <FileText className="size-4" />
              Settlement PDF
            </a>
          </Button>
        )}
        <Button variant="primary" className="flex-1" onClick={onClose}>
          Done
        </Button>
      </div>
    </motion.div>
  )
}
