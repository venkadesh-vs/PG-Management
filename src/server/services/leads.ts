import 'server-only'

import { z } from 'zod'
import type { Prisma, ResidentLeadStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type { SessionUser } from '@/lib/auth'
import {
  assertPropertyAccess,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  restrictedPropertyIds,
  ValidationError,
} from '@/lib/tenancy'
import { addDays, endOfDay, formatDateTime, startOfDay } from '@/lib/utils'
import { notifyOrgAdmins, recordActivity } from '../events'

/**
 * Resident enquiry CRM (PRD §30). A lead is someone asking for a bed; it walks
 * NEW → CONTACTED → VISIT_SCHEDULED → VISITED → INTERESTED → TOKEN_PAID →
 * BOOKED → CHECKED_IN, or drops out as LOST. TOKEN_PAID / BOOKED / CHECKED_IN
 * are set by bookings and check-in, never by hand.
 */

type Tx = Prisma.TransactionClient | typeof prisma

export const LEAD_SOURCES = ['WALK_IN', 'PHONE', 'WHATSAPP', 'WEBSITE', 'REFERRAL', 'PORTAL', 'OTHER'] as const
export const LOST_REASONS = ['Price', 'Location', 'Competitor', 'No availability', 'Not interested', 'Other'] as const

/** Statuses only the system moves a lead into. */
const SYSTEM_STATUSES: ResidentLeadStatus[] = ['TOKEN_PAID', 'BOOKED', 'CHECKED_IN']
/** A lead in one of these is still being worked. */
export const OPEN_LEAD_STATUSES: ResidentLeadStatus[] = [
  'NEW',
  'CONTACTED',
  'VISIT_SCHEDULED',
  'VISITED',
  'INTERESTED',
  'TOKEN_PAID',
  'BOOKED',
]

const STATUS_LABEL: Record<ResidentLeadStatus, string> = {
  NEW: 'New',
  CONTACTED: 'Contacted',
  VISIT_SCHEDULED: 'Visit scheduled',
  VISITED: 'Visited',
  INTERESTED: 'Interested',
  TOKEN_PAID: 'Token paid',
  BOOKED: 'Booked',
  CHECKED_IN: 'Checked in',
  LOST: 'Lost',
}

const phone = z
  .string()
  .trim()
  .regex(/^(\+?91[-\s]?)?[6-9]\d{9}$/, 'Enter a valid 10-digit mobile number')
const optionalText = z.string().trim().max(2000).optional().or(z.literal(''))
const optionalDate = z.string().trim().optional().or(z.literal(''))

export const leadCreateSchema = z.object({
  name: z.string().trim().min(2, 'Enter their name').max(120),
  phone,
  email: z.string().trim().email('Enter a valid email address').optional().or(z.literal('')),
  gender: optionalText,
  propertyId: z.string().optional().or(z.literal('')),
  source: z.enum(LEAD_SOURCES).default('PHONE'),
  budget: z.coerce.number().int().min(0).optional().or(z.literal('')),
  roomTypePref: optionalText,
  moveInDate: optionalDate,
  nextFollowUpAt: optionalDate,
  notes: optionalText,
})
export type LeadCreateInput = z.infer<typeof leadCreateSchema>

export const leadActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('LOG_CALL'), note: optionalText, nextFollowUpAt: optionalDate }),
  z.object({ action: z.literal('ADD_NOTE'), note: z.string().trim().min(1, 'Write a note').max(2000) }),
  z.object({ action: z.literal('SCHEDULE_VISIT'), visitAt: z.string().min(1, 'Pick the visit date and time'), note: optionalText }),
  z.object({ action: z.literal('MARK_VISITED'), note: optionalText }),
  z.object({ action: z.literal('MARK_INTERESTED'), note: optionalText }),
  z.object({ action: z.literal('MARK_LOST'), reason: z.enum(LOST_REASONS), note: optionalText }),
  z.object({ action: z.literal('SET_STATUS'), status: z.enum(['NEW', 'CONTACTED', 'VISIT_SCHEDULED', 'VISITED', 'INTERESTED', 'TOKEN_PAID', 'BOOKED', 'CHECKED_IN', 'LOST']) }),
  z.object({ action: z.literal('SET_FOLLOW_UP'), nextFollowUpAt: optionalDate }),
  z.object({ action: z.literal('REOPEN') }),
  z.object({ action: z.literal('UPDATE') }).merge(leadCreateSchema.partial()),
])
export type LeadAction = z.infer<typeof leadActionSchema>

