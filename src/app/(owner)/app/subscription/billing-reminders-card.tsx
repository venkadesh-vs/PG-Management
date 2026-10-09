'use client'

import * as React from 'react'
import { BellRing } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useToast } from '@/components/ui/toast'
import { api, ApiError } from '@/lib/client'

type Channel = 'WHATSAPP' | 'EMAIL'

/** Where StayFlow sends this account's billing reminders (in-app is always on). */
export function BillingRemindersCard({ initial }: { initial: Channel[] }) {
  const toast = useToast()
  const [channels, setChannels] = React.useState<Channel[]>(initial)
  const [busy, setBusy] = React.useState(false)

  async function toggle(channel: Channel, on: boolean) {
    const next = on ? [...channels, channel] : channels.filter((c) => c !== channel)
    setBusy(true)
    try {
      const res = await api.patch<{ channels: Channel[]; message: string }>('/api/subscription/reminders', { channels: next })
      setChannels(res.channels)
      toast.success(res.message)
    } catch (error) {
      toast.error('Not saved', error instanceof ApiError || error instanceof Error ? error.message : 'Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const rows: { key: Channel; label: string; hint: string }[] = [
    { key: 'WHATSAPP', label: 'WhatsApp', hint: 'To your PG’s contact number, from the StayFlow number' },
    { key: 'EMAIL', label: 'Email', hint: 'To your account email' },
  ]

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <BellRing className="size-4 text-slate-500" /> Billing reminders
        </CardTitle>
        <p className="text-xs text-slate-500">
          Trial ending, invoice due, payment pending and receipts. They always appear in the app; choose where else to get them.
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.map((row) => (
          <label key={row.key} className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-3">
            <input
              type="checkbox"
              className="mt-0.5 size-4 accent-blue-600"
              checked={channels.includes(row.key)}
              disabled={busy}
              onChange={(e) => toggle(row.key, e.target.checked)}
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-slate-900">{row.label}</span>
              <span className="block text-xs text-slate-500">{row.hint}</span>
            </span>
          </label>
        ))}
      </CardContent>
    </Card>
  )
}
