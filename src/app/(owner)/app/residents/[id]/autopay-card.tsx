'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Repeat } from 'lucide-react'
import { api } from '@/lib/client'
import { formatDate, formatMoney } from '@/lib/utils'
import { ordinal } from '@/lib/autopay'
import { useToast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input, Select } from '@/components/ui/input'

type Props = {
  residentId: string
  canManage: boolean
  checkedOut: boolean
  offered: boolean
  day: number
  window: { min: number; max: number }
  dayOutsideWindow: boolean
  mandate: { id: string; status: string; methodLabel: string; maxAmount: number; lastError: string | null } | null
  upcoming: { amount: number; chargeDate: string; invoice: string } | null
}

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: 'On',
  PENDING: 'Waiting for the bank',
  PAUSED: 'Paused',
  FAILED: 'Failed',
}

/** Resident page → Rent tab: AutoPay status, the debit / rent due day, and cancel. */
export function ResidentAutopayCard(props: Props) {
  const router = useRouter()
  const toast = useToast()
  const [day, setDay] = React.useState(Math.min(props.window.max, Math.max(props.window.min, props.day)))
  const [busy, setBusy] = React.useState<null | 'day' | 'cancel'>(null)
  const [reason, setReason] = React.useState('')
  const [cancelling, setCancelling] = React.useState(false)
  const live = props.mandate && ['ACTIVE', 'PENDING', 'PAUSED'].includes(props.mandate.status)
  const days = Array.from({ length: props.window.max - props.window.min + 1 }, (_, i) => props.window.min + i)

  async function saveDay() {
    setBusy('day')
    try {
      const res = await api.post<{ message: string }>('/api/autopay', { action: 'SET_DAY', residentId: props.residentId, day })
      toast.success('Rent date saved', res.message)
      router.refresh()
    } catch (error) {
      toast.error('Could not change the date', error instanceof Error ? error.message : undefined)
    } finally {
      setBusy(null)
    }
  }

  async function cancel() {
    if (!props.mandate) return
    setBusy('cancel')
    try {
      const res = await api.post<{ message: string }>('/api/autopay', { action: 'CANCEL', mandateId: props.mandate.id, reason })
      toast.success('AutoPay cancelled', res.message)
      setCancelling(false)
      router.refresh()
    } catch (error) {
      toast.error('Could not cancel AutoPay', error instanceof Error ? error.message : undefined)
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Repeat className="size-4 text-slate-400" />
          AutoPay and rent date
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {live && props.mandate ? (
          <div className="space-y-1">
            <p className="text-slate-900">
              <span className="font-medium">{STATUS_LABEL[props.mandate.status] ?? props.mandate.status}</span> · {props.mandate.methodLabel} · up to{' '}
              {formatMoney(props.mandate.maxAmount)}
            </p>
            {props.upcoming && (
              <p className="text-xs text-slate-500">
                Next debit {formatMoney(props.upcoming.amount)} for {props.upcoming.invoice} on {formatDate(props.upcoming.chargeDate)}
              </p>
            )}
            {props.mandate.lastError && <p className="text-xs text-rose-600">{props.mandate.lastError}</p>}
          </div>
        ) : (
          <p className="text-xs text-slate-500">
            {props.offered ? 'Not on AutoPay. The resident can set it up from their Rent page.' : 'AutoPay is not offered. Turn it on in Settings → Rent & billing.'}
          </p>
        )}

        <div>
          <p className="text-xs text-slate-500">
            Rent due {live ? 'and debited ' : ''}on the <span className="font-medium text-slate-900">{ordinal(props.day)}</span> of every month
            {props.dayOutsideWindow ? ` — outside the allowed ${props.window.min}–${props.window.max}, pick a new day` : ''}.
          </p>
          {props.canManage && !props.checkedOut && (
            <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
              <Select id="resident-autopay-day" aria-label="Rent due day" value={String(day)} onChange={(e) => setDay(Number(e.target.value))} className="w-full sm:w-44">
                {days.map((d) => (
                  <option key={d} value={d}>
                    {ordinal(d)} of every month
                  </option>
                ))}
              </Select>
              <Button size="sm" variant="outline" onClick={saveDay} disabled={busy !== null || day === props.day}>
                {busy === 'day' && <Loader2 className="size-4 animate-spin" />}Save date
              </Button>
            </div>
          )}
          <p className="mt-1 text-[11px] text-slate-500">A new date applies from the next invoice. Invoices already raised keep their due date.</p>
        </div>

        {live && props.canManage && (
          cancelling ? (
            <div className="space-y-2 rounded-lg border border-slate-200 p-3">
              <Input id="resident-autopay-reason" placeholder="Why cancel? (e.g. resident asked)" value={reason} onChange={(e) => setReason(e.target.value)} />
              <div className="flex gap-2">
                <Button size="sm" variant="destructive" onClick={cancel} disabled={busy !== null || reason.trim().length < 3}>
                  {busy === 'cancel' && <Loader2 className="size-4 animate-spin" />}Cancel AutoPay
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setCancelling(false)}>
                  Keep it
                </Button>
              </div>
            </div>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setCancelling(true)}>
              Cancel AutoPay
            </Button>
          )
        )}
      </CardContent>
    </Card>
  )
}
