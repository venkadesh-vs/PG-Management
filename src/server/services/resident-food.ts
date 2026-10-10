import 'server-only'

import { prisma } from '@/lib/prisma'
import type { SessionUser } from '@/lib/auth'
import { NotFoundError, ValidationError } from '@/lib/tenancy'
import { foodChangeDate, foodTopUp } from '@/lib/food-choice'
import { formatDate, formatMoney, startOfDay } from '@/lib/utils'
import { notifyUsers, recordActivity } from '@/server/events'

/**
 * A resident starts or stops the PG's food from the resident app. The kitchen
 * count (derived from active subscriptions) follows from tomorrow, and the
 * rent bill follows the rules in src/lib/food-choice.ts.
 */
export async function setResidentFood(user: SessionUser, input: { needFood: boolean; foodPlanId?: string }) {
  const residentId = user.residentId!
  const start = foodChangeDate(new Date())

  const result = await prisma.$transaction(async (tx) => {
    const resident = await tx.resident.findUnique({
      where: { id: residentId },
      include: { foodSubscription: true },
    })
    if (!resident || resident.organizationId !== user.organizationId) throw new NotFoundError('Resident not found')
    if (!['ACTIVE', 'NOTICE'].includes(resident.status)) throw new ValidationError('Food can be changed only during your stay')

    const eating = resident.foodOptIn && Boolean(resident.foodSubscription?.active)

    if (!input.needFood) {
      if (!eating) return { resident, changed: false, message: 'You are not on the food plan' }
      await tx.foodSubscription.update({
        where: { residentId },
        data: { active: false, endDate: startOfDay(new Date()) },
      })
      await tx.resident.update({ where: { id: residentId }, data: { foodOptIn: false } })
      return {
        resident,
        changed: true,
        message: 'Food stopped. The kitchen no longer counts you, and your next rent bills will not include food.',
      }
    }

    const plan = input.foodPlanId
      ? await tx.foodPlan.findFirst({ where: { id: input.foodPlanId, propertyId: resident.propertyId, active: true } })
      : await tx.foodPlan.findFirst({
          where: { propertyId: resident.propertyId, active: true },
          orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
        })
    if (!plan) throw new ValidationError('Your PG has not set up a food plan yet. Please ask the owner.')
    if (eating && resident.foodSubscription!.foodPlanId === plan.id) {
      return { resident, changed: false, message: 'You are already on this food plan' }
    }

    if (resident.foodSubscription) {
      await tx.foodSubscription.update({
        where: { residentId },
        data: { foodPlanId: plan.id, active: true, startDate: start, endDate: null },
      })
    } else {
      await tx.foodSubscription.create({
        data: { residentId, foodPlanId: plan.id, startDate: start, active: true },
      })
    }
    await tx.resident.update({
      where: { id: residentId },
      data: { foodOptIn: true, foodCharge: plan.monthlyCharge },
    })

    // The rent bill for the period that includes tomorrow may already be out
    // without food: add the remaining days to the next bill, once.
    let topUp = 0
    if (!eating) {
      const invoice = await tx.rentInvoice.findFirst({
        where: {
          residentId,
          periodStart: { lte: start },
          periodEnd: { gte: start },
          status: { notIn: ['CANCELLED', 'DRAFT'] },
        },
        include: { lines: { where: { kind: 'FOOD' }, select: { id: true } } },
        orderBy: { periodStart: 'desc' },
      })
      if (invoice && invoice.lines.length === 0) {
        const pending = await tx.residentCharge.findFirst({
          where: {
            residentId,
            kind: 'ONE_TIME',
            category: 'FOOD',
            voidedAt: null,
            startDate: { gte: invoice.periodStart, lte: invoice.periodEnd },
          },
          select: { id: true },
        })
        const share = foodTopUp(plan.monthlyCharge, start, invoice.periodStart, invoice.periodEnd)
        if (!pending && share.amount > 0) {
          await tx.residentCharge.create({
            data: {
              organizationId: resident.organizationId,
              propertyId: resident.propertyId,
              residentId,
              kind: 'ONE_TIME',
              category: 'FOOD',
              label: `Food from ${formatDate(start)} (${share.days}/${share.totalDays} days)`,
              amount: share.amount,
              startDate: start,
              createdBy: user.name,
            },
          })
          topUp = share.amount
        }
      }
    }

    return {
      resident,
      changed: true,
      message:
        `${plan.name} starts from ${formatDate(start)}` +
        (plan.monthlyCharge > 0 ? ` at ${formatMoney(plan.monthlyCharge)} a month` : '') +
        (topUp > 0 ? `. ${formatMoney(topUp)} for the rest of this month is added to your next rent bill.` : '.'),
    }
  })

  if (result.changed) {
    const { resident } = result
    await recordActivity({
      organizationId: resident.organizationId,
      propertyId: resident.propertyId,
      actorId: user.id,
      actorName: user.name,
      actorRole: user.role,
      event: 'RESIDENT_UPDATED',
      entityType: 'Resident',
      entityId: resident.id,
      summary: `${resident.fullName} ${input.needFood ? `started food from ${formatDate(start)}` : 'stopped food'} (resident app)`,
    }).catch(() => undefined)
    const owners = await prisma.user.findMany({
      where: { organizationId: resident.organizationId, role: { in: ['OWNER', 'MANAGER'] }, status: 'ACTIVE' },
      select: { id: true },
    })
    await notifyUsers(
      owners.map((o) => o.id),
      {
        organizationId: resident.organizationId,
        kind: 'SYSTEM',
        title: input.needFood ? 'Resident started food' : 'Resident stopped food',
        body: `${resident.fullName} ${input.needFood ? `joined the food plan from ${formatDate(start)}` : 'left the food plan'}. Meal counts are updated.`,
        link: `/app/residents/${resident.id}`,
      },
    ).catch(() => undefined)
  }

  return { changed: result.changed, message: result.message }
}
