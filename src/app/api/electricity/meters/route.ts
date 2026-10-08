import { ok, route } from '@/lib/api-helpers'
import { createMeter, listMeters, meterCreateSchema, meterUpdateSchema, readBody, updateMeter } from '@/server/services/electricity'

/**
 * Room electricity meters.
 *   GET   ?propertyId=&roomId=  → { meters }
 *   POST  { propertyId, roomId, meterNumber, installedOn, initialReading, notes?, replaceExisting? } → 201 { meter, message }
 *   PATCH { meterId, meterNumber?, status?: ACTIVE|FAULTY, notes? } → { meter, message }
 */
export const GET = route(
  async ({ user, request }) => {
    const url = new URL(request.url)
    const meters = await listMeters(user, { propertyId: url.searchParams.get('propertyId'), roomId: url.searchParams.get('roomId') })
    return { meters }
  },
  { module: 'electricity', permission: 'electricity.view' },
)

export const POST = route(
  async ({ user, request }) => {
    const body = await readBody(request, meterCreateSchema)
    const meter = await createMeter(user, body)
    return ok({ meter, message: `Meter ${meter.meterNumber} added` }, { status: 201 })
  },
  { module: 'electricity', permission: 'electricity.manage' },
)

export const PATCH = route(
  async ({ user, request }) => {
    const body = await readBody(request, meterUpdateSchema)
    const meter = await updateMeter(user, body)
    return { meter, message: `Meter ${meter.meterNumber} updated` }
  },
  { module: 'electricity', permission: 'electricity.manage' },
)
