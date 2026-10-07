import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import type { ResidentRequestKind } from '@prisma/client'
import { requireAccess } from '@/lib/auth'
import { resolveScope } from '@/lib/tenancy'
import { prisma } from '@/lib/prisma'
import { cn } from '@/lib/utils'
import { PageHeader } from '@/components/app/page-header'
import { EmptyState } from '@/components/ui/feedback'
import { FilterBar, FilterSelect } from '@/components/app/filters'
import { listRequests, requestCounts, type RequestTab } from '@/server/services/requests'
import { KIND_META } from '@/app/(tenant)/tenant/requests/request-meta'
import { RequestCard, type InboxRequest } from './request-card'

export const metadata: Metadata = { title: 'Requests' }

const TABS: { key: RequestTab; label: string }[] = [
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'all', label: 'All' },
]
const KINDS = Object.keys(KIND_META) as ResidentRequestKind[]

export default async function RequestsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const user = await requireAccess({ module: 'requests', permission: 'requests.view' })
  const params = await searchParams
  const scope = await resolveScope(user, params.property)
  const tab: RequestTab = params.tab === 'approved' || params.tab === 'all' ? params.tab : 'pending'
  const kind = KINDS.includes(params.kind as ResidentRequestKind) ? (params.kind as ResidentRequestKind) : undefined

  const [rows, counts, properties] = await Promise.all([
    listRequests(scope, { tab, kind }),
    requestCounts(scope),
    prisma.property.findMany({
      where: { id: { in: scope.allowedPropertyIds } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
  ])

  const canManage = user.permissions.includes('requests.manage')
  const canCreateTask = user.modules.includes('complaints')
  const requests: InboxRequest[] = rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    status: r.status,
    title: r.title,
    details: r.details,
    fromDate: r.fromDate?.toISOString() ?? null,
    toDate: r.toDate?.toISOString() ?? null,
    visitorName: r.visitorName,
    visitorPhone: r.visitorPhone,
    visitorCount: r.visitorCount,
    decidedBy: r.decidedBy,
    decidedAt: r.decidedAt?.toISOString() ?? null,
    decisionNote: r.decisionNote,
    createdAt: r.createdAt.toISOString(),
    property: { name: r.property.name, type: r.property.type },
    resident: {
      id: r.resident.id,
      name: r.resident.fullName,
      phone: r.resident.phone,
      room: r.resident.room?.number ?? null,
      bed: r.resident.bed?.label ?? null,
    },
  }))

  const href = (next: Record<string, string | undefined>) => {
    const q = new URLSearchParams()
    const merged = { property: params.property, kind: params.kind, tab, ...next }
    for (const [k, v] of Object.entries(merged)) if (v && !(k === 'tab' && v === 'pending')) q.set(k, v)
    const s = q.toString()
    return `/app/requests${s ? `?${s}` : ''}`
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Requests"
        subtitle="Leave, visitors, room changes and service asks from your residents, all in one inbox."
        icon="list"
        breadcrumbs={[{ label: 'Dashboard', href: '/app' }, { label: 'Requests' }]}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav className="inline-flex rounded-xl border border-slate-200 bg-white p-1 shadow-xs" aria-label="Request status">
          {TABS.map((t) => {
            const count = t.key === 'pending' ? counts.pending : t.key === 'approved' ? counts.approved : null
            return (
              <Link
                key={t.key}
                href={href({ tab: t.key })}
                scroll={false}
                className={cn(
                  'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                  tab === t.key ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50',
                )}
              >
                {t.label}
                {count !== null && count > 0 && (
                  <span
                    className={cn(
                      'rounded-full px-1.5 text-[11px] font-semibold',
                      tab === t.key ? 'bg-white/20' : 'bg-slate-100 text-slate-600',
                    )}
                  >
                    {count}
                  </span>
                )}
              </Link>
            )
          })}
        </nav>

        <Suspense fallback={null}>
          <FilterBar activeCount={kind ? 1 : 0}>
            <FilterSelect
              paramKey="kind"
              placeholder="All kinds"
              options={KINDS.map((k) => ({ value: k, label: KIND_META[k].label }))}
            />
            {properties.length > 1 && (
              <FilterSelect
                paramKey="property"
                placeholder="All PGs"
                options={properties.map((p) => ({ value: p.id, label: p.name }))}
              />
            )}
          </FilterBar>
        </Suspense>
      </div>

      {requests.length === 0 ? (
        <EmptyState
          icon="list"
          title={tab === 'pending' ? 'You are all caught up' : 'No requests here'}
          description={
            tab === 'pending'
              ? 'New leave, visitor, room change and service requests from residents will show up here.'
              : 'Try another tab or clear the filters.'
          }
        />
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {requests.map((request) => (
            <li key={request.id}>
              <RequestCard request={request} canManage={canManage} canCreateTask={canCreateTask} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
