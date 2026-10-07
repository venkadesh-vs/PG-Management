import 'server-only'

import { z } from 'zod'
import type { MaintenanceTask } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type { SessionUser } from '@/lib/auth'
import {
  assertInScope,
  ConflictError,
  ForbiddenError,
  hasPermission,
  NotFoundError,
  ValidationError,
} from '@/lib/tenancy'
import { formatMoney, toISODate } from '@/lib/utils'
import { recordActivity } from '../events'
import { canApproveExpenses } from './expense-rules'
import { createExpense, notifyApprovers } from './expenses'

/**
 * Repair work on a complaint or maintenance task:
 *   vendor → estimate → estimate approval → work → actual cost → expense.
 *
 * The actual cost becomes an Expense exactly once (Expense.maintenanceTaskId ↔
 * MaintenanceTask.expenseId), inside the same transaction that locks the task,
 * so a double-click or retry cannot book the cost twice.
 */

const rupees = z.coerce.number().int('Enter a whole rupee amount').positive('Enter an amount greater than zero').max(1_00_00_000)
const phone = z
  .string()
  .trim()
  .regex(/^(\+?91[-\s]?)?[6-9]\d{9}$/, 'Enter a valid 10-digit mobile number')

export const maintenanceActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('VENDOR'),
    vendorName: z.string().trim().max(120).optional().or(z.literal('')),
    vendorPhone: phone.optional().or(z.literal('')),
  }),
  z.object({ action: z.literal('ESTIMATE'), amount: rupees, note: z.string().trim().max(300).optional() }),
  z.object({ action: z.literal('APPROVE_ESTIMATE') }),
  z.object({ action: z.literal('REJECT_ESTIMATE'), reason: z.string().trim().min(3, 'Say why').max(300) }),
  z.object({
    action: z.literal('RECORD_COST'),
    amount: rupees,
    categoryId: z.string().optional(),
    spentOn: z.string().optional(),
    paymentMode: z.enum(['CASH', 'UPI', 'BANK_TRANSFER', 'CARD', 'CHEQUE']).default('CASH'),
    billNumber: z.string().trim().max(60).optional().or(z.literal('')),
    reference: z.string().trim().max(80).optional().or(z.literal('')),
    receiptUrl: z
      .string()
      .trim()
      .regex(/^\/api\/uploads\/[A-Za-z0-9_-]{6,64}$/, 'Attach the bill again')
      .optional()
      .or(z.literal('')),
  }),
])
// parseBody hands back the schema's input type.
export type MaintenanceAction = z.input<typeof maintenanceActionSchema>

function snapshot(t: MaintenanceTask) {
  return {
    vendorName: t.vendorName,
    vendorPhone: t.vendorPhone,
    estimateAmount: t.estimateAmount,
    estimateApprovedAt: t.estimateApprovedAt?.toISOString() ?? null,
    estimateApprovedBy: t.estimateApprovedBy,
    actualCost: t.actualCost,
    expenseId: t.expenseId,
  }
}

async function loadTask(user: SessionUser, taskId: string) {
  const task = await prisma.maintenanceTask.findFirst({
    where: { id: taskId, organizationId: user.organizationId! },
    include: { complaint: { select: { code: true } }, room: { select: { number: true } } },
  })
  if (!task) throw new NotFoundError('Task not found')
  assertInScope(user, task.propertyId)
  return task
}

/** Starts repair tracking for a complaint that has no task yet (no worker needed). */
export async function taskForComplaint(user: SessionUser, complaintId: string) {
  const complaint = await prisma.complaint.findFirst({
    where: { id: complaintId, organizationId: user.organizationId! },
  })
  if (!complaint) throw new NotFoundError('Complaint not found')
  assertInScope(user, complaint.propertyId)
  const existing = await prisma.maintenanceTask.findFirst({ where: { complaintId: complaint.id } })
  if (existing) return { task: existing, created: false }

  const task = await prisma.maintenanceTask.create({
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
    },
  })
  await recordActivity({
    organizationId: complaint.organizationId,
    propertyId: complaint.propertyId,
    actorId: user.id,
    actorName: user.name,
    actorRole: user.role,
    event: 'TASK_CREATED',
    entityType: 'MaintenanceTask',
    entityId: task.id,
    summary: `Repair tracking started for ${complaint.code} · ${complaint.title}`,
  })
  return { task, created: true }
}

