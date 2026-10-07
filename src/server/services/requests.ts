import 'server-only'

import { z } from 'zod'
import type { Prisma, ResidentRequestKind, ResidentRequestStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type { SessionUser } from '@/lib/auth'
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  inScope,
  scopeWhere,
  type PropertyScope,
} from '@/lib/tenancy'
import { ROLE_TEMPLATES } from '@/lib/permission-catalog'
import { addDays, endOfDay, formatDate, startOfDay } from '@/lib/utils'
import { notifyResident, notifyUsers, recordActivity } from '../events'
import { MEAL_TYPES, setMealAttendance } from './kitchen'
import { isModuleOn } from './org-modules'
import { createTask } from './complaints'
import { MEALS_PAUSED_LINE } from '@/app/(tenant)/tenant/requests/request-meta'

/**
 * Resident requests (PRD §50): leave, visitor pre-approval, room change and
 * service asks, raised from the resident app and decided by the owner team.
 *
 * The model has no column for every detail a form collects, so a few are
 * folded into readable text: a leave that should pause meals carries the
 * MEALS_PAUSED line in `details`; a visitor's relation is the first line of
 * `details`. Both read naturally anywhere the raw text is shown.
 */

export { MEALS_PAUSED_LINE }
const MAX_LEAVE_DAYS = 90

export const KIND_LABEL: Record<ResidentRequestKind, string> = {
  LEAVE: 'Leave',
  VISITOR: 'Visitor',
  ROOM_CHANGE: 'Room change',
  SERVICE: 'Service',
  OTHER: 'Other',
}

// --------------------------------------------------------------------------
// Validation
// --------------------------------------------------------------------------

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date')
const hhmm = z
  .string()
  .regex(/^\d{2}:\d{2}$/, 'Pick a time')
  .optional()
  .or(z.literal('').transform(() => undefined))
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined))

export const createRequestSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('LEAVE'),
    fromDate: isoDate,
    toDate: isoDate,
    reason: z.string().trim().min(3, 'Tell us briefly why you are going').max(500),
    pauseMeals: z.boolean().default(true),
  }),
  z.object({
    kind: z.literal('VISITOR'),
    visitorName: z.string().trim().min(2, 'Enter your visitor’s name').max(80),
    visitorPhone: z
      .string()
      .trim()
      .regex(/^\+?[0-9 ]{10,15}$/, 'Enter a valid phone number')
      .optional()
      .or(z.literal('').transform(() => undefined)),
    visitorCount: z.coerce.number().int().min(1).max(20).default(1),
    date: isoDate,
    fromTime: hhmm,
    toTime: hhmm,
    relation: optionalText(60),
    note: optionalText(300),
  }),
  z.object({
    kind: z.literal('ROOM_CHANGE'),
    preference: z.string().trim().min(2, 'Tell us what kind of room you would like').max(120),
    reason: z.string().trim().min(3, 'Tell us briefly why').max(500),
    fromDate: isoDate,
  }),
  z.object({
    kind: z.literal('SERVICE'),
    title: z.string().trim().min(3, 'Give it a short title').max(120),
    details: optionalText(1000),
  }),
  z.object({
    kind: z.literal('OTHER'),
    title: z.string().trim().min(3, 'Give it a short title').max(120),
    details: optionalText(1000),
  }),
])
export type CreateRequestInput = z.infer<typeof createRequestSchema>

export const decideRequestSchema = z.object({
  action: z.enum(['APPROVE', 'REJECT', 'DONE']),
  note: optionalText(500),
  /** SERVICE approvals only: also open a maintenance task for the team. */
  createTask: z.boolean().optional(),
})
export type DecideRequestInput = z.infer<typeof decideRequestSchema>

/** "2026-10-06" (+ optional "14:30") → a local Date. */
function parseLocal(date: string, time?: string) {
  const [y, m, d] = date.split('-').map(Number)
  const [hh, mm] = (time ?? '00:00').split(':').map(Number)
  const value = new Date(y, m - 1, d, hh, mm, 0, 0)
  if (Number.isNaN(value.getTime())) throw new ValidationError('Pick a valid date')
  return value
}

export function mealsPaused(request: { kind: ResidentRequestKind; details: string | null }) {
  return request.kind === 'LEAVE' && Boolean(request.details?.includes(MEALS_PAUSED_LINE))
}

