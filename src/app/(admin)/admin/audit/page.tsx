import type { Metadata } from 'next'
import { Suspense } from 'react'
import type { EventType } from '@prisma/client'
import { requireSuperAdmin } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { EVENT_GROUPS, EVENT_LABEL } from '@/lib/events-meta'
import { AUDIT_FILTER_KEYS, activeAuditFilterCount, parseAuditFilters } from '@/lib/audit-filters'
import { loadAuditPage, platformAuditWhere } from '@/server/services/audit-log'
import { PageHeader } from '@/components/app/page-header'
import { EmptyState, TableSkeleton } from '@/components/ui/feedback'
import { FilterBar, FilterSelect, Pagination, SearchInput } from '@/components/app/filters'
import { AuditLogView } from '@/components/app/audit-log-view'
import { ExportButton } from '@/components/app/export-button'
import { DateRange } from '@/app/(owner)/app/expenses/date-range'

export const metadata: Metadata = { title: 'Audit Logs' }

const PAGE_SIZE = 50

const EVENT_OPTIONS = (Object.keys(EVENT_LABEL) as EventType[])
  .map((e) => ({ value: e, label: EVENT_LABEL[e] }))
  .sort((a, b) => a.label.localeCompare(b.label))

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  await requireSuperAdmin()
  const params = await searchParams
  const filters = parseAuditFilters(params)
  const where = platformAuditWhere(filters)
  const facetWhere = platformAuditWhere(parseAuditFilters({ range: 'all', org: filters.org ?? undefined }))

  const [{ entries, total, actors, entities }, organizations] = await Promise.all([
    loadAuditPage('platform', where, facetWhere, filters.page, PAGE_SIZE),
    prisma.organization.findMany({
      where: { archivedAt: null },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
  ])

  const activeFilters = activeAuditFilterCount(filters, params)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit logs"
        subtitle="Everything that happened across every account, with who did it. Tap an entry for the before/after values, IP and device."
        icon="history"
        breadcrumbs={[{ label: 'Platform', href: '/admin' }, { label: 'Audit Logs' }]}
        actions={
          <Suspense fallback={null}>
            <ExportButton href="/api/admin/audit" carry={AUDIT_FILTER_KEYS} />
          </Suspense>
        }
      />

      <Suspense fallback={<TableSkeleton />}>
        <FilterBar activeCount={activeFilters}>
          <SearchInput placeholder="Search summary, person, IP…" />
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
          title={activeFilters ? 'Nothing matches these filters' : 'No activity recorded'}
          description="Every write across the platform is logged here automatically."
        />
      ) : (
        <>
          <AuditLogView entries={entries} showOrganization={!filters.org} />
          <Suspense fallback={null}>
            <Pagination page={filters.page} pageSize={PAGE_SIZE} total={total} />
          </Suspense>
        </>
      )}
    </div>
  )
}
