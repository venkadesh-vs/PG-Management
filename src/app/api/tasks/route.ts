import { prisma } from '@/lib/prisma'
import { ok, parseBody, route } from '@/lib/api-helpers'
import {
  assertInScope,
  assertPropertyAccess,
  assertRoomInProperty,
  assertStaffForProperty,
  ForbiddenError,
  NotFoundError,
} from '@/lib/tenancy'
import { taskActionSchema, taskSchema } from '@/lib/validation'
import { advanceTask, createTask } from '@/server/services/complaints'

/** POST /api/tasks — owner/manager creates a worker task. */
export const POST = route(
  async ({ user, request }) => {
    const body = await parseBody(request, taskSchema)
    await assertPropertyAccess(user, body.propertyId)
    if (body.roomId) await assertRoomInProperty(body.roomId, body.propertyId)
    if (body.assignedStaffId) {
      await assertStaffForProperty(body.assignedStaffId, user.organizationId!, body.propertyId)
    }

    const task = await createTask({
      organizationId: user.organizationId!,
      propertyId: body.propertyId,
      roomId: body.roomId || null,
      title: body.title,
      description: body.description || undefined,
      kind: body.kind,
      priority: body.priority,
      dueDate: body.dueDate ? new Date(body.dueDate) : null,
      assignedStaffId: body.assignedStaffId || null,
      actor: { id: user.id, name: user.name, role: user.role },
    })

    return ok({ task, message: 'Task created' }, { status: 201 })
  },
  { roles: ['OWNER', 'MANAGER'] },
)

/** PATCH /api/tasks — accept, start, complete or cancel. */
export const PATCH = route(async ({ user, request }) => {
  const body = await parseBody(request, taskActionSchema)

  const task = await prisma.maintenanceTask.findUnique({
    where: { id: body.taskId },
    select: {
      id: true,
      organizationId: true,
      propertyId: true,
      assignedStaffId: true,
      title: true,
    },
  })
  if (!task) throw new NotFoundError('Task not found')
  if (task.organizationId !== user.organizationId) throw new ForbiddenError()
  if (user.role === 'TENANT') throw new ForbiddenError()

  if (user.role === 'WORKER') {
    // Workers only see — and so only move — tasks assigned to them.
    if (!user.staffId || task.assignedStaffId !== user.staffId) {
      throw new ForbiddenError('Not your task')
    }
    if (body.action === 'CANCEL') throw new ForbiddenError('Ask your manager to cancel a task')
  } else {
    assertInScope(user, task.propertyId)
  }

  await advanceTask({
    taskId: task.id,
    action: body.action,
    note: body.note || undefined,
    photoUrl: body.photoUrl || undefined,
    actor: { id: user.id, name: user.name, role: user.role, staffId: user.staffId },
  })

  const verb =
    body.action === 'ACCEPT'
      ? 'accepted'
      : body.action === 'START'
        ? 'started'
        : body.action === 'COMPLETE'
          ? 'completed'
          : 'cancelled'

  return ok({ message: `Task ${verb}` })
})
