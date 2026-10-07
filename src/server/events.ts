import 'server-only'

import type { EventType, NotificationKind, Prisma, UserRole } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { isChannelOn, parseNotificationPrefs, typeForKind, type NotificationType } from '@/lib/notification-prefs'

/**
 * Event + audit architecture.
 *
 * Business services call `recordActivity` inside their transaction so the
 * audit trail can never drift from the data, and `notifyUsers` / `notifyOrg`
 * afterwards for the fan-out that must not roll a transaction back (a failed
 * WhatsApp send should not undo a recorded payment).
 */

export type ActivityInput = {
  organizationId?: string | null
  propertyId?: string | null
  actorId?: string | null
  actorName?: string | null
  actorRole?: UserRole | null
  event: EventType
  entityType?: string
  entityId?: string
  summary: string
  meta?: Prisma.InputJsonValue
  /** Caller IP; filled from the request automatically when omitted. */
  ip?: string
  /** For audited edits: the values before and after the change. */
  before?: Prisma.InputJsonValue
  after?: Prisma.InputJsonValue
}

type Tx = Prisma.TransactionClient | typeof prisma

/** IP and device of the current request, when there is one (not in cron/CLI). */
async function requestContext(): Promise<{ ip: string | null; userAgent: string | null }> {
  try {
    const { headers } = await import('next/headers')
    const h = await headers()
    const ip = h.get('x-nf-client-connection-ip') ?? h.get('x-real-ip') ?? (h.get('x-forwarded-for') ?? '').split(',').pop()?.trim() ?? null
    return { ip: ip || null, userAgent: h.get('user-agent')?.slice(0, 250) ?? null }
  } catch {
    return { ip: null, userAgent: null }
  }
}

/**
 * Append-only audit trail. There is no update or delete path for activity
 * rows anywhere in the product; corrections are new entries.
 */
export async function recordActivity(input: ActivityInput, tx: Tx = prisma) {
  const ctx = await requestContext()
  return tx.activityLog.create({
    data: {
      organizationId: input.organizationId ?? null,
      propertyId: input.propertyId ?? null,
      actorId: input.actorId ?? null,
      actorName: input.actorName ?? null,
      actorRole: input.actorRole ?? null,
      event: input.event,
      entityType: input.entityType,
      entityId: input.entityId,
      summary: input.summary,
      meta: input.meta,
      ip: input.ip ?? ctx.ip,
      userAgent: ctx.userAgent,
      before: input.before,
      after: input.after,
    },
  })
}

export type NotificationInput = {
  organizationId?: string | null
  kind: NotificationKind
  title: string
  body: string
  link?: string
  /**
   * Which owner switch (Settings → Notifications) governs this message to a
   * resident. Defaults from `kind`. Only notifyResident consults it.
   */
  type?: NotificationType
}

/** Deliver an in-app notification to specific users. */
export async function notifyUsers(userIds: string[], input: NotificationInput, tx: Tx = prisma) {
  const ids = [...new Set(userIds.filter(Boolean))]
  if (!ids.length) return
  await tx.notification.createMany({
    data: ids.map((userId) => ({
      userId,
      organizationId: input.organizationId ?? null,
      kind: input.kind,
      title: input.title,
      body: input.body,
      link: input.link,
    })),
  })
}

/** Deliver to every owner/manager of an organization. */
export async function notifyOrgAdmins(
  organizationId: string,
  input: NotificationInput,
  tx: Tx = prisma,
) {
  const admins = await tx.user.findMany({
    where: { organizationId, role: { in: ['OWNER', 'MANAGER'] }, status: 'ACTIVE' },
    select: { id: true },
  })
  await notifyUsers(
    admins.map((a) => a.id),
    { ...input, organizationId },
    tx,
  )
}

/** Deliver to every platform super admin. */
export async function notifySuperAdmins(input: NotificationInput, tx: Tx = prisma) {
  const admins = await tx.user.findMany({
    where: { role: 'SUPER_ADMIN', status: 'ACTIVE' },
    select: { id: true },
  })
  await notifyUsers(
    admins.map((a) => a.id),
    input,
    tx,
  )
}

/** Deliver to a resident's tenant account, if one exists. */
export async function notifyResident(
  residentId: string,
  input: NotificationInput,
  tx: Tx = prisma,
) {
  const resident = await tx.resident.findUnique({
    where: { id: residentId },
    select: { userId: true, organizationId: true },
  })
  if (!resident?.userId) return
  // The owner may have switched this type off for the in-app channel.
  const type = input.type ?? typeForKind(input.kind)
  if (type) {
    const settings = await tx.orgSetting.findUnique({
      where: { organizationId: resident.organizationId },
      select: { notificationSettings: true },
    })
    if (!isChannelOn(parseNotificationPrefs(settings?.notificationSettings), type, 'IN_APP')) return
  }
  await notifyUsers(
    [resident.userId],
    { ...input, organizationId: input.organizationId ?? resident.organizationId },
    tx,
  )
}

/** Deliver to a staff member's worker account, if one exists. */
export async function notifyStaff(staffId: string, input: NotificationInput, tx: Tx = prisma) {
  const staff = await tx.staff.findUnique({
    where: { id: staffId },
    select: { userId: true, organizationId: true },
  })
  if (!staff?.userId) return
  await notifyUsers(
    [staff.userId],
    { ...input, organizationId: input.organizationId ?? staff.organizationId },
    tx,
  )
}

// Presentation metadata (labels, tones) lives in lib/events-meta.ts so the
// client-side activity timeline can import it without pulling in server code.
export { EVENT_LABEL, eventTone } from '@/lib/events-meta'
