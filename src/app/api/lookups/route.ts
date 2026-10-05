import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { parseBody, parseQuery, route } from '@/lib/api-helpers'
import { LOOKUP_TYPES } from '@/lib/permission-catalog'
import { slugify } from '@/lib/utils'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/tenancy'
import { recordActivity } from '@/server/events'
import { ensureOrgDefaults } from '@/server/services/org-defaults'
import { EXPENSE_LOOKUP, toLookupValue, type LookupItem } from '@/components/settings/shared'

const TYPES = new Set([...LOOKUP_TYPES.map((t) => t.type), EXPENSE_LOOKUP])
const type = z.string().refine((t) => TYPES.has(t), 'Unknown list')
const label = z.string().trim().min(1, 'Enter a name').max(60, 'Keep it under 60 characters')

const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('CREATE'), type, label }),
  z.object({ action: z.literal('UPDATE'), type, id: z.string().min(1), label }),
  z.object({ action: z.literal('REORDER'), type, ids: z.array(z.string().min(1)).min(1).max(500) }),
  z.object({ action: z.literal('SET_ACTIVE'), type, id: z.string().min(1), active: z.boolean() }),
  /** Expense categories only, and only while no expense uses it. */
  z.object({ action: z.literal('DELETE'), type, id: z.string().min(1) }),
])

function typeLabel(t: string) {
  return t === EXPENSE_LOOKUP ? 'Expense categories' : (LOOKUP_TYPES.find((l) => l.type === t)?.label ?? t)
}

async function listItems(organizationId: string, t: string): Promise<LookupItem[]> {
  if (t === EXPENSE_LOOKUP) {
    const rows = await prisma.expenseCategory.findMany({
      where: { organizationId },
      orderBy: { name: 'asc' },
      include: { _count: { select: { expenses: true } } },
    })
    return rows.map((r, i) => ({ id: r.id, value: r.slug, label: r.name, sortOrder: i, active: true, usage: r._count.expenses }))
  }
  const rows = await prisma.orgLookup.findMany({
    where: { organizationId, type: t },
    orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
  })
  return rows.map((r) => ({ id: r.id, value: r.value, label: r.label, sortOrder: r.sortOrder, active: r.active }))
}

/** GET /api/lookups?type=COMPLAINT_CATEGORY — one editable dropdown list (all values, active or not). */
export const GET = route(
  async ({ user, request }) => {
    const organizationId = user.organizationId!
    const { type: t } = parseQuery(request, z.object({ type }))
    await ensureOrgDefaults(organizationId)
    return { type: t, items: await listItems(organizationId, t) }
  },
  { roles: ['OWNER', 'MANAGER'], permission: 'settings.manage' },
)

