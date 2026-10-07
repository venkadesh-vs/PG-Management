'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Input, Select } from '@/components/ui/input'

/** ?month=YYYY-MM (the last month shown) and ?span=1|3|6|12 months. */
export function PeriodPicker({ month, span, max }: { month: string; span: number; max: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  function write(key: string, value: string) {
    const next = new URLSearchParams(params.toString())
    if (value) next.set(key, value)
    else next.delete(key)
    router.replace(`${pathname}?${next}`, { scroll: false })
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        type="month"
        aria-label="Month"
        className="h-10 w-[10.5rem]"
        value={month}
        max={max}
        onChange={(e) => write('month', e.target.value)}
      />
      <Select aria-label="Period" className="h-10 w-[11rem]" value={String(span)} onChange={(e) => write('span', e.target.value)}>
        <option value="1">This month only</option>
        <option value="3">3 months to here</option>
        <option value="6">6 months to here</option>
        <option value="12">12 months to here</option>
      </Select>
    </div>
  )
}