// --------------------------------------------------------------------------
// Create / cancel (resident)
// --------------------------------------------------------------------------

/** Turns a form submission into the stored row fields. */
function buildRow(input: CreateRequestInput): Omit<
  Prisma.ResidentRequestUncheckedCreateInput,
  'organizationId' | 'propertyId' | 'residentId'
> {
  const today = startOfDay(new Date())
  switch (input.kind) {
    case 'LEAVE': {
      const from = parseLocal(input.fromDate)
      const to = parseLocal(input.toDate)
      if (from < today) throw new ValidationError('Leave cannot start in the past')
      if (to < from) throw new ValidationError('The return date must be on or after the leaving date')
      if ((to.getTime() - from.getTime()) / 86400000 > MAX_LEAVE_DAYS) {
        throw new ValidationError(`Leave can be at most ${MAX_LEAVE_DAYS} days. Talk to your PG owner for longer stays away.`)
      }
      return {
        kind: 'LEAVE',
        title: `Going home · ${formatDate(from)} – ${formatDate(to)}`,
        details: [input.reason, input.pauseMeals ? MEALS_PAUSED_LINE : null].filter(Boolean).join('\n'),
        fromDate: from,
        toDate: endOfDay(to),
      }
    }
    case 'VISITOR': {
      const from = parseLocal(input.date, input.fromTime)
      const to = input.toTime ? parseLocal(input.date, input.toTime) : endOfDay(from)
      if (startOfDay(from) < today) throw new ValidationError('The visit cannot be in the past')
      if (to < from) throw new ValidationError('The visit must end after it starts')
      return {
        kind: 'VISITOR',
        title: `${input.visitorName}${input.visitorCount > 1 ? ` +${input.visitorCount - 1}` : ''} visiting`,
        details: [input.relation ? `Relation: ${input.relation}` : null, input.note].filter(Boolean).join('\n') || null,
        fromDate: from,
        toDate: to,
        visitorName: input.visitorName,
        visitorPhone: input.visitorPhone?.replace(/\s+/g, '') ?? null,
        visitorCount: input.visitorCount,
      }
    }
    case 'ROOM_CHANGE': {
      const from = parseLocal(input.fromDate)
      if (from < today) throw new ValidationError('Pick today or a later date')
      return {
        kind: 'ROOM_CHANGE',
        title: `Room change · ${input.preference}`,
        details: input.reason,
        fromDate: from,
      }
    }
    case 'SERVICE':
    case 'OTHER':
      return { kind: input.kind, title: input.title, details: input.details ?? null }
  }
}

/** Owners, plus managers whose role can see requests and who cover this PG. */
async function requestViewerIds(organizationId: string, propertyId: string) {
  const users = await prisma.user.findMany({
    where: { organizationId, role: { in: ['OWNER', 'MANAGER'] }, status: 'ACTIVE' },
    select: {
      id: true,
      role: true,
      orgRole: { select: { permissions: true } },
      propertyAccess: { select: { propertyId: true } },
    },
  })
  const managerTemplate = ROLE_TEMPLATES.find((t) => t.name === 'Manager')?.permissions ?? []
  return users
    .filter((u) => {
      if (u.role === 'OWNER') return true
      const perms = u.orgRole?.permissions ?? managerTemplate
      if (!perms.includes('requests.view')) return false
      return u.propertyAccess.length === 0 || u.propertyAccess.some((p) => p.propertyId === propertyId)
    })
    .map((u) => u.id)
}

