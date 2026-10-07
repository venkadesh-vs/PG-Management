import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import { Bell, Mail, MessageCircle, MessageSquare, Settings2, ShieldAlert } from 'lucide-react'
import { requireAccess } from '@/lib/auth'
import { resolveScope } from '@/lib/tenancy'
import { prisma } from '@/lib/prisma'
import { resolveWhatsAppChannel } from '@/server/integrations/whatsapp'
import { templateLabel } from '@/server/integrations/whatsapp-templates'
import { emailMode } from '@/server/integrations/email'
import { CENTRE_PAGE_SIZE, CENTRE_MAX_PAGE, loadMessageCentre, type CentreRow } from '@/server/services/message-centre'
import { CENTRE_CHANNELS, CENTRE_CHANNEL_LABEL, CENTRE_STATUSES, CENTRE_STATUS_LABEL } from '@/lib/message-centre'
import { MESSAGE_GROUPS } from '@/lib/notification-prefs'
import { formatDateTime, relativeTime } from '@/lib/utils'
import { PageHeader } from '@/components/app/page-header'
import { StatCard, StatGrid } from '@/components/app/stat-card'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState, TableSkeleton } from '@/components/ui/feedback'
import { FilterBar, FilterSelect, Pagination, SearchInput } from '@/components/app/filters'
import { DateRange } from '../expenses/date-range'
import { RetryButton } from './retry-button'

export const metadata: Metadata = { title: 'Message centre' }

const ROLE_LABEL: Record<string, string> = {
  TENANT: 'Resident',
  OWNER: 'Owner',
  MANAGER: 'Team',
  WORKER: 'Staff',
  SUPER_ADMIN: 'StayFlow',
}

