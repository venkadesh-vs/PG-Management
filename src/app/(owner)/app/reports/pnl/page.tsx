import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import { Download, Info, Printer } from 'lucide-react'
import { requireAccess } from '@/lib/auth'
import { resolveScope } from '@/lib/tenancy'
import { themeFor } from '@/lib/theme'
import { addMonths, cn, formatMoney, startOfMonth } from '@/lib/utils'
import { profitAndLoss } from '@/server/services/analytics'
import { monthKey, REVENUE_LABEL, type PnlFigures } from '@/server/services/pnl'
import { PageHeader, SectionHeader } from '@/components/app/page-header'
import { StatCard } from '@/components/app/stat-card'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { EmptyState, TableSkeleton } from '@/components/ui/feedback'
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
  TableWrap,
} from '@/components/ui/table'
import { PnlTrendChart } from './pnl-chart'
import { PeriodPicker } from './period-picker'

export const metadata: Metadata = { title: 'Profit & loss' }

const SPANS = [1, 3, 6, 12]

function parseMonth(value: string | undefined, fallback: Date) {
  const m = value?.match(/^(\d{4})-(\d{2})$/)
  if (!m) return startOfMonth(fallback)
  const d = new Date(Number(m[1]), Number(m[2]) - 1, 1)
  return d > fallback ? startOfMonth(fallback) : d
}