/** Last 10 digits — "+91 98765 43210" and "9876543210" are the same person. */
export function phoneKey(value: string) {
  return value.replace(/\D/g, '').slice(-10)
}

function parseDate(value: string | undefined | null) {
  if (!value) return null
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) throw new ValidationError('Enter a valid date')
  return d
}

/**
 * The leads a user may see: their PGs, plus leads not yet tied to a PG when
 * the user is not limited to particular PGs.
 */
export function leadScopeWhere(user: SessionUser, propertyIds: string[]): Prisma.ResidentLeadWhereInput {
  const restricted = restrictedPropertyIds(user)
  return {
    organizationId: user.organizationId ?? '__none__',
    OR: restricted
      ? [{ propertyId: { in: propertyIds } }]
      : [{ propertyId: { in: propertyIds } }, { propertyId: null }],
  }
}

/** Loads a lead the user may act on, or throws. */
export async function getLeadForUser(user: SessionUser, id: string, tx: Tx = prisma) {
  const lead = await tx.residentLead.findFirst({
    where: { id, organizationId: user.organizationId ?? '__none__' },
  })
  if (!lead) throw new NotFoundError('Enquiry not found')
  if (lead.propertyId) await assertPropertyAccess(user, lead.propertyId)
  else if (restrictedPropertyIds(user)) throw new ForbiddenError('You do not have access to this enquiry')
  return lead
}

export async function addLeadActivity(
  tx: Tx,
  leadId: string,
  kind: 'NOTE' | 'CALL' | 'STATUS' | 'VISIT' | 'WHATSAPP' | 'BOOKING',
  body: string,
  actorName: string,
) {
  return tx.residentLeadActivity.create({ data: { leadId, kind, body, actorName } })
}

/**
 * Moves a lead to a status and logs it on the timeline. Used by bookings and
 * check-in too, which is why it takes a transaction client.
 */
export async function setLeadStatus(
  tx: Tx,
  lead: { id: string; status: ResidentLeadStatus },
  status: ResidentLeadStatus,
  actorName: string,
  extra?: Prisma.ResidentLeadUpdateInput,
  note?: string,
) {
  const updated = await tx.residentLead.update({
    where: { id: lead.id },
    data: { status, ...(status !== 'LOST' ? { lostReason: null } : {}), ...extra },
  })
  if (lead.status !== status) {
    await addLeadActivity(
      tx,
      lead.id,
      'STATUS',
      `${STATUS_LABEL[lead.status]} → ${STATUS_LABEL[status]}${note ? ` · ${note}` : ''}`,
      actorName,
    )
  }
  return updated
}

/** Finds an open lead with the same phone number, for dedupe. */
export async function findOpenLeadByPhone(organizationId: string, value: string, tx: Tx = prisma) {
  const key = phoneKey(value)
  if (key.length !== 10) return null
  return tx.residentLead.findFirst({
    where: { organizationId, phone: { endsWith: key }, status: { in: OPEN_LEAD_STATUSES } },
    orderBy: { createdAt: 'desc' },
  })
}

// --------------------------------------------------------------------------
// Create (with phone dedupe)
// --------------------------------------------------------------------------

