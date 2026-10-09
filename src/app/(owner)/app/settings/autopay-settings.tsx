'use client'

import * as React from 'react'
import { Repeat } from 'lucide-react'
import { api } from '@/lib/client'
import { dayWindowProblem, LATEST_DEBIT_DAY, ordinal } from '@/lib/autopay'
import { useToast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/primitives'

export type AutopaySettingsValues = {
  residentAutopayEnabled: boolean
  autopayMaxPercent: number
  autopayMaxAmountCap: number | null
  autopayRetryDays: number
  rentDueDayMin: number
  rentDueDayMax: number
}

/** Settings → Rent & billing: whether residents can turn on rent AutoPay, and its rules. */
export function AutopaySettingsCard({ initial, canEdit }: { initial: AutopaySettingsValues; canEdit: boolean }) {
  const toast = useToast()
  const [v, setV] = React.useState(initial)
  const [cap, setCap] = React.useState(initial.autopayMaxAmountCap ? String(initial.autopayMaxAmountCap) : '')
  const [saving, setSaving] = React.useState(false)
  const windowError = dayWindowProblem(v.rentDueDayMin, v.rentDueDayMax)

  async function save() {
    if (windowError) return
    setSaving(true)
    try {
      const res = await api.patch<{ message: string }>('/api/settings', {
        ...v,
        autopayMaxAmountCap: cap.trim() ? Number(cap) : null,
      })
      toast.success('Saved', res.message)
    } catch (error) {
      toast.error('Could not save AutoPay settings', error instanceof Error ? error.message : undefined)
    } finally {
      setSaving(false)
    }
  }

  const num = (key: keyof AutopaySettingsValues) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setV((p) => ({ ...p, [key]: Math.round(Number(e.target.value)) }))

  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Repeat className="size-4 text-slate-400" />
          AutoPay for residents
        </CardTitle>
        <p className="text-xs text-slate-500">
          Residents approve a UPI AutoPay, bank eMandate or card once, and each month the exact invoice amount is debited on the day they pick,
          straight into your Razorpay account. They get a reminder the day before. Needs Razorpay connected under Online payments.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <label className="flex items-center justify-between gap-4 rounded-lg border border-slate-200 p-3">
          <span>
            <span className="block text-sm font-medium text-slate-900">Offer AutoPay to residents</span>
            <span className="block text-xs text-slate-500">They see a &quot;Set up AutoPay&quot; card on their Rent page.</span>
          </span>
          <Switch
            checked={v.residentAutopayEnabled}
            onCheckedChange={(checked) => setV((p) => ({ ...p, residentAutopayEnabled: checked }))}
            disabled={!canEdit}
            aria-label="Offer AutoPay to residents"
          />
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field htmlFor="autopay-day-min" label="Rent due day window: from day" hint={`1 to ${LATEST_DEBIT_DAY}`}>
            <Input id="autopay-day-min" type="number" min={1} max={LATEST_DEBIT_DAY} value={v.rentDueDayMin} onChange={num('rentDueDayMin')} disabled={!canEdit} />
          </Field>
          <Field htmlFor="autopay-day-max" label="Up to day" hint="Applies to every resident, with or without AutoPay" error={windowError ?? undefined}>
            <Input id="autopay-day-max" type="number" min={1} max={LATEST_DEBIT_DAY} value={v.rentDueDayMax} onChange={num('rentDueDayMax')} disabled={!canEdit} />
          </Field>
          <Field htmlFor="autopay-percent" label="Limit residents approve (% of their monthly bill)" hint="150% leaves room for electricity and other charges">
            <Input id="autopay-percent" type="number" min={100} max={300} value={v.autopayMaxPercent} onChange={num('autopayMaxPercent')} disabled={!canEdit} />
          </Field>
          <Field htmlFor="autopay-cap" label="Highest limit for anyone (₹, optional)" hint="Leave empty for no ceiling">
            <Input id="autopay-cap" type="number" min={500} value={cap} onChange={(e) => setCap(e.target.value)} disabled={!canEdit} placeholder="No ceiling" />
          </Field>
          <Field htmlFor="autopay-retries" label="Retry a failed debit for (days)" hint="After that, you and the resident are told">
            <Input id="autopay-retries" type="number" min={0} max={5} value={v.autopayRetryDays} onChange={num('autopayRetryDays')} disabled={!canEdit} />
          </Field>
        </div>
        {!windowError && (
          <p className="text-xs text-slate-500">
            This window applies to every resident: at check-in you pick their regular rent due day from the {ordinal(v.rentDueDayMin)} to
            the {ordinal(v.rentDueDayMax)}, and residents on AutoPay choose their debit day in the same range. Narrowing it later never moves
            anyone&apos;s date by itself; you are shown who needs a new one.
          </p>
        )}
        {canEdit && (
          <Button onClick={save} disabled={saving || Boolean(windowError)}>
            Save AutoPay settings
          </Button>
        )}
      </CardContent>
    </Card>
  )
}
