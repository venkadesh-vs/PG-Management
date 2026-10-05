import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import type { InvoiceStatus, Prisma } from '@prisma/client'
import { requireOrgUser } from '@/lib/auth'
import { resolveScope } from '@/lib/tenancy'
import { prisma } from '@/lib/prisma'
import { INVOICE_STATUS_STYLE, themeFor } from '@/lib/theme'
import { cn, daysBetween, formatDate, formatMoney, formatMonth, startOfDay, startOfMonth } from '@/lib/utils'
import { collectionBreakdown } from '@/server/services/analytics'
import { PageHeader } from '@/components/app/page-header'
import { ExportButton } from '@/components/app/export-button'
import { StatCard } from '@/components/app/stat-card'
import { StatusChip } from '@/components/ui/badge'
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
import { RentToolbar } from './rent-toolbar'

export const metadata: Metadata = { title: 'Rent & Payments' }

const PAGE_SIZE = 25

const STATUS_OPTIONS = [
  { value: 'OVERDUE', label: 'Overdue' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'PARTIALLY_PAID', label: 'Partly paid' },
  { value: 'PAID', label: 'Paid' },
  { value: 'WAIVED', label: 'Waived' },
]

export default async function RentPage({
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
  const status = params.status as InvoiceStatus | undefined
  const month = params.month

  const where: Prisma.RentInvoiceWhereInput = {
    organizationId: scope.organizationId,
    propertyId: { in: propertyIds },
    ...(status ? { status } : {}),
    ...(month ? { periodStart: new Date(month) } : {}),
    ...(q
      ? {
          OR: [
            { number: { contains: q, mode: 'insensitive' } },
            { resident: { fullName: { contains: q, mode: 'insensitive' } } },
            { resident: { code: { contains: q, mode: 'insensitive' } } },
          ],
        }
      : {}),
  }

  const [invoices, total, pending, overdue, collection, months] = await Promise.all([
    prisma.rentInvoice.findMany({
      where,
      include: {
        resident: {
          select: {
            id: true,
            fullName: true,
            code: true,
            phone: true,
            room: { select: { number: true } },
            bed: { select: { label: true } },
          },
        },
        property: { select: { name: true, type: true } },
      },
      orderBy: [{ dueDate: 'desc' }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.rentInvoice.count({ where }),
    prisma.rentInvoice.aggregate({
      where: {
        organizationId: scope.organizationId,
        propertyId: { in: propertyIds },
        status: { in: ['PENDING', 'PARTIALLY_PAID'] },
      },
      _sum: { balance: true },
      _count: true,
    }),
    prisma.rentInvoice.aggregate({
      where: {
        organizationId: scope.organizationId,
        propertyId: { in: propertyIds },
        status: 'OVERDUE',
      },
      _sum: { balance: true },
      _count: true,
    }),
    collectionBreakdown(propertyIds),
    prisma.rentInvoice.findMany({
      where: { organizationId: scope.organizationId, propertyId: { in: propertyIds } },
      distinct: ['periodStart'],
      select: { periodStart: true },
      orderBy: { periodStart: 'desc' },
      take: 12,
    }),
  ])

  const today = startOfDay(new Date())
  const activeFilters = [q, status, month].filter(Boolean).length

  return (
    <div className="space-y-6">
      <PageHeader
        title="Rent & Payments"
        subtitle="Invoices generate on the 1st and reminders go out automatically. This is where you watch the money land."
        icon="wallet"
        breadcrumbs={[{ label: 'Dashboard', href: '/app' }, { label: 'Rent & Payments' }]}
        actions={
          <>
            <Suspense fallback={null}>
              <ExportButton kind="outstanding" label="Export dues" />
            </Suspense>
            <RentToolbar currentMonth={formatMonth(startOfMonth(new Date()))} />
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard
          label="Collected this month"
          value={collection.paid}
          format="money"
          icon="money"
          tone="emerald"
          hint={`of ${formatMoney(collection.total)} billed`}
        />
        <StatCard
          label="Pending"
          value={pending._sum.balance ?? 0}
          format="money"
          icon="clock"
          tone="amber"
          hint={`${pending._count} invoices not yet due`}
        />
        <StatCard
          label="Overdue"
          value={overdue._sum.balance ?? 0}
          format="money"
          icon="warning"
          tone="red"
          hint={`${overdue._count} invoices past due date`}
        />
        <StatCard
          label="Collection rate"
          value={collection.total ? Math.round((collection.paid / collection.total) * 100) : 0}
          format="percent"
          icon="chart"
          tone="blue"
          hint="This month"
        />
      </div>

      <Suspense fallback={<TableSkeleton />}>
        <FilterBar activeCount={activeFilters}>
          <SearchInput placeholder="Search invoice or resident…" />
          <FilterSelect paramKey="status" placeholder="All statuses" options={STATUS_OPTIONS} />
          <FilterSelect
            paramKey="month"
            placeholder="All months"
            options={months.map((m) => ({
              value: m.periodStart.toISOString().slice(0, 10),
              label: formatMonth(m.periodStart),
            }))}
          />
        </FilterBar>
      </Suspense>

      {invoices.length === 0 ? (
        <EmptyState
          icon="file"
          title={activeFilters ? 'No invoices match these filters' : 'No invoices yet'}
          description={
            activeFilters
              ? 'Try a different month or status.'
              : 'Invoices are generated automatically for every active resident on the 1st of the month. You can also generate them now from the toolbar above.'
          }
        />
      ) : (
        <>
          <TableWrap className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice</TableHead>
                  <TableHead>Resident</TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.map((invoice) => {
                  const overdueDays = daysBetween(invoice.dueDate, today)
                  const theme = themeFor(invoice.property.type)
                  return (
                    <TableRow key={invoice.id}>
                      <TableCell>
                        <p className="font-medium text-slate-800">{invoice.number}</p>
                        <p className="flex items-center gap-1 text-xs text-slate-500">
                          <span className={cn('size-1.5 rounded-full', theme.bgSolid)} />
                          {invoice.property.name}
                        </p>
                      </TableCell>
                      <TableCell>
                        <Link
                          href={`/app/residents/${invoice.resident.id}`}
                          className="text-sm font-medium text-slate-800 hover:text-blue-700"
                        >
                          {invoice.resident.fullName}
                        </Link>
                        <p className="text-xs text-slate-500">
                          {invoice.resident.room
                            ? `Room ${invoice.resident.room.number}`
                            : 'No room'}
                          {invoice.resident.bed ? ` · ${invoice.resident.bed.label}` : ''}
                        </p>
                      </TableCell>
                      <TableCell className="text-sm text-slate-600">
                        {formatMonth(invoice.periodStart)}
                      </TableCell>
                      <TableCell className="text-sm">
                        <span className="text-slate-600">{formatDate(invoice.dueDate)}</span>
                        {invoice.balance > 0 && overdueDays > 0 && (
                          <span className="ml-1.5 text-xs font-medium text-red-600">
                            +{overdueDays}d
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular">
                        {formatMoney(invoice.total)}
                        {invoice.lateFee > 0 && (
                          <span className="block text-[11px] text-amber-600">
                            incl. {formatMoney(invoice.lateFee)} late fee
                          </span>
                        )}
                      </TableCell>
                      <TableCell
                        className={cn(
                          'text-right font-semibold tabular',
                          invoice.balance > 0 ? 'text-red-600' : 'text-emerald-600',
                        )}
                      >
                        {invoice.balance > 0 ? formatMoney(invoice.balance) : 'Paid'}
                      </TableCell>
                      <TableCell>
                        <StatusChip
                          label={INVOICE_STATUS_STYLE[invoice.status].label}
                          chip={INVOICE_STATUS_STYLE[invoice.status].chip}
                        />
                        {invoice.reminderCount > 0 && (
                          <p className="mt-0.5 text-[10px] text-slate-400">
                            {invoice.reminderCount} reminder{invoice.reminderCount > 1 ? 's' : ''} sent
                          </p>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </TableWrap>

          <ul className="space-y-2 md:hidden">
            {invoices.map((invoice) => (
              <li key={invoice.id}>
                <Link
                  href={`/app/residents/${invoice.resident.id}`}
                  className="block rounded-2xl border border-slate-200 bg-white p-4 shadow-card"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-slate-900">
                        {invoice.resident.fullName}
                      </p>
                      <p className="text-xs text-slate-500">
                        {invoice.number} · {formatMonth(invoice.periodStart)}
                      </p>
                    </div>
                    <StatusChip
                      label={INVOICE_STATUS_STYLE[invoice.status].label}
                      chip={INVOICE_STATUS_STYLE[invoice.status].chip}
                    />
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <span className="text-xs text-slate-500">
                      Due {formatDate(invoice.dueDate)}
                    </span>
                    <span
                      className={cn(
                        'font-semibold tabular',
                        invoice.balance > 0 ? 'text-red-600' : 'text-emerald-600',
                      )}
                    >
                      {invoice.balance > 0 ? formatMoney(invoice.balance) : 'Paid'}
                    </span>
                  </div>
                </Link>
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
