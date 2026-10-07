import { z } from 'zod'
import { ok, parseBody, route } from '@/lib/api-helpers'
import {
  adminMarkInvoicePaid,
  adminSubscriptionAction,
  enforceGracePeriods,
  repriceSubscription,
  retryFailedCharges,
  runSubscriptionBilling,
} from '@/server/services/subscriptions'
import { recordActivity } from '@/server/events'
import { prisma } from '@/lib/prisma'
import { formatMoney } from '@/lib/utils'
import { ConflictError } from '@/lib/tenancy'
import { RazorpayError } from '@/server/integrations/razorpay'

const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('RUN') }),
  z.object({
    action: z.literal('MARK_PAID'),
    invoiceId: z.string().min(1),
    method: z.enum(['BANK_TRANSFER', 'UPI', 'CASH', 'CARD']).optional(),
    reference: z.string().optional(),
  }),
  z.object({ action: z.literal('REPRICE'), subscriptionId: z.string().min(1) }),
  z.object({
    action: z.literal('EXTEND_TRIAL'),
    subscriptionId: z.string().min(1),
    days: z.coerce.number().int().min(1).max(180),
  }),
  z.object({
    action: z.literal('APPLY_CREDIT'),
    subscriptionId: z.string().min(1),
    amount: z.coerce.number().int().min(1).max(10_000_000, 'Amount is too large'),
    note: z.string().trim().max(200).optional(),
  }),
  z.object({
    action: z.literal('CANCEL'),
    subscriptionId: z.string().min(1),
    reason: z.string().trim().max(500).optional(),
  }),
  z.object({ action: z.literal('REACTIVATE'), subscriptionId: z.string().min(1) }),
])

/** Platform billing controls — the same services the nightly job calls. */
export const POST = route(
  async ({ user, request }) => {
    const body = await parseBody(request, schema)

    if (body.action === 'RUN') {
      const results = await runSubscriptionBilling({})
      await retryFailedCharges()
      const grace = await enforceGracePeriods()
      const billed = results.filter((r) => r.outcome === 'paid').length
      const failed = results.filter((r) => r.outcome === 'failed').length
      const invoiced = results.filter((r) => r.outcome === 'invoiced').length

      return ok({
        billed,
        failed,
        invoiced,
        suspended: grace.suspended,
        message:
          results.length === 0 && grace.suspended === 0
            ? 'Nothing was due — no subscription reached its billing date.'
            : `${billed} charged, ${invoiced} invoiced, ${failed} failed, ${grace.suspended} suspended.`,
      })
    }

    if (body.action === 'MARK_PAID') {
      const invoice = await adminMarkInvoicePaid({
        invoiceId: body.invoiceId,
        method: body.method,
        reference: body.reference,
        actor: { id: user.id, name: user.name, role: user.role },
      })
      return ok({
        message: `${invoice.number} marked paid — ${formatMoney(invoice.total)}`,
      })
    }

    if (
      body.action === 'EXTEND_TRIAL' ||
      body.action === 'APPLY_CREDIT' ||
      body.action === 'CANCEL' ||
      body.action === 'REACTIVATE'
    ) {
      const { subscriptionId, ...input } = body
      const result = await adminSubscriptionAction({
        subscriptionId,
        input,
        actor: { id: user.id, name: user.name, role: user.role },
      })
      return ok(result)
    }

    const previous = await prisma.subscription.findUnique({
      where: { id: body.subscriptionId },
      select: { amount: true, organizationId: true, propertyId: true },
    })
    const result = await repriceSubscription(body.subscriptionId).catch((error: unknown) => {
      // Cancelling the old Razorpay mandate failed: say why instead of a 500.
      if (error instanceof RazorpayError) throw new ConflictError(error.message)
      throw error
    })
    if (result.changed) {
      await recordActivity({
        actorId: user.id,
        actorName: user.name,
        actorRole: user.role,
        event: 'ADMIN_ACTION',
        entityType: 'Subscription',
        entityId: body.subscriptionId,
        summary: `Subscription re-priced to ${formatMoney(result.price.amount)}`,
        organizationId: previous?.organizationId,
        propertyId: previous?.propertyId,
        meta: { action: 'REPRICE', autopayStopped: result.autopayStopped },
        before: { amount: previous?.amount ?? null },
        after: { amount: result.price.amount },
      })
    }
    return ok({
      message: result.changed
        ? `Re-priced to ${formatMoney(result.price.amount)} — ${result.price.explanation}${
            result.autopayStopped ? '. Razorpay AutoPay was cancelled; the owner must re-authorise.' : ''
          }`
        : 'Already at the correct price for its plan',
    })
  },
  { roles: ['SUPER_ADMIN'] },
)
