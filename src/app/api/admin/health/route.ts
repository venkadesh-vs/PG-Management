import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { ok, parseBody, route } from '@/lib/api-helpers'
import { recordActivity } from '@/server/events'
import { replayFailedWebhooks } from '@/server/services/subscriptions'

const schema = z.object({ action: z.literal('RETRY_WEBHOOKS') })

/** System health actions. Super Admin only. */
export const POST = route(
  async ({ user, request }) => {
    await parseBody(request, schema)
    const before = await prisma.webhookEvent.count({ where: { status: 'FAILED' } })
    const result = await replayFailedWebhooks()
    const after = await prisma.webhookEvent.count({ where: { status: 'FAILED' } })

    await recordActivity({
      actorId: user.id,
      actorName: user.name,
      actorRole: user.role,
      event: 'ADMIN_ACTION',
      entityType: 'WebhookEvent',
      summary: `Retried failed webhooks: ${result.processed} processed, ${result.failed} still failing`,
      before: { failed: before },
      after: { failed: after, replayed: result.processed, stillFailing: result.failed },
    })

    const tried = result.processed + result.failed
    return ok({
      ...result,
      message: tried
        ? `${result.processed} of ${tried} webhook${tried === 1 ? '' : 's'} went through${result.failed ? ` — ${result.failed} still failing` : ''}`
        : 'Nothing to retry — events that failed 5 times need a manual look',
    })
  },
  { roles: ['SUPER_ADMIN'] },
)
