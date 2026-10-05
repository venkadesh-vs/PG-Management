import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { ok, parseBody, route } from '@/lib/api-helpers'
import { assertPropertyAccess, ForbiddenError, NotFoundError } from '@/lib/tenancy'
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
  if (user.role === 'WORKER') {
    if (!WORKER_ENTITIES.has(body.entity)) throw new ForbiddenError()
    if ('propertyId' in body && body.propertyId) {
      const staff = await prisma.staff.findUnique({
        where: { id: user.staffId ?? '' },
        select: { propertyId: true },
      })
      if (staff?.propertyId && staff.propertyId !== body.propertyId) {
        throw new ForbiddenError('That PG is not the one you are assigned to')
      }
    }
  } else if (user.role === 'TENANT') {
    throw new ForbiddenError()
  }

  switch (body.entity) {
    // ------------------------------------------------------------ money --
    case 'EXPENSE': {
      await assertPropertyAccess(user, body.propertyId)
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
      if (body.propertyId) await assertPropertyAccess(user, body.propertyId)
      const count = await prisma.staff.count({ where: { organizationId } })

      let userId: string | undefined
      if (body.createLogin && body.email) {
        const created = await prisma.user.create({
          data: {
            organizationId,
            email: body.email.toLowerCase(),
            name: body.name,
            phone: body.phone,
            passwordHash: await hashPassword(`Stay@${body.phone.slice(-4)}`),
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
          staff,
          login: userId ? { email: body.email, password: `Stay@${body.phone.slice(-4)}` } : null,
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
      const date = startOfDay(new Date(body.date))
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
      await prisma.visitor.update({
        where: { id: visitor.id },
        data: { exitAt: new Date() },
      })
      return ok({ message: `${visitor.name} signed out` })
    }

    // ----------------------------------------------------------- assets --
    case 'ASSET': {
      await assertPropertyAccess(user, body.propertyId)
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
      if (body.propertyId) await assertPropertyAccess(user, body.propertyId)

      const announcement = await prisma.announcement.create({
        data: {
          organizationId,
          propertyId: body.audience === 'ALL_PROPERTIES' ? null : body.propertyId || null,
          floorId: body.floorId || null,
          title: body.title,
          body: body.body,
          audience: body.audience,
          pinned: body.pinned,
          sendWhatsapp: body.sendWhatsapp,
          createdById: user.id,
          createdByName: user.name,
        },
      })

      // Resolve the audience into actual residents, then notify each one.
      const residents = await prisma.resident.findMany({
        where: {
          organizationId,
          status: { in: ['ACTIVE', 'NOTICE'] },
          ...(body.audience === 'PROPERTY' && body.propertyId
            ? { propertyId: body.propertyId }
            : {}),
          ...(body.audience === 'FLOOR' && body.floorId ? { room: { floorId: body.floorId } } : {}),
          ...(body.audience === 'SELECTED_RESIDENTS' && body.residentIds?.length
            ? { id: { in: body.residentIds } }
            : {}),
        },
        select: { id: true, fullName: true, phone: true, whatsappPhone: true, userId: true },
      })

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
        propertyId: body.propertyId || null,
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
