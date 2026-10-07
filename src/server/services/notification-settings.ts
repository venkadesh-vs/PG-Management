import 'server-only'

import type { Prisma, UserRole } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import {
  applyPrefChanges,
  isChannelOn,
  parseNotificationPrefs,
  CHANNEL_LABEL,
  NOTIFICATION_TYPES,
  type NotificationPrefs,
  type NotificationType,
  type PrefChannel,
} from '@/lib/notification-prefs'
import { recordActivity } from '@/server/events'

/**
 * The one place senders ask "should this go out?". Defaults to ON: an org
 * without a settings row, or with nothing stored, behaves exactly as before.
 */

type Db = Prisma.TransactionClient | typeof prisma

export async function getNotificationPrefs(organizationId: string, db: Db = prisma): Promise<NotificationPrefs> {
  const row = await db.orgSetting.findUnique({
    where: { organizationId },
    select: { notificationSettings: true },
  })
  return parseNotificationPrefs(row?.notificationSettings)
}

/**
 * Pass the transaction client when called inside one: on a pooled
 * single-connection database a second client would wait on the first.
 */
export async function channelEnabled(
  organizationId: string | null | undefined,
  type: NotificationType | null | undefined,
  channel: PrefChannel,
  db: Db = prisma,
): Promise<boolean> {
  if (!organizationId || !type) return true
  return isChannelOn(await getNotificationPrefs(organizationId, db), type, channel)
}

export async function saveNotificationPrefs(
  actor: { id: string; name: string; role: UserRole; organizationId: string },
  changes: { type: string; channel: string; enabled: boolean }[],
) {
  const before = await getNotificationPrefs(actor.organizationId)
  const after = applyPrefChanges(before, changes)
  await prisma.orgSetting.upsert({
    where: { organizationId: actor.organizationId },
    create: { organizationId: actor.organizationId, notificationSettings: after as unknown as Prisma.InputJsonValue },
    update: { notificationSettings: after as unknown as Prisma.InputJsonValue },
  })

  const changed = changes
    .filter((c) => c.type in NOTIFICATION_TYPES)
    .filter((c) => isChannelOn(before, c.type as NotificationType, c.channel as PrefChannel) !== isChannelOn(after, c.type as NotificationType, c.channel as PrefChannel))
  if (changed.length) {
    await recordActivity({
      organizationId: actor.organizationId,
      actorId: actor.id,
      actorName: actor.name,
      actorRole: actor.role,
      event: 'SETTINGS_UPDATED',
      entityType: 'NotificationSettings',
      summary:
        'Notification settings: ' +
        changed
          .map(
            (c) =>
              `${NOTIFICATION_TYPES[c.type as NotificationType].label} by ${CHANNEL_LABEL[c.channel as PrefChannel]} ${c.enabled ? 'on' : 'off'}`,
          )
          .join(', '),
      before: before as unknown as Prisma.InputJsonValue,
      after: after as unknown as Prisma.InputJsonValue,
    })
  }
  return after
}
