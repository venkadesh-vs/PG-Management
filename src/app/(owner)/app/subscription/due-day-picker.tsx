'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { CalendarDays } from 'lucide-react'
import { api, ApiError } from '@/lib/client'
import { cn } from '@/lib/utils'
import { useToast } from '@/components/ui/toast'

/** The owner picks the day (1–10) their one combined StayFlow bill is due. */
export function DueDayPicker({ day, canEdit }: { day: number; canEdit: boolean }) {
  const router = useRouter()
  const toast = useToast()
  const [value, setValue] = React.useState(day)
  const [busy, setBusy] = React.useState(false)

  async function pick(next: number) {
    if (next === value || busy) return
    const before = value
    setValue(next)
    setBusy(true)
    try {
      const result = await api.post<{ message: string }>('/api/subscription', { action: 'SET_DUE_DAY', day: next })
      toast.success('Due day saved', result.message)
      router.refresh()
    } catch (error) {
      setValue(before)
      toast.error('Could not change the due day', error instanceof ApiError ? error.message : 'Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <p className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
        <CalendarDays className="size-3.5" />
        Your bill is due on day
      </p>
      <div className="mt-2 grid grid-cols-10 gap-1" role="radiogroup" aria-label="Bill due day">
        {Array.from({ length: 10 }, (_, i) => i + 1).map((d) => (
          <button
            key={d}
            type="button"
            role="radio"
            aria-checked={value === d}
            disabled={!canEdit || busy}
            onClick={() => pick(d)}
            className={cn(
              'h-9 rounded-lg text-sm font-semibold tabular-nums transition',
              value === d ? 'bg-ink-950 text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
              (!canEdit || busy) && 'cursor-not-allowed opacity-70',
            )}
          >
            {d}
          </button>
        ))}
      </div>
    </div>
  )
}
