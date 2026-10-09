import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { ok, parseBody, route } from '@/lib/api-helpers'
import { settingsSchema } from '@/lib/validation'
import { slaSettingsSchema } from '@/lib/sla'
import { recordActivity } from '@/server/events'
import { ValidationError } from '@/lib/tenancy'
import { dayWindowProblem } from '@/lib/autopay'

/** Complaint SLA targets (PRD §43) ride along with the rent settings. */
const settingsWithSlaSchema = settingsSchema.merge(slaSettingsSchema).extend({
  /** Expenses of this amount or more, recorded by someone who cannot approve, wait for approval. */
  expenseApprovalThreshold: z.coerce.number().int().min(0).max(10_000_000).optional(),
})

/**
 * POST /api/settings — organization-wide automation settings. These drive
 * invoice generation, late fees and reminders, so they need settings.manage.
 */
export const POST = route(
  async ({ user, request }) => {
    const body = await parseBody(request, settingsWithSlaSchema)
    const organizationId = user.organizationId!

    const data = {
      rentDueDay: body.rentDueDay,
      rentGenerateDay: body.rentGenerateDay,
      lateFeeEnabled: body.lateFeeEnabled,
      lateFeeGraceDays: body.lateFeeGraceDays,
      lateFeeAmount: body.lateFeeAmount,
      lateFeePerDay: body.lateFeePerDay,
      reminderDaysBefore: body.reminderDaysBefore,
      reminderOnDueDate: body.reminderOnDueDate,
      reminderAfterDays: body.reminderAfterDays,
      whatsappEnabled: body.whatsappEnabled,
      upiId: body.upiId || null,
      upiPayeeName: body.upiPayeeName || null,
      invoicePrefix: body.invoicePrefix.toUpperCase(),
      receiptPrefix: body.receiptPrefix.toUpperCase(),
      ...(body.slaUrgentHours !== undefined ? { slaUrgentHours: body.slaUrgentHours } : {}),
      ...(body.slaHighHours !== undefined ? { slaHighHours: body.slaHighHours } : {}),
      ...(body.slaMediumHours !== undefined ? { slaMediumHours: body.slaMediumHours } : {}),
      ...(body.slaLowHours !== undefined ? { slaLowHours: body.slaLowHours } : {}),
      ...(body.expenseApprovalThreshold !== undefined ? { expenseApprovalThreshold: body.expenseApprovalThreshold } : {}),
    }

    const settings = await prisma.orgSetting.upsert({
      where: { organizationId },
      create: { organizationId, ...data },
      update: data,
    })

    await recordActivity({
      organizationId,
      actorId: user.id,
      actorName: user.name,
      actorRole: user.role,
      event: 'SETTINGS_UPDATED',
      entityType: 'OrgSetting',
      entityId: settings.id,
      summary: 'Rent, reminder and complaint SLA settings updated',
    })

    return ok({ settings, message: 'Settings saved' })
  },
  { permission: 'settings.manage' },
)

/** Resident rent AutoPay: offered or not, the limit rule, debit day and retries. */
const autopaySchema = z.object({
  residentAutopayEnabled: z.boolean().optional(),
  autopayMaxPercent: z.coerce.number().int().min(100, 'At least 100%').max(300).optional(),
  autopayMaxAmountCap: z.union([z.coerce.number().int().min(500).max(1_000_000), z.null()]).optional(),
  autopayChargeDayOffset: z.coerce.number().int().min(0).max(10).optional(),
  autopayRetryDays: z.coerce.number().int().min(0).max(5).optional(),
  rentDueDayMin: z.coerce.number().int().min(1).max(28).optional(),
  rentDueDayMax: z.coerce.number().int().min(1).max(28).optional(),
})

/** PATCH /api/settings — AutoPay settings only (the rest of the form posts above). */
export const PATCH = route(
  async ({ user, request }) => {
    const body = await parseBody(request, autopaySchema)
    const organizationId = user.organizationId!
    const before = await prisma.orgSetting.findUnique({ where: { organizationId } })
    const data = Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined))
    const windowError = dayWindowProblem(body.rentDueDayMin ?? before?.rentDueDayMin ?? 1, body.rentDueDayMax ?? before?.rentDueDayMax ?? 10)
    if (windowError) throw new ValidationError(windowError)
    const settings = await prisma.orgSetting.upsert({
      where: { organizationId },
      create: { organizationId, ...data },
      update: data,
    })
    await recordActivity({
      organizationId,
      actorId: user.id,
      actorName: user.name,
      actorRole: user.role,
      event: 'SETTINGS_UPDATED',
      entityType: 'OrgSetting',
      entityId: settings.id,
      summary: settings.residentAutopayEnabled ? 'Resident AutoPay settings updated (offered)' : 'Resident AutoPay settings updated (not offered)',
      before: before
        ? {
            residentAutopayEnabled: before.residentAutopayEnabled,
            autopayMaxPercent: before.autopayMaxPercent,
            autopayMaxAmountCap: before.autopayMaxAmountCap,
            autopayChargeDayOffset: before.autopayChargeDayOffset,
            autopayRetryDays: before.autopayRetryDays,
            rentDueDayMin: before.rentDueDayMin,
            rentDueDayMax: before.rentDueDayMax,
          }
        : undefined,
      after: data,
    })
    return ok({ settings, message: 'AutoPay settings saved' })
  },
  { permission: 'settings.manage' },
)
