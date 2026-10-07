import { prisma } from '@/lib/prisma'
import { ok, route } from '@/lib/api-helpers'

/**
 * GET /api/announcements — platform announcements live right now for the
 * signed-in owner/manager's account (audience ALL, or matching its status).
 */
export const GET = route(
  async ({ user }) => {
    if (!user.organizationId || !['OWNER', 'MANAGER'].includes(user.role)) return ok({ announcements: [] })
    const status = user.organizationStatus
    const audiences = ['ALL']
    if (status === 'TRIAL') audiences.push('TRIAL')
    if (status === 'ACTIVE' || status === 'PAST_DUE') audiences.push('ACTIVE')
    if (status === 'SUSPENDED') audiences.push('SUSPENDED')
    const now = new Date()
    const announcements = await prisma.platformAnnouncement.findMany({
      where: {
        audience: { in: audiences },
        startsAt: { lte: now },
        OR: [{ endsAt: null }, { endsAt: { gt: now } }],
      },
      orderBy: { startsAt: 'desc' },
      take: 3,
      select: { id: true, title: true, body: true, severity: true },
    })
    return ok({ announcements })
  },
  // A suspended account should still hear from us.
  { allowRestricted: true },
)
