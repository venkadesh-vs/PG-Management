import 'server-only'

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { ConflictError, NotFoundError } from '@/lib/tenancy'
import { formatDate } from '@/lib/utils'
import { checklistProgress, openItems, readChecklist, type Checklist } from '@/lib/checkout-checklist'
import { recordActivity } from '../events'

/**
 * After the checkout: completing the inspection / clearance checklists and
 * closing (locking) the settlement. A locked settlement cannot be edited;
 * corrections go through a credit or debit note on the settlement invoice,
 * so the record of what was agreed at exit never changes silently.
 */

type Actor = { id?: string; name: string }

async function loadCheckout(organizationId: string, residentId: string) {
  const checkout = await prisma.checkout.findFirst({
    where: { residentId, resident: { organizationId } },
    include: { resident: { select: { id: true, fullName: true, organizationId: true, propertyId: true } } },
  })
  if (!checkout) throw new NotFoundError('This resident has not checked out')
  return checkout
}

export function assertCheckoutOpen(checkout: { lockedAt: Date | null }) {
  if (checkout.lockedAt) {
    throw new ConflictError(
      `This settlement was closed on ${formatDate(checkout.lockedAt)}. Raise a credit or debit note on the settlement invoice to correct it.`,
    )
  }
}

/** Saves the inspection and/or clearance checklist (only while the settlement is open). */
export async function updateCheckoutChecklists(params: {
  organizationId: string
  residentId: string
  inspection?: Checklist
  clearance?: Checklist
  actor: Actor
}) {
  const checkout = await loadCheckout(params.organizationId, params.residentId)
  assertCheckoutOpen(checkout)

  const data: Prisma.CheckoutUpdateInput = {}
  if (params.inspection) data.inspection = params.inspection as Prisma.InputJsonValue
  if (params.clearance) data.clearance = params.clearance as Prisma.InputJsonValue
  // Guard against a lock landing between the read and the write.
  const updated = await prisma.checkout.updateMany({ where: { id: checkout.id, lockedAt: null }, data })
  if (updated.count !== 1) throw new ConflictError('This settlement was just closed. Refresh the page.')

  const before = { inspection: checklistProgress(readChecklist(checkout.inspection)), clearance: checklistProgress(readChecklist(checkout.clearance)) }
  const after = {
    inspection: checklistProgress(params.inspection ?? readChecklist(checkout.inspection)),
    clearance: checklistProgress(params.clearance ?? readChecklist(checkout.clearance)),
  }
  await recordActivity({
    organizationId: checkout.resident.organizationId,
    propertyId: checkout.resident.propertyId,
    actorId: params.actor.id,
    actorName: params.actor.name,
    event: 'SETTLEMENT_ADJUSTED',
    entityType: 'Checkout',
    entityId: checkout.id,
    summary: `Checkout checklist updated for ${checkout.resident.fullName} — clearance ${after.clearance.done}/${after.clearance.total}, inspection ${after.inspection.done}/${after.inspection.total}`,
    meta: { action: 'CHECKLIST', residentId: checkout.resident.id },
    before,
    after,
  })
  return { message: 'Checklist saved' }
}

/** Closes the settlement. Idempotent: closing twice is refused, not repeated. */
export async function lockCheckout(params: { organizationId: string; residentId: string; actor: Actor }) {
  const checkout = await loadCheckout(params.organizationId, params.residentId)
  assertCheckoutOpen(checkout)
  const now = new Date()
  const updated = await prisma.checkout.updateMany({ where: { id: checkout.id, lockedAt: null }, data: { lockedAt: now } })
  if (updated.count !== 1) throw new ConflictError('This settlement is already closed')

  const pendingClearance = openItems(readChecklist(checkout.clearance)).map((i) => i.label)
  await recordActivity({
    organizationId: checkout.resident.organizationId,
    propertyId: checkout.resident.propertyId,
    actorId: params.actor.id,
    actorName: params.actor.name,
    event: 'SETTLEMENT_ADJUSTED',
    entityType: 'Checkout',
    entityId: checkout.id,
    summary: `Settlement for ${checkout.resident.fullName} closed and locked${
      pendingClearance.length ? ` (${pendingClearance.length} clearance item${pendingClearance.length === 1 ? '' : 's'} open)` : ''
    }`,
    meta: {
      action: 'LOCK',
      residentId: checkout.resident.id,
      refundAmount: checkout.refundAmount,
      payableAmount: checkout.payableAmount,
      refundSettled: Boolean(checkout.settledAt),
      pendingClearance,
    },
    before: { lockedAt: null },
    after: { lockedAt: now.toISOString() },
  })
  return { message: `Settlement for ${checkout.resident.fullName} is closed`, lockedAt: now }
}
