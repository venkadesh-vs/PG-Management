import 'server-only'

import { z } from 'zod'
import type { Expense, Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type { SessionUser } from '@/lib/auth'
import { expenseSchema } from '@/lib/validation'
import {
  assertPropertyAccess,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '@/lib/tenancy'
import { notifyUsers, recordActivity } from '@/server/events'
import { formatMoney, startOfDay } from '@/lib/utils'
import { orgsWithModuleOff } from './org-modules'
import {
  DEFAULT_APPROVAL_THRESHOLD,
  canApproveExpenses,
  dueOccurrences,
  initialApprovalStatus,
  isRecurrence,
  RECURRENCES,
} from './expense-rules'

/**
 * Expense writes: create, edit, approve/reject, void, and the recurring
 * copies made by the daily automation. Rules live in ./expense-rules.
 */

const UPLOAD_URL = /^\/api\/uploads\/[A-Za-z0-9_-]{6,64}$/

/** The add/edit form: the base expense plus bill no., attachment and recurrence. */
export const expenseInputSchema = expenseSchema.extend({
  billNumber: z.string().trim().max(60).optional().or(z.literal('')),
  receiptUrl: z
    .string()
    .trim()
    .regex(UPLOAD_URL, 'Attach the bill again')
    .optional()
    .or(z.literal(''))
    .nullable(),
  isRecurring: z
    .union([z.boolean(), z.enum(['true', 'false', 'on', ''])])
    .optional(),
  recurrence: z.enum(RECURRENCES).optional().or(z.literal('')),
})
// parseBody hands back the schema's input type, so the service accepts that.
export type ExpenseInput = z.input<typeof expenseInputSchema>

export const expenseUpdateSchema = expenseInputSchema.omit({ propertyId: true }).partial()


async function assertCategory(organizationId: string, categoryId: string) {
  const category = await prisma.expenseCategory.findFirst({
    where: { id: categoryId, organizationId },
    select: { id: true, name: true },
  })
  if (!category) throw new ValidationError('Choose a valid expense category')
  return category
}

/** The attachment must be a file this organization uploaded. */
async function assertReceipt(organizationId: string, url: string | null | undefined) {
  if (!url) return null
  const id = url.split('/').pop()!
  const file = await prisma.uploadedFile.findFirst({ where: { id, organizationId }, select: { id: true } })
  if (!file) throw new ValidationError('receiptUrl: Attach the bill again')
  return url
}

function parseDate(value: string) {
  const date = startOfDay(new Date(value))
  if (Number.isNaN(date.getTime())) throw new ValidationError('spentOn: Choose a valid date')
  return date
}

const truthy = (v: boolean | string | undefined | null) => v === true || v === 'true' || v === 'on'

function recurrenceOf(isRecurring: boolean | string | undefined | null, recurrence: string | undefined | null) {
  if (!truthy(isRecurring)) return { isRecurring: false, recurrence: null }
  return { isRecurring: true, recurrence: isRecurrence(recurrence) ? recurrence : 'MONTHLY' }
}

/** Plain, JSON-safe snapshot used for the audit before/after. */
function snapshot(e: Expense) {
  return {
    title: e.title,
    amount: e.amount,
    spentOn: e.spentOn.toISOString(),
    categoryId: e.categoryId,
    paidTo: e.paidTo,
    paymentMode: e.paymentMode,
    reference: e.reference,
    billNumber: e.billNumber,
    receiptUrl: e.receiptUrl,
    notes: e.notes,
    isRecurring: e.isRecurring,
    recurrence: e.recurrence,
    approvalStatus: e.approvalStatus,
  }
}

export async function notifyApprovers(organizationId: string, expense: { title: string; amount: number }, by: string) {
  const owners = await prisma.user.findMany({
    where: { organizationId, role: 'OWNER', status: 'ACTIVE' },
    select: { id: true },
  })
  await notifyUsers(
    owners.map((o) => o.id),
    {
      organizationId,
      kind: 'SYSTEM',
      title: 'Expense waiting for approval',
      body: `${by} recorded ${expense.title} (${formatMoney(expense.amount)}). It counts once you approve it.`,
      link: '/app/expenses?status=PENDING',
    },
  )
}

/** The organization's approval threshold (Settings), or the default when none is saved. */
export async function approvalThreshold(organizationId: string, db: Prisma.TransactionClient | typeof prisma = prisma) {
  const row = await db.orgSetting.findUnique({ where: { organizationId }, select: { expenseApprovalThreshold: true } })
  return row?.expenseApprovalThreshold ?? DEFAULT_APPROVAL_THRESHOLD
}

export async function createExpense(
  user: SessionUser,
  body: ExpenseInput,
  opts: {
    /** Run inside the caller's transaction (approvers are then notified by the caller). */
    tx?: Prisma.TransactionClient
    /** The maintenance task this cost belongs to. */
    maintenanceTaskId?: string
    /** Already approved elsewhere (a maintenance estimate approved by this person). */
    preApprovedBy?: string
  } = {},
) {
  const organizationId = user.organizationId!
  const db = opts.tx ?? prisma
  await assertPropertyAccess(user, body.propertyId)
  const category = await assertCategory(organizationId, body.categoryId)
  const receiptUrl = await assertReceipt(organizationId, body.receiptUrl)
  const approver = canApproveExpenses(user)
  const threshold = await approvalThreshold(organizationId, db)
  // Staff-app entries always wait for the owner, whatever the amount.
  const fromStaff = user.role === 'WORKER'
  const approvalStatus = opts.preApprovedBy
    ? 'APPROVED'
    : fromStaff
      ? 'PENDING'
      : initialApprovalStatus(body.amount, approver, threshold)

  const expense = await db.expense.create({
    data: {
      organizationId,
      propertyId: body.propertyId,
      categoryId: body.categoryId,
      title: body.title,
      amount: body.amount,
      spentOn: parseDate(body.spentOn),
      paidTo: body.paidTo || null,
      paymentMode: body.paymentMode ?? 'CASH',
      reference: body.reference || null,
      billNumber: body.billNumber || null,
      notes: body.notes || null,
      receiptUrl,
      recordedBy: user.name,
      ...(fromStaff ? { isRecurring: false, recurrence: null } : recurrenceOf(body.isRecurring, body.recurrence)),
      approvalStatus,
      maintenanceTaskId: opts.maintenanceTaskId ?? null,
      ...(opts.preApprovedBy
        ? { approvedBy: opts.preApprovedBy, approvedAt: new Date() }
        : approvalStatus === 'APPROVED' && approver && body.amount >= threshold
          ? { approvedBy: user.name, approvedAt: new Date() }
          : {}),
    },
  })

  await recordActivity({
    organizationId,
    propertyId: body.propertyId,
    actorId: user.id,
    actorName: user.name,
    actorRole: user.role,
    event: 'EXPENSE_CREATED',
    entityType: 'Expense',
    entityId: expense.id,
    summary: `${expense.title} · ${formatMoney(expense.amount)} (${category.name})${approvalStatus === 'PENDING' ? ' — waiting for approval' : ''}`,
    after: snapshot(expense),
  }, opts.tx)
  if (approvalStatus === 'PENDING' && !opts.tx) {
    await notifyApprovers(organizationId, expense, user.name).catch(() => undefined)
  }

  return {
    expense,
    message:
      approvalStatus === 'PENDING'
        ? `${formatMoney(expense.amount)} recorded — it counts once the owner approves it`
        : `${formatMoney(expense.amount)} expense recorded`,
  }
}

export async function loadExpense(user: SessionUser, id: string) {
  const expense = await prisma.expense.findUnique({
    where: { id },
    include: { category: { select: { name: true } } },
  })
  if (!expense || expense.organizationId !== user.organizationId) {
    throw new NotFoundError('Expense not found')
  }
  await assertPropertyAccess(user, expense.propertyId)
  return expense
}

export async function updateExpense(user: SessionUser, id: string, body: z.input<typeof expenseUpdateSchema>) {
  const expense = await loadExpense(user, id)
  if (expense.voidedAt) throw new ConflictError('This expense was voided and can no longer be edited')

  if (body.categoryId !== undefined && body.categoryId !== expense.categoryId) {
    await assertCategory(expense.organizationId, body.categoryId)
  }
  const receiptUrl =
    body.receiptUrl !== undefined ? await assertReceipt(expense.organizationId, body.receiptUrl) : undefined
  const recurring =
    body.isRecurring !== undefined || body.recurrence !== undefined
      ? recurrenceOf(body.isRecurring ?? expense.isRecurring, body.recurrence || expense.recurrence || undefined)
      : undefined

  // Raising an approved expense to the threshold by someone who cannot
  // approve sends it back for approval.
  const approver = canApproveExpenses(user)
  const newAmount = body.amount ?? expense.amount
  const threshold = await approvalThreshold(expense.organizationId)
  const needsApproval =
    !approver && newAmount >= threshold && newAmount > expense.amount && expense.approvalStatus === 'APPROVED'

  const updated = await prisma.expense.update({
    where: { id: expense.id },
    data: {
      ...(body.categoryId !== undefined ? { categoryId: body.categoryId } : {}),
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.amount !== undefined ? { amount: body.amount } : {}),
      ...(body.spentOn !== undefined ? { spentOn: parseDate(body.spentOn) } : {}),
      ...(body.paidTo !== undefined ? { paidTo: body.paidTo || null } : {}),
      ...(body.paymentMode !== undefined ? { paymentMode: body.paymentMode } : {}),
      ...(body.reference !== undefined ? { reference: body.reference || null } : {}),
      ...(body.billNumber !== undefined ? { billNumber: body.billNumber || null } : {}),
      ...(body.notes !== undefined ? { notes: body.notes || null } : {}),
      ...(receiptUrl !== undefined ? { receiptUrl } : {}),
      ...(recurring ?? {}),
      ...(needsApproval ? { approvalStatus: 'PENDING' as const, approvedBy: null, approvedAt: null } : {}),
    },
    include: { category: { select: { name: true } } },
  })

  await recordActivity({
    organizationId: expense.organizationId,
    propertyId: expense.propertyId,
    actorId: user.id,
    actorName: user.name,
    actorRole: user.role,
    event: 'EXPENSE_UPDATED',
    entityType: 'Expense',
    entityId: expense.id,
    summary: `Expense edited: ${updated.title} · ${formatMoney(updated.amount)} (${updated.category.name})`,
    before: snapshot(expense),
    after: snapshot(updated),
  })
  if (needsApproval) await notifyApprovers(expense.organizationId, updated, user.name).catch(() => undefined)

  return {
    expense: updated,
    message: needsApproval ? `${updated.title} saved — waiting for the owner's approval` : `${updated.title} saved`,
  }
}

export async function voidExpense(user: SessionUser, id: string, reason: string) {
  const text = reason.trim()
  if (text.length < 3) throw new ValidationError('reason: Say why this expense is being voided')
  const expense = await loadExpense(user, id)
  if (expense.voidedAt) throw new ConflictError('This expense is already voided')

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.expense.update({
      where: { id: expense.id },
      // A voided recurring expense stops repeating too.
      data: { voidedAt: new Date(), voidReason: text, isRecurring: false },
    })
    await recordActivity(
      {
        organizationId: expense.organizationId,
        propertyId: expense.propertyId,
        actorId: user.id,
        actorName: user.name,
        actorRole: user.role,
        event: 'EXPENSE_VOIDED',
        entityType: 'Expense',
        entityId: expense.id,
        summary: `Expense voided: ${expense.title} · ${formatMoney(expense.amount)} (${expense.category.name}) — ${text}`,
        before: snapshot(expense),
        after: { voidedAt: row.voidedAt?.toISOString() ?? null, voidReason: text },
      },
      tx,
    )
    return row
  })

  return { expense: updated, message: `${expense.title} (${formatMoney(expense.amount)}) voided — it no longer counts` }
}

