import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import { requireSuperAdmin } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { SUBSCRIPTION_STATUS_STYLE, themeFor } from '@/lib/theme'
import { cn, formatDate, formatMoney, percent } from '@/lib/utils'
import { PageHeader } from '@/components/app/page-header'
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

export const metadata: Metadata = { title: 'PG Properties' }

const PAGE_SIZE = 25

export default async function AdminPropertiesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  await requireSuperAdmin()
  const params = await searchParams

  const page = Math.max(1, Number(params.page) || 1)
  const q = params.q?.trim() ?? ''
  const type = params.type

  const where = {
    archivedAt: null,
    ...(type ? { type: type as never } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: 'insensitive' as const } },
            { city: { contains: q, mode: 'insensitive' as const } },
            { organization: { name: { contains: q, mode: 'insensitive' as const } } },
          ],
        }
      : {}),
  }

  const [properties, total, byType, bedStats] = await Promise.all([
    prisma.property.findMany({
      where,
      include: {
        organization: { select: { id: true, name: true, status: true } },
        subscription: { select: { amount: true, status: true } },
        _count: { select: { residents: true, rooms: true } },
        beds: { select: { status: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.property.count({ where }),
    prisma.property.groupBy({
      by: ['type'],
      where: { archivedAt: null },
      _count: { _all: true },
    }),
    prisma.bed.groupBy({ by: ['status'], _count: { _all: true } }),
  ])

  const countType = (t: string) => byType.find((b) => b.type === t)?._count._all ?? 0
  const totalBeds = bedStats.reduce((s, b) => s + b._count._all, 0)
  const occupiedBeds = bedStats.find((b) => b.status === 'OCCUPIED')?._count._all ?? 0
  const activeFilters = [q, type].filter(Boolean).length

  return (
    <div className="space-y-6">
      <PageHeader
        title="PG properties"
        subtitle="Every property running on StayFlow, across all accounts."
        icon="door"
        breadcrumbs={[{ label: 'Platform', href: '/admin' }, { label: 'PG Properties' }]}
      />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard label="Total PGs" value={total} icon="building" />
        <StatCard label="Men's PGs" value={countType('MENS')} icon="users" />
        <StatCard label="Women's PGs" value={countType('WOMENS')} icon="users" />
        <StatCard
          label="Beds under management"
          value={totalBeds}
          icon="bed"
          hint={`${percent(occupiedBeds, totalBeds)}% occupied`}
        />
      </div>

      <Suspense fallback={<TableSkeleton />}>
        <FilterBar activeCount={activeFilters}>
          <SearchInput placeholder="Search PG, city or organization…" />
          <FilterSelect
            paramKey="type"
            placeholder="All types"
            options={[
              { value: 'MENS', label: "Men's PG" },
              { value: 'WOMENS', label: "Women's PG" },
              { value: 'COLIVE', label: 'Co-living' },
            ]}
          />
        </FilterBar>
      </Suspense>

      {properties.length === 0 ? (
        <EmptyState
          icon="building"
          title={activeFilters ? 'Nothing matches these filters' : 'No properties yet'}
          description="PGs created by owner accounts appear here."
        />
      ) : (
        <>
          {/* Desktop table */}
          <TableWrap className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>PG</TableHead>
                  <TableHead>Organization</TableHead>
                  <TableHead className="text-right">Rooms</TableHead>
                  <TableHead className="text-right">Beds</TableHead>
                  <TableHead className="text-right">Occupancy</TableHead>
                  <TableHead className="text-right">Subscription</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {properties.map((property) => {
                  const theme = themeFor(property.type)
                  const beds = property.beds.length
                  const occupied = property.beds.filter((b) => b.status === 'OCCUPIED').length
                  return (
                    <TableRow key={property.id}>
                      <TableCell>
                        <span className="flex items-center gap-2">
                          <span className={cn('size-2 shrink-0 rounded-full', theme.bgSolid)} />
                          <span className="min-w-0">
                            <span className="block truncate font-medium text-slate-900">
                              {property.name}
                            </span>
                            <span className="block text-xs text-slate-500">
                              {property.city} · since {formatDate(property.createdAt)}
                            </span>
                          </span>
                        </span>
                      </TableCell>
                      <TableCell>
                        <Link
                          href={`/admin/organizations/${property.organization.id}`}
                          className="text-sm text-slate-700 hover:text-blue-700"
                        >
                          {property.organization.name}
                        </Link>
                      </TableCell>
                      <TableCell className="text-right tabular">{property._count.rooms}</TableCell>
                      <TableCell className="text-right tabular">{beds}</TableCell>
                      <TableCell className="text-right tabular">
                        {percent(occupied, beds)}%
                        <span className="block text-[11px] text-slate-400">
                          {occupied}/{beds}
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular">
                        {property.subscription ? formatMoney(property.subscription.amount) : '—'}
                      </TableCell>
                      <TableCell>
                        {property.subscription ? (
                          <StatusChip
                            label={SUBSCRIPTION_STATUS_STYLE[property.subscription.status].label}
                            chip={SUBSCRIPTION_STATUS_STYLE[property.subscription.status].chip}
                          />
                        ) : (
                          <span className="text-xs text-slate-400">No subscription</span>
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
            {properties.map((property) => {
              const theme = themeFor(property.type)
              const beds = property.beds.length
              const occupied = property.beds.filter((b) => b.status === 'OCCUPIED').length
              return (
                <li
                  key={property.id}
                  className="rounded-xl border border-slate-200 bg-white p-4 shadow-card"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className={cn('size-2 shrink-0 rounded-full', theme.bgSolid)} />
                      <span className="truncate font-medium text-slate-900">{property.name}</span>
                    </span>
                    {property.subscription ? (
                      <StatusChip
                        label={SUBSCRIPTION_STATUS_STYLE[property.subscription.status].label}
                        chip={SUBSCRIPTION_STATUS_STYLE[property.subscription.status].chip}
                      />
                    ) : (
                      <span className="shrink-0 text-xs text-slate-400">No subscription</span>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-slate-500">
                    <Link
                      href={`/admin/organizations/${property.organization.id}`}
                      className="text-slate-700 hover:text-blue-700"
                    >
                      {property.organization.name}
                    </Link>{' '}
                    · {property.city} · since {formatDate(property.createdAt)}
                  </p>
                  <div className="mt-2 flex items-center justify-between gap-2 text-sm">
                    <span className="text-xs text-slate-500">
                      {property._count.rooms} rooms · {occupied}/{beds} beds ({percent(occupied, beds)}%)
                    </span>
                    <span className="font-semibold tabular">
                      {property.subscription ? formatMoney(property.subscription.amount) : '—'}
                    </span>
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
