import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { serverEnv } from '@/lib/env'
import { encryptJson } from '@/lib/crypto'
import { parseBody, route } from '@/lib/api-helpers'
import { ValidationError } from '@/lib/tenancy'
import { recordActivity } from '@/server/events'
import { getWhatsAppConnection } from '@/server/integrations/whatsapp'

/**
 * /api/integrations/whatsapp — an organization's own WhatsApp Business
 * number. Without one, messages go out from the StayFlow platform number
 * (or stay in demo). OWNER only: the access token sends as the business.
 *
 * GET    — current mode and connected number (never the token).
 * POST   — verify the credentials against Meta, then store them encrypted.
 * DELETE — disconnect; messages fall back to the platform number.
 */

const connectSchema = z.object({
  phoneNumberId: z.string().trim().regex(/^\d{5,30}$/, 'Phone number ID is the numeric ID from WhatsApp Manager'),
  wabaId: z.string().trim().regex(/^\d{5,30}$/, 'WhatsApp Business Account ID is numeric'),
  accessToken: z.string().trim().min(20, 'Paste the full permanent access token'),
  appSecret: z.string().trim().max(200).optional().or(z.literal('')),
})

export const GET = route(
  async ({ user }) => getWhatsAppConnection(user.organizationId!),
  { roles: ['OWNER'] },
)

export const POST = route(
  async ({ user, request }) => {
    const body = await parseBody(request, connectSchema)
    const organizationId = user.organizationId!

    // Prove the token can see this number before anything is stored.
    let info: { display_phone_number?: string; verified_name?: string; error?: { message?: string } }
    try {
      const res = await fetch(
        `https://graph.facebook.com/${serverEnv.whatsapp.apiVersion}/${encodeURIComponent(body.phoneNumberId)}?fields=display_phone_number,verified_name`,
        {
          headers: { Authorization: `Bearer ${body.accessToken}` },
          signal: AbortSignal.timeout(15000),
          cache: 'no-store',
        },
      )
      info = (await res.json().catch(() => ({}))) as typeof info
      if (!res.ok) {
        throw new ValidationError(`Meta rejected these details: ${info.error?.message ?? `HTTP ${res.status}`}`)
      }
    } catch (error) {
      if (error instanceof ValidationError) throw error
      throw new ValidationError(`Could not reach Meta to verify the number: ${(error as Error).message}`)
    }

    const secret: Record<string, string> = {
      accessToken: body.accessToken,
      wabaId: body.wabaId,
      displayPhoneNumber: info.display_phone_number ?? '',
      verifiedName: info.verified_name ?? '',
    }
    if (body.appSecret) secret.appSecret = body.appSecret

    let secretCipher: string
    try {
      secretCipher = encryptJson(secret)
    } catch (error) {
      throw new ValidationError(`Secrets cannot be stored on this deployment yet: ${(error as Error).message}`)
    }

    const data = {
      publicId: body.phoneNumberId,
      secretCipher,
      active: true,
      verifiedAt: new Date(),
      lastError: null,
    }
    await prisma.integrationCredential.upsert({
      where: { organizationId_kind: { organizationId, kind: 'WHATSAPP_META' } },
      create: { organizationId, kind: 'WHATSAPP_META', ...data },
      update: data,
    })

    await recordActivity({
      organizationId,
      actorId: user.id,
      actorName: user.name,
      actorRole: user.role,
      event: 'SETTINGS_UPDATED',
      entityType: 'IntegrationCredential',
      summary: `Connected own WhatsApp number ${info.display_phone_number ?? body.phoneNumberId}`,
    })

    return getWhatsAppConnection(organizationId)
  },
  { roles: ['OWNER'] },
)

export const DELETE = route(
  async ({ user }) => {
    const organizationId = user.organizationId!
    const removed = await prisma.integrationCredential.deleteMany({
      where: { organizationId, kind: 'WHATSAPP_META' },
    })
    if (removed.count) {
      await recordActivity({
        organizationId,
        actorId: user.id,
        actorName: user.name,
        actorRole: user.role,
        event: 'SETTINGS_UPDATED',
        entityType: 'IntegrationCredential',
        summary: 'Disconnected own WhatsApp number',
      })
    }
    return getWhatsAppConnection(organizationId)
  },
  { roles: ['OWNER'] },
)
