import 'server-only'

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type { SessionUser } from '@/lib/auth'
import { hasPermission, ForbiddenError, NotFoundError, ValidationError, ConflictError } from '@/lib/tenancy'
import { isRateLimited, recordHit } from '@/lib/rate-limit'
import { notifySuperAdmins, notifyUsers, recordActivity } from '@/server/events'
import { nextCounterNumber } from '@/server/services/billing'
import {
  ADMIN_ONLY_ACTIONS,
  ADMIN_STATUS_LABEL,
  canAdminMove,
  canCustomerClose,
  canReply,
  categoryLabel,
  resolvedAtFor,
  statusAfterReply,
  TICKET_STATUS_STYLE,
  type TicketAction,
  type TicketStatus,
} from '@/lib/support'
import type { z } from 'zod'
import type { createTicketSchema } from '@/lib/support'

/**
 * Support tickets: PG accounts ↔ the StayFlow team.
 *
 * - Owners, and anyone holding settings.manage, raise and follow tickets for
 *   their own organization only.
 * - Super Admins see every ticket and can reply, change status, priority and
 *   assignee.
 * - Every change is audited (SUPPORT_TICKET); the other side gets an in-app
 *   notification after the write commits, so a failed notification never
 *   loses a reply.
 */

type CreateInput = z.input<typeof createTicketSchema>

/** Too many tickets or replies in an hour: answered with HTTP 429. */
class TooManyError extends ConflictError {
  constructor(message: string) {
    super(message)
    this.status = 429
  }
}

export function canUseSupport(user: Pick<SessionUser, 'role' | 'permissions' | 'organizationId'>) {
  if (!user.organizationId) return false
  if (user.role === 'OWNER') return true
  return user.role === 'MANAGER' && hasPermission(user, 'settings.manage')
}

export function assertCanUseSupport(user: SessionUser): asserts user is SessionUser & { organizationId: string } {
  if (!canUseSupport(user)) {
    throw new ForbiddenError('Only the PG owner, or someone allowed to change settings, can contact StayFlow support.')
  }
}

/** The attachment must be a file this organization uploaded. */
async function assertOwnUpload(organizationId: string, url: string | undefined) {
  if (!url) return null
  const id = url.split('/').pop()!
  const file = await prisma.uploadedFile.findFirst({ where: { id, organizationId }, select: { id: true } })
  if (!file) throw new ValidationError('Attach the file again using the upload button')
  return url
}

const ticketInclude = {
  organization: { select: { id: true, name: true } },
} satisfies Prisma.SupportTicketInclude

async function loadTicket(user: SessionUser, ticketId: string) {
  const ticket = await prisma.supportTicket.findUnique({ where: { id: ticketId }, include: ticketInclude })
  // Another organization's ticket looks exactly like a missing one.
  if (!ticket || (user.role !== 'SUPER_ADMIN' && ticket.organizationId !== user.organizationId)) {
    throw new NotFoundError('Ticket not found')
  }
  return ticket
}

/** Owner-side recipients: whoever raised it plus the account's owners. */
async function customerRecipients(organizationId: string, createdById: string | null) {
  const owners = await prisma.user.findMany({
    where: { organizationId, role: 'OWNER', status: 'ACTIVE' },
    select: { id: true },
  })
  return [...owners.map((o) => o.id), ...(createdById ? [createdById] : [])]
}

async function notifyTeam(ticket: { id: string; code: string; assignedTo: string | null }, title: string, body: string) {
  const input = { kind: 'SYSTEM' as const, title, body, link: `/admin/support/${ticket.id}` }
  if (ticket.assignedTo) await notifyUsers([ticket.assignedTo], input)
  else await notifySuperAdmins(input)
}

async function notifyCustomer(
  ticket: { id: string; organizationId: string; createdById: string | null },
  title: string,
  body: string,
) {
  const ids = await customerRecipients(ticket.organizationId, ticket.createdById)
  await notifyUsers(ids, {
    organizationId: ticket.organizationId,
    kind: 'SYSTEM',
    title,
    body,
    link: `/app/support/${ticket.id}`,
  })
}

/** Notifications are best-effort: the ticket change has already committed. */
async function safely(fn: () => Promise<unknown>) {
  try {
    await fn()
  } catch (error) {
    console.error('[support] notification failed', error)
  }
}

