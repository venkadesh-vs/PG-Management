'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Check, Gauge, IndianRupee, Snowflake } from 'lucide-react'
import { api, ApiError } from '@/lib/client'
import { formatMoney } from '@/lib/utils'
import { SHARING, type RentCard, type SharingType } from '@/lib/rent-card'
import { useToast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

/**
 * The PG's rent card: rent per bed by sharing, non-AC and AC. Saving prices
 * every room from it; the standard rent and subscription follow. Residents
 * already staying keep their agreed rent.
 */
export function RentCardEditor({
  propertyId,
  initial,
  used,
  standardRent,
}: {
  propertyId: string
  initial: RentCard
  /** Sharing types this PG's rooms actually have. */
  used: SharingType[]
  standardRent: number
}) {
  const router = useRouter()
  const toast = useToast()
  const [card, setCard] = React.useState<RentCard>(initial)
  const [busy, setBusy] = React.useState(false)
  const rows = SHARING.filter((s) => used.includes(s.type) || card[s.type])

  function set(t: SharingType, which: 'nonAc' | 'ac', value: string) {
    setCard((c) => ({ ...c, [t]: { ...(c[t] ?? {}), [which]: value === '' ? null : Number(value) } }))
  }

  async function save() {
    setBusy(true)
    try {
      const result = await api.put<{ message: string }>(`/api/properties/${propertyId}/rent-card`, { rentCard: card })
      toast.success('Rent card saved', result.message)
      router.refresh()
    } catch (e) {
      toast.error('Could not save', e instanceof ApiError ? e.message.replace(/^\w+: /, '') : 'Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <IndianRupee className="size-4 text-slate-400" />
          Rent card
        </CardTitle>
        <CardDescription>
          Monthly rent per bed. Saving updates every room. Residents already staying keep their agreed rent; new
          check-ins use these prices.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="overflow-hidden rounded-2xl border border-slate-200">
          <div className="grid grid-cols-[1fr_1fr_1fr] bg-slate-50 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            <span>Sharing</span>
            <span>Non-AC</span>
            <span className="flex items-center gap-1">
              <Snowflake className="size-3" /> AC
            </span>
          </div>
          {(rows.length ? rows : SHARING).map((s) => (
            <div key={s.type} className="grid grid-cols-[1fr_1fr_1fr] items-center gap-2 border-t border-slate-100 px-3 py-2.5">
              <span className="text-sm font-semibold text-slate-800">{s.label}</span>
              {(['nonAc', 'ac'] as const).map((which) => (
                <div key={which} className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">₹</span>
                  <Input
                    inputMode="numeric"
                    value={card[s.type]?.[which] ?? ''}
                    onChange={(e) => set(s.type, which, e.target.value.replace(/\D/g, ''))}
                    aria-label={`${s.label} ${which === 'ac' ? 'AC' : 'non-AC'} rent`}
                    className="h-10 pl-7 tabular-nums"
                  />
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="flex items-center gap-1.5 text-sm text-slate-600">
            <Gauge className="size-4 text-blue-600" />
            Standard rent now <span className="font-semibold tabular-nums text-slate-900">{formatMoney(standardRent)}</span>
            <span className="text-slate-400">(average bed)</span>
          </p>
          <Button variant="primary" loading={busy} onClick={save}>
            {!busy && <Check className="size-4" />}
            Save rent card
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