export async function applyMaintenanceAction(user: SessionUser, taskId: string, body: MaintenanceAction) {
  const task = await loadTask(user, taskId)
  const label = task.complaint ? `${task.complaint.code} · ${task.title}` : task.title
  const audit = (summary: string, after: MaintenanceTask, meta?: Record<string, unknown>) =>
    recordActivity({
      organizationId: task.organizationId,
      propertyId: task.propertyId,
      actorId: user.id,
      actorName: user.name,
      actorRole: user.role,
      event: 'MAINTENANCE_UPDATED',
      entityType: 'MaintenanceTask',
      entityId: task.id,
      summary,
      meta: { action: body.action, ...meta },
      before: snapshot(task),
      after: snapshot(after),
    })

  if (task.status === 'CANCELLED') throw new ConflictError('This task was cancelled')
  if (body.action !== 'RECORD_COST' && task.expenseId) {
    throw new ConflictError('The cost is already recorded for this repair')
  }

  switch (body.action) {
    case 'VENDOR': {
      const updated = await prisma.maintenanceTask.update({
        where: { id: task.id },
        data: { vendorName: body.vendorName || null, vendorPhone: body.vendorPhone || null },
      })
      await audit(`Vendor for ${label}: ${updated.vendorName ?? 'none'}`, updated)
      return { message: updated.vendorName ? `Vendor set to ${updated.vendorName}` : 'Vendor cleared' }
    }

    case 'ESTIMATE': {
      // A new estimate needs a fresh approval.
      const updated = await prisma.maintenanceTask.update({
        where: { id: task.id },
        data: { estimateAmount: body.amount, estimateApprovedAt: null, estimateApprovedBy: null },
      })
      await audit(`Estimate ${formatMoney(body.amount)} for ${label}${body.note ? ` — ${body.note}` : ''}`, updated)
      return {
        message: canApproveExpenses(user)
          ? `Estimate of ${formatMoney(body.amount)} saved — approve it to go ahead`
          : `Estimate of ${formatMoney(body.amount)} sent for the owner's approval`,
      }
    }

    case 'APPROVE_ESTIMATE': {
      if (!canApproveExpenses(user)) {
        throw new ForbiddenError('Only the owner or someone who can approve expenses can approve an estimate')
      }
      if (task.estimateAmount == null) throw new ValidationError('Add an estimate first')
      // Conditional update: two approvers clicking together approve once.
      const result = await prisma.maintenanceTask.updateMany({
        where: { id: task.id, estimateApprovedAt: null, estimateAmount: task.estimateAmount },
        data: { estimateApprovedAt: new Date(), estimateApprovedBy: user.name },
      })
      if (result.count !== 1) throw new ConflictError('This estimate was already approved or changed — refresh')
      const updated = await prisma.maintenanceTask.findUniqueOrThrow({ where: { id: task.id } })
      await audit(`Estimate ${formatMoney(task.estimateAmount)} approved for ${label}`, updated)
      return { message: `Estimate of ${formatMoney(task.estimateAmount)} approved` }
    }

    case 'REJECT_ESTIMATE': {
      if (!canApproveExpenses(user)) {
        throw new ForbiddenError('Only the owner or someone who can approve expenses can reject an estimate')
      }
      if (task.estimateAmount == null) throw new ValidationError('There is no estimate to reject')
      const updated = await prisma.maintenanceTask.update({
        where: { id: task.id },
        data: { estimateAmount: null, estimateApprovedAt: null, estimateApprovedBy: null },
      })
      await audit(`Estimate ${formatMoney(task.estimateAmount)} rejected for ${label} — ${body.reason}`, updated, {
        reason: body.reason,
      })
      return { message: 'Estimate rejected — ask for a new quote' }
    }

    case 'RECORD_COST':
      return recordCost(user, task, body, label)
  }
}