export default async function ProfitAndLossPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const user = await requireAccess({ module: 'reports', permission: 'reports.view' })
  const params = await searchParams
  const scope = await resolveScope(user, params.property)
  const propertyIds = scope.propertyId ? [scope.propertyId] : scope.allowedPropertyIds
  const canSeeRent = user.modules.includes('rent') && user.permissions.includes('rent.view')

  const now = new Date()
  const toMonth = parseMonth(params.month, now)
  const span = SPANS.includes(Number(params.span)) ? Number(params.span) : 1
  const fromMonth = startOfMonth(addMonths(toMonth, -(span - 1)))

  const header = (
    <PageHeader
      title="Profit & loss"
      subtitle="What came in, what went out and what you kept — month by month, PG by PG."
      icon="chart"
      breadcrumbs={[{ label: 'Dashboard', href: '/app' }, { label: 'Reports', href: '/app/reports' }, { label: 'Profit & loss' }]}
      actions={
        <>
          <Suspense fallback={null}>
            <PeriodPicker month={monthKey(toMonth)} span={span} max={monthKey(now)} />
          </Suspense>
          {canSeeRent && user.permissions.includes('reports.export') && (
            <Button variant="outline" asChild>
              <a
                href={`/api/exports/pnl.csv?${new URLSearchParams({
                  from: monthKey(fromMonth),
                  to: monthKey(toMonth),
                  ...(scope.propertyId ? { property: scope.propertyId } : {}),
                })}`}
                download
              >
                <Download className="size-4" />
                Export
              </a>
            </Button>
          )}
        </>
      }
    />
  )

  if (!canSeeRent) {
    return (
      <div className="space-y-6">
        {header}
        <EmptyState
          icon="chart"
          title="P&L needs access to rent figures"
          description="Revenue comes from rent collections. Ask the owner to give your role “See rent and payments”."
        />
      </div>
    )
  }

  const trendFrom = startOfMonth(addMonths(toMonth, -11))
  const [pnl, trend] = await Promise.all([
    profitAndLoss({ organizationId: scope.organizationId, propertyIds, from: fromMonth, to: toMonth }),
    span === 12
      ? null
      : profitAndLoss({ organizationId: scope.organizationId, propertyIds, from: trendFrom, to: toMonth }),
  ])
  const trendRows = (trend ?? pnl).trend
  const t = pnl.total
  const periodLabel =
    span === 1 ? pnl.months[0]?.label : `${pnl.months[0]?.label} – ${pnl.months[pnl.months.length - 1]?.label}`
  const nothing = t.revenue.total === 0 && t.expenses === 0 && t.billed === 0
  const categories = t.expensesByCategory.map((c) => c.name)
  const multi = pnl.byProperty.length > 1

  return (
    <div className="space-y-7">
      {header}

      <p className="flex items-start gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
        <Info className="mt-0.5 size-3.5 shrink-0 text-slate-400" />
        <span>
          <strong className="text-slate-800">{periodLabel}</strong> · Cash basis: revenue is rent-account money received in
          the period, split by what it paid for (rent, food, utilities…), net of refunds and reversals. Security deposits are
          never revenue. Expenses count only when approved and not voided.
        </span>
      </p>

      {nothing ? (
        <EmptyState
          icon="chart"
          title="Nothing recorded for this period yet"
          description="Once rent is collected or an expense is added, your profit shows up here."
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
            <StatCard label="Revenue" value={t.revenue.total} format="money" icon="money" tone="emerald" hint="Collected, net of refunds" />
            <StatCard label="Expenses" value={t.expenses} format="money" icon="receipt" tone="red" hint="Approved only" />
            <StatCard
              label="Net profit"
              value={t.net}
              format="money"
              icon="chart"
              tone={t.net >= 0 ? 'emerald' : 'red'}
              hint={t.revenue.total ? `${Math.round((t.net / t.revenue.total) * 100)}% margin` : undefined}
            />
            <StatCard
              label="Collection rate"
              value={t.collectionRate ?? 0}
              format="percent"
              icon="check"
              tone="blue"
              hint={t.billed ? `${formatMoney(t.paidOnBilled)} of ${formatMoney(t.billed)} billed` : 'Nothing billed'}
            />
          </div>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
            <StatCard label="Outstanding" value={t.outstanding} format="money" icon="warning" tone="amber" hint="Unpaid on these months' invoices" />
            <StatCard label="Profit per bed" value={t.profitPerBed ?? 0} format="money" icon="bed" tone="violet" hint={`${t.beds} beds on average`} />
            <StatCard
              label="Revenue per occupied bed"
              value={t.revenuePerOccupiedBed ?? 0}
              format="money"
              icon="user"
              tone="blue"
              hint={`${t.occupiedBeds} occupied on average`}
            />
            <Link href="/app/vacancy" className="block">
              <StatCard label="Vacancy loss" value={t.vacancyLoss} format="money" icon="warning" tone="red" hint="Empty beds × average rent" />
            </Link>
          </div>
        </>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Revenue, expenses and profit</CardTitle>
          <p className="text-xs text-slate-500">Last 12 months to {pnl.months[pnl.months.length - 1]?.label}</p>
        </CardHeader>
        <CardContent className="pt-2">
          <PnlTrendChart data={trendRows} />
        </CardContent>
      </Card>

      {/* --------------------------------------------- Statement */}
      <section className="space-y-4">
        <SectionHeader
          title="Statement"
          description={multi ? 'All PGs together and each PG side by side.' : 'Income and spending by type.'}
          icon="file"
        />
        <Suspense fallback={<TableSkeleton />}>
          <TableWrap>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[11rem]">Line</TableHead>
                  <TableHead className="text-right">{multi ? 'All PGs' : 'Amount'}</TableHead>
                  {multi &&
                    pnl.byProperty.map((p) => (
                      <TableHead key={p.id} className="whitespace-nowrap text-right">
                        <span className="inline-flex items-center gap-1.5">
                          <span className={cn('size-1.5 rounded-full', themeFor(p.type as never).bgSolid)} />
                          {p.name}
                        </span>
                      </TableHead>
                    ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                <GroupRow label="Revenue" span={multi ? pnl.byProperty.length + 2 : 2} />
                {(['rent', 'food', 'utilities', 'other', 'advance'] as const).map((k) => (
                  <Line key={k} label={REVENUE_LABEL[k]} total={t} each={multi ? pnl.byProperty : []} pick={(f) => f.revenue[k]} />
                ))}
                <Line strong label="Total revenue" total={t} each={multi ? pnl.byProperty : []} pick={(f) => f.revenue.total} />
                <GroupRow label="Expenses" span={multi ? pnl.byProperty.length + 2 : 2} />
                {categories.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={multi ? pnl.byProperty.length + 2 : 2} className="text-sm text-slate-500">
                      No approved expenses in this period.
                    </TableCell>
                  </TableRow>
                )}
                {categories.map((name) => (
                  <Line
                    key={name}
                    label={name}
                    total={t}
                    each={multi ? pnl.byProperty : []}
                    pick={(f) => f.expensesByCategory.find((c) => c.name === name)?.amount ?? 0}
                  />
                ))}
                <Line strong label="Total expenses" total={t} each={multi ? pnl.byProperty : []} pick={(f) => f.expenses} />
              </TableBody>
              <TableFooter>
                <Line strong tone label="Net profit" total={t} each={multi ? pnl.byProperty : []} pick={(f) => f.net} />
                <Line label="Collection rate" total={t} each={multi ? pnl.byProperty : []} pick={(f) => f.collectionRate} percent />
                <Line label="Outstanding" total={t} each={multi ? pnl.byProperty : []} pick={(f) => f.outstanding} />
                <Line label="Profit per bed" total={t} each={multi ? pnl.byProperty : []} pick={(f) => f.profitPerBed} />
                <Line label="Revenue per occupied bed" total={t} each={multi ? pnl.byProperty : []} pick={(f) => f.revenuePerOccupiedBed} />
                <Line label="Vacancy loss (estimate)" total={t} each={multi ? pnl.byProperty : []} pick={(f) => f.vacancyLoss} />
              </TableFooter>
            </Table>
          </TableWrap>
        </Suspense>
        {t.revenue.depositExcluded > 0 && (
          <p className="text-xs text-slate-500">
            {formatMoney(t.revenue.depositExcluded)} of deposits paid through invoices in this period is held money and not
            counted as revenue.
          </p>
        )}
      </section>

      <p className="no-print flex items-center gap-1.5 text-xs text-slate-400">
        <Printer className="size-3.5" />
        Use your browser&apos;s print function to save this statement as a PDF.
      </p>
    </div>
  )
}

function GroupRow({ label, span }: { label: string; span: number }) {
  return (
    <TableRow className="bg-slate-50/70 hover:bg-slate-50/70">
      <TableCell colSpan={span} className="py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </TableCell>
    </TableRow>
  )
}

function Line({
  label,
  total,
  each,
  pick,
  strong,
  tone,
  percent,
}: {
  label: string
  total: PnlFigures
  each: (PnlFigures & { id: string })[]
  pick: (f: PnlFigures) => number | null
  strong?: boolean
  tone?: boolean
  percent?: boolean
}) {
  const show = (v: number | null) => (v === null ? '—' : percent ? `${v}%` : formatMoney(v))
  const cls = (v: number | null) =>
    cn(
      'text-right tabular whitespace-nowrap',
      strong && 'font-semibold text-slate-900',
      tone && v !== null && (v >= 0 ? 'text-emerald-700' : 'text-red-700'),
    )
  return (
    <TableRow>
      <TableCell className={cn('text-sm', strong ? 'font-semibold text-slate-900' : 'text-slate-600')}>{label}</TableCell>
      <TableCell className={cls(pick(total))}>{show(pick(total))}</TableCell>
      {each.map((p) => (
        <TableCell key={p.id} className={cls(pick(p))}>
          {show(pick(p))}
        </TableCell>
      ))}
    </TableRow>
  )
}
