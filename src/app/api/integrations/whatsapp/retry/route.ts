import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { parseBody, route } from '@/lib/api-helpers'
import { NotFoundError, ValidationError } from '@/lib/tenancy'
import { retryWhatsAppMessage } from '@/server/integrations/whatsapp'

/**
 * POST /api/integrations/whatsapp/retry — resend one FAILED WhatsApp message
 * from the outbox, with exactly the variables it was first sent with.
 * Org-scoped: a message id from another organization is "not found".
 */

const schema = z.object({ messageId: z.string().min(1) })

export const POST = route(
  async ({ user, request }) => {
    const { messageId } = await parseBody(request, schema)
    const message = await prisma.outboundMessage.findFirst({
      where: { id: messageId, organizationId: user.organizationId ?? '__none__', channel: 'WHATSAPP' },
    })
    if (!message) throw new NotFoundError('Message not found')

    const result = await retryWhatsAppMessage(message)
    if (result.outcome !== 'sent') {
      throw new ValidationError(result.error ?? 'The message could not be sent')
    }
    return result
  },
  { roles: ['OWNER', 'MANAGER'] },
)
