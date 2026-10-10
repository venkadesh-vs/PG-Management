'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Check, Utensils } from 'lucide-react'
import { api, ApiError } from '@/lib/client'
import { cn, formatMoney } from '@/lib/utils'
import { useToast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Switch } from '@/components/ui/primitives'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

export type FoodPlanOption = { id: string; name: string; monthlyCharge: number; meals: string }

/**
 * "I need food" switch on the resident app. Turning it on asks which plan
 * (and shows the price); turning it off asks for a quick confirmation.
 */
export function FoodChoice({
  eating,
  plans,
  currentPlanId,
}: {
  eating: boolean
  plans: FoodPlanOption[]
  currentPlanId: string | null
}) {
  const router = useRouter()
  const toast = useToast()
  const [open, setOpen] = React.useState(false)
  const [planId, setPlanId] = React.useState(currentPlanId ?? plans[0]?.id ?? '')
  const [busy, setBusy] = React.useState(false)
  const starting = !eating

  async function save() {
    setBusy(true)
    try {
      const result = await api.post<{ message: string }>('/api/tenant/food', starting ? { needFood: true, foodPlanId: planId || undefined } : { needFood: false })
      toast.success(starting ? 'Food plan started' : 'Food plan stopped', result.message)
      setOpen(false)
      router.refresh()
    } catch (error) {
      toast.error('Unable to update', error instanceof ApiError ? error.message : 'Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Card>
        <CardContent className="flex items-center gap-3 p-4">
          <div className={cn('flex size-10 shrink-0 items-center justify-center rounded-xl', eating ? 'bg-emerald-50' : 'bg-slate-100')}>
            <Utensils className={cn('size-5', eating ? 'text-emerald-600' : 'text-slate-500')} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-slate-900">I need food from the PG</p>
            <p className="text-xs text-slate-500">
              {eating ? 'The kitchen cooks for you every day.' : plans.length ? 'Turn on to join the food plan.' : 'Your PG has no food plan yet.'}
            </p>
          </div>
          <Switch
            checked={eating}
            disabled={busy || (!eating && plans.length === 0)}
            onCheckedChange={() => setOpen(true)}
            aria-label="I need food from the PG"
          />
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>{starting ? 'Start food?' : 'Stop food?'}</DialogTitle>
            <DialogDescription>
              {starting
                ? 'Food starts from tomorrow. If this month’s rent bill is already out, the remaining days are added to your next bill.'
                : 'The kitchen stops counting you from now and your next rent bills will not include food. Food already billed this month is not refunded automatically.'}
            </DialogDescription>
          </DialogHeader>

          {starting && (
            <div className="space-y-2" role="radiogroup" aria-label="Food plan">
              {plans.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  role="radio"
                  aria-checked={planId === p.id}
                  onClick={() => setPlanId(p.id)}
                  className={cn(
                    'flex w-full items-center justify-between gap-3 rounded-xl border p-3 text-left transition',
                    planId === p.id ? 'border-blue-500 bg-blue-50/60 ring-1 ring-blue-500' : 'border-slate-200 hover:border-slate-300',
                  )}
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-slate-900">{p.name}</span>
                    <span className="block text-xs text-slate-500">{p.meals}</span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block font-display text-sm font-semibold tabular text-slate-900">
                      {p.monthlyCharge > 0 ? formatMoney(p.monthlyCharge) : 'Included'}
                    </span>
                    {p.monthlyCharge > 0 && <span className="block text-[11px] text-slate-500">per month</span>}
                  </span>
                </button>
              ))}
            </div>
          )}

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant={starting ? 'success' : 'destructive'} loading={busy} onClick={save} disabled={starting && !planId}>
              <Check className="size-4" />
              {starting ? 'Start food' : 'Stop food'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
