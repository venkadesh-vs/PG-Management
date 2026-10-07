'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { BadgePercent, Ban, Plus, Receipt } from 'lucide-react'
import { api } from '@/lib/client'
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

export type ChargeItem = {
  id: string
  kind: 'RECURRING' | 'ONE_TIME' | 'DISCOUNT'
  category: string
  label: string
  amount: number
  startDate: string
  endDate: string | null
  billedInvoice: string | null
  lastBilledFor: string | null
  voidedAt: string | null
  voidReason: string | null
}

const CATEGORY_LABEL: Record<string, string> = {
  LAUNDRY: 'Laundry',
  MAINTENANCE: 'Maintenance',
  ELECTRICITY: 'Electricity share',
  FOOD: 'Food',
  JOINING: 'Joining fee',
  NOTICE: 'Notice charge',
  FINE: 'Fine',
  PENALTY: 'Penalty',
  OTHER: 'Other',
  DISCOUNT: 'Discount',
}

const CATEGORIES = {
  RECURRING: ['LAUNDRY', 'MAINTENANCE', 'ELECTRICITY', 'FOOD', 'OTHER'],
  ONE_TIME: ['JOINING', 'NOTICE', 'FINE', 'PENALTY', 'OTHER'],
  DISCOUNT: ['DISCOUNT'],
} as const

const KIND_LABEL = { RECURRING: 'Every month', ONE_TIME: 'One-time', DISCOUNT: 'Discount' } as const

/**
 * Charges on top of rent (laundry, electricity share, a fine…) and discounts.
 * They flow into the next invoices automatically. A charge is never edited —
 * void it with a reason and add the right one.
 */
