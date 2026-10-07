import { z } from 'zod'
import { ok, parseBody, route } from '@/lib/api-helpers'
import {
  decideExpense,
  expenseUpdateSchema,
  updateExpense,
  voidExpense,
} from '@/server/services/expenses'

/**
 * /api/expenses/<id>  (expenses.manage)
 *   PATCH  — edit an expense (the PG it belongs to cannot change)
 *   POST   — { action: 'APPROVE' | 'REJECT', note? } (owner / money sign-off)
 *          — { action: 'VOID', reason }
 *   DELETE — { reason } voids the expense. Expenses are never hard-deleted:
 *            a voided one stays on record, out of every total.
 *
 * People limited to some PGs only reach expenses of those PGs.
 */

function idFrom(request: Request) {
  return decodeURIComponent(new URL(request.url).pathname.split('/').filter(Boolean).pop() ?? '')
}

const ACCESS = { module: 'expenses', permission: 'expenses.manage' } as const

export const PATCH = route(async ({ user, request }) => {
  const body = await parseBody(request, expenseUpdateSchema)
  return ok(await updateExpense(user, idFrom(request), body))
}, ACCESS)

const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('APPROVE'), note: z.string().trim().max(300).optional() }),
  z.object({ action: z.literal('REJECT'), note: z.string().trim().min(3, 'Say why it is rejected').max(300) }),
  z.object({ action: z.literal('VOID'), reason: z.string().trim().min(3, 'Say why this expense is being voided').max(300) }),
])

export const POST = route(async ({ user, request }) => {
  const body = await parseBody(request, actionSchema)
  const id = idFrom(request)
  if (body.action === 'VOID') return ok(await voidExpense(user, id, body.reason))
  return ok(await decideExpense(user, id, body.action, body.note))
}, ACCESS)

const voidSchema = z.object({
  reason: z.string().trim().min(3, 'Say why this expense is being voided').max(300),
})

export const DELETE = route(async ({ user, request }) => {
  const body = await parseBody(request, voidSchema)
  return ok(await voidExpense(user, idFrom(request), body.reason))
}, ACCESS)
