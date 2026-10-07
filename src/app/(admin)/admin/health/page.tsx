import type { Metadata } from 'next'
import { CreditCard, Database, HardDrive, Mail, MessageCircle, Server } from 'lucide-react'
import { requireSuperAdmin } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { addDays, cn, formatDateTime, relativeTime } from '@/lib/utils'
import { paymentMode } from '@/server/integrations/payments'
import { whatsappMode } from '@/server/integrations/whatsapp'
import { emailMode } from '@/server/integrations/email'
import { storageProvider } from '@/server/storage'
import { PageHeader, SectionHeader } from '@/components/app/page-header'
import { StatCard } from '@/components/app/stat-card'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/feedback'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableWrap,
} from '@/components/ui/table'
import { RetryWebhooksButton } from './retry-webhooks-button'

export const metadata: Metadata = { title: 'System health' }
export const dynamic = 'force-dynamic'

const CRON_VARIANT: Record<string, 'success' | 'warning' | 'danger' | 'info'> = {
  SUCCESS: 'success',
  PARTIAL: 'warning',
  FAILED: 'danger',
  RUNNING: 'info',
}

function duration(start: Date, end: Date | null) {
  if (!end) return '—'
  const ms = end.getTime() - start.getTime()
  if (ms < 1000) return `${ms} ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`
  return `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`
}

async function dbCheck() {
  const started = performance.now()
  try {
    await prisma.$queryRaw`SELECT 1`
    return { ok: true, ms: Math.round(performance.now() - started), error: null as string | null }
  } catch (error) {
    return { ok: false, ms: Math.round(performance.now() - started), error: error instanceof Error ? error.message : String(error) }
  }
}

