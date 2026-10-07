import { ok, parseBody, route } from '@/lib/api-helpers'
import { createTicketSchema } from '@/lib/support'
import { createTicket, listAllTickets, listOrgTickets } from '@/server/services/support'

/**
 * /api/support
 *   GET  — the caller's organization's tickets (owner / settings.manage);
 *          every ticket for a Super Admin (?status=ACTIVE|OPEN|…).
 *   POST — { subject, category, priority, message, attachmentUrl? } opens a
 *          ticket. 5 per person per hour.
 *
 * Allowed while the subscription is suspended: that is when people most need help.
 */

export const GET = route(
  async ({ user, request }) => {
    if (user.role === 'SUPER_ADMIN') {
      const status = new URL(request.url).searchParams.get('status') ?? undefined
      const valid = ['ACTIVE', 'OPEN', 'IN_PROGRESS', 'WAITING_ON_CUSTOMER', 'RESOLVED', 'CLOSED']
      return { tickets: await listAllTickets({ status: valid.includes(status ?? '') ? (status as 'ACTIVE') : undefined }) }
    }
    return { tickets: await listOrgTickets(user) }
  },
  { roles: ['OWNER', 'MANAGER', 'SUPER_ADMIN'] },
)

export const POST = route(
  async ({ user, request }) => {
    const body = await parseBody(request, createTicketSchema)
    const { ticket, message } = await createTicket(user, body)
    return ok({ ticket: { id: ticket.id, code: ticket.code }, message }, { status: 201 })
  },
  { roles: ['OWNER', 'MANAGER'], allowRestricted: true },
)
