import { prisma } from '@/lib/prisma'
import { ok, parseBody, route } from '@/lib/api-helpers'
import {
  assertInScope,
  assertPropertyAccess,
  ForbiddenError,
  NotFoundError,
  requireModule,
  requirePermission,
} from '@/lib/tenancy'
import { complaintActionSchema, complaintSchema } from '@/lib/validation'
import {
  addComplaintComment,
  assignComplaint,
  createComplaint,
  updateComplaintStatus,
} from '@/server/services/complaints'

/**
 * POST /api/complaints — raise a complaint. Residents raise their own;
 * owners and managers can raise one on anyone's behalf.
 */
export const POST = route(
  async ({ user, request }) => {
    // Permission before validation: people without access hear why, not "title is required".
    requireModule(user, 'complaints')
    if (user.role !== 'TENANT') requirePermission(user, 'complaints.manage')
    const body = await parseBody(request, complaintSchema)

    if (user.role === 'TENANT') {
      // Residents hold no permissions; the module and their own record decide.
      requireModule(user, 'residentApp')
      const resident = await prisma.resident.findUnique({
        where: { id: user.residentId! },
        select: { id: true, propertyId: true, roomId: true, organizationId: true },
      })
      if (!resident) throw new NotFoundError('Resident record not found')

      const complaint = await createComplaint({
        organizationId: resident.organizationId,
        propertyId: resident.propertyId,
        residentId: resident.id,
        roomId: resident.roomId,
        category: body.category,
        priority: body.priority,
        title: body.title,
        description: body.description,
        photoUrls: body.photoUrls,
        actor: { id: user.id, name: user.name, role: user.role },
      })
      return ok(
        { complaint: { id: complaint.id, code: complaint.code }, message: `Complaint ${complaint.code} raised` },
        { status: 201 },
      )
    }

    requirePermission(user, 'complaints.manage')
    await assertPropertyAccess(user, body.propertyId)
    // createComplaint checks residentId / roomId belong to this org and PG.

    const complaint = await createComplaint({
      organizationId: user.organizationId!,
      propertyId: body.propertyId,
      residentId: body.residentId || null,
      roomId: body.roomId || null,
      category: body.category,
      priority: body.priority,
      title: body.title,
      description: body.description,
      photoUrls: body.photoUrls,
      actor: { id: user.id, name: user.name, role: user.role },
    })

    return ok(
      { complaint: { id: complaint.id, code: complaint.code }, message: `Complaint ${complaint.code} raised` },
      { status: 201 },
    )
  },
  { module: 'complaints' },
)

/** PATCH /api/complaints — assign, change status, or add a message. */
export const PATCH = route(
  async ({ user, request }) => {
    const body = await parseBody(request, complaintActionSchema)

    const complaint = await prisma.complaint.findUnique({
      where: { id: body.complaintId },
      select: {
        id: true,
        organizationId: true,
        propertyId: true,
        residentId: true,
        assignedStaffId: true,
        code: true,
      },
    })
    if (!complaint) throw new NotFoundError('Complaint not found')

    // Scope check: an org user must own it; a tenant must be the raiser; a
    // worker must be the assignee.
    if (user.role === 'TENANT') {
      requireModule(user, 'residentApp')
      if (!user.residentId || complaint.residentId !== user.residentId) throw new ForbiddenError()
      if (body.action !== 'COMMENT' && !(body.action === 'STATUS' && body.status === 'CLOSED')) {
        throw new ForbiddenError('Residents can comment or close their own complaint')
      }
    } else if (user.role === 'WORKER') {
      requirePermission(user, 'tasks.work')
      if (!user.staffId || complaint.assignedStaffId !== user.staffId) {
        throw new ForbiddenError('Not your task')
      }
      if (body.action === 'ASSIGN') throw new ForbiddenError('Only an owner can reassign')
    } else {
      requirePermission(user, body.action === 'ASSIGN' ? 'complaints.assign' : 'complaints.manage')
      if (complaint.organizationId !== user.organizationId) throw new ForbiddenError()
      assertInScope(user, complaint.propertyId)
    }

    const actor = { id: user.id, name: user.name, role: user.role }

    if (body.action === 'ASSIGN') {
      if (!body.staffId) throw new NotFoundError('Choose a staff member')
      await assignComplaint({
        complaintId: complaint.id,
        staffId: body.staffId,
        dueDate: body.dueDate ? new Date(body.dueDate) : undefined,
        note: body.message || undefined,
        actor,
      })
      return ok({ message: `${complaint.code} assigned` })
    }

    if (body.action === 'STATUS') {
      if (!body.status) throw new NotFoundError('Choose a status')
      await updateComplaintStatus({
        complaintId: complaint.id,
        status: body.status,
        message: body.message || undefined,
        photoUrl: body.photoUrl || undefined,
        rating: body.rating,
        actor,
      })
      return ok({ message: `${complaint.code} marked ${body.status.replace('_', ' ').toLowerCase()}` })
    }

    await addComplaintComment({
      complaintId: complaint.id,
      message: body.message ?? '',
      photoUrl: body.photoUrl || undefined,
      actor,
    })
    return ok({ message: 'Message added' })
  },
  { module: 'complaints' },
)
