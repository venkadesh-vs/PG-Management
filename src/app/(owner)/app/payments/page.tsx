import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import type { Prisma } from '@prisma/client'
import { requireOrgUser } from '@/lib/auth'
import { resolveScope } from '@/lib/tenancy'
import { prisma } from '@/lib/prisma'
import { themeFor } from '@/lib/theme'
import {
  addDays,
  cn,
  endOfMonth,
  formatDateTime,
  formatMoney,
  startOfDay,
  startOfMonth,
} from '@/lib/utils'
import { PageHeader } from '@/components/app/page-header'
import { StatCard } from '@/components/app/stat-card'
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
import { RecordPaymentButton } from './record-payment'

export const metadata: Metadata = { title: 'Payments' }

const PAGE_SIZE = 25

const METHOD_OPTIONS = [
  { value: 'UPI', label: 'UPI' },
  { value: 'CASH', label: 'Cash' },
  { value: 'BANK_TRANSFER', label: 'Bank transfer' },
  { value: 'CARD', label: 'Card' },
  { value: 'CHEQUE', label: 'Cheque' },
  { value: 'GATEWAY', label: 'Online' },
]

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const user = await requireOrgUser()
  const params = await searchParams
  const scope = await resolveScope(user, params.property)
  const propertyIds = scope.propertyId ? [scope.propertyId] : scope.allowedPropertyIds

  const page = Math.max(1, Number(params.page) || 1)
  const q = params.q?.trim() ?? params.receipt ?? ''
  const method = params.method
  const range = params.range ?? 'month'

  const now = new Date()
  const from =
    range === 'today'
      ? startOfDay(now)
      : range === 'week'
        ? addDays(startOfDay(now), -7)
        : range === 'all'
          ? new Date(2000, 0, 1)
          : startOfMonth(now)

  const where: Prisma.RentPaymentWhereInput = {
    organizationId: scope.organizationId,
    propertyId: { in: propertyIds },
    paidAt: { gte: from },
    ...(method ? { method: method as never } : {}),
    ...(q
      ? {
          OR: [
            { receiptNumber: { contains: q, mode: 'insensitive' } },
            { reference: { contains: q, mode: 'insensitive' } },
            { resident: { fullName: { contains: q, mode: 'insensitive' } } },
          ],
        }
      : {}),
  }

  const [payments, total, todaySum, monthSum, byMethod] = await Promise.all([
    prisma.rentPayment.findMany({
      where,
      include: {
        resident: { select: { id: true, fullName: true, code: true } },
        property: { select: { name: true, type: true } },
        allocations: { include: { invoice: { select: { number: true } } } },
      },
      orderBy: { paidAt: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.rentPayment.count({ where }),
    prisma.rentPayment.aggregate({
      where: {
        organizationId: scope.organizationId,
        propertyId: { in: propertyIds },
        paidAt: { gte: startOfDay(now) },
        status: 'SUCCESS',
      },
      _sum: { amount: true },
      _count: true,
    }),
    prisma.rentPayment.aggregate({
      where: {
        organizationId: scope.organizationId,
        propertyId: { in: propertyIds },
        paidAt: { gte: startOfMonth(now), lte: endOfMonth(now) },
        status: 'SUCCESS',
      },
      _sum: { amount: true },
      _count: true,
    }),
    prisma.rentPayment.groupBy({
      by: ['method'],
      where: {
        organizationId: scope.organizationId,
        propertyId: { in: propertyIds },
        paidAt: { gte: startOfMonth(now) },
      },
      _sum: { amount: true },
    }),
  ])

  const residents = await prisma.resident.findMany({
    where: {
      organizationId: scope.organizationId,
      propertyId: { in: propertyIds },
      status: { in: ['ACTIVE', 'NOTICE'] },
    },
    select: {
      id: true,
      fullName: true,
      code: true,
      rentAmount: true,
      invoices: {
        where: { status: { in: ['PENDING', 'PARTIALLY_PAID', 'OVERDUE'] } },
        select: { id: true, number: true, balance: true, dueDate: true },
        orderBy: { dueDate: 'asc' },
      },
    },
    orderBy: { fullName: 'asc' },
  })

  const topMethod = [...byMethod].sort(
    (a, b) => (b._sum.amount ?? 0) - (a._sum.amount ?? 0),
  )[0]
  const activeFilters = [q, method, params.range].filter(Boolean).length

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payments"
        subtitle="Every rupee received, with the receipt and the invoices it cleared."
        icon="card"
        breadcrumbs={[{ label: 'Dashboard', href: '/app' }, { label: 'Payments' }]}
        actions={
          <RecordPaymentButton
            residents={residents.map((r) => ({
              id: r.id,
              fullName: r.fullName,
              code: r.code,
              rentAmount: r.rentAmount,
              outstanding: r.invoices.reduce((s, i) => s + i.balance, 0),
              invoices: r.invoices.map((i) => ({
                id: i.id,
                number: i.number,
                balance: i.balance,
                dueDate: i.dueDate.toISOString(),
              })),
            }))}
          />
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard
          label="Collected today"
          value={todaySum._sum.amount ?? 0}
          format="money"
          icon="money"
          tone="emerald"
          hint={`${todaySum._count} payments`}
        />
        <StatCard
          label="This month"
          value={monthSum._sum.amount ?? 0}
          format="money"
          icon="chart"
          tone="blue"
          hint={`${monthSum._count} payments`}
        />
        <StatCard
          label="Average payment"
          value={monthSum._count ? Math.round((monthSum._sum.amount ?? 0) / monthSum._count) : 0}
          format="money"
          icon="receipt"
          tone="violet"
          hint="This month"
        />
        <StatCard
          label="Most used method"
          value={topMethod?._sum.amount ?? 0}
          format="money"
          icon="cash"
          tone="amber"
          hint={topMethod ? topMethod.method.replace('_', ' ').toLowerCase() : 'No payments yet'}
        />
      </div>

      <Suspense fallback={<TableSkeleton />}>
        <FilterBar activeCount={activeFilters}>
          <SearchInput placeholder="Search receipt, reference or resident…" />
          <FilterSelect paramKey="method" placeholder="All methods" options={METHOD_OPTIONS} />
          <FilterSelect
            paramKey="range"
            placeholder="This month"
            options={[
              { value: 'today', label: 'Today' },
              { value: 'week', label: 'Last 7 days' },
              { value: 'month', label: 'This month' },
              { value: 'all', label: 'All time' },
            ]}
          />
        </FilterBar>
      </Suspense>

      {payments.length === 0 ? (
        <EmptyState
          icon="card"
          title={activeFilters ? 'No payments match these filters' : 'No payments in this period'}
          description="Record a payment from the button above, or a resident can pay from their own app."
        />
      ) : (
        <>
          <TableWrap className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Receipt</TableHead>
                  <TableHead>Resident</TableHead>
                  <TableHead>Applied to</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Received</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payments.map((payment) => {
                  const theme = themeFor(payment.property.type)
                  return (
                    <TableRow key={payment.id}>
                      <TableCell>
                        <p className="font-mono text-sm font-medium text-slate-800">
                          {payment.receiptNumber}
                        </p>
                        <p className="flex items-center gap-1 text-xs text-slate-500">
                          <span className={cn('size-1.5 rounded-full', theme.bgSolid)} />
                          {payment.property.name}
                        </p>
                      </TableCell>
                      <TableCell>
                        <Link
                          href={`/app/residents/${payment.resident.id}`}
                          className="text-sm font-medium text-slate-800 hover:text-blue-700"
                        >
                          {payment.resident.fullName}
                        </Link>
                        <p className="text-xs text-slate-500">{payment.resident.code}</p>
                      </TableCell>
                      <TableCell className="text-xs text-slate-600">
                        {payment.allocations.length
                          ? payment.allocations.map((a) => a.invoice.number).join(', ')
                          : 'Advance'}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" size="sm" className="capitalize">
                          {payment.method.replace('_', ' ').toLowerCase()}
                        </Badge>
                        {payment.isDemo && (
                          <Badge variant="warning" size="sm" className="ml-1">
                            Demo
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-slate-600">
                        {formatDateTime(payment.paidAt)}
                        {payment.recordedBy && (
                          <p className="text-xs text-slate-400">by {payment.recordedBy}</p>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-semibold text-emerald-600 tabular">
                        {formatMoney(payment.amount)}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </TableWrap>

          <ul className="space-y-2 md:hidden">
            {payments.map((payment) => (
              <li
                key={payment.id}
                className="rounded-2xl border border-slate-200 bg-white p-4 shadow-card"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link
                      href={`/app/residents/${payment.resident.id}`}
                      className="truncate font-medium text-slate-900"
                    >
                      {payment.resident.fullName}
                    </Link>
                    <p className="font-mono text-xs text-slate-500">{payment.receiptNumber}</p>
                  </div>
                  <span className="shrink-0 font-semibold text-emerald-600 tabular">
                    {formatMoney(payment.amount)}
                  </span>
                </div>
                <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
                  <span className="capitalize">{payment.method.replace('_', ' ').toLowerCase()}</span>
                  <span>{formatDateTime(payment.paidAt)}</span>
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