export function ChargesCard({
  residentId,
  charges,
  canManage,
  checkedOut,
}: {
  residentId: string
  charges: ChargeItem[]
  canManage: boolean
  checkedOut: boolean
}) {
  const [adding, setAdding] = React.useState(false)
  const [voiding, setVoiding] = React.useState<ChargeItem | null>(null)
  const [showVoided, setShowVoided] = React.useState(false)
  const today = toISODate(new Date())

  const live = charges.filter((c) => !c.voidedAt)
  const voided = charges.filter((c) => c.voidedAt)
  const isEnded = (c: ChargeItem) => c.kind !== 'ONE_TIME' && c.endDate !== null && c.endDate.slice(0, 10) < today
  const list = showVoided ? charges : live

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between gap-2 text-sm">
          <span className="flex items-center gap-2">
            <Receipt className="size-4 text-slate-400" />
            Charges & discounts
          </span>
          {canManage && !checkedOut && (
            <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
              <Plus className="size-3.5" />
              Add
            </Button>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {list.length === 0 ? (
          <p className="py-2 text-sm text-slate-500">
            No extra charges. Add laundry, an electricity share, a joining fee or a discount — they
            appear on the next invoice automatically.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {list.map((c) => (
              <li key={c.id} className={cn('flex items-start justify-between gap-3 py-2.5', (c.voidedAt || isEnded(c)) && 'opacity-60')}>
                <div className="min-w-0">
                  <p className={cn('truncate text-sm font-medium text-slate-800', c.voidedAt && 'line-through')}>
                    {c.kind === 'DISCOUNT' && <BadgePercent className="mr-1 inline size-3.5 text-emerald-600" />}
                    {c.label}
                  </p>
                  <p className="text-xs text-slate-500">
                    {KIND_LABEL[c.kind]} · {CATEGORY_LABEL[c.category] ?? c.category} · from {formatDate(c.startDate)}
                    {c.endDate ? ` to ${formatDate(c.endDate)}` : ''}
                  </p>
                  <p className="text-[11px] text-slate-400">
                    {c.voidedAt
                      ? `Voided ${formatDate(c.voidedAt)}${c.voidReason ? ` — ${c.voidReason}` : ''}`
                      : c.kind === 'ONE_TIME'
                        ? c.billedInvoice
                          ? `Billed on ${c.billedInvoice}`
                          : 'On the next invoice'
                        : isEnded(c)
                          ? 'Ended'
                          : c.lastBilledFor
                            ? `Last billed ${new Date(c.lastBilledFor).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}`
                            : 'Starts with the next invoice'}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <span className={cn('text-sm font-semibold tabular', c.kind === 'DISCOUNT' ? 'text-emerald-600' : 'text-slate-800')}>
                    {c.kind === 'DISCOUNT' ? '− ' : ''}
                    {formatMoney(c.amount)}
                    {c.kind !== 'ONE_TIME' && <span className="text-[11px] font-normal text-slate-400">/mo</span>}
                  </span>
                  {canManage && !c.voidedAt && (
                    <button
                      type="button"
                      onClick={() => setVoiding(c)}
                      className="rounded-md p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                      aria-label={`Void ${c.label}`}
                      title="Void"
                    >
                      <Ban className="size-3.5" />
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        {voided.length > 0 && (
          <button
            type="button"
            className="mt-2 text-xs font-medium text-slate-500 hover:text-slate-800"
            onClick={() => setShowVoided((v) => !v)}
          >
            {showVoided ? 'Hide voided' : `Show ${voided.length} voided`}
          </button>
        )}
      </CardContent>

      {adding && <AddChargeDialog residentId={residentId} onClose={() => setAdding(false)} />}
      {voiding && <VoidChargeDialog charge={voiding} onClose={() => setVoiding(null)} />}
    </Card>
  )
}

function AddChargeDialog({ residentId, onClose }: { residentId: string; onClose: () => void }) {
  const router = useRouter()
  const toast = useToast()
  const [kind, setKind] = React.useState<ChargeItem['kind']>('RECURRING')
  const [category, setCategory] = React.useState<string>('LAUNDRY')
  const [label, setLabel] = React.useState('Laundry')
  const [labelTouched, setLabelTouched] = React.useState(false)
  const [amount, setAmount] = React.useState('')
  const [startDate, setStartDate] = React.useState(toISODate(new Date()))
  const [endDate, setEndDate] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  function pickKind(next: ChargeItem['kind']) {
    setKind(next)
    const first = CATEGORIES[next][0]
    setCategory(first)
    if (!labelTouched) setLabel(next === 'DISCOUNT' ? 'Discount' : CATEGORY_LABEL[first])
  }
  function pickCategory(next: string) {
    setCategory(next)
    if (!labelTouched) setLabel(CATEGORY_LABEL[next] ?? next)
  }

  const value = Math.round(Number(amount)) || 0

  async function submit() {
    setBusy(true)
    try {
      const result = await api.post<{ message: string }>('/api/charges', {
        action: 'ADD',
        residentId,
        kind,
        category,
        label,
        amount: value,
        startDate,
        endDate: kind === 'ONE_TIME' ? undefined : endDate || undefined,
      })
      toast.success(kind === 'DISCOUNT' ? 'Discount added' : 'Charge added', result.message)
      onClose()
      router.refresh()
    } catch (error) {
      toast.fromError(error, 'add the charge')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Add a charge or discount</DialogTitle>
          <DialogDescription>
            Monthly charges and discounts are pro-rated in a part month just like rent. One-time
            charges go on the next invoice once.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1">
            {(['RECURRING', 'ONE_TIME', 'DISCOUNT'] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => pickKind(k)}
                className={cn(
                  'rounded-lg px-2 py-1.5 text-xs font-medium transition-colors',
                  kind === k ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800',
                )}
              >
                {KIND_LABEL[k]}
              </button>
            ))}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {kind !== 'DISCOUNT' && (
              <Field label="Category" required>
                <Select value={category} onChange={(e) => pickCategory(e.target.value)}>
                  {CATEGORIES[kind].map((c) => (
                    <option key={c} value={c}>
                      {CATEGORY_LABEL[c]}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <Field label={kind === 'ONE_TIME' ? 'Amount' : 'Amount per month'} required>
              <Input type="number" inputMode="numeric" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} />
            </Field>
          </div>
          <Field label="Shown on the invoice as" required>
            <Input
              value={label}
              onChange={(e) => {
                setLabel(e.target.value)
                setLabelTouched(true)
              }}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={kind === 'ONE_TIME' ? 'Charge date' : 'Starts'} required>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </Field>
            {kind !== 'ONE_TIME' && (
              <Field label="Ends" hint="Leave empty to keep it going">
                <Input type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} />
              </Field>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} disabled={value <= 0 || label.trim().length < 2} onClick={submit}>
            Add {value > 0 ? formatMoney(value) : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function VoidChargeDialog({ charge, onClose }: { charge: ChargeItem; onClose: () => void }) {
  const router = useRouter()
  const toast = useToast()
  const [reason, setReason] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  async function submit() {
    setBusy(true)
    try {
      const result = await api.post<{ message: string }>('/api/charges', {
        action: 'VOID',
        chargeId: charge.id,
        reason,
      })
      toast.success('Charge voided', result.message)
      onClose()
      router.refresh()
    } catch (error) {
      toast.fromError(error, 'void the charge')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Void “{charge.label}”?</DialogTitle>
          <DialogDescription>
            {charge.kind === 'ONE_TIME' && charge.billedInvoice
              ? `It was billed on ${charge.billedInvoice}, so a credit note for ${formatMoney(charge.amount)} will be added to that invoice.`
              : charge.kind === 'ONE_TIME'
                ? 'It has not been billed yet, so it simply will not appear on the next invoice.'
                : 'It stops from the next invoice. Months already billed stay as they are.'}{' '}
            To change the amount, void it and add a new one.
          </DialogDescription>
        </DialogHeader>
        <Field label="Reason" required>
          <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
        </Field>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Keep it
          </Button>
          <Button variant="destructive" loading={busy} disabled={reason.trim().length < 3} onClick={submit}>
            Void charge
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