export async function createRequest(user: SessionUser, input: CreateRequestInput) {
  if (!user.residentId) throw new ForbiddenError('Only residents can raise requests')
  const resident = await prisma.resident.findUnique({
    where: { id: user.residentId },
    select: {
      id: true,
      fullName: true,
      organizationId: true,
      propertyId: true,
      status: true,
      room: { select: { number: true } },
    },
  })
  if (!resident || resident.organizationId !== user.organizationId) {
    throw new ForbiddenError('Not your record')
  }
  if (!['ACTIVE', 'NOTICE'].includes(resident.status)) {
    throw new ValidationError('Requests are open to residents currently staying at the PG')
  }

  const open = await prisma.residentRequest.count({
    where: { residentId: resident.id, status: 'PENDING' },
  })
  if (open >= 10) throw new ValidationError('You already have 10 requests waiting. Please wait for a reply first.')

  const row = buildRow(input)
  const request = await prisma.residentRequest.create({
    data: {
      ...row,
      organizationId: resident.organizationId,
      propertyId: resident.propertyId,
      residentId: resident.id,
    },
  })

  await recordActivity({
    organizationId: resident.organizationId,
    propertyId: resident.propertyId,
    actorId: user.id,
    actorName: user.name,
    actorRole: user.role,
    event: 'RESIDENT_UPDATED',
    entityType: 'ResidentRequest',
    entityId: request.id,
    summary: `${resident.fullName} asked: ${request.title}`,
    meta: { kind: request.kind },
  })

  try {
    const viewers = await requestViewerIds(resident.organizationId, resident.propertyId)
    await notifyUsers(viewers, {
      organizationId: resident.organizationId,
      kind: 'SYSTEM',
      title: `New ${KIND_LABEL[request.kind].toLowerCase()} request`,
      body: `${resident.fullName}${resident.room ? ` (Room ${resident.room.number})` : ''}: ${request.title}`,
      link: '/app/requests',
    })
  } catch (error) {
    // A notification failure must not lose the request itself.
    console.error('[requests] notify failed', error)
  }

  return request
}

export async function cancelRequest(user: SessionUser, id: string) {
  if (!user.residentId) throw new ForbiddenError('Only the resident can cancel their request')
  const result = await prisma.residentRequest.updateMany({
    where: { id, residentId: user.residentId, status: 'PENDING' },
    data: { status: 'CANCELLED', decidedAt: new Date(), decidedBy: user.name },
  })
  if (result.count === 0) {
    const exists = await prisma.residentRequest.findFirst({
      where: { id, residentId: user.residentId },
      select: { status: true },
    })
    if (!exists) throw new NotFoundError('Request not found')
    throw new ConflictError('This request has already been answered, so it can no longer be cancelled')
  }
  return { ok: true }
}

// --------------------------------------------------------------------------
// Meals on leave
// --------------------------------------------------------------------------

/**
 * Marks the resident ON_LEAVE for every published meal in the range, exactly
 * as the resident's own opt-out does. Idempotent: meals already marked are
 * skipped, and attended meals are never overwritten.
 */
export async function pauseMealsForLeave(params: {
  residentId: string
  propertyId: string
  from: Date
  to: Date
}) {
  const meals = await prisma.meal.findMany({
    where: {
      propertyId: params.propertyId,
      date: { gte: startOfDay(params.from), lte: endOfDay(params.to) },
      type: { in: MEAL_TYPES },
    },
    select: {
      id: true,
      attendance: { where: { residentId: params.residentId }, select: { status: true } },
    },
  })
  let paused = 0
  for (const meal of meals) {
    const current = meal.attendance[0]?.status
    if (current === 'ON_LEAVE' || current === 'ATTENDED') continue
    await setMealAttendance({ residentId: params.residentId, mealId: meal.id, status: 'ON_LEAVE' })
    paused++
  }
  return { paused }
}

/**
 * Applies approved leave to meal rows published after the approval (the
 * kitchen often publishes tomorrow's menu later). Run by daily automation for
 * today and tomorrow; safe to run any number of times.
 */
export async function applyApprovedLeaveToMeals(date: Date, organizationId?: string) {
  const day = startOfDay(date)
  const leaves = await prisma.residentRequest.findMany({
    where: {
      kind: 'LEAVE',
      status: 'APPROVED',
      fromDate: { lte: endOfDay(day) },
      toDate: { gte: day },
      details: { contains: MEALS_PAUSED_LINE },
      ...(organizationId ? { organizationId } : {}),
    },
    select: { residentId: true, propertyId: true, organizationId: true },
  })
  let paused = 0
  const foodOn = new Map<string, boolean>()
  for (const leave of leaves) {
    if (!foodOn.has(leave.organizationId)) {
      foodOn.set(leave.organizationId, await isModuleOn(leave.organizationId, 'food'))
    }
    if (!foodOn.get(leave.organizationId)) continue
    const result = await pauseMealsForLeave({
      residentId: leave.residentId,
      propertyId: leave.propertyId,
      from: day,
      to: day,
    })
    paused += result.paused
  }
  return { paused }
}

