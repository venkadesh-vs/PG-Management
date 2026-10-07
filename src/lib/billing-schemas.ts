import { z } from 'zod'

/** Request schemas for the rent & payments APIs. */

const rupees = z.coerce.number().int('Enter a whole rupee amount').min(0, 'Cannot be negative').max(10_000_000, 'Amount is too large')
const positive = rupees.refine((v) => v > 0, 'Enter an amount greater than zero')
const reason = z.string().trim().min(3, 'Add a short reason (at least 3 characters)').max(300, 'Keep the reason under 300 characters')
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}/, 'Pick a date')

/** Only files uploaded through /api/uploads may be attached as proof. */
export const uploadUrl = z
  .string()
  .trim()
  .regex(/^\/api\/uploads\/[A-Za-z0-9_-]+$/, 'Attach the proof using the upload button')

export const paymentExtrasSchema = z.object({
  utr: z.string().trim().max(64, 'UTR is too long').optional().or(z.literal('')),
  attachmentUrl: uploadUrl.optional().or(z.literal('')),
})

export const paymentActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('REVERSE'), reason }),
  z.object({
    action: z.literal('REFUND'),
    amount: positive,
    method: z.enum(['CASH', 'UPI', 'BANK_TRANSFER', 'CHEQUE', 'CARD', 'GATEWAY']),
    reference: z.string().trim().max(80).optional(),
    reason,
  }),
])

export const paymentEditSchema = z.object({
  notes: z.string().max(500).nullable().optional(),
  reference: z.string().max(80).nullable().optional(),
  utr: z.string().max(64).nullable().optional(),
  attachmentUrl: uploadUrl.nullable().optional().or(z.literal('')),
})

export const CHARGE_CATEGORIES = {
  RECURRING: ['LAUNDRY', 'MAINTENANCE', 'ELECTRICITY', 'FOOD', 'OTHER'],
  ONE_TIME: ['JOINING', 'NOTICE', 'FINE', 'PENALTY', 'OTHER'],
  DISCOUNT: ['DISCOUNT'],
} as const

export const chargeActionSchema = z.union([
  z
    .object({
      action: z.literal('ADD'),
      residentId: z.string().min(1),
      kind: z.enum(['RECURRING', 'ONE_TIME', 'DISCOUNT']),
      category: z.string().min(1, 'Choose a category'),
      label: z.string().trim().min(2, 'Give the charge a name').max(80),
      amount: positive,
      startDate: isoDate,
      endDate: isoDate.optional().or(z.literal('')),
    })
    .refine((v) => (CHARGE_CATEGORIES[v.kind] as readonly string[]).includes(v.category), {
      message: 'Choose a valid category',
      path: ['category'],
    }),
  z.object({ action: z.literal('VOID'), chargeId: z.string().min(1), reason }),
])

export const rentRevisionSchema = z.object({
  residentId: z.string().min(1),
  newRent: positive,
  effectiveFrom: isoDate,
  reason,
})

export const invoiceAdjustSchema = z.object({
  action: z.literal('ADJUST'),
  invoiceId: z.string().min(1),
  kind: z.enum(['CREDIT', 'DEBIT']),
  amount: positive,
  reason,
})
