import { ok, route } from '@/lib/api-helpers'
import { requirePermission } from '@/lib/tenancy'
import {
  billActionSchema,
  electricitySummary,
  electricityTrend,
  finalizeBills,
  generateDrafts,
  listBills,
  previewBills,
  readBody,
  voidBill,
} from '@/server/services/electricity'

/**
 * Room electricity bills.
 *   GET  ?propertyId=&month=YYYY-MM&roomId=&residentId=&status=DRAFT|FINALIZED|VOID
 *        &paymentStatus=PAID|PARTIALLY_PAID|PENDING|NOT_INVOICED|UNCOLLECTIBLE
 *        → { bills, summary, trend }
 *   POST { action: 'PREVIEW', propertyId, billingMonth: 'YYYY-MM', readingDate?, ratePerUnit?,
 *          readings: [{ meterId, value, readingDate?, photoUrl?, ownerAbsorbs? }] }
 *        → { preview: { rows, errors, totals, splitMethod, billingMode } }   (nothing saved)
 *   POST { action: 'GENERATE', …same as PREVIEW } → 201 { created: [{ billId, roomNumber, amount }], errors, message }
 *   POST { action: 'FINALIZE', billIds } → { finalized, alreadyFinal, errors, message }
 *   POST { action: 'VOID', billId, reason } → { bill, message }
 */
export const GET = route(
  async ({ user, request }) => {
    const q = new URL(request.url).searchParams
    const propertyId = q.get('propertyId')
    const filters = {
      propertyId,
      month: q.get('month'),
      roomId: q.get('roomId'),
      residentId: q.get('residentId'),
      status: q.get('status'),
      paymentStatus: q.get('paymentStatus'),
    }
    const [bills, summary, trend] = await Promise.all([
      listBills(user, filters),
      electricitySummary(user, propertyId, filters.month ?? undefined),
      electricityTrend(user, propertyId),
    ])
    return { bills, summary, trend }
  },
  { module: 'electricity', permission: 'electricity.view' },
)

export const POST = route(
  async ({ user, request }) => {
    const body = await readBody(request, billActionSchema)
    switch (body.action) {
      case 'PREVIEW':
        return { preview: await previewBills(user, body) }
      case 'GENERATE': {
        const result = await generateDrafts(user, body)
        const n = result.created.length
        const message = `${n} room bill${n === 1 ? '' : 's'} ready to review${result.errors.length ? `, ${result.errors.length} need attention` : ''}`
        return ok({ ...result, message }, { status: n ? 201 : 200 })
      }
      case 'FINALIZE': {
        requirePermission(user, 'electricity.manage')
        const result = await finalizeBills(user, body.billIds)
        return { ...result, message: `${result.finalized} bill${result.finalized === 1 ? '' : 's'} finalized` }
      }
      case 'VOID': {
        requirePermission(user, 'electricity.manage')
        const bill = await voidBill(user, body.billId, body.reason)
        return { bill: { id: bill.id, status: bill.status }, message: 'Bill voided' }
      }
    }
  },
  // PREVIEW/GENERATE need "Enter meter readings" (checked in the service);
  // FINALIZE/VOID need "electricity.manage".
  { module: 'electricity' },
)
