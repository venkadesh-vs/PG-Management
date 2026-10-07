import { z } from 'zod'
import { parseBody, route } from '@/lib/api-helpers'
import { prefsGrid } from '@/lib/notification-prefs'
import { getNotificationPrefs, saveNotificationPrefs } from '@/server/services/notification-settings'

/**
 * /api/settings/notifications — which messages residents receive, per type
 * and channel. Needs settings.manage. Every change is audited.
 *
 * GET  → { grid: { RENT_REMINDER: { IN_APP: true, WHATSAPP: false }, … } }
 * POST { changes: [{ type, channel, enabled }] } → { grid }
 *      Locked types (login links) and channels a type is not sent on are ignored.
 */

const schema = z.object({
  changes: z
    .array(
      z.object({
        type: z.string().min(1).max(40),
        channel: z.enum(['IN_APP', 'WHATSAPP', 'EMAIL']),
        enabled: z.boolean(),
      }),
    )
    .min(1, 'Nothing to change')
    .max(60),
})

export const GET = route(
  async ({ user }) => ({ grid: prefsGrid(await getNotificationPrefs(user.organizationId!)) }),
  { permission: 'settings.manage' },
)

export const POST = route(
  async ({ user, request }) => {
    const { changes } = await parseBody(request, schema)
    const prefs = await saveNotificationPrefs(
      { id: user.id, name: user.name, role: user.role, organizationId: user.organizationId! },
      changes,
    )
    return { grid: prefsGrid(prefs), message: 'Notification settings saved' }
  },
  { permission: 'settings.manage' },
)
