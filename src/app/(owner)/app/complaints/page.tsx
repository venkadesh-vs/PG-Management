import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import type { ComplaintStatus, Prisma } from '@prisma/client'
import { requireAccess } from '@/lib/auth'
import { getLookup, getLookupLabels } from '@/server/services/org-defaults'
import { hasPermission, resolveScope } from '@/lib/tenancy'
import { prisma } from '@/lib/prisma'
import { COMPLAINT_STATUS_STYLE, PRIORITY_STYLE, themeFor } from '@/lib/theme'
import { cn, relativeTime } from '@/lib/utils'
import { PageHeader } from '@/components/app/page-header'
import { StatCard, StatGrid } from '@/components/app/stat-card'
import { StatusChip } from '@/components/ui/badge'
import { EmptyState, TableSkeleton } from '@/components/ui/feedback'
import { FilterBar, FilterSelect, Pagination, SearchInput } from '@/components/app/filters'
import { NewComplaintButton } from './new-complaint'
import { SlaChip } from '@/components/app/sla-chip'
import { CategoryTile } from './category-icon'
import { refreshSlaBreaches } from '@/server/services/complaints'
import { ExportButton } from '@/components/app/export-button'

export const metadata: Metadata = { title: 'Complaints' }

const PAGE_SIZE = 20

const STATUS_OPTIONS = [
  { value: 'OPEN', label: 'Open' },
  { value: 'ASSIGNED', label: 'Assigned' },
  { value: 'IN_PROGRESS', label: 'In progress' },
  { value: 'ON_HOLD', label: 'On hold' },
  { value: 'RESOLVED', label: 'Resolved' },
  { value: 'CLOSED', label: 'Closed' },
]

