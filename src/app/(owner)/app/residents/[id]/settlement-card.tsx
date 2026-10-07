'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { FileText, Lock, LockOpen } from 'lucide-react'
import { api, ApiError } from '@/lib/client'
import { blankChecklist, type Checklist } from '@/lib/checkout-checklist'
import { cn, formatDate, formatMoney } from '@/lib/utils'
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
import { ChecklistBlock } from './resident-actions'

type Settlement = {
  exitDate: string
  outstandingRent: number
  proRataRent: number
  foodCharges: number
  utilityCharges: number
  otherCharges: number
  damageDeduction: number
  depositHeld: number
  refundAmount: number
  payableAmount: number
  settledAt: string | null
  settlementNote: string | null
  lockedAt: string | null
  inspection: Checklist | null
  clearance: Checklist | null
}

/**
 * The final settlement after checkout: figures, the inspection and clearance
 * checklists (editable until the settlement is closed), the settlement PDF and
 * "Close settlement", after which corrections go through credit/debit notes.
 */
export function SettlementCard({
  residentId,
  settlement,
  canManage,
}: {
  residentId: string
  settlement: Settlement
  canManage: boolean
}) {
  const router = useRouter()
  const toast = useToast()
  const [editing, setEditing] = React.useState(false)
  const [confirmLock, setConfirmLock] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [inspection, setInspection] = React.useState<Checklist>(
    settlement.inspection ?? blankChecklist('inspection'),
  )
  const [clearance, setClearance] = React.useState<Checklist>(settlement.clearance ?? blankChecklist('clearance'))
  const locked = Boolean(settlement.lockedAt)
  const s = settlement

  const progress = (list: Checklist | null) =>
    list ? `${list.items.filter((i) => i.ok).length}/${list.items.length}` : 'Not recorded'
  const clearanceOpen = (s.clearance?.items ?? blankChecklist('clearance').items).filter((i) => !i.ok)

  async function post(body: Record<string, unknown>, success: string) {
    setBusy(true)
    try {
      const result = await api.post<{ message: string }>('/api/residents/actions', { residentId, ...body })
      toast.success(success, result.message)
      setEditing(false)
      setConfirmLock(false)
      router.refresh()
    } catch (error) {
      toast.error('Could not save', error instanceof ApiError ? error.message : 'Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="border-slate-300 bg-slate-50">
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0 pb-3">
        <CardTitle className="text-sm">Final settlement</CardTitle>
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium',
            locked ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700',
          )}
        >
          {locked ? <Lock className="size-3" /> : <LockOpen className="size-3" />}
          {locked ? `Closed ${formatDate(s.lockedAt)}` : 'Open'}
        </span>
      </CardHeader>
      <CardContent className="space-y-2">
        <Row label="Exit date" value={formatDate(s.exitDate)} />
        <Row label="Rent dues at exit" value={formatMoney(s.outstandingRent)} />
        <Row
          label={s.proRataRent < 0 ? 'Unused days credit' : 'Exit month charges'}
          value={s.proRataRent < 0 ? `− ${formatMoney(-s.proRataRent)}` : formatMoney(s.proRataRent + s.foodCharges)}
        />
        {s.utilityCharges > 0 && <Row label="Utilities" value={formatMoney(s.utilityCharges)} />}
        {s.otherCharges > 0 && <Row label="Other charges" value={formatMoney(s.otherCharges)} />}
        <Row label="Deductions" value={formatMoney(s.damageDeduction)} />
        <Row label="Deposit held" value={formatMoney(s.depositHeld)} />
        {s.refundAmount > 0 ? (
          <Row label={s.settledAt ? 'Refunded' : 'Refund pending'} value={formatMoney(s.refundAmount)} />
        ) : (
          <Row label="Still payable" value={formatMoney(s.payableAmount)} />
        )}
        <div className="border-t border-slate-200 pt-2">
          <Row label="Room inspection" value={progress(s.inspection)} />
          <Row label="Clearance" value={progress(s.clearance)} />
        </div>
        {s.settlementNote && <p className="pt-1 text-xs text-slate-500">{s.settlementNote}</p>}

        <div className="flex flex-wrap gap-2 pt-2">
          <Button variant="outline" size="sm" asChild>
            <a href={`/api/documents/checkout-settlement/${residentId}.pdf`} target="_blank" rel="noopener">
              <FileText className="size-3.5" />
              Settlement PDF
            </a>
          </Button>
          {canManage && !locked && (
            <>
              <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                Checklists
              </Button>
              <Button variant="default" size="sm" onClick={() => setConfirmLock(true)}>
                <Lock className="size-3.5" />
                Close settlement
              </Button>
            </>
          )}
        </div>
        {locked && (
          <p className="text-xs text-slate-500">
            Closed settlements cannot be edited. To correct an amount, raise a credit or debit note on the
            settlement invoice (Rent &amp; invoices tab).
          </p>
        )}
      </CardContent>

      <Dialog open={editing} onOpenChange={(o) => !o && !busy && setEditing(false)}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Checkout checklists</DialogTitle>
            <DialogDescription>Tick what has been checked and returned. Saved with the settlement.</DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] space-y-5 overflow-y-auto pr-1">
            <ChecklistBlock title="Room inspection" list={inspection} onChange={setInspection} withNotes />
            <ChecklistBlock title="Clearance" list={clearance} onChange={setClearance} />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditing(false)} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={busy}
              onClick={() => post({ action: 'CHECKOUT_CHECKLIST', inspection, clearance }, 'Checklists saved')}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmLock} onOpenChange={(o) => !o && !busy && setConfirmLock(false)}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Close this settlement?</DialogTitle>
            <DialogDescription>
              The figures, checklists and deductions are locked. Later corrections are made as a credit or
              debit note, so the original stays on record.
            </DialogDescription>
          </DialogHeader>
          {clearanceOpen.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
              <p className="font-medium">Clearance still open:</p>
              <ul className="mt-1 list-disc pl-5 text-xs">
                {clearanceOpen.map((i) => (
                  <li key={i.key}>{i.label}</li>
                ))}
              </ul>
            </div>
          )}
          {s.refundAmount > 0 && !s.settledAt && (
            <p className="text-xs text-slate-500">
              The refund of {formatMoney(s.refundAmount)} is still pending; you can mark it paid from the deposit
              card after closing.
            </p>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmLock(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="default" loading={busy} onClick={() => post({ action: 'CHECKOUT_LOCK' }, 'Settlement closed')}>
              <Lock className="size-4" />
              Close settlement
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="min-w-0 text-slate-500">{label}</span>
      <span className="shrink-0 font-medium text-slate-800 tabular">{value}</span>
    </div>
  )
}
