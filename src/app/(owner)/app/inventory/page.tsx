import type { Metadata } from 'next'
import { Suspense } from 'react'
import { requireAccess } from '@/lib/auth'
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
import { QuickForm, type QuickField } from '@/components/app/quick-form'
import { RowActions } from '@/components/app/row-actions'
import { ASSET_STATUS_LABEL, ASSET_STATUSES, type AssetStatus } from '@/lib/checkout-checklist'
import { placementOf } from '@/server/services/assets'

export const metadata: Metadata = { title: 'Inventory' }

const PAGE_SIZE = 30

const STATUS_VARIANT: Record<AssetStatus, 'success' | 'default' | 'warning' | 'danger'> = {
  IN_USE: 'success',
  IN_STORE: 'default',
  UNDER_REPAIR: 'warning',
  DISPOSED: 'default',
  MISSING: 'danger',
}

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
  const user = await requireAccess({ module: 'inventory', permission: 'inventory.view' })
  const params = await searchParams
  const scope = await resolveScope(user, params.property)
  const propertyIds = scope.propertyId ? [scope.propertyId] : scope.allowedPropertyIds

  const page = Math.max(1, Number(params.page) || 1)
  const q = params.q?.trim() ?? ''
  const category = params.category
  const condition = params.condition
  const status = (ASSET_STATUSES as readonly string[]).includes(params.status ?? '') ? params.status : undefined
  // Location filter: 'floor:<id>' or 'room:<id>' (a room also covers its beds).
  const [placeKind, placeId] = (params.place ?? '').split(':')

  const where = {
    organizationId: scope.organizationId,
    propertyId: { in: propertyIds },
    ...(category ? { category } : {}),
    ...(condition ? { condition: condition as never } : {}),
    ...(status ? { status } : {}),
    ...(placeKind === 'floor' && placeId ? { floorId: placeId } : {}),
    ...(placeKind === 'room' && placeId ? { roomId: placeId } : {}),
    ...(q ? { name: { contains: q, mode: 'insensitive' as const } } : {}),
  }

  const [assets, total, categories, valueAgg, needsRepair, rooms, properties, floors, beds] = await Promise.all([
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
        OR: [{ condition: { in: ['NEEDS_REPAIR', 'DAMAGED'] } }, { status: { in: ['UNDER_REPAIR', 'MISSING'] } }],
      },
    }),
    prisma.room.findMany({
      where: { propertyId: { in: propertyIds } },
      select: { id: true, number: true, propertyId: true, floorId: true },
      orderBy: { number: 'asc' },
    }),
    prisma.property.findMany({
      where: { id: { in: propertyIds } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    prisma.floor.findMany({
      where: { propertyId: { in: propertyIds } },
      select: { id: true, name: true, propertyId: true },
      orderBy: [{ propertyId: 'asc' }, { level: 'asc' }],
    }),
    prisma.bed.findMany({
      where: { propertyId: { in: propertyIds } },
      select: { id: true, label: true, roomId: true, propertyId: true },
      orderBy: { label: 'asc' },
    }),
  ])

  const floorName = new Map(floors.map((f) => [f.id, f.name]))
  const roomNumber = new Map(rooms.map((r) => [r.id, r.number]))
  const bedLabel = new Map(beds.map((b) => [b.id, b.label]))
  const multiPg = properties.length > 1
  const pgName = new Map(properties.map((p) => [p.id, p.name]))
  /** Every place an item can sit in a PG, for the add / edit select. */
  const placementOptions = (propertyId?: string) => {
    const options: { value: string; label: string }[] = [{ value: '', label: 'Whole PG / common area' }]
    for (const f of floors.filter((x) => !propertyId || x.propertyId === propertyId)) {
      const prefix = multiPg && !propertyId ? `${pgName.get(f.propertyId)} · ` : ''
      options.push({ value: `floor:${f.id}`, label: `${prefix}${f.name}` })
      for (const r of rooms.filter((x) => x.floorId === f.id)) {
        options.push({ value: `room:${r.id}`, label: `${prefix}Room ${r.number}` })
        for (const b of beds.filter((x) => x.roomId === r.id)) {
          options.push({ value: `bed:${b.id}`, label: `${prefix}Room ${r.number} · Bed ${b.label}` })
        }
      }
    }
    return options
  }
  const whereLabel = (asset: (typeof assets)[number]) =>
    asset.bedId && asset.roomId
      ? `Room ${roomNumber.get(asset.roomId) ?? asset.room?.number} · Bed ${bedLabel.get(asset.bedId) ?? '?'}`
      : asset.room
        ? `Room ${asset.room.number}`
        : asset.floorId
          ? (floorName.get(asset.floorId) ?? 'Floor')
          : (asset.location ?? asset.property.name)

  const canManage = user.permissions.includes('inventory.manage')
  const actionsFor = (asset: (typeof assets)[number]) =>
    canManage ? (
      <RowActions
        label={asset.name}
        edit={{
          title: `Edit ${asset.name}`,
          description: `${asset.property.name}. To retire an item but keep its record, set its condition to Disposed.`,
          endpoint: `/api/assets/${asset.id}`,
          successTitle: 'Item updated',
          fields: assetEditFields(asset, placementOptions(asset.propertyId)),
        }}
        remove={{
          title: `Delete ${asset.name}?`,
          description:
            'Use this for items entered by mistake. To retire a real item and keep its cost on file, edit it and set the condition to Disposed instead.',
          endpoint: `/api/assets/${asset.id}`,
          successTitle: 'Item deleted',
        }}
      />
    ) : null

  const activeFilters = [q, category, condition, status, params.place].filter(Boolean).length

  return (
    <div className="space-y-6">
      <PageHeader
        title="Inventory"
        subtitle="Cots, mattresses, fans, appliances — what you own, where it is and what condition it is in."
        icon="boxes"
        breadcrumbs={[{ label: 'Dashboard', href: '/app' }, { label: 'Inventory' }]}
        actions={
          user.permissions.includes('inventory.manage') && (
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
                name: 'placement',
                label: 'Where',
                half: true,
                hint: 'Floor, room or a specific bed',
                options: placementOptions(scope.propertyId ?? (properties.length === 1 ? properties[0].id : undefined)),
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
              { kind: 'number', name: 'currentValue', label: 'Current value', half: true, hint: 'Used for damage at checkout' },
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
          )
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
          <FilterSelect
            paramKey="status"
            placeholder="Any status"
            options={ASSET_STATUSES.map((value) => ({ value, label: ASSET_STATUS_LABEL[value] }))}
          />
          <FilterSelect
            paramKey="place"
            placeholder="Anywhere"
            options={[
              ...floors.map((f) => ({ value: `floor:${f.id}`, label: `${multiPg ? `${pgName.get(f.propertyId)} · ` : ''}${f.name}` })),
              ...rooms.map((r) => ({ value: `room:${r.id}`, label: `${multiPg ? `${pgName.get(r.propertyId)} · ` : ''}Room ${r.number}` })),
            ]}
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
                  {canManage && <TableHead className="w-10" />}
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
                          {whereLabel(asset)}
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular">{asset.quantity}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          <Badge variant={style.variant} size="sm">
                            {style.label}
                          </Badge>
                          {asset.status !== 'IN_USE' && (
                            <Badge variant={STATUS_VARIANT[asset.status as AssetStatus] ?? 'default'} size="sm">
                              {ASSET_STATUS_LABEL[asset.status as AssetStatus] ?? asset.status}
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular">
                        {formatMoney(asset.purchaseCost)}
                      </TableCell>
                      <TableCell className="text-sm text-slate-600">
                        {formatDate(asset.purchaseDate)}
                      </TableCell>
                      {canManage && <TableCell className="w-10">{actionsFor(asset)}</TableCell>}
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
                    <div className="flex shrink-0 items-center gap-1">
                      {asset.status !== 'IN_USE' && (
                        <Badge variant={STATUS_VARIANT[asset.status as AssetStatus] ?? 'default'} size="sm">
                          {ASSET_STATUS_LABEL[asset.status as AssetStatus] ?? asset.status}
                        </Badge>
                      )}
                      <Badge variant={style.variant} size="sm">
                        {style.label}
                      </Badge>
                      {actionsFor(asset)}
                    </div>
                  </div>
                  <p className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500">
                    <span className={cn('size-1.5 shrink-0 rounded-full', theme.bgSolid)} />
                    <span className="truncate">
                      {asset.category} · {whereLabel(asset)}
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

/** The add-item fields, prefilled from an existing item (PG fixed). */
function assetEditFields(
  asset: {
    floorId: string | null
    roomId: string | null
    bedId: string | null
    name: string
    category: string
    quantity: number
    condition: string
    status: string
    location: string | null
    purchaseDate: Date | null
    purchaseCost: number
    currentValue: number | null
    serialNumber: string | null
    notes: string | null
  },
  placements: { value: string; label: string }[],
): QuickField[] {
  return [
    {
      kind: 'select',
      name: 'placement',
      label: 'Where',
      half: true,
      defaultValue: placementOf(asset),
      options: placements,
    },
    { kind: 'text', name: 'location', label: 'Location note', half: true, defaultValue: asset.location ?? '' },
    { kind: 'text', name: 'name', label: 'Item name', required: true, half: true, defaultValue: asset.name },
    { kind: 'text', name: 'category', label: 'Category', required: true, half: true, defaultValue: asset.category },
    { kind: 'number', name: 'quantity', label: 'Quantity', required: true, half: true, defaultValue: asset.quantity },
    {
      kind: 'select',
      name: 'condition',
      label: 'Condition',
      required: true,
      half: true,
      defaultValue: asset.condition,
      options: Object.entries(CONDITION_STYLE).map(([value, meta]) => ({ value, label: meta.label })),
    },
    {
      kind: 'select',
      name: 'status',
      label: 'Status',
      required: true,
      half: true,
      defaultValue: asset.status,
      options: ASSET_STATUSES.map((value) => ({ value, label: ASSET_STATUS_LABEL[value] })),
    },
    { kind: 'number', name: 'currentValue', label: 'Current value', half: true, defaultValue: asset.currentValue ?? '' },
    { kind: 'number', name: 'purchaseCost', label: 'Purchase cost', half: true, defaultValue: asset.purchaseCost },
    {
      kind: 'date',
      name: 'purchaseDate',
      label: 'Purchase date',
      half: true,
      defaultValue: asset.purchaseDate ? toISODate(asset.purchaseDate) : '',
    },
    { kind: 'text', name: 'serialNumber', label: 'Serial number', defaultValue: asset.serialNumber ?? '' },
    { kind: 'textarea', name: 'notes', label: 'Notes', rows: 2, defaultValue: asset.notes ?? '' },
  ]
}
