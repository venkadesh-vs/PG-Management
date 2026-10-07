import 'server-only'

import type { MessageStatus, NotificationChannel, Prisma, UserRole } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { normalisePhone } from '@/server/integrations/whatsapp'
import { MESSAGE_GROUPS, isMessageGroup } from '@/lib/notification-prefs'
import { centreFilters, type CentreFilters } from '@/lib/message-centre'

/**
 * One history across channels: WhatsApp / email / SMS attempts
 * (OutboundMessage) and in-app notifications (Notification), merged newest
 * first. Read-only.
 */

export type CentreRow =
  | {
      source: 'outbound'
      id: string
      channel: NotificationChannel
      createdAt: Date
      recipient: string
      address: string
      template: string | null
      subject: string | null
      body: string
      status: MessageStatus
      isDemo: boolean
      error: string | null
      attempts: number
      retryable: boolean
      sentAt: Date | null
      deliveredAt: Date | null
      readAt: Date | null
    }
  | {
      source: 'inapp'
      id: string
      channel: 'IN_APP'
      createdAt: Date
      recipient: string
      recipientRole: UserRole
      kind: string
      title: string
      body: string
      readAt: Date | null
    }

export const CENTRE_PAGE_SIZE = 25
/** Merging two tables page by page reads page × size rows from each. */
export const CENTRE_MAX_PAGE = 40

type Viewer = { id: string; role: UserRole; organizationId: string }