export async function createLead(user: SessionUser, input: LeadCreateInput) {
  const organizationId = user.organizationId
  if (!organizationId) throw new ForbiddenError('User is not attached to an organization')
  const propertyId = input.propertyId || null
  if (propertyId) await assertPropertyAccess(user, propertyId)
  else if (restrictedPropertyIds(user)) throw new ValidationError('Choose the PG they are enquiring about')

  const phoneNumber = phoneKey(input.phone)
  const budget = input.budget === '' || input.budget === undefined ? null : Number(input.budget)
  const moveInDate = parseDate(input.moveInDate)
  const nextFollowUpAt = parseDate(input.nextFollowUpAt)
  const actorName = user.name

  return prisma.$transaction(async (tx) => {
    // Same phone, still being worked: it is the same enquiry. Refresh it
    // instead of creating a duplicate card.
    const existing = await findOpenLeadByPhone(organizationId, phoneNumber, tx)
    if (existing) {
      if (existing.propertyId) await assertPropertyAccess(user, existing.propertyId)
      const lead = await tx.residentLead.update({
        where: { id: existing.id },
        data: {
          name: input.name.trim() || existing.name,
          email: input.email?.trim() || existing.email,
          gender: input.gender || existing.gender,
          propertyId: propertyId ?? existing.propertyId,
          budget: budget ?? existing.budget,
          roomTypePref: input.roomTypePref || existing.roomTypePref,
          moveInDate: moveInDate ?? existing.moveInDate,
          nextFollowUpAt: nextFollowUpAt ?? existing.nextFollowUpAt,
        },
      })
      await addLeadActivity(
        tx,
        lead.id,
        'NOTE',
        `Enquired again (${input.source.replace('_', ' ').toLowerCase()})${input.notes ? ` — ${input.notes}` : ''}`,
        actorName,
      )
      return { lead, deduped: true }
    }

    const lead = await tx.residentLead.create({
      data: {
        organizationId,
        propertyId,
        name: input.name.trim(),
        phone: phoneNumber,
        email: input.email?.trim() || null,
        gender: input.gender || null,
        source: input.source,
        budget,
        roomTypePref: input.roomTypePref || null,
        moveInDate,
        // A new enquiry deserves a call back today unless told otherwise.
        nextFollowUpAt: nextFollowUpAt ?? new Date(),
        notes: input.notes || null,
        assignedToId: user.id,
      },
    })
    await addLeadActivity(
      tx,
      lead.id,
      'NOTE',
      input.notes ? `Enquiry added — ${input.notes}` : 'Enquiry added',
      actorName,
    )
    await recordActivity(
      {
        organizationId,
        propertyId,
        actorId: user.id,
        actorName,
        actorRole: user.role,
        event: 'LEAD_CREATED',
        entityType: 'ResidentLead',
        entityId: lead.id,
        summary: `New enquiry from ${lead.name}`,
        meta: { source: lead.source },
      },
      tx,
    )
    return { lead, deduped: false }
  })
}

// --------------------------------------------------------------------------
// Pipeline actions
// --------------------------------------------------------------------------

type ActionResult = { lead: Awaited<ReturnType<typeof getLeadForUser>>; message: string }