export default async function HealthPage() {
  await requireSuperAdmin()
  const now = new Date()
  const db = await dbCheck()

  const [runs, webhooks, webhookCounts, failedMessages] = db.ok
    ? await Promise.all([
        prisma.cronRun.findMany({ orderBy: { startedAt: 'desc' }, take: 15 }),
        prisma.webhookEvent.findMany({
          where: { status: { in: ['FAILED', 'IGNORED'] }, receivedAt: { gte: addDays(now, -7) } },
          orderBy: { receivedAt: 'desc' },
          take: 25,
          select: { id: true, provider: true, eventId: true, type: true, status: true, error: true, attempts: true, receivedAt: true },
        }),
        prisma.webhookEvent.groupBy({
          by: ['status'],
          where: { receivedAt: { gte: addDays(now, -7) } },
          _count: { _all: true },
        }),
        prisma.outboundMessage.groupBy({
          by: ['channel'],
          where: { status: 'FAILED', createdAt: { gte: addDays(now, -1) } },
          _count: { _all: true },
        }),
      ])
    : [[], [], [], []]

  const lastRun = runs.find((r) => r.job === 'daily-automation') ?? runs[0]
  const webhookCount = (s: string) => webhookCounts.find((c) => c.status === s)?._count._all ?? 0
  const failedBy = (c: string) => failedMessages.find((m) => m.channel === c)?._count._all ?? 0
  const lastRunStale = !lastRun || now.getTime() - lastRun.startedAt.getTime() > 26 * 3600_000

  const integrations = [
    { name: 'Payments (Razorpay)', icon: CreditCard, live: paymentMode() === 'live' },
    { name: 'WhatsApp', icon: MessageCircle, live: whatsappMode() === 'meta' },
    { name: 'Email', icon: Mail, live: emailMode() !== 'demo' },
    { name: 'File storage', icon: HardDrive, live: storageProvider() === 's3', demoLabel: 'Local disk' },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="System health"
        subtitle="Is everything running? Database, daily automation, webhooks, message delivery and integrations."
        icon="alert"
        breadcrumbs={[{ label: 'Platform', href: '/admin' }, { label: 'System health' }]}
      />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard
          label="Database"
          value={db.ms}
          icon="settings"
          tone={db.ok ? (db.ms > 500 ? 'amber' : 'emerald') : 'red'}
          suffix={<span className="text-sm text-slate-500"> ms</span>}
          hint={db.ok ? 'SELECT 1 answered' : `Unreachable: ${db.error}`}
        />
        <StatCard
          label="Last automation run"
          value={lastRun ? Math.round((now.getTime() - lastRun.startedAt.getTime()) / 3600_000) : 0}
          icon="clock"
          tone={!lastRun || lastRun.status === 'FAILED' ? 'red' : lastRun.status === 'PARTIAL' || lastRunStale ? 'amber' : 'emerald'}
          suffix={<span className="text-sm text-slate-500"> h ago</span>}
          hint={lastRun ? `${lastRun.status.toLowerCase()} · ${formatDateTime(lastRun.startedAt)}` : 'No run recorded yet'}
        />
        <StatCard
          label="Webhooks failed (7 days)"
          value={webhookCount('FAILED')}
          icon="warning"
          tone={webhookCount('FAILED') ? 'red' : 'emerald'}
          hint={`${webhookCount('IGNORED')} ignored · ${webhookCount('PROCESSED')} processed`}
        />
        <StatCard
          label="Messages failed (24 h)"
          value={failedBy('WHATSAPP') + failedBy('EMAIL') + failedBy('SMS')}
          icon="messages"
          tone={failedBy('WHATSAPP') + failedBy('EMAIL') + failedBy('SMS') ? 'amber' : 'emerald'}
          hint={`WhatsApp ${failedBy('WHATSAPP')} · Email ${failedBy('EMAIL')}${failedBy('SMS') ? ` · SMS ${failedBy('SMS')}` : ''}`}
        />
      </div>

      <SectionHeader title="Integrations" description="Demo mode means nothing leaves StayFlow — records are labelled as simulations." icon="shield" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex size-9 items-center justify-center rounded-xl bg-slate-100">
              <Server className="size-4 text-slate-500" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-800">App</p>
              <p className="text-xs text-slate-500">
                {process.env.NODE_ENV} · Node {process.version} · up {Math.round(process.uptime() / 60)} min
              </p>
            </div>
          </CardContent>
        </Card>
        {integrations.map((i) => (
          <Card key={i.name}>
            <CardContent className="flex items-center gap-3 p-4">
              <div className={cn('flex size-9 items-center justify-center rounded-xl', i.live ? 'bg-emerald-50' : 'bg-amber-50')}>
                <i.icon className={cn('size-4', i.live ? 'text-emerald-600' : 'text-amber-600')} />
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-800">{i.name}</p>
                <Badge variant={i.live ? 'success' : 'warning'} size="sm">
                  {i.live ? 'Live' : (i.demoLabel ?? 'Demo')}
                </Badge>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <SectionHeader title="Automation runs" description="Each daily pass, newest first." icon="history" />
      {runs.length === 0 ? (
        <EmptyState
          icon="clock"
          title="No runs recorded yet"
          description="Runs appear here once the daily automation (POST /api/cron/run) has run."
        />
      ) : (
        <TableWrap>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Started</TableHead>
                <TableHead>Job</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Errors</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.map((run) => (
                <TableRow key={run.id}>
                  <TableCell className="whitespace-nowrap text-sm text-slate-700">
                    {formatDateTime(run.startedAt)}
                    <p className="text-xs text-slate-400">{relativeTime(run.startedAt)}</p>
                  </TableCell>
                  <TableCell className="text-sm text-slate-600">{run.job}</TableCell>
                  <TableCell>
                    <Badge variant={CRON_VARIANT[run.status] ?? 'info'} size="sm">
                      {run.status.toLowerCase()}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm tabular text-slate-600">{duration(run.startedAt, run.finishedAt)}</TableCell>
                  <TableCell className="max-w-md">
                    {run.error ? (
                      <p className="line-clamp-3 whitespace-pre-line text-xs text-red-600">{run.error}</p>
                    ) : (
                      <span className="text-xs text-slate-400">None</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableWrap>
      )}

      <SectionHeader
        title="Webhook problems (last 7 days)"
        description="Failed events are replayed nightly (up to 5 attempts). Ignored events were received but not relevant."
        icon="warning"
        actions={<RetryWebhooksButton disabled={!webhookCount('FAILED')} />}
      />
      {webhooks.length === 0 ? (
        <EmptyState compact icon="check" title="All webhooks went through" description="No failed or ignored events this week." />
      ) : (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{webhooks.length} recent events</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-slate-100">
              {webhooks.map((w) => (
                <li key={w.id} className="flex flex-wrap items-start justify-between gap-2 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-800">
                      {w.provider} · {w.type}
                    </p>
                    <p className="truncate font-mono text-[11px] text-slate-400">{w.eventId}</p>
                    {w.error && <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{w.error}</p>}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <Badge variant={w.status === 'FAILED' ? 'danger' : 'default'} size="sm">
                      {w.status.toLowerCase()}
                    </Badge>
                    <span className="text-[11px] text-slate-400">
                      {w.attempts} attempt{w.attempts === 1 ? '' : 's'} · {relativeTime(w.receivedAt)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Database className="size-4 text-slate-400" />
            Failed messages by channel (last 24 hours)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-3 gap-3 text-center">
            {(['WHATSAPP', 'EMAIL', 'SMS'] as const).map((c) => (
              <div key={c} className="rounded-xl bg-slate-50 p-3">
                <dt className="text-[11px] uppercase tracking-wide text-slate-500">{c === 'WHATSAPP' ? 'WhatsApp' : c.toLowerCase()}</dt>
                <dd className={cn('font-display text-xl font-semibold tabular', failedBy(c) ? 'text-red-600' : 'text-slate-900')}>
                  {failedBy(c)}
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-2 text-xs text-slate-500">
            WhatsApp failures are retried automatically by the daily run. Owners see each message in their outbox.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
