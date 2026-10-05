import { prisma } from '@/lib/prisma'
import { route } from '@/lib/api-helpers'
import { assertPropertyAccess, ForbiddenError, hasPermission, resolveScope } from '@/lib/tenancy'

/** GET /api/staff — the org's active staff, for assignment pickers. */
export const GET = route(
  async ({ user, request }) => {
    if (!hasPermission(user, 'staff.view') && !hasPermission(user, 'complaints.assign')) {
      throw new ForbiddenError('Your role does not allow this. Ask the PG owner for access.')
    }
    const url = new URL(request.url)
    const propertyId = url.searchParams.get('propertyId')
    if (propertyId) await assertPropertyAccess(user, propertyId)
    const scope = await resolveScope(user)

    const staff = await prisma.staff.findMany({
      where: {
        organizationId: scope.organizationId,
        active: true,
        // Org-wide staff (no PG) can be assigned anywhere; everyone else only
        // shows up for PGs the caller can see.
        OR: propertyId
          ? [{ propertyId }, { propertyId: null }]
          : [{ propertyId: { in: scope.allowedPropertyIds } }, { propertyId: null }],
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
  { roles: ['OWNER', 'MANAGER'], module: 'staff' },
)
