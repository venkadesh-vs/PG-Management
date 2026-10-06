import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import type { SessionUser } from '@/lib/auth'
import { ok, parseBody, route } from '@/lib/api-helpers'
import { assertPropertyAccess, ConflictError, NotFoundError } from '@/lib/tenancy'
import { propertySchema } from '@/lib/validation'
import { recordActivity } from '@/server/events'
import {
  assertPlanCapacity,
  cancelAutopay,
  repriceSubscription,
} from '@/server/services/subscriptions'
import { formatMoney } from '@/lib/utils'

/**
 * /api/properties/<id>
 *   PATCH  — edit the PG's details and rent configuration (properties.manage)
 *   DELETE — archive the PG (properties.create: it ends a billed subscription).
 *            Refused while residents live there or bookings hold its beds.
 *   POST { action: 'RESTORE' } — bring an archived PG back (properties.create)
 *
 * The short code is deliberately not editable: it is baked into invoice and
 * resident numbers already issued.
 */

const updateSchema = propertySchema.omit({ code: true }).partial()

const restoreSchema = z.object({ action: z.literal('RESTORE') })

const ARCHIVE_REASON = 'Property archived'

function idFrom(request: Request) {
  return decodeURIComponent(new URL(request.url).pathname.split('/').filter(Boolean).pop() ?? '')
}

async function loadProperty(user: SessionUser, id: string) {
  const property = await prisma.property.findUnique({
    where: { id },
    include: { subscription: true },
  })
  if (!property || property.organizationId !== user.organizationId) {
    throw new NotFoundError('PG not found')
  }
  await assertPropertyAccess(user, property.id)
  return property
}

