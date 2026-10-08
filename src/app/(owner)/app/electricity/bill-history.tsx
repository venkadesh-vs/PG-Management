'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Ban, ChevronDown, Loader2 } from 'lucide-react'
import { api, ApiError } from '@/lib/client'
import { cn, formatDate, formatMoney } from '@/lib/utils'
import { billingMonthLabel } from '@/lib/electricity'
import { useToast } from '@/components/ui/toast'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/feedback'
import { Field, Textarea } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { ElectricityBillRow } from './page'

const STATUS: Record<string, { label: string; variant: 'success' | 'warning' | 'default' }> = {
  FINALIZED: { label: 'Finalized', variant: 'success' },
  DRAFT: { label: 'Draft', variant: 'warning' },
  VOID: { label: 'Voided', variant: 'default' },
}

const PAYMENT: Record<string, { label: string; variant: 'success' | 'warning' | 'danger' | 'info' | 'default' }> = {
  PAID: { label: 'Paid', variant: 'success' },
  PARTIALLY_PAID: { label: 'Partly paid', variant: 'warning' },
  PENDING: { label: 'Pending', variant: 'danger' },
  NOT_INVOICED: { label: 'On next rent invoice', variant: 'info' },
  NOT_FINALIZED: { label: 'Not finalized', variant: 'default' },
  UNCOLLECTIBLE: { label: 'Owner pays', variant: 'default' },
  NOTHING_DUE: { label: 'Nothing due', variant: 'default' },
  VOID: { label: 'Voided', variant: 'default' },
}

const units = (n: number) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 }).format(n)
const rate = (n: number) => `₹${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(n)}`

/** Room | Units | Rate | Electricity | Occupants | Per person, with each resident's share. */
export function BillHistory({ bills, canManage }: { bills: ElectricityBillRow[]; canManage: boolean }) {
  const [voiding, setVoiding] = React.useState<ElectricityBillRow | null>(null)

  if (!bills.length) {
    return <EmptyState compact icon="zap" title="No bills for these filters" description="Bills appear here once readings are saved as drafts." />
  }

  return (
    <>
      {/* Desktop table */}
      <div className="hidden overflow-x-auto rounded-xl border border-slate-200 md:block">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2.5">Room</th>
              <th className="px-3 py-2.5 text-right">Units</th>
              <th className="px-3 py-2.5 text-right">Rate</th>
              <th className="px-3 py-2.5 text-right">Electricity</th>
              <th className="px-3 py-2.5 text-right">Occupants</th>
              <th className="px-3 py-2.5 text-right">Per person</th>
              <th className="px-3 py-2.5">Status</th>
              <th className="px-3 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {bills.map((b) => (
              <DesktopRow key={b.id} bill={b} canManage={canManage} onVoid={() => setVoiding(b)} />
            ))}
          </tbody>
        </table>
      </div>

      {/* Phone cards */}
      <ul className="space-y-3 md:hidden">
        {bills.map((b) => (
          <MobileCard key={b.id} bill={b} canManage={canManage} onVoid={() => setVoiding(b)} />
        ))}
      </ul>

      <VoidDialog bill={voiding} onClose={() => setVoiding(null)} />
    </>
  )
}

function canVoid(bill: ElectricityBillRow) {
  return bill.status !== 'VOID' && bill.shares.every((s) => !s.invoiceNumber)
}

function DesktopRow({ bill, canManage, onVoid }: { bill: ElectricityBillRow; canManage: boolean; onVoid: () => void }) {
  const [open, setOpen] = React.useState(false)
  const status = STATUS[bill.status] ?? STATUS.DRAFT
  return (
    <>
      <tr className={cn(bill.status === 'VOID' && 'text-slate-400')}>
        <td className="px-3 py-3">
          <button type="button" onClick={() => setOpen((o) => !o)} className="flex items-center gap-1.5 font-medium text-slate-900" aria-expanded={open}>
            <ChevronDown className={cn('size-3.5 text-slate-400 transition', open && 'rotate-180')} />
            {bill.roomNumber}
          </button>
          <p className="pl-5 text-xs text-slate-500">
            {billingMonthLabel(bill.billingMonth)}
            {bill.kind === 'INTERIM' && ' · checkout'}
          </p>
        </td>
        <td className="px-3 py-3 text-right tabular-nums">{units(bill.units)}</td>
        <td className="px-3 py-3 text-right tabular-nums">{rate(bill.ratePerUnit)}</td>
        <td className="px-3 py-3 text-right font-medium tabular-nums text-slate-900">{formatMoney(bill.amount)}</td>
        <td className="px-3 py-3 text-right tabular-nums">{bill.ownerAbsorbed ? 'Owner' : bill.occupantCount}</td>
        <td className="px-3 py-3 text-right tabular-nums">{bill.ownerAbsorbed ? '—' : formatMoney(bill.perPerson)}</td>
        <td className="px-3 py-3">
          <Badge variant={status.variant} size="sm">
            {status.label}
          </Badge>
        </td>
        <td className="px-3 py-3 text-right">
          {canManage && canVoid(bill) && (
            <Button variant="ghost" size="icon-sm" onClick={onVoid} aria-label={`Void bill for room ${bill.roomNumber}`}>
              <Ban className="size-4" />
            </Button>
          )}
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={8} className="bg-slate-50/60 px-3 py-3">
            <ShareList bill={bill} />
          </td>
        </tr>
      )}
    </>
  )
}

