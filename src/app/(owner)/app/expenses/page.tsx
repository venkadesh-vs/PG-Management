import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import { Download, Paperclip, Repeat } from 'lucide-react'
import type { Prisma } from '@prisma/client'
import { requireAccess } from '@/lib/auth'
import { resolveScope } from '@/lib/tenancy'
import { prisma } from '@/lib/prisma'
import { themeFor, CHART_COLORS } from '@/lib/theme'
import {
  addMonths,
  cn,
  endOfDay,
  endOfMonth,
  formatDate,
  formatMoney,
  startOfDay,
  startOfMonth,
  toISODate,
} from '@/lib/utils'
import {
  APPROVAL_THRESHOLD,
  canApproveExpenses,
  COUNTED_EXPENSE,
  expenseStatus,
  RECURRENCE_LABEL,
  isRecurrence,
  type ExpenseStatus,
} from '@/server/services/expense-rules'
import { PageHeader } from '@/components/app/page-header'
import { StatCard, StatGrid } from '@/components/app/stat-card'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
import { ExpenseForm } from './expense-form'
import { ExpenseActions } from './expense-actions'
import { DateRange } from './date-range'

export const metadata: Metadata = { title: 'Expenses' }

const PAGE_SIZE = 25

const STATUS_BADGE: Record<ExpenseStatus, { label: string; variant: 'success' | 'warning' | 'danger' | 'default' }> = {
  APPROVED: { label: 'Approved', variant: 'success' },
  PENDING: { label: 'Waiting approval', variant: 'warning' },
  REJECTED: { label: 'Rejected', variant: 'danger' },
  VOIDED: { label: 'Voided', variant: 'default' },
}

