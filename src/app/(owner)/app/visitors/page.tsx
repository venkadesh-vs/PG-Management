import type { Metadata } from 'next'
import { Suspense } from 'react'
import { requireOrgUser } from '@/lib/auth'
import { resolveScope } from '@/lib/tenancy'
import { prisma } from '@/lib/prisma'
import { themeFor } from '@/lib/theme'
import { addDays, cn, formatDateTime, formatPhone, startOfDay } from '@/lib/utils'
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
import { FilterBar, Pagination, SearchInput } from '@/components/app/filters'
import { QuickForm } from '@/components/app/quick-form'
import { SignOutVisitorButton } from './sign-out-button'

export const metadata: Metadata = { title: 'Visitors' }

const PAGE_SIZE = 25

export default async function VisitorsPage({
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
  const today = startOfDay(new Date())

  const where = {
    organizationId: scope.organizationId,
    propertyId: { in: propertyIds },
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: 'insensitive' as const } },
            { phone: { contains: q } },
            { resident: { fullName: { contains: q, mode: 'insensitive' as const } } },
          ],
        }
      : {}),
  }

  const [visitors, total, todayCount, insideNow, properties, residents] = await Promise.all([
    prisma.visitor.findMany({
      where,
      include: {
        property: { select: { name: true, type: true } },
        resident: { select: { id: true, fullName: true, room: { select: { number: true } } } },
      },
      orderBy: { entryAt: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.visitor.count({ where }),
    prisma.visitor.count({
      where: { organizationId: scope.organizationId, propertyId: { in: propertyIds }, entryAt: { gte: today } },
    }),
    prisma.visitor.count({
      where: {
        organizationId: scope.organizationId,
        propertyId: { in: propertyIds },
        exitAt: null,
        entryAt: { gte: addDays(today, -1) },
      },
    }),
    prisma.property.findMany({
      where: { id: { in: propertyIds } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    prisma.resident.findMany({
      where: {
        organizationId: scope.organizationId,
        propertyId: { in: propertyIds },
        status: { in: ['ACTIVE', 'NOTICE'] },
      },
      select: { id: true, fullName: true, room: { select: { number: true } } },
      orderBy: { fullName: 'asc' },
    }),
  ])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Visitors"
        subtitle="A digital entry register. The resident is notified the moment their guest signs in."
        icon="userPlus"
        breadcrumbs={[{ label: 'Dashboard', href: '/app' }, { label: 'Visitors' }]}
        actions={
          <QuickForm
            trigger="Sign in a visitor"
            title="Sign in a visitor"
            description="Recording the entry notifies the resident straight away."
            endpoint="/api/operations"
            payload={{ entity: 'VISITOR' }}
            successTitle="Visitor signed in"
            submitLabel="Sign in"
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
                name: 'residentId',
                label: 'Visiting',
                half: true,
                options: residents.map((r) => ({
                  value: r.id,
                  label: `${r.fullName}${r.room ? ` · Room ${r.room.number}` : ''}`,
                })),
              },
              { kind: 'text', name: 'name', label: 'Visitor name', required: true, half: true },
              { kind: 'tel', name: 'phone', label: 'Phone', half: true },
              { kind: 'text', name: 'purpose', label: 'Purpose of visit', required: true, half: true, placeholder: 'Parents visiting' },
              { kind: 'text', name: 'relation', label: 'Relationship', half: true, placeholder: 'Father' },
              { kind: 'text', name: 'idProof', label: 'ID shown', half: true, placeholder: 'Aadhaar' },
              { kind: 'textarea', name: 'notes', label: 'Notes', rows: 2 },
            ]}
          />
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
        <StatCard label="Today" value={todayCount} icon="userPlus" tone="blue" hint="Visitors signed in" />
        <StatCard
          label="Still inside"
          value={insideNow}
          icon="clock"
          tone={insideNow > 0 ? 'amber' : 'emerald'}
          hint="Not signed out yet"
        />
        <StatCard label="All records" value={total} icon="clipboard" tone="violet" />
      </div>

      <Suspense fallback={<TableSkeleton />}>
        <FilterBar activeCount={q ? 1 : 0}>
          <SearchInput placeholder="Search visitor, phone or resident…" />
        </FilterBar>
      </Suspense>

      {visitors.length === 0 ? (
        <EmptyState
          icon="userPlus"
          title="No visitors recorded"
          description="Use the entry register so you always know who came in, who they met and when they left."
        />
      ) : (
        <>
          <TableWrap className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Visitor</TableHead>
                  <TableHead>Visiting</TableHead>
                  <TableHead>Purpose</TableHead>
                  <TableHead>Entry</TableHead>
                  <TableHead>Exit</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {visitors.map((visitor) => {
                  const theme = themeFor(visitor.property.type)
                  return (
                    <TableRow key={visitor.id}>
                      <TableCell>
                        <p className="font-medium text-slate-800">{visitor.name}</p>
                        <p className="text-xs text-slate-500">{formatPhone(visitor.phone)}</p>
                      </TableCell>
                      <TableCell>
                        {visitor.resident ? (
                          <>
                            <p className="text-sm text-slate-700">{visitor.resident.fullName}</p>
                            <p className="flex items-center gap-1.5 text-xs text-slate-500">
                              <span className={cn('size-1.5 rounded-full', theme.bgSolid)} />
                              {visitor.resident.room
                                ? `Room ${visitor.resident.room.number}`
                                : visitor.property.name}
                            </p>
                          </>
                        ) : (
                          <span className="text-sm text-slate-500">{visitor.property.name}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-slate-600">
                        {visitor.purpose}
                        {visitor.relation && (
                          <p className="text-xs text-slate-400">{visitor.relation}</p>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-slate-600">
                        {formatDateTime(visitor.entryAt)}
                      </TableCell>
                      <TableCell className="text-sm">
                        {visitor.exitAt ? (
                          <span className="text-slate-600">{formatDateTime(visitor.exitAt)}</span>
                        ) : (
                          <Badge variant="warning" size="sm">
                            Inside
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {!visitor.exitAt && (
                          <SignOutVisitorButton visitorId={visitor.id} name={visitor.name} />
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </TableWrap>

          <ul className="space-y-2 md:hidden">
            {visitors.map((visitor) => (
              <li
                key={visitor.id}
                className="rounded-2xl border border-slate-200 bg-white p-4 shadow-card"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-900">{visitor.name}</p>
                    <p className="truncate text-xs text-slate-500">
                      {visitor.purpose}
                      {visitor.resident ? ` · ${visitor.resident.fullName}` : ''}
                    </p>
                  </div>
                  {!visitor.exitAt ? (
                    <SignOutVisitorButton visitorId={visitor.id} name={visitor.name} />
                  ) : (
                    <Badge variant="default" size="sm">
                      Left
                    </Badge>
                  )}
                </div>
                <p className="mt-2 text-xs text-slate-500">{formatDateTime(visitor.entryAt)}</p>
              </li>
            ))}
          </ul>

          <Suspense fallback={null}>
            <Pagination page={page} pageSize={PAGE_SIZE} total={total} />
          </Suspense>
        </>
      )}
    </div>
  )
}
