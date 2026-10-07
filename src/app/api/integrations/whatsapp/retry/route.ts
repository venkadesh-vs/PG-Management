import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { parseBody, route } from '@/lib/api-helpers'
import { NotFoundError, requirePermission, ValidationError } from '@/lib/tenancy'
import { retryWhatsAppMessage } from '@/server/integrations/whatsapp'
import { viewerScope } from '@/server/services/message-centre'

/**
 * POST /api/integrations/whatsapp/retry — resend one FAILED WhatsApp message
 * from the outbox, with exactly the variables it was first sent with.
 * Org-scoped: a message id from another organization is "not found"; a
 * PG-limited manager can only retry messages to residents of their PGs.
 * Retrying re-sends, so it needs announcements.send on top of messages.view.
 */

const schema = z.object({ messageId: z.string().min(1) })

export const POST = route(
  async ({ user, request }) => {
    // Owners can always retry, even with the announcements module switched off.
    if (user.role !== 'OWNER') requirePermission(user, 'announcements.send')
    const { messageId } = await parseBody(request, schema)
    const organizationId = user.organizationId ?? '__none__'
    const scope = await viewerScope({ id: user.id, role: user.role, organizationId, propertyIds: user.propertyIds })
    const message = await prisma.outboundMessage.findFirst({
      where: { id: messageId, organizationId, channel: 'WHATSAPP', AND: [scope.outbound] },
    })
    if (!message) throw new NotFoundError('Message not found')

    const result = await retryWhatsAppMessage(message)
    if (result.outcome !== 'sent') {
      throw new ValidationError(result.error ?? 'The message could not be sent')
    }
    return result
  },
  { permission: 'messages.view', module: 'whatsapp' },
)
