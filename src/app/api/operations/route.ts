import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { ok, parseBody, route } from '@/lib/api-helpers'
import {
  assertFloorInProperty,
  assertInScope,
  assertPropertyAccess,
  assertResidentInProperty,
  assertRoomInProperty,
  ForbiddenError,
  generatePassword,
  NotFoundError,
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
  expenseSchema,
  groceryItemSchema,
  mealSchema,
  mealServedSchema,
  purchaseSchema,
  staffSchema,
  visitorSchema,
} from '@/lib/validation'
import { notifyResident, recordActivity } from '@/server/events'
import { markMealServed, recordPurchase, upsertMeal } from '@/server/services/kitchen'
import { hashPassword } from '@/lib/password'
import { formatMoney, startOfDay } from '@/lib/utils'
import { sendWhatsApp } from '@/server/integrations/whatsapp'

/**
 * Day-to-day operational writes, grouped behind one endpoint so every module
 * form uses the same auth, scoping and error handling.
 */
const schema = z.discriminatedUnion('entity', [
  z.object({ entity: z.literal('EXPENSE') }).merge(expenseSchema),
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

const WORKER_ENTITIES = new Set(['ATTENDANCE', 'MEAL_SERVED', 'PURCHASE', 'GROCERY_ITEM'])

export const POST = route(async ({ user, request }) => {
  const body = await parseBody(request, schema)
  const organizationId = user.organizationId!
  const actor = { id: user.id, name: user.name }

  // Workers only reach the kitchen, stock and their own attendance. Everything
  // else on this endpoint belongs to an owner or manager.
  // assertPropertyAccess limits a worker to the PG they are assigned to.
  if (user.role === 'WORKER') {
    if (!WORKER_ENTITIES.has(body.entity)) throw new ForbiddenError()
    if ('propertyId' in body && body.propertyId) await assertPropertyAccess(user, body.propertyId)
  } else if (user.role !== 'OWNER' && user.role !== 'MANAGER') {
    throw new ForbiddenError()
  }

  switch (body.entity) {
    // ------------------------------------------------------------ money --
    case 'EXPENSE': {
      requirePermission(user, 'expense:write')
      await assertPropertyAccess(user, body.propertyId)
      const category = await prisma.expenseCategory.findFirst({
        where: { id: body.categoryId, organizationId },
        select: { id: true },
      })
      if (!category) throw new ValidationError('Choose a valid expense category')
      const expense = await prisma.expense.create({
        data: {
          organizationId,
          propertyId: body.propertyId,
          categoryId: body.categoryId,
          title: body.title,
          amount: body.amount,
          spentOn: startOfDay(new Date(body.spentOn)),
          paidTo: body.paidTo || null,
          paymentMode: body.paymentMode,
          reference: body.reference || null,
          notes: body.notes || null,
          recordedBy: user.name,
        },
        include: { category: true },
      })
      await recordActivity({
        organizationId,
        propertyId: body.propertyId,
        actorId: user.id,
        actorName: user.name,
        actorRole: user.role,
        event: 'EXPENSE_CREATED',
        entityType: 'Expense',
        entityId: expense.id,
        summary: `${expense.title} · ${formatMoney(expense.amount)} (${expense.category.name})`,
      })
      return ok(
        { expense, message: `${formatMoney(expense.amount)} expense recorded` },
        { status: 201 },
      )
    }

    // ------------------------------------------------------------ staff --
    case 'STAFF': {
      requirePermission(user, 'staff:write')
      if (body.propertyId) await assertPropertyAccess(user, body.propertyId)
      else if (restrictedPropertyIds(user)) {
        throw new ForbiddenError('Choose one of your PGs for this staff member')
      }
      const wantsLogin = Boolean(body.createLogin && body.email)
      // A login is a credential into the org: owner only.
      if (wantsLogin) requirePermission(user, 'staff:login')
      const count = await prisma.staff.count({ where: { organizationId } })

      let userId: string | undefined
      // Returned exactly once, in this response, so the owner can hand it over.
      let password: string | undefined
      if (wantsLogin && body.email) {
        password = generatePassword()
        const created = await prisma.user.create({
          data: {
            organizationId,
            email: body.email.toLowerCase(),
            name: body.name,
            phone: body.phone,
            passwordHash: await hashPassword(password),
            mustChangePassword: true,
            role: 'WORKER',
            status: 'ACTIVE',
          },
        })
        userId = created.id
      }

      const staff = await prisma.staff.create({
        data: {
          organizationId,
          propertyId: body.propertyId || null,
          userId,
          code: `STF-${String(count + 1).padStart(3, '0')}`,
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
      return ok(
        {
          staff: withMaskedId(staff, user.role),
          login: userId && password ? { email: body.email, password } : null,
          message: `${staff.name} added`,
        },
        { status: 201 },
      )
    }

    case 'ATTENDANCE': {
      // A worker marks their own attendance with the sentinel "self"; an
      // owner or manager marks anyone's.
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
      if (body.roomId) await assertRoomInProperty(body.roomId, body.propertyId)
      const asset = await prisma.asset.create({
        data: {
          organizationId,
          propertyId: body.propertyId,
          roomId: body.roomId || null,
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

      const announcement = await prisma.announcement.create({
        data: {
          organizationId,
          propertyId: announcementPropertyId,
          floorId: body.audience === 'FLOOR' ? body.floorId || null : null,
          title: body.title,
          body: body.body,
          audience: body.audience,
          pinned: body.pinned,
          sendWhatsapp: body.sendWhatsapp,
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
        if (userIds.length) {
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

      if (body.sendWhatsapp) {
        for (const resident of residents) {
          await sendWhatsApp({
            organizationId,
            toName: resident.fullName,
            toPhone: resident.whatsappPhone || resident.phone,
            template: 'announcement',
            body: `📢 ${body.title}\n\n${body.body}`,
            variables: [resident.fullName, body.title],
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
          message: `Announcement sent to ${residents.length} residents`,
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
