import type { Metadata } from 'next'
import { Suspense } from 'react'
import { MessageCircle, ShieldAlert } from 'lucide-react'
import { requireAccess } from '@/lib/auth'
import { resolveScope } from '@/lib/tenancy'
import { prisma } from '@/lib/prisma'
import { resolveWhatsAppChannel } from '@/server/integrations/whatsapp'
import { templateLabel } from '@/server/integrations/whatsapp-templates'
import { formatDateTime, relativeTime } from '@/lib/utils'
import { PageHeader } from '@/components/app/page-header'
import { StatCard } from '@/components/app/stat-card'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { EmptyState, TableSkeleton } from '@/components/ui/feedback'
import { FilterBar, FilterSelect, Pagination, SearchInput } from '@/components/app/filters'
import { RetryButton } from './retry-button'

export const metadata: Metadata = { title: 'WhatsApp Outbox' }

const PAGE_SIZE = 25


export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const user = await requireAccess({ module: 'whatsapp', permission: 'messages.view' })
  const params = await searchParams
  await resolveScope(user, params.property)

  const page = Math.max(1, Number(params.page) || 1)
  const q = params.q?.trim() ?? ''
  const template = params.template

  const where = {
    organizationId: user.organizationId,
    ...(template ? { template } : {}),
    ...(q
      ? {
          OR: [
            { toName: { contains: q, mode: 'insensitive' as const } },
            { toAddress: { contains: q } },
            { body: { contains: q, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  }

  const [messages, total, counts, templates] = await Promise.all([
    prisma.outboundMessage.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.outboundMessage.count({ where }),
    prisma.outboundMessage.groupBy({
      by: ['status'],
      where: { organizationId: user.organizationId },
      _count: { _all: true },
    }),
    prisma.outboundMessage.groupBy({
      by: ['template'],
      where: { organizationId: user.organizationId },
      _count: { _all: true },
    }),
  ])

  const channel = await resolveWhatsAppChannel(user.organizationId)
  const live = channel.mode !== 'demo'
  const countFor = (status: string) => counts.find((c) => c.status === status)?._count._all ?? 0
  const activeFilters = [q, template].filter(Boolean).length

  return (
    <div className="space-y-6">
      <PageHeader
        title="WhatsApp Outbox"
        subtitle="Every message the system generated for your residents — rent reminders, receipts, complaint updates and announcements."
        icon="messages"
        breadcrumbs={[{ label: 'Dashboard', href: '/app' }, { label: 'WhatsApp Outbox' }]}
      />

      {/* The demo/live distinction is stated plainly. Nothing here is ever
          presented as delivered when it was not. */}
      <Card className={live ? 'border-emerald-200 bg-emerald-50/50' : 'border-amber-200 bg-amber-50/50'}>
        <CardContent className="flex items-start gap-3 p-5">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white shadow-sm">
            {live ? (
              <MessageCircle className="size-5 text-emerald-600" />
            ) : (
              <ShieldAlert className="size-5 text-amber-600" />
            )}
          </div>
          <div>
            <p className={`text-sm font-semibold ${live ? 'text-emerald-900' : 'text-amber-900'}`}>
              {channel.mode === 'own'
                ? 'Sending from your own WhatsApp Business number'
                : channel.mode === 'platform'
                  ? 'Sending from the StayFlow WhatsApp Business number'
                  : 'Running in demo mode — nothing is delivered'}
            </p>
            <p className={`mt-1 text-sm leading-relaxed ${live ? 'text-emerald-800/80' : 'text-amber-800/80'}`}>
              {live
                ? 'Messages are sent through the WhatsApp Business Cloud API using approved templates. Ticks show sent (✓), delivered (✓✓) and read (blue ✓✓); failed messages show why and can be retried. Owners can switch numbers under Settings → WhatsApp.'
                : 'This deployment has no WhatsApp Business credentials, so messages are written here instead of being sent. Each one is stored exactly as a resident would receive it, and marked “not sent”. Add WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_ACCESS_TOKEN to switch this on.'}
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard label="Messages generated" value={total} icon="messages" tone="blue" />
        <StatCard
          label={live ? 'Sent' : 'Held in demo'}
          value={live ? countFor('SENT') + countFor('DELIVERED') + countFor('READ') : countFor('DEMO_NOT_SENT')}
          icon={live ? 'check' : 'warning'}
          tone={live ? 'emerald' : 'amber'}
        />
        <StatCard label="Failed" value={countFor('FAILED')} icon="warning" tone={countFor('FAILED') ? 'red' : 'emerald'} />
        <StatCard label="Templates in use" value={templates.length} icon="file" tone="violet" />
      </div>

      <Suspense fallback={<TableSkeleton />}>
        <FilterBar activeCount={activeFilters}>
          <SearchInput placeholder="Search recipient or message…" />
          <FilterSelect
            paramKey="template"
            placeholder="All templates"
            options={templates
              .filter((t) => t.template)
              .map((t) => ({
                value: t.template!,
                label: `${templateLabel(t.template)} (${t._count._all})`,
              }))}
          />
        </FilterBar>
      </Suspense>

      {messages.length === 0 ? (
        <EmptyState
          icon="messages"
          title="No messages yet"
          description="Rent reminders go out automatically three days before the due date, on the due date, and after it."
        />
      ) : (
        <>
          <div className="space-y-3">
            {messages.map((message) => (
              <Card key={message.id}>
                <CardContent className="p-4 sm:p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900">
                        {message.toName ?? message.toAddress}
                      </p>
                      <p className="text-xs text-slate-500">
                        +{message.toAddress} ·{' '}
                        {message.template ? templateLabel(message.template) : 'Message'}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {message.isDemo ? (
                        <Badge variant="warning" size="sm">
                          Demo · not sent
                        </Badge>
                      ) : (
                        <DeliveryStatus status={message.status} />
                      )}
                      <span className="text-xs text-slate-400" title={formatDateTime(message.createdAt)}>
                        {relativeTime(message.createdAt)}
                      </span>
                    </div>
                  </div>

                  {/* Rendered as a WhatsApp bubble so the owner sees exactly
                      what the resident would read. */}
                  <div className="mt-3 max-w-lg rounded-2xl rounded-tl-sm border border-emerald-100 bg-[#dcf8c6]/60 p-3">
                    <p className="whitespace-pre-line text-sm leading-relaxed text-slate-800">
                      {message.body}
                    </p>
                  </div>

                  {message.status === 'FAILED' && !message.isDemo ? (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <p className="min-w-0 flex-1 text-xs text-red-600">
                        {message.error ?? 'Not delivered'}
                        {message.attempts > 0 &&
                          ` · ${message.attempts} attempt${message.attempts === 1 ? '' : 's'}`}
                      </p>
                      {message.variables != null && <RetryButton messageId={message.id} />}
                    </div>
                  ) : (
                    message.error && <p className="mt-2 text-xs text-red-600">{message.error}</p>
                  )}
                </CardContent>
              </Card>
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
    <span
      className="inline-flex items-center gap-1 text-xs font-medium text-slate-500"
      title={label}
      aria-label={label}
    >
      <span className={status === 'READ' ? 'font-bold tracking-tighter text-sky-500' : 'font-bold tracking-tighter text-slate-400'}>
        {ticks}
      </span>
      {label}
    </span>
  )
}
