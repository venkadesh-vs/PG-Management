import 'server-only'

import { randomUUID } from 'crypto'
import { prisma } from '@/lib/prisma'
import { addDays, startOfDay, startOfMonth } from '@/lib/utils'
import { sweepRateLimits } from '@/lib/rate-limit'
import {
  applyOverdueAndLateFees,
  generateMonthlyInvoices,
  sendRentReminders,
} from './billing'
import { snapshotOccupancy } from './residents'
import { enforceGracePeriods, runSubscriptionBilling } from './subscriptions'
import { expectedMealCount, MEAL_TYPES } from './kitchen'
import { retryFailedWhatsApp } from '../integrations/whatsapp'
import { orgsWithModuleOff } from './org-modules'

/**
 * The daily automation pass. One entry point, safe to run repeatedly — every
 * step is idempotent for a given day. Triggered by POST /api/cron/run (with
 * the CRON_SECRET) or `npm run cron`.
 */

export type AutomationReport = {
  ranAt: Date
  /** False when another run held the lock and this one did nothing. */
  ran: boolean
  invoices: { created: number; skipped: number; failed: number }
  overdue: { flagged: number; feesApplied: number }
  reminders: { sent: number }
  subscriptions: { billed: number; failed: number; suspended: number }
  occupancy: { snapshots: number }
  meals: { refreshed: number }
  whatsappRetries: { retried: number; sent: number; failed: number }
  errors: string[]
}

// --------------------------------------------------------------------------
// Run lock
// --------------------------------------------------------------------------

/**
 * Two overlapping runs (a slow cron plus a manual "run now", or two cron
 * instances) must not double-send reminders or double-charge AutoPay.
 *
 * Why a lease row and not pg_advisory_lock: a session advisory lock belongs to
 * one pooled connection, and Prisma may run the unlock on a different one, so
 * the lock leaks until that connection is recycled. The transaction-scoped
 * variant would need the whole multi-minute run inside one interactive
 * transaction, while every step here opens transactions of its own on other
 * connections. A row in SystemSetting (unique `key`) works across connections
 * and server instances, and a stale lease (crashed run) expires on its own.
 *
 * The lock is global, not per organization: a single-org manual run and the
 * all-org cron touch the same invoices.
 */
const RUN_LOCK_KEY = 'automation:daily-run:lock'
const RUN_LOCK_TTL_MINUTES = 30

async function acquireRunLock(token: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ key: string }[]>`
    INSERT INTO "SystemSetting" ("id", "key", "value", "updatedAt")
    VALUES (gen_random_uuid()::text, ${RUN_LOCK_KEY}, jsonb_build_object('token', ${token}::text), NOW())
    ON CONFLICT ("key") DO UPDATE
      SET "value" = EXCLUDED."value", "updatedAt" = NOW()
      WHERE "SystemSetting"."updatedAt" < NOW() - make_interval(mins => ${RUN_LOCK_TTL_MINUTES}::int)
    RETURNING "key"
  `
  return rows.length === 1
}

async function releaseRunLock(token: string) {
  await prisma.$executeRaw`
    DELETE FROM "SystemSetting" WHERE "key" = ${RUN_LOCK_KEY} AND "value"->>'token' = ${token}
  `
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
    ran: false,
    invoices: { created: 0, skipped: 0, failed: 0 },
    overdue: { flagged: 0, feesApplied: 0 },
    reminders: { sent: 0 },
    subscriptions: { billed: 0, failed: 0, suspended: 0 },
    occupancy: { snapshots: 0 },
    meals: { refreshed: 0 },
    whatsappRetries: { retried: 0, sent: 0, failed: 0 },
    errors,
  }

  const token = randomUUID()
  if (!(await acquireRunLock(token))) {
    errors.push('skipped: another automation run is already in progress')
    return report
  }
  try {
    report.ran = true
    await runSteps(now, report, options)
  } finally {
    await releaseRunLock(token).catch((error) => {
      // The lease expires on its own; just make the leak visible.
      console.error('[automation] failed to release run lock', error)
    })
  }
  return report
}

async function runSteps(
  now: Date,
  report: AutomationReport,
  options?: { organizationId?: string; skipInvoices?: boolean },
) {
  const errors = report.errors

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
        report.invoices.failed += result.failed
        for (const failure of result.failures) {
          errors.push(`invoice for resident ${failure.residentId} (${org.name}): ${failure.error}`)
        }
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

  // 3. Rent reminders — before due, on due, and after due (on WhatsApp, so
  //    organizations with that module off are skipped inside).
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

  // Housekeeping: old rate-limit rows and expired sessions.
  try {
    await sweepRateLimits()
    await prisma.session.deleteMany({ where: { expiresAt: { lt: addDays(now, -30) } } })
  } catch (error) {
    errors.push(`housekeeping: ${(error as Error).message}`)
  }

  // 6. Refresh today's expected meal counts from live subscriptions —
  //    skipped for organizations with Food & meals switched off.
  try {
    const foodOff = await orgsWithModuleOff('food', options?.organizationId)
    const meals = await prisma.meal.findMany({
      where: {
        date: startOfDay(now),
        AND: [
          options?.organizationId ? { organizationId: options.organizationId } : {},
          foodOff.length ? { organizationId: { notIn: foodOff } } : {},
        ],
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
  // 7. Retry WhatsApp messages that failed transiently (network, rate limit,
  //    expired token since fixed). Small batch; opt-outs and Meta's
  //    permanent rejections are never retried.
  //    Organizations with WhatsApp switched off are skipped (in the sender).
  try {
    report.whatsappRetries = await retryFailedWhatsApp({ organizationId: options?.organizationId, now })
  } catch (error) {
    errors.push(`whatsapp retries: ${(error as Error).message}`)
  }
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
