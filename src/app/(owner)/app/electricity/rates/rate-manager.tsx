'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Lock, Plus } from 'lucide-react'
import { api, ApiError } from '@/lib/client'
import { formatDate } from '@/lib/utils'
import { billingMonthLabel, monthKeyOf } from '@/lib/electricity'
import { useToast } from '@/components/ui/toast'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/feedback'
import { Field, Input, Select } from '@/components/ui/input'

type Rate = {
  id: string
  propertyId: string
  propertyName: string
  month: string
  ratePerUnit: number
  note: string | null
  createdByName: string | null
  createdAt: string
  current: boolean
}

const money = (n: number) => `₹${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: n % 1 ? 2 : 0 }).format(n)}`

export function RateManager({
  rates,
  properties,
  canManage,
}: {
  rates: Rate[]
  properties: { id: string; name: string }[]
  canManage: boolean
}) {
  const router = useRouter()
  const toast = useToast()
  const [propertyId, setPropertyId] = React.useState(properties[0]?.id ?? '')
  const [month, setMonth] = React.useState(() => monthKeyOf(new Date()))
  const [rate, setRate] = React.useState('')
  const [note, setNote] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      await api.post('/api/electricity/rates', { propertyId, effectiveFrom: month, ratePerUnit: rate, note })
      toast.success('Rate saved', `${money(Number(rate))} per unit from ${billingMonthLabel(month)}.`)
      setRate('')
      setNote('')
      router.refresh()
    } catch (error) {
      toast.error('Could not save the rate', error instanceof ApiError ? error.message : 'Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        {properties.map((p) => {
          const list = rates.filter((r) => r.propertyId === p.id)
          return (
            <Card key={p.id} className="min-w-0">
              <CardHeader>
                <CardTitle className="text-sm">{p.name}</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                {list.length ? (
                  <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                    {list.map((r) => (
                      <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-900">
                            From {billingMonthLabel(r.month)}
                            {r.current && (
                              <Badge variant="blue" size="sm" className="ml-2">
                                In use now
                              </Badge>
                            )}
                          </p>
                          <p className="text-xs text-slate-500">
                            Added {formatDate(r.createdAt)}
                            {r.createdByName ? ` by ${r.createdByName}` : ''}
                            {r.note ? ` · ${r.note}` : ''}
                          </p>
                        </div>
                        <span className="text-base font-semibold tabular-nums text-slate-900">{money(r.ratePerUnit)} / unit</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <EmptyState compact icon="zap" title="No rate yet" description="Bills can't be made for this PG until it has a rate." />
                )}
              </CardContent>
            </Card>
          )
        })}
      </div>

      <div className="space-y-4">
        {canManage && properties.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Set a new rate</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={submit} className="space-y-4">
                {properties.length > 1 && (
                  <Field label="PG" htmlFor="rate-pg">
                    <Select id="rate-pg" value={propertyId} onChange={(e) => setPropertyId(e.target.value)}>
                      {properties.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                )}
                <Field label="Applies from" required htmlFor="rate-month" hint="This month and every month after, until you set another rate.">
                  <Input id="rate-month" type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
                </Field>
                <Field label="Price per unit (₹)" required htmlFor="rate-value">
                  <Input id="rate-value" inputMode="decimal" placeholder="e.g. 13.50" value={rate} onChange={(e) => setRate(e.target.value.replace(/[^\d.]/g, ''))} className="tabular-nums" />
                </Field>
                <Field label="Note" htmlFor="rate-note">
                  <Input id="rate-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional, e.g. EB tariff revision" />
                </Field>
                <Button type="submit" variant="primary" className="w-full" disabled={busy || !propertyId || !rate || !month}>
                  {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                  Save rate
                </Button>
              </form>
            </CardContent>
          </Card>
        )}
        <div className="flex gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
          <Lock className="mt-0.5 size-4 shrink-0 text-slate-500" />
          <p>Old bills never change. Each bill keeps the rate, units and sharing it was made with, so changing the rate only affects bills made after it.</p>
        </div>
      </div>
    </div>
  )
}
