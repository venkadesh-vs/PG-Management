import { ok, parseBody, route } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { NotFoundError, requireModule } from '@/lib/tenancy'
import { residentSelfProfileSchema } from '@/lib/validation'
import { assertLookupValue } from '@/server/services/org-defaults'
import { recordActivity } from '@/server/events'

const FIELDS = [
  'phone',
  'whatsappPhone',
  'email',
  'bloodGroup',
  'guardianName',
  'guardianRelation',
  'guardianPhone',
  'permanentAddress',
  'city',
  'state',
  'pincode',
  'occupationType',
  'companyName',
  'designation',
] as const

/**
 * PATCH /api/tenant/profile — a resident updates their own contact,
 * emergency-contact, address and work details. Name, ID proof, room and rent
 * stay owner-only. Every change is in the activity log with old and new values.
 */
export const PATCH = route(
  async ({ user, request }) => {
    requireModule(user, 'residentApp')
    const body = await parseBody(request, residentSelfProfileSchema)
    const resident = await prisma.resident.findUnique({ where: { id: user.residentId! } })
    if (!resident || resident.organizationId !== user.organizationId) throw new NotFoundError('Resident not found')
    // Only a new choice is checked: older records may hold free text.
    if (body.guardianRelation && body.guardianRelation !== resident.guardianRelation) await assertLookupValue(resident.organizationId, 'GUARDIAN_RELATION', body.guardianRelation)

    const data: Record<string, string | null> = {}
    for (const key of FIELDS) {
      const raw = body[key]
      if (raw === undefined) continue
      const value: string | null = typeof raw === 'string' ? raw.trim() || null : null
      if (key === 'phone' && !value) continue // the mobile number is required
      if (value !== (resident[key] ?? null)) data[key] = value
    }
    if (!Object.keys(data).length) return ok({ message: 'Nothing changed' })

    const updated = await prisma.resident.update({ where: { id: resident.id }, data })
    await recordActivity({
      organizationId: resident.organizationId,
      propertyId: resident.propertyId,
      actorId: user.id,
      actorName: user.name,
      actorRole: user.role,
      event: 'RESIDENT_UPDATED',
      entityType: 'Resident',
      entityId: resident.id,
      summary: `${resident.fullName} updated their details (resident app)`,
      before: Object.fromEntries(Object.keys(data).map((k) => [k, resident[k as keyof typeof resident] ?? null])),
      after: data,
    })
    return ok({ message: 'Your details are saved', residentId: updated.id })
  },
  { roles: ['TENANT'] },
)
