import 'server-only'

import { prisma } from '@/lib/prisma'
import { startOfDay, startOfMonth } from '@/lib/utils'
import {
  applyOverdueAndLateFees,
  generateMonthlyInvoices,
  sendRentReminders,
} from './billing'
import { snapshotOccupancy } from './residents'
import { enforceGracePeriods, runSubscriptionBilling } from './subscriptions'
import { expectedMealCount, MEAL_TYPES } from './kitchen'

/**
 * The daily automation pass. One entry point, safe to run repeatedly — every
 * step is idempotent for a given day. Triggered by POST /api/cron/run (with
 * the CRON_SECRET) or `npm run cron`.
 */

export type AutomationReport = {
  ranAt: Date
  invoices: { created: number; skipped: number }
  overdue: { flagged: number; feesApplied: number }
  reminders: { sent: number }
  subscriptions: { billed: number; failed: number; suspended: number }
  occupancy: { snapshots: number }
  meals: { refreshed: number }
  errors: string[]
}

export async function runDailyAutomation(options?: {
  organizationId?: string
  now?: Date
  /** Skip invoice generation when only reminders are wanted. */
  skipInvoices?: boolean
}): Promise<AutomationReport> {
  const now = options?.now ?? new Date()
  const errors: string[] = []

  const report: AutomationReport = {
    ranAt: now,
    invoices: { created: 0, skipped: 0 },
    overdue: { flagged: 0, feesApplied: 0 },
    reminders: { sent: 0 },
    subscriptions: { billed: 0, failed: 0, suspended: 0 },
    occupancy: { snapshots: 0 },
    meals: { refreshed: 0 },
    errors,
  }

  // 1. Generate this month's rent for every active resident, on or after the
  //    configured generation day.
  if (!options?.skipInvoices) {
    try {
      const orgs = await prisma.organization.findMany({
        where: {
          archivedAt: null,
          status: { in: ['ACTIVE', 'TRIAL', 'PAST_DUE'] },
          ...(options?.organizationId ? { id: options.organizationId } : {}),
        },
        include: { settings: true },
      })
      for (const org of orgs) {
        const generateDay = org.settings?.rentGenerateDay ?? 1
        if (now.getDate() < generateDay) continue
        const result = await generateMonthlyInvoices({
          organizationId: org.id,
          month: startOfMonth(now),
          actor: { name: 'Automation' },
        })
        report.invoices.created += result.created
        report.invoices.skipped += result.skipped
      }
    } catch (error) {
      errors.push(`invoices: ${(error as Error).message}`)
    }
  }

  // 2. Flag overdue invoices and apply late fees past the grace period.
  try {
    const result = await applyOverdueAndLateFees(options?.organizationId)
    report.overdue = result
  } catch (error) {
    errors.push(`overdue: ${(error as Error).message}`)
  }

  // 3. Rent reminders — before due, on due, and after due.
  try {
    const result = await sendRentReminders({ organizationId: options?.organizationId, now })
    report.reminders.sent = result.sent
  } catch (error) {
    errors.push(`reminders: ${(error as Error).message}`)
  }

  // 4. SaaS subscription billing + grace enforcement.
  try {
    const billed = await runSubscriptionBilling({ now, organizationId: options?.organizationId })
    report.subscriptions.billed = billed.filter((b) => b.outcome === 'paid').length
    report.subscriptions.failed = billed.filter((b) => b.outcome === 'failed').length
    const grace = await enforceGracePeriods(now)
    report.subscriptions.suspended = grace.suspended
  } catch (error) {
    errors.push(`subscriptions: ${(error as Error).message}`)
  }

  // 5. Daily occupancy snapshot, which powers the trend charts.
  try {
    const props = options?.organizationId
      ? await prisma.property.findMany({
          where: { organizationId: options.organizationId, archivedAt: null },
          select: { id: true },
        })
      : null
    const result = await snapshotOccupancy(props?.map((p) => p.id))
    report.occupancy.snapshots = result.snapshots
  } catch (error) {
    errors.push(`occupancy: ${(error as Error).message}`)
  }

  // 6. Refresh today's expected meal counts from live subscriptions.
  try {
    const meals = await prisma.meal.findMany({
      where: {
        date: startOfDay(now),
        ...(options?.organizationId ? { organizationId: options.organizationId } : {}),
      },
    })
    for (const meal of meals) {
      const expected = await expectedMealCount(meal.propertyId, meal.type, meal.date)
      if (expected !== meal.expectedCount) {
        await prisma.meal.update({ where: { id: meal.id }, data: { expectedCount: expected } })
      }
      report.meals.refreshed++
    }
  } catch (error) {
    errors.push(`meals: ${(error as Error).message}`)
  }

  return report
}

/** Creates tomorrow's meal rows from today's menu so the kitchen has a plan. */
export async function rolloverMealPlan(propertyId: string, from: Date, to: Date) {
  const source = await prisma.meal.findMany({
    where: { propertyId, date: startOfDay(from) },
  })
  let created = 0
  for (const type of MEAL_TYPES) {
    const meal = source.find((m) => m.type === type)
    if (!meal) continue
    const expected = await expectedMealCount(propertyId, type, to)
    await prisma.meal.upsert({
      where: { propertyId_date_type: { propertyId, date: startOfDay(to), type } },
      create: {
        organizationId: meal.organizationId,
        propertyId,
        date: startOfDay(to),
        type,
        menu: meal.menu,
        expectedCount: expected,
      },
      update: { expectedCount: expected },
    })
    created++
  }
  return { created }
}
