import { prisma } from '@/lib/prisma'
import { route } from '@/lib/api-helpers'

/** GET /api/staff — the org's active staff, for assignment pickers. */
export const GET = route(
  async ({ user, request }) => {
    const url = new URL(request.url)
    const propertyId = url.searchParams.get('propertyId')

    const staff = await prisma.staff.findMany({
      where: {
        organizationId: user.organizationId!,
        active: true,
        ...(propertyId ? { OR: [{ propertyId }, { propertyId: null }] } : {}),
      },
      select: {
        id: true,
        code: true,
        name: true,
        role: true,
        phone: true,
        property: { select: { id: true, name: true } },
        _count: {
          select: { tasks: { where: { status: { in: ['PENDING', 'ACCEPTED', 'IN_PROGRESS'] } } } },
        },
      },
      orderBy: [{ role: 'asc' }, { name: 'asc' }],
    })

    return { staff }
  },
  { roles: ['OWNER', 'MANAGER'] },
)