export async function createTicket(user: SessionUser, input: CreateInput) {
  assertCanUseSupport(user)
  const orgId = user.organizationId
  const priority = input.priority ?? 'NORMAL'
  const rateKey = `support:create:${user.id}`
  if (await isRateLimited(rateKey, 5, 60)) {
    throw new TooManyError('You have opened several tickets in the last hour. Add to an open ticket instead, or try again later.')
  }
  const attachmentUrl = await assertOwnUpload(orgId, input.attachmentUrl || undefined)

  const ticket = await prisma.$transaction(async (tx) => {
    const code = await nextCounterNumber(tx, {
      key: 'counter:support-ticket',
      head: 'SUP-',
      taken: async (c) => !!(await tx.supportTicket.findUnique({ where: { code: c }, select: { id: true } })),
      used: async () => (await tx.supportTicket.findMany({ select: { code: true } })).map((t) => t.code),
    })
    const created = await tx.supportTicket.create({
      data: {
        organizationId: orgId,
        code,
        createdById: user.id,
        createdByName: user.name,
        subject: input.subject,
        category: input.category,
        priority,
        messages: {
          create: { authorName: user.name, fromStaff: false, body: input.message, attachmentUrl },
        },
      },
    })
    await recordActivity(
      {
        organizationId: orgId,
        actorId: user.id,
        actorName: user.name,
        actorRole: user.role,
        event: 'SUPPORT_TICKET',
        entityType: 'SupportTicket',
        entityId: created.id,
        summary: `Support ticket ${code} opened: ${input.subject}`,
        after: { status: created.status, category: input.category, priority },
      },
      tx,
    )
    return created
  })
  await recordHit(rateKey)

  await safely(() =>
    notifySuperAdmins({
      kind: 'SYSTEM',
      title: `${priority === 'URGENT' ? 'Urgent ' : ''}support ticket ${ticket.code}`,
      body: `${user.organizationName ?? 'A customer'} · ${categoryLabel(input.category)}: ${input.subject}`,
      link: `/admin/support/${ticket.id}`,
    }),
  )
  return { ticket, message: `Ticket ${ticket.code} sent. The StayFlow team will reply here and notify you.` }
}

export async function actOnTicket(user: SessionUser, ticketId: string, action: TicketAction) {
  const isTeam = user.role === 'SUPER_ADMIN'
  if (!isTeam) assertCanUseSupport(user)
  if (!isTeam && ADMIN_ONLY_ACTIONS.includes(action.action)) {
    throw new ForbiddenError('Only the StayFlow team can do that.')
  }
  const ticket = await loadTicket(user, ticketId)
  const current = ticket.status as TicketStatus
  const actor = {
    organizationId: ticket.organizationId,
    actorId: user.id,
    actorName: user.name,
    actorRole: user.role,
    event: 'SUPPORT_TICKET' as const,
    entityType: 'SupportTicket',
    entityId: ticket.id,
  }

  if (action.action === 'REPLY') {
    if (!canReply(current)) throw new ConflictError('This ticket is closed. Open a new ticket if you still need help.')
    const rateKey = `support:reply:${user.id}`
    if (await isRateLimited(rateKey, 40, 60)) {
      throw new TooManyError('Too many replies in the last hour. Please wait a little.')
    }
    // Only a customer can attach: Super Admins have no organization to upload into.
    const attachmentUrl = isTeam ? null : await assertOwnUpload(ticket.organizationId, action.attachmentUrl || undefined)
    let next = statusAfterReply(current, isTeam)
    if (isTeam && action.status && action.status !== current) {
      if (!canAdminMove(current, action.status)) throw new ValidationError('That status change is not allowed')
      next = action.status
    }
    await prisma.$transaction(async (tx) => {
      await tx.supportMessage.create({
        data: { ticketId: ticket.id, authorName: isTeam ? `${user.name} (StayFlow)` : user.name, fromStaff: isTeam, body: action.body, attachmentUrl },
      })
      await tx.supportTicket.update({
        where: { id: ticket.id },
        data: { status: next, resolvedAt: resolvedAtFor(next, ticket.resolvedAt) },
      })
      await recordActivity(
        {
          ...actor,
          summary: `${isTeam ? 'StayFlow replied on' : 'Reply added to'} support ticket ${ticket.code}`,
          ...(next !== current ? { before: { status: current }, after: { status: next } } : {}),
        },
        tx,
      )
    })
    await recordHit(rateKey)
    const preview = action.body.length > 140 ? `${action.body.slice(0, 137)}…` : action.body
    await safely(() =>
      isTeam
        ? notifyCustomer(ticket, `StayFlow replied on ${ticket.code}`, preview)
        : notifyTeam(ticket, `Customer replied on ${ticket.code}`, `${ticket.organization.name}: ${preview}`),
    )
    return { status: next, message: isTeam ? 'Reply sent to the customer' : 'Reply sent to the StayFlow team' }
  }

  if (action.action === 'CLOSE') {
    if (!canCustomerClose(current)) throw new ConflictError('This ticket is already closed')
    await prisma.$transaction(async (tx) => {
      await tx.supportTicket.update({
        where: { id: ticket.id },
        data: { status: 'CLOSED', resolvedAt: resolvedAtFor('CLOSED', ticket.resolvedAt) },
      })
      await recordActivity(
        { ...actor, summary: `Support ticket ${ticket.code} closed`, before: { status: current }, after: { status: 'CLOSED' } },
        tx,
      )
    })
    if (!isTeam) await safely(() => notifyTeam(ticket, `${ticket.code} closed by the customer`, ticket.subject))
    return { status: 'CLOSED' as const, message: 'Ticket closed' }
  }

  if (action.action === 'STATUS') {
    if (action.status === current) return { status: current, message: 'No change' }
    if (!canAdminMove(current, action.status)) throw new ValidationError('That status change is not allowed')
    await prisma.$transaction(async (tx) => {
      await tx.supportTicket.update({
        where: { id: ticket.id },
        data: { status: action.status, resolvedAt: resolvedAtFor(action.status, ticket.resolvedAt) },
      })
      if (action.note) {
        await tx.supportMessage.create({
          data: { ticketId: ticket.id, authorName: `${user.name} (StayFlow)`, fromStaff: true, body: action.note },
        })
      }
      await recordActivity(
        {
          ...actor,
          summary: `Support ticket ${ticket.code} marked ${ADMIN_STATUS_LABEL[action.status].toLowerCase()}`,
          before: { status: current },
          after: { status: action.status },
        },
        tx,
      )
    })
    await safely(() =>
      notifyCustomer(
        ticket,
        `${ticket.code}: ${TICKET_STATUS_STYLE[action.status].label.toLowerCase()}`,
        action.note || ticket.subject,
      ),
    )
    return { status: action.status, message: `Marked ${ADMIN_STATUS_LABEL[action.status].toLowerCase()}` }
  }

  if (action.action === 'ASSIGN') {
    if (action.assigneeId) {
      const assignee = await prisma.user.findFirst({
        where: { id: action.assigneeId, role: 'SUPER_ADMIN', status: 'ACTIVE' },
        select: { id: true },
      })
      if (!assignee) throw new ValidationError('Choose someone from the StayFlow team')
    }
    if (action.assigneeId === ticket.assignedTo) return { status: current, message: 'No change' }
    await prisma.$transaction(async (tx) => {
      await tx.supportTicket.update({ where: { id: ticket.id }, data: { assignedTo: action.assigneeId } })
      await recordActivity(
        {
          ...actor,
          summary: `Support ticket ${ticket.code} ${action.assigneeId ? 'assigned' : 'unassigned'}`,
          before: { assignedTo: ticket.assignedTo },
          after: { assignedTo: action.assigneeId },
        },
        tx,
      )
    })
    if (action.assigneeId && action.assigneeId !== user.id) {
      await safely(() =>
        notifyUsers([action.assigneeId!], {
          kind: 'SYSTEM',
          title: `${ticket.code} assigned to you`,
          body: `${ticket.organization.name}: ${ticket.subject}`,
          link: `/admin/support/${ticket.id}`,
        }),
      )
    }
    return { status: current, message: action.assigneeId ? 'Ticket assigned' : 'Ticket unassigned' }
  }

  // PRIORITY
  if (action.priority === ticket.priority) return { status: current, message: 'No change' }
  await prisma.$transaction(async (tx) => {
    await tx.supportTicket.update({ where: { id: ticket.id }, data: { priority: action.priority } })
    await recordActivity(
      {
        ...actor,
        summary: `Support ticket ${ticket.code} priority set to ${action.priority.toLowerCase()}`,
        before: { priority: ticket.priority },
        after: { priority: action.priority },
      },
      tx,
    )
  })
  return { status: current, message: 'Priority updated' }
}

