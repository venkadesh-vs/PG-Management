import type { Metadata } from 'next'
import Link from 'next/link'
import { AlertTriangle, ChevronRight, LifeBuoy, MessageSquare, Phone } from 'lucide-react'
import { requireSuperAdmin } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import {
  ADMIN_STATUS_LABEL,
  categoryLabel,
  priorityLabel,
  PRIORITY_STYLE,
  TICKET_STATUS_STYLE,
  type TicketPriority,
  type TicketStatus,
} from '@/lib/support'
import { listAllTickets } from '@/server/services/support'
import { COMPLAINT_STATUS_STYLE, themeFor } from '@/lib/theme'
import { addDays, cn, formatPhone, relativeTime } from '@/lib/utils'
import { PageHeader, SectionHeader } from '@/components/app/page-header'
import { StatCard } from '@/components/app/stat-card'
import { Card, CardContent } from '@/components/ui/card'
import { StatusChip } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/feedback'

export const metadata: Metadata = { title: 'Support & customer health' }

const TICKET_FILTERS = [
  { key: 'active', label: 'Needs attention' },
  { key: 'mine', label: 'Assigned to me' },
  { key: 'unassigned', label: 'Unassigned' },
  { key: 'WAITING_ON_CUSTOMER', label: 'Waiting on customer' },
  { key: 'RESOLVED', label: 'Resolved' },
  { key: 'CLOSED', label: 'Closed' },
  { key: 'all', label: 'All' },
] as const

const PRIORITY_RANK: Record<string, number> = { URGENT: 0, HIGH: 1, NORMAL: 2, LOW: 3 }

