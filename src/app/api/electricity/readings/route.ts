import { ok, route } from '@/lib/api-helpers'
import { listReadings, readBody, readingSchema, recordReading } from '@/server/services/electricity'

/**
 * Meter readings. Staff with "Enter meter readings" can record them.
 *   GET  ?meterId=  → { readings }  (newest first, last 60)
 *   POST { meterId, readingDate: 'YYYY-MM-DD', value, photoUrl?, note? } → 201 { reading, message }
 */
export const GET = route(
  async ({ user, request }) => {
    const meterId = new URL(request.url).searchParams.get('meterId')
    if (!meterId) return { readings: [] }
    return { readings: await listReadings(user, meterId) }
  },
  { module: 'electricity', permission: 'electricity.view' },
)

export const POST = route(
  async ({ user, request }) => {
    const body = await readBody(request, readingSchema)
    const reading = await recordReading(user, body)
    return ok({ reading: { ...reading, value: Number(String(reading.value)) }, message: 'Reading saved' }, { status: 201 })
  },
  // "Enter meter readings" or "electricity.manage" is checked in the service.
  { module: 'electricity' },
)