async function recordCost(
  user: SessionUser,
  task: Awaited<ReturnType<typeof loadTask>>,
  body: Extract<MaintenanceAction, { action: 'RECORD_COST' }>,
  label: string,
) {
  if (task.estimateAmount != null && !task.estimateApprovedAt) {
    throw new ConflictError('Approve the estimate before recording the cost')
  }
  const bookExpense = user.modules.includes('expenses')
  if (bookExpense && !hasPermission(user, 'expenses.manage')) {
    throw new ForbiddenError('Your role does not allow recording expenses. Ask the PG owner for access.')
  }
  let categoryId = body.categoryId
  if (bookExpense && !categoryId) {
    const categories = await prisma.expenseCategory.findMany({
      where: { organizationId: task.organizationId },
      select: { id: true, name: true },
    })
    categoryId = (categories.find((c) => /repair|maint/i.test(c.name)) ?? categories[0])?.id
    if (!categoryId) throw new ValidationError('Add an expense category first (Settings → Lookups)')
  }
  // Within the approved estimate: the estimate approval stands for the expense.
  const preApprovedBy =
    task.estimateApprovedBy && task.estimateAmount != null && body.amount <= task.estimateAmount
      ? task.estimateApprovedBy
      : undefined

  const outcome = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "MaintenanceTask" WHERE "id" = ${task.id} FOR UPDATE`
    const fresh = await tx.maintenanceTask.findUniqueOrThrow({ where: { id: task.id } })
    if (fresh.expenseId || (!bookExpense && fresh.actualCost != null)) {
      throw new ConflictError('The cost of this repair is already recorded')
    }

    let expense: { id: string; approvalStatus: string } | null = null
    if (bookExpense) {
      const created = await createExpense(
        user,
        {
          propertyId: task.propertyId,
          categoryId: categoryId!,
          title: `Repair — ${task.title}${task.room ? ` (Room ${task.room.number})` : ''}`.slice(0, 140),
          amount: body.amount,
          spentOn: body.spentOn || toISODate(new Date()),
          paidTo: fresh.vendorName || undefined,
          paymentMode: body.paymentMode,
          reference: body.reference || undefined,
          billNumber: body.billNumber || undefined,
          receiptUrl: body.receiptUrl || undefined,
          notes: task.complaint ? `For complaint ${task.complaint.code}` : undefined,
        },
        { tx, maintenanceTaskId: task.id, preApprovedBy },
      )
      expense = created.expense
    }

    const updated = await tx.maintenanceTask.update({
      where: { id: task.id },
      data: { actualCost: body.amount, expenseId: expense?.id ?? null },
    })
    await recordActivity(
      {
        organizationId: task.organizationId,
        propertyId: task.propertyId,
        actorId: user.id,
        actorName: user.name,
        actorRole: user.role,
        event: 'MAINTENANCE_UPDATED',
        entityType: 'MaintenanceTask',
        entityId: task.id,
        summary: `Actual cost ${formatMoney(body.amount)} for ${label}${
          task.estimateAmount != null && body.amount > task.estimateAmount
            ? ` — ${formatMoney(body.amount - task.estimateAmount)} over the estimate`
            : ''
        }`,
        meta: { action: 'RECORD_COST', expenseId: expense?.id ?? null },
        before: snapshot(fresh),
        after: snapshot(updated),
      },
      tx,
    )
    return { expense }
  })

  if (outcome.expense?.approvalStatus === 'PENDING') {
    await notifyApprovers(task.organizationId, { title: `Repair — ${task.title}`, amount: body.amount }, user.name).catch(
      () => undefined,
    )
  }
  return {
    message: !outcome.expense
      ? `Cost of ${formatMoney(body.amount)} recorded`
      : outcome.expense.approvalStatus === 'PENDING'
        ? `${formatMoney(body.amount)} recorded as an expense — it counts once the owner approves it`
        : `${formatMoney(body.amount)} recorded as an expense`,
    expenseId: outcome.expense?.id ?? null,
  }
}
