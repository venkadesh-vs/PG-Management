import { z } from 'zod'
import { ok, parseBody, route } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { assertPropertyAccess, NotFoundError, restrictedPropertyIds, ValidationError } from '@/lib/tenancy'
import { staffSchema } from '@/lib/validation'
import { assertLookupValue } from '@/server/services/org-defaults'
import { recordActivity } from '@/server/events'

const schema = staffSchema
  .pick({ name: true, role: true, phone: true, email: true, propertyId: true, salary: true, address: true, idNumber: true })
  .partial()

const FIELDS = ['name', 'role', 'phone', 'email', 'propertyId', 'salary', 'address', 'idNumber'] as const

function idFrom(request: Request) {
  const parts = new URL(request.url).pathname.split('/').filter(Boolean)
  return decodeURIComponent(parts[parts.length - 1] ?? '')
}

/**
 * PATCH /api/staff/<id> — fix a staff member's details or move them to
 * another PG. Someone with a staff-app login must stay on one PG: the app
 * only shows that PG's kitchen, meters, tasks and expenses.
 */
export const PATCH = route(
  async ({ user, request }) => {
    const id = idFrom(request)
    const body = await parseBody(request, schema)
    const staff = await prisma.staff.findFirst({ where: { id, organizationId: user.organizationId! } })
    if (!staff) throw new NotFoundError('Staff member not found')
    // A manager limited to some PGs may only edit staff of those PGs.
    const limited = restrictedPropertyIds(user)
    if (limited && (!staff.propertyId || !limited.includes(staff.propertyId))) throw new NotFoundError('Staff member not found')

    if (body.role !== undefined && body.role !== staff.role) await assertLookupValue(staff.organizationId, 'STAFF_ROLE', body.role)
    const propertyId = body.propertyId === undefined ? undefined : body.propertyId || null
    if (propertyId) await assertPropertyAccess(user, propertyId)
    if (propertyId === null && (staff.userId || limited)) {
      throw new ValidationError('propertyId: Choose the PG this person works at')
    }

    const data: Record<string, string | number | null> = {}
    for (const key of FIELDS) {
      if (body[key] === undefined) continue
      const value = key === 'propertyId' ? propertyId! : key === 'salary' ? Number(body.salary ?? 0) : (String(body[key]).trim() || null)
      if (key === 'name' || key === 'role' || key === 'phone') {
        if (!value) continue
      }
      if (value !== (staff[key] ?? null)) data[key] = value
    }
    if (!Object.keys(data).length) return ok({ message: 'Nothing changed' })

    const updated = await prisma.staff.update({ where: { id }, data })
    await recordActivity({
      organizationId: staff.organizationId,
      propertyId: updated.propertyId ?? staff.propertyId,
      actorId: user.id,
      actorName: user.name,
      actorRole: user.role,
      event: 'STAFF_UPDATED',
      entityType: 'Staff',
      entityId: staff.id,
      summary: `${updated.name}'s details updated: ${Object.keys(data).map((k) => (k === 'propertyId' ? 'PG' : k)).join(', ')}`,
      before: Object.fromEntries(Object.keys(data).filter((k) => k !== 'idNumber').map((k) => [k, staff[k as keyof typeof staff] ?? null])),
      after: Object.fromEntries(Object.keys(data).filter((k) => k !== 'idNumber').map((k) => [k, data[k]])),
    })
    return ok({ staff: updated, message: `${updated.name}'s details are saved` })
  },
  { module: 'staff', permission: 'staff.manage' },
)
