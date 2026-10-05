import 'server-only'

import type { EventType, NotificationKind, Prisma, UserRole } from '@prisma/client'
import { prisma } from '@/lib/prisma'

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
  /** Caller IP, recorded for public endpoints such as the demo form. */
  ip?: string
}

type Tx = Prisma.TransactionClient | typeof prisma

export async function recordActivity(input: ActivityInput, tx: Tx = prisma) {
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
      ip: input.ip ?? null,
    },
  })
}

export type NotificationInput = {
  organizationId?: string | null
  kind: NotificationKind
  title: string
  body: string
  link?: string
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
