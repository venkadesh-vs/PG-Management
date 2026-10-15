import type { Metadata } from 'next'
import { requireSuperAdmin } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { cn, formatDateTime } from '@/lib/utils'
import { PageHeader, SectionHeader } from '@/components/app/page-header'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/feedback'
import { AnnouncementDialog, EndAnnouncementButton } from './announcement-form'
import { AUDIENCES, SEVERITIES } from './announcement-meta'

export const metadata: Metadata = { title: 'Announcements' }
export const dynamic = 'force-dynamic'

const SEVERITY_BAR: Record<string, string> = {
  INFO: 'bg-sky-400',
  SUCCESS: 'bg-emerald-400',
  WARNING: 'bg-amber-400',
  CRITICAL: 'bg-rose-500',
}

const SEVERITY_VARIANT: Record<string, 'info' | 'success' | 'warning' | 'danger'> = {
  INFO: 'info',
  SUCCESS: 'success',
  WARNING: 'warning',
  CRITICAL: 'danger',
}

export default async function AnnouncementsPage() {
  await requireSuperAdmin()
  const now = new Date()
  const rows = await prisma.platformAnnouncement.findMany({ orderBy: { startsAt: 'desc' }, take: 100 })

  const state = (a: (typeof rows)[number]) =>
    a.endsAt && a.endsAt <= now ? 'ended' : a.startsAt > now ? 'scheduled' : 'live'
  const groups = {
    live: rows.filter((a) => state(a) === 'live'),
    scheduled: rows.filter((a) => state(a) === 'scheduled'),
    ended: rows.filter((a) => state(a) === 'ended'),
  }

  const label = (list: { value: string; label: string }[], v: string) => list.find((x) => x.value === v)?.label ?? v

  const renderList = (list: typeof rows, ended = false) => (
    <div className="grid gap-3 lg:grid-cols-2">
      {list.map((a) => (
        <Card
          key={a.id}
          className={cn(
            'relative overflow-hidden rounded-2xl border-slate-200/80',
            ended ? 'bg-slate-50/60 opacity-75' : 'transition hover:-translate-y-0.5 hover:shadow-lift',
          )}
        >
          <span aria-hidden className={cn('absolute inset-y-0 left-0 w-1', SEVERITY_BAR[a.severity] ?? 'bg-sky-400')} />
          <CardContent className="space-y-2 p-4 pl-5 sm:p-5 sm:pl-6">
            <div className="flex items-start justify-between gap-2">
              <p className="min-w-0 font-display text-sm font-semibold text-slate-900">{a.title}</p>
              <Badge variant={SEVERITY_VARIANT[a.severity] ?? 'info'} size="sm" className="shrink-0">
                {label(SEVERITIES, a.severity)}
              </Badge>
            </div>
            <p className="whitespace-pre-line break-words text-sm leading-relaxed text-slate-600">{a.body}</p>
            <p className="text-xs leading-relaxed text-slate-500">
              {label(AUDIENCES, a.audience)} · from {formatDateTime(a.startsAt)}
              {a.endsAt ? ` to ${formatDateTime(a.endsAt)}` : ' · no end date'}
              {a.createdBy ? ` · by ${a.createdBy}` : ''}
            </p>
            {!ended && (
              <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3">
                <AnnouncementDialog
                  announcement={{
                    id: a.id,
                    title: a.title,
                    body: a.body,
                    audience: a.audience,
                    severity: a.severity,
                    startsAt: a.startsAt.toISOString(),
                    endsAt: a.endsAt?.toISOString() ?? null,
                  }}
                />
                <EndAnnouncementButton id={a.id} />
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  )

  return (
    <div className="space-y-6">
      <PageHeader
        title="Announcements"
        subtitle="Tell PG owners about maintenance, new features or billing changes. They see it as a banner on their dashboard."
        icon="megaphone"
        breadcrumbs={[{ label: 'Platform', href: '/admin' }, { label: 'Announcements' }]}
        actions={<AnnouncementDialog />}
      />

      {rows.length === 0 ? (
        <EmptyState
          icon="megaphone"
          title="No announcements yet"
          description="Publish one to show a banner to every customer, or only to trial, paying or suspended accounts."
        />
      ) : (
        <>
          <SectionHeader title={`Live now (${groups.live.length})`} icon="megaphone" />
          {groups.live.length ? (
            renderList(groups.live)
          ) : (
            <EmptyState
              compact
              icon="megaphone"
              title="Nothing is showing right now"
              description="Live announcements appear as a banner on owners' dashboards."
            />
          )}
          {groups.scheduled.length > 0 && (
            <>
              <SectionHeader title={`Scheduled (${groups.scheduled.length})`} icon="calendar" />
              {renderList(groups.scheduled)}
            </>
          )}
          {groups.ended.length > 0 && (
            <>
              <SectionHeader title="Ended" icon="history" />
              {renderList(groups.ended, true)}
            </>
          )}
        </>
      )}
    </div>
  )
}
