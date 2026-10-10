import { z } from 'zod'
import { assertLookupValue } from '@/server/services/org-defaults'
import { createExpense, expenseInputSchema } from '@/server/services/expenses'
import { resolveAssetLocation } from '@/server/services/assets'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { ok, parseBody, route } from '@/lib/api-helpers'
import {
  assertFloorInProperty,
  assertInScope,
  assertPropertyAccess,
  assertResidentInProperty,
  ForbiddenError,
  NotFoundError,
  requireModule,
  requirePermission,
  resolveScope,
  restrictedPropertyIds,
  ValidationError,
  withMaskedId,
} from '@/lib/tenancy'
import {
  announcementSchema,
  assetSchema,
  attendanceSchema,
  groceryItemSchema,
  mealSchema,
  mealServedSchema,
  purchaseSchema,
  staffSchema,
  visitorSchema,
} from '@/lib/validation'
import { notifyResident, recordActivity } from '@/server/events'
import { markMealServed, recordPurchase, upsertMeal } from '@/server/services/kitchen'
import { startOfDay } from '@/lib/utils'
import { sendWhatsApp } from '@/server/integrations/whatsapp'
import { channelEnabled } from '@/server/services/notification-settings'
import { createWorkerLogin, sendAccessLink } from '@/server/services/accounts'
import { assertWithinPlan } from '@/server/services/plan-limits'
import type { ModuleKey } from '@/lib/modules'
import { grantProblem } from '@/lib/role-guard'

/**
 * Day-to-day operational writes, grouped behind one endpoint so every module
 * form uses the same auth, scoping and error handling.
 */
const schema = z.discriminatedUnion('entity', [
  z.object({ entity: z.literal('EXPENSE') }).merge(expenseInputSchema),
  z.object({ entity: z.literal('STAFF') }).merge(staffSchema),
  z.object({ entity: z.literal('ATTENDANCE') }).merge(attendanceSchema),
  z.object({ entity: z.literal('VISITOR') }).merge(visitorSchema),
  z.object({ entity: z.literal('VISITOR_EXIT'), visitorId: z.string().min(1) }),
  z.object({ entity: z.literal('ASSET') }).merge(assetSchema),
  z.object({ entity: z.literal('ANNOUNCEMENT') }).merge(announcementSchema),
  z.object({ entity: z.literal('MEAL') }).merge(mealSchema),
  z.object({ entity: z.literal('MEAL_SERVED') }).merge(mealServedSchema),
  z.object({ entity: z.literal('GROCERY_ITEM') }).merge(groceryItemSchema),
  z.object({ entity: z.literal('PURCHASE') }).merge(purchaseSchema),
])

const WORKER_ENTITIES = new Set(['ATTENDANCE', 'MEAL_SERVED', 'PURCHASE', 'GROCERY_ITEM', 'EXPENSE'])

/** Staff record what they bought with the narrower expenses.add (owner approves each). */
const WORKER_PERMISSION: Partial<Record<Entity, string>> = { EXPENSE: 'expenses.add' }

type Entity = z.infer<typeof schema>['entity']

/**
 * The module each entity belongs to and the catalog permission it needs.
 * ATTENDANCE is decided per caller below (self vs anyone).
 */
const ENTITY_ACCESS: Record<Entity, { module: ModuleKey; permission: string | null }> = {
  EXPENSE: { module: 'expenses', permission: 'expenses.manage' },
  STAFF: { module: 'staff', permission: 'staff.manage' },
  ATTENDANCE: { module: 'staff', permission: null },
  VISITOR: { module: 'visitors', permission: 'visitors.manage' },
  VISITOR_EXIT: { module: 'visitors', permission: 'visitors.manage' },
  ASSET: { module: 'inventory', permission: 'inventory.manage' },
  ANNOUNCEMENT: { module: 'announcements', permission: 'announcements.send' },
  MEAL: { module: 'food', permission: 'food.manage' },
  MEAL_SERVED: { module: 'food', permission: 'food.manage' },
  GROCERY_ITEM: { module: 'grocery', permission: 'grocery.manage' },
  PURCHASE: { module: 'grocery', permission: 'grocery.manage' },
}

