'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { CircleCheck, Hammer, Phone } from 'lucide-react'
import { api, ApiError } from '@/lib/client'
import { cn, formatDate, formatMoney, formatPhone, toISODate } from '@/lib/utils'
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
import { Field, Input, Select } from '@/components/ui/input'

type Task = {
  id: string
  status: string
  vendorName: string | null
  vendorPhone: string | null
  estimateAmount: number | null
  estimateApprovedAt: string | null
  estimateApprovedBy: string | null
  actualCost: number | null
  expenseId: string | null
}

type Mode = 'vendor' | 'estimate' | 'reject' | 'cost' | null

/**
 * Repair money on a complaint: vendor → estimate → approval → actual cost,
 * which is booked as an expense once.
 */
export function RepairCard({
  complaintId,
  task,
  categories,
  can,
}: {
  complaintId: string
  task: Task | null
  categories: { id: string; name: string }[]
  can: { manage: boolean; approve: boolean; recordCost: boolean; expenses: boolean }
}) {
  const router = useRouter()
  const toast = useToast()
  const [mode, setMode] = React.useState<Mode>(null)
  const [busy, setBusy] = React.useState(false)
  const [vendorName, setVendorName] = React.useState(task?.vendorName ?? '')
  const [vendorPhone, setVendorPhone] = React.useState(task?.vendorPhone ?? '')
  const [amount, setAmount] = React.useState('')
  const [reason, setReason] = React.useState('')
  const defaultCategory = (categories.find((c) => /repair|maint/i.test(c.name)) ?? categories[0])?.id ?? ''
  const [categoryId, setCategoryId] = React.useState(defaultCategory)
  const [paymentMode, setPaymentMode] = React.useState('UPI')
  const [billNumber, setBillNumber] = React.useState('')
  const [spentOn, setSpentOn] = React.useState(toISODate(new Date()))

  function open(next: Mode) {
    setAmount(
      next === 'estimate' ? String(task?.estimateAmount ?? '') : next === 'cost' ? String(task?.estimateAmount ?? '') : '',
    )
    setReason('')
    setMode(next)
  }

  async function send(url: string, body: Record<string, unknown>, title: string) {
    setBusy(true)
    try {
      const result = await api.post<{ message: string }>(url, body)
      toast.success(title, result.message)
      setMode(null)
      router.refresh()
    } catch (error) {
      toast.error('Could not save', error instanceof ApiError ? error.message : 'Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const act = (body: Record<string, unknown>, title: string) => send(`/api/maintenance/${task!.id}`, body, title)

  if (!task) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Hammer className="size-4 text-slate-400" />
            Repair & cost
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-slate-500">
            Needs an outside vendor or parts? Track the quote, approve it and record what it cost.
          </p>
          {can.manage && (
            <Button
              variant="outline"
              size="sm"
              loading={busy}
              onClick={() => send('/api/maintenance', { action: 'FROM_COMPLAINT', complaintId }, 'Repair tracking started')}
            >
              Track repair cost
            </Button>
          )}
        </CardContent>
      </Card>
    )
  }

  const recorded = task.actualCost != null
  const approved = Boolean(task.estimateApprovedAt)
  const locked = recorded || task.status === 'CANCELLED'

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Hammer className="size-4 text-slate-400" />
          Repair & cost
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <Step label="Vendor">
          {task.vendorName ? (
            <div className="min-w-0 text-right">
              <p className="truncate font-medium text-slate-800">{task.vendorName}</p>
              {task.vendorPhone && (
                <a href={`tel:${task.vendorPhone}`} className="inline-flex items-center gap-1 text-xs text-blue-700">
                  <Phone className="size-3" />
                  {formatPhone(task.vendorPhone)}
                </a>
              )}
            </div>
          ) : (
            <span className="text-slate-400">Not set</span>
          )}
        </Step>

        <Step label="Estimate">
          {task.estimateAmount != null ? (
            <div className="text-right">
              <p className="font-medium text-slate-800 tabular">{formatMoney(task.estimateAmount)}</p>
              <p className={cn('text-xs', approved ? 'text-emerald-600' : 'text-amber-600')}>
                {approved
                  ? `Approved${task.estimateApprovedBy ? ` by ${task.estimateApprovedBy}` : ''} · ${formatDate(task.estimateApprovedAt)}`
                  : 'Waiting for approval'}
              </p>
            </div>
          ) : (
            <span className="text-slate-400">No quote yet</span>
          )}
        </Step>

        <Step label="Actual cost">
          {recorded ? (
            <div className="text-right">
              <p className="font-medium text-slate-800 tabular">{formatMoney(task.actualCost!)}</p>
              {task.expenseId ? (
                <Link href="/app/expenses" className="inline-flex items-center gap-1 text-xs text-emerald-700">
                  <CircleCheck className="size-3" />
                  Booked as an expense
                </Link>
              ) : (
                <p className="text-xs text-slate-500">Recorded</p>
              )}
            </div>
          ) : (
            <span className="text-slate-400">Not recorded</span>
          )}
        </Step>

        {!locked && (
          <div className="flex flex-wrap gap-2 pt-1">
            {can.manage && (
              <Button variant="outline" size="sm" onClick={() => open('vendor')}>
                {task.vendorName ? 'Change vendor' : 'Add vendor'}
              </Button>
            )}
            {can.manage && (
              <Button variant="outline" size="sm" onClick={() => open('estimate')}>
                {task.estimateAmount != null ? 'New estimate' : 'Add estimate'}
              </Button>
            )}
            {can.approve && task.estimateAmount != null && !approved && (
              <>
                <Button
                  variant="primary"
                  size="sm"
                  loading={busy}
                  onClick={() => act({ action: 'APPROVE_ESTIMATE' }, 'Estimate approved')}
                >
                  Approve
                </Button>
                <Button variant="ghost" size="sm" onClick={() => open('reject')}>
                  Reject
                </Button>
              </>
            )}
            {can.recordCost && (task.estimateAmount == null || approved) && (
              <Button variant="default" size="sm" onClick={() => open('cost')}>
                Record actual cost
              </Button>
            )}
          </div>
        )}
        {!locked && task.estimateAmount != null && !approved && !can.approve && (
          <p className="text-xs text-slate-500">The owner approves the estimate before the cost is recorded.</p>
        )}
      </CardContent>

      <Dialog open={mode !== null} onOpenChange={(o) => !o && !busy && setMode(null)}>
        <DialogContent size="sm">
          {mode === 'vendor' && (
            <>
              <DialogHeader>
                <DialogTitle>Vendor</DialogTitle>
                <DialogDescription>Who is doing the repair — the plumber, electrician or shop.</DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Name" className="min-w-0">
                  <Input value={vendorName} maxLength={120} onChange={(e) => setVendorName(e.target.value)} />
                </Field>
                <Field label="Mobile" className="min-w-0">
                  <Input inputMode="tel" value={vendorPhone} onChange={(e) => setVendorPhone(e.target.value)} />
                </Field>
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setMode(null)} disabled={busy}>
                  Cancel
                </Button>
                <Button variant="primary" loading={busy} onClick={() => act({ action: 'VENDOR', vendorName, vendorPhone }, 'Vendor saved')}>
                  Save
                </Button>
              </DialogFooter>
            </>
          )}
          {mode === 'estimate' && (
            <>
              <DialogHeader>
                <DialogTitle>Estimate</DialogTitle>
                <DialogDescription>The quote for the work. A new estimate needs approval again.</DialogDescription>
              </DialogHeader>
              <Field label="Amount (₹)" required>
                <Input type="number" inputMode="numeric" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} />
              </Field>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setMode(null)} disabled={busy}>
                  Cancel
                </Button>
                <Button variant="primary" loading={busy} onClick={() => act({ action: 'ESTIMATE', amount }, 'Estimate saved')}>
                  Save estimate
                </Button>
              </DialogFooter>
            </>
          )}
          {mode === 'reject' && (
            <>
              <DialogHeader>
                <DialogTitle>Reject the estimate</DialogTitle>
                <DialogDescription>The quote is cleared so a new one can be added.</DialogDescription>
              </DialogHeader>
              <Field label="Reason" required>
                <Input value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="Too high — get another quote" />
              </Field>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setMode(null)} disabled={busy}>
                  Cancel
                </Button>
                <Button variant="destructive" loading={busy} onClick={() => act({ action: 'REJECT_ESTIMATE', reason }, 'Estimate rejected')}>
                  Reject
                </Button>
              </DialogFooter>
            </>
          )}
          {mode === 'cost' && (
            <>
              <DialogHeader>
                <DialogTitle>Record the actual cost</DialogTitle>
                <DialogDescription>
                  {can.expenses
                    ? 'This is booked as an expense for the PG, once.'
                    : 'The Expenses module is off, so only the cost is recorded on the repair.'}
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Amount (₹)" required className="min-w-0">
                  <Input type="number" inputMode="numeric" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} />
                </Field>
                <Field label="Paid on" required className="min-w-0">
                  <Input type="date" value={spentOn} onChange={(e) => setSpentOn(e.target.value)} />
                </Field>
                {can.expenses && (
                  <>
                    <Field label="Category" className="min-w-0">
                      <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                        {categories.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Paid by" className="min-w-0">
                      <Select value={paymentMode} onChange={(e) => setPaymentMode(e.target.value)}>
                        <option value="UPI">UPI</option>
                        <option value="CASH">Cash</option>
                        <option value="BANK_TRANSFER">Bank transfer</option>
                        <option value="CARD">Card</option>
                        <option value="CHEQUE">Cheque</option>
                      </Select>
                    </Field>
                    <Field label="Bill no." className="min-w-0 sm:col-span-2">
                      <Input value={billNumber} maxLength={60} onChange={(e) => setBillNumber(e.target.value)} />
                    </Field>
                  </>
                )}
              </div>
              {task.estimateAmount != null && Number(amount) > task.estimateAmount && (
                <p className="text-xs text-amber-700">
                  {formatMoney(Number(amount) - task.estimateAmount)} over the approved estimate — the expense will
                  need the owner&apos;s approval if it is large.
                </p>
              )}
              <DialogFooter>
                <Button variant="ghost" onClick={() => setMode(null)} disabled={busy}>
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  loading={busy}
                  onClick={() =>
                    act(
                      { action: 'RECORD_COST', amount, spentOn, paymentMode, billNumber, ...(categoryId ? { categoryId } : {}) },
                      'Cost recorded',
                    )
                  }
                >
                  Record cost
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  )
}

function Step({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="shrink-0 text-slate-500">{label}</span>
      {children}
    </div>
  )
}
