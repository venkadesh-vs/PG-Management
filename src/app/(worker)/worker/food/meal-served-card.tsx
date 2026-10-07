'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { Check, CookingPot, Minus, Plus } from 'lucide-react'
import { api, ApiError } from '@/lib/client'
import { cn } from '@/lib/utils'
import { PROPERTY_THEMES } from '@/lib/theme'
import { useToast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

const MEAL_TIME = {
  BREAKFAST: '7:30 – 9:30 AM',
  LUNCH: '12:30 – 2:30 PM',
  DINNER: '8:00 – 10:00 PM',
} as const

/**
 * The kitchen's per-meal card. A cook taps + / − to adjust the count they
 * actually served, then confirms — which deducts grocery stock.
 */
export function MealServedCard({
  meal,
  propertyType,
  canManage = true,
}: {
  /** food.manage — record meals served. */
  canManage?: boolean
  meal: {
    type: 'BREAKFAST' | 'LUNCH' | 'DINNER'
    expected: number
    mealId: string | null
    menu: string | null
    actual: number | null
  }
  propertyName: string
  propertyType: 'MENS' | 'WOMENS' | 'COLIVE'
}) {
  const router = useRouter()
  const toast = useToast()
  const theme = PROPERTY_THEMES[propertyType]
  const [count, setCount] = React.useState(meal.actual ?? meal.expected)
  const [busy, setBusy] = React.useState(false)

  const served = meal.actual !== null

  async function confirm() {
    if (!meal.mealId) {
      toast.warning('No menu set yet', 'Your PG owner needs to publish the menu for this meal.')
      return
    }
    setBusy(true)
    try {
      const result = await api.post<{ message: string }>('/api/operations', {
        entity: 'MEAL_SERVED',
        mealId: meal.mealId,
        actualCount: count,
      })
      toast.success('Meal recorded', result.message)
      router.refresh()
    } catch (error) {
      toast.error(
        'Unable to record',
        error instanceof ApiError ? error.message : 'Please try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className={cn(served && 'border-emerald-200 bg-emerald-50/30')}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold uppercase tracking-wide text-slate-700">
                {meal.type.toLowerCase()}
              </p>
              <span className="text-[11px] text-slate-400">{MEAL_TIME[meal.type]}</span>
              {served && (
                <Badge variant="success" size="sm">
                  <Check className="size-3" />
                  Served
                </Badge>
              )}
            </div>
            <p
              className={cn(
                'mt-1 text-sm',
                meal.menu ? 'text-slate-600' : 'italic text-slate-400',
              )}
            >
              {meal.menu ?? 'Menu not published yet'}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className={cn('font-display text-2xl font-semibold tabular', theme.text)}>
              {meal.expected}
            </p>
            <p className="text-[10px] uppercase tracking-wide text-slate-400">expected</p>
          </div>
        </div>

        {canManage && !served && meal.mealId && (
          <div className="mt-4 flex items-center gap-3 border-t border-slate-100 pt-3">
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon-sm"
                onClick={() => setCount((c) => Math.max(0, c - 1))}
                aria-label="One less"
              >
                <Minus className="size-4" />
              </Button>
              <motion.span
                key={count}
                initial={{ scale: 1.2, opacity: 0.6 }}
                animate={{ scale: 1, opacity: 1 }}
                className="w-12 text-center font-display text-xl font-semibold text-slate-900 tabular"
              >
                {count}
              </motion.span>
              <Button
                variant="outline"
                size="icon-sm"
                onClick={() => setCount((c) => c + 1)}
                aria-label="One more"
              >
                <Plus className="size-4" />
              </Button>
            </div>
            <Button variant="success" size="sm" className="flex-1" loading={busy} onClick={confirm}>
              <CookingPot className="size-3.5" />
              Record {count} served
            </Button>
          </div>
        )}

        {served && (
          <p className="mt-3 border-t border-emerald-100 pt-3 text-sm text-emerald-800">
            {meal.actual} meals served · grocery stock updated
          </p>
        )}
      </CardContent>
    </Card>
  )
}
