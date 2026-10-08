import { ok, route } from '@/lib/api-helpers'
import { ValidationError } from '@/lib/tenancy'
import {
  bulkMeterSchema,
  createMeter,
  createMetersBulk,
  listMeters,
  meterCreateSchema,
  meterUpdateSchema,
  readBody,
  updateMeter,
} from '@/server/services/electricity'

/**
 * Room electricity meters.
 *   GET   ?propertyId=&roomId=  → { meters }
 *   POST  { propertyId, roomId, meterNumber, installedOn, initialReading, notes?, replaceExisting? } → 201 { meter, message }
 *   POST  { action: 'BULK', propertyId, installedOn, meters: [{ roomId, meterNumber, initialReading }] }
 *         → 201 { created: [{ meterId, roomId, roomNumber, meterNumber }], errors: [{ roomId, roomNumber, error }], message }
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
    let json: unknown
    try {
      json = await request.json()
    } catch {
      throw new ValidationError('Request body must be valid JSON')
    }
    if ((json as { action?: unknown } | null)?.action === 'BULK') {
      const result = await createMetersBulk(user, bulkMeterSchema.parse(json))
      const n = result.created.length
      const message = `${n} meter${n === 1 ? '' : 's'} added${result.errors.length ? `, ${result.errors.length} room${result.errors.length === 1 ? '' : 's'} need attention` : ''}`
      return ok({ ...result, message }, { status: n ? 201 : 200 })
    }
    const meter = await createMeter(user, meterCreateSchema.parse(json))
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
