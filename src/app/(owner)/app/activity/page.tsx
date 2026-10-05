import type { Metadata } from 'next'
import { Suspense } from 'react'
import type { EventType, Prisma } from '@prisma/client'
import { requireOrgUser } from '@/lib/auth'
import { resolveScope } from '@/lib/tenancy'
import { prisma } from '@/lib/prisma'
import { EVENT_GROUPS, EVENT_LABEL } from '@/lib/events-meta'
import { addDays, formatDate, startOfDay } from '@/lib/utils'
import { PageHeader } from '@/components/app/page-header'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState, TableSkeleton } from '@/components/ui/feedback'
import { FilterBar, FilterSelect, Pagination, SearchInput } from '@/components/app/filters'
import { ActivityTimeline } from '@/components/app/activity-timeline'

export const metadata: Metadata = { title: 'Activity' }

const PAGE_SIZE = 40

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const user = await requireOrgUser()
  const params = await searchParams
  const scope = await resolveScope(user, params.property)

  const page = Math.max(1, Number(params.page) || 1)
  const q = params.q?.trim() ?? ''
  const group = params.group
  const range = params.range ?? '30'

  const groupEvents = EVENT_GROUPS.find((g) => g.label === group)?.events

  const where: Prisma.ActivityLogWhereInput = {
    organizationId: scope.organizationId,
    ...(scope.propertyId ? { OR: [{ propertyId: scope.propertyId }, { propertyId: null }] } : {}),
    ...(groupEvents ? { event: { in: groupEvents } } : {}),
    ...(range !== 'all' ? { createdAt: { gte: addDays(startOfDay(new Date()), -Number(range)) } } : {}),
    ...(q ? { summary: { contains: q, mode: 'insensitive' } } : {}),
  }

  const [logs, total, byEvent] = await Promise.all([
    prisma.activityLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.activityLog.count({ where }),
    prisma.activityLog.groupBy({
      by: ['event'],
      where: {
        organizationId: scope.organizationId,
        createdAt: { gte: addDays(new Date(), -30) },
      },
      _count: { _all: true },
      orderBy: { _count: { event: 'desc' } },
      take: 6,
    }),
  ])

  // Group the page of logs by day so the timeline reads like a diary.
  const byDay = new Map<string, typeof logs>()
  for (const log of logs) {
    const key = startOfDay(log.createdAt).toISOString()
    const bucket = byDay.get(key) ?? []
    bucket.push(log)
    byDay.set(key, bucket)
  }

  const activeFilters = [q, group, params.range].filter(Boolean).length

  return (
    <div className="space-y-6">
      <PageHeader
        title="Activity"
        subtitle="Every check-in, payment, complaint and configuration change, with who did it and when."
        icon="history"
        breadcrumbs={[{ label: 'Dashboard', href: '/app' }, { label: 'Activity' }]}
      />

      {byEvent.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {byEvent.map((entry) => (
            <div
              key={entry.event}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-card"
            >
              <p className="font-display text-lg font-semibold text-slate-900 tabular">
                {entry._count._all}
              </p>
              <p className="truncate text-[11px] text-slate-500">
                {EVENT_LABEL[entry.event as EventType]}
              </p>
            </div>
          ))}
        </div>
      )}

      <Suspense fallback={<TableSkeleton />}>
        <FilterBar activeCount={activeFilters}>
          <SearchInput placeholder="Search the log…" />
          <FilterSelect
            paramKey="group"
            placeholder="All activity"
            options={EVENT_GROUPS.map((g) => ({ value: g.label, label: g.label }))}
          />
          <FilterSelect
            paramKey="range"
            placeholder="Last 30 days"
            options={[
              { value: '7', label: 'Last 7 days' },
              { value: '30', label: 'Last 30 days' },
              { value: '90', label: 'Last 90 days' },
              { value: 'all', label: 'All time' },
            ]}
          />
        </FilterBar>
      </Suspense>

      {logs.length === 0 ? (
        <EmptyState
          icon="history"
          title={activeFilters ? 'Nothing matches these filters' : 'No activity recorded yet'}
          description="Everything that happens in your PG is logged here automatically."
        />
      ) : (
        <>
          <div className="space-y-5">
            {[...byDay.entries()].map(([day, entries]) => (
              <div key={day}>
                <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  {formatDate(day)}
                </p>
                <Card>
                  <CardContent className="p-5">
                    <ActivityTimeline
                      items={entries.map((log) => ({
                        id: log.id,
                        event: log.event,
                        summary: log.summary,
                        actorName: log.actorName,
                        createdAt: log.createdAt,
                        entityType: log.entityType,
                        entityId: log.entityId,
                      }))}
                    />
                  </CardContent>
                </Card>
              </div>
            ))}
          </div>

          <Suspense fallback={null}>
            <Pagination page={page} pageSize={PAGE_SIZE} total={total} />
          </Suspense>
        </>
      )}
    </div>
  )
}
