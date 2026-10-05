import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { serverEnv } from '@/lib/env'
import { ok, parseBody, route } from '@/lib/api-helpers'
import { ForbiddenError, ValidationError } from '@/lib/tenancy'
import { decryptJson, encryptJson, maskTail } from '@/lib/crypto'
import { recordActivity } from '@/server/events'
import { listOrders, RazorpayError } from '@/server/integrations/razorpay'

/**
 * A PG owner's own Razorpay account, used to collect rent straight into their
 * bank. Keys are verified against Razorpay before they are stored, and the
 * secrets are encrypted at rest (AES-256-GCM, DATA_ENCRYPTION_KEY). The key
 * secret and webhook secret are never sent back to the browser.
 */

const schema = z.object({
  keyId: z
    .string()
    .trim()
    .regex(/^rzp_(test|live)_[A-Za-z0-9]+$/, 'Key ID looks like rzp_live_XXXXXXXX or rzp_test_XXXXXXXX'),
  keySecret: z.string().trim().min(8, 'Paste the full Key Secret').max(200),
  /** Optional on update: blank keeps the stored webhook secret. */
  webhookSecret: z.string().trim().max(200).optional(),
})

function webhookUrl(organizationId: string) {
  return `${serverEnv.appUrl}/api/webhooks/razorpay/org/${organizationId}`
}

export const GET = route(
  async ({ user }) => {
    if (!user.organizationId) throw new ForbiddenError()
    const credential = await prisma.integrationCredential.findUnique({
      where: { organizationId_kind: { organizationId: user.organizationId, kind: 'RAZORPAY' } },
    })
    return ok({
      connected: Boolean(credential?.active),
      keyId: credential ? maskTail(credential.publicId, 6) : null,
      mode: credential?.publicId.startsWith('rzp_live_') ? 'live' : credential ? 'test' : null,
      verifiedAt: credential?.verifiedAt ?? null,
      lastError: credential?.lastError ?? null,
      webhookUrl: webhookUrl(user.organizationId),
    })
  },
  { roles: ['OWNER'] },
)

export const POST = route(
  async ({ user, request }) => {
    if (!user.organizationId) throw new ForbiddenError()
    const organizationId = user.organizationId
    const body = await parseBody(request, schema)

    if (Buffer.from(serverEnv.dataEncryptionKey, 'base64').length !== 32) {
      throw new ValidationError(
        'Online payments cannot be connected yet: the platform administrator has not set DATA_ENCRYPTION_KEY.',
      )
    }

    const existing = await prisma.integrationCredential.findUnique({
      where: { organizationId_kind: { organizationId, kind: 'RAZORPAY' } },
    })
    let webhookSecret = body.webhookSecret ?? ''
    if (!webhookSecret && existing) {
      try {
        webhookSecret = decryptJson<{ webhookSecret: string }>(existing.secretCipher).webhookSecret ?? ''
      } catch {
        webhookSecret = ''
      }
    }
    if (webhookSecret.length < 6) {
      throw new ValidationError('Enter the webhook secret you set on the Razorpay webhook')
    }

    // Prove the keys work before storing them.
    try {
      await listOrders({ keyId: body.keyId, keySecret: body.keySecret }, { count: 1 })
    } catch (error) {
      if (error instanceof RazorpayError) {
        throw new ValidationError(
          error.status === 401
            ? 'Razorpay rejected these keys. Check the Key ID and Key Secret (and that they are from the same mode, test or live).'
            : error.message,
        )
      }
      throw error
    }

    const data = {
      publicId: body.keyId,
      secretCipher: encryptJson({ keySecret: body.keySecret, webhookSecret }),
      active: true,
      verifiedAt: new Date(),
      lastError: null,
    }
    await prisma.integrationCredential.upsert({
      where: { organizationId_kind: { organizationId, kind: 'RAZORPAY' } },
      create: { organizationId, kind: 'RAZORPAY', ...data },
      update: data,
    })

    await recordActivity({
      organizationId,
      actorId: user.id,
      actorName: user.name,
      actorRole: user.role,
      event: 'SETTINGS_UPDATED',
      entityType: 'IntegrationCredential',
      summary: `Razorpay ${existing ? 'keys updated' : 'connected'} (${maskTail(body.keyId, 6)})`,
    })

    return ok({
      message: body.keyId.startsWith('rzp_test_')
        ? 'Razorpay connected in TEST mode — residents will see test checkout. Switch to live keys to collect real rent.'
        : 'Razorpay connected. Rent paid online now goes straight to your account.',
      webhookUrl: webhookUrl(organizationId),
    })
  },
  { roles: ['OWNER'] },
)

export const DELETE = route(
  async ({ user }) => {
    if (!user.organizationId) throw new ForbiddenError()
    const removed = await prisma.integrationCredential.deleteMany({
      where: { organizationId: user.organizationId, kind: 'RAZORPAY' },
    })
    if (removed.count > 0) {
      await recordActivity({
        organizationId: user.organizationId,
        actorId: user.id,
        actorName: user.name,
        actorRole: user.role,
        event: 'SETTINGS_UPDATED',
        entityType: 'IntegrationCredential',
        summary: 'Razorpay disconnected — rent falls back to UPI',
      })
    }
    return ok({ message: 'Razorpay disconnected. Residents will see your UPI details instead.' })
  },
  { roles: ['OWNER'] },
)