export const POST = route(async ({ user, request }) => {
  // Check the feature and permission before validating the form, so someone
  // whose module is off hears that, not "Category is required".
  const peek = (await request.clone().json().catch(() => null)) as { entity?: string } | null
  const early = peek?.entity ? ENTITY_ACCESS[peek.entity as keyof typeof ENTITY_ACCESS] : undefined
  if (early) {
    requireModule(user, early.module)
    if (early.permission && user.role !== 'WORKER') requirePermission(user, early.permission)
    const workerPermission = WORKER_PERMISSION[peek!.entity as Entity]
    if (user.role === 'WORKER' && workerPermission) requirePermission(user, workerPermission)
  }
  const body = await parseBody(request, schema)
  const organizationId = user.organizationId!
  const actor = { id: user.id, name: user.name }

  // Workers only reach the kitchen, stock and their own attendance. Everything
  // else on this endpoint belongs to an owner or manager.
  // assertPropertyAccess limits a worker to the PG they are assigned to.
  if (user.role === 'WORKER') {
    requireModule(user, 'staffApp')
    if (!WORKER_ENTITIES.has(body.entity)) throw new ForbiddenError()
    if ('propertyId' in body && body.propertyId) await assertPropertyAccess(user, body.propertyId)
  } else if (user.role !== 'OWNER' && user.role !== 'MANAGER') {
    throw new ForbiddenError()
  }
  const access = ENTITY_ACCESS[body.entity]
  requireModule(user, access.module)
  const permission = user.role === 'WORKER' ? (WORKER_PERMISSION[body.entity] ?? access.permission) : access.permission
  if (permission) requirePermission(user, permission)

  switch (body.entity) {
    // ------------------------------------------------------------ money --
    case 'EXPENSE': {
      // Bill no., attachment, recurrence and approval live in the expenses service.
      const { expense, message } = await createExpense(user, body)
      return ok({ expense, message }, { status: 201 })
    }

    // ------------------------------------------------------------ staff --
    case 'STAFF': {
      if (body.propertyId) await assertPropertyAccess(user, body.propertyId)
      else if (restrictedPropertyIds(user)) {
        throw new ForbiddenError('Choose one of your PGs for this staff member')
      }
      await assertLookupValue(organizationId, 'STAFF_ROLE', body.role)
      await assertWithinPlan(organizationId, 'staff')
      const wantsLogin = Boolean(body.createLogin)
      // A login is a credential into the org: it needs team.manage.
      if (wantsLogin) requirePermission(user, 'team.manage')
      // The login's staff-app role: the one chosen, else the org's
      // Housekeeping role (null falls back to the built-in worker template).
      let orgRoleId: string | null = null
      if (wantsLogin) {
        if (body.orgRoleId) {
          const role = await prisma.orgRole.findFirst({
            where: { id: body.orgRoleId, organizationId, app: 'STAFF_APP' },
            select: { id: true, permissions: true },
          })
          if (!role) throw new ValidationError('Choose a staff-app role for this login')
          // Non-owners may only hand out access they hold themselves.
          const problem = grantProblem(user, role.permissions)
          if (problem) throw new ForbiddenError(problem)
          orgRoleId = role.id
        } else {
          const role = await prisma.orgRole.findFirst({
            where: { organizationId, name: 'Housekeeping', app: 'STAFF_APP' },
            select: { id: true },
          })
          orgRoleId = role?.id ?? null
        }
      }
      const count = await prisma.staff.count({ where: { organizationId } })
      const code = `STF-${String(count + 1).padStart(3, '0')}`

      // The login gets an unusable password; the worker sets their own from
      // an invite link (WhatsApp/email, and shown to the owner to share).
      let userId: string | undefined
      if (wantsLogin) {
        const org = await prisma.organization.findUniqueOrThrow({
          where: { id: organizationId },
          select: { slug: true },
        })
        userId = await createWorkerLogin({
          organizationId,
          orgSlug: org.slug,
          code,
          name: body.name,
          phone: body.phone,
          email: body.email || null,
        })
        if (orgRoleId) await prisma.user.update({ where: { id: userId }, data: { orgRoleId } })
      }

      const staff = await prisma.staff.create({
        data: {
          organizationId,
          propertyId: body.propertyId || null,
          userId,
          code,
          name: body.name,
          role: body.role,
          phone: body.phone,
          email: body.email || null,
          joiningDate: startOfDay(new Date(body.joiningDate)),
          salary: body.salary ?? 0,
          address: body.address || null,
          idNumber: body.idNumber || null,
        },
      })
      await recordActivity({
        organizationId,
        propertyId: body.propertyId || null,
        actorId: user.id,
        actorName: user.name,
        actorRole: user.role,
        event: 'STAFF_CREATED',
        entityType: 'Staff',
        entityId: staff.id,
        summary: `${staff.name} added as ${staff.role.replace('_', ' ').toLowerCase()}`,
      })
      const login = userId
        ? await sendAccessLink(userId, { phone: staff.phone }).catch((error: unknown) => {
            console.error('[staff] invite failed', error)
            return null
          })
        : null
      return ok(
        {
          staff: withMaskedId(staff, user.role),
          login,
          message: login
            ? `${staff.name} added — login link ${login.sentVia.length ? 'sent' : 'ready to share'}`
            : `${staff.name} added`,
        },
        { status: 201 },
      )
    }

    case 'ATTENDANCE': {
      // A worker marks their own attendance with the sentinel "self"
      // (attendance.self); staff.manage marks anyone's.
      requirePermission(user, user.role === 'WORKER' ? 'attendance.self' : 'staff.manage')
      const staffId =
        body.staffId === 'self' && user.role === 'WORKER' ? (user.staffId ?? '') : body.staffId
      if (user.role === 'WORKER' && staffId !== user.staffId) {
        throw new ForbiddenError('You can only mark your own attendance')
      }
      const staff = await prisma.staff.findFirst({
        where: { id: staffId, organizationId },
      })
      if (!staff) throw new NotFoundError('Staff member not found')
      if (user.role !== 'WORKER') {
        assertInScope(user, staff.propertyId, 'That staff member is not at one of your PGs')
      }
      const date = startOfDay(new Date(body.date))
      if (Number.isNaN(date.getTime())) throw new ValidationError('Choose a valid date')
      // Workers check in for today only; back- or future-dating is a manager's job.
      if (user.role === 'WORKER' && date.getTime() !== startOfDay(new Date()).getTime()) {
        throw new ForbiddenError('You can only mark attendance for today')
      }
      const attendance = await prisma.staffAttendance.upsert({
        where: { staffId_date: { staffId: staff.id, date } },
        create: {
          staffId: staff.id,
          date,
          status: body.status,
          notes: body.notes || null,
          checkIn: body.status === 'PRESENT' || body.status === 'LATE' ? new Date() : null,
        },
        update: { status: body.status, notes: body.notes || null },
      })
      return ok({ attendance, message: `${staff.name} marked ${body.status.toLowerCase()}` })
    }

    // --------------------------------------------------------- visitors --
    case 'VISITOR': {
      await assertPropertyAccess(user, body.propertyId)
      await assertLookupValue(organizationId, 'VISITOR_PURPOSE', body.purpose)
      if (body.residentId) {
        await assertResidentInProperty(body.residentId, organizationId, body.propertyId)
      }
      const visitor = await prisma.visitor.create({
        data: {
          organizationId,
          propertyId: body.propertyId,
          residentId: body.residentId || null,
          name: body.name,
          phone: body.phone || null,
          purpose: body.purpose,
          relation: body.relation || null,
          idProof: body.idProof || null,
          notes: body.notes || null,
          recordedBy: user.name,
        },
      })
      await recordActivity({
        organizationId,
        propertyId: body.propertyId,
        actorId: user.id,
        actorName: user.name,
        actorRole: user.role,
        event: 'VISITOR_LOGGED',
        entityType: 'Visitor',
        entityId: visitor.id,
        summary: `${visitor.name} signed in — ${visitor.purpose}`,
      })
      if (body.residentId) {
        await notifyResident(body.residentId, {
          organizationId,
          kind: 'SYSTEM',
          type: 'VISITOR',
          title: 'You have a visitor',
          body: `${visitor.name} has signed in at the entrance.`,
          link: '/tenant',
        })
      }
      return ok({ visitor, message: `${visitor.name} signed in` }, { status: 201 })
    }

    case 'VISITOR_EXIT': {
      const visitor = await prisma.visitor.findFirst({
        where: { id: body.visitorId, organizationId },
      })
      if (!visitor) throw new NotFoundError('Visitor not found')
      assertInScope(user, visitor.propertyId)
      await prisma.visitor.update({
        where: { id: visitor.id },
        data: { exitAt: new Date() },
      })
      return ok({ message: `${visitor.name} signed out` })
    }

    // ----------------------------------------------------------- assets --
    case 'ASSET': {
      await assertPropertyAccess(user, body.propertyId)
      // Floor / room / bed, each checked against the PG.
      const where = (await resolveAssetLocation(body.propertyId, {
        placement: body.placement,
        roomId: body.roomId,
      })) ?? { floorId: null, roomId: null, bedId: null }
      const asset = await prisma.asset.create({
        data: {
          organizationId,
          propertyId: body.propertyId,
          ...where,
          status: body.status ?? (body.condition === 'DISPOSED' ? 'DISPOSED' : 'IN_USE'),
          currentValue: body.currentValue === '' || body.currentValue === undefined ? null : body.currentValue,
          name: body.name,
          category: body.category,
          quantity: body.quantity,
          condition: body.condition,
          location: body.location || null,
          purchaseDate: body.purchaseDate ? new Date(body.purchaseDate) : null,
          purchaseCost: body.purchaseCost ?? 0,
          serialNumber: body.serialNumber || null,
          notes: body.notes || null,
        },
      })
      return ok({ asset, message: `${asset.name} added to inventory` }, { status: 201 })
    }

    // ---------------------------------------------------- announcements --
    case 'ANNOUNCEMENT': {
      // Resolve the audience into a resident filter up front. An audience
      // whose selector is missing is an error, never a fall-through to every
      // resident in the org.
      let audienceWhere: Prisma.ResidentWhereInput | null = null
      let announcementPropertyId: string | null = body.propertyId || null
      switch (body.audience) {
        case 'ALL_PROPERTIES': {
          if (restrictedPropertyIds(user)) {
            throw new ForbiddenError('You can only announce to the PGs you manage')
          }
          announcementPropertyId = null
          audienceWhere = {}
          break
        }
        case 'PROPERTY': {
          if (!body.propertyId) throw new ValidationError('Choose a PG for this announcement')
          await assertPropertyAccess(user, body.propertyId)
          audienceWhere = { propertyId: body.propertyId }
          break
        }
        case 'FLOOR': {
          if (!body.floorId) throw new ValidationError('Choose a floor for this announcement')
          const floor = await prisma.floor.findFirst({
            where: { id: body.floorId, property: { organizationId } },
            select: { propertyId: true },
          })
          if (!floor) throw new ValidationError('That floor is not in your organization')
          await assertPropertyAccess(user, floor.propertyId)
          if (body.propertyId) await assertFloorInProperty(body.floorId, body.propertyId)
          announcementPropertyId = floor.propertyId
          audienceWhere = { propertyId: floor.propertyId, room: { floorId: body.floorId } }
          break
        }
        case 'SELECTED_RESIDENTS': {
          const ids = [...new Set(body.residentIds ?? [])]
          if (!ids.length) throw new ValidationError('Choose at least one resident')
          if (body.propertyId) await assertPropertyAccess(user, body.propertyId)
          const scope = await resolveScope(user, body.propertyId)
          const inScopeWhere = {
            id: { in: ids },
            organizationId,
            propertyId: scope.propertyId ?? { in: scope.allowedPropertyIds },
          }
          const visible = await prisma.resident.count({ where: inScopeWhere })
          if (visible !== ids.length) {
            throw new ValidationError('Some of the chosen residents are not in your PGs')
          }
          audienceWhere = inScopeWhere
          break
        }
        case 'STAFF': {
          // A staff notice reaches no residents.
          if (body.propertyId) await assertPropertyAccess(user, body.propertyId)
          else if (restrictedPropertyIds(user)) {
            throw new ForbiddenError('Choose one of your PGs for this announcement')
          }
          audienceWhere = null
          break
        }
      }

      // The WhatsApp copy is ignored while the WhatsApp module is off.
      const sendWhatsapp = body.sendWhatsapp && user.modules.includes('whatsapp')
      const announcement = await prisma.announcement.create({
        data: {
          organizationId,
          propertyId: announcementPropertyId,
          floorId: body.audience === 'FLOOR' ? body.floorId || null : null,
          title: body.title,
          body: body.body,
          audience: body.audience,
          pinned: body.pinned,
          sendWhatsapp: sendWhatsapp,
          createdById: user.id,
          createdByName: user.name,
        },
      })

      const residents = audienceWhere
        ? await prisma.resident.findMany({
            where: {
              ...audienceWhere,
              organizationId,
              status: { in: ['ACTIVE', 'NOTICE'] },
            },
            select: { id: true, fullName: true, phone: true, whatsappPhone: true, userId: true },
          })
        : []

      if (residents.length) {
        await prisma.announcementTarget.createMany({
          data: residents.map((r) => ({ announcementId: announcement.id, residentId: r.id })),
          skipDuplicates: true,
        })
        const userIds = residents.map((r) => r.userId).filter((id): id is string => Boolean(id))
        if (userIds.length && (await channelEnabled(organizationId, 'ANNOUNCEMENT', 'IN_APP'))) {
          await prisma.notification.createMany({
            data: userIds.map((userId) => ({
              userId,
              organizationId,
              kind: 'ANNOUNCEMENT' as const,
              title: body.title,
              body: body.body.slice(0, 180),
              link: '/tenant/announcements',
            })),
          })
        }
      }

      // Announcements switched off for WhatsApp in Settings → Notifications.
      const whatsappSwitchedOff = sendWhatsapp && !(await channelEnabled(organizationId, 'ANNOUNCEMENT', 'WHATSAPP'))
      if (sendWhatsapp && !whatsappSwitchedOff) {
        for (const resident of residents) {
          await sendWhatsApp({
            organizationId,
            toName: resident.fullName,
            toPhone: resident.whatsappPhone || resident.phone,
            template: 'announcement',
            body: `📢 ${body.title}\n\n${body.body}`,
            // Meta templates take no free text, so the notice itself is {{3}}.
            variables: [resident.fullName, body.title, body.body],
            refType: 'Announcement',
            refId: announcement.id,
          }).catch(() => undefined)
        }
      }

      await recordActivity({
        organizationId,
        propertyId: announcementPropertyId,
        actorId: user.id,
        actorName: user.name,
        actorRole: user.role,
        event: 'ANNOUNCEMENT_SENT',
        entityType: 'Announcement',
        entityId: announcement.id,
        summary: `${body.title} — sent to ${residents.length} residents`,
      })

      return ok(
        {
          announcement,
          reached: residents.length,
          message: `Announcement sent to ${residents.length} residents${
            whatsappSwitchedOff ? ' — no WhatsApp copy: announcements are switched off for WhatsApp in Settings → Notifications' : ''
          }`,
        },
        { status: 201 },
      )
    }

    // ---------------------------------------------------------- kitchen --
    case 'MEAL': {
      await assertPropertyAccess(user, body.propertyId)
      const meal = await upsertMeal({
        organizationId,
        propertyId: body.propertyId,
        date: new Date(body.date),
        type: body.type,
        menu: body.menu,
        notes: body.notes || undefined,
        actor,
      })
      return ok({
        meal,
        message: `${body.type.toLowerCase()} menu saved — ${meal.expectedCount} expected`,
      })
    }

    case 'MEAL_SERVED': {
      const meal = await prisma.meal.findFirst({
        where: { id: body.mealId, organizationId },
      })
      if (!meal) throw new NotFoundError('Meal not found')
      // Workers: the PG they are assigned to. Managers: their PGs.
      await assertPropertyAccess(user, meal.propertyId)
      const updated = await markMealServed({
        mealId: meal.id,
        actualCount: body.actualCount,
        preparedBy: user.name,
      })
      return ok({
        meal: updated,
        message: `${body.actualCount} meals served — stock updated`,
      })
    }

    // ---------------------------------------------------------- grocery --
    case 'GROCERY_ITEM': {
      await assertPropertyAccess(user, body.propertyId)
      const item = await prisma.groceryItem.upsert({
        where: { propertyId_name: { propertyId: body.propertyId, name: body.name } },
        create: {
          organizationId,
          propertyId: body.propertyId,
          name: body.name,
          category: body.category,
          unit: body.unit,
          currentStock: body.currentStock,
          minimumStock: body.minimumStock,
          perResidentPerMeal: body.perResidentPerMeal,
          vendor: body.vendor || null,
        },
        update: {
          category: body.category,
          unit: body.unit,
          currentStock: body.currentStock,
          minimumStock: body.minimumStock,
          perResidentPerMeal: body.perResidentPerMeal,
          vendor: body.vendor || null,
        },
      })
      return ok({ item, message: `${item.name} saved` })
    }

    case 'PURCHASE': {
      await assertPropertyAccess(user, body.propertyId)
      const result = await recordPurchase({
        organizationId,
        propertyId: body.propertyId,
        groceryItemId: body.groceryItemId,
        quantity: body.quantity,
        unitPrice: body.unitPrice,
        vendor: body.vendor || undefined,
        purchaseDate: new Date(body.purchaseDate),
        invoiceRef: body.invoiceRef || undefined,
        createExpense: body.createExpense,
        actor,
      })
      return ok(
        {
          purchase: result.purchase,
          message: `Purchase recorded — stock updated${result.expenseId ? ' and expense added' : ''}`,
        },
        { status: 201 },
      )
    }
  }
})
