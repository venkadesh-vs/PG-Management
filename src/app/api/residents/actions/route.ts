import { z } from 'zod'
import { ok, parseBody, route } from '@/lib/api-helpers'
import { assertResidentAccess, hasPermission, requirePermission } from '@/lib/tenancy'
import { checkoutSchema, noticeSchema, transferSchema } from '@/lib/validation'
import {
  collectDeposit,
  completeCheckout,
  markNotice,
  markRefundPaid,
  previewCheckout,
  transferResident,
} from '@/server/services/residents'
import { formatMoney } from '@/lib/utils'
import { ForbiddenError } from '@/lib/tenancy'

/**
 * Resident lifecycle actions in one endpoint: transfer, notice, the checkout
 * settlement preview, the checkout itself, paying out a pending refund and
 * collecting a deposit that was not taken at check-in.
 */
const rupees = z.coerce.number().int('Enter a whole rupee amount').min(0, 'Amounts cannot be negative')
const text = (max: number) => z.string().trim().max(max).optional().or(z.literal(''))

const deductions = z
  .array(z.object({ label: z.string().trim().max(80), amount: rupees }))
  .max(20, 'Add at most 20 deductions')
  .optional()

const refundMethod = z.enum(['CASH', 'UPI', 'BANK_TRANSFER', 'CHEQUE'], {
  errorMap: () => ({ message: 'Choose how the refund was paid' }),
})

const refund = z.object({
  method: refundMethod,
  reference: text(80),
  note: text(300),
  paidAt: text(30),
})

const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('TRANSFER') }).merge(transferSchema),
  z.object({ action: z.literal('NOTICE') }).merge(noticeSchema),
  z
    .object({ action: z.literal('CHECKOUT_PREVIEW'), deductions })
    .merge(checkoutSchema.partial({ exitDate: true }).required({ residentId: true })),
  z
    .object({ action: z.literal('CHECKOUT'), deductions, refund: refund.nullable().optional() })
    .merge(checkoutSchema),
  z.object({
    action: z.literal('MARK_REFUND_PAID'),
    residentId: z.string().min(1),
    method: refundMethod,
    reference: text(80),
    paidAt: text(30),
    note: text(300),
  }),
  z.object({
    action: z.literal('COLLECT_DEPOSIT'),
    residentId: z.string().min(1),
    amount: rupees.optional(),
    method: z.enum(['CASH', 'UPI', 'BANK_TRANSFER', 'CARD', 'CHEQUE']),
    reference: text(80),
    paidAt: text(30),
  }),
])

const date = (value: string | undefined) => (value ? new Date(value) : undefined)

export const POST = route(
  async ({ user, request }) => {
    const body = await parseBody(request, schema)
    await assertResidentAccess(user, body.residentId)
    switch (body.action) {
      case 'CHECKOUT':
      case 'CHECKOUT_PREVIEW':
      case 'MARK_REFUND_PAID':
        requirePermission(user, 'residents.checkout')
        break
      case 'COLLECT_DEPOSIT':
        if (!hasPermission(user, 'payments.record') && !hasPermission(user, 'residents.checkout')) {
          throw new ForbiddenError('Your role does not allow recording deposits. Ask the PG owner for access.')
        }
        break
      default:
        requirePermission(user, 'residents.manage')
    }
    const actor = { id: user.id, name: user.name }

    switch (body.action) {
      case 'TRANSFER': {
        const result = await transferResident({
          residentId: body.residentId,
          toBedId: body.toBedId,
          effectiveDate: body.effectiveDate ? new Date(body.effectiveDate) : undefined,
          actor,
        })
        return ok({
          message: `Moved to Room ${result.bed.room.number}, Bed ${result.bed.label}`,
        })
      }

      case 'NOTICE': {
        const resident = await markNotice({
          residentId: body.residentId,
          noticeDate: new Date(body.noticeDate),
          exitDate: new Date(body.exitDate),
          actor,
        })
        return ok({ message: `${resident.fullName} marked as serving notice` })
      }

      case 'CHECKOUT_PREVIEW': {
        const preview = await previewCheckout({
          residentId: body.residentId,
          exitDate: body.exitDate ? new Date(body.exitDate) : new Date(),
          deductions: body.deductions,
          damageDeduction: body.damageDeduction,
          otherCharges: body.otherCharges,
        })
        return ok({ preview })
      }

      case 'CHECKOUT': {
        const result = await completeCheckout({
          residentId: body.residentId,
          exitDate: new Date(body.exitDate),
          reason: body.reason || undefined,
          deductions: body.deductions,
          damageDeduction: body.damageDeduction,
          otherCharges: body.otherCharges,
          settlementNote: body.settlementNote || undefined,
          refund: body.refund
            ? {
                method: body.refund.method,
                reference: body.refund.reference || undefined,
                note: body.refund.note || undefined,
                paidAt: date(body.refund.paidAt || undefined),
              }
            : body.refund === null
              ? null
              : undefined,
          refundPaid: body.refund === undefined ? body.refundPaid : undefined,
          actor,
        })
        return ok({
          message: `${result.resident.fullName} checked out`,
          refund: result.checkout.refundAmount,
          payable: result.checkout.payableAmount,
          refundPaid: result.refundPaid,
          settlementInvoice: result.settlementInvoice,
        })
      }

      case 'MARK_REFUND_PAID': {
        const result = await markRefundPaid({
          residentId: body.residentId,
          method: body.method,
          reference: body.reference || undefined,
          paidAt: date(body.paidAt || undefined),
          note: body.note || undefined,
          actor,
        })
        return ok({
          message: `${formatMoney(result.amount)} refund to ${result.resident.fullName} marked as paid`,
          amount: result.amount,
        })
      }

      case 'COLLECT_DEPOSIT': {
        const result = await collectDeposit({
          residentId: body.residentId,
          amount: body.amount || undefined,
          method: body.method,
          reference: body.reference || undefined,
          paidAt: date(body.paidAt || undefined),
          actor,
        })
        return ok({
          message:
            result.remaining > 0
              ? `${formatMoney(result.amount)} received — ${formatMoney(result.remaining)} of the deposit is still due`
              : `Deposit of ${formatMoney(result.amount)} collected — receipt ${result.payment.receiptNumber}`,
          receiptNumber: result.payment.receiptNumber,
        })
      }
    }
  },
  { module: 'residents' },
)
