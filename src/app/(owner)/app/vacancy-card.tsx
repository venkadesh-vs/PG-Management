import Link from 'next/link'
import { ArrowRight, TrendingDown } from 'lucide-react'
import type { VacancyInsight } from '@/server/services/analytics'
import { themeFor } from '@/lib/theme'
import { cn, formatMoney } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { AnimatedNumber } from '@/components/ui/feedback'

/** PRD §48: turn empty beds into a rupee figure the owner feels. */
export function VacancyCard({ insight, showPerProperty }: { insight: VacancyInsight; showPerProperty: boolean }) {
  const max = Math.max(1, ...insight.byProperty.map((p) => p.monthlyLoss))

  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <TrendingDown className="size-4 text-amber-500" />
          Vacancy intelligence
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 pt-0">
        {insight.vacantBeds === 0 ? (
          <p className="py-3 text-sm text-slate-500">
            Every bed is filled or reserved — no rent is slipping away right now. 🙌
          </p>
        ) : (
          <>
            <div className="rounded-2xl border border-amber-100 bg-gradient-to-br from-amber-50 to-white p-4">
              <p className="text-sm text-slate-600">You are losing approximately</p>
              <p className="font-display text-2xl font-semibold tracking-tight text-amber-700 sm:text-3xl">
                <AnimatedNumber value={insight.monthlyLoss} format="money" />
                <span className="text-base font-medium text-amber-600">/month</span>
              </p>
              <p className="text-sm text-slate-600">from vacant capacity.</p>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Metric label="Vacant beds" value={String(insight.vacantBeds)} />
              <Metric label="Avg. rent per bed" value={formatMoney(insight.averageRent)} />
            </div>

            {showPerProperty && insight.byProperty.length > 0 && (
              <ul className="space-y-2.5">
                {insight.byProperty.slice(0, 5).map((p) => {
                  const theme = themeFor(p.type)
                  return (
                    <li key={p.id} className="space-y-1">
                      <div className="flex items-baseline justify-between gap-2 text-xs">
                        <span className="min-w-0 truncate font-medium text-slate-700">
                          {p.name}
                          <span className="font-normal text-slate-400">
                            {' '}· {p.vacantBeds} {p.vacantBeds === 1 ? 'bed' : 'beds'}
                          </span>
                        </span>
                        <span className="shrink-0 font-semibold text-slate-800 tabular">
                          {formatMoney(p.monthlyLoss, { compact: true })}
                        </span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className={cn('h-full rounded-full', theme.bgSolid)}
                          style={{ width: `${Math.max(4, Math.round((p.monthlyLoss / max) * 100))}%` }}
                        />
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}

            <Link href="/app/beds" className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600">
              See empty beds <ArrowRight className="size-3" />
            </Link>
          </>
        )}
      </CardContent>
    </Card>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-slate-50 px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-slate-400">{label}</p>
      <p className="font-display text-base font-semibold text-slate-900 tabular">{value}</p>
    </div>
  )
}
