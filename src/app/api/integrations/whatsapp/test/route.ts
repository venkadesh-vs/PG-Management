import { z } from 'zod'
import { fail, parseBody, route } from '@/lib/api-helpers'
import { ValidationError } from '@/lib/tenancy'
import { isRateLimited, recordHit } from '@/lib/rate-limit'
import { sampleValue, typeForTemplate } from '@/lib/notification-prefs'
import { recordActivity } from '@/server/events'
import { normalisePhone, resolveWhatsAppChannel, sendWhatsApp } from '@/server/integrations/whatsapp'
import { getTemplate, renderTemplate, type WhatsAppTemplateName } from '@/server/integrations/whatsapp-templates'

/**
 * POST /api/integrations/whatsapp/test { phone, template }
 *
 * Sends one approved template, filled with sample values, to a number the
 * owner chooses, through the same path as real messages (their own number,
 * the StayFlow number, or demo). The answer says exactly what happened; a
 * demo "send" is never reported as delivered. Ignores the per-type switches,
 * still honours STOP. At most 5 tests per 15 minutes per organization.
 */

const schema = z.object({
  phone: z
    .string()
    .trim()
    .regex(/^(\+?\d[\d\s-]{8,16}\d)$/, 'Enter a mobile number with country code, e.g. 98765 43210'),
  template: z.string().min(1, 'Choose a template'),
})

export const POST = route(
  async ({ user, request }) => {
    const body = await parseBody(request, schema)
    const organizationId = user.organizationId!
    const def = getTemplate(body.template)
    // Login-link templates carry real links and skip STOP: never sent as a test.
    if (!def || typeForTemplate(body.template) === 'ACCOUNT_ACCESS') {
      throw new ValidationError('Choose one of the resident message templates')
    }
    const phone = normalisePhone(body.phone)
    if (phone.length < 11 || phone.length > 15) throw new ValidationError('Enter a valid mobile number')

    const key = `wa-test:${organizationId}`
    if (await isRateLimited(key, 5, 15)) {
      return fail('Too many test messages. Wait 15 minutes and try again.', 429)
    }
    await recordHit(key)

    const variables = def.variables.map(sampleValue)
    const channel = await resolveWhatsAppChannel(organizationId)
    const result = await sendWhatsApp({
      organizationId,
      toName: 'Test message',
      toPhone: phone,
      template: body.template as WhatsAppTemplateName,
      body: `[Test] ${renderTemplate(def, variables)}`,
      variables,
      refType: 'Test',
      ignorePreferences: true,
    })

    await recordActivity({
      organizationId,
      actorId: user.id,
      actorName: user.name,
      actorRole: user.role,
      event: 'SETTINGS_UPDATED',
      entityType: 'OutboundMessage',
      entityId: result.id || undefined,
      summary: `WhatsApp test "${def.label}" to +${phone}: ${result.outcome ?? result.status}`,
      meta: { template: body.template, mode: channel.mode, outcome: result.outcome ?? null, error: result.error ?? null },
    })

    const message =
      result.outcome === 'sent'
        ? `Sent to +${phone} from ${channel.mode === 'own' ? 'your own number' : 'the StayFlow number'}. Delivery ticks will appear in the Message centre.`
        : result.outcome === 'demo'
          ? 'Demo mode: nothing was sent. The message is stored in the Message centre exactly as it would go out.'
          : result.outcome === 'opted_out'
            ? 'Not sent: this number replied STOP. Opt the resident back in first if they asked to receive messages.'
            : result.outcome === 'disabled'
              ? 'Not sent: WhatsApp is switched off for your account (Settings → Features).'
              : `Not sent: ${result.error ?? 'WhatsApp returned an error'}`

    return { ...result, mode: channel.mode, message }
  },
  { permission: 'settings.manage', module: 'whatsapp' },
)