/** A ticket with its thread, for whoever may see it. */
export async function getTicket(user: SessionUser, ticketId: string) {
  if (user.role !== 'SUPER_ADMIN') assertCanUseSupport(user)
  const ticket = await loadTicket(user, ticketId)
  const messages = await prisma.supportMessage.findMany({
    where: { ticketId: ticket.id },
    orderBy: { createdAt: 'asc' },
  })
  return { ticket, messages }
}

/** The organization's own tickets, newest activity first. */
export async function listOrgTickets(user: SessionUser) {
  assertCanUseSupport(user)
  return prisma.supportTicket.findMany({
    where: { organizationId: user.organizationId },
    orderBy: { updatedAt: 'desc' },
    take: 100,
    include: { _count: { select: { messages: true } } },
  })
}

/** Every ticket, for the StayFlow team. */
export async function listAllTickets(filter: { status?: TicketStatus | 'ACTIVE'; assignedTo?: string }) {
  const where: Prisma.SupportTicketWhereInput = {}
  if (filter.status === 'ACTIVE') where.status = { in: ['OPEN', 'IN_PROGRESS', 'WAITING_ON_CUSTOMER'] }
  else if (filter.status) where.status = filter.status
  if (filter.assignedTo === 'none') where.assignedTo = null
  else if (filter.assignedTo) where.assignedTo = filter.assignedTo
  return prisma.supportTicket.findMany({
    where,
    orderBy: { updatedAt: 'desc' },
    take: 200,
    include: { organization: { select: { id: true, name: true } }, _count: { select: { messages: true } } },
  })
}
