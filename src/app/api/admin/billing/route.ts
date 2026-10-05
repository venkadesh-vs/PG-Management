import { z } from 'zod'
import { ok, parseBody, route } from '@/lib/api-helpers'
import {
  enforceGracePeriods,
  markSubscriptionInvoicePaid,
  repriceSubscription,
  runSubscriptionBilling,
} from '@/server/services/subscriptions'
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
])

/** Platform billing controls — the same services the nightly job calls. */
export const POST = route(
  async ({ user, request }) => {
    const body = await parseBody(request, schema)

    if (body.action === 'RUN') {
      const results = await runSubscriptionBilling({})
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
      const invoice = await markSubscriptionInvoicePaid({
        invoiceId: body.invoiceId,
        method: body.method,
        reference: body.reference,
        actor: { id: user.id, name: user.name },
      })
      return ok({
        message: `${invoice.number} marked paid — ${formatMoney(invoice.total)}`,
      })
    }

    const result = await repriceSubscription(body.subscriptionId).catch((error: unknown) => {
      // Cancelling the old Razorpay mandate failed: say why instead of a 500.
      if (error instanceof RazorpayError) throw new ConflictError(error.message)
      throw error
    })
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
