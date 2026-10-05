import 'server-only'

import { assertLookupValue } from './org-defaults'
import type { ComplaintPriority, ComplaintStatus, UserRole } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import {
  assertResidentInProperty,
  assertRoomInProperty,
  assertStaffForProperty,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '@/lib/tenancy'
import { notifyOrgAdmins, notifyResident, notifyStaff, recordActivity } from '../events'
import { sendWhatsApp } from '../integrations/whatsapp'
import { formatSpan, slaDueFrom, type SlaHours } from '@/lib/sla'

/**
 * Complaint workflow: tenant raises → owner notified → worker assigned →
 * worker works → resolved → tenant notified → closed. Every transition writes
 * a ComplaintUpdate so the tenant sees a timeline instead of a status word,
 * and mirrors into a MaintenanceTask so the worker app has a single to-do list.
 */

/** The org's SLA hours per priority (defaults when no settings row yet). */
async function orgSlaHours(organizationId: string): Promise<Partial<SlaHours> | null> {
  return prisma.orgSetting.findUnique({
    where: { organizationId },
    select: { slaUrgentHours: true, slaHighHours: true, slaMediumHours: true, slaLowHours: true },
  })
}

const UPLOAD_URL = /^\/api\/uploads\/([a-zA-Z0-9_-]+)$/

/**
 * Photo links must be our own upload URLs for files of this organization —
 * never arbitrary external links (tracking pixels, other tenants' files).
 */
export async function assertOwnUploads(
  organizationId: string,
  urls: (string | null | undefined)[],
  /** Residents and workers may only attach files they uploaded themselves. */
  uploadedById?: string,
) {
  const list = urls.filter((u): u is string => Boolean(u))
  if (!list.length) return
  const ids = list.map((u) => {
    const match = UPLOAD_URL.exec(u)
    if (!match) throw new ValidationError('Photos must be uploaded through StayFlow')
    return match[1]
  })
  const found = await prisma.uploadedFile.count({
    where: { id: { in: ids }, organizationId, ...(uploadedById ? { uploadedById } : {}) },
  })
  if (found !== new Set(ids).size) throw new ValidationError('One of the photos could not be found. Please upload it again.')
}

async function nextComplaintCode(organizationId: string) {
  const count = await prisma.complaint.count({ where: { organizationId } })
  return `CMP-${String(count + 1).padStart(4, '0')}`
}

export async function createComplaint(params: {
  organizationId: string
  propertyId: string
  residentId?: string | null
  roomId?: string | null
  /** Lookup value (COMPLAINT_CATEGORY). */
  category: string
  priority?: ComplaintPriority
  title: string
  description: string
  photoUrls?: string[]
  actor: { id?: string; name: string; role: UserRole }
}) {
  await assertLookupValue(params.organizationId, 'COMPLAINT_CATEGORY', params.category)
  // Ids may come from the client: they must belong to this org and PG.
  if (params.residentId) {
    await assertResidentInProperty(params.residentId, params.organizationId, params.propertyId)
  }
  if (params.roomId) await assertRoomInProperty(params.roomId, params.propertyId)
  await assertOwnUploads(params.organizationId, params.photoUrls ?? [])

  const code = await nextComplaintCode(params.organizationId)
  const priority = params.priority ?? 'MEDIUM'
  const createdAt = new Date()
  const slaDueAt = slaDueFrom(createdAt, priority, await orgSlaHours(params.organizationId))

  const complaint = await prisma.$transaction(async (tx) => {
    const created = await tx.complaint.create({
      data: {
        organizationId: params.organizationId,
        propertyId: params.propertyId,
        residentId: params.residentId ?? null,
        roomId: params.roomId ?? null,
        code,
        category: params.category,
        priority,
        status: 'OPEN',
        createdAt,
        slaDueAt,
        title: params.title,
        description: params.description,
        photoUrls: params.photoUrls ?? [],
        updates: {
          create: {
            authorId: params.actor.id,
            authorName: params.actor.name,
            authorRole: params.actor.role,
            message: 'Complaint raised',
            statusTo: 'OPEN',
          },
        },
      },
      include: { property: true, resident: true, room: true },
    })

    await recordActivity(
      {
        organizationId: params.organizationId,
        propertyId: params.propertyId,
        actorId: params.actor.id,
        actorName: params.actor.name,
        actorRole: params.actor.role,
        event: 'COMPLAINT_CREATED',
        entityType: 'Complaint',
        entityId: created.id,
        summary: `${code} · ${params.title}${created.resident ? ` — ${created.resident.fullName}` : ''}`,
        meta: { category: params.category, priority: created.priority },
      },
      tx,
    )

    await notifyOrgAdmins(
      params.organizationId,
      {
        kind: 'COMPLAINT',
        title: `New ${created.priority.toLowerCase()} priority complaint`,
        body: `${code} · ${params.title}${created.room ? ` (Room ${created.room.number})` : ''}`,
        link: `/app/complaints/${created.id}`,
      },
      tx,
    )

    return created
  })

  return complaint
}

export async function assignComplaint(params: {
  complaintId: string
  staffId: string
  dueDate?: Date
  note?: string
  actor: { id?: string; name: string; role: UserRole }
}) {
  return prisma.$transaction(async (tx) => {
    const complaint = await tx.complaint.findUnique({
      where: { id: params.complaintId },
      include: { property: true, room: true, resident: true },
    })
    if (!complaint) throw new NotFoundError('Complaint not found')
    if (complaint.status === 'CLOSED') throw new ConflictError('This complaint is already closed')

    // Only active staff who work at this PG (or across the org) can take it.
    const staff = await tx.staff.findFirst({
      where: {
        id: params.staffId,
        organizationId: complaint.organizationId,
        active: true,
        OR: [{ propertyId: complaint.propertyId }, { propertyId: null }],
      },
    })
    if (!staff) throw new NotFoundError('Staff member not found')

    const updated = await tx.complaint.update({
      where: { id: complaint.id },
      data: {
        assignedStaffId: staff.id,
        assignedAt: new Date(),
        status: complaint.status === 'OPEN' ? 'ASSIGNED' : complaint.status,
        updates: {
          create: {
            authorId: params.actor.id,
            authorName: params.actor.name,
            authorRole: params.actor.role,
            message: params.note ?? `Assigned to ${staff.name}`,
            statusFrom: complaint.status,
            statusTo: 'ASSIGNED',
          },
        },
      },
    })

    // Mirror into the worker's task list.
    const existingTask = await tx.maintenanceTask.findFirst({
      where: { complaintId: complaint.id },
    })
    if (existingTask) {
      await tx.maintenanceTask.update({
        where: { id: existingTask.id },
        data: { assignedStaffId: staff.id, status: 'PENDING', dueDate: params.dueDate },
      })
    } else {
      await tx.maintenanceTask.create({
        data: {
          organizationId: complaint.organizationId,
          propertyId: complaint.propertyId,
          roomId: complaint.roomId,
          complaintId: complaint.id,
          title: complaint.title,
          description: complaint.description,
          kind: 'COMPLAINT',
          status: 'PENDING',
          priority: complaint.priority,
          dueDate: params.dueDate,
          assignedStaffId: staff.id,
        },
      })
    }

    await recordActivity(
      {
        organizationId: complaint.organizationId,
        propertyId: complaint.propertyId,
        actorId: params.actor.id,
        actorName: params.actor.name,
        actorRole: params.actor.role,
        event: 'COMPLAINT_ASSIGNED',
        entityType: 'Complaint',
        entityId: complaint.id,
        summary: `${complaint.code} assigned to ${staff.name}`,
      },
      tx,
    )
    await notifyStaff(
      staff.id,
      {
        organizationId: complaint.organizationId,
        kind: 'MAINTENANCE',
        title: 'New task assigned',
        body: `${complaint.code} · ${complaint.title}${complaint.room ? ` (Room ${complaint.room.number})` : ''}`,
        link: '/worker/tasks',
      },
      tx,
    )
    if (complaint.residentId) {
      await notifyResident(
        complaint.residentId,
        {
          organizationId: complaint.organizationId,
          kind: 'COMPLAINT',
          title: 'Someone is on it',
          body: `${staff.name} has been assigned to your complaint ${complaint.code}.`,
          link: `/tenant/complaints/${complaint.id}`,
        },
        tx,
      )
    }

    return updated
  })
}

export async function updateComplaintStatus(params: {
  complaintId: string
  status: ComplaintStatus
  message?: string
  photoUrl?: string
  rating?: number
  actor: { id?: string; name: string; role: UserRole }
}) {
  const result = await prisma.$transaction(async (tx) => {
    const complaint = await tx.complaint.findUnique({
      where: { id: params.complaintId },
      include: { resident: true, property: true, assignedStaff: true, room: true },
    })
    if (!complaint) throw new NotFoundError('Complaint not found')

    const now = new Date()
    const resolving = params.status === 'RESOLVED' && complaint.status !== 'RESOLVED'
    // Resolution time is measured from when the complaint was raised (PRD §43).
    const resolutionMs = resolving ? now.getTime() - complaint.createdAt.getTime() : null
    const resolvedLate = Boolean(resolving && complaint.slaDueAt && now > complaint.slaDueAt)
    const updated = await tx.complaint.update({
      where: { id: complaint.id },
      data: {
        status: params.status,
        // A late resolution still counts as a breach, even if the daily check never saw it.
        slaBreachedAt:
          resolvedLate && !complaint.slaBreachedAt ? complaint.slaDueAt : complaint.slaBreachedAt,
        startedAt: params.status === 'IN_PROGRESS' ? (complaint.startedAt ?? now) : complaint.startedAt,
        resolvedAt: params.status === 'RESOLVED' ? now : complaint.resolvedAt,
        closedAt: params.status === 'CLOSED' ? now : complaint.closedAt,
        resolutionNote:
          params.status === 'RESOLVED' || params.status === 'CLOSED'
            ? (params.message ?? complaint.resolutionNote)
            : complaint.resolutionNote,
        resolutionPhotoUrl: params.photoUrl ?? complaint.resolutionPhotoUrl,
        rating: params.rating ?? complaint.rating,
        updates: {
          create: {
            authorId: params.actor.id,
            authorName: params.actor.name,
            authorRole: params.actor.role,
            message: params.message ?? `Status changed to ${params.status.replace('_', ' ').toLowerCase()}`,
            statusFrom: complaint.status,
            statusTo: params.status,
            photoUrl: params.photoUrl,
          },
        },
      },
      include: { resident: true, property: true, room: true },
    })

    // Keep the mirrored task in step.
    if (params.status === 'RESOLVED' || params.status === 'CLOSED') {
      await tx.maintenanceTask.updateMany({
        where: { complaintId: complaint.id, status: { not: 'COMPLETED' } },
        data: { status: 'COMPLETED', completedAt: now, completionNote: params.message },
      })
    } else if (params.status === 'IN_PROGRESS') {
      await tx.maintenanceTask.updateMany({
        where: { complaintId: complaint.id },
        data: { status: 'IN_PROGRESS', startedAt: now },
      })
    }

    const event =
      params.status === 'RESOLVED'
        ? 'COMPLAINT_RESOLVED'
        : params.status === 'CLOSED'
          ? 'COMPLAINT_CLOSED'
          : 'COMPLAINT_ASSIGNED'

    await recordActivity(
      {
        organizationId: complaint.organizationId,
        propertyId: complaint.propertyId,
        actorId: params.actor.id,
        actorName: params.actor.name,
        actorRole: params.actor.role,
        event,
        entityType: 'Complaint',
        entityId: complaint.id,
        summary:
          `${complaint.code} · ${complaint.title} → ${params.status.replace('_', ' ').toLowerCase()}` +
          (resolutionMs !== null ? ` in ${formatSpan(resolutionMs)}${resolvedLate ? ' (past SLA)' : ''}` : ''),
        meta:
          resolutionMs !== null
            ? { resolutionMinutes: Math.round(resolutionMs / 60_000), withinSla: !resolvedLate }
            : undefined,
      },
      tx,
    )

    if (complaint.residentId && (params.status === 'RESOLVED' || params.status === 'IN_PROGRESS')) {
      await notifyResident(
        complaint.residentId,
        {
          organizationId: complaint.organizationId,
          kind: 'COMPLAINT',
          title: params.status === 'RESOLVED' ? 'Your complaint is resolved' : 'Work has started',
          body: `${complaint.code} · ${complaint.title}`,
          link: `/tenant/complaints/${complaint.id}`,
        },
        tx,
      )
    }
    if (params.status === 'RESOLVED') {
      await notifyOrgAdmins(
        complaint.organizationId,
        {
          kind: 'COMPLAINT',
          title: 'Complaint resolved',
          body: `${complaint.code} · ${complaint.title}${complaint.assignedStaff ? ` by ${complaint.assignedStaff.name}` : ''}`,
          link: `/app/complaints/${complaint.id}`,
        },
        tx,
      )
    }

    return updated
  })

  if (params.status === 'RESOLVED' && result.resident) {
    await sendWhatsApp({
      organizationId: result.organizationId,
      toName: result.resident.fullName,
      toPhone: result.resident.whatsappPhone || result.resident.phone,
      template: 'complaint_update',
      body:
        `Hi ${result.resident.fullName.split(' ')[0]} 👋\n\n` +
        `Your complaint ${result.code} (${result.title}) has been resolved.\n` +
        (params.message ? `\nNote: ${params.message}\n` : '') +
        `\nIf the issue is still there, reopen it from the app.`,
      variables: [result.resident.fullName, result.code, result.title],
      refType: 'Complaint',
      refId: result.id,
    }).catch(() => undefined)
  }

  return result
}

export async function addComplaintComment(params: {
  complaintId: string
  message: string
  photoUrl?: string
  actor: { id?: string; name: string; role: UserRole }
}) {
  const complaint = await prisma.complaint.findUnique({
    where: { id: params.complaintId },
    select: { id: true, organizationId: true, residentId: true, assignedStaffId: true, code: true },
  })
  if (!complaint) throw new NotFoundError('Complaint not found')

  const update = await prisma.complaintUpdate.create({
    data: {
      complaintId: complaint.id,
      authorId: params.actor.id,
      authorName: params.actor.name,
      authorRole: params.actor.role,
      message: params.message,
      photoUrl: params.photoUrl,
    },
  })

  // Notify the other side of the conversation.
  if (params.actor.role === 'TENANT') {
    await notifyOrgAdmins(complaint.organizationId, {
      kind: 'COMPLAINT',
      title: `New message on ${complaint.code}`,
      body: params.message.slice(0, 140),
      link: `/app/complaints/${complaint.id}`,
    })
  } else if (complaint.residentId) {
    await notifyResident(complaint.residentId, {
      organizationId: complaint.organizationId,
      kind: 'COMPLAINT',
      title: `Update on ${complaint.code}`,
      body: params.message.slice(0, 140),
      link: `/tenant/complaints/${complaint.id}`,
    })
  }

  return update
}

// --------------------------------------------------------------------------
// SLA (PRD §43)
// --------------------------------------------------------------------------

const OPEN_STATUSES: ComplaintStatus[] = ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD']

/**
 * Changes priority and re-derives the SLA deadline from the raise time. If
 * the new deadline is still ahead, a recorded breach is cleared so the
 * owner is told again should it slip a second time.
 */
export async function changeComplaintPriority(params: {
  complaintId: string
  priority: ComplaintPriority
  actor: { id?: string; name: string; role: UserRole }
}) {
  const complaint = await prisma.complaint.findUnique({ where: { id: params.complaintId } })
  if (!complaint) throw new NotFoundError('Complaint not found')
  if (complaint.priority === params.priority) return complaint

  const slaDueAt = slaDueFrom(complaint.createdAt, params.priority, await orgSlaHours(complaint.organizationId))
  const now = new Date()
  const stillOpen = OPEN_STATUSES.includes(complaint.status)

  return prisma.$transaction(async (tx) => {
    const updated = await tx.complaint.update({
      where: { id: complaint.id },
      data: {
        priority: params.priority,
        slaDueAt,
        slaBreachedAt: stillOpen && slaDueAt > now ? null : complaint.slaBreachedAt,
        updates: {
          create: {
            authorId: params.actor.id,
            authorName: params.actor.name,
            authorRole: params.actor.role,
            message: `Priority changed from ${complaint.priority.toLowerCase()} to ${params.priority.toLowerCase()}`,
          },
        },
      },
    })
    await tx.maintenanceTask.updateMany({
      where: { complaintId: complaint.id },
      data: { priority: params.priority },
    })
    await recordActivity(
      {
        organizationId: complaint.organizationId,
        propertyId: complaint.propertyId,
        actorId: params.actor.id,
        actorName: params.actor.name,
        actorRole: params.actor.role,
        event: 'COMPLAINT_ASSIGNED',
        entityType: 'Complaint',
        entityId: complaint.id,
        summary: `${complaint.code} priority → ${params.priority.toLowerCase()}`,
        meta: { priorityFrom: complaint.priority, priorityTo: params.priority },
      },
      tx,
    )
    return updated
  })
}

/**
 * Flags open complaints whose SLA deadline has passed and tells the org's
 * owners/managers once per breach. Safe to call often: it runs on page load
 * (owner list/detail, worker tasks) and from the daily automation. Each row
 * is claimed with a conditional update, so concurrent calls never notify
 * twice. Also back-fills a deadline on older complaints raised before SLAs.
 */
export async function markSlaBreaches(organizationId?: string) {
  const now = new Date()
  const orgFilter = organizationId ? { organizationId } : {}

  // Older complaints raised before SLAs existed get a deadline first.
  const missing = await prisma.complaint.findMany({
    where: { ...orgFilter, slaDueAt: null, status: { in: OPEN_STATUSES } },
    select: { id: true, organizationId: true, createdAt: true, priority: true },
    take: 500,
  })
  if (missing.length) {
    const hoursByOrg = new Map<string, Partial<SlaHours> | null>()
    for (const c of missing) {
      if (!hoursByOrg.has(c.organizationId)) hoursByOrg.set(c.organizationId, await orgSlaHours(c.organizationId))
      await prisma.complaint.updateMany({
        where: { id: c.id, slaDueAt: null },
        data: { slaDueAt: slaDueFrom(c.createdAt, c.priority, hoursByOrg.get(c.organizationId)) },
      })
    }
  }

  const overdue = await prisma.complaint.findMany({
    where: {
      ...orgFilter,
      slaBreachedAt: null,
      slaDueAt: { lt: now },
      status: { in: OPEN_STATUSES },
    },
    select: {
      id: true,
      organizationId: true,
      code: true,
      title: true,
      priority: true,
      slaDueAt: true,
      room: { select: { number: true } },
    },
    take: 200,
  })

  let breached = 0
  for (const c of overdue) {
    const claimed = await prisma.complaint.updateMany({
      where: { id: c.id, slaBreachedAt: null },
      data: { slaBreachedAt: now },
    })
    if (claimed.count !== 1) continue
    breached++
    await notifyOrgAdmins(c.organizationId, {
      kind: 'COMPLAINT',
      title: `SLA missed: ${c.code}`,
      body:
        `${c.title}${c.room ? ` (Room ${c.room.number})` : ''} — ${c.priority.toLowerCase()} priority, ` +
        `overdue by ${formatSpan(now.getTime() - (c.slaDueAt?.getTime() ?? now.getTime()))}.`,
      link: `/app/complaints/${c.id}`,
    }).catch((error) => console.error('[sla] notify failed', error))
  }
  return breached
}

/** On-read variant: never lets a breach check break a page. */
export async function refreshSlaBreaches(organizationId: string) {
  try {
    await markSlaBreaches(organizationId)
  } catch (error) {
    console.error('[sla] breach check failed', error)
  }
}

// --------------------------------------------------------------------------
// Standalone worker tasks
// --------------------------------------------------------------------------

export async function createTask(params: {
  organizationId: string
  propertyId: string
  roomId?: string | null
  title: string
  description?: string
  kind?: 'MAINTENANCE' | 'CLEANING' | 'FOOD' | 'GROCERY' | 'OTHER'
  priority?: ComplaintPriority
  dueDate?: Date | null
  assignedStaffId?: string | null
  actor: { id?: string; name: string; role: UserRole }
}) {
  if (params.roomId) await assertRoomInProperty(params.roomId, params.propertyId)
  if (params.assignedStaffId) {
    await assertStaffForProperty(params.assignedStaffId, params.organizationId, params.propertyId)
  }

  const task = await prisma.maintenanceTask.create({
    data: {
      organizationId: params.organizationId,
      propertyId: params.propertyId,
      roomId: params.roomId ?? null,
      title: params.title,
      description: params.description,
      kind: params.kind ?? 'MAINTENANCE',
      priority: params.priority ?? 'MEDIUM',
      dueDate: params.dueDate ?? null,
      assignedStaffId: params.assignedStaffId ?? null,
      status: 'PENDING',
    },
  })

  await recordActivity({
    organizationId: params.organizationId,
    propertyId: params.propertyId,
    actorId: params.actor.id,
    actorName: params.actor.name,
    actorRole: params.actor.role,
    event: 'TASK_CREATED',
    entityType: 'MaintenanceTask',
    entityId: task.id,
    summary: params.title,
  })

  if (params.assignedStaffId) {
    await notifyStaff(params.assignedStaffId, {
      organizationId: params.organizationId,
      kind: 'MAINTENANCE',
      title: 'New task assigned',
      body: params.title,
      link: '/worker/tasks',
    })
  }

  return task
}

export async function advanceTask(params: {
  taskId: string
  action: 'ACCEPT' | 'START' | 'COMPLETE' | 'CANCEL'
  note?: string
  photoUrl?: string
  actor: { id?: string; name: string; role: UserRole; staffId?: string | null }
}) {
  const task = await prisma.maintenanceTask.findUnique({
    where: { id: params.taskId },
    include: { complaint: true },
  })
  if (!task) throw new NotFoundError('Task not found')
  if (params.actor.role === 'WORKER') {
    if (!task.assignedStaffId || task.assignedStaffId !== params.actor.staffId) {
      throw new ForbiddenError('This task is not assigned to you')
    }
    if (params.action === 'CANCEL') throw new ForbiddenError('Ask your manager to cancel a task')
  }
  if (task.status === 'COMPLETED' || task.status === 'CANCELLED') {
    throw new ConflictError(`This task is already ${task.status === 'COMPLETED' ? 'completed' : 'cancelled'}`)
  }
  if (params.action === 'ACCEPT' && task.status !== 'PENDING') {
    throw new ConflictError('This task has already been accepted')
  }

  const now = new Date()
  const data =
    params.action === 'ACCEPT'
      ? { status: 'ACCEPTED' as const, acceptedAt: now }
      : params.action === 'START'
        ? { status: 'IN_PROGRESS' as const, startedAt: now }
        : params.action === 'COMPLETE'
          ? {
              status: 'COMPLETED' as const,
              completedAt: now,
              completionNote: params.note,
              completionPhotoUrl: params.photoUrl,
            }
          : { status: 'CANCELLED' as const }

  const updated = await prisma.maintenanceTask.update({ where: { id: task.id }, data })

  // A completed complaint-task resolves its complaint too.
  if (params.action === 'COMPLETE' && task.complaintId) {
    await updateComplaintStatus({
      complaintId: task.complaintId,
      status: 'RESOLVED',
      message: params.note ?? 'Work completed',
      photoUrl: params.photoUrl,
      actor: params.actor,
    })
  } else if (params.action === 'START' && task.complaintId) {
    await updateComplaintStatus({
      complaintId: task.complaintId,
      status: 'IN_PROGRESS',
      message: params.note ?? 'Work started',
      actor: params.actor,
    })
  }

  if (params.action === 'COMPLETE') {
    await recordActivity({
      organizationId: task.organizationId,
      propertyId: task.propertyId,
      actorId: params.actor.id,
      actorName: params.actor.name,
      actorRole: params.actor.role,
      event: 'TASK_COMPLETED',
      entityType: 'MaintenanceTask',
      entityId: task.id,
      summary: `${task.title} completed`,
    })
    await notifyOrgAdmins(task.organizationId, {
      kind: 'MAINTENANCE',
      title: 'Task completed',
      body: `${task.title} — by ${params.actor.name}`,
      link: '/app/complaints',
    })
  }

  return updated
}
