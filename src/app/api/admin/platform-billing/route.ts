import { z } from 'zod'
import { ok, parseBody, route } from '@/lib/api-helpers'
import {
  getPlatformPaymentDetails,
  getReminderSchedule,
  savePlatformBillingSettings,
} from '@/server/services/owner-billing'

/**
 * StayFlow's own payee details (shown on the paywall) and the owner reminder
 * schedule. Super Admin only.
 */

const text = (max: number) => z.string().trim().max(max).default('')
const days = z.array(z.coerce.number().int().min(0).max(30)).max(6)

const schema = z.object({
  paymentDetails: z
    .object({
      upiId: z
        .string()
        .trim()
        .max(100)
        .refine((v) => v === '' || /^[\w.-]{2,}@[\w.-]{2,}$/.test(v), 'Enter a UPI ID like stayflow@okhdfcbank')
        .default(''),
      payeeName: text(100),
      bankName: text(100),
      accountName: text(100),
      accountNumber: z
        .string()
        .trim()
        .max(30)
        .refine((v) => v === '' || /^\d{6,20}$/.test(v), 'Account number should be 6–20 digits')
        .default(''),
      ifsc: z
        .string()
        .trim()
        .toUpperCase()
        .refine((v) => v === '' || /^[A-Z]{4}0[A-Z0-9]{6}$/.test(v), 'Enter a valid IFSC (e.g. HDFC0001234)')
        .default(''),
      supportWhatsapp: text(20),
      supportEmail: z.union([z.literal(''), z.string().trim().email('Enter a valid email')]).default(''),
    })
    .optional(),
  schedule: z
    .object({ trialDaysBefore: days, dueDaysBefore: days, graceDaysLeft: days })
    .optional(),
})

export const GET = route(
  async () => ({ paymentDetails: await getPlatformPaymentDetails(), schedule: await getReminderSchedule() }),
  { roles: ['SUPER_ADMIN'] },
)

export const POST = route(
  async ({ user, request }) => {
    const body = await parseBody(request, schema)
    const saved = await savePlatformBillingSettings(body, { id: user.id, name: user.name })
    return ok({ ...saved, message: 'Billing settings saved' })
  },
  { roles: ['SUPER_ADMIN'] },
)