export async function updateLead(user: SessionUser, id: string, input: LeadAction) {
  const actorName = user.name
  const lead = await getLeadForUser(user, id)
  if (input.action === 'UPDATE' && input.propertyId) await assertPropertyAccess(user, input.propertyId)

  const result = await prisma.$transaction(async (tx): Promise<ActionResult> => {
    if (lead.status === 'CHECKED_IN' && input.action !== 'ADD_NOTE' && input.action !== 'UPDATE') {
      throw new ConflictError(`${lead.name} has already checked in, so this enquiry is closed`)
    }

    switch (input.action) {
      case 'ADD_NOTE': {
        await addLeadActivity(tx, lead.id, 'NOTE', input.note, actorName)
        const updated = await tx.residentLead.update({ where: { id: lead.id }, data: { updatedAt: new Date() } })
        return { lead: updated, message: 'Note added' }
      }
      case 'LOG_CALL': {
        const next = parseDate(input.nextFollowUpAt)
        await addLeadActivity(tx, lead.id, 'CALL', input.note ? `Called — ${input.note}` : 'Called', actorName)
        const updated =
          lead.status === 'NEW'
            ? await setLeadStatus(tx, lead, 'CONTACTED', actorName, { nextFollowUpAt: next })
            : await tx.residentLead.update({ where: { id: lead.id }, data: { nextFollowUpAt: next } })
        return {
          lead: updated,
          message: next ? `Call logged. Next follow-up ${formatDateTime(next)}` : 'Call logged',
        }
      }
      case 'SCHEDULE_VISIT': {
        const visitAt = parseDate(input.visitAt)!
        if (visitAt.getTime() < Date.now() - 60 * 60 * 1000) {
          throw new ValidationError('Pick a visit time in the future')
        }
        await addLeadActivity(
          tx,
          lead.id,
          'VISIT',
          `Visit scheduled for ${formatDateTime(visitAt)}${input.note ? ` — ${input.note}` : ''}`,
          actorName,
        )
        const extra = { visitAt, nextFollowUpAt: visitAt }
        const movable: ResidentLeadStatus[] = ['NEW', 'CONTACTED', 'VISITED', 'LOST', 'VISIT_SCHEDULED']
        const updated = movable.includes(lead.status)
          ? await setLeadStatus(tx, lead, 'VISIT_SCHEDULED', actorName, extra)
          : await tx.residentLead.update({ where: { id: lead.id }, data: extra })
        return { lead: updated, message: `Visit booked for ${formatDateTime(visitAt)}` }
      }
      case 'MARK_VISITED': {
        if (SYSTEM_STATUSES.includes(lead.status)) throw new ConflictError(`${lead.name} already has a booking`)
        await addLeadActivity(
          tx,
          lead.id,
          'VISIT',
          input.note ? `Visited the PG — ${input.note}` : 'Visited the PG',
          actorName,
        )
        const updated = await setLeadStatus(tx, lead, 'VISITED', actorName, {
          nextFollowUpAt: addDays(new Date(), 1),
        })
        return { lead: updated, message: `${lead.name} visited. Follow up tomorrow.` }
      }
      case 'MARK_INTERESTED': {
        if (SYSTEM_STATUSES.includes(lead.status)) throw new ConflictError(`${lead.name} already has a booking`)
        if (input.note) await addLeadActivity(tx, lead.id, 'NOTE', input.note, actorName)
        const updated = await setLeadStatus(tx, lead, 'INTERESTED', actorName)
        return { lead: updated, message: `${lead.name} is interested. Create a booking to hold a bed.` }
      }
      case 'MARK_LOST': {
        if (lead.status === 'BOOKED' || lead.status === 'TOKEN_PAID') {
          throw new ConflictError('Cancel the booking first. That releases the bed and updates the enquiry.')
        }
        const updated = await setLeadStatus(
          tx,
          lead,
          'LOST',
          actorName,
          { lostReason: input.reason, nextFollowUpAt: null },
          `${input.reason}${input.note ? ` — ${input.note}` : ''}`,
        )
        return { lead: updated, message: `Marked lost (${input.reason.toLowerCase()})` }
      }
      case 'REOPEN': {
        if (lead.status !== 'LOST') throw new ConflictError('Only a lost enquiry can be reopened')
        const updated = await setLeadStatus(tx, lead, 'CONTACTED', actorName, { nextFollowUpAt: new Date() })
        return { lead: updated, message: 'Enquiry reopened' }
      }
      case 'SET_STATUS': {
        if (input.status === lead.status) return { lead, message: 'No change' }
        if (SYSTEM_STATUSES.includes(input.status)) {
          throw new ConflictError(`${STATUS_LABEL[input.status]} is set by bookings. Use “Create booking” instead.`)
        }
        if (SYSTEM_STATUSES.includes(lead.status)) {
          throw new ConflictError(`${lead.name} has a booking. Cancel it to move them back.`)
        }
        if (input.status === 'LOST') throw new ValidationError('Tell us why it was lost')
        const updated = await setLeadStatus(tx, lead, input.status, actorName)
        return { lead: updated, message: `Moved to ${STATUS_LABEL[input.status]}` }
      }
      case 'SET_FOLLOW_UP': {
        const next = parseDate(input.nextFollowUpAt)
        const updated = await tx.residentLead.update({ where: { id: lead.id }, data: { nextFollowUpAt: next } })
        return { lead: updated, message: next ? `Follow-up set for ${formatDateTime(next)}` : 'Follow-up cleared' }
      }
      case 'UPDATE': {
        const propertyId = input.propertyId === undefined ? undefined : input.propertyId || null
        if (propertyId === null && restrictedPropertyIds(user)) {
          throw new ValidationError('Choose the PG they are enquiring about')
        }
        const updated = await tx.residentLead.update({
          where: { id: lead.id },
          data: {
            ...(input.name !== undefined ? { name: input.name.trim() } : {}),
            ...(input.phone !== undefined ? { phone: phoneKey(input.phone) } : {}),
            ...(input.email !== undefined ? { email: input.email || null } : {}),
            ...(input.gender !== undefined ? { gender: input.gender || null } : {}),
            ...(propertyId !== undefined ? { propertyId } : {}),
            ...(input.source !== undefined ? { source: input.source } : {}),
            ...(input.budget !== undefined
              ? { budget: input.budget === '' ? null : Number(input.budget) }
              : {}),
            ...(input.roomTypePref !== undefined ? { roomTypePref: input.roomTypePref || null } : {}),
            ...(input.moveInDate !== undefined ? { moveInDate: parseDate(input.moveInDate) } : {}),
            ...(input.nextFollowUpAt !== undefined
              ? { nextFollowUpAt: parseDate(input.nextFollowUpAt) }
              : {}),
            ...(input.notes !== undefined ? { notes: input.notes || null } : {}),
          },
        })
        return { lead: updated, message: 'Enquiry updated' }
      }
    }
  })

  if (input.action !== 'ADD_NOTE' && input.action !== 'LOG_CALL' && result.message !== 'No change') {
    await recordActivity({
      organizationId: lead.organizationId,
      propertyId: result.lead.propertyId,
      actorId: user.id,
      actorName,
      actorRole: user.role,
      event: 'LEAD_UPDATED',
      entityType: 'ResidentLead',
      entityId: lead.id,
      summary: `${lead.name}: ${result.message}`,
    }).catch(() => undefined)
  }
  return result
}