export default async function SupportPage({ searchParams }: { searchParams: Promise<{ tickets?: string }> }) {
  const admin = await requireSuperAdmin()
  const weekAgo = addDays(new Date(), -7)
  const { tickets: rawFilter } = await searchParams
  const filter = TICKET_FILTERS.find((f) => f.key === rawFilter)?.key ?? 'active'

  const [tickets, strugglingOrgs, staleComplaints, quietOrgs, totals, openTickets] = await Promise.all([
    listAllTickets(
      filter === 'active' || filter === 'mine' || filter === 'unassigned'
        ? {
            status: 'ACTIVE',
            assignedTo: filter === 'mine' ? admin.id : filter === 'unassigned' ? 'none' : undefined,
          }
        : filter === 'all'
          ? {}
          : { status: filter },
    ),
    // Accounts with a lot of unresolved complaints — the best early signal
    // that an owner is about to churn.
    prisma.organization.findMany({
      where: { archivedAt: null },
      select: {
        id: true,
        name: true,
        ownerName: true,
        contactPhone: true,
        status: true,
        _count: {
          select: {
            complaints: { where: { status: { in: ['OPEN', 'ASSIGNED', 'IN_PROGRESS'] } } },
            residents: true,
          },
        },
      },
    }),
    prisma.complaint.findMany({
      where: {
        status: { in: ['OPEN', 'ASSIGNED'] },
        createdAt: { lt: weekAgo },
      },
      include: {
        organization: { select: { id: true, name: true } },
        property: { select: { name: true, type: true } },
      },
      orderBy: { createdAt: 'asc' },
      take: 15,
    }),
    prisma.organization.findMany({
      where: {
        archivedAt: null,
        status: { in: ['ACTIVE', 'TRIAL'] },
        users: { every: { OR: [{ lastLoginAt: null }, { lastLoginAt: { lt: weekAgo } }] } },
      },
      select: {
        id: true,
        name: true,
        ownerName: true,
        contactPhone: true,
        status: true,
        users: { select: { lastLoginAt: true }, orderBy: { lastLoginAt: 'desc' }, take: 1 },
      },
      take: 10,
    }),
    prisma.complaint.count({ where: { status: { in: ['OPEN', 'ASSIGNED', 'IN_PROGRESS'] } } }),
    prisma.supportTicket.count({ where: { status: { in: ['OPEN', 'IN_PROGRESS'] } } }),
  ])
  // Within "needs attention", the most urgent and oldest come first.
  const sortedTickets =
    filter === 'active' || filter === 'mine' || filter === 'unassigned'
      ? [...tickets].sort(
          (a, b) =>
            (PRIORITY_RANK[a.priority] ?? 2) - (PRIORITY_RANK[b.priority] ?? 2) ||
            a.updatedAt.getTime() - b.updatedAt.getTime(),
        )
      : tickets

  const atRisk = strugglingOrgs
    .filter((o) => o._count.complaints >= 3)
    .sort((a, b) => b._count.complaints - a._count.complaints)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Support & customer health"
        subtitle="Tickets from PG owners, plus the accounts that look like they need a hand — long-open complaints, quiet logins and backlogs."
        icon="lifebuoy"
        breadcrumbs={[{ label: 'Platform', href: '/admin' }, { label: 'Support' }]}
      />

      <SectionHeader
        title="Support tickets"
        description={`${openTickets} waiting for the StayFlow team.`}
        icon="lifebuoy"
      />
      <nav aria-label="Ticket filter" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
        {TICKET_FILTERS.map((f) => (
          <Link
            key={f.key}
            href={f.key === 'active' ? '/admin/support' : `/admin/support?tickets=${f.key}`}
            className={cn(
              'shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors',
              f.key === filter
                ? 'border-slate-900 bg-slate-900 text-white'
                : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50',
            )}
            aria-current={f.key === filter ? 'page' : undefined}
          >
            {f.label}
          </Link>
        ))}
      </nav>
      {sortedTickets.length === 0 ? (
        <EmptyState
          compact
          icon="check"
          title="No tickets here"
          description={filter === 'active' ? 'Every ticket has an answer.' : 'Nothing matches this filter.'}
        />
      ) : (
        <div className="space-y-2">
          {sortedTickets.map((t) => {
            const status = t.status as TicketStatus
            return (
              <Link key={t.id} href={`/admin/support/${t.id}`} className="block">
                <Card className="transition-colors hover:border-slate-300">
                  <CardContent className="flex items-center gap-3 p-4">
                    <LifeBuoy className="size-4 shrink-0 text-slate-400" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-900">{t.subject}</p>
                      <p className="truncate text-xs text-slate-500">
                        {t.code} · {t.organization.name} · {categoryLabel(t.category)} · updated {relativeTime(t.updatedAt)}
                      </p>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        <StatusChip label={ADMIN_STATUS_LABEL[status]} chip={TICKET_STATUS_STYLE[status].chip} />
                        {t.priority !== 'NORMAL' && (
                          <StatusChip
                            label={priorityLabel(t.priority)}
                            chip={PRIORITY_STYLE[t.priority as TicketPriority] ?? PRIORITY_STYLE.NORMAL}
                          />
                        )}
                        {!t.assignedTo && status !== 'CLOSED' && (
                          <span className="text-[11px] text-slate-400">unassigned</span>
                        )}
                      </div>
                    </div>
                    <ChevronRight className="size-4 shrink-0 text-slate-300" />
                  </CardContent>
                </Card>
              </Link>
            )
          })}
        </div>
      )}

      <SectionHeader
        title="Customer health"
        description="Accounts that may need a call before they turn into a ticket."
        icon="messages"
      />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
        <StatCard
          label="Open complaints platform-wide"
          value={totals}
          icon="wrench"
          tone={totals > 0 ? 'amber' : 'emerald'}
        />
        <StatCard
          label="Accounts with a backlog"
          value={atRisk.length}
          icon="warning"
          tone={atRisk.length ? 'red' : 'emerald'}
          hint="3 or more open complaints"
        />
        <StatCard
          label="Quiet for a week"
          value={quietOrgs.length}
          icon="clock"
          tone={quietOrgs.length ? 'amber' : 'emerald'}
          hint="No sign-in in 7 days"
        />
      </div>

      <SectionHeader
        title="Complaints open for over a week"
        description="Worth a call — a stuck complaint is what makes a PG owner give up on the app."
        icon="wrench"
      />
      {staleComplaints.length === 0 ? (
        <EmptyState
          compact
          icon="check"
          title="Nothing stuck"
          description="Every complaint raised over a week ago has moved on."
        />
      ) : (
        <div className="space-y-2">
          {staleComplaints.map((complaint) => {
            const theme = themeFor(complaint.property.type)
            const style = COMPLAINT_STATUS_STYLE[complaint.status]
            return (
              <Card key={complaint.id}>
                <CardContent className="flex flex-wrap items-center gap-3 p-4">
                  <AlertTriangle className="size-4 shrink-0 text-amber-500" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-900">
                      {complaint.title}
                    </p>
                    <p className="truncate text-xs text-slate-500">
                      <Link
                        href={`/admin/organizations/${complaint.organization.id}`}
                        className="hover:text-blue-700"
                      >
                        {complaint.organization.name}
                      </Link>
                      {' · '}
                      <span className="inline-flex items-center gap-1">
                        <span className={cn('size-1.5 rounded-full', theme.bgSolid)} />
                        {complaint.property.name}
                      </span>
                      {' · '}
                      {complaint.code}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-amber-600">
                    open {relativeTime(complaint.createdAt)}
                  </span>
                  <StatusChip label={style.label} chip={style.chip} />
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      <SectionHeader
        title="Accounts carrying a backlog"
        description="Owners with several unresolved complaints at once."
        icon="building"
      />
      {atRisk.length === 0 ? (
        <EmptyState compact icon="check" title="Nobody is behind" description="No account has three or more open complaints." />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {atRisk.map((org) => (
            <Card key={org.id}>
              <CardContent className="flex items-center gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/admin/organizations/${org.id}`}
                    className="truncate text-sm font-semibold text-slate-900 hover:text-blue-700"
                  >
                    {org.name}
                  </Link>
                  <p className="truncate text-xs text-slate-500">
                    {org.ownerName} · {org._count.residents} residents
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-display text-lg font-semibold text-amber-600 tabular">
                    {org._count.complaints}
                  </p>
                  <p className="text-[10px] uppercase tracking-wide text-slate-400">open</p>
                </div>
                <a
                  href={`tel:${org.contactPhone}`}
                  className="shrink-0 rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                  aria-label={`Call ${org.ownerName}`}
                >
                  <Phone className="size-4" />
                </a>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <SectionHeader
        title="Quiet accounts"
        description="Nobody on the account has signed in for a week."
        icon="clock"
      />
      {quietOrgs.length === 0 ? (
        <EmptyState compact icon="check" title="Everyone is active" description="Every account signed in within the last week." />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {quietOrgs.map((org) => (
            <Card key={org.id}>
              <CardContent className="flex items-center gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/admin/organizations/${org.id}`}
                    className="truncate text-sm font-semibold text-slate-900 hover:text-blue-700"
                  >
                    {org.name}
                  </Link>
                  <p className="truncate text-xs text-slate-500">
                    {org.ownerName} · {formatPhone(org.contactPhone)}
                  </p>
                </div>
                <span className="shrink-0 text-xs text-slate-500">
                  {org.users[0]?.lastLoginAt
                    ? `last seen ${relativeTime(org.users[0].lastLoginAt)}`
                    : 'never signed in'}
                </span>
                <MessageSquare className="size-4 shrink-0 text-slate-300" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
