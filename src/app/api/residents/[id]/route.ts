import { prisma } from '@/lib/prisma'
import { parseBody, route } from '@/lib/api-helpers'
import {
  assertResidentAccess,
  ForbiddenError,
  NotFoundError,
  requireModule,
  requirePermission,
  withMaskedId,
} from '@/lib/tenancy'
import { residentUpdateSchema } from '@/lib/validation'
import { recordActivity } from '@/server/events'
import { reviseRent } from '@/server/services/billing'

/**
 * /api/residents/<id>
 *   GET   — the full record: owner/manager with residents.view, or the resident themselves
 *   PATCH — edit details (residents.manage; a rent change also needs rent.manage)
 *
 * Both go through route(), so sign-in, the must-change-password gate and the
 * suspended-subscription read-only rule apply.
 */

function idFrom(request: Request) {
  const parts = new URL(request.url).pathname.split('/').filter(Boolean)
  return decodeURIComponent(parts[parts.length - 1] ?? '')
}

export const GET = route(async ({ user, request }) => {
  // The full record carries ID numbers, documents and the money trail —
  // only the owner/manager, or the resident themselves, may read it.
  if (user.role === 'TENANT') requireModule(user, 'residentApp')
  else {
    requireModule(user, 'residents')
    requirePermission(user, 'residents.view')
  }
  const id = idFrom(request)
  await assertResidentAccess(user, id)

  const resident = await prisma.resident.findUnique({
    where: { id },
    include: {
      property: true,
      room: true,
      bed: true,
      deposit: true,
      documents: true,
      foodSubscription: { include: { foodPlan: true } },
      invoices: { orderBy: { periodStart: 'desc' }, include: { lines: true } },
      payments: { orderBy: { paidAt: 'desc' } },
      ledger: { orderBy: [{ entryDate: 'asc' }, { createdAt: 'asc' }] },
    },
  })
  if (!resident) throw new NotFoundError('Resident not found')
  return { resident: withMaskedId(resident, user.role) }
})

export const PATCH = route(
  async ({ user, request }) => {
    if (user.role === 'TENANT') throw new ForbiddenError('Not allowed')
    const id = idFrom(request)
    await assertResidentAccess(user, id)

    const body = await parseBody(request, residentUpdateSchema)

    // Rent never changes silently: a new amount is a dated rent revision
    // (history, audit, notes on months already invoiced).
    if (body.rentAmount !== undefined) {
      const current = await prisma.resident.findUnique({
        where: { id },
        select: { rentAmount: true },
      })
      if (current && current.rentAmount !== body.rentAmount) {
        requirePermission(user, 'rent.manage')
        await reviseRent({
          organizationId: user.organizationId!,
          residentId: id,
          newRent: body.rentAmount,
          effectiveFrom: new Date(),
          reason: 'Updated from resident details',
          actor: { id: user.id, name: user.name },
        })
      }
    }

    const resident = await prisma.resident.update({
      where: { id },
      data: {
        ...(body.fullName ? { fullName: body.fullName } : {}),
        ...(body.phone ? { phone: body.phone } : {}),
        ...(body.whatsappPhone !== undefined ? { whatsappPhone: body.whatsappPhone || null } : {}),
        ...(body.email !== undefined ? { email: body.email || null } : {}),
        ...(body.bloodGroup !== undefined ? { bloodGroup: body.bloodGroup || null } : {}),
        ...(body.qualification !== undefined ? { qualification: body.qualification || null } : {}),
        ...(body.permanentAddress !== undefined ? { permanentAddress: body.permanentAddress || null } : {}),
        ...(body.city !== undefined ? { city: body.city || null } : {}),
        ...(body.guardianName !== undefined ? { guardianName: body.guardianName || null } : {}),
        ...(body.guardianPhone !== undefined ? { guardianPhone: body.guardianPhone || null } : {}),
        ...(body.guardianRelation !== undefined ? { guardianRelation: body.guardianRelation || null } : {}),
        ...(body.companyName !== undefined ? { companyName: body.companyName || null } : {}),
        ...(body.designation !== undefined ? { designation: body.designation || null } : {}),
        ...(body.idType !== undefined ? { idType: body.idType || null } : {}),
        // Ignore a masked value echoed back from a read.
        ...(body.idNumber !== undefined && !body.idNumber?.startsWith('XXXX')
          ? { idNumber: body.idNumber || null }
          : {}),
        ...(body.depositAmount !== undefined ? { depositAmount: body.depositAmount } : {}),
        ...(body.maintenanceFee !== undefined ? { maintenanceFee: body.maintenanceFee } : {}),
        ...(body.foodOptIn !== undefined ? { foodOptIn: body.foodOptIn } : {}),
        ...(body.foodCharge !== undefined ? { foodCharge: body.foodCharge } : {}),
        ...(body.discountAmount !== undefined ? { discountAmount: body.discountAmount } : {}),
        ...(body.discountNote !== undefined ? { discountNote: body.discountNote || null } : {}),
        ...(body.notes !== undefined ? { notes: body.notes || null } : {}),
        ...(body.kycStatus
          ? {
              kycStatus: body.kycStatus,
              kycVerifiedAt: body.kycStatus === 'VERIFIED' ? new Date() : null,
            }
          : {}),
      },
    })

    // Changing the food opt-in must switch the subscription too, or the
    // kitchen count and the invoice would disagree.
    if (body.foodOptIn !== undefined) {
      await prisma.foodSubscription.updateMany({
        where: { residentId: id },
        data: {
          active: body.foodOptIn,
          endDate: body.foodOptIn ? null : new Date(),
        },
      })
    }

    await recordActivity({
      organizationId: resident.organizationId,
      propertyId: resident.propertyId,
      actorId: user.id,
      actorName: user.name,
      actorRole: user.role,
      event: 'RESIDENT_UPDATED',
      entityType: 'Resident',
      entityId: resident.id,
      summary: `${resident.fullName}'s details updated`,
    })

    return { resident: withMaskedId(resident, user.role) }
  },
  { module: 'residents', permission: 'residents.manage' },
)