export async function decideExpense(
  user: SessionUser,
  id: string,
  decision: 'APPROVE' | 'REJECT',
  note?: string,
) {
  if (!canApproveExpenses(user)) throw new ForbiddenError('Only the owner can approve or reject expenses')
  const expense = await loadExpense(user, id)
  if (expense.voidedAt) throw new ConflictError('This expense was voided')
  const status = decision === 'APPROVE' ? 'APPROVED' : 'REJECTED'
  if (expense.approvalStatus === status) {
    throw new ConflictError(`This expense is already ${status.toLowerCase()}`)
  }
  const reason = note?.trim()
  if (decision === 'REJECT' && !reason) throw new ValidationError('note: Say why it is rejected')

  const updated = await prisma.expense.update({
    where: { id: expense.id },
    data: {
      approvalStatus: status,
      approvedBy: user.name,
      approvedAt: new Date(),
      ...(reason ? { notes: [expense.notes, `${decision === 'APPROVE' ? 'Approved' : 'Rejected'}: ${reason}`].filter(Boolean).join('\n') } : {}),
    },
  })
  await recordActivity({
    organizationId: expense.organizationId,
    propertyId: expense.propertyId,
    actorId: user.id,
    actorName: user.name,
    actorRole: user.role,
    event: 'EXPENSE_UPDATED',
    entityType: 'Expense',
    entityId: expense.id,
    summary: `Expense ${status.toLowerCase()}: ${expense.title} · ${formatMoney(expense.amount)}${reason ? ` — ${reason}` : ''}`,
    meta: { action: decision },
    before: { approvalStatus: expense.approvalStatus },
    after: { approvalStatus: status, approvedBy: user.name },
  })

  return {
    expense: updated,
    message:
      decision === 'APPROVE'
        ? `${expense.title} approved — it now counts in expenses and P&L`
        : `${expense.title} rejected — it stays out of the totals`,
  }
}