export async function loadMessageCentre(viewer: Viewer, raw: Record<string, string | undefined>) {
  const f: CentreFilters = centreFilters(raw)
  const organizationId = viewer.organizationId
  const page = Math.min(f.page, CENTRE_MAX_PAGE)
  const take = page * CENTRE_PAGE_SIZE

  // Resident filter: their numbers / email for outbound, their login for in-app.
  let resident: { id: string; fullName: string; userId: string | null; addresses: string[] } | null = null
  if (f.resident) {
    const r = await prisma.resident.findFirst({
      where: { id: f.resident, organizationId },
      select: { id: true, fullName: true, userId: true, phone: true, whatsappPhone: true, email: true },
    })
    if (r) {
      resident = {
        id: r.id,
        fullName: r.fullName,
        userId: r.userId,
        addresses: [normalisePhone(r.phone), r.whatsappPhone ? normalisePhone(r.whatsappPhone) : '', r.email ?? ''].filter(Boolean),
      }
    }
  }
  const residentMissing = Boolean(f.resident && !resident)

  const createdAt: Prisma.DateTimeFilter | undefined =
    f.from || f.to ? { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lt: f.to } : {}) } : undefined

  const group = isMessageGroup(f.group) ? MESSAGE_GROUPS[f.group] : null

  const outboundWhere: Prisma.OutboundMessageWhereInput = {
    organizationId,
    ...(f.channel && f.channel !== 'IN_APP' ? { channel: f.channel } : {}),
    ...(f.status === 'RETRIED' ? { attempts: { gte: 2 } } : f.status ? { status: f.status } : {}),
    ...(group ? { template: { in: [...group.templates] } } : {}),
    ...(resident ? { toAddress: { in: resident.addresses } } : {}),
    ...(createdAt ? { createdAt } : {}),
    ...(f.q
      ? {
          OR: [
            { toName: { contains: f.q, mode: 'insensitive' } },
            { toAddress: { contains: f.q } },
            { body: { contains: f.q, mode: 'insensitive' } },
          ],
        }
      : {}),
  }
  const includeOutbound = !residentMissing && f.channel !== 'IN_APP' && !(group && group.templates.length === 0)

  // In-app rows only have "delivered" (unread) and "read".
  const inAppStatusOk = !f.status || f.status === 'READ' || f.status === 'DELIVERED'
  const includeInApp =
    !residentMissing &&
    (!f.channel || f.channel === 'IN_APP') &&
    inAppStatusOk &&
    !(group && group.kinds.length === 0) &&
    !(resident && !resident.userId)

  const inAppWhere: Prisma.NotificationWhereInput = {
    organizationId,
    // Team alerts can carry owner-only matters (billing, subscription): only
    // the owner sees everyone's; others see residents' and their own.
    ...(viewer.role === 'OWNER' ? {} : { OR: [{ user: { role: 'TENANT' } }, { userId: viewer.id }] }),
    ...(f.status === 'READ' ? { readAt: { not: null } } : f.status === 'DELIVERED' ? { readAt: null } : {}),
    ...(group ? { kind: { in: [...group.kinds] as Prisma.EnumNotificationKindFilter['in'] } } : {}),
    ...(resident?.userId ? { userId: resident.userId } : {}),
    ...(createdAt ? { createdAt } : {}),
    ...(f.q
      ? {
          AND: [
            {
              OR: [
                { title: { contains: f.q, mode: 'insensitive' } },
                { body: { contains: f.q, mode: 'insensitive' } },
                { user: { name: { contains: f.q, mode: 'insensitive' } } },
              ],
            },
          ],
        }
      : {}),
  }

  const [outbound, outboundTotal, inApp, inAppTotal, statusCounts, inAppUnread, inAppAll] = await Promise.all([
    includeOutbound
      ? prisma.outboundMessage.findMany({ where: outboundWhere, orderBy: { createdAt: 'desc' }, take })
      : Promise.resolve([]),
    includeOutbound ? prisma.outboundMessage.count({ where: outboundWhere }) : Promise.resolve(0),
    includeInApp
      ? prisma.notification.findMany({
          where: inAppWhere,
          orderBy: { createdAt: 'desc' },
          take,
          include: { user: { select: { name: true, role: true } } },
        })
      : Promise.resolve([]),
    includeInApp ? prisma.notification.count({ where: inAppWhere }) : Promise.resolve(0),
    prisma.outboundMessage.groupBy({ by: ['status'], where: { organizationId }, _count: { _all: true } }),
    prisma.notification.count({ where: { organizationId, readAt: null, user: { role: 'TENANT' } } }),
    prisma.notification.count({ where: { organizationId, user: { role: 'TENANT' } } }),
  ])

  const rows: CentreRow[] = [
    ...outbound.map(
      (m): CentreRow => ({
        source: 'outbound',
        id: m.id,
        channel: m.channel,
        createdAt: m.createdAt,
        recipient: m.toName ?? m.toAddress,
        address: m.toAddress,
        template: m.template,
        subject: m.subject,
        body: m.body,
        status: m.status,
        isDemo: m.isDemo,
        error: m.error,
        attempts: m.attempts,
        retryable: m.channel === 'WHATSAPP' && m.status === 'FAILED' && !m.isDemo && m.variables != null,
        sentAt: m.sentAt,
        deliveredAt: m.deliveredAt,
        readAt: m.readAt,
      }),
    ),
    ...inApp.map(
      (n): CentreRow => ({
        source: 'inapp',
        id: n.id,
        channel: 'IN_APP',
        createdAt: n.createdAt,
        recipient: n.user.name,
        recipientRole: n.user.role,
        kind: n.kind,
        title: n.title,
        body: n.body,
        readAt: n.readAt,
      }),
    ),
  ]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice((page - 1) * CENTRE_PAGE_SIZE, page * CENTRE_PAGE_SIZE)

  const countFor = (s: MessageStatus) => statusCounts.find((c) => c.status === s)?._count._all ?? 0
  return {
    filters: f,
    page,
    rows,
    total: Math.min(outboundTotal + inAppTotal, CENTRE_MAX_PAGE * CENTRE_PAGE_SIZE),
    totalUncapped: outboundTotal + inAppTotal,
    resident,
    stats: {
      sent: countFor('SENT') + countFor('DELIVERED') + countFor('READ'),
      read: countFor('READ'),
      failed: countFor('FAILED'),
      demo: countFor('DEMO_NOT_SENT'),
      queued: countFor('QUEUED'),
      inAppUnread,
      inAppAll,
    },
  }
}