// --------------------------------------------------------------------------
// Stats + automation
// --------------------------------------------------------------------------

export async function leadStats(where: Prisma.ResidentLeadWhereInput, now = new Date()) {
  const weekAgo = addDays(startOfDay(now), -7)
  const monthAgo = addDays(startOfDay(now), -30)
  const [newThisWeek, visitsScheduled, total30, checkedIn30, lost30, dueToday] = await Promise.all([
    prisma.residentLead.count({ where: { AND: [where, { createdAt: { gte: weekAgo } }] } }),
    prisma.residentLead.count({
      where: { AND: [where, { status: 'VISIT_SCHEDULED', visitAt: { gte: startOfDay(now) } }] },
    }),
    prisma.residentLead.count({ where: { AND: [where, { createdAt: { gte: monthAgo } }] } }),
    prisma.residentLead.count({
      where: { AND: [where, { createdAt: { gte: monthAgo }, status: 'CHECKED_IN' }] },
    }),
    prisma.residentLead.count({
      where: { AND: [where, { status: 'LOST', updatedAt: { gte: monthAgo } }] },
    }),
    prisma.residentLead.count({
      where: {
        AND: [
          where,
          { status: { in: OPEN_LEAD_STATUSES }, nextFollowUpAt: { lte: endOfDay(now) } },
        ],
      },
    }),
  ])
  return {
    newThisWeek,
    visitsScheduled,
    conversionRate: total30 ? Math.round((checkedIn30 / total30) * 1000) / 10 : 0,
    total30,
    checkedIn30,
    lost30,
    dueToday,
  }
}

/**
 * Daily automation: one in-app nudge per organization listing the enquiries
 * whose follow-up falls today (or is overdue). Idempotent per day.
 */
export async function sendLeadFollowUpReminders(params?: {
  organizationId?: string
  excludeOrganizationIds?: string[]
  now?: Date
}) {
  const now = params?.now ?? new Date()
  const due = await prisma.residentLead.findMany({
    where: {
      AND: [
        params?.organizationId ? { organizationId: params.organizationId } : {},
        params?.excludeOrganizationIds?.length
          ? { organizationId: { notIn: params.excludeOrganizationIds } }
          : {},
      ],
      status: { in: OPEN_LEAD_STATUSES },
      nextFollowUpAt: { lte: endOfDay(now) },
      organization: { archivedAt: null },
    },
    select: { id: true, organizationId: true, name: true },
    orderBy: { nextFollowUpAt: 'asc' },
  })
  const byOrg = new Map<string, { id: string; name: string }[]>()
  for (const lead of due) {
    const list = byOrg.get(lead.organizationId) ?? []
    list.push(lead)
    byOrg.set(lead.organizationId, list)
  }

  let notified = 0
  for (const [organizationId, leads] of byOrg) {
    const already = await prisma.notification.findFirst({
      where: {
        organizationId,
        kind: 'LEAD',
        link: '/app/leads?view=followups',
        createdAt: { gte: startOfDay(now) },
      },
      select: { id: true },
    })
    if (already) continue
    const names = leads.slice(0, 3).map((l) => l.name).join(', ')
    const more = leads.length > 3 ? ` and ${leads.length - 3} more` : ''
    await notifyOrgAdmins(organizationId, {
      kind: 'LEAD',
      title: `${leads.length} enquir${leads.length === 1 ? 'y needs' : 'ies need'} a follow-up today`,
      body: `Call back ${names}${more} to keep them warm.`,
      link: '/app/leads?view=followups',
    })
    notified++
  }
  return { due: due.length, notified }
}
