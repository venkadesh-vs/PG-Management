import type { Metadata } from 'next'
import { Suspense } from 'react'
import type { Prisma } from '@prisma/client'
import { requireSuperAdmin } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { EVENT_GROUPS } from '@/lib/events-meta'
import { addDays, formatDate, startOfDay } from '@/lib/utils'
import { PageHeader } from '@/components/app/page-header'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState, TableSkeleton } from '@/components/ui/feedback'
import { FilterBar, FilterSelect, Pagination, SearchInput } from '@/components/app/filters'
import { ActivityTimeline } from '@/components/app/activity-timeline'

export const metadata: Metadata = { title: 'Audit Logs' }

const PAGE_SIZE = 50

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  await requireSuperAdmin()
  const params = await searchParams

  const page = Math.max(1, Number(params.page) || 1)
  const q = params.q?.trim() ?? ''
  const group = params.group
  const org = params.org
  const range = params.range ?? '30'

  const groupEvents = EVENT_GROUPS.find((g) => g.label === group)?.events

  const where: Prisma.ActivityLogWhereInput = {
    ...(groupEvents ? { event: { in: groupEvents } } : {}),
    ...(org ? { organizationId: org } : {}),
    ...(range !== 'all'
      ? { createdAt: { gte: addDays(startOfDay(new Date()), -Number(range)) } }
      : {}),
    ...(q
      ? {
          OR: [
            { summary: { contains: q, mode: 'insensitive' } },
            { actorName: { contains: q, mode: 'insensitive' } },
          ],
        }
      : {}),
  }

  const [logs, total, organizations] = await Promise.all([
    prisma.activityLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.activityLog.count({ where }),
    prisma.organization.findMany({
      where: { archivedAt: null },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
  ])

  const byDay = new Map<string, typeof logs>()
  for (const log of logs) {
    const key = startOfDay(log.createdAt).toISOString()
    const bucket = byDay.get(key) ?? []
    bucket.push(log)
    byDay.set(key, bucket)
  }

  const activeFilters = [q, group, org, params.range].filter(Boolean).length

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit logs"
        subtitle="Everything that happened across every account, with who did it."
        icon="history"
        breadcrumbs={[{ label: 'Platform', href: '/admin' }, { label: 'Audit Logs' }]}
      />

      <Suspense fallback={<TableSkeleton />}>
        <FilterBar activeCount={activeFilters}>
          <SearchInput placeholder="Search the log…" />
          <FilterSelect
            paramKey="org"
            placeholder="All organizations"
            options={organizations.map((o) => ({ value: o.id, label: o.name }))}
          />
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
          title={activeFilters ? 'Nothing matches these filters' : 'No activity recorded'}
          description="Every write across the platform is logged here automatically."
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
