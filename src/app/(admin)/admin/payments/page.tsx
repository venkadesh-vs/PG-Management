import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import { requireSuperAdmin } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { INVOICE_STATUS_STYLE, themeFor } from '@/lib/theme'
import { cn, formatDate, formatDateTime, formatMoney, startOfMonth } from '@/lib/utils'
import { PageHeader } from '@/components/app/page-header'
import { StatCard } from '@/components/app/stat-card'
import { Badge, StatusChip } from '@/components/ui/badge'
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/primitives'
import { FilterBar, FilterSelect, SearchInput } from '@/components/app/filters'
import { MarkPaidButton } from './mark-paid-button'

export const metadata: Metadata = { title: 'Payments' }

export default async function AdminPaymentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  await requireSuperAdmin()
  const params = await searchParams
  const q = params.q?.trim() ?? ''
  const status = params.status

  const [invoices, payments, collectedThisMonth, outstanding, failedCount] = await Promise.all([
    prisma.subscriptionInvoice.findMany({
      where: {
        ...(status ? { status: status as never } : {}),
        ...(q
          ? {
              OR: [
                { number: { contains: q, mode: 'insensitive' } },
                {
                  subscription: {
                    organization: { name: { contains: q, mode: 'insensitive' } },
                  },
                },
              ],
            }
          : {}),
      },
      include: {
        subscription: {
          select: {
            id: true,
            organization: { select: { id: true, name: true } },
            property: { select: { name: true, type: true } },
          },
        },
        payments: { orderBy: { attemptedAt: 'desc' } },
      },
      orderBy: { issueDate: 'desc' },
      take: 60,
    }),
    prisma.subscriptionPayment.findMany({
      include: {
        subscription: {
          select: {
            organization: { select: { id: true, name: true } },
            property: { select: { name: true, type: true } },
          },
        },
      },
      orderBy: { attemptedAt: 'desc' },
      take: 60,
    }),
    prisma.subscriptionPayment.aggregate({
      where: { status: 'SUCCESS', paidAt: { gte: startOfMonth(new Date()) } },
      _sum: { amount: true },
      _count: true,
    }),
    prisma.subscriptionInvoice.aggregate({
      where: { status: { not: 'PAID' } },
      _sum: { total: true, amountPaid: true },
      _count: true,
    }),
    prisma.subscriptionPayment.count({ where: { status: 'FAILED' } }),
  ])

  const owed = (outstanding._sum.total ?? 0) - (outstanding._sum.amountPaid ?? 0)
  const activeFilters = [q, status].filter(Boolean).length

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payments"
        subtitle="Subscription invoices and every AutoPay attempt across the platform."
        icon="card"
        breadcrumbs={[{ label: 'Platform', href: '/admin' }, { label: 'Payments' }]}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Collected this month"
          value={collectedThisMonth._sum.amount ?? 0}
          format="money"
          icon="money"
          tone="emerald"
          hint={`${collectedThisMonth._count} payments`}
        />
        <StatCard
          label="Outstanding"
          value={owed}
          format="money"
          icon="warning"
          tone={owed > 0 ? 'amber' : 'emerald'}
          hint={`${outstanding._count} unpaid invoices`}
        />
        <StatCard label="Failed attempts" value={failedCount} icon="card" tone={failedCount ? 'red' : 'emerald'} />
        <StatCard label="Invoices raised" value={invoices.length} icon="receipt" tone="blue" hint="Most recent 60" />
      </div>

      <Tabs defaultValue="invoices">
        <TabsList>
          <TabsTrigger value="invoices">Invoices</TabsTrigger>
          <TabsTrigger value="attempts">Payment attempts</TabsTrigger>
        </TabsList>

        <TabsContent value="invoices">
          <Suspense fallback={<TableSkeleton />}>
            <FilterBar activeCount={activeFilters}>
              <SearchInput placeholder="Search invoice or organization…" />
              <FilterSelect
                paramKey="status"
                placeholder="All statuses"
                options={[
                  { value: 'PENDING', label: 'Pending' },
                  { value: 'OVERDUE', label: 'Overdue' },
                  { value: 'PAID', label: 'Paid' },
                ]}
              />
            </FilterBar>
          </Suspense>

          {invoices.length === 0 ? (
            <EmptyState icon="receipt" title="No invoices" description="Subscription invoices appear here once billing runs." />
          ) : (
            <TableWrap className="mt-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice</TableHead>
                    <TableHead>Organization</TableHead>
                    <TableHead>PG</TableHead>
                    <TableHead>Due</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoices.map((invoice) => {
                    const theme = themeFor(invoice.subscription.property.type)
                    const failed = invoice.payments.some((p) => p.status === 'FAILED')
                    return (
                      <TableRow key={invoice.id}>
                        <TableCell className="font-mono text-sm">{invoice.number}</TableCell>
                        <TableCell>
                          <Link
                            href={`/admin/organizations/${invoice.subscription.organization.id}`}
                            className="text-sm text-slate-700 hover:text-blue-700"
                          >
                            {invoice.subscription.organization.name}
                          </Link>
                        </TableCell>
                        <TableCell>
                          <span className="flex items-center gap-1.5 text-sm text-slate-600">
                            <span className={cn('size-1.5 rounded-full', theme.bgSolid)} />
                            {invoice.subscription.property.name}
                          </span>
                        </TableCell>
                        <TableCell className="text-sm text-slate-600">
                          {formatDate(invoice.dueDate)}
                        </TableCell>
                        <TableCell className="text-right font-semibold tabular">
                          {formatMoney(invoice.total)}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <StatusChip
                              label={INVOICE_STATUS_STYLE[invoice.status].label}
                              chip={INVOICE_STATUS_STYLE[invoice.status].chip}
                            />
                            {failed && (
                              <Badge variant="danger" size="sm">
                                Attempt failed
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          {invoice.status !== 'PAID' && (
                            <MarkPaidButton
                              invoiceId={invoice.id}
                              number={invoice.number}
                              amount={invoice.total - invoice.amountPaid}
                            />
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </TableWrap>
          )}
        </TabsContent>

        <TabsContent value="attempts">
          {payments.length === 0 ? (
            <EmptyState icon="card" title="No payment attempts yet" description="AutoPay attempts appear here." />
          ) : (
            <TableWrap>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Organization</TableHead>
                    <TableHead>PG</TableHead>
                    <TableHead>Attempted</TableHead>
                    <TableHead>Method</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Result</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payments.map((payment) => {
                    const theme = themeFor(payment.subscription.property.type)
                    return (
                      <TableRow key={payment.id}>
                        <TableCell>
                          <Link
                            href={`/admin/organizations/${payment.subscription.organization.id}`}
                            className="text-sm text-slate-700 hover:text-blue-700"
                          >
                            {payment.subscription.organization.name}
                          </Link>
                        </TableCell>
                        <TableCell>
                          <span className="flex items-center gap-1.5 text-sm text-slate-600">
                            <span className={cn('size-1.5 rounded-full', theme.bgSolid)} />
                            {payment.subscription.property.name}
                          </span>
                        </TableCell>
                        <TableCell className="text-sm text-slate-600">
                          {formatDateTime(payment.attemptedAt)}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" size="sm" className="capitalize">
                            {payment.method.replace('_', ' ').toLowerCase()}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-semibold tabular">
                          {formatMoney(payment.amount)}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Badge
                              variant={payment.status === 'SUCCESS' ? 'success' : 'danger'}
                              size="sm"
                            >
                              {payment.status.toLowerCase()}
                            </Badge>
                            {payment.isDemo && (
                              <Badge variant="warning" size="sm">
                                Demo
                              </Badge>
                            )}
                          </div>
                          {payment.failureReason && (
                            <p className="mt-0.5 text-[11px] text-red-600">
                              {payment.failureReason}
                            </p>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </TableWrap>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
