import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { requireRole } from '@/lib/auth'
import { serverEnv } from '@/lib/env'
import { getWhatsAppConnection } from '@/server/integrations/whatsapp'
import { WHATSAPP_TEMPLATES } from '@/server/integrations/whatsapp-templates'
import { PageHeader } from '@/components/app/page-header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { WhatsAppConnect } from './whatsapp-connect'

export const metadata: Metadata = { title: 'WhatsApp Business' }

export default async function WhatsAppSettingsPage() {
  const user = await requireRole('OWNER')
  if (!user.organizationId) redirect('/login')

  const connection = await getWhatsAppConnection(user.organizationId)
  const templates = Object.entries(WHATSAPP_TEMPLATES).map(([name, def]) => ({ name, ...def }))

  return (
    <div className="space-y-6">
      <PageHeader
        title="WhatsApp Business"
        subtitle="Choose which WhatsApp number your residents hear from. By default messages go out from the StayFlow number; connect your own to send under your PG's name."
        icon="messages"
        breadcrumbs={[
          { label: 'Dashboard', href: '/app' },
          { label: 'Settings', href: '/app/settings' },
          { label: 'WhatsApp' },
        ]}
      />

      <WhatsAppConnect
        initial={connection}
        webhookUrl={`${serverEnv.appUrl}/api/webhooks/whatsapp`}
      />

      <Card>
        <CardHeader>
          <CardTitle>Message templates</CardTitle>
          <p className="text-sm leading-relaxed text-slate-500">
            WhatsApp only delivers business messages that use a template Meta has approved. If you
            connect your own number, create each of these in WhatsApp Manager → Message templates
            with exactly this name, category, language and text. Approval usually takes minutes to
            a day; until a template is approved, messages using it fail and can be retried from the
            outbox.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {templates.map((t) => (
            <div key={t.name} className="rounded-xl border border-slate-200 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-semibold text-slate-800">
                  {t.name}
                </code>
                <Badge variant="blue" size="sm">
                  {t.category}
                </Badge>
                <Badge variant="outline" size="sm">
                  {t.language}
                </Badge>
                <span className="text-xs text-slate-500">{t.label}</span>
              </div>
              <p className="mt-3 select-all whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-3 font-mono text-xs leading-relaxed text-slate-800">
                {t.body}
              </p>
              <p className="mt-2 text-xs text-slate-500">
                Variables: {t.variables.map((v, i) => `{{${i + 1}}} ${v}`).join(' · ')}
              </p>
              {'note' in t && t.note && <p className="mt-1 text-xs text-amber-700">{t.note}</p>}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
