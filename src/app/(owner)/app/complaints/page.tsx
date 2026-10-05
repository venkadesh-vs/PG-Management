import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import type { ComplaintStatus, Prisma } from '@prisma/client'
import { requireOrgUser } from '@/lib/auth'
import { resolveScope } from '@/lib/tenancy'
import { prisma } from '@/lib/prisma'
import { COMPLAINT_STATUS_STYLE, PRIORITY_STYLE, themeFor } from '@/lib/theme'
import { cn, relativeTime } from '@/lib/utils'
import { PageHeader } from '@/components/app/page-header'
import { StatCard } from '@/components/app/stat-card'
import { StatusChip } from '@/components/ui/badge'
import { EmptyState, TableSkeleton } from '@/components/ui/feedback'
import { FilterBar, FilterSelect, Pagination, SearchInput } from '@/components/app/filters'
import { NewComplaintButton } from './new-complaint'

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

const CATEGORY_OPTIONS = [
  'PLUMBING', 'ELECTRICITY', 'AC', 'FAN', 'BATHROOM', 'CLEANING',
  'INTERNET', 'FOOD', 'ROOM', 'FURNITURE', 'SECURITY', 'OTHER',
].map((value) => ({ value, label: value.charAt(0) + value.slice(1).toLowerCase() }))

export default async function ComplaintsPage({
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
  const status = params.status as ComplaintStatus | undefined
  const category = params.category
  const priority = params.priority

  const where: Prisma.ComplaintWhereInput = {
    organizationId: scope.organizationId,
    propertyId: { in: propertyIds },
    ...(status ? { status } : {}),
    ...(category ? { category: category as never } : {}),
    ...(priority ? { priority: priority as never } : {}),
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

  const [complaints, total, counts, resolvedThisMonth, staff, residents, properties] =
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
        orderBy: [{ status: 'asc' }, { priority: 'desc' }, { createdAt: 'desc' }],
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
    ])

  const countFor = (s: string) => counts.find((c) => c.status === s)?._count._all ?? 0
  const open = countFor('OPEN')
  const inProgress = countFor('ASSIGNED') + countFor('IN_PROGRESS')
  const activeFilters = [q, status, category, priority].filter(Boolean).length

  return (
    <div className="space-y-6">
      <PageHeader
        title="Complaints"
        subtitle="Every issue has a clear owner and a visible status — no more scrolling through WhatsApp."
        icon="wrench"
        breadcrumbs={[{ label: 'Dashboard', href: '/app' }, { label: 'Complaints' }]}
        actions={
          <NewComplaintButton
            properties={properties}
            residents={residents}
            defaultPropertyId={scope.propertyId ?? properties[0]?.id}
          />
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Open" value={open} icon="warning" tone={open > 0 ? 'red' : 'emerald'} hint="Not yet assigned" />
        <StatCard label="Being worked on" value={inProgress} icon="wrench" tone="amber" hint="Assigned or in progress" />
        <StatCard label="Resolved this month" value={resolvedThisMonth} icon="check" tone="emerald" />
        <StatCard label="Total raised" value={counts.reduce((s, c) => s + c._count._all, 0)} icon="clipboard" tone="blue" hint="All time" />
      </div>

      <Suspense fallback={<TableSkeleton />}>
        <FilterBar activeCount={activeFilters}>
          <SearchInput placeholder="Search code, title or resident…" />
          <FilterSelect paramKey="status" placeholder="All statuses" options={STATUS_OPTIONS} />
          <FilterSelect paramKey="category" placeholder="All categories" options={CATEGORY_OPTIONS} />
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
                    className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-card transition-all hover:border-slate-300 hover:shadow-elevated sm:flex-row sm:items-center"
                  >
                    <div
                      className={cn(
                        'flex size-10 shrink-0 items-center justify-center rounded-xl',
                        complaint.priority === 'URGENT' || complaint.priority === 'HIGH'
                          ? 'bg-red-50 text-red-600'
                          : 'bg-slate-100 text-slate-500',
                      )}
                    >
                      <span className="text-[10px] font-bold uppercase">
                        {complaint.category.slice(0, 4)}
                      </span>
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate font-medium text-slate-900">{complaint.title}</p>
                        <StatusChip label={priorityStyle.label} chip={priorityStyle.chip} />
                      </div>
                      <p className="mt-0.5 truncate text-xs text-slate-500">
                        {complaint.code} ·{' '}
                        <span className="inline-flex items-center gap-1">
                          <span className={cn('size-1.5 rounded-full', theme.bgSolid)} />
                          {complaint.property.name}
                        </span>
                        {complaint.room ? ` · Room ${complaint.room.number}` : ''}
                        {complaint.resident ? ` · ${complaint.resident.fullName}` : ''}
                      </p>
                    </div>

                    <div className="flex shrink-0 items-center gap-3">
                      <div className="text-right">
                        <p className="text-xs text-slate-500">
                          {complaint.assignedStaff ? complaint.assignedStaff.name : 'Unassigned'}
                        </p>
                        <p className="text-[11px] text-slate-400">
                          {relativeTime(complaint.createdAt)}
                        </p>
                      </div>
                      <StatusChip
                        label={COMPLAINT_STATUS_STYLE[complaint.status].label}
                        chip={COMPLAINT_STATUS_STYLE[complaint.status].chip}
                      />
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

      {staff.length === 0 && (
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
