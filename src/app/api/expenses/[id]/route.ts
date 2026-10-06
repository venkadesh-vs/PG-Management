import { prisma } from '@/lib/prisma'
import type { SessionUser } from '@/lib/auth'
import { ok, parseBody, route } from '@/lib/api-helpers'
import { assertPropertyAccess, NotFoundError, ValidationError } from '@/lib/tenancy'
import { expenseSchema } from '@/lib/validation'
import { recordActivity } from '@/server/events'
import { formatMoney, startOfDay } from '@/lib/utils'

/**
 * /api/expenses/<id>  (expenses.manage)
 *   PATCH  — edit an expense (the PG it belongs to cannot change)
 *   DELETE — remove it; the activity log keeps what was deleted.
 *
 * People limited to some PGs only reach expenses of those PGs.
 */

const updateSchema = expenseSchema.omit({ propertyId: true }).partial()

function idFrom(request: Request) {
  return decodeURIComponent(new URL(request.url).pathname.split('/').filter(Boolean).pop() ?? '')
}

async function loadExpense(user: SessionUser, id: string) {
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

export const PATCH = route(
  async ({ user, request }) => {
    const expense = await loadExpense(user, idFrom(request))
    const body = await parseBody(request, updateSchema)

    if (body.categoryId !== undefined && body.categoryId !== expense.categoryId) {
      const category = await prisma.expenseCategory.findFirst({
        where: { id: body.categoryId, organizationId: expense.organizationId },
        select: { id: true },
      })
      if (!category) throw new ValidationError('Choose a valid expense category')
    }
    let spentOn: Date | undefined
    if (body.spentOn !== undefined) {
      spentOn = startOfDay(new Date(body.spentOn))
      if (Number.isNaN(spentOn.getTime())) throw new ValidationError('spentOn: Choose a valid date')
    }

    const updated = await prisma.expense.update({
      where: { id: expense.id },
      data: {
        ...(body.categoryId !== undefined ? { categoryId: body.categoryId } : {}),
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.amount !== undefined ? { amount: body.amount } : {}),
        ...(spentOn ? { spentOn } : {}),
        ...(body.paidTo !== undefined ? { paidTo: body.paidTo || null } : {}),
        ...(body.paymentMode !== undefined ? { paymentMode: body.paymentMode } : {}),
        ...(body.reference !== undefined ? { reference: body.reference || null } : {}),
        ...(body.notes !== undefined ? { notes: body.notes || null } : {}),
      },
      include: { category: { select: { name: true } } },
    })

    // EXPENSE_CREATED is the only expense event; meta marks it as an edit.
    await recordActivity({
      organizationId: expense.organizationId,
      propertyId: expense.propertyId,
      actorId: user.id,
      actorName: user.name,
      actorRole: user.role,
      event: 'EXPENSE_CREATED',
      entityType: 'Expense',
      entityId: expense.id,
      summary: `Expense edited: ${updated.title} · ${formatMoney(updated.amount)} (${updated.category.name})`,
      meta: {
        action: 'UPDATE',
        before: { title: expense.title, amount: expense.amount, spentOn: expense.spentOn.toISOString() },
      },
    })

    return ok({ expense: updated, message: `${updated.title} saved` })
  },
  { module: 'expenses', permission: 'expenses.manage' },
)

export const DELETE = route(
  async ({ user, request }) => {
    const expense = await loadExpense(user, idFrom(request))

    await prisma.$transaction(async (tx) => {
      await tx.expense.delete({ where: { id: expense.id } })
      // A grocery purchase that raised this expense keeps its stock entry but
      // no longer points at a deleted row.
      await tx.groceryPurchase.updateMany({
        where: { expenseId: expense.id },
        data: { expenseId: null },
      })
      await recordActivity(
        {
          organizationId: expense.organizationId,
          propertyId: expense.propertyId,
          actorId: user.id,
          actorName: user.name,
          actorRole: user.role,
          event: 'EXPENSE_CREATED',
          entityType: 'Expense',
          entityId: expense.id,
          summary: `Expense deleted: ${expense.title} · ${formatMoney(expense.amount)} (${expense.category.name})`,
          meta: {
            action: 'DELETE',
            title: expense.title,
            amount: expense.amount,
            spentOn: expense.spentOn.toISOString(),
            paidTo: expense.paidTo,
          },
        },
        tx,
      )
    })

    return ok({ message: `${expense.title} (${formatMoney(expense.amount)}) deleted` })
  },
  { module: 'expenses', permission: 'expenses.manage' },
)
