import type { Metadata } from 'next'
import { Suspense } from 'react'
import type { EventType } from '@prisma/client'
import { requireAccess } from '@/lib/auth'
import { hasPermission, resolveScope } from '@/lib/tenancy'
import { prisma } from '@/lib/prisma'
import { EVENT_GROUPS, EVENT_LABEL } from '@/lib/events-meta'
import { AUDIT_FILTER_KEYS, activeAuditFilterCount, parseAuditFilters } from '@/lib/audit-filters'
import { addDays } from '@/lib/utils'
import { loadAuditPage, orgAuditWhere } from '@/server/services/audit-log'
import { PageHeader } from '@/components/app/page-header'
import { EmptyState, TableSkeleton } from '@/components/ui/feedback'
import { FilterBar, FilterSelect, Pagination, SearchInput } from '@/components/app/filters'
import { AuditLogView } from '@/components/app/audit-log-view'
import { ExportButton } from '@/components/app/export-button'
import { DateRange } from '../expenses/date-range'

export const metadata: Metadata = { title: 'Activity' }

const PAGE_SIZE = 40

const EVENT_OPTIONS = (Object.keys(EVENT_LABEL) as EventType[])
  .map((e) => ({ value: e, label: EVENT_LABEL[e] }))
  .sort((a, b) => a.label.localeCompare(b.label))

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const user = await requireAccess({ module: 'activity', permission: 'activity.view' })
  const params = await searchParams
  const scope = await resolveScope(user, params.property)
  const filters = parseAuditFilters(params)

  const where = orgAuditWhere(user, scope, filters)
  // Facets (actors, record types) come from the same PGs, ignoring the other filters.
  const facetWhere = orgAuditWhere(user, scope, parseAuditFilters({ range: 'all' }))

  const [{ entries, total, actors, entities }, byEvent] = await Promise.all([
    loadAuditPage('org', where, facetWhere, filters.page, PAGE_SIZE),
    prisma.activityLog.groupBy({
      by: ['event'],
      where: { ...facetWhere, createdAt: { gte: addDays(new Date(), -30) } },
      _count: { _all: true },
      orderBy: { _count: { event: 'desc' } },
      take: 6,
    }),
  ])

  const activeFilters = activeAuditFilterCount(filters, params)
  const canExport = hasPermission(user, 'reports.export')

  return (
    <div className="space-y-6">
      <PageHeader
        title="Activity"
        subtitle="Every check-in, payment, complaint and configuration change, with who did it and when. Tap an entry to see exactly what changed."
        icon="history"
        breadcrumbs={[{ label: 'Dashboard', href: '/app' }, { label: 'Activity' }]}
        actions={
          canExport && (
            <Suspense fallback={null}>
              <ExportButton kind="activity" carry={AUDIT_FILTER_KEYS} />
            </Suspense>
          )
        }
      />

      {byEvent.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {byEvent.map((entry) => (
            <div key={entry.event} className="min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-xs">
              <p className="font-display text-lg font-semibold text-slate-900 tabular">{entry._count._all}</p>
              <p className="truncate text-[11px] text-slate-500">{EVENT_LABEL[entry.event as EventType]}</p>
            </div>
          ))}
        </div>
      )}

      <Suspense fallback={<TableSkeleton />}>
        <FilterBar activeCount={activeFilters}>
          <SearchInput placeholder="Search summary, person, IP…" />
          <FilterSelect
            paramKey="group"
            placeholder="All activity"
            options={EVENT_GROUPS.map((g) => ({ value: g.label, label: g.label }))}
          />
          <FilterSelect paramKey="event" placeholder="Any event" options={EVENT_OPTIONS} />
          {actors.length > 0 && (
            <FilterSelect
              paramKey="actor"
              placeholder="Anyone"
              options={[{ value: 'system', label: 'System (automation)' }, ...actors]}
            />
          )}
          {entities.length > 0 && <FilterSelect paramKey="entity" placeholder="Any record" options={entities} />}
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
          <DateRange />
        </FilterBar>
      </Suspense>

      {entries.length === 0 ? (
        <EmptyState
          icon="history"
          title={activeFilters ? 'Nothing matches these filters' : 'No activity recorded yet'}
          description="Everything that happens in your PG is logged here automatically."
        />
      ) : (
        <>
          <AuditLogView entries={entries} />
          <Suspense fallback={null}>
            <Pagination page={filters.page} pageSize={PAGE_SIZE} total={total} />
          </Suspense>
        </>
      )}
    </div>
  )
}
