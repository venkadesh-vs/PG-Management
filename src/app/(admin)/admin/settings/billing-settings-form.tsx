'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Wallet } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { api, ApiError } from '@/lib/client'
import type { PlatformPaymentDetails, ReminderSchedule } from '@/lib/owner-billing'

const toList = (v: string) =>
  v
    .split(/[,\s]+/)
    .map((x) => Number(x))
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 30)

/**
 * StayFlow's own payee details (shown on the owner paywall for UPI / bank
 * transfer) and when billing reminders go to PG owners.
 */
export function BillingSettingsForm({
  paymentDetails,
  schedule,
}: {
  paymentDetails: PlatformPaymentDetails
  schedule: ReminderSchedule
}) {
  const router = useRouter()
  const toast = useToast()
  const [d, setD] = React.useState(paymentDetails)
  const [trial, setTrial] = React.useState(schedule.trialDaysBefore.join(', '))
  const [due, setDue] = React.useState(schedule.dueDaysBefore.join(', '))
  const [grace, setGrace] = React.useState(schedule.graceDaysLeft.join(', '))
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const set = (key: keyof PlatformPaymentDetails) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setD((prev) => ({ ...prev, [key]: e.target.value }))

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await api.post<{ message: string }>('/api/admin/platform-billing', {
        paymentDetails: d,
        schedule: { trialDaysBefore: toList(trial), dueDaysBefore: toList(due), graceDaysLeft: toList(grace) },
      })
      toast.success(res.message)
      router.refresh()
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : 'Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Wallet className="size-4 text-slate-500" /> StayFlow billing
        </CardTitle>
        <p className="text-xs text-slate-500">
          Where PG owners can pay you by UPI or bank transfer (shown on their paywall), and when they get billing reminders.
          Grace days are set per plan in Plans.
        </p>
      </CardHeader>
      <CardContent>
        <form onSubmit={save} className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Your UPI ID" htmlFor="pb-upi" hint="e.g. stayflow@okhdfcbank">
              <Input id="pb-upi" value={d.upiId} onChange={set('upiId')} />
            </Field>
            <Field label="Payee name" htmlFor="pb-name" hint="Shown in the owner's UPI app">
              <Input id="pb-name" value={d.payeeName} onChange={set('payeeName')} />
            </Field>
            <Field label="Bank name" htmlFor="pb-bank">
              <Input id="pb-bank" value={d.bankName} onChange={set('bankName')} />
            </Field>
            <Field label="Account holder name" htmlFor="pb-acname">
              <Input id="pb-acname" value={d.accountName} onChange={set('accountName')} />
            </Field>
            <Field label="Account number" htmlFor="pb-acno">
              <Input id="pb-acno" inputMode="numeric" value={d.accountNumber} onChange={set('accountNumber')} />
            </Field>
            <Field label="IFSC" htmlFor="pb-ifsc">
              <Input id="pb-ifsc" value={d.ifsc} onChange={set('ifsc')} />
            </Field>
            <Field label="Support WhatsApp number" htmlFor="pb-wa" hint="Owners can tap “Contact support” on the paywall">
              <Input id="pb-wa" inputMode="tel" value={d.supportWhatsapp} onChange={set('supportWhatsapp')} />
            </Field>
            <Field label="Support email" htmlFor="pb-email">
              <Input id="pb-email" type="email" value={d.supportEmail} onChange={set('supportEmail')} />
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Trial ending: days before" htmlFor="pb-trial" hint="Comma separated, e.g. 3, 1">
              <Input id="pb-trial" value={trial} onChange={(e) => setTrial(e.target.value)} />
            </Field>
            <Field label="Invoice due: days before" htmlFor="pb-due" hint="1 = due tomorrow, 0 = due today">
              <Input id="pb-due" value={due} onChange={(e) => setDue(e.target.value)} />
            </Field>
            <Field label="Grace: days before pause" htmlFor="pb-grace" hint="e.g. 3, 1">
              <Input id="pb-grace" value={grace} onChange={(e) => setGrace(e.target.value)} />
            </Field>
          </div>

          {error && <p className="text-sm text-rose-600">{error}</p>}
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save billing settings'}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
