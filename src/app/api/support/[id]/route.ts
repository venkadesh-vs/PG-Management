import { parseBody, route } from '@/lib/api-helpers'
import { ticketActionSchema } from '@/lib/support'
import { actOnTicket, getTicket } from '@/server/services/support'

/**
 * /api/support/<id>
 *   GET  — the ticket and its thread.
 *   POST — { action: 'REPLY', body, attachmentUrl?, status? }   (status: team only)
 *          { action: 'CLOSE' }
 *          { action: 'STATUS', status, note? }                 (team only)
 *          { action: 'ASSIGN', assigneeId | null }              (team only)
 *          { action: 'PRIORITY', priority }                     (team only)
 *
 * A ticket of another organization answers 404.
 */

function idFrom(request: Request) {
  return decodeURIComponent(new URL(request.url).pathname.split('/').filter(Boolean).pop() ?? '')
}

export const GET = route(async ({ user, request }) => getTicket(user, idFrom(request)), {
  roles: ['OWNER', 'MANAGER', 'SUPER_ADMIN'],
})

export const POST = route(
  async ({ user, request }) => {
    const body = await parseBody(request, ticketActionSchema)
    return actOnTicket(user, idFrom(request), body)
  },
  { roles: ['OWNER', 'MANAGER', 'SUPER_ADMIN'], allowRestricted: true },
)
