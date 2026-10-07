import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import type { Prisma } from '@prisma/client'
import { requireAccess } from '@/lib/auth'
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
import { ExportButton } from '@/components/app/export-button'
import { StatCard, StatGrid } from '@/components/app/stat-card'
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
import { PaymentActions, PaymentStatusBadge, type PaymentRow } from './payment-actions'
import { unallocatedOf } from '@/lib/billing-calc'
import { CalendarCheck, Paperclip } from 'lucide-react'
import { Button } from '@/components/ui/button'

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
  const user = await requireAccess({ module: 'rent', permission: 'rent.view' })
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
            { utr: { contains: q, mode: 'insensitive' } },
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
        purpose: 'RENT',
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
        purpose: 'RENT',
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
        purpose: 'RENT',
        status: 'SUCCESS',
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

  const can = {
    edit: user.permissions.includes('payments.record'),
    reverse: user.permissions.includes('payments.record') && user.permissions.includes('invoices.waive'),
  }
  const toRow = (p: (typeof payments)[number]): PaymentRow => ({
    id: p.id,
    residentId: p.resident.id,
    receiptNumber: p.receiptNumber,
    amount: p.amount,
    status: p.status,
    purpose: p.purpose,
    method: p.method,
    reference: p.reference,
    utr: p.utr,
    notes: p.notes,
    attachmentUrl: p.attachmentUrl,
    refundedAmount: p.refundedAmount,
    unallocated: unallocatedOf(p),
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
          <>
          <Button variant="outline" asChild>
            <Link href="/app/reports/daily-collection">
              <CalendarCheck className="size-4" />
              Daily collection
            </Link>
          </Button>
          {user.permissions.includes('reports.export') && (
            <Suspense fallback={null}>
              <ExportButton kind="payments" />
            </Suspense>
          )}
          {user.permissions.includes('payments.record') && (
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
          )}
          </>
        }
      />

      <StatGrid cols={4}>
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
         
          hint={`${monthSum._count} payments`}
        />
        <StatCard
          label="Average payment"
          value={monthSum._count ? Math.round((monthSum._sum.amount ?? 0) / monthSum._count) : 0}
          format="money"
          icon="receipt"
         
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
      </StatGrid>

      <Suspense fallback={<TableSkeleton />}>
        <FilterBar activeCount={activeFilters}>
          <SearchInput placeholder="Search receipt, UTR, reference or resident…" />
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
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {payments.map((payment) => {
                  const theme = themeFor(payment.property.type)
                  return (
                    <TableRow key={payment.id}>
                      <TableCell>
                        <p className="font-mono text-sm font-medium text-slate-800">
                          <a href={`/api/documents/rent-receipt/${payment.id}.pdf`} className="hover:text-blue-700 hover:underline" target="_blank" rel="noopener" title="Download receipt">
                            {payment.receiptNumber}
                          </a>
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
                        {payment.status === 'REVERSED'
                          ? `Reversed${payment.reversalReason ? ` — ${payment.reversalReason}` : ''}`
                          : payment.purpose === 'DEPOSIT'
                            ? 'Security deposit'
                            : payment.allocations.length
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
                        {payment.utr && (
                          <p className="mt-0.5 font-mono text-[11px] text-slate-500">UTR {payment.utr}</p>
                        )}
                        {payment.attachmentUrl && (
                          <a href={payment.attachmentUrl} target="_blank" rel="noopener" className="mt-0.5 flex items-center gap-1 text-[11px] text-blue-600 hover:underline">
                            <Paperclip className="size-3" /> Proof
                          </a>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-slate-600">
                        {formatDateTime(payment.paidAt)}
                        {payment.recordedBy && (
                          <p className="text-xs text-slate-400">by {payment.recordedBy}</p>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <span
                          className={cn(
                            'font-semibold tabular',
                            payment.status === 'REVERSED' ? 'text-slate-400 line-through' : 'text-emerald-600',
                          )}
                        >
                          {formatMoney(payment.amount)}
                        </span>
                        <div className="mt-0.5">
                          <PaymentStatusBadge status={payment.status} refundedAmount={payment.refundedAmount} />
                        </div>
                      </TableCell>
                      <TableCell>
                        <PaymentActions payment={toRow(payment)} can={can} />
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
                className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link
                      href={`/app/residents/${payment.resident.id}`}
                      className="block truncate font-medium text-slate-900"
                    >
                      {payment.resident.fullName}
                    </Link>
                    <a href={`/api/documents/rent-receipt/${payment.id}.pdf`} target="_blank" rel="noopener" className="mt-0.5 block font-mono text-xs text-slate-500 underline-offset-2 hover:underline">
                      {payment.receiptNumber}
                    </a>
                  </div>
                  <div className="flex shrink-0 items-start gap-1">
                    <div className="text-right">
                      <span
                        className={cn(
                          'font-semibold tabular',
                          payment.status === 'REVERSED' ? 'text-slate-400 line-through' : 'text-emerald-600',
                        )}
                      >
                        {formatMoney(payment.amount)}
                      </span>
                      <div>
                        <PaymentStatusBadge status={payment.status} refundedAmount={payment.refundedAmount} />
                      </div>
                    </div>
                    <PaymentActions payment={toRow(payment)} can={can} />
                  </div>
                </div>
                <div className="mt-2 flex items-center justify-between gap-2 text-xs text-slate-500">
                  <span className="capitalize">
                    {payment.method.replace('_', ' ').toLowerCase()}
                    {payment.utr ? ` · UTR ${payment.utr}` : ''}
                  </span>
                  <span className="shrink-0">{formatDateTime(payment.paidAt)}</span>
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
