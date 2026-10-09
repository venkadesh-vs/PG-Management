import { z } from 'zod'
import { ok, parseBody, route } from '@/lib/api-helpers'
import { ownerBillingChannels, setOwnerBillingChannels } from '@/server/services/owner-billing'

/**
 * Where StayFlow sends this account's billing reminders, besides the in-app
 * bell (always on). GET returns the channels; PATCH { channels } saves them.
 */

const schema = z.object({ channels: z.array(z.enum(['WHATSAPP', 'EMAIL'])).max(2) })

export const GET = route(
  async ({ user }) => ({ channels: await ownerBillingChannels(user.organizationId!) }),
  { roles: ['OWNER', 'MANAGER'], permission: 'billing.manage', allowRestricted: true },
)

export const PATCH = route(
  async ({ user, request }) => {
    const body = await parseBody(request, schema)
    const channels = await setOwnerBillingChannels(user.organizationId!, body.channels, { id: user.id, name: user.name })
    return ok({
      channels,
      message: channels.length ? 'Billing reminders updated' : 'Billing reminders will only appear in the app',
    })
  },
  { roles: ['OWNER', 'MANAGER'], permission: 'billing.manage', allowRestricted: true },
)
