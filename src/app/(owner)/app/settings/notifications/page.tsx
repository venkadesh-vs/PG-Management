import type { Metadata } from 'next'
import Link from 'next/link'
import { requireAccess } from '@/lib/auth'
import { prefsGrid } from '@/lib/notification-prefs'
import { getNotificationPrefs } from '@/server/services/notification-settings'
import { PageHeader } from '@/components/app/page-header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { NotificationSwitches } from '@/components/settings/notification-switches'

export const metadata: Metadata = { title: 'Notification settings' }

export default async function NotificationSettingsPage() {
  const user = await requireAccess({ permission: 'settings.manage' })
  const grid = prefsGrid(await getNotificationPrefs(user.organizationId))
  const whatsappOn = user.modules.includes('whatsapp')

  return (
    <div className="space-y-6">
      <PageHeader
        title="Notification settings"
        subtitle="Choose which messages your residents get, and on which channel. Everything is on until you switch it off."
        icon="bell"
        breadcrumbs={[
          { label: 'Dashboard', href: '/app' },
          { label: 'Settings', href: '/app/settings' },
          { label: 'Notifications' },
        ]}
      />

      <Card>
        <CardHeader>
          <CardTitle>What residents receive</CardTitle>
          <p className="text-sm leading-relaxed text-slate-500">
            In-app messages show in the resident app’s bell. WhatsApp messages need the resident’s
            consent and are never sent to anyone who replied STOP. Alerts to you and your team are
            always on. Changes save immediately and are recorded in the activity log.
          </p>
          {!whatsappOn && (
            <p className="text-sm text-amber-700">
              The WhatsApp feature is off for your account, so no WhatsApp messages go out whatever
              these switches say. Turn it on under{' '}
              <Link href="/app/settings?tab=features" className="font-medium underline">
                Settings → Features
              </Link>
              .
            </p>
          )}
        </CardHeader>
        <CardContent>
          <NotificationSwitches initialGrid={grid} canEdit whatsappModuleOn={whatsappOn} />
        </CardContent>
      </Card>

      <p className="text-sm text-slate-500">
        See every message that went out in the{' '}
        <Link href="/app/messages" className="font-medium text-blue-700 hover:underline">
          Message centre
        </Link>
        {whatsappOn && (
          <>
            {' '}· test WhatsApp and see opt-outs in{' '}
            <Link href="/app/settings/whatsapp" className="font-medium text-blue-700 hover:underline">
              WhatsApp settings
            </Link>
          </>
        )}
        .
      </p>
    </div>
  )
}