// --------------------------------------------------------------------------
// Decide (owner team)
// --------------------------------------------------------------------------

const STATUS_VERB: Record<ResidentRequestStatus, string> = {
  PENDING: 'Reopened',
  APPROVED: 'Approved',
  REJECTED: 'Declined',
  CANCELLED: 'Cancelled',
  DONE: 'Completed',
}

const RESIDENT_MESSAGE: Record<ResidentRequestKind, Partial<Record<ResidentRequestStatus, string>>> = {
  LEAVE: {
    APPROVED: 'Your leave is approved. Safe travels!',
    REJECTED: 'Your leave request was declined',
    DONE: 'Welcome back!',
  },
  VISITOR: {
    APPROVED: 'Your visitor is approved',
    REJECTED: 'Your visitor request was declined',
    DONE: 'Visit marked complete',
  },
  ROOM_CHANGE: {
    APPROVED: 'Your room change is approved',
    REJECTED: 'Your room change request was declined',
    DONE: 'Your room change is done',
  },
  SERVICE: {
    APPROVED: 'Your service request is approved',
    REJECTED: 'Your service request was declined',
    DONE: 'Your service request is done',
  },
  OTHER: {
    APPROVED: 'Your request is approved',
    REJECTED: 'Your request was declined',
    DONE: 'Your request is done',
  },
}

export async function decideRequest(user: SessionUser, id: string, input: DecideRequestInput) {
  const request = await prisma.residentRequest.findFirst({
    where: { id, organizationId: user.organizationId ?? '__none__' },
    include: { resident: { select: { fullName: true, roomId: true } } },
  })
  if (!request || !inScope(user, request.propertyId)) throw new NotFoundError('Request not found')

  const from: ResidentRequestStatus = input.action === 'DONE' ? 'APPROVED' : 'PENDING'
  const to: ResidentRequestStatus =
    input.action === 'APPROVE' ? 'APPROVED' : input.action === 'REJECT' ? 'REJECTED' : 'DONE'
  if (input.action === 'REJECT' && !input.note) {
    throw new ValidationError('Add a short note so the resident knows why')
  }

  const now = new Date()
  const result = await prisma.residentRequest.updateMany({
    where: { id, status: from },
    data:
      input.action === 'DONE'
        ? { status: to, ...(input.note ? { decisionNote: input.note } : {}) }
        : { status: to, decidedBy: user.name, decidedAt: now, decisionNote: input.note ?? null },
  })
  if (result.count === 0) {
    throw new ConflictError(
      input.action === 'DONE'
        ? 'Only approved requests can be marked done'
        : 'Someone has already answered this request',
    )
  }

  const effects: string[] = []
  if (input.action === 'APPROVE') {
    if (
      mealsPaused(request) &&
      request.fromDate &&
      request.toDate &&
      (await isModuleOn(request.organizationId, 'food'))
    ) {
      const { paused } = await pauseMealsForLeave({
        residentId: request.residentId,
        propertyId: request.propertyId,
        from: request.fromDate,
        to: request.toDate,
      })
      effects.push(paused ? `${paused} meals paused` : 'Meals will be paused as menus are published')
    }
    if (request.kind === 'SERVICE' && input.createTask && user.modules.includes('complaints')) {
      await createTask({
        organizationId: request.organizationId,
        propertyId: request.propertyId,
        roomId: request.resident.roomId,
        title: request.title,
        description: [`Requested by ${request.resident.fullName}.`, request.details]
          .filter(Boolean)
          .join('\n'),
        kind: 'MAINTENANCE',
        actor: { id: user.id, name: user.name, role: user.role },
      })
      effects.push('Maintenance task created')
    }
  }

  await recordActivity({
    organizationId: request.organizationId,
    propertyId: request.propertyId,
    actorId: user.id,
    actorName: user.name,
    actorRole: user.role,
    event: 'RESIDENT_UPDATED',
    entityType: 'ResidentRequest',
    entityId: request.id,
    summary: `${STATUS_VERB[to]} ${request.resident.fullName}’s request: ${request.title}`,
    meta: { kind: request.kind, status: to, effects },
  })

  try {
    await notifyResident(request.residentId, {
      organizationId: request.organizationId,
      kind: 'SYSTEM',
      type: 'REQUEST_UPDATE',
      title: RESIDENT_MESSAGE[request.kind][to] ?? 'Your request was updated',
      body: [request.title, input.note].filter(Boolean).join(' · '),
      link: '/tenant/requests',
    })
  } catch (error) {
    console.error('[requests] notify resident failed', error)
  }

  return { status: to, effects }
}

