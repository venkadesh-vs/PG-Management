import { Suspense } from 'react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { CalendarCheck2 } from 'lucide-react'
import { requireAccess } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { hasPermission, resolveScope } from '@/lib/tenancy'
import { addDays } from '@/lib/utils'
import { PageHeader } from '@/components/app/page-header'
import { StatCard } from '@/components/app/stat-card'
import { Button } from '@/components/ui/button'
import { leadScopeWhere, leadStats } from '@/server/services/leads'
import { LeadsBoard } from './leads-board'
import { NewLeadButton } from './new-lead'
import type { LeadCardData, LeadStatus } from './lead-meta'
import { ExportButton } from '@/components/app/export-button'

export const metadata: Metadata = { title: 'Enquiries' }

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ property?: string; view?: string }>
}) {
  const user = await requireAccess({ module: 'leads', permission: 'leads.view' })
  const canExport = hasPermission(user, 'reports.export')
  const params = await searchParams
  const scope = await resolveScope(user, params.property)
  const propertyIds = scope.propertyId ? [scope.propertyId] : scope.allowedPropertyIds
  const where = leadScopeWhere(user, propertyIds)
  const canManage = user.role === 'SUPER_ADMIN' || user.permissions.includes('leads.manage')
  const canBook = user.role === 'SUPER_ADMIN' || user.permissions.includes('bookings.manage')

  const [rows, stats, properties] = await Promise.all([
    prisma.residentLead.findMany({
      where: {
        AND: [
          where,
          {
            // Closed cards fall off the board after 60 days.
            OR: [
              { status: { notIn: ['LOST', 'CHECKED_IN'] } },
              { updatedAt: { gte: addDays(new Date(), -60) } },
            ],
          },
        ],
      },
      include: { property: { select: { id: true, name: true } } },
      orderBy: [{ nextFollowUpAt: { sort: 'asc', nulls: 'last' } }, { updatedAt: 'desc' }],
      take: 500,
    }),
    leadStats(where),
    prisma.property.findMany({
      where: { id: { in: scope.allowedPropertyIds } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
  ])

  const leads: LeadCardData[] = rows.map((l) => ({
    id: l.id,
    name: l.name,
    phone: l.phone,
    email: l.email,
    status: l.status as LeadStatus,
    source: l.source,
    budget: l.budget,
    moveInDate: l.moveInDate?.toISOString() ?? null,
    nextFollowUpAt: l.nextFollowUpAt?.toISOString() ?? null,
    visitAt: l.visitAt?.toISOString() ?? null,
    lostReason: l.lostReason,
    roomTypePref: l.roomTypePref,
    property: l.property,
    updatedAt: l.updatedAt.toISOString(),
    createdAt: l.createdAt.toISOString(),
  }))

  return (
    <div className="space-y-6">
      <PageHeader
        title="Enquiries"
        subtitle="Everyone who asked about a bed — from the first call to the day they move in."
        icon="clipboard"
        breadcrumbs={[{ label: 'Dashboard', href: '/app' }, { label: 'Enquiries' }]}
        actions={
          <>
            {canExport && (
              <Suspense fallback={null}>
                <ExportButton kind="enquiries" />
              </Suspense>
            )}
            {canBook && (
              <Button variant="outline" asChild>
                <Link href="/app/bookings">
                  <CalendarCheck2 /> Bookings
                </Link>
              </Button>
            )}
            {canManage && <NewLeadButton properties={properties} defaultPropertyId={scope.propertyId} />}
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="New this week" value={stats.newThisWeek} icon="sparkles" tone="blue" hint={stats.dueToday ? `${stats.dueToday} to follow up today` : 'All caught up'} />
        <StatCard label="Visits scheduled" value={stats.visitsScheduled} icon="calendar" tone="amber" hint="Upcoming" />
        <StatCard
          label="Conversion"
          value={Math.round(stats.conversionRate)}
          format="percent"
          icon="check"
          tone="emerald"
          hint={`${stats.checkedIn30} of ${stats.total30} checked in · 30 days`}
        />
        <StatCard label="Lost" value={stats.lost30} icon="trendingDown" tone="red" hint="Last 30 days" />
      </div>

      <LeadsBoard
        leads={leads}
        properties={properties}
        defaultPropertyId={scope.propertyId}
        canManage={canManage}
        initialFollowUps={params.view === 'followups'}
      />
    </div>
  )
}
