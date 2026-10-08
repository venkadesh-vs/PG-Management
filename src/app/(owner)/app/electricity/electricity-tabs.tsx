import Link from 'next/link'
import { cn } from '@/lib/utils'

const TABS = [
  { key: 'billing', label: 'Monthly billing', href: '/app/electricity' },
  { key: 'meters', label: 'Meters', href: '/app/electricity/meters' },
  { key: 'rates', label: 'Rates', href: '/app/electricity/rates' },
] as const

/** The three electricity screens, as a segmented control. */
export function ElectricityTabs({ active }: { active: (typeof TABS)[number]['key'] }) {
  return (
    <nav aria-label="Electricity sections" className="inline-flex max-w-full gap-1 overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 p-1">
      {TABS.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          aria-current={active === tab.key ? 'page' : undefined}
          className={cn(
            'shrink-0 rounded-md px-3 py-1.5 text-sm font-medium transition',
            active === tab.key ? 'bg-white text-slate-900 shadow-xs ring-1 ring-slate-200' : 'text-slate-500 hover:text-slate-900',
          )}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  )
}
