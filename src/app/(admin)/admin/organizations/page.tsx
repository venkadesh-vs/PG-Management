import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import { requireSuperAdmin } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import {
  formatDate,
  formatMoney,
  formatPhone,
  relativeTime,
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

export const metadata: Metadata = { title: 'Organizations' }

const PAGE_SIZE = 20

const STATUS_VARIANT: Record<string, 'success' | 'info' | 'warning' | 'danger' | 'default'> = {
  ACTIVE: 'success',
  TRIAL: 'info',
  PAST_DUE: 'warning',
  SUSPENDED: 'danger',
  CANCELLED: 'default',
}

export default async function OrganizationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  await requireSuperAdmin()
  const params = await searchParams

  const page = Math.max(1, Number(params.page) || 1)
  const q = params.q?.trim() ?? ''
  const status = params.status

  const where = {
    archivedAt: null,
    ...(status ? { status: status as never } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: 'insensitive' as const } },
            { ownerName: { contains: q, mode: 'insensitive' as const } },
            { contactEmail: { contains: q, mode: 'insensitive' as const } },
            { contactPhone: { contains: q } },
            { city: { contains: q, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  }

  const [organizations, total, counts, totals] = await Promise.all([
    prisma.organization.findMany({
      where,
      include: {
        _count: { select: { properties: true, residents: true, users: true } },
        subscriptions: { select: { amount: true, status: true, nextBillingDate: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.organization.count({ where }),
    prisma.organization.groupBy({
      by: ['status'],
      where: { archivedAt: null },
      _count: { _all: true },
    }),
    prisma.subscription.aggregate({
      where: { status: 'ACTIVE' },
      _sum: { amount: true },
      _count: true,
    }),
  ])

  const countFor = (s: string) => counts.find((c) => c.status === s)?._count._all ?? 0
  const activeFilters = [q, status].filter(Boolean).length

  return (
    <div className="space-y-6">
      <PageHeader
        title="Organizations"
        subtitle="Every PG owner account on the platform, with their PGs, residents and subscription."
        icon="building"
        breadcrumbs={[{ label: 'Platform', href: '/admin' }, { label: 'Organizations' }]}
      />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard label="Total accounts" value={total} icon="building" tone="blue" />
        <StatCard label="Active" value={countFor('ACTIVE')} icon="check" tone="emerald" />
        <StatCard label="On trial" value={countFor('TRIAL')} icon="clock" tone="violet" />
        <StatCard
          label="Combined MRR"
          value={totals._sum.amount ?? 0}
          format="money"
          icon="sparkles"
          tone="amber"
          hint={`${totals._count} active subscriptions`}
        />
      </div>

      <Suspense fallback={<TableSkeleton />}>
        <FilterBar activeCount={activeFilters}>
          <SearchInput placeholder="Search name, owner, email or city…" />
          <FilterSelect
            paramKey="status"
            placeholder="All statuses"
            options={[
              { value: 'ACTIVE', label: 'Active' },
              { value: 'TRIAL', label: 'Trial' },
              { value: 'PAST_DUE', label: 'Past due' },
              { value: 'SUSPENDED', label: 'Suspended' },
              { value: 'CANCELLED', label: 'Cancelled' },
            ]}
          />
        </FilterBar>
      </Suspense>

      {organizations.length === 0 ? (
        <EmptyState
          icon="building"
          title={activeFilters ? 'Nothing matches these filters' : 'No organizations yet'}
          description="Accounts created from converted leads appear here."
        />
      ) : (
        <>
          {/* Desktop table */}
          <TableWrap className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Organization</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead className="text-right">PGs</TableHead>
                  <TableHead className="text-right">Residents</TableHead>
                  <TableHead className="text-right">MRR</TableHead>
                  <TableHead>Next billing</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {organizations.map((org) => {
                  const mrr = org.subscriptions
                    .filter((s) => s.status === 'ACTIVE')
                    .reduce((s, sub) => s + sub.amount, 0)
                  const nextBilling = org.subscriptions
                    .map((s) => s.nextBillingDate)
                    .sort((a, b) => a.getTime() - b.getTime())[0]

                  return (
                    <TableRow key={org.id}>
                      <TableCell>
                        <Link
                          href={`/admin/organizations/${org.id}`}
                          className="font-medium text-slate-900 hover:text-blue-700"
                        >
                          {org.name}
                        </Link>
                        <p className="text-xs text-slate-500">
                          {org.city ?? '—'} · joined {formatDate(org.createdAt)}
                        </p>
                      </TableCell>
                      <TableCell>
                        <p className="text-sm text-slate-700">{org.ownerName}</p>
                        <p className="text-xs text-slate-500">{formatPhone(org.contactPhone)}</p>
                      </TableCell>
                      <TableCell className="text-right tabular">{org._count.properties}</TableCell>
                      <TableCell className="text-right tabular">{org._count.residents}</TableCell>
                      <TableCell className="text-right font-semibold tabular">
                        {mrr > 0 ? formatMoney(mrr) : '—'}
                      </TableCell>
                      <TableCell className="text-sm text-slate-600">
                        {nextBilling ? formatDate(nextBilling) : '—'}
                      </TableCell>
                      <TableCell>
                        <Badge variant={STATUS_VARIANT[org.status] ?? 'default'} size="sm">
                          {org.status.replace('_', ' ').toLowerCase()}
                        </Badge>
                        {org.trialEndsAt && org.status === 'TRIAL' && (
                          <p className="mt-0.5 text-[10px] text-slate-400">
                            ends {relativeTime(org.trialEndsAt)}
                          </p>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </TableWrap>

          {/* Mobile cards */}
          <ul className="space-y-2 md:hidden">
            {organizations.map((org) => {
              const mrr = org.subscriptions
                .filter((s) => s.status === 'ACTIVE')
                .reduce((s, sub) => s + sub.amount, 0)
              const nextBilling = org.subscriptions
                .map((s) => s.nextBillingDate)
                .sort((a, b) => a.getTime() - b.getTime())[0]

              return (
                <li key={org.id}>
                  <Link
                    href={`/admin/organizations/${org.id}`}
                    className="block rounded-2xl border border-slate-200 bg-white p-4 shadow-card"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="truncate font-medium text-slate-900">{org.name}</p>
                      <Badge variant={STATUS_VARIANT[org.status] ?? 'default'} size="sm">
                        {org.status.replace('_', ' ').toLowerCase()}
                      </Badge>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-slate-500">
                      {org.ownerName} · {formatPhone(org.contactPhone)}
                    </p>
                    <p className="text-xs text-slate-500">
                      {org.city ?? '—'} · {org._count.properties} PGs · {org._count.residents} residents
                      {org.trialEndsAt && org.status === 'TRIAL'
                        ? ` · trial ends ${relativeTime(org.trialEndsAt)}`
                        : ''}
                    </p>
                    <div className="mt-2 flex items-center justify-between gap-2 text-sm">
                      <span className="text-xs text-slate-500">
                        Next billing {nextBilling ? formatDate(nextBilling) : '—'}
                      </span>
                      <span className="font-semibold tabular">
                        {mrr > 0 ? `${formatMoney(mrr)}/mo` : '—'}
                      </span>
                    </div>
                  </Link>
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
