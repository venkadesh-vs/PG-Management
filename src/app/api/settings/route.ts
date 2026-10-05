import { prisma } from '@/lib/prisma'
import { ok, parseBody, route } from '@/lib/api-helpers'
import { settingsSchema } from '@/lib/validation'
import { recordActivity } from '@/server/events'

/**
 * POST /api/settings — organization-wide automation settings. These drive
 * invoice generation, late fees and reminders, so only an OWNER may change
 * them.
 */
export const POST = route(
  async ({ user, request }) => {
    const body = await parseBody(request, settingsSchema)
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
      summary: 'Rent, late fee and reminder settings updated',
    })

    return ok({ settings, message: 'Settings saved' })
  },
  { roles: ['OWNER'] },
)