/** POST /api/lookups — add, rename, reorder and switch values on/off. Values stay stable once created. */
export const POST = route(
  async ({ user, request }) => {
    const body = await parseBody(request, schema)
    const organizationId = user.organizationId!
    const t = body.type
    const expense = t === EXPENSE_LOOKUP
    let summary = ''

    switch (body.action) {
      case 'CREATE': {
        if (expense) {
          const clash = await prisma.expenseCategory.findFirst({
            where: { organizationId, name: { equals: body.label, mode: 'insensitive' } },
          })
          if (clash) throw new ConflictError(`“${body.label}” is already in the list`)
          const base = slugify(body.label) || 'category'
          let slug = base
          for (let n = 2; await prisma.expenseCategory.findFirst({ where: { organizationId, slug }, select: { id: true } }); n++) {
            slug = `${base}-${n}`
          }
          await prisma.expenseCategory.create({ data: { organizationId, name: body.label, slug } })
        } else {
          const existing = await prisma.orgLookup.findMany({ where: { organizationId, type: t }, select: { value: true, label: true, sortOrder: true } })
          if (existing.some((e) => e.label.toLowerCase() === body.label.toLowerCase())) {
            throw new ConflictError(`“${body.label}” is already in the list`)
          }
          const taken = new Set(existing.map((e) => e.value))
          const base = toLookupValue(body.label)
          let value = base
          for (let n = 2; taken.has(value); n++) value = `${base}_${n}`
          const sortOrder = existing.reduce((max, e) => Math.max(max, e.sortOrder), -1) + 1
          await prisma.orgLookup.create({ data: { organizationId, type: t, value, label: body.label, sortOrder } })
        }
        summary = `“${body.label}” added to ${typeLabel(t)}`
        break
      }

      case 'UPDATE': {
        if (expense) {
          const row = await prisma.expenseCategory.findFirst({ where: { id: body.id, organizationId } })
          if (!row) throw new NotFoundError('That option no longer exists')
          await prisma.expenseCategory.update({ where: { id: row.id }, data: { name: body.label } })
          summary = `“${row.name}” renamed to “${body.label}” in ${typeLabel(t)}`
        } else {
          const row = await prisma.orgLookup.findFirst({ where: { id: body.id, organizationId, type: t } })
          if (!row) throw new NotFoundError('That option no longer exists')
          await prisma.orgLookup.update({ where: { id: row.id }, data: { label: body.label } })
          summary = `“${row.label}” renamed to “${body.label}” in ${typeLabel(t)}`
        }
        break
      }

      case 'REORDER': {
        if (expense) throw new ValidationError('Expense categories are always shown A to Z')
        const rows = await prisma.orgLookup.findMany({ where: { organizationId, type: t }, select: { id: true } })
        const own = new Set(rows.map((r) => r.id))
        if (body.ids.some((id) => !own.has(id))) throw new ValidationError('The list changed — refresh and try again')
        await prisma.$transaction(body.ids.map((id, i) => prisma.orgLookup.update({ where: { id }, data: { sortOrder: i } })))
        summary = `${typeLabel(t)} reordered`
        break
      }

      case 'SET_ACTIVE': {
        if (expense) throw new ValidationError('Expense categories can be renamed or removed when unused')
        const row = await prisma.orgLookup.findFirst({ where: { id: body.id, organizationId, type: t } })
        if (!row) throw new NotFoundError('That option no longer exists')
        if (!body.active) {
          const activeCount = await prisma.orgLookup.count({ where: { organizationId, type: t, active: true } })
          if (activeCount <= 1 && row.active) throw new ValidationError('Keep at least one option switched on')
        }
        await prisma.orgLookup.update({ where: { id: row.id }, data: { active: body.active } })
        summary = `“${row.label}” ${body.active ? 'brought back' : 'hidden'} in ${typeLabel(t)}`
        break
      }

      case 'DELETE': {
        if (!expense) throw new ValidationError('Options are hidden, not deleted, so old records keep their label')
        const row = await prisma.expenseCategory.findFirst({
          where: { id: body.id, organizationId },
          include: { _count: { select: { expenses: true } } },
        })
        if (!row) throw new NotFoundError('That option no longer exists')
        if (row._count.expenses > 0) {
          throw new ValidationError(`${row._count.expenses} expense${row._count.expenses === 1 ? ' uses' : 's use'} “${row.name}”, so it stays. You can rename it instead.`)
        }
        await prisma.expenseCategory.delete({ where: { id: row.id } })
        summary = `“${row.name}” removed from ${typeLabel(t)}`
        break
      }
    }

    await recordActivity({
      organizationId,
      actorId: user.id,
      actorName: user.name,
      actorRole: user.role,
      event: 'SETTINGS_UPDATED',
      entityType: expense ? 'ExpenseCategory' : 'OrgLookup',
      entityId: 'id' in body ? body.id : undefined,
      summary,
    })

    return { type: t, items: await listItems(organizationId, t), message: summary }
  },
  { roles: ['OWNER', 'MANAGER'], permission: 'settings.manage' },
)