function MobileCard({ bill, canManage, onVoid }: { bill: ElectricityBillRow; canManage: boolean; onVoid: () => void }) {
  const [open, setOpen] = React.useState(false)
  const status = STATUS[bill.status] ?? STATUS.DRAFT
  return (
    <li className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium text-slate-900">Room {bill.roomNumber}</p>
          <p className="text-xs text-slate-500">
            {billingMonthLabel(bill.billingMonth)}
            {bill.kind === 'INTERIM' && ' · checkout'} · {units(bill.units)} units × {rate(bill.ratePerUnit)}
          </p>
        </div>
        <div className="text-right">
          <p className="font-semibold tabular-nums text-slate-900">{formatMoney(bill.amount)}</p>
          <Badge variant={status.variant} size="sm">
            {status.label}
          </Badge>
        </div>
      </div>
      <p className="mt-2 text-sm text-slate-600">
        {bill.ownerAbsorbed ? 'Paid by the owner' : `${bill.occupantCount} sharing · about ${formatMoney(bill.perPerson)} each`}
      </p>
      <div className="mt-2 flex items-center justify-between gap-2">
        <button type="button" onClick={() => setOpen((o) => !o)} className="flex items-center gap-1 text-xs font-medium text-blue-700" aria-expanded={open}>
          <ChevronDown className={cn('size-3.5 transition', open && 'rotate-180')} />
          {open ? 'Hide shares' : 'Who pays what'}
        </button>
        {canManage && canVoid(bill) && (
          <Button variant="ghost" size="sm" onClick={onVoid}>
            <Ban className="size-4" />
            Void
          </Button>
        )}
      </div>
      {open && (
        <div className="mt-2">
          <ShareList bill={bill} />
        </div>
      )}
    </li>
  )
}

function ShareList({ bill }: { bill: ElectricityBillRow }) {
  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-500">
        Meter {bill.meterNumber}: {units(bill.previousReading)} → {units(bill.currentReading)}, {formatDate(bill.periodStart)} to {formatDate(bill.periodEnd)}
        {bill.voidReason && ` · voided: ${bill.voidReason}`}
      </p>
      {bill.shares.length ? (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
          {bill.shares.map((s) => {
            const pay = PAYMENT[s.paymentStatus] ?? PAYMENT.NOT_FINALIZED
            return (
              <li key={s.residentId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                <span className="min-w-0 text-slate-700">
                  {s.residentName}
                  {s.bedLabel ? ` · bed ${s.bedLabel}` : ''}
                  <span className="text-slate-500"> · {s.daysStayed} day{s.daysStayed === 1 ? '' : 's'}</span>
                </span>
                <span className="flex items-center gap-2">
                  <Badge variant={pay.variant} size="sm">
                    {pay.label}
                    {s.invoiceNumber ? ` · ${s.invoiceNumber}` : ''}
                  </Badge>
                  <span className="font-medium tabular-nums text-slate-900">{formatMoney(s.shareAmount)}</span>
                </span>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="text-sm text-slate-500">No resident shares on this bill.</p>
      )}
    </div>
  )
}

function VoidDialog({ bill, onClose }: { bill: ElectricityBillRow | null; onClose: () => void }) {
  const router = useRouter()
  const toast = useToast()
  const [reason, setReason] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!bill) return
    setBusy(true)
    try {
      await api.post('/api/electricity/bills', { action: 'VOID', billId: bill.id, reason })
      toast.success('Bill voided', `Room ${bill.roomNumber} can be billed again with a corrected reading.`)
      setReason('')
      onClose()
      router.refresh()
    } catch (error) {
      toast.error('Could not void the bill', error instanceof ApiError ? error.message : 'Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={Boolean(bill)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Void the bill for room {bill?.roomNumber}?</DialogTitle>
            <DialogDescription>
              The residents&apos; shares are removed before they reach a rent invoice. The bill stays on record as voided. Bills already on an invoice are corrected with a credit note instead.
            </DialogDescription>
          </DialogHeader>
          <Field label="Reason" required htmlFor="void-reason">
            <Textarea id="void-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Wrong reading typed" rows={3} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Keep the bill
            </Button>
            <Button type="submit" variant="destructive" disabled={busy || reason.trim().length < 3}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              Void bill
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