export default async function ComplaintsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const user = await requireAccess({ module: 'complaints', permission: 'complaints.view' })
  const canExport = hasPermission(user, 'reports.export')
  const params = await searchParams
  const scope = await resolveScope(user, params.property)
  const propertyIds = scope.propertyId ? [scope.propertyId] : scope.allowedPropertyIds

  const page = Math.max(1, Number(params.page) || 1)
  const q = params.q?.trim() ?? ''
  const status = params.status as ComplaintStatus | undefined
  const category = params.category
  const priority = params.priority
  const sla = params.sla
  const sort = params.sort

  // On-read SLA check: flag anything that slipped since the daily run.
  await refreshSlaBreaches(scope.organizationId)
  const now = new Date()
  const OPEN: ComplaintStatus[] = ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD']
  const slaWhere: Prisma.ComplaintWhereInput =
    sla === 'breached'
      ? { status: { in: OPEN }, slaDueAt: { lt: now } }
      : sla === 'due_soon'
        ? { status: { in: OPEN }, slaDueAt: { gte: now, lt: new Date(now.getTime() + 2 * 3_600_000) } }
        : sla === 'missed'
          ? { slaBreachedAt: { not: null } }
          : {}

  const where: Prisma.ComplaintWhereInput = {
    organizationId: scope.organizationId,
    propertyId: { in: propertyIds },
    ...(status ? { status } : {}),
    ...(category ? { category } : {}),
    ...(priority ? { priority: priority as never } : {}),
    ...slaWhere,
    ...(q
      ? {
          OR: [
            { code: { contains: q, mode: 'insensitive' } },
            { title: { contains: q, mode: 'insensitive' } },
            { resident: { fullName: { contains: q, mode: 'insensitive' } } },
          ],
        }
      : {}),
  }

  const [complaints, total, counts, resolvedThisMonth, staff, residents, properties, categoryOptions, categoryLabels] =
    await Promise.all([
      prisma.complaint.findMany({
        where,
        include: {
          resident: { select: { id: true, fullName: true } },
          room: { select: { number: true } },
          property: { select: { name: true, type: true } },
          assignedStaff: { select: { id: true, name: true } },
          _count: { select: { updates: true } },
        },
        orderBy:
          sort === 'sla' || sla === 'breached' || sla === 'due_soon'
            ? [{ slaDueAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }]
            : [{ status: 'asc' }, { priority: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
      prisma.complaint.count({ where }),
      prisma.complaint.groupBy({
        by: ['status'],
        where: { organizationId: scope.organizationId, propertyId: { in: propertyIds } },
        _count: { _all: true },
      }),
      prisma.complaint.count({
        where: {
          organizationId: scope.organizationId,
          propertyId: { in: propertyIds },
          resolvedAt: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) },
        },
      }),
      prisma.staff.findMany({
        where: { organizationId: scope.organizationId, active: true },
        select: { id: true, name: true, role: true, propertyId: true },
        orderBy: { name: 'asc' },
      }),
      prisma.resident.findMany({
        where: {
          organizationId: scope.organizationId,
          propertyId: { in: propertyIds },
          status: { in: ['ACTIVE', 'NOTICE'] },
        },
        select: { id: true, fullName: true, propertyId: true, roomId: true },
        orderBy: { fullName: 'asc' },
      }),
      prisma.property.findMany({
        where: { id: { in: propertyIds } },
        select: { id: true, name: true, type: true },
      }),
      getLookup(scope.organizationId, 'COMPLAINT_CATEGORY'),
      getLookupLabels(scope.organizationId, 'COMPLAINT_CATEGORY'),
    ])
  const breachedOpen = await prisma.complaint.count({
    where: {
      organizationId: scope.organizationId,
      propertyId: { in: propertyIds },
      status: { in: OPEN },
      slaDueAt: { lt: now },
    },
  })

  const countFor = (s: string) => counts.find((c) => c.status === s)?._count._all ?? 0
  const open = countFor('OPEN')
  const inProgress = countFor('ASSIGNED') + countFor('IN_PROGRESS')
  const activeFilters = [q, status, category, priority, sla].filter(Boolean).length

  return (
    <div className="space-y-6">
      <PageHeader
        title="Complaints"
        subtitle="Every issue has a clear owner and a visible status — no more scrolling through WhatsApp."
        icon="wrench"
        breadcrumbs={[{ label: 'Dashboard', href: '/app' }, { label: 'Complaints' }]}
        actions={
          <>
            {canExport && (
              <Suspense fallback={null}>
                <ExportButton kind="complaints" />
              </Suspense>
            )}
            {user.permissions.includes('complaints.manage') && (
              <NewComplaintButton
                properties={properties}
                residents={residents}
                categories={categoryOptions}
                defaultPropertyId={scope.propertyId ?? properties[0]?.id}
              />
            )}
          </>
        }
      />

      <StatGrid cols={5}>
        <StatCard label="Open" value={open} icon="warning" tone={open > 0 ? 'red' : 'emerald'} hint="Not yet assigned" />
        <StatCard label="Being worked on" value={inProgress} icon="wrench" tone="amber" hint="Assigned or in progress" />
        <Link href="/app/complaints?sla=breached" className="block">
          <StatCard
            label="SLA breached"
            value={breachedOpen}
            icon="warning"
            tone={breachedOpen > 0 ? 'red' : 'emerald'}
            hint={breachedOpen > 0 ? 'Open and past due — tap to see' : 'Everything on time'}
          />
        </Link>
        <StatCard label="Resolved this month" value={resolvedThisMonth} icon="check" tone="emerald" />
        <StatCard label="Total raised" value={counts.reduce((s, c) => s + c._count._all, 0)} icon="clipboard" hint="All time" />
      </StatGrid>

      <Suspense fallback={<TableSkeleton />}>
        <FilterBar activeCount={activeFilters}>
          <SearchInput placeholder="Search code, title or resident…" />
          <FilterSelect paramKey="status" placeholder="All statuses" options={STATUS_OPTIONS} />
          <FilterSelect paramKey="category" placeholder="All categories" options={categoryOptions} />
          <FilterSelect
            paramKey="priority"
            placeholder="Any priority"
            options={[
              { value: 'URGENT', label: 'Urgent' },
              { value: 'HIGH', label: 'High' },
              { value: 'MEDIUM', label: 'Medium' },
              { value: 'LOW', label: 'Low' },
            ]}
          />
          <FilterSelect
            paramKey="sla"
            placeholder="Any SLA"
            options={[
              { value: 'breached', label: 'SLA breached (open)' },
              { value: 'due_soon', label: 'Due in 2 hours' },
              { value: 'missed', label: 'Ever missed SLA' },
            ]}
          />
          <FilterSelect
            paramKey="sort"
            placeholder="Sort: status & priority"
            options={[{ value: 'sla', label: 'Sort: SLA due first' }]}
          />
        </FilterBar>
      </Suspense>

      {complaints.length === 0 ? (
        <EmptyState
          icon="wrench"
          title={activeFilters ? 'No complaints match these filters' : 'Nothing to fix right now'}
          description={
            activeFilters
              ? 'Try clearing a filter.'
              : 'Residents raise issues from their app and they appear here instantly, ready to assign to a worker.'
          }
        />
      ) : (
        <>
          <ul className="space-y-2">
            {complaints.map((complaint) => {
              const theme = themeFor(complaint.property.type)
              const priorityStyle = PRIORITY_STYLE[complaint.priority]
              return (
                <li key={complaint.id}>
                  <Link
                    href={`/app/complaints/${complaint.id}`}
                    className="group flex gap-3 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-card transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-lift sm:items-center sm:gap-4"
                  >
                    <CategoryTile
                      category={complaint.category}
                      label={categoryLabels[complaint.category] ?? complaint.category}
                      hot={complaint.priority === 'URGENT' || complaint.priority === 'HIGH'}
                    />

                    <div className="flex min-w-0 flex-1 flex-col gap-2.5 lg:flex-row lg:items-center lg:gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start gap-2">
                          <p className="min-w-0 font-medium leading-snug text-slate-900 transition-colors group-hover:text-blue-700 sm:truncate">
                            {complaint.title}
                          </p>
                          <StatusChip label={priorityStyle.label} chip={priorityStyle.chip} className="shrink-0" />
                        </div>
                        <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-slate-500 sm:line-clamp-1">
                          <span className="font-medium text-slate-600">{complaint.code}</span> ·{' '}
                          <span className="inline-flex items-center gap-1">
                            <span className={cn('size-1.5 rounded-full', theme.bgSolid)} />
                            {complaint.property.name}
                          </span>
                          {` · ${categoryLabels[complaint.category] ?? complaint.category}`}
                          {complaint.room ? ` · Room ${complaint.room.number}` : ''}
                          {complaint.resident ? ` · ${complaint.resident.fullName}` : ''}
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-slate-100 pt-2.5 lg:shrink-0 lg:flex-nowrap lg:border-0 lg:pt-0">
                        <SlaChip
                          status={complaint.status}
                          slaDueAt={complaint.slaDueAt}
                          createdAt={complaint.createdAt}
                          resolvedAt={complaint.resolvedAt}
                        />
                        <div className="min-w-0 lg:w-28 lg:text-right">
                          <p
                            className={cn(
                              'truncate text-xs',
                              complaint.assignedStaff ? 'font-medium text-slate-700' : 'text-slate-400',
                            )}
                          >
                            {complaint.assignedStaff ? complaint.assignedStaff.name : 'Unassigned'}
                          </p>
                          <p className="text-[11px] text-slate-400">
                            {relativeTime(complaint.createdAt)}
                          </p>
                        </div>
                        <StatusChip
                          label={COMPLAINT_STATUS_STYLE[complaint.status].label}
                          chip={COMPLAINT_STATUS_STYLE[complaint.status].chip}
                          className="ml-auto lg:ml-0"
                        />
                      </div>
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

      {staff.length === 0 && user.modules.includes('staff') && user.permissions.includes('complaints.assign') && (
        <p className="text-xs text-slate-500">
          Add staff members to assign complaints to a worker.{' '}
          <Link href="/app/staff" className="font-semibold text-blue-600">
            Manage staff
          </Link>
        </p>
      )}
    </div>
  )
}
