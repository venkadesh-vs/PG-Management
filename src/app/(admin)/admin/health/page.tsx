import type { Metadata } from 'next'
import { CreditCard, Database, HardDrive, Mail, MessageCircle, Server } from 'lucide-react'
import { requireSuperAdmin } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { addDays, cn, formatDateTime, relativeTime } from '@/lib/utils'
import { integrationHealth } from '@/server/services/integration-health'
import { VERDICT_LABEL, VERDICT_VARIANT } from '@/lib/integration-health'
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

  const providers = db.ok ? await integrationHealth(now) : []

  const lastRun = runs.find((r) => r.job === 'daily-automation') ?? runs[0]
  const webhookCount = (s: string) => webhookCounts.find((c) => c.status === s)?._count._all ?? 0
  const failedBy = (c: string) => failedMessages.find((m) => m.channel === c)?._count._all ?? 0
  const lastRunStale = !lastRun || now.getTime() - lastRun.startedAt.getTime() > 26 * 3600_000

  const ICONS = { payment: CreditCard, whatsapp: MessageCircle, email: Mail, storage: HardDrive } as const
  const when = (d: Date | null) => (d ? relativeTime(d) : 'never')

  return (
    <div className="space-y-6">
      <PageHeader
        title="System health"
        subtitle="Is everything running? Database, daily automation, webhooks, message delivery and integrations."
        icon="alert"
        breadcrumbs={[{ label: 'Platform', href: '/admin' }, { label: 'System health' }]}
      />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
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
          tone={!lastRun || lastRun.status === 'FAILED' ? 'red' : lastRun.status === 'PARTIAL' || lastRunStale ? 'amber' : undefined}
          suffix={<span className="text-sm text-slate-500"> h ago</span>}
          hint={lastRun ? `${lastRun.status.toLowerCase()} · ${formatDateTime(lastRun.startedAt)}` : 'No run recorded yet'}
        />
        <StatCard
          label="Webhooks failed (7 days)"
          value={webhookCount('FAILED')}
          icon="warning"
          tone={webhookCount('FAILED') ? 'red' : undefined}
          hint={`${webhookCount('IGNORED')} ignored · ${webhookCount('PROCESSED')} processed`}
        />
        <StatCard
          label="Messages failed (24 h)"
          value={failedBy('WHATSAPP') + failedBy('EMAIL') + failedBy('SMS')}
          icon="messages"
          tone={failedBy('WHATSAPP') + failedBy('EMAIL') + failedBy('SMS') ? 'amber' : undefined}
          hint={`WhatsApp ${failedBy('WHATSAPP')} · Email ${failedBy('EMAIL')}${failedBy('SMS') ? ` · SMS ${failedBy('SMS')}` : ''}`}
        />
      </div>

      <SectionHeader
        title="Integrations"
        description="Mode, last success and failures in the last 7 days, from the webhook log, message log and uploads. Demo means nothing leaves StayFlow."
        icon="shield"
      />
      <Card>
        <CardContent className="flex items-center gap-3 p-4">
          <div className="flex size-9 items-center justify-center rounded-xl bg-slate-100">
            <Server className="size-4 text-slate-500" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-800">App</p>
            <p className="text-xs text-slate-500">
              {process.env.NODE_ENV} · Node {process.version} · up {Math.round(process.uptime() / 60)} min · uptime check: GET /api/health
            </p>
          </div>
        </CardContent>
      </Card>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {providers.map((p) => {
          const Icon = ICONS[p.key]
          const tone = p.verdict === 'failing' ? 'red' : p.verdict === 'degraded' ? 'amber' : p.verdict === 'healthy' ? 'emerald' : 'slate'
          return (
            <Card key={p.key} className="min-w-0">
              <CardContent className="space-y-3 p-4">
                <div className="flex items-center gap-3">
                  <div
                    className={cn(
                      'flex size-9 shrink-0 items-center justify-center rounded-xl',
                      tone === 'red' && 'bg-rose-50',
                      tone === 'amber' && 'bg-amber-50',
                      tone === 'emerald' && 'bg-emerald-50',
                      tone === 'slate' && 'bg-slate-100',
                    )}
                  >
                    <Icon
                      className={cn(
                        'size-4',
                        tone === 'red' && 'text-rose-600',
                        tone === 'amber' && 'text-amber-600',
                        tone === 'emerald' && 'text-emerald-600',
                        tone === 'slate' && 'text-slate-500',
                      )}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-800">{p.name}</p>
                    <p className="truncate text-xs text-slate-500">
                      {p.mode}
                      {p.ownConnections ? ` · ${p.ownConnections} own account${p.ownConnections === 1 ? '' : 's'}` : ''}
                    </p>
                  </div>
                  <Badge variant={VERDICT_VARIANT[p.verdict]} size="sm">
                    {VERDICT_LABEL[p.verdict]}
                  </Badge>
                </div>
                <dl className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-lg bg-slate-50 p-2">
                    <dt className="text-slate-500">Last success</dt>
                    <dd className="font-medium text-slate-800">{when(p.lastSuccessAt)}</dd>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-2">
                    <dt className="text-slate-500">Last failure</dt>
                    <dd className={cn('font-medium', p.lastFailureAt ? 'text-rose-600' : 'text-slate-800')}>{when(p.lastFailureAt)}</dd>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-2">
                    <dt className="text-slate-500">OK (7 days)</dt>
                    <dd className="font-medium tabular text-slate-800">{p.successes}</dd>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-2">
                    <dt className="text-slate-500">Failed (7 days)</dt>
                    <dd className={cn('font-medium tabular', p.failures ? 'text-rose-600' : 'text-slate-800')}>{p.failures}</dd>
                  </div>
                </dl>
                {p.lastError && <p className="line-clamp-2 break-words text-xs text-rose-600">{p.lastError}</p>}
                <p className="text-[11px] text-slate-400">{p.note}</p>
              </CardContent>
            </Card>
          )
        })}
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
                      {run.status.charAt(0) + run.status.slice(1).toLowerCase().replace(/_/g, ' ')}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm tabular text-slate-600">{duration(run.startedAt, run.finishedAt)}</TableCell>
                  <TableCell className="max-w-md">
                    {run.error ? (
                      <p className="line-clamp-3 whitespace-pre-line text-xs text-rose-600">{run.error}</p>
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
                      {w.status.charAt(0) + w.status.slice(1).toLowerCase().replace(/_/g, ' ')}
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
                <dt className="text-xs font-medium text-slate-500">{c === 'WHATSAPP' ? 'WhatsApp' : c === 'SMS' ? 'SMS' : 'Email'}</dt>
                <dd className={cn('font-display text-xl font-semibold tabular', failedBy(c) ? 'text-rose-600' : 'text-slate-900')}>
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
