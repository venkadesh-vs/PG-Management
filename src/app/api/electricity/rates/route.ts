import { ok, route } from '@/lib/api-helpers'
import { billingMonthLabel } from '@/lib/electricity'
import { listRates, rateCreateSchema, readBody, setRate } from '@/server/services/electricity'

/**
 * Electricity rate history per PG (append-only).
 *   GET  ?propertyId=  → { rates }  (newest first; `current` marks the rate in force this month)
 *   POST { propertyId, effectiveFrom: 'YYYY-MM', ratePerUnit, note? } → 201 { rate, message }
 */
export const GET = route(
  async ({ user, request }) => {
    const rates = await listRates(user, new URL(request.url).searchParams.get('propertyId'))
    return { rates }
  },
  { module: 'electricity', permission: 'electricity.view' },
)

export const POST = route(
  async ({ user, request }) => {
    const body = await readBody(request, rateCreateSchema)
    const rate = await setRate(user, body)
    return ok(
      {
        rate: { ...rate, ratePerUnit: Number(String(rate.ratePerUnit)) },
        message: `₹${body.ratePerUnit}/unit from ${billingMonthLabel(body.effectiveFrom)}`,
      },
      { status: 201 },
    )
  },
  { module: 'electricity', permission: 'electricity.manage' },
)
