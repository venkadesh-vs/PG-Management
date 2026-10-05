import type { Metadata } from 'next'
import { Suspense } from 'react'
import { requireSuperAdmin } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { formatDate, formatPhone, relativeTime } from '@/lib/utils'
import { PageHeader } from '@/components/app/page-header'
import { StatCard } from '@/components/app/stat-card'
import { EmptyState, TableSkeleton } from '@/components/ui/feedback'
import { FilterBar, FilterSelect, Pagination, SearchInput } from '@/components/app/filters'
import { LeadCard } from './lead-card'

export const metadata: Metadata = { title: 'Leads' }

const PAGE_SIZE = 20

const STATUS_OPTIONS = [
  { value: 'NEW', label: 'New' },
  { value: 'CONTACTED', label: 'Contacted' },
  { value: 'DEMO_SCHEDULED', label: 'Demo scheduled' },
  { value: 'DEMO_COMPLETED', label: 'Demo completed' },
  { value: 'TRIAL', label: 'On trial' },
  { value: 'CONVERTED', label: 'Converted' },
  { value: 'LOST', label: 'Lost' },
]

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  await requireSuperAdmin()
  const params = await searchParams

  const page = Math.max(1, Number(params.page) || 1)
  const q = params.q?.trim() ?? ''
  const status = params.status

  const where = {
    ...(status ? { status: status as never } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: 'insensitive' as const } },
            { phone: { contains: q } },
            { pgName: { contains: q, mode: 'insensitive' as const } },
            { city: { contains: q, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  }

  const [leads, total, counts, bedTotal] = await Promise.all([
    prisma.lead.findMany({
      where,
      include: { notes: { orderBy: { createdAt: 'desc' }, take: 3 } },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.lead.count({ where }),
    prisma.lead.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.lead.aggregate({
      where: { status: { notIn: ['LOST', 'CONVERTED'] } },
      _sum: { bedCount: true },
    }),
  ])

  const countFor = (s: string) => counts.find((c) => c.status === s)?._count._all ?? 0
  const activeFilters = [q, status].filter(Boolean).length
  const inPipeline =
    countFor('NEW') + countFor('CONTACTED') + countFor('DEMO_SCHEDULED') + countFor('DEMO_COMPLETED')

  return (
    <div className="space-y-6">
      <PageHeader
        title="Leads & enquiries"
        subtitle="Demo requests from the website. Move them through the pipeline as you speak to each PG owner."
        icon="clipboard"
        breadcrumbs={[{ label: 'Platform', href: '/admin' }, { label: 'Leads' }]}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="New" value={countFor('NEW')} icon="clipboard" tone={countFor('NEW') ? 'amber' : 'default'} hint="Not contacted yet" />
        <StatCard label="In the pipeline" value={inPipeline} icon="users" tone="blue" />
        <StatCard label="Converted" value={countFor('CONVERTED')} icon="check" tone="emerald" />
        <StatCard
          label="Beds in pipeline"
          value={bedTotal._sum.bedCount ?? 0}
          icon="bed"
          tone="violet"
          hint="Across open enquiries"
        />
      </div>

      <Suspense fallback={<TableSkeleton />}>
        <FilterBar activeCount={activeFilters}>
          <SearchInput placeholder="Search name, phone, PG or city…" />
          <FilterSelect paramKey="status" placeholder="All statuses" options={STATUS_OPTIONS} />
        </FilterBar>
      </Suspense>

      {leads.length === 0 ? (
        <EmptyState
          icon="clipboard"
          title={activeFilters ? 'Nothing matches these filters' : 'No enquiries yet'}
          description="Demo requests submitted on the website land here instantly."
        />
      ) : (
        <>
          <div className="grid gap-3 lg:grid-cols-2">
            {leads.map((lead) => (
              <LeadCard
                key={lead.id}
                lead={{
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
                  city: lead.city,
                  message: lead.message,
                  status: lead.status,
                  source: lead.source,
                  createdAt: lead.createdAt.toISOString(),
                  lastContactedAt: lead.lastContactedAt?.toISOString() ?? null,
                  demoAt: lead.demoAt?.toISOString() ?? null,
                  notes: lead.notes.map((n) => ({
                    id: n.id,
                    body: n.body,
                    authorName: n.authorName,
                    createdAt: n.createdAt.toISOString(),
                  })),
                }}
              />
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
