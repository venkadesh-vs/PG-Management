'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { api, ApiError } from '@/lib/client'
import { useToast } from '@/components/ui/toast'
import { Switch } from '@/components/ui/primitives'

/**
 * A resident skipping a meal immediately lowers the kitchen's expected count
 * for that meal — which is the whole point of deriving counts rather than
 * guessing them.
 */
export function MealOptOut({
  mealId,
  mealLabel,
  optedOut,
}: {
  mealId: string
  mealLabel: string
  optedOut: boolean
}) {
  const router = useRouter()
  const toast = useToast()
  const [eating, setEating] = React.useState(!optedOut)
  const [busy, setBusy] = React.useState(false)

  async function toggle(next: boolean) {
    setEating(next)
    setBusy(true)
    try {
      await api.post('/api/tenant/meals', {
        mealId,
        status: next ? 'EXPECTED' : 'SKIPPED',
      })
      toast.success(
        next ? 'Counted back in' : 'Kitchen informed',
        next
          ? `You are counted for ${mealLabel}.`
          : `The kitchen will not cook for you for ${mealLabel}.`,
      )
      router.refresh()
    } catch (error) {
      setEating(!next)
      toast.error(
        'Unable to update',
        error instanceof ApiError ? error.message : 'Please try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex shrink-0 flex-col items-center gap-1">
      <Switch checked={eating} onCheckedChange={toggle} disabled={busy} aria-label={`Eating ${mealLabel}`} />
      <span className="text-[10px] text-slate-400">{eating ? 'Eating' : 'Skip'}</span>
    </div>
  )
}