// --------------------------------------------------------------------------
// Queries
// --------------------------------------------------------------------------

export type RequestTab = 'pending' | 'approved' | 'all'

export async function listRequests(
  scope: PropertyScope,
  filter: { tab?: RequestTab; kind?: ResidentRequestKind; take?: number },
) {
  const tab = filter.tab ?? 'pending'
  const where: Prisma.ResidentRequestWhereInput = {
    ...scopeWhere(scope),
    ...(tab === 'pending' ? { status: 'PENDING' } : tab === 'approved' ? { status: 'APPROVED' } : {}),
    ...(filter.kind ? { kind: filter.kind } : {}),
  }
  return prisma.residentRequest.findMany({
    where,
    include: {
      property: { select: { id: true, name: true, type: true } },
      resident: {
        select: {
          id: true,
          fullName: true,
          phone: true,
          room: { select: { number: true } },
          bed: { select: { label: true } },
        },
      },
    },
    // Oldest first while waiting (fair queue), newest first otherwise.
    orderBy: { createdAt: tab === 'pending' ? 'asc' : 'desc' },
    take: filter.take ?? 100,
  })
}

export async function requestCounts(scope: PropertyScope) {
  const rows = await prisma.residentRequest.groupBy({
    by: ['status'],
    where: { ...scopeWhere(scope), status: { in: ['PENDING', 'APPROVED'] } },
    _count: { _all: true },
  })
  const count = (s: ResidentRequestStatus) => rows.find((r) => r.status === s)?._count._all ?? 0
  return { pending: count('PENDING'), approved: count('APPROVED') }
}

export async function residentRequests(residentId: string) {
  return prisma.residentRequest.findMany({
    where: { residentId },
    orderBy: { createdAt: 'desc' },
    take: 50,
  })
}

/**
 * Approved visitor pre-approvals due today that have not been signed in yet,
 * for the guard's "Expected today" list.
 */
export async function expectedVisitorsToday(
  organizationId: string,
  propertyIds: string[],
  now = new Date(),
) {
  const dayStart = startOfDay(now)
  const dayEnd = endOfDay(now)
  const requests = await prisma.residentRequest.findMany({
    where: {
      organizationId,
      propertyId: { in: propertyIds },
      kind: 'VISITOR',
      status: 'APPROVED',
      fromDate: { lte: dayEnd },
      toDate: { gte: dayStart },
    },
    include: {
      property: { select: { id: true, name: true } },
      resident: { select: { id: true, fullName: true, room: { select: { number: true } } } },
    },
    orderBy: { fromDate: 'asc' },
  })
  if (!requests.length) return []
  const signedIn = await prisma.visitor.findMany({
    where: {
      organizationId,
      propertyId: { in: propertyIds },
      entryAt: { gte: dayStart, lt: addDays(dayStart, 1) },
      residentId: { in: requests.map((r) => r.residentId) },
    },
    select: { residentId: true, name: true },
  })
  const key = (residentId: string | null, name: string) => `${residentId}|${name.trim().toLowerCase()}`
  const seen = new Set(signedIn.map((v) => key(v.residentId, v.name)))
  return requests
    .filter((r) => !seen.has(key(r.residentId, r.visitorName ?? '')))
    .map((r) => ({
      id: r.id,
      propertyId: r.propertyId,
      propertyName: r.property.name,
      residentId: r.residentId,
      residentName: r.resident.fullName,
      room: r.resident.room?.number ?? null,
      visitorName: r.visitorName ?? r.title,
      visitorPhone: r.visitorPhone,
      visitorCount: r.visitorCount ?? 1,
      relation: r.details?.match(/^Relation: (.+)$/m)?.[1] ?? null,
      fromDate: r.fromDate,
      toDate: r.toDate,
    }))
}
