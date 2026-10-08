'use client'

import * as React from 'react'
import Link from 'next/link'
import { Zap } from 'lucide-react'
import { api, ApiError } from '@/lib/client'
import { cn } from '@/lib/utils'
import { useToast } from '@/components/ui/toast'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/primitives'

type Settings = { splitMethod: string; billingMode: string; excludeLeaveDays: boolean }

const SPLIT = [
  {
    value: 'DAYS_STAYED',
    label: 'By days stayed',
    text: 'Only the people who stayed in the room share the bill, in proportion to their days there. Someone who moved in halfway pays about half a share.',
  },
  {
    value: 'EQUAL_PRESENT',
    label: 'Equally, on reading day',
    text: 'The people living in the room on the reading date share the bill equally.',
  },
]
const MODE = [
  { value: 'NEXT_RENT_INVOICE', label: 'On the next rent invoice', text: "Each share is added as a line on the resident's next rent invoice, so they pay once." },
  { value: 'SEPARATE_INVOICE', label: 'As a separate bill', text: 'Each resident gets an electricity bill as soon as you finalize.' },
]

/**
 * How room electricity bills are shared and billed. Saves on its own
 * (separate from the rent settings form). Hidden when the Electricity
 * feature is off or the person cannot view it.
 */
export function ElectricitySettingsCard({ canEdit }: { canEdit: boolean }) {
  const toast = useToast()
  const [settings, setSettings] = React.useState<Settings | null>(null)
  const [hidden, setHidden] = React.useState(false)
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    api
      .get<{ settings: Settings }>('/api/electricity/settings')
      .then((r) => !cancelled && setSettings(r.settings))
      .catch(() => !cancelled && setHidden(true))
    return () => {
      cancelled = true
    }
  }, [])

  async function save(patch: Record<string, string | boolean>) {
    setSaving(true)
    try {
      const r = await api.patch<{ settings: Settings }>('/api/electricity/settings', patch)
      setSettings(r.settings)
      toast.success('Electricity settings saved', 'They apply to bills made from now on. Finalized bills keep how they were split.')
    } catch (error) {
      toast.error('Could not save', error instanceof ApiError ? error.message : 'Please try again.')
    } finally {
      setSaving(false)
    }
  }

  if (hidden) return null

  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Zap className="size-4 text-slate-400" />
          Electricity meters
        </CardTitle>
        <p className="text-xs text-slate-500">
          How each room&apos;s meter bill is shared. Rates and meters are set on the{' '}
          <Link href="/app/electricity/rates" className="font-medium text-blue-700 hover:underline">
            Electricity
          </Link>{' '}
          page.
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        {!settings ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : (
          <>
            <Choice
              legend="Split the room's bill"
              name="split"
              options={SPLIT}
              value={settings.splitMethod}
              disabled={!canEdit || saving}
              onChange={(v) => void save({ electricitySplitMethod: v })}
            />
            <Choice
              legend="Charge residents"
              name="mode"
              options={MODE}
              value={settings.billingMode}
              disabled={!canEdit || saving}
              onChange={(v) => void save({ electricityBillingMode: v })}
            />
            <label className="flex items-start justify-between gap-4 rounded-lg border border-slate-200 p-3">
              <span>
                <span className="block text-sm font-medium text-slate-900">Leave out approved leave days</span>
                <span className="block text-xs text-slate-500">A resident away on approved leave is not charged for those days.</span>
              </span>
              <Switch
                checked={settings.excludeLeaveDays}
                disabled={!canEdit || saving}
                onCheckedChange={(c) => void save({ electricityExcludeLeaveDays: c })}
                aria-label="Leave out approved leave days"
              />
            </label>
          </>
        )}
      </CardContent>
    </Card>
  )
}

function Choice({
  legend,
  name,
  options,
  value,
  disabled,
  onChange,
}: {
  legend: string
  name: string
  options: { value: string; label: string; text: string }[]
  value: string
  disabled: boolean
  onChange: (value: string) => void
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium text-slate-900">{legend}</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((o) => (
          <label
            key={o.value}
            className={cn(
              'flex cursor-pointer gap-3 rounded-lg border p-3 transition',
              value === o.value ? 'border-blue-300 bg-blue-50/60' : 'border-slate-200 hover:border-slate-300',
              disabled && 'cursor-not-allowed opacity-70',
            )}
          >
            <input type="radio" name={name} className="mt-1 accent-blue-600" checked={value === o.value} disabled={disabled} onChange={() => onChange(o.value)} />
            <span>
              <span className="block text-sm font-medium text-slate-900">{o.label}</span>
              <span className="block text-xs text-slate-500">{o.text}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}
