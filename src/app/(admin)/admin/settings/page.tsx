import type { Metadata } from 'next'
import { CreditCard, Database, MessageCircle, ShieldCheck, Timer } from 'lucide-react'
import { requireSuperAdmin } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { serverEnv } from '@/lib/env'
import { paymentMode } from '@/server/integrations/payments'
import { whatsappMode } from '@/server/integrations/whatsapp'
import { cn, formatDateTime } from '@/lib/utils'
import { PageHeader, SectionHeader } from '@/components/app/page-header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

export const metadata: Metadata = { title: 'System Settings' }

export default async function SystemSettingsPage() {
  await requireSuperAdmin()

  const [settings, counts, lastAutomation] = await Promise.all([
    prisma.systemSetting.findMany({ orderBy: { key: 'asc' } }),
    Promise.all([
      prisma.organization.count(),
      prisma.property.count(),
      prisma.resident.count(),
      prisma.rentInvoice.count(),
      prisma.rentPayment.count(),
      prisma.outboundMessage.count(),
      prisma.activityLog.count(),
    ]),
    prisma.activityLog.findFirst({
      where: { actorName: 'Automation' },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true, summary: true },
    }),
  ])

  const [orgs, properties, residents, invoices, payments, messages, logs] = counts
  const whatsapp = whatsappMode()
  const payment = paymentMode()
  const cronConfigured = Boolean(serverEnv.cronSecret)

  return (
    <div className="space-y-6">
      <PageHeader
        title="System settings"
        subtitle="How this deployment is configured, and what is connected."
        icon="settings"
        breadcrumbs={[{ label: 'Platform', href: '/admin' }, { label: 'System Settings' }]}
      />

      <SectionHeader title="Integrations" description="Nothing is faked — an unconfigured integration says so." icon="shield" />
      <div className="grid gap-4 lg:grid-cols-3">
        <IntegrationCard
          icon={MessageCircle}
          name="WhatsApp Business"
          live={whatsapp === 'meta'}
          liveCopy="Connected to the WhatsApp Business Cloud API. Reminders and receipts are delivered through approved templates."
          demoCopy="Not connected. Messages are stored in each organization's outbox marked as not sent. Set WHATSAPP_PROVIDER=meta with WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_ACCESS_TOKEN."
        />
        <IntegrationCard
          icon={CreditCard}
          name="Payment gateway"
          live={payment === 'live'}
          liveCopy="Orders are created with the gateway and payments are only confirmed from the verified webhook."
          demoCopy="Not connected. Resident payments and subscription AutoPay run as labelled simulations, and every record they write is flagged isDemo. Set PAYMENT_PROVIDER, PAYMENT_KEY_ID and PAYMENT_KEY_SECRET."
        />
        <IntegrationCard
          icon={Timer}
          name="Automation runner"
          live={cronConfigured}
          liveCopy="POST /api/cron/run is protected by CRON_SECRET. Point a scheduler at it once a day."
          demoCopy="CRON_SECRET is not set, so the automation endpoint is closed. Automations can still be triggered by hand from the owner dashboard."
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Database className="size-4 text-slate-400" />
              Database
            </CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2.5 text-sm">
              <Stat label="Organizations" value={orgs} />
              <Stat label="Properties" value={properties} />
              <Stat label="Residents" value={residents} />
              <Stat label="Rent invoices" value={invoices} />
              <Stat label="Payments" value={payments} />
              <Stat label="Outbound messages" value={messages} />
              <Stat label="Activity log entries" value={logs} />
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Timer className="size-4 text-slate-400" />
              Automation
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm leading-relaxed text-slate-600">
              One daily pass generates rent, flags overdue invoices, applies late fees, sends
              reminders, bills subscriptions, enforces grace periods and snapshots occupancy.
            </p>
            <div className="rounded-xl bg-slate-50 p-3">
              <p className="text-sm font-semibold text-slate-900">
                Last automated action
              </p>
              {lastAutomation ? (
                <>
                  <p className="mt-1 text-sm text-slate-700">{lastAutomation.summary}</p>
                  <p className="text-xs text-slate-400">
                    {formatDateTime(lastAutomation.createdAt)}
                  </p>
                </>
              ) : (
                <p className="mt-1 text-sm text-slate-500">
                  The automation has not run on this deployment yet.
                </p>
              )}
            </div>
            <div className="rounded-xl border border-slate-200 p-3">
              <p className="font-mono text-xs text-slate-600">
                POST /api/cron/run
                <br />
                Authorization: Bearer &lt;CRON_SECRET&gt;
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {settings.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Platform values</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-slate-100">
              {settings
                .filter((s) => !s.key.startsWith('invoice:') && !s.key.startsWith('receipt:'))
                .map((setting) => (
                  <li key={setting.id} className="flex items-start justify-between gap-3 py-2.5">
                    <span className="font-mono text-xs text-slate-500">{setting.key}</span>
                    <span className="max-w-xs truncate text-right font-mono text-xs text-slate-700">
                      {JSON.stringify(setting.value)}
                    </span>
                  </li>
                ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-semibold text-slate-900 tabular">{value.toLocaleString('en-IN')}</dd>
    </div>
  )
}

function IntegrationCard({
  icon: Icon,
  name,
  live,
  liveCopy,
  demoCopy,
}: {
  icon: React.ElementType
  name: string
  live: boolean
  liveCopy: string
  demoCopy: string
}) {
  return (
    <Card className={cn(live ? 'border-emerald-200' : 'border-amber-200')}>
      <CardContent className="space-y-3 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div
              className={cn(
                'flex size-9 items-center justify-center rounded-xl',
                live ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600',
              )}
            >
              <Icon className="size-4" />
            </div>
            <p className="text-sm font-semibold text-slate-900">{name}</p>
          </div>
          <Badge variant={live ? 'success' : 'warning'} size="sm">
            {live ? 'Connected' : 'Demo mode'}
          </Badge>
        </div>
        <p className="text-sm leading-relaxed text-slate-600">{live ? liveCopy : demoCopy}</p>
        {live && (
          <p className="flex items-center gap-1.5 text-xs text-emerald-700">
            <ShieldCheck className="size-3.5" />
            Credentials stay server-side.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