function dateLabel(date: Date) {
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

export const PATCH = route(
  async ({ user, request }) => {
    const property = await loadProperty(user, idFrom(request))
    if (property.archivedAt) throw new ConflictError('Restore this PG before editing it')

    const body = await parseBody(request, updateSchema)
    const has = (key: keyof typeof body) => body[key] !== undefined

    const updated = await prisma.property.update({
      where: { id: property.id },
      data: {
        ...(has('name') ? { name: body.name } : {}),
        ...(has('type') ? { type: body.type } : {}),
        ...(has('addressLine') ? { addressLine: body.addressLine } : {}),
        ...(has('city') ? { city: body.city } : {}),
        ...(has('state') ? { state: body.state } : {}),
        ...(has('pincode') ? { pincode: body.pincode } : {}),
        ...(has('contactName') ? { contactName: body.contactName || null } : {}),
        ...(has('contactPhone') ? { contactPhone: body.contactPhone || null } : {}),
        ...(has('description') ? { description: body.description || null } : {}),
        ...(has('standardRent') ? { standardRent: body.standardRent } : {}),
        ...(has('standardDeposit') ? { standardDeposit: body.standardDeposit } : {}),
        ...(has('maintenanceFee') ? { maintenanceFee: body.maintenanceFee ?? 0 } : {}),
        ...(has('foodCharge') ? { foodCharge: body.foodCharge ?? 0 } : {}),
        ...(has('foodIncluded') ? { foodIncluded: body.foodIncluded } : {}),
        ...(has('electricityMode') ? { electricityMode: body.electricityMode } : {}),
        ...(has('electricityRate') ? { electricityRate: body.electricityRate ?? 0 } : {}),
        ...(has('noticePeriodDays') ? { noticePeriodDays: body.noticePeriodDays } : {}),
        ...(has('amenities') ? { amenities: body.amenities } : {}),
        ...(has('rules') ? { rules: body.rules } : {}),
      },
    })

    await recordActivity({
      organizationId: property.organizationId,
      propertyId: property.id,
      actorId: user.id,
      actorName: user.name,
      actorRole: user.role,
      event: 'PROPERTY_UPDATED',
      entityType: 'Property',
      entityId: property.id,
      summary: `${updated.name} details updated`,
      meta: { fields: Object.keys(body).filter((k) => has(k as keyof typeof body)) },
    })

    // The subscription is priced off the standard rent, so a rent change
    // re-prices it (which also asks the owner to re-authorise AutoPay).
    let message = `${updated.name} saved`
    if (
      property.subscription &&
      property.subscription.status !== 'CANCELLED' &&
      has('standardRent') &&
      body.standardRent !== property.standardRent
    ) {
      try {
        const repriced = await repriceSubscription(property.subscription.id)
        if (repriced.changed) {
          message += ` — subscription is now ${formatMoney(repriced.price.amount)}/month`
          if (repriced.autopayStopped) message += '. Set up AutoPay again to approve the new amount.'
        }
      } catch (error) {
        console.error('[properties] reprice failed', error)
        message += ' — the subscription price could not be updated, please contact support'
      }
    }

    return ok({ property: { id: updated.id, name: updated.name }, message })
  },
  { module: 'properties', permission: 'properties.manage' },
)

export const DELETE = route(
  async ({ user, request }) => {
    const property = await loadProperty(user, idFrom(request))
    if (property.archivedAt) throw new ConflictError(`${property.name} is already archived`)

    const [living, bookings] = await Promise.all([
      prisma.resident.count({
        where: { propertyId: property.id, status: { in: ['ACTIVE', 'NOTICE', 'PENDING'] } },
      }),
      prisma.booking.count({
        where: { propertyId: property.id, status: { in: ['PENDING', 'CONFIRMED'] } },
      }),
    ])
    if (living > 0) {
      throw new ConflictError(
        `${living} resident${living === 1 ? ' is' : 's are'} still active, on notice or pending at ${property.name}. Check them out before archiving.`,
      )
    }
    if (bookings > 0) {
      throw new ConflictError(
        `${bookings} booking${bookings === 1 ? ' is' : 's are'} still open at ${property.name}. Check them in or cancel them before archiving.`,
      )
    }

    // Stop the AutoPay mandate at the gateway first: if that fails the owner
    // must hear about it rather than keep getting debited for an archived PG.
    const subscription = property.subscription
    if (subscription && subscription.status !== 'CANCELLED' && subscription.autopayEnabled) {
      try {
        await cancelAutopay(subscription.id)
      } catch (error) {
        console.error('[properties] cancel autopay failed', error)
        throw new ConflictError('AutoPay could not be stopped right now. Please try again in a minute.')
      }
    }

    // The subscription is cancelled at the end of the period already billed:
    // billing only runs for live statuses, so no new cycle is raised, and the
    // current (paid) period runs out on its own. Raised invoices stay payable.
    const now = new Date()
    const cancelling = subscription && subscription.status !== 'CANCELLED'
    await prisma.$transaction(async (tx) => {
      await tx.property.update({
        where: { id: property.id },
        data: { archivedAt: now, status: 'ARCHIVED' },
      })
      if (cancelling) {
        await tx.subscription.update({
          where: { id: subscription.id },
          data: { status: 'CANCELLED', cancelledAt: now, cancelReason: ARCHIVE_REASON },
        })
      }
      await recordActivity(
        {
          organizationId: property.organizationId,
          propertyId: property.id,
          actorId: user.id,
          actorName: user.name,
          actorRole: user.role,
          event: 'PROPERTY_UPDATED',
          entityType: 'Property',
          entityId: property.id,
          summary: `${property.name} archived${cancelling ? ' — subscription cancelled at period end' : ''}`,
          meta: { action: 'ARCHIVE' },
        },
        tx,
      )
    })

    const periodNote =
      cancelling && subscription.currentPeriodEnd > now
        ? ` Its subscription ends on ${dateLabel(subscription.currentPeriodEnd)} and will not be billed again.`
        : cancelling
          ? ' Its subscription is cancelled and will not be billed again.'
          : ''
    return ok({ message: `${property.name} archived.${periodNote}` })
  },
  { module: 'properties', permission: 'properties.create' },
)

export const POST = route(
  async ({ user, request }) => {
    await parseBody(request, restoreSchema)
    const property = await loadProperty(user, idFrom(request))
    if (!property.archivedAt) throw new ConflictError(`${property.name} is not archived`)
    await assertPlanCapacity(property.organizationId, 'property')

    const now = new Date()
    const subscription = property.subscription
    // Only revive a subscription that archiving cancelled. Billing resumes
    // from today when the paid period has already run out.
    const revive =
      subscription && subscription.status === 'CANCELLED' && subscription.cancelReason === ARCHIVE_REASON
    await prisma.$transaction(async (tx) => {
      await tx.property.update({
        where: { id: property.id },
        data: { archivedAt: null, status: 'ACTIVE' },
      })
      if (revive) {
        await tx.subscription.update({
          where: { id: subscription.id },
          data: {
            status: 'ACTIVE',
            cancelledAt: null,
            cancelReason: null,
            ...(subscription.nextBillingDate < now ? { nextBillingDate: now } : {}),
          },
        })
      }
      await recordActivity(
        {
          organizationId: property.organizationId,
          propertyId: property.id,
          actorId: user.id,
          actorName: user.name,
          actorRole: user.role,
          event: 'PROPERTY_UPDATED',
          entityType: 'Property',
          entityId: property.id,
          summary: `${property.name} restored`,
          meta: { action: 'RESTORE' },
        },
        tx,
      )
    })

    return ok({
      message: `${property.name} restored.${revive ? ' Its subscription billing resumes.' : ''}`,
    })
  },
  { module: 'properties', permission: 'properties.create' },
)
