import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requireRole } from '@/lib/auth'
import { serverEnv } from '@/lib/env'
import { prisma } from '@/lib/prisma'
import { formatDateTime, relativeTime } from '@/lib/utils'
import { prefsGrid, typeForTemplate } from '@/lib/notification-prefs'
import { getWhatsAppConnection } from '@/server/integrations/whatsapp'
import { WHATSAPP_TEMPLATES } from '@/server/integrations/whatsapp-templates'
import { getNotificationPrefs } from '@/server/services/notification-settings'
import { PageHeader } from '@/components/app/page-header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { NotificationSwitches } from '@/components/settings/notification-switches'
import { WhatsAppConnect } from './whatsapp-connect'
import { OptOutList, TemplateList, TestMessageForm } from './whatsapp-tools'

export const metadata: Metadata = { title: 'WhatsApp Business' }

export default async function WhatsAppSettingsPage() {
  const user = await requireRole('OWNER')
  if (!user.organizationId) redirect('/login')
  const organizationId = user.organizationId
  const moduleOn = user.modules.includes('whatsapp')
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

  const [connection, prefs, week, lastFailure, lastSent, optOuts, residents] = await Promise.all([
    getWhatsAppConnection(organizationId),
    getNotificationPrefs(organizationId),
    prisma.outboundMessage.groupBy({
      by: ['status'],
      where: { organizationId, channel: 'WHATSAPP', createdAt: { gte: weekAgo } },
      _count: { _all: true },
    }),
    prisma.outboundMessage.findFirst({
      where: { organizationId, channel: 'WHATSAPP', status: 'FAILED', isDemo: false },
      orderBy: { createdAt: 'desc' },
      select: { error: true, createdAt: true, toName: true },
    }),
    prisma.outboundMessage.findFirst({
      where: { organizationId, channel: 'WHATSAPP', status: { in: ['SENT', 'DELIVERED', 'READ'] } },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    }),
    prisma.resident.findMany({
      where: { organizationId, whatsappOptOutAt: { not: null } },
      select: {
        id: true,
        fullName: true,
        phone: true,
        whatsappPhone: true,
        status: true,
        whatsappOptOutAt: true,
        property: { select: { name: true } },
      },
      orderBy: { whatsappOptOutAt: 'desc' },
      take: 500,
    }),
    prisma.resident.findMany({
      where: { organizationId, status: { in: ['ACTIVE', 'NOTICE', 'PENDING'] } },
      select: { id: true, fullName: true },
      orderBy: { fullName: 'asc' },
      take: 500,
    }),
  ])

  const templates = Object.entries(WHATSAPP_TEMPLATES).map(([name, def]) => ({
    name,
    label: def.label,
    category: def.category,
    language: def.language,
    body: def.body,
    variables: [...def.variables],
    note: 'note' in def ? def.note : undefined,
    testable: typeForTemplate(name) !== 'ACCOUNT_ACCESS',
  }))

  const count = (s: string) => week.find((w) => w.status === s)?._count._all ?? 0
  const weekSent = count('SENT') + count('DELIVERED') + count('READ')

  return (
    <div className="space-y-6">
      <PageHeader
        title="WhatsApp Business"
        subtitle="Choose which WhatsApp number your residents hear from, test it, and control which messages go out."
        icon="messages"
        breadcrumbs={[
          { label: 'Dashboard', href: '/app' },
          { label: 'Settings', href: '/app/settings' },
          { label: 'WhatsApp' },
        ]}
      />

      {!moduleOn && (
        <Card className="border-amber-200 bg-amber-50/50">
          <CardContent className="p-5 text-sm text-amber-800">
            The WhatsApp feature is switched off for your account, so nothing is sent except login
            links. Turn it on under{' '}
            <Link href="/app/settings?tab=features" className="font-medium underline">
              Settings → Features
            </Link>
            .
          </CardContent>
        </Card>
      )}

      <WhatsAppConnect initial={connection} webhookUrl={`${serverEnv.appUrl}/api/webhooks/whatsapp`} />

      <Card>
        <CardHeader>
          <CardTitle>Delivery health — last 7 days</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Metric label="Sent" value={weekSent} />
            <Metric label="Read" value={count('READ')} />
            <Metric label="Failed" value={count('FAILED')} tone={count('FAILED') ? 'red' : undefined} />
            <Metric label="Demo (not sent)" value={count('DEMO_NOT_SENT')} />
          </dl>
          <p className="text-sm text-slate-600">
            Last successful send:{' '}
            <span className="font-medium text-slate-900">
              {lastSent ? `${relativeTime(lastSent.createdAt)} (${formatDateTime(lastSent.createdAt)})` : 'never'}
            </span>
          </p>
          {lastFailure && (
            <p className="break-words text-sm text-red-600">
              Last error {relativeTime(lastFailure.createdAt)}
              {lastFailure.toName ? ` (to ${lastFailure.toName})` : ''}: {lastFailure.error ?? 'Not delivered'}
            </p>
          )}
          <Link href="/app/messages?channel=WHATSAPP" className="inline-block text-sm font-medium text-blue-700 hover:underline">
            Open the Message centre →
          </Link>
        </CardContent>
      </Card>

      {moduleOn && (
        <Card>
          <CardHeader>
            <CardTitle>Send a test message</CardTitle>
            <p className="text-sm leading-relaxed text-slate-500">
              Sends one template with sample values to your phone, the same way residents get
              messages. With your own number, the template must already be approved in WhatsApp
              Manager.
            </p>
          </CardHeader>
          <CardContent>
            <TestMessageForm templates={templates} mode={connection.mode} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Which messages go out on WhatsApp</CardTitle>
          <p className="text-sm leading-relaxed text-slate-500">
            Switch a message type off to stop its WhatsApp copy; in-app messages are set in{' '}
            <Link href="/app/settings/notifications" className="font-medium text-blue-700 hover:underline">
              Notification settings
            </Link>
            .
          </p>
        </CardHeader>
        <CardContent>
          <NotificationSwitches initialGrid={prefsGrid(prefs)} canEdit whatsappModuleOn={moduleOn} only="WHATSAPP" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Opted out (replied STOP)</CardTitle>
          <p className="text-sm leading-relaxed text-slate-500">
            WhatsApp rules: anyone who replies STOP gets no more messages until they send START or ask
            you in person. Every change here is recorded in the activity log.
          </p>
        </CardHeader>
        <CardContent>
          <OptOutList
            initial={optOuts.map((r) => ({
              id: r.id,
              fullName: r.fullName,
              phone: r.whatsappPhone || r.phone,
              status: r.status,
              property: r.property.name,
              optedOutAt: r.whatsappOptOutAt!.toISOString(),
            }))}
            residents={residents}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Message templates</CardTitle>
          <p className="text-sm leading-relaxed text-slate-500">
            WhatsApp only delivers business messages that use a template Meta has approved. If you
            connect your own number, create each of these in WhatsApp Manager → Message templates
            with exactly this name, category, language and text. Approval usually takes minutes to a
            day; until a template is approved, messages using it fail and can be retried from the
            Message centre.
          </p>
        </CardHeader>
        <CardContent>
          <TemplateList templates={templates} />
        </CardContent>
      </Card>
    </div>
  )
}

function Metric({ label, value, tone }: { label: string; value: number; tone?: 'red' }) {
  return (
    <div className="rounded-xl border border-slate-200 p-3">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className={`mt-0.5 text-lg font-semibold ${tone === 'red' ? 'text-red-600' : 'text-slate-900'}`}>{value}</dd>
    </div>
  )
}
