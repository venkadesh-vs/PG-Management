import type { Metadata } from 'next'
import { Suspense } from 'react'
import type { Prisma } from '@prisma/client'
import { requireOrgUser } from '@/lib/auth'
import { resolveScope } from '@/lib/tenancy'
import { prisma } from '@/lib/prisma'
import { themeFor, CHART_COLORS } from '@/lib/theme'
import {
  addMonths,
  cn,
  endOfMonth,
  formatDate,
  formatMoney,
  startOfMonth,
  toISODate,
} from '@/lib/utils'
import { expenseBreakdown } from '@/server/services/analytics'
import { PageHeader } from '@/components/app/page-header'
import { StatCard } from '@/components/app/stat-card'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { EmptyState, TableSkeleton } from '@/components/ui/feedback'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableWrap,
} from '@/components/ui/table'
import { FilterBar, FilterSelect, Pagination, SearchInput } from '@/components/app/filters'
import { CategoryBarChart, DonutChart } from '@/components/app/charts'
import { QuickForm } from '@/components/app/quick-form'

export const metadata: Metadata = { title: 'Expenses' }

const PAGE_SIZE = 25

export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const user = await requireOrgUser()
  const params = await searchParams
  const scope = await resolveScope(user, params.property)
  const propertyIds = scope.propertyId ? [scope.propertyId] : scope.allowedPropertyIds

  const page = Math.max(1, Number(params.page) || 1)
  const q = params.q?.trim() ?? ''
  const categoryId = params.category
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

  const where: Prisma.ExpenseWhereInput = {
    organizationId: scope.organizationId,
    propertyId: { in: propertyIds },
    spentOn: { gte: from, lte: to },
    ...(categoryId ? { categoryId } : {}),
    ...(q
      ? {
          OR: [
            { title: { contains: q, mode: 'insensitive' } },
            { paidTo: { contains: q, mode: 'insensitive' } },
          ],
        }
      : {}),
  }

  const [expenses, total, sum, categories, breakdown, properties, collected] = await Promise.all([
    prisma.expense.findMany({
      where,
      include: {
        category: true,
        property: { select: { name: true, type: true } },
      },
      orderBy: { spentOn: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.expense.count({ where }),
    prisma.expense.aggregate({ where, _sum: { amount: true } }),
    prisma.expenseCategory.findMany({
      where: { organizationId: scope.organizationId },
      orderBy: { name: 'asc' },
    }),
    expenseBreakdown(propertyIds, from, to),
    prisma.property.findMany({
      where: { id: { in: propertyIds } },
      select: { id: true, name: true, type: true },
      orderBy: { name: 'asc' },
    }),
    prisma.rentPayment.aggregate({
      where: {
        organizationId: scope.organizationId,
        propertyId: { in: propertyIds },
        status: 'SUCCESS',
        paidAt: { gte: from, lte: to },
      },
      _sum: { amount: true },
    }),
  ])

  const spent = sum._sum.amount ?? 0
  const income = collected._sum.amount ?? 0
  const activeFilters = [q, categoryId, params.range].filter(Boolean).length

  return (
    <div className="space-y-6">
      <PageHeader
        title="Expenses"
        subtitle="Groceries, salaries, bills and repairs — recorded once and reflected in your profit estimate straight away."
        icon="receipt"
        breadcrumbs={[{ label: 'Dashboard', href: '/app' }, { label: 'Expenses' }]}
        actions={
          <QuickForm
            trigger="Add expense"
            title="Record an expense"
            description="This updates the PG's monthly expenses, the profit estimate and the reports together."
            endpoint="/api/operations"
            payload={{ entity: 'EXPENSE' }}
            successTitle="Expense added successfully"
            submitLabel="Save expense"
            fields={[
              {
                kind: 'select',
                name: 'propertyId',
                label: 'PG',
                required: true,
                half: true,
                defaultValue: scope.propertyId ?? properties[0]?.id,
                options: properties.map((p) => ({ value: p.id, label: p.name })),
              },
              {
                kind: 'select',
                name: 'categoryId',
                label: 'Category',
                required: true,
                half: true,
                options: categories.map((c) => ({ value: c.id, label: c.name })),
              },
              {
                kind: 'text',
                name: 'title',
                label: 'What was it for?',
                required: true,
                placeholder: 'EB bill for September',
              },
              {
                kind: 'number',
                name: 'amount',
                label: 'Amount',
                required: true,
                half: true,
              },
              {
                kind: 'date',
                name: 'spentOn',
                label: 'Date',
                required: true,
                half: true,
                defaultValue: toISODate(new Date()),
              },
              { kind: 'text', name: 'paidTo', label: 'Paid to', half: true },
              {
                kind: 'select',
                name: 'paymentMode',
                label: 'Paid by',
                half: true,
                defaultValue: 'CASH',
                options: [
                  { value: 'CASH', label: 'Cash' },
                  { value: 'UPI', label: 'UPI' },
                  { value: 'BANK_TRANSFER', label: 'Bank transfer' },
                  { value: 'CARD', label: 'Card' },
                  { value: 'CHEQUE', label: 'Cheque' },
                ],
              },
              { kind: 'textarea', name: 'notes', label: 'Notes', rows: 2 },
            ]}
          />
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total spent" value={spent} format="money" icon="receipt" tone="red" hint={`${total} entries`} />
        <StatCard label="Collected" value={income} format="money" icon="money" tone="emerald" hint="Same period" />
        <StatCard
          label="Estimated profit"
          value={income - spent}
          format="money"
          icon="chart"
          tone={income - spent >= 0 ? 'emerald' : 'red'}
          hint="Collections minus expenses"
        />
        <StatCard
          label="Biggest category"
          value={breakdown[0]?.amount ?? 0}
          format="money"
          icon="cart"
          tone="amber"
          hint={breakdown[0]?.name ?? 'Nothing recorded'}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Where the money went</CardTitle>
          </CardHeader>
          <CardContent className="pt-2">
            <CategoryBarChart data={breakdown.slice(0, 8)} color={CHART_COLORS[5]} height={260} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Split</CardTitle>
          </CardHeader>
          <CardContent className="pt-2">
            <DonutChart
              money
              centerValue={formatMoney(spent, { compact: true })}
              centerLabel="total"
              data={breakdown.slice(0, 6).map((b) => ({ name: b.name, value: b.amount }))}
            />
          </CardContent>
        </Card>
      </div>

      <Suspense fallback={<TableSkeleton />}>
        <FilterBar activeCount={activeFilters}>
          <SearchInput placeholder="Search expense or vendor…" />
          <FilterSelect
            paramKey="category"
            placeholder="All categories"
            options={categories.map((c) => ({ value: c.id, label: c.name }))}
          />
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

      {expenses.length === 0 ? (
        <EmptyState
          icon="receipt"
          title="No expenses in this period"
          description="Record what the PG spends — groceries, EB bills, salaries, repairs — and the profit estimate updates itself."
        />
      ) : (
        <>
          <TableWrap className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Expense</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>PG</TableHead>
                  <TableHead>Paid to</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {expenses.map((expense) => {
                  const theme = themeFor(expense.property.type)
                  return (
                    <TableRow key={expense.id}>
                      <TableCell>
                        <p className="font-medium text-slate-800">{expense.title}</p>
                        {expense.notes && (
                          <p className="truncate text-xs text-slate-500">{expense.notes}</p>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" size="sm">
                          {expense.category.name}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <span className="flex items-center gap-1.5 text-sm text-slate-600">
                          <span className={cn('size-1.5 rounded-full', theme.bgSolid)} />
                          {expense.property.name}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm text-slate-600">
                        {expense.paidTo ?? '—'}
                        <p className="text-xs capitalize text-slate-400">
                          {expense.paymentMode.replace('_', ' ').toLowerCase()}
                        </p>
                      </TableCell>
                      <TableCell className="text-sm text-slate-600">
                        {formatDate(expense.spentOn)}
                      </TableCell>
                      <TableCell className="text-right font-semibold text-slate-900 tabular">
                        {formatMoney(expense.amount)}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </TableWrap>

          <ul className="space-y-2 md:hidden">
            {expenses.map((expense) => (
              <li
                key={expense.id}
                className="rounded-2xl border border-slate-200 bg-white p-4 shadow-card"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-900">{expense.title}</p>
                    <p className="text-xs text-slate-500">
                      {expense.category.name} · {formatDate(expense.spentOn)}
                    </p>
                  </div>
                  <span className="shrink-0 font-semibold text-slate-900 tabular">
                    {formatMoney(expense.amount)}
                  </span>
                </div>
              </li>
            ))}
          </ul>

          <Suspense fallback={null}>
            <Pagination page={page} pageSize={PAGE_SIZE} total={total} />
          </Suspense>
        </>
      )}
    </div>
  )
}
