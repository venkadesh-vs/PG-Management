import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import type { Prisma } from '@prisma/client'
import { requireSuperAdmin } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { cn, endOfDay, startOfDay } from '@/lib/utils'
import { PageHeader } from '@/components/app/page-header'
import { StatCard } from '@/components/app/stat-card'
import { EmptyState, TableSkeleton } from '@/components/ui/feedback'
import { FilterBar, FilterSelect, Pagination, SearchInput } from '@/components/app/filters'
import type { CrmLead } from './lead-card'
import { LeadEditDialog } from './lead-edit-dialog'
import { LeadBoard, LeadTable } from './lead-views'
import { CLOSED_LEAD_STATUSES, LEAD_SOURCES, LEAD_STATUSES, leadStyle } from './lead-meta'

export const metadata: Metadata = { title: 'Sales CRM' }

const PAGE_SIZE = 25
const BOARD_LIMIT = 300

const SORTS: Record<string, Prisma.LeadOrderByWithRelationInput[]> = {
  newest: [{ createdAt: 'desc' }],
  followup: [{ followUpAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }],
  beds: [{ bedCount: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
}

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const me = await requireSuperAdmin()
  const params = await searchParams

  const view = params.view === 'table' ? 'table' : 'board'
  const page = Math.max(1, Number(params.page) || 1)
  const q = params.q?.trim() ?? ''
  const status = params.status && (LEAD_STATUSES as readonly string[]).includes(params.status) ? params.status : undefined
  const source = params.source
  const owner = params.owner
  const city = params.city
  const due = params.due
  const sort = params.sort && SORTS[params.sort] ? params.sort : 'newest'
  const now = new Date()

  const where: Prisma.LeadWhereInput = {
    ...(status ? { status: status as never } : {}),
    ...(source ? { source } : {}),
    ...(owner === 'none' ? { salesOwnerId: null } : owner ? { salesOwnerId: owner } : {}),
    ...(city ? { city: { equals: city, mode: 'insensitive' } } : {}),
    ...(due
      ? {
          status: status ? (status as never) : { notIn: CLOSED_LEAD_STATUSES as never[] },
          followUpAt:
            due === 'overdue'
              ? { lt: startOfDay(now) }
              : due === 'today'
                ? { gte: startOfDay(now), lte: endOfDay(now) }
                : { lte: endOfDay(now) },
        }
      : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { phone: { contains: q } },
            { whatsapp: { contains: q } },
            { pgName: { contains: q, mode: 'insensitive' } },
            { city: { contains: q, mode: 'insensitive' } },
          ],
        }
      : {}),
  }

  const [leads, total, counts, bedTotal, dueCount, overdueCount, admins, cities] = await Promise.all([
    prisma.lead.findMany({
      where,
      include: { notes: { orderBy: { createdAt: 'desc' }, take: 20 } },
      orderBy: SORTS[sort],
      skip: view === 'table' ? (page - 1) * PAGE_SIZE : 0,
      take: view === 'table' ? PAGE_SIZE : BOARD_LIMIT,
    }),
    prisma.lead.count({ where }),
    prisma.lead.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.lead.aggregate({
      where: { status: { notIn: CLOSED_LEAD_STATUSES as never[] } },
      _sum: { bedCount: true },
    }),
    prisma.lead.count({
      where: { status: { notIn: CLOSED_LEAD_STATUSES as never[] }, followUpAt: { lte: endOfDay(now) } },
    }),
    prisma.lead.count({
      where: { status: { notIn: CLOSED_LEAD_STATUSES as never[] }, followUpAt: { lt: startOfDay(now) } },
    }),
    prisma.user.findMany({
      where: { role: 'SUPER_ADMIN', status: 'ACTIVE' },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    prisma.lead.findMany({
      where: { city: { not: null } },
      distinct: ['city'],
      select: { city: true },
      orderBy: { city: 'asc' },
      take: 100,
    }),
  ])

  const orgIds = leads.map((l) => l.convertedOrgId).filter((id): id is string => Boolean(id))
  const orgs = orgIds.length
    ? await prisma.organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true } })
    : []
  const orgName = new Map(orgs.map((o) => [o.id, o.name]))

  const countFor = (s: string) => counts.find((c) => c.status === s)?._count._all ?? 0
  const activeFilters = [q, status, source, owner, city, due].filter(Boolean).length
  const inPipeline = countFor('NEW') + countFor('CONTACTED') + countFor('DEMO_SCHEDULED') + countFor('DEMO_COMPLETED') + countFor('FOLLOW_UP')

  const rows: CrmLead[] = leads.map((lead) => ({
    id: lead.id,
    name: lead.name,
    phone: lead.phone,
    whatsapp: lead.whatsapp,
    email: lead.email,
    pgName: lead.pgName,
    pgCount: lead.pgCount,
    pgTypes: lead.pgTypes,
    bedCount: lead.bedCount,
    rentRange: lead.rentRange,
    currentMethod: lead.currentMethod,
    currentSoftware: lead.currentSoftware,
    city: lead.city,
    message: lead.message,
    status: lead.status,
    source: lead.source,
    createdAt: lead.createdAt.toISOString(),
    lastContactedAt: lead.lastContactedAt?.toISOString() ?? null,
    demoAt: lead.demoAt?.toISOString() ?? null,
    followUpAt: lead.followUpAt?.toISOString() ?? null,
    lostReason: lead.lostReason,
    salesOwnerId: lead.salesOwnerId,
    convertedOrgId: lead.convertedOrgId,
    convertedOrgName: lead.convertedOrgId ? (orgName.get(lead.convertedOrgId) ?? null) : null,
    notes: lead.notes.map((n) => ({
      id: n.id,
      body: n.body,
      authorName: n.authorName,
      createdAt: n.createdAt.toISOString(),
      statusTo: n.statusTo,
    })),
  }))

  const viewHref = (v: string) => {
    const sp = new URLSearchParams()
    for (const [k, val] of Object.entries(params)) if (val && k !== 'view' && k !== 'page') sp.set(k, val)
    if (v !== 'board') sp.set('view', v)
    const s = sp.toString()
    return `/admin/leads${s ? `?${s}` : ''}`
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sales CRM"
        subtitle="Every PG owner who asked about StayFlow — from first call to paying customer."
        icon="clipboard"
        breadcrumbs={[{ label: 'Platform', href: '/admin' }, { label: 'Leads' }]}
        actions={<LeadEditDialog admins={admins} currentAdminId={me.id} />}
      />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard label="New" value={countFor('NEW')} icon="clipboard" tone={countFor('NEW') ? 'amber' : 'default'} hint="Not contacted yet" href="/admin/leads?status=NEW" />
        <StatCard
          label="Follow-ups due"
          value={dueCount}
          icon="clock"
          tone={overdueCount ? 'red' : dueCount ? 'amber' : undefined}
          hint={overdueCount ? `${overdueCount} overdue` : 'All caught up'}
          href="/admin/leads?due=due&sort=followup&view=table"
        />
        <StatCard label="In the pipeline" value={inPipeline} icon="users" hint={`${countFor('TRIAL')} on trial`} />
        <StatCard label="Beds in pipeline" value={bedTotal._sum.bedCount ?? 0} icon="bed" hint={`${countFor('CONVERTED') + countFor('ACTIVE_CUSTOMER')} won`} />
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1">
        <Suspense fallback={<TableSkeleton rows={1} />}>
          <FilterBar activeCount={activeFilters}>
            <SearchInput placeholder="Search name, phone, PG or city…" />
            <FilterSelect
              paramKey="status"
              placeholder="All stages"
              options={LEAD_STATUSES.map((s) => ({ value: s, label: `${leadStyle(s).label} (${countFor(s)})` }))}
            />
            <FilterSelect paramKey="due" placeholder="Any follow-up" options={[
              { value: 'due', label: 'Due today or overdue' },
              { value: 'today', label: 'Due today' },
              { value: 'overdue', label: 'Overdue' },
            ]} />
            <FilterSelect paramKey="source" placeholder="All sources" options={LEAD_SOURCES.map((s) => ({ value: s.value, label: s.label }))} />
            <FilterSelect
              paramKey="owner"
              placeholder="Any owner"
              options={[{ value: 'none', label: 'Unassigned' }, ...admins.map((a) => ({ value: a.id, label: a.name }))]}
            />
            {cities.length > 0 && (
              <FilterSelect
                paramKey="city"
                placeholder="All cities"
                options={cities.map((c) => ({ value: c.city!, label: c.city! }))}
              />
            )}
            <FilterSelect
              paramKey="sort"
              placeholder="Newest first"
              options={[
                { value: 'followup', label: 'Follow-up date' },
                { value: 'beds', label: 'Most beds' },
              ]}
            />
          </FilterBar>
        </Suspense>
        </div>
        <div className="inline-flex h-10 shrink-0 self-start items-center rounded-lg bg-slate-100 p-1 text-xs font-medium">
          {(['board', 'table'] as const).map((v) => (
            <Link
              key={v}
              href={viewHref(v)}
              className={cn(
                'flex h-8 items-center rounded-md px-3 capitalize transition-colors',
                view === v ? 'bg-white text-slate-900 shadow-xs ring-1 ring-slate-200' : 'text-slate-600 hover:text-slate-900',
              )}
            >
              {v}
            </Link>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon="clipboard"
          title={activeFilters ? 'Nothing matches these filters' : 'No leads yet'}
          description="Demo requests from the website land here instantly. You can also add a lead by hand."
        />
      ) : view === 'board' ? (
        <>
          <LeadBoard leads={rows} admins={admins} currentAdminId={me.id} />
          {total > BOARD_LIMIT && (
            <p className="text-xs text-slate-500">
              Showing the {BOARD_LIMIT} most relevant of {total} leads — narrow the filters or switch to the table.
            </p>
          )}
        </>
      ) : (
        <>
          <LeadTable leads={rows} admins={admins} currentAdminId={me.id} />
          <Suspense fallback={null}>
            <Pagination page={page} pageSize={PAGE_SIZE} total={total} />
          </Suspense>
        </>
      )}
    </div>
  )
}