function parseDay(value: string | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const [y, m, d] = value.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const user = await requireAccess({ module: 'expenses', permission: 'expenses.view' })
  const params = await searchParams
  const scope = await resolveScope(user, params.property)
  const propertyIds = scope.propertyId ? [scope.propertyId] : scope.allowedPropertyIds

  const page = Math.max(1, Number(params.page) || 1)
  const q = params.q?.trim() ?? ''
  const vendor = params.vendor?.trim() ?? ''
  const categoryId = params.category
  const status = params.status ?? 'active'
  const range = params.range ?? 'month'

  // Custom dates win over the preset.
  const now = new Date()
  const customFrom = parseDay(params.from)
  const customTo = parseDay(params.to)
  const custom = Boolean(customFrom || customTo)
  const from = custom
    ? startOfDay(customFrom ?? new Date(2000, 0, 1))
    : range === 'last'
      ? startOfMonth(addMonths(now, -1))
      : range === 'quarter'
        ? startOfMonth(addMonths(now, -2))
        : range === 'year'
          ? new Date(now.getFullYear(), 0, 1)
          : startOfMonth(now)
  const to = custom
    ? endOfDay(customTo ?? now)
    : range === 'last'
      ? endOfMonth(addMonths(now, -1))
      : endOfMonth(now)

  const base: Prisma.ExpenseWhereInput = {
    organizationId: scope.organizationId,
    propertyId: { in: propertyIds },
    spentOn: { gte: from, lte: to },
    ...(categoryId ? { categoryId } : {}),
    ...(vendor ? { paidTo: { contains: vendor, mode: 'insensitive' } } : {}),
    ...(q
      ? {
          OR: [
            { title: { contains: q, mode: 'insensitive' } },
            { paidTo: { contains: q, mode: 'insensitive' } },
            { billNumber: { contains: q, mode: 'insensitive' } },
            { reference: { contains: q, mode: 'insensitive' } },
          ],
        }
      : {}),
  }
  const statusWhere: Prisma.ExpenseWhereInput =
    status === 'VOIDED'
      ? { voidedAt: { not: null } }
      : status === 'PENDING' || status === 'REJECTED' || status === 'APPROVED'
        ? { voidedAt: null, approvalStatus: status }
        : status === 'all'
          ? {}
          : { voidedAt: null }
  const where: Prisma.ExpenseWhereInput = { ...base, ...statusWhere }
  // Totals only ever count approved, not-voided money.
  const counted: Prisma.ExpenseWhereInput = { ...base, ...COUNTED_EXPENSE }

  const [expenses, total, sum, categories, byCategory, properties, collected, pending] = await Promise.all([
    prisma.expense.findMany({
      where,
      include: {
        category: true,
        property: { select: { name: true, type: true } },
      },
      orderBy: [{ spentOn: 'desc' }, { createdAt: 'desc' }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.expense.count({ where }),
    prisma.expense.aggregate({ where: counted, _sum: { amount: true }, _count: { _all: true } }),
    prisma.expenseCategory.findMany({
      where: { organizationId: scope.organizationId },
      orderBy: { name: 'asc' },
    }),
    prisma.expense.groupBy({ by: ['categoryId'], where: counted, _sum: { amount: true }, _count: { _all: true } }),
    prisma.property.findMany({
      where: { id: { in: propertyIds }, archivedAt: null },
      select: { id: true, name: true, type: true },
      orderBy: { name: 'asc' },
    }),
    prisma.rentPayment.aggregate({
      where: {
        organizationId: scope.organizationId,
        propertyId: { in: propertyIds },
        status: 'SUCCESS',
        purpose: 'RENT',
        paidAt: { gte: from, lte: to },
      },
      _sum: { amount: true },
    }),
    prisma.expense.aggregate({
      where: { ...base, voidedAt: null, approvalStatus: 'PENDING' },
      _sum: { amount: true },
      _count: { _all: true },
    }),
  ])

  // Grocery purchases and maintenance tasks that raised an expense.
  const ids = expenses.map((e) => e.id)
  const [groceryLinks, tasks] = await Promise.all([
    ids.length
      ? prisma.groceryPurchase.findMany({ where: { expenseId: { in: ids } }, select: { expenseId: true } })
      : [],
    prisma.maintenanceTask.findMany({
      where: { id: { in: expenses.map((e) => e.maintenanceTaskId).filter((x): x is string => Boolean(x)) } },
      select: { id: true, title: true },
    }),
  ])
  const fromGrocery = new Set(groceryLinks.map((g) => g.expenseId))
  const taskTitle = new Map(tasks.map((t) => [t.id, t.title]))

  const categoryName = new Map(categories.map((c) => [c.id, c.name]))
  const breakdown = byCategory
    .map((r) => ({ name: categoryName.get(r.categoryId) ?? 'Other', amount: r._sum.amount ?? 0, count: r._count._all }))
    .sort((a, b) => b.amount - a.amount)

  const spent = sum._sum.amount ?? 0
  const canManage = user.permissions.includes('expenses.manage')
  const canApprove = canApproveExpenses(user)
  const canSeeRent = user.modules.includes('rent') && user.permissions.includes('rent.view')
  const income = collected._sum.amount ?? 0
  const activeFilters = [q, vendor, categoryId, params.range, params.status, params.from, params.to].filter(Boolean).length
  const categoryOptions = categories.map((c) => ({ id: c.id, name: c.name }))

  const exportQuery = new URLSearchParams()
  if (scope.propertyId) exportQuery.set('property', scope.propertyId)
  exportQuery.set('from', toISODate(from))
  exportQuery.set('to', toISODate(to))
  if (categoryId) exportQuery.set('category', categoryId)
  if (vendor) exportQuery.set('vendor', vendor)
  if (status !== 'active' && status !== 'all') exportQuery.set('status', status)

  const rowFor = (expense: (typeof expenses)[number]) => {
    const state = expenseStatus(expense)
    const actions = (
      <ExpenseActions
        expense={{
          id: expense.id,
          propertyId: expense.propertyId,
          categoryId: expense.categoryId,
          title: expense.title,
          amount: expense.amount,
          spentOn: toISODate(expense.spentOn),
          paidTo: expense.paidTo ?? '',
          billNumber: expense.billNumber ?? '',
          paymentMode: expense.paymentMode,
          reference: expense.reference ?? '',
          notes: expense.notes ?? '',
          receiptUrl: expense.receiptUrl ?? '',
          isRecurring: expense.isRecurring,
          recurrence: expense.recurrence ?? 'MONTHLY',
        }}
        status={state}
        canManage={canManage}
        canApprove={canApprove}
        categories={categoryOptions}
        summary={`${expense.title} · ${formatMoney(expense.amount)} on ${formatDate(expense.spentOn)}`}
      />
    )
    const tags = (
      <span className="mt-1 flex flex-wrap items-center gap-1">
        {state !== 'APPROVED' && (
          <Badge variant={STATUS_BADGE[state].variant} size="sm">
            {STATUS_BADGE[state].label}
          </Badge>
        )}
        {expense.isRecurring && isRecurrence(expense.recurrence) && (
          <Badge variant="info" size="sm">
            <Repeat className="mr-1 size-3" />
            {RECURRENCE_LABEL[expense.recurrence]}
          </Badge>
        )}
        {expense.recurringFromId && (
          <Badge variant="outline" size="sm">
            <Repeat className="mr-1 size-3" />
            Auto-added
          </Badge>
        )}
        {fromGrocery.has(expense.id) && (
          <Badge variant="outline" size="sm">
            From grocery purchase
          </Badge>
        )}
        {expense.maintenanceTaskId && (
          <Badge variant="outline" size="sm">
            Maintenance: {taskTitle.get(expense.maintenanceTaskId) ?? 'task'}
          </Badge>
        )}
        {expense.receiptUrl && (
          <a href={expense.receiptUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-[11px] font-medium text-blue-600">
            <Paperclip className="size-3" /> Bill
          </a>
        )}
      </span>
    )
    return { state, actions, tags }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Expenses"
        subtitle="Groceries, salaries, bills and repairs — recorded once, with the bill attached, and reflected in your P&L straight away."
        icon="receipt"
        breadcrumbs={[{ label: 'Dashboard', href: '/app' }, { label: 'Expenses' }]}
        actions={
          <>
            {user.permissions.includes('reports.export') && (
              <Button variant="outline" asChild>
                <a href={`/api/exports/expenses.csv?${exportQuery}`} download>
                  <Download className="size-4" />
                  Export
                </a>
              </Button>
            )}
            {canManage && properties.length > 0 && (
              <ExpenseForm
                trigger="Add expense"
                properties={properties.map((p) => ({ id: p.id, name: p.name }))}
                categories={categoryOptions}
                initial={{ propertyId: scope.propertyId ?? properties[0]?.id }}
                approvalNote={
                  canApprove
                    ? undefined
                    : `${formatMoney(APPROVAL_THRESHOLD)} or more needs the owner's approval before it counts.`
                }
              />
            )}
          </>
        }
      />

      {pending._count._all > 0 && (
        <Link
          href="/app/expenses?status=PENDING"
          className="flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
        >
          <span>
            <strong>{pending._count._all}</strong> {pending._count._all === 1 ? 'expense is' : 'expenses are'} waiting for
            approval ({formatMoney(pending._sum.amount ?? 0)}) — not counted until approved.
          </span>
          <span className="shrink-0 font-semibold">{canApprove ? 'Review' : 'View'}</span>
        </Link>
      )}

      <StatGrid cols={4}>
        <StatCard label="Total spent" value={spent} format="money" icon="receipt" tone="red" hint={`${sum._count._all} approved entries`} />
        {canSeeRent && (
          <StatCard label="Collected" value={income} format="money" icon="money" tone="emerald" hint="Same period" />
        )}
        {canSeeRent && (
          <StatCard
            label="Estimated profit"
            value={income - spent}
            format="money"
            icon="chart"
            tone={income - spent >= 0 ? 'emerald' : 'red'}
            hint="Collections minus expenses"
          />
        )}
        <StatCard
          label="Biggest category"
          value={breakdown[0]?.amount ?? 0}
          format="money"
          icon="cart"
          tone="amber"
          hint={breakdown[0]?.name ?? 'Nothing recorded'}
        />
      </StatGrid>

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
            <CardTitle className="text-sm">Totals by category</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pt-2">
            <DonutChart
              money
              height={180}
              centerValue={formatMoney(spent, { compact: true })}
              centerLabel="total"
              data={breakdown.slice(0, 6).map((b) => ({ name: b.name, value: b.amount }))}
            />
            {breakdown.length > 0 && (
              <ul className="divide-y divide-slate-100 text-sm">
                {breakdown.map((b) => (
                  <li key={b.name} className="flex items-center justify-between gap-2 py-1.5">
                    <span className="min-w-0 truncate text-slate-700">
                      {b.name} <span className="text-xs text-slate-400">· {b.count}</span>
                    </span>
                    <span className="shrink-0 font-semibold text-slate-900 tabular">{formatMoney(b.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Suspense fallback={<TableSkeleton />}>
        <FilterBar activeCount={activeFilters}>
          <SearchInput placeholder="Search expense, vendor, bill no…" />
          <FilterSelect
            paramKey="category"
            placeholder="All categories"
            options={categories.map((c) => ({ value: c.id, label: c.name }))}
          />
          {properties.length > 1 && !user.propertyIds.length && (
            <FilterSelect
              paramKey="property"
              placeholder="All PGs"
              options={properties.map((p) => ({ value: p.id, label: p.name }))}
            />
          )}
          <FilterSelect
            paramKey="status"
            placeholder="Active (not voided)"
            options={[
              { value: 'APPROVED', label: 'Approved' },
              { value: 'PENDING', label: 'Waiting approval' },
              { value: 'REJECTED', label: 'Rejected' },
              { value: 'VOIDED', label: 'Voided' },
              { value: 'all', label: 'Everything' },
            ]}
          />
          <SearchInput paramKey="vendor" placeholder="Vendor…" className="sm:max-w-[10rem]" />
          <FilterSelect
            paramKey="range"
            placeholder={custom ? 'Custom dates' : 'This month'}
            options={[
              { value: 'month', label: 'This month' },
              { value: 'last', label: 'Last month' },
              { value: 'quarter', label: 'Last 3 months' },
              { value: 'year', label: 'This year' },
            ]}
          />
          <DateRange />
        </FilterBar>
      </Suspense>

      {expenses.length === 0 ? (
        <EmptyState
          icon="receipt"
          title={activeFilters ? 'No expenses match these filters' : 'No expenses in this period'}
          description={
            activeFilters
              ? 'Try a wider date range or clear the filters.'
              : 'Record what the PG spends — groceries, EB bills, salaries, repairs — and the P&L updates itself.'
          }
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
                  <TableHead>Vendor</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {expenses.map((expense) => {
                  const theme = themeFor(expense.property.type)
                  const row = rowFor(expense)
                  const off = row.state === 'VOIDED' || row.state === 'REJECTED'
                  return (
                    <TableRow key={expense.id} className={cn(off && 'opacity-60')}>
                      <TableCell>
                        <p className={cn('font-medium text-slate-800', off && 'line-through')}>{expense.title}</p>
                        {row.state === 'VOIDED' && expense.voidReason ? (
                          <p className="truncate text-xs text-slate-500">Voided: {expense.voidReason}</p>
                        ) : (
                          expense.notes && <p className="max-w-xs truncate text-xs text-slate-500">{expense.notes}</p>
                        )}
                        {row.tags}
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
                          {expense.billNumber ? ` · bill ${expense.billNumber}` : ''}
                        </p>
                      </TableCell>
                      <TableCell className="text-sm text-slate-600">{formatDate(expense.spentOn)}</TableCell>
                      <TableCell className={cn('text-right font-semibold text-slate-900 tabular', off && 'line-through')}>
                        {formatMoney(expense.amount)}
                      </TableCell>
                      <TableCell className="w-10">{row.actions}</TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </TableWrap>

          <ul className="space-y-2 md:hidden">
            {expenses.map((expense) => {
              const row = rowFor(expense)
              const off = row.state === 'VOIDED' || row.state === 'REJECTED'
              return (
                <li
                  key={expense.id}
                  className={cn('rounded-xl border border-slate-200 bg-white p-4 shadow-xs', off && 'opacity-60')}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className={cn('truncate font-medium text-slate-900', off && 'line-through')}>{expense.title}</p>
                      <p className="truncate text-xs text-slate-500">
                        {expense.category.name} · {formatDate(expense.spentOn)}
                        {expense.paidTo ? ` · ${expense.paidTo}` : ''}
                      </p>
                      {row.state === 'VOIDED' && expense.voidReason && (
                        <p className="truncate text-xs text-slate-500">Voided: {expense.voidReason}</p>
                      )}
                      {row.tags}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <span className={cn('font-semibold text-slate-900 tabular', off && 'line-through')}>
                        {formatMoney(expense.amount)}
                      </span>
                      {row.actions}
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>

          <Suspense fallback={null}>
            <Pagination page={page} pageSize={PAGE_SIZE} total={total} />
          </Suspense>
        </>
      )}
    </div>
  )
}
