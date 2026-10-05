import type { Metadata } from 'next'
import { Suspense } from 'react'
import { requireOrgUser } from '@/lib/auth'
import { resolveScope } from '@/lib/tenancy'
import { prisma } from '@/lib/prisma'
import { themeFor } from '@/lib/theme'
import { cn, formatDate, formatMoney, toISODate } from '@/lib/utils'
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
import { QuickForm } from '@/components/app/quick-form'

export const metadata: Metadata = { title: 'Inventory' }

const PAGE_SIZE = 30

const CONDITION_STYLE: Record<string, { label: string; variant: 'success' | 'default' | 'warning' | 'danger' }> = {
  NEW: { label: 'New', variant: 'success' },
  GOOD: { label: 'Good', variant: 'success' },
  FAIR: { label: 'Fair', variant: 'default' },
  NEEDS_REPAIR: { label: 'Needs repair', variant: 'warning' },
  DAMAGED: { label: 'Damaged', variant: 'danger' },
  DISPOSED: { label: 'Disposed', variant: 'default' },
}

export default async function InventoryPage({
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
  const category = params.category
  const condition = params.condition

  const where = {
    organizationId: scope.organizationId,
    propertyId: { in: propertyIds },
    ...(category ? { category } : {}),
    ...(condition ? { condition: condition as never } : {}),
    ...(q ? { name: { contains: q, mode: 'insensitive' as const } } : {}),
  }

  const [assets, total, categories, valueAgg, needsRepair, rooms, properties] = await Promise.all([
    prisma.asset.findMany({
      where,
      include: {
        property: { select: { name: true, type: true } },
        room: { select: { number: true } },
      },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.asset.count({ where }),
    prisma.asset.groupBy({
      by: ['category'],
      where: { organizationId: scope.organizationId, propertyId: { in: propertyIds } },
      _count: { _all: true },
      _sum: { quantity: true },
    }),
    prisma.asset.aggregate({
      where: { organizationId: scope.organizationId, propertyId: { in: propertyIds } },
      _sum: { purchaseCost: true, quantity: true },
    }),
    prisma.asset.count({
      where: {
        organizationId: scope.organizationId,
        propertyId: { in: propertyIds },
        condition: { in: ['NEEDS_REPAIR', 'DAMAGED'] },
      },
    }),
    prisma.room.findMany({
      where: { propertyId: { in: propertyIds } },
      select: { id: true, number: true, propertyId: true },
      orderBy: { number: 'asc' },
    }),
    prisma.property.findMany({
      where: { id: { in: propertyIds } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
  ])

  const activeFilters = [q, category, condition].filter(Boolean).length

  return (
    <div className="space-y-6">
      <PageHeader
        title="Inventory"
        subtitle="Cots, mattresses, fans, appliances — what you own, where it is and what condition it is in."
        icon="boxes"
        breadcrumbs={[{ label: 'Dashboard', href: '/app' }, { label: 'Inventory' }]}
        actions={
          <QuickForm
            trigger="Add item"
            title="Add an inventory item"
            description="Track it against a PG, and a room where it belongs to one."
            endpoint="/api/operations"
            payload={{ entity: 'ASSET' }}
            successTitle="Item added to inventory"
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
                name: 'roomId',
                label: 'Room',
                half: true,
                options: rooms.map((r) => ({ value: r.id, label: `Room ${r.number}` })),
              },
              { kind: 'text', name: 'name', label: 'Item name', required: true, half: true, placeholder: 'Ceiling fan' },
              { kind: 'text', name: 'category', label: 'Category', required: true, half: true, placeholder: 'Electrical' },
              { kind: 'number', name: 'quantity', label: 'Quantity', half: true, defaultValue: 1 },
              {
                kind: 'select',
                name: 'condition',
                label: 'Condition',
                half: true,
                defaultValue: 'GOOD',
                options: Object.entries(CONDITION_STYLE).map(([value, meta]) => ({
                  value,
                  label: meta.label,
                })),
              },
              { kind: 'number', name: 'purchaseCost', label: 'Purchase cost', half: true },
              {
                kind: 'date',
                name: 'purchaseDate',
                label: 'Purchase date',
                half: true,
                defaultValue: toISODate(new Date()),
              },
              { kind: 'text', name: 'location', label: 'Location', placeholder: 'Common area' },
              { kind: 'textarea', name: 'notes', label: 'Notes', rows: 2 },
            ]}
          />
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard label="Item types" value={total} icon="boxes" tone="blue" />
        <StatCard
          label="Total units"
          value={valueAgg._sum.quantity ?? 0}
          icon="clipboard"
          tone="violet"
        />
        <StatCard
          label="Asset value"
          value={valueAgg._sum.purchaseCost ?? 0}
          format="money"
          icon="wallet"
          tone="emerald"
          hint="At purchase cost"
        />
        <StatCard
          label="Needs attention"
          value={needsRepair}
          icon="warning"
          tone={needsRepair > 0 ? 'amber' : 'emerald'}
          hint="Damaged or needing repair"
        />
      </div>

      <Suspense fallback={<TableSkeleton />}>
        <FilterBar activeCount={activeFilters}>
          <SearchInput placeholder="Search item…" />
          <FilterSelect
            paramKey="category"
            placeholder="All categories"
            options={categories.map((c) => ({
              value: c.category,
              label: `${c.category} (${c._count._all})`,
            }))}
          />
          <FilterSelect
            paramKey="condition"
            placeholder="Any condition"
            options={Object.entries(CONDITION_STYLE).map(([value, meta]) => ({
              value,
              label: meta.label,
            }))}
          />
        </FilterBar>
      </Suspense>

      {assets.length === 0 ? (
        <EmptyState
          icon="boxes"
          title={activeFilters ? 'Nothing matches these filters' : 'Inventory is empty'}
          description="Record the cots, mattresses, fans and appliances in each room so replacements and damages are traceable."
        />
      ) : (
        <>
          {/* Desktop table */}
          <TableWrap className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Where</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead>Condition</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead>Bought</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {assets.map((asset) => {
                  const theme = themeFor(asset.property.type)
                  const style = CONDITION_STYLE[asset.condition]
                  return (
                    <TableRow key={asset.id}>
                      <TableCell className="font-medium text-slate-800">{asset.name}</TableCell>
                      <TableCell>
                        <Badge variant="outline" size="sm">
                          {asset.category}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <span className="flex items-center gap-1.5 text-sm text-slate-600">
                          <span className={cn('size-1.5 rounded-full', theme.bgSolid)} />
                          {asset.room ? `Room ${asset.room.number}` : (asset.location ?? asset.property.name)}
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular">{asset.quantity}</TableCell>
                      <TableCell>
                        <Badge variant={style.variant} size="sm">
                          {style.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right tabular">
                        {formatMoney(asset.purchaseCost)}
                      </TableCell>
                      <TableCell className="text-sm text-slate-600">
                        {formatDate(asset.purchaseDate)}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </TableWrap>

          {/* Mobile cards */}
          <ul className="space-y-2 md:hidden">
            {assets.map((asset) => {
              const theme = themeFor(asset.property.type)
              const style = CONDITION_STYLE[asset.condition]
              return (
                <li
                  key={asset.id}
                  className="rounded-2xl border border-slate-200 bg-white p-4 shadow-card"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="truncate font-medium text-slate-900">{asset.name}</p>
                    <Badge variant={style.variant} size="sm">
                      {style.label}
                    </Badge>
                  </div>
                  <p className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500">
                    <span className={cn('size-1.5 shrink-0 rounded-full', theme.bgSolid)} />
                    <span className="truncate">
                      {asset.category} ·{' '}
                      {asset.room ? `Room ${asset.room.number}` : (asset.location ?? asset.property.name)}
                    </span>
                  </p>
                  <div className="mt-2 flex items-center justify-between gap-2 text-sm">
                    <span className="text-xs text-slate-500">
                      Qty {asset.quantity} · {formatDate(asset.purchaseDate)}
                    </span>
                    <span className="font-semibold text-slate-800 tabular">
                      {formatMoney(asset.purchaseCost)}
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
