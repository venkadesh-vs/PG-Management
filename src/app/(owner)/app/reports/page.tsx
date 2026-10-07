import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import { ArrowDownRight, ArrowUpRight, Printer } from 'lucide-react'
import { requireAccess } from '@/lib/auth'
import { resolveScope } from '@/lib/tenancy'
import { prisma } from '@/lib/prisma'
import { CHART_COLORS, COMPLAINT_STATUS_STYLE, themeFor } from '@/lib/theme'
import {
  addMonths,
  cn,
  endOfMonth,
  formatDate,
  formatMoney,
  percent,
  startOfMonth,
} from '@/lib/utils'
import {
  collectionBreakdown,
  complaintBreakdown,
  expenseBreakdown,
  occupancyTrend,
  propertyComparison,
  reportTotals,
  revenueTrend,
} from '@/server/services/analytics'
import { PageHeader, SectionHeader } from '@/components/app/page-header'
import { StatCard } from '@/components/app/stat-card'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { StatusChip } from '@/components/ui/badge'
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
import { FilterBar, FilterSelect } from '@/components/app/filters'
import {
  CategoryBarChart,
  ComparisonChart,
  DonutChart,
  OccupancyChart,
  RevenueChart,
} from '@/components/app/charts'

export const metadata: Metadata = { title: 'Reports' }

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const user = await requireAccess({ module: 'reports', permission: 'reports.view' })
  const params = await searchParams
  const scope = await resolveScope(user, params.property)
  const propertyIds = scope.propertyId ? [scope.propertyId] : scope.allowedPropertyIds

  const range = params.range ?? 'month'
  const now = new Date()
  const from =
    range === 'last'
      ? startOfMonth(addMonths(now, -1))
      : range === 'quarter'
        ? startOfMonth(addMonths(now, -2))
        : range === 'year'
          ? new Date(now.getFullYear(), 0, 1)
          : startOfMonth(now)
  const to = range === 'last' ? endOfMonth(addMonths(now, -1)) : endOfMonth(now)

  const [
    totals,
    previousTotals,
    revenue,
    occupancy,
    collection,
    expenses,
    comparison,
    complaints,
    residentMovement,
    topDefaulters,
  ] = await Promise.all([
    reportTotals(propertyIds, from, to),
    reportTotals(
      propertyIds,
      startOfMonth(addMonths(from, -1)),
      endOfMonth(addMonths(from, -1)),
    ),
    revenueTrend(propertyIds, range === 'year' ? 12 : 6),
    occupancyTrend(propertyIds, range === 'month' ? 30 : 90),
    collectionBreakdown(propertyIds),
    expenseBreakdown(propertyIds, from, to),
    propertyComparison(scope.organizationId, scope.allowedPropertyIds),
    complaintBreakdown(propertyIds),
    prisma.resident.findMany({
      where: {
        propertyId: { in: propertyIds },
        OR: [
          { joiningDate: { gte: from, lte: to } },
          { exitDate: { gte: from, lte: to } },
        ],
      },
      select: {
        id: true,
        fullName: true,
        joiningDate: true,
        exitDate: true,
        status: true,
        property: { select: { name: true, type: true } },
      },
      orderBy: { joiningDate: 'desc' },
      take: 20,
    }),
    prisma.resident.findMany({
      where: {
        propertyId: { in: propertyIds },
        status: { in: ['ACTIVE', 'NOTICE'] },
        invoices: { some: { status: 'OVERDUE' } },
      },
      select: {
        id: true,
        fullName: true,
        phone: true,
        property: { select: { name: true, type: true } },
        room: { select: { number: true } },
        invoices: {
          where: { status: { in: ['OVERDUE', 'PENDING', 'PARTIALLY_PAID'] } },
          select: { balance: true, dueDate: true },
        },
      },
      take: 30,
    }),
  ])

  // StatCard wants a {value} object, and no badge at all when there is no
  // previous period to compare against.
  const delta = (current: number, previous: number) =>
    previous === 0 ? undefined : { value: Math.round(((current - previous) / previous) * 100) }

  const defaulters = topDefaulters
    .map((r) => ({
      ...r,
      outstanding: r.invoices.reduce((s, i) => s + i.balance, 0),
      oldestDue: r.invoices.reduce<Date | null>(
        (oldest, i) => (!oldest || i.dueDate < oldest ? i.dueDate : oldest),
        null,
      ),
    }))
    .sort((a, b) => b.outstanding - a.outstanding)
    .slice(0, 10)

  return (
    <div className="space-y-7">
      <PageHeader
        title="Reports"
        subtitle="Occupancy, collections, expenses and profit — straight from your data, no spreadsheet needed."
        icon="chart"
        breadcrumbs={[{ label: 'Dashboard', href: '/app' }, { label: 'Reports' }]}
        actions={
          <>
          {user.modules.includes('rent') && user.permissions.includes('rent.view') && (
            <Link
              href="/app/reports/pnl"
              className="inline-flex h-10 items-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Profit &amp; loss
            </Link>
          )}
          {user.modules.includes('rent') && user.permissions.includes('rent.view') && (
            <Link
              href="/app/reports/daily-collection"
              className="inline-flex h-10 items-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Daily collection
            </Link>
          )}
          <Suspense fallback={null}>
            <FilterBar>
              <FilterSelect
                paramKey="range"
                placeholder="This month"
                options={[
                  { value: 'month', label: 'This month' },
                  { value: 'last', label: 'Last month' },
                  { value: 'quarter', label: 'Last 3 months' },
                  { value: 'year', label: 'This year' },
                ]}
              />
            </FilterBar>
          </Suspense>
          </>
        }
      />

      {/* -------------------------------------------------- Headline P&L */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard
          label="Billed"
          value={totals.billed}
          format="money"
          icon="file"
          tone="blue"
          delta={delta(totals.billed, previousTotals.billed)}
          hint="Invoices raised in this period"
        />
        <StatCard
          label="Collected"
          value={totals.collected}
          format="money"
          icon="money"
          tone="emerald"
          delta={delta(totals.collected, previousTotals.collected)}
          hint={`${percent(totals.collected, totals.billed)}% of what was billed`}
        />
        <StatCard
          label="Expenses"
          value={totals.expenses}
          format="money"
          icon="receipt"
          tone="red"
          delta={delta(totals.expenses, previousTotals.expenses)}
        />
        <StatCard
          label="Estimated profit"
          value={totals.net}
          format="money"
          icon="chart"
          tone={totals.net >= 0 ? 'emerald' : 'red'}
          hint="Collections minus expenses"
        />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard label="Outstanding" value={totals.outstanding} format="money" icon="warning" tone="amber" hint="All unpaid invoices" />
        <StatCard label="Check-ins" value={totals.checkIns} icon="userPlus" tone="blue" hint="In this period" />
        <StatCard label="Checkouts" value={totals.checkOuts} icon="door" tone="violet" hint="In this period" />
        <StatCard
          label="Complaints resolved"
          value={totals.resolved}
          icon="check"
          tone="emerald"
          hint={`${totals.complaints} raised`}
        />
      </div>

      {/* ------------------------------------------------------- Charts */}
      <section className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Revenue & expenses</CardTitle>
            <p className="text-xs text-slate-500">Billed, collected and spent, month by month</p>
          </CardHeader>
          <CardContent className="pt-2">
            <RevenueChart data={revenue} height={280} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Rent collection</CardTitle>
            <p className="text-xs text-slate-500">Current month</p>
          </CardHeader>
          <CardContent className="pt-2">
            <DonutChart
              money
              centerValue={`${percent(collection.paid, collection.total)}%`}
              centerLabel="collected"
              data={[
                { name: 'Paid', value: collection.paid, color: '#10b981' },
                { name: 'Pending', value: collection.pending, color: '#f59e0b' },
                { name: 'Overdue', value: collection.overdue, color: '#ef4444' },
              ]}
            />
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Occupancy trend</CardTitle>
          </CardHeader>
          <CardContent className="pt-2">
            <OccupancyChart data={occupancy} height={260} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Expenses by category</CardTitle>
          </CardHeader>
          <CardContent className="pt-2">
            <CategoryBarChart data={expenses.slice(0, 7)} color={CHART_COLORS[5]} height={260} />
          </CardContent>
        </Card>
      </section>

      {/* ----------------------------------------------- PG performance */}
      {comparison.length > 1 && (
        <section className="space-y-4">
          <SectionHeader title="PG performance" description="Every property, same yardstick." icon="building" />
          <Card>
            <CardContent className="pt-6">
              <ComparisonChart
                data={comparison.map((p) => ({
                  name: p.name.replace(/StayFlow\s*/i, ''),
                  collected: p.collection,
                  pending: p.pending,
                  expenses: p.expenses,
                }))}
              />
            </CardContent>
          </Card>
          {/* Desktop table */}
          <TableWrap className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>PG</TableHead>
                  <TableHead className="text-right">Residents</TableHead>
                  <TableHead className="text-right">Occupancy</TableHead>
                  <TableHead className="text-right">Collected</TableHead>
                  <TableHead className="text-right">Pending</TableHead>
                  <TableHead className="text-right">Expenses</TableHead>
                  <TableHead className="text-right">Net</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {comparison.map((property) => {
                  const theme = themeFor(property.type)
                  const net = property.collection - property.expenses
                  return (
                    <TableRow key={property.id}>
                      <TableCell>
                        <span className="flex items-center gap-2">
                          <span className={cn('size-2 rounded-full', theme.bgSolid)} />
                          <span className="font-medium text-slate-800">{property.name}</span>
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular">{property.residents}</TableCell>
                      <TableCell className="text-right tabular">{property.occupancy.rate}%</TableCell>
                      <TableCell className="text-right text-emerald-600 tabular">
                        {formatMoney(property.collection)}
                      </TableCell>
                      <TableCell className="text-right text-amber-600 tabular">
                        {formatMoney(property.pending)}
                      </TableCell>
                      <TableCell className="text-right text-red-600 tabular">
                        {formatMoney(property.expenses)}
                      </TableCell>
                      <TableCell
                        className={cn(
                          'text-right font-semibold tabular',
                          net >= 0 ? 'text-emerald-700' : 'text-red-700',
                        )}
                      >
                        {formatMoney(net)}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell className="font-semibold">Total</TableCell>
                  <TableCell className="text-right font-semibold tabular">
                    {comparison.reduce((s, p) => s + p.residents, 0)}
                  </TableCell>
                  <TableCell />
                  <TableCell className="text-right font-semibold tabular">
                    {formatMoney(comparison.reduce((s, p) => s + p.collection, 0))}
                  </TableCell>
                  <TableCell className="text-right font-semibold tabular">
                    {formatMoney(comparison.reduce((s, p) => s + p.pending, 0))}
                  </TableCell>
                  <TableCell className="text-right font-semibold tabular">
                    {formatMoney(comparison.reduce((s, p) => s + p.expenses, 0))}
                  </TableCell>
                  <TableCell className="text-right font-semibold tabular">
                    {formatMoney(
                      comparison.reduce((s, p) => s + p.collection - p.expenses, 0),
                    )}
                  </TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </TableWrap>

          {/* Mobile cards */}
          <ul className="space-y-2 md:hidden">
            {comparison.map((property) => {
              const theme = themeFor(property.type)
              const net = property.collection - property.expenses
              return (
                <li
                  key={property.id}
                  className="rounded-2xl border border-slate-200 bg-white p-4 shadow-card"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="flex min-w-0 items-center gap-2">
                      <span className={cn('size-2 shrink-0 rounded-full', theme.bgSolid)} />
                      <span className="truncate font-medium text-slate-900">{property.name}</span>
                    </p>
                    <span className="shrink-0 text-xs text-slate-500 tabular">
                      {property.residents} residents · {property.occupancy.rate}%
                    </span>
                  </div>
                  <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <dt className="text-slate-500">Collected</dt>
                      <dd className="font-medium text-emerald-600 tabular">
                        {formatMoney(property.collection)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Pending</dt>
                      <dd className="font-medium text-amber-600 tabular">
                        {formatMoney(property.pending)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Expenses</dt>
                      <dd className="font-medium text-red-600 tabular">
                        {formatMoney(property.expenses)}
                      </dd>
                    </div>
                  </dl>
                  <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-100 pt-2 text-sm">
                    <span className="text-xs text-slate-500">Net</span>
                    <span
                      className={cn(
                        'font-semibold tabular',
                        net >= 0 ? 'text-emerald-700' : 'text-red-700',
                      )}
                    >
                      {formatMoney(net)}
                    </span>
                  </div>
                </li>
              )
            })}
            <li className="flex items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
              <span className="font-semibold text-slate-800">
                Total · {comparison.reduce((s, p) => s + p.residents, 0)} residents
              </span>
              <span className="font-semibold tabular">
                {formatMoney(comparison.reduce((s, p) => s + p.collection - p.expenses, 0))}
              </span>
            </li>
          </ul>
        </section>
      )}

      {/* ------------------------------------------------ Pending rent */}
      <section className="space-y-4">
        <SectionHeader
          title="Who still owes rent"
          description="Highest outstanding first — reminders have already gone out automatically."
          icon="warning"
        />
        {defaulters.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center">
              <p className="text-sm font-medium text-emerald-700">Nothing overdue.</p>
              <p className="mt-1 text-sm text-slate-500">
                Every invoice raised so far has been collected.
              </p>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Desktop table */}
            <TableWrap className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Resident</TableHead>
                    <TableHead>PG · Room</TableHead>
                    <TableHead>Oldest due</TableHead>
                    <TableHead className="text-right">Outstanding</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {defaulters.map((resident) => {
                    const theme = themeFor(resident.property.type)
                    return (
                      <TableRow key={resident.id}>
                        <TableCell className="font-medium text-slate-800">
                          {resident.fullName}
                        </TableCell>
                        <TableCell>
                          <span className="flex items-center gap-1.5 text-sm text-slate-600">
                            <span className={cn('size-1.5 rounded-full', theme.bgSolid)} />
                            {resident.property.name}
                            {resident.room ? ` · ${resident.room.number}` : ''}
                          </span>
                        </TableCell>
                        <TableCell className="text-sm text-slate-600">
                          {formatDate(resident.oldestDue)}
                        </TableCell>
                        <TableCell className="text-right font-semibold text-red-600 tabular">
                          {formatMoney(resident.outstanding)}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </TableWrap>

            {/* Mobile cards */}
            <ul className="space-y-2 md:hidden">
              {defaulters.map((resident) => {
                const theme = themeFor(resident.property.type)
                return (
                  <li
                    key={resident.id}
                    className="rounded-2xl border border-slate-200 bg-white p-4 shadow-card"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="truncate font-medium text-slate-900">{resident.fullName}</p>
                      <span className="shrink-0 font-semibold text-red-600 tabular">
                        {formatMoney(resident.outstanding)}
                      </span>
                    </div>
                    <p className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500">
                      <span className={cn('size-1.5 shrink-0 rounded-full', theme.bgSolid)} />
                      <span className="truncate">
                        {resident.property.name}
                        {resident.room ? ` · ${resident.room.number}` : ''}
                      </span>
                    </p>
                    <p className="mt-2 text-xs text-slate-500">
                      Oldest due {formatDate(resident.oldestDue)}
                    </p>
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </section>

      {/* ------------------------------------ Movement + complaint mix */}
      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Resident movement</CardTitle>
            <p className="text-xs text-slate-500">Check-ins and checkouts in this period</p>
          </CardHeader>
          <CardContent>
            {residentMovement.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-500">
                Nobody moved in or out in this period.
              </p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {residentMovement.slice(0, 10).map((resident) => {
                  const movedOut =
                    resident.exitDate && resident.exitDate >= from && resident.exitDate <= to
                  return (
                    <li key={resident.id} className="flex items-center gap-3 py-2.5">
                      <span
                        className={cn(
                          'flex size-7 shrink-0 items-center justify-center rounded-lg',
                          movedOut ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-600',
                        )}
                      >
                        {movedOut ? (
                          <ArrowDownRight className="size-3.5" />
                        ) : (
                          <ArrowUpRight className="size-3.5" />
                        )}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-slate-800">
                          {resident.fullName}
                        </p>
                        <p className="text-xs text-slate-500">{resident.property.name}</p>
                      </div>
                      <span className="shrink-0 text-xs text-slate-500">
                        {movedOut
                          ? `left ${formatDate(resident.exitDate)}`
                          : `joined ${formatDate(resident.joiningDate)}`}
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Complaints by status</CardTitle>
            <p className="text-xs text-slate-500">All time</p>
          </CardHeader>
          <CardContent>
            <DonutChart
              data={complaints.map((c) => ({
                name: COMPLAINT_STATUS_STYLE[c.status].label,
                value: c.count,
              }))}
              centerValue={String(complaints.reduce((s, c) => s + c.count, 0))}
              centerLabel="total"
              height={200}
            />
            <div className="mt-2 space-y-1.5">
              {complaints.map((c, i) => (
                <div key={c.status} className="flex items-center gap-2 text-xs">
                  <span
                    className="size-2 rounded-full"
                    style={{ background: CHART_COLORS[i % CHART_COLORS.length] }}
                  />
                  <StatusChip
                    label={COMPLAINT_STATUS_STYLE[c.status].label}
                    chip={COMPLAINT_STATUS_STYLE[c.status].chip}
                  />
                  <span className="ml-auto font-semibold text-slate-800 tabular">{c.count}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </section>

      <p className="no-print flex items-center gap-1.5 text-xs text-slate-400">
        <Printer className="size-3.5" />
        Use your browser&apos;s print function to save any report as a PDF — the app chrome is
        hidden automatically.
      </p>
    </div>
  )
}