export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const user = await requireAccess({ permission: 'messages.view' })
  const params = await searchParams
  const scope = await resolveScope(user, params.property)

  const [centre, channel, residents] = await Promise.all([
    loadMessageCentre(
      { id: user.id, role: user.role, organizationId: user.organizationId, propertyIds: user.propertyIds },
      params,
    ),
    resolveWhatsAppChannel(user.organizationId),
    prisma.resident.findMany({
      where: {
        organizationId: user.organizationId,
        propertyId: { in: scope.allowedPropertyIds },
      },
      select: { id: true, fullName: true, status: true },
      orderBy: [{ status: 'asc' }, { fullName: 'asc' }],
      take: 500,
    }),
  ])

  const whatsappOn = user.modules.includes('whatsapp')
  // Retrying re-sends to a resident, so it needs the send permission too.
  const canRetry = whatsappOn && (user.role === 'OWNER' || user.permissions.includes('announcements.send'))
  const live = channel.mode !== 'demo'
  const f = centre.filters
  const activeFilters = [f.q, f.channel, f.status, f.group, f.resident, f.from, f.to].filter(Boolean).length
  const canSettings = user.role === 'OWNER' || user.permissions.includes('settings.manage')

  return (
    <div className="space-y-6">
      <PageHeader
        title="Message centre"
        subtitle="Everything sent to residents and your team — WhatsApp, email and in-app — with what happened to each message."
        icon="messages"
        breadcrumbs={[{ label: 'Dashboard', href: '/app' }, { label: 'Message centre' }]}
        actions={
          canSettings ? (
            <Button asChild variant="outline" size="sm">
              <Link href="/app/settings/notifications">
                <Settings2 className="size-4" />
                Notification settings
              </Link>
            </Button>
          ) : undefined
        }
      />

      {/* The demo/live distinction is stated plainly. Nothing here is ever
          presented as delivered when it was not. */}
      {whatsappOn && (
        <Card className={live ? 'border-emerald-200 bg-emerald-50/50' : 'border-amber-200 bg-amber-50/50'}>
          <CardContent className="flex items-start gap-3 p-5">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white shadow-sm">
              {live ? <MessageCircle className="size-5 text-emerald-600" /> : <ShieldAlert className="size-5 text-amber-600" />}
            </div>
            <div className="min-w-0">
              <p className={`text-sm font-semibold ${live ? 'text-emerald-900' : 'text-amber-900'}`}>
                {channel.mode === 'own'
                  ? 'WhatsApp: sending from your own WhatsApp Business number'
                  : channel.mode === 'platform'
                    ? 'WhatsApp: sending from the StayFlow WhatsApp Business number'
                    : 'WhatsApp is in demo mode — nothing is delivered'}
              </p>
              <p className={`mt-1 text-sm leading-relaxed ${live ? 'text-emerald-800/80' : 'text-amber-800/80'}`}>
                {live
                  ? 'Ticks show sent (✓), delivered (✓✓) and read (blue ✓✓). Failed messages show why and can be retried; temporary failures are also retried automatically up to 3 times.'
                  : 'No WhatsApp Business credentials are set up, so messages are stored here exactly as a resident would receive them and marked “not sent”.'}{' '}
                {emailMode() === 'demo' && 'Email is also in demo mode.'}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <StatGrid cols={4}>
        <StatCard
          label={live ? 'Sent by WhatsApp / email' : 'Held in demo'}
          value={live ? centre.stats.sent : centre.stats.demo}
          icon={live ? 'check' : 'warning'}
          tone={live ? 'emerald' : 'amber'}
        />
        <StatCard label="Read on WhatsApp" value={centre.stats.read} icon="messages" />
        <StatCard label="Failed" value={centre.stats.failed} icon="warning" tone={centre.stats.failed ? 'red' : 'emerald'} />
        <StatCard
          label="In-app to residents"
          value={centre.stats.inAppAll}
          hint={`${centre.stats.inAppUnread} unread`}
          icon="bell"
         
        />
      </StatGrid>

      <Suspense fallback={<TableSkeleton />}>
        <FilterBar activeCount={activeFilters}>
          <SearchInput placeholder="Search recipient or message…" />
          <FilterSelect
            paramKey="channel"
            placeholder="All channels"
            options={CENTRE_CHANNELS.map((c) => ({ value: c, label: CENTRE_CHANNEL_LABEL[c] }))}
          />
          <FilterSelect
            paramKey="status"
            placeholder="Any status"
            options={CENTRE_STATUSES.map((s) => ({ value: s, label: CENTRE_STATUS_LABEL[s] }))}
          />
          <FilterSelect
            paramKey="group"
            placeholder="All types"
            options={Object.entries(MESSAGE_GROUPS).map(([value, g]) => ({ value, label: g.label }))}
          />
          {residents.length > 0 && (
            <FilterSelect
              paramKey="resident"
              placeholder="All residents"
              className="max-w-[14rem]"
              options={residents.map((r) => ({ value: r.id, label: r.status === 'CHECKED_OUT' ? `${r.fullName} (left)` : r.fullName }))}
            />
          )}
          <DateRange />
        </FilterBar>
      </Suspense>

      {centre.rows.length === 0 ? (
        <EmptyState
          icon="messages"
          title={activeFilters ? 'No messages match these filters' : 'No messages yet'}
          description={
            activeFilters
              ? 'Try a wider date range or clear the filters.'
              : 'Rent reminders, receipts, complaint updates and announcements will appear here as they go out.'
          }
        />
      ) : (
        <>
          <div className="space-y-3">
            {centre.rows.map((row) => (
              <MessageCard key={`${row.source}-${row.id}`} row={row} canRetry={canRetry} />
            ))}
          </div>
          {centre.totalUncapped > CENTRE_MAX_PAGE * CENTRE_PAGE_SIZE && centre.page >= CENTRE_MAX_PAGE && (
            <p className="text-center text-xs text-slate-500">
              Showing the latest {CENTRE_MAX_PAGE * CENTRE_PAGE_SIZE} messages. Narrow the dates to see older ones.
            </p>
          )}
          <Suspense fallback={null}>
            <Pagination page={centre.page} pageSize={CENTRE_PAGE_SIZE} total={centre.total} />
          </Suspense>
        </>
      )}
    </div>
  )
}

function ChannelIcon({ channel }: { channel: string }) {
  const cls = 'size-3.5'
  if (channel === 'WHATSAPP') return <MessageCircle className={`${cls} text-emerald-600`} />
  if (channel === 'EMAIL') return <Mail className={`${cls} text-sky-600`} />
  if (channel === 'SMS') return <MessageSquare className={`${cls} text-violet-600`} />
  return <Bell className={`${cls} text-slate-500`} />
}

function MessageCard({ row, canRetry }: { row: CentreRow; canRetry: boolean }) {
  const channelLabel = CENTRE_CHANNEL_LABEL[row.channel as keyof typeof CENTRE_CHANNEL_LABEL] ?? row.channel
  return (
    <Card>
      <CardContent className="p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-900">{row.recipient}</p>
            <p className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
              <ChannelIcon channel={row.channel} />
              {channelLabel}
              {row.source === 'outbound' ? (
                <>
                  {' · '}
                  {row.channel === 'WHATSAPP' ? `+${row.address}` : row.address}
                  {' · '}
                  {row.template ? templateLabel(row.template) : row.subject ?? 'Message'}
                </>
              ) : (
                <> · {ROLE_LABEL[row.recipientRole] ?? row.recipientRole}</>
              )}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {row.source === 'outbound' ? (
              <>
                {row.attempts > 1 && (
                  <Badge variant="info" size="sm">
                    Retried · {row.attempts} tries
                  </Badge>
                )}
                {row.isDemo ? (
                  <Badge variant="warning" size="sm">
                    Demo · not sent
                  </Badge>
                ) : (
                  <DeliveryStatus status={row.status} />
                )}
              </>
            ) : row.readAt ? (
              <Badge variant="success" size="sm">
                Seen
              </Badge>
            ) : (
              <Badge variant="outline" size="sm">
                Unread
              </Badge>
            )}
            <span className="text-xs text-slate-400" title={formatDateTime(row.createdAt)}>
              {relativeTime(row.createdAt)}
            </span>
          </div>
        </div>

        {row.source === 'outbound' && row.channel === 'WHATSAPP' ? (
          // Rendered as a WhatsApp bubble so the owner sees exactly what the resident reads.
          <div className="mt-3 max-w-lg rounded-xl rounded-tl-sm border border-emerald-100 bg-[#dcf8c6]/60 p-3">
            <p className="whitespace-pre-line break-words text-sm leading-relaxed text-slate-800">{row.body}</p>
          </div>
        ) : row.source === 'outbound' ? (
          <div className="mt-3 max-w-lg rounded-xl border border-slate-200 bg-slate-50 p-3">
            {row.subject && <p className="text-sm font-medium text-slate-900">{row.subject}</p>}
            <p className="mt-1 line-clamp-4 whitespace-pre-line break-words text-sm leading-relaxed text-slate-700">{row.body}</p>
          </div>
        ) : (
          <div className="mt-3 max-w-lg rounded-xl border border-slate-200 bg-white p-3">
            <p className="text-sm font-medium text-slate-900">{row.title}</p>
            <p className="mt-0.5 break-words text-sm text-slate-600">{row.body}</p>
          </div>
        )}

        {row.source === 'outbound' && (row.sentAt || row.deliveredAt || row.readAt) && (
          <p className="mt-2 text-[11px] text-slate-400">
            {[
              row.sentAt && `Sent ${formatDateTime(row.sentAt)}`,
              row.deliveredAt && `Delivered ${formatDateTime(row.deliveredAt)}`,
              row.readAt && `Read ${formatDateTime(row.readAt)}`,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        )}

        {row.source === 'outbound' && row.status === 'FAILED' && !row.isDemo ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <p className="min-w-0 flex-1 break-words text-xs text-rose-600">
              {row.error ?? 'Not delivered'}
              {row.attempts > 0 && ` · ${row.attempts} attempt${row.attempts === 1 ? '' : 's'}`}
            </p>
            {row.retryable && canRetry && <RetryButton messageId={row.id} />}
          </div>
        ) : (
          row.source === 'outbound' && row.error && <p className="mt-2 break-words text-xs text-rose-600">{row.error}</p>
        )}
      </CardContent>
    </Card>
  )
}

/** WhatsApp-style ticks: ✓ sent, ✓✓ delivered, blue ✓✓ read. */
function DeliveryStatus({ status }: { status: string }) {
  if (status === 'FAILED') {
    return (
      <Badge variant="danger" size="sm">
        Failed
      </Badge>
    )
  }
  if (status === 'QUEUED') {
    return (
      <Badge variant="outline" size="sm">
        Sending…
      </Badge>
    )
  }
  const ticks = status === 'SENT' ? '✓' : '✓✓'
  const label = status === 'READ' ? 'Read' : status === 'DELIVERED' ? 'Delivered' : 'Sent'
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-500" title={label} aria-label={label}>
      <span className={status === 'READ' ? 'font-bold tracking-tighter text-sky-500' : 'font-bold tracking-tighter text-slate-400'}>
        {ticks}
      </span>
      {label}
    </span>
  )
}
