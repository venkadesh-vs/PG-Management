import Link from 'next/link'
import { ArrowRight, Zap } from 'lucide-react'
import { formatMoney } from '@/lib/utils'
import { billingMonthLabel } from '@/lib/electricity'

type Summary = { month: string; amount: number; units: number; drafts: number; readingsDue: number; activeMeters: number }

/** Dashboard tile: this month's room electricity and what is still to do. */
export function ElectricityCard({ summary }: { summary: Summary }) {
  const todo = summary.readingsDue
    ? `${summary.readingsDue} of ${summary.activeMeters} room${summary.activeMeters === 1 ? '' : 's'} still to read`
    : summary.drafts
      ? `${summary.drafts} draft${summary.drafts === 1 ? '' : 's'} to finalize`
      : 'All rooms billed'
  return (
    <Link
      href="/app/electricity"
      className="group flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-xs transition hover:border-slate-300"
    >
      <span className="flex min-w-0 items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
          <Zap className="size-5" />
        </span>
        <span className="min-w-0">
          <span className="block text-xs font-medium text-slate-500">Electricity · {billingMonthLabel(summary.month)}</span>
          <span className="block font-display text-lg font-semibold tabular-nums text-slate-900">{formatMoney(summary.amount)}</span>
          <span className={summary.readingsDue || summary.drafts ? 'block text-xs text-amber-700' : 'block text-xs text-slate-500'}>{todo}</span>
        </span>
      </span>
      <ArrowRight className="size-4 shrink-0 text-slate-400 transition group-hover:translate-x-0.5" />
    </Link>
  )
}
