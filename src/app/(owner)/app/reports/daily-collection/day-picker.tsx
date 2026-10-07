'use client'

import * as React from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { toISODate } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

/** Date picker with previous/next day buttons; keeps the other filters. */
export function DayPicker({ value }: { value: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const today = toISODate(new Date())

  function go(date: string) {
    const next = new URLSearchParams(params.toString())
    if (date && date !== today) next.set('date', date)
    else next.delete('date')
    router.push(`${pathname}${next.size ? `?${next}` : ''}`)
  }
  function shift(days: number) {
    const [y, m, d] = value.split('-').map(Number)
    go(toISODate(new Date(y, m - 1, d + days)))
  }

  return (
    <div className="flex items-center gap-1.5">
      <Button variant="outline" size="icon" onClick={() => shift(-1)} aria-label="Previous day">
        <ChevronLeft className="size-4" />
      </Button>
      <Input
        type="date"
        value={value}
        max={today}
        onChange={(e) => e.target.value && go(e.target.value)}
        className="w-[10.5rem]"
        aria-label="Report date"
      />
      <Button variant="outline" size="icon" onClick={() => shift(1)} disabled={value >= today} aria-label="Next day">
        <ChevronRight className="size-4" />
      </Button>
    </div>
  )
}
