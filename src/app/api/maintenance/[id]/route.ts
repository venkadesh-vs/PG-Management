import { ok, parseBody, route } from '@/lib/api-helpers'
import { applyMaintenanceAction, maintenanceActionSchema } from '@/server/services/maintenance'

/**
 * POST /api/maintenance/<taskId>  (complaints.manage)
 *   { action: 'VENDOR', vendorName?, vendorPhone? }
 *   { action: 'ESTIMATE', amount, note? }          — clears any earlier approval
 *   { action: 'APPROVE_ESTIMATE' }                 — owner / expense approvers
 *   { action: 'REJECT_ESTIMATE', reason }          — owner / expense approvers
 *   { action: 'RECORD_COST', amount, categoryId?, spentOn?, paymentMode?, billNumber?, reference?, receiptUrl? }
 *       — books the actual cost as an Expense once (needs expenses.manage when
 *         the Expenses module is on). Within the approved estimate the expense
 *         is approved by the estimate's approver.
 */
function idFrom(request: Request) {
  return decodeURIComponent(new URL(request.url).pathname.split('/').filter(Boolean).pop() ?? '')
}

export const POST = route(
  async ({ user, request }) => {
    const body = await parseBody(request, maintenanceActionSchema)
    return ok(await applyMaintenanceAction(user, idFrom(request), body))
  },
  { module: 'complaints', permission: 'complaints.manage' },
)
