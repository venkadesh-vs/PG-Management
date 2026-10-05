import { prisma } from '@/lib/prisma'
import { ok, parseBody, route } from '@/lib/api-helpers'
import { ConflictError, resolveScope } from '@/lib/tenancy'
import { propertySchema } from '@/lib/validation'
import { recordActivity } from '@/server/events'
import { assertPlanCapacity, createSubscriptionForProperty } from '@/server/services/subscriptions'
import { formatMoney } from '@/lib/utils'

/**
 * POST /api/properties — add a PG. Creating a property also creates its
 * per-PG subscription (priced from the plan rules), a default food plan and
 * the standard expense categories if they are missing.
 */
export const POST = route(
  async ({ user, request }) => {
    const body = await parseBody(request, propertySchema)
    const organizationId = user.organizationId!

    const existing = await prisma.property.findFirst({
      where: { organizationId, code: body.code.toUpperCase() },
    })
    if (existing) throw new ConflictError('A PG with this short code already exists')
    await assertPlanCapacity(organizationId, 'property')

    const result = await prisma.$transaction(async (tx) => {
      const property = await tx.property.create({
        data: {
          organizationId,
          name: body.name,
          code: body.code.toUpperCase(),
          type: body.type,
          addressLine: body.addressLine,
          city: body.city,
          state: body.state,
          pincode: body.pincode,
          contactName: body.contactName || null,
          contactPhone: body.contactPhone || null,
          description: body.description || null,
          standardRent: body.standardRent,
          standardDeposit: body.standardDeposit,
          maintenanceFee: body.maintenanceFee ?? 0,
          foodCharge: body.foodCharge ?? 0,
          foodIncluded: body.foodIncluded,
          electricityMode: body.electricityMode,
          electricityRate: body.electricityRate ?? 0,
          noticePeriodDays: body.noticePeriodDays,
          amenities: body.amenities,
          rules: body.rules,
        },
      })

      // A PG always needs at least one food plan so check-in can attach one.
      if ((body.foodCharge ?? 0) > 0 || body.foodIncluded) {
        await tx.foodPlan.create({
          data: {
            organizationId,
            propertyId: property.id,
            name: 'Full board (3 meals)',
            description: 'Breakfast, lunch and dinner.',
            monthlyCharge: body.foodCharge ?? 0,
            isDefault: true,
          },
        })
      }

      const subscription = await createSubscriptionForProperty({
        propertyId: property.id,
        tx,
        actor: { id: user.id, name: user.name },
      })

      await recordActivity(
        {
          organizationId,
          propertyId: property.id,
          actorId: user.id,
          actorName: user.name,
          actorRole: user.role,
          event: 'PROPERTY_CREATED',
          entityType: 'Property',
          entityId: property.id,
          summary: `${property.name} added`,
        },
        tx,
      )

      return { property, subscription }
    })

    return ok(
      {
        property: { id: result.property.id, name: result.property.name },
        subscription: {
          amount: result.subscription.subscription.amount,
          plan: result.subscription.plan.name,
          explanation: result.subscription.price.explanation,
        },
        message: `${result.property.name} created — subscription ${formatMoney(result.subscription.subscription.amount)}/month`,
      },
      { status: 201 },
    )
  },
  // Every PG carries its own billed subscription.
  { permission: 'properties.create' },
)

export const GET = route(
  async ({ user }) => {
    const scope = await resolveScope(user)
    const properties = await prisma.property.findMany({
      where: {
        organizationId: scope.organizationId,
        archivedAt: null,
        id: { in: scope.allowedPropertyIds },
      },
      include: {
        floors: { orderBy: { level: 'asc' } },
        foodPlans: { where: { active: true } },
        _count: { select: { beds: true, residents: true, rooms: true } },
      },
      orderBy: { name: 'asc' },
    })
    return { properties }
  },
  // Property list feeds the PG pickers on every dashboard page, so any
  // dashboard account may read the PGs in its access set.
  { roles: ['OWNER', 'MANAGER'] },
)