/**
 * Daily automation: for every live recurring expense (approved, not voided)
 * create the copy that has fallen due — same PG, category, amount, vendor —
 * linked by recurringFromId. Idempotent (see dueOccurrences).
 */
export async function createRecurringExpenses(params: { now: Date; organizationId?: string }) {
  const off = await orgsWithModuleOff('expenses', params.organizationId)
  const series = await prisma.expense.findMany({
    where: {
      isRecurring: true,
      recurringFromId: null,
      voidedAt: null,
      approvalStatus: 'APPROVED',
      organization: { archivedAt: null, status: { in: ['ACTIVE', 'TRIAL', 'PAST_DUE'] } },
      AND: [
        params.organizationId ? { organizationId: params.organizationId } : {},
        off.length ? { organizationId: { notIn: off } } : {},
      ],
    },
  })

  let created = 0
  for (const root of series) {
    if (!isRecurrence(root.recurrence)) continue
    const copies = await prisma.expense.findMany({
      where: { recurringFromId: root.id },
      select: { spentOn: true },
    })
    const due = dueOccurrences({
      anchor: root.spentOn,
      recurrence: root.recurrence,
      existing: [root.spentOn, ...copies.map((c) => c.spentOn)],
      today: params.now,
    })
    for (const spentOn of due) {
      const copy = await prisma.expense.create({
        data: {
          organizationId: root.organizationId,
          propertyId: root.propertyId,
          categoryId: root.categoryId,
          title: root.title,
          amount: root.amount,
          spentOn,
          paidTo: root.paidTo,
          paymentMode: root.paymentMode,
          notes: root.notes,
          recordedBy: 'Automation',
          recurringFromId: root.id,
          recurrence: root.recurrence,
          approvalStatus: 'APPROVED',
          approvedBy: root.approvedBy,
          approvedAt: root.approvedBy ? new Date() : null,
        },
      })
      await recordActivity({
        organizationId: root.organizationId,
        propertyId: root.propertyId,
        actorName: 'Automation',
        event: 'EXPENSE_CREATED',
        entityType: 'Expense',
        entityId: copy.id,
        summary: `Recurring expense added: ${copy.title} · ${formatMoney(copy.amount)}`,
        meta: { recurringFromId: root.id },
      })
      created++
    }
  }
  return { series: series.length, created }
}
