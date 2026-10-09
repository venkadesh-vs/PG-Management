import { z } from 'zod'
import { ok, parseBody, route } from '@/lib/api-helpers'
import { createPaymentClaim, paywallState } from '@/server/services/owner-billing'
import { uploadUrl } from '@/lib/billing-schemas'

/**
 * "I've paid" by UPI / bank transfer for a StayFlow invoice.
 *   GET  — what the paywall shows (amount due, payee details, recent reports)
 *   POST — { invoiceId, method, utr, proofUrl?, note? }
 * Open while the account is paused: that is exactly when it is needed.
 */

const schema = z.object({
  invoiceId: z.string().min(1),
  method: z.enum(['UPI', 'BANK_TRANSFER']),
  utr: z
    .string()
    .trim()
    .min(6, 'Enter the UTR / transaction reference from your bank or UPI app')
    .max(40, 'That reference is too long'),
  proofUrl: uploadUrl.optional().or(z.literal('')),
  note: z.string().trim().max(300).optional(),
})

export const GET = route(
  async ({ user }) => paywallState(user.organizationId!),
  { roles: ['OWNER', 'MANAGER'], allowRestricted: true },
)

export const POST = route(
  async ({ user, request }) => {
    const body = await parseBody(request, schema)
    const claim = await createPaymentClaim({
      organizationId: user.organizationId!,
      invoiceId: body.invoiceId,
      method: body.method,
      utr: body.utr,
      proofUrl: body.proofUrl || null,
      note: body.note || null,
      actor: { id: user.id, name: user.name },
    })
    return ok(
      {
        claim: { id: claim.id, status: claim.status },
        message: 'Thanks — we are checking your payment. Your account is restored as soon as it is verified.',
      },
      { status: 201 },
    )
  },
  { roles: ['OWNER', 'MANAGER'], permission: 'billing.manage', allowRestricted: true },
)
