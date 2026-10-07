import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { parseBody, route } from '@/lib/api-helpers'
import { ALL_PERMISSIONS } from '@/lib/permission-catalog'
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/tenancy'
import { grantProblem, roleEditProblem } from '@/lib/role-guard'
import { recordActivity } from '@/server/events'
import { ensureOrgDefaults } from '@/server/services/org-defaults'
import { ROLE_COLORS } from '@/components/settings/shared'

const KNOWN = new Set(ALL_PERMISSIONS)

const permissions = z
  .array(z.string())
  .max(200)
  .transform((keys) => [...new Set(keys)])
  .refine((keys) => keys.every((k) => KNOWN.has(k)), 'Some of those permissions are not recognised. Refresh and try again.')

const name = z.string().trim().min(2, 'Give the role a name').max(40, 'Keep the name under 40 characters')
const description = z.string().trim().max(200).optional().nullable()
const color = z.enum(ROLE_COLORS).default('blue')
const app = z.enum(['DASHBOARD', 'STAFF_APP'])

const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('CREATE'), name, description, app, color, permissions }),
  z.object({
    action: z.literal('UPDATE'),
    id: z.string().min(1),
    name: name.optional(),
    description,
    app: app.optional(),
    color: z.enum(ROLE_COLORS).optional(),
    permissions: permissions.optional(),
  }),
  z.object({ action: z.literal('DELETE'), id: z.string().min(1), reassignToId: z.string().min(1).optional() }),
])

async function listRoles(organizationId: string) {
  const roles = await prisma.orgRole.findMany({
    where: { organizationId },
    orderBy: [{ app: 'asc' }, { createdAt: 'asc' }],
    include: { _count: { select: { users: { where: { archivedAt: null } } } } },
  })
  return roles.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    app: r.app,
    color: r.color,
    permissions: r.permissions,
    isTemplate: r.isTemplate,
    userCount: r._count.users,
  }))
}

async function assertNameFree(organizationId: string, roleName: string, exceptId?: string) {
  const clash = await prisma.orgRole.findFirst({
    where: { organizationId, name: { equals: roleName, mode: 'insensitive' }, id: exceptId ? { not: exceptId } : undefined },
    select: { id: true },
  })
  if (clash) throw new ConflictError(`You already have a role called “${roleName}”. Pick another name.`)
}

/** GET /api/roles — every role in the organization, with how many people hold it. */
export const GET = route(
  async ({ user }) => {
    const organizationId = user.organizationId!
    await ensureOrgDefaults(organizationId)
    return { roles: await listRoles(organizationId) }
  },
  { roles: ['OWNER', 'MANAGER'], permission: 'team.manage' },
)

/** POST /api/roles — create, edit or delete a role. */
export const POST = route(
  async ({ user, request }) => {
    const body = await parseBody(request, schema)
    const organizationId = user.organizationId!
    const actor = { actorId: user.id, actorName: user.name, actorRole: user.role }
    const deny = (problem: string | null) => {
      if (problem) throw new ForbiddenError(problem)
    }

    if (body.action === 'CREATE') {
      deny(grantProblem(user, body.permissions))
      await assertNameFree(organizationId, body.name)
      const role = await prisma.orgRole.create({
        data: {
          organizationId,
          name: body.name,
          description: body.description || null,
          app: body.app,
          color: body.color,
          permissions: body.permissions,
        },
      })
      await recordActivity({
        organizationId,
        ...actor,
        event: 'SETTINGS_UPDATED',
        entityType: 'OrgRole',
        entityId: role.id,
        summary: `Role “${role.name}” created with ${role.permissions.length} permissions`,
      })
      return { role: { ...role, userCount: 0 }, roles: await listRoles(organizationId), message: `${role.name} is ready` }
    }

    const role = await prisma.orgRole.findFirst({
      where: { id: body.id, organizationId },
      include: { _count: { select: { users: true } } },
    })
    if (!role) throw new NotFoundError('That role no longer exists')

    // Nobody edits or deletes the role they hold — that is how access grows unnoticed.
    if (user.role !== 'OWNER') {
      const self = await prisma.user.findUnique({ where: { id: user.id }, select: { orgRoleId: true } })
      if (self?.orgRoleId === role.id) {
        throw new ForbiddenError('You cannot change your own role. Ask the PG owner.')
      }
    }

    if (body.action === 'UPDATE') {
      deny(roleEditProblem(user, role.permissions, body.permissions ?? role.permissions))
      if (body.name && body.name !== role.name) await assertNameFree(organizationId, body.name, role.id)
      if (body.app && body.app !== role.app && role._count.users > 0) {
        throw new ValidationError(
          `${role._count.users} ${role._count.users === 1 ? 'person has' : 'people have'} this role, so it must stay on the ${
            role.app === 'DASHBOARD' ? 'dashboard' : 'staff app'
          }. Create a new role instead.`,
        )
      }
      const updated = await prisma.orgRole.update({
        where: { id: role.id },
        data: {
          name: body.name,
          description: body.description === undefined ? undefined : body.description || null,
          app: body.app,
          color: body.color,
          permissions: body.permissions,
        },
      })
      await recordActivity({
        organizationId,
        ...actor,
        event: 'SETTINGS_UPDATED',
        entityType: 'OrgRole',
        entityId: role.id,
        summary: `Role “${updated.name}” updated${body.permissions ? ` (${updated.permissions.length} permissions)` : ''}`,
      })
      return { roles: await listRoles(organizationId), message: `${updated.name} saved` }
    }

    // DELETE — never strand people without a role.
    deny(roleEditProblem(user, role.permissions, []))
    if (role._count.users > 0) {
      if (!body.reassignToId) {
        throw new ValidationError(
          `${role._count.users} ${role._count.users === 1 ? 'person still has' : 'people still have'} this role. Move them to another role first.`,
        )
      }
      const target = await prisma.orgRole.findFirst({
        where: { id: body.reassignToId, organizationId },
        select: { id: true, app: true, name: true, permissions: true },
      })
      if (!target || target.id === role.id) throw new ValidationError('Choose another role to move them to')
      if (target.app !== role.app) throw new ValidationError(`Choose a ${role.app === 'DASHBOARD' ? 'dashboard' : 'staff app'} role to move them to`)
      deny(roleEditProblem(user, role.permissions, target.permissions))
      await prisma.$transaction([
        prisma.user.updateMany({ where: { organizationId, orgRoleId: role.id }, data: { orgRoleId: target.id } }),
        prisma.orgRole.delete({ where: { id: role.id } }),
      ])
    } else {
      await prisma.orgRole.delete({ where: { id: role.id } })
    }
    await recordActivity({
      organizationId,
      ...actor,
      event: 'SETTINGS_UPDATED',
      entityType: 'OrgRole',
      entityId: role.id,
      summary: `Role “${role.name}” deleted`,
    })
    return { roles: await listRoles(organizationId), message: `${role.name} deleted` }
  },
  { roles: ['OWNER', 'MANAGER'], permission: 'team.manage' },
)
