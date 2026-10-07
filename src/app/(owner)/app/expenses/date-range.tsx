'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Input } from '@/components/ui/input'

/** Custom from/to dates in the URL (?from=YYYY-MM-DD&to=YYYY-MM-DD). */
export function DateRange() {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  function write(key: 'from' | 'to', value: string) {
    const next = new URLSearchParams(params.toString())
    if (value) next.set(key, value)
    else next.delete(key)
    next.delete('page')
    if (value) next.delete('range')
    router.replace(`${pathname}?${next}`, { scroll: false })
  }

  return (
    <div className="flex items-center gap-1.5">
      <Input
        type="date"
        aria-label="From date"
        className="h-10 w-[9.5rem]"
        value={params.get('from') ?? ''}
        onChange={(e) => write('from', e.target.value)}
      />
      <span className="text-xs text-slate-400">to</span>
      <Input
        type="date"
        aria-label="To date"
        className="h-10 w-[9.5rem]"
        value={params.get('to') ?? ''}
        onChange={(e) => write('to', e.target.value)}
      />
    </div>
  )
}
