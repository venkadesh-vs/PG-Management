import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { ok, parseBody, route } from '@/lib/api-helpers'
import { settingsSchema } from '@/lib/validation'
import { slaSettingsSchema } from '@/lib/sla'
import { recordActivity } from '@/server/events'

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
