import 'server-only'

import { Prisma } from '@prisma/client'
import type { ElectricityMeter, MeterReading, Property, Room } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import type { SessionUser } from '@/lib/auth'
import {
  assertInScope,
  ConflictError,
  ForbiddenError,
  hasPermission,
  NotFoundError,
  resolveScope,
  ValidationError,
} from '@/lib/tenancy'
import {
  billingMonthLabel,
  computeRoomBill,
  ElectricityError,
  isBillingMode,
  isSplitMethod,
  monthKeyOf,
  monthStart,
  shareLabel,
  toPaise,
  toTenths,
  type BillingMode,
  type Leave,
  type RoomBillResult,
  type SplitMethod,
  type Stay,
} from '@/lib/electricity'
import { formatDate, formatMoney, startOfDay, startOfMonth } from '@/lib/utils'
import { recordActivity } from '../events'
import { appendLedger, applyAdvanceToInvoice, nextInvoiceNumber } from './billing'

/**
 * Room electricity sub-meters.
 *
 * Every room can have one active meter. Readings are recorded per meter; a
 * room's bill covers the time between two readings, priced at the rate in
 * force for the billing month, and is shared by the people who actually lived
 * in the room in that time (from the bed-allocation history), never by beds.
 *
 * Generate → review (DRAFT) → finalize. Finalizing freezes the readings, rate,
 * occupancy and shares on the bill and turns each share into a one-time
 * ResidentCharge, which the normal rent invoice (or the checkout settlement)
 * picks up. Later rate or occupancy changes never touch a finalized bill.
 */

type Tx = Prisma.TransactionClient
type Db = Tx | typeof prisma
type Actor = { id?: string; name: string }

const READING_FILE = /^\/api\/uploads\/[A-Za-z0-9_-]{6,64}$/
const dateText = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}/, 'Pick a date')
const monthText = z.string().trim().regex(/^\d{4}-\d{2}$/, 'Choose the month (YYYY-MM)')
const readingValue = z.union([z.number(), z.string().trim().min(1)]).transform((v, ctx) => {
  try {
    toTenths(v)
    return String(v)
  } catch (e) {
    ctx.addIssue({ code: 'custom', message: e instanceof Error ? e.message : 'Enter the meter reading' })
    return z.NEVER
  }
})
const rateValue = z.union([z.number(), z.string().trim().min(1)]).transform((v, ctx) => {
  try {
    toPaise(v)
    return String(v)
  } catch (e) {
    ctx.addIssue({ code: 'custom', message: e instanceof Error ? e.message : 'Enter the rate per unit' })
    return z.NEVER
  }
})

// ------------------------------------------------------------------ schemas

export const meterCreateSchema = z.object({
  propertyId: z.string().min(1),
  roomId: z.string().min(1, 'Choose the room'),
  meterNumber: z.string().trim().min(1, 'Enter the meter number').max(40),
  installedOn: dateText,
  initialReading: readingValue,
  notes: z.string().trim().max(300).optional().or(z.literal('')),
  /** Replace the room's current active meter (it becomes REPLACED). */
  replaceExisting: z.boolean().optional(),
})

/** Many rooms at once: the one-screen meter setup. */
export const bulkMeterSchema = z.object({
  action: z.literal('BULK'),
  propertyId: z.string().min(1),
  installedOn: dateText,
  meters: z
    .array(
      z.object({
        roomId: z.string().min(1),
        meterNumber: z.string().trim().min(1, 'Enter the meter number').max(40),
        initialReading: readingValue,
      }),
    )
    .min(1, 'Tick at least one room')
    .max(500),
})

export const meterUpdateSchema = z.object({
  meterId: z.string().min(1),
  meterNumber: z.string().trim().min(1).max(40).optional(),
  status: z.enum(['ACTIVE', 'FAULTY']).optional(),
  notes: z.string().trim().max(300).nullable().optional(),
})

export const rateCreateSchema = z.object({
  propertyId: z.string().min(1),
  effectiveFrom: monthText,
  ratePerUnit: rateValue,
  note: z.string().trim().max(200).optional().or(z.literal('')),
})

export const readingSchema = z.object({
  meterId: z.string().min(1),
  readingDate: dateText,
  value: readingValue,
  photoUrl: z.string().trim().regex(READING_FILE, 'Attach the photo again').optional().or(z.literal('')),
  note: z.string().trim().max(200).optional().or(z.literal('')),
})

const billReading = z.object({
  meterId: z.string().min(1),
  value: readingValue,
  readingDate: dateText.optional(),
  photoUrl: z.string().trim().regex(READING_FILE, 'Attach the photo again').optional().or(z.literal('')),
  /** Bill the room with nobody charged (empty room, or the owner pays). */
  ownerAbsorbs: z.boolean().optional(),
})

export const billActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('PREVIEW'),
    propertyId: z.string().min(1),
    billingMonth: monthText,
    readingDate: dateText.optional(),
    /** Optional: use this rate instead of the PG's rate for the month. */
    ratePerUnit: rateValue.optional(),
    readings: z.array(billReading).min(1, 'Enter at least one meter reading').max(500),
  }),
  z.object({
    action: z.literal('GENERATE'),
    propertyId: z.string().min(1),
    billingMonth: monthText,
    readingDate: dateText.optional(),
    ratePerUnit: rateValue.optional(),
    readings: z.array(billReading).min(1, 'Enter at least one meter reading').max(500),
  }),
  z.object({ action: z.literal('FINALIZE'), billIds: z.array(z.string().min(1)).min(1).max(500) }),
  z.object({
    action: z.literal('VOID'),
    billId: z.string().min(1),
    reason: z.string().trim().min(3, 'Say why this bill is being voided').max(300),
  }),
])

export const settingsSchema = z.object({
  electricitySplitMethod: z.enum(['DAYS_STAYED', 'EQUAL_PRESENT']).optional(),
  electricityBillingMode: z.enum(['NEXT_RENT_INVOICE', 'SEPARATE_INVOICE']).optional(),
  electricityExcludeLeaveDays: z.boolean().optional(),
})

// ------------------------------------------------------------------ helpers

const dec = (v: Prisma.Decimal | number | string) => Number(String(v))

function parseDate(text: string): Date {
  const [y, m, d] = text.slice(0, 10).split('-').map(Number)
  const date = new Date(y, m - 1, d)
  if (Number.isNaN(date.getTime())) throw new ValidationError('Pick a valid date')
  return date
}

function actorOf(user: SessionUser): Actor {
  return { id: user.id, name: user.name }
}

function requireReadings(user: SessionUser) {
  if (!hasPermission(user, 'electricity.readings') && !hasPermission(user, 'electricity.manage')) {
    throw new ForbiddenError('Your role does not allow entering meter readings. Ask the PG owner for access.')
  }
}

function toValidation<T>(fn: () => T): T {
  try {
    return fn()
  } catch (e) {
    if (e instanceof ElectricityError) throw new ValidationError(e.message)
    throw e
  }
}

export async function electricitySettings(organizationId: string, db: Db = prisma) {
  const s = await db.orgSetting.findUnique({
    where: { organizationId },
    select: { electricitySplitMethod: true, electricityBillingMode: true, electricityExcludeLeaveDays: true },
  })
  return {
    splitMethod: (isSplitMethod(s?.electricitySplitMethod) ? s!.electricitySplitMethod : 'DAYS_STAYED') as SplitMethod,
    billingMode: (isBillingMode(s?.electricityBillingMode) ? s!.electricityBillingMode : 'NEXT_RENT_INVOICE') as BillingMode,
    excludeLeaveDays: Boolean(s?.electricityExcludeLeaveDays),
  }
}

async function loadMeter(db: Db, organizationId: string, meterId: string) {
  const meter = await db.electricityMeter.findFirst({
    where: { id: meterId, organizationId },
    include: { room: true, property: true },
  })
  if (!meter) throw new NotFoundError('Meter not found')
  return meter
}

/** The rate for a month: the newest row effective on or before it. */
export async function rateFor(db: Db, propertyId: string, month: Date) {
  return db.electricityRate.findFirst({
    where: { propertyId, effectiveFrom: { lte: startOfMonth(month) } },
    orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
  })
}

/** Who lived in the room, and when (bed-allocation history), overlapping a period. */
async function roomStays(db: Db, roomId: string, periodStart: Date, periodEnd: Date) {
  const rows = await db.bedAllocation.findMany({
    where: {
      bed: { roomId },
      fromDate: { lt: periodEnd },
      OR: [{ toDate: null }, { toDate: { gt: periodStart } }],
    },
    select: {
      residentId: true,
      fromDate: true,
      toDate: true,
      bed: { select: { label: true } },
      resident: { select: { fullName: true, status: true } },
    },
    orderBy: { fromDate: 'asc' },
  })
  const stays: Stay[] = rows.map((r) => ({ residentId: r.residentId, from: r.fromDate, to: r.toDate }))
  const info = new Map<string, { name: string; bed: string | null; checkedOut: boolean }>()
  for (const r of rows) {
    info.set(r.residentId, {
      name: r.resident.fullName,
      bed: r.bed.label,
      checkedOut: r.resident.status === 'CHECKED_OUT',
    })
  }
  return { stays, info }
}

async function approvedLeaves(db: Db, residentIds: string[], periodStart: Date, periodEnd: Date): Promise<Leave[]> {
  if (!residentIds.length) return []
  const rows = await db.residentRequest.findMany({
    where: {
      residentId: { in: residentIds },
      kind: 'LEAVE',
      status: { in: ['APPROVED', 'DONE'] },
      fromDate: { lt: periodEnd },
      toDate: { gte: periodStart },
    },
    select: { residentId: true, fromDate: true, toDate: true },
  })
  return rows.flatMap((r) => (r.fromDate && r.toDate ? [{ residentId: r.residentId, from: r.fromDate, to: r.toDate }] : []))
}

type MeterWithRoom = ElectricityMeter & { room: Room; property: Property }

export type RoomBillDraft = {
  meterId: string
  meterNumber: string
  roomId: string
  roomNumber: string
  propertyId: string
  billingMonth: string
  periodStart: Date
  periodEnd: Date
  previousReadingId: string | null
  previousReading: number
  currentReading: number
  units: number
  ratePerUnit: number
  rateId: string | null
  amount: number
  splitMethod: SplitMethod
  occupantCount: number
  periodDays: number
  ownerAbsorbed: boolean
  shares: {
    residentId: string
    residentName: string
    bedLabel: string | null
    daysStayed: number
    weight: number
    share: number
    collectible: boolean
  }[]
  uncollectedAmount: number
  warnings: string[]
}

/**
 * Works out one room's bill from a new reading, without saving anything.
 * Throws ValidationError with a clear reason when it cannot be billed.
 */
async function draftFor(
  db: Db,
  params: {
    meter: MeterWithRoom
    currentValue: string
    currentDate: Date
    billingMonth: string
    rateOverride?: string
    ownerAbsorbs?: boolean
    kind: 'REGULAR' | 'INTERIM'
    settings: Awaited<ReturnType<typeof electricitySettings>>
    /** Reading row to ignore as "previous" (when re-using a same-day reading). */
    excludeReadingId?: string
  },
): Promise<RoomBillDraft> {
  const { meter } = params
  const room = `Room ${meter.room.number}`
  if (meter.status !== 'ACTIVE') {
    throw new ValidationError(`${room}: meter ${meter.meterNumber} is ${meter.status.toLowerCase()}. Add or reactivate a meter first.`)
  }

  const previous = await db.meterReading.findFirst({
    where: {
      meterId: meter.id,
      readingDate: { lt: params.currentDate },
      ...(params.excludeReadingId ? { id: { not: params.excludeReadingId } } : {}),
    },
    orderBy: { readingDate: 'desc' },
  })
  if (!previous) {
    throw new ValidationError(`${room}: there is no earlier reading for meter ${meter.meterNumber}. Record its starting reading first.`)
  }

  // A later reading already billed means this date sits inside a billed period.
  const laterBilled = await db.roomElectricityBill.findFirst({
    where: { meterId: meter.id, status: { not: 'VOID' }, periodEnd: { gt: params.currentDate }, periodStart: { lt: params.currentDate } },
    select: { billingMonth: true },
  })
  if (laterBilled) {
    throw new ConflictError(`${room}: ${formatDate(params.currentDate)} falls inside a period already billed (${billingMonthLabel(laterBilled.billingMonth)}).`)
  }
  const samePeriod = await db.roomElectricityBill.findFirst({
    where: { meterId: meter.id, status: { not: 'VOID' }, periodStart: previous.readingDate, periodEnd: params.currentDate },
    select: { status: true },
  })
  if (samePeriod) {
    throw new ConflictError(`${room}: this reading period already has a ${samePeriod.status.toLowerCase()} bill.`)
  }
  if (params.kind === 'REGULAR') {
    const sameMonth = await db.roomElectricityBill.findFirst({
      where: { roomId: meter.roomId, billingMonth: params.billingMonth, kind: 'REGULAR', status: { not: 'VOID' } },
      select: { status: true },
    })
    if (sameMonth) {
      throw new ConflictError(
        `${room} already has a ${sameMonth.status.toLowerCase()} bill for ${billingMonthLabel(params.billingMonth)}. Void it first to bill again.`,
      )
    }
  }

  let rate = params.rateOverride ?? null
  let rateId: string | null = null
  if (!rate) {
    const row = await rateFor(db, meter.propertyId, toValidation(() => monthStart(params.billingMonth)))
    if (!row) {
      throw new ValidationError(
        `No electricity rate is set for ${meter.property.name} for ${billingMonthLabel(params.billingMonth)}. Add the rate per unit first.`,
      )
    }
    rate = String(row.ratePerUnit)
    rateId = row.id
  }

  const periodStart = startOfDay(previous.readingDate)
  const periodEnd = startOfDay(params.currentDate)
  const { stays, info } = await roomStays(db, meter.roomId, periodStart, periodEnd)
  const leaves = params.settings.excludeLeaveDays
    ? await approvedLeaves(db, [...info.keys()], periodStart, periodEnd)
    : []

  let result: RoomBillResult
  try {
    result = computeRoomBill({
      previousReading: String(previous.value),
      currentReading: params.currentValue,
      ratePerUnit: rate,
      periodStart,
      periodEnd,
      method: params.settings.splitMethod,
      stays,
      leaves,
      ownerAbsorbs: params.ownerAbsorbs,
    })
  } catch (e) {
    if (e instanceof ElectricityError) throw new ValidationError(`${room}: ${e.message}`)
    throw e
  }

  const warnings: string[] = []
  const shares = result.shares.map((s) => {
    const who = info.get(s.residentId)
    const collectible = !who?.checkedOut
    if (!collectible && s.share > 0) {
      warnings.push(
        `${who?.name ?? 'A resident'} has already checked out, so their share of ${formatMoney(s.share)} cannot be billed. Take a meter reading at checkout next time.`,
      )
    }
    return {
      residentId: s.residentId,
      residentName: who?.name ?? 'Resident',
      bedLabel: who?.bed ?? null,
      daysStayed: s.daysStayed,
      weight: s.weight,
      share: s.share,
      collectible,
    }
  })
  if (result.ownerAbsorbed) warnings.push(`${room}: the owner pays this bill; no resident is charged.`)
  if (result.amount === 0) warnings.push(`${room}: no units used this period.`)

  return {
    meterId: meter.id,
    meterNumber: meter.meterNumber,
    roomId: meter.roomId,
    roomNumber: meter.room.number,
    propertyId: meter.propertyId,
    billingMonth: params.billingMonth,
    periodStart,
    periodEnd,
    previousReadingId: previous.id,
    previousReading: dec(previous.value),
    currentReading: Number(params.currentValue),
    units: result.units,
    ratePerUnit: result.rate,
    rateId,
    amount: result.amount,
    splitMethod: params.settings.splitMethod,
    occupantCount: result.occupantCount,
    periodDays: result.periodDays,
    ownerAbsorbed: result.ownerAbsorbed,
    shares,
    uncollectedAmount: shares.filter((s) => !s.collectible).reduce((sum, s) => sum + s.share, 0),
    warnings,
  }
}

async function auditBill(
  tx: Tx,
  params: {
    event: 'ELECTRICITY_BILL_FINALIZED' | 'ELECTRICITY_BILL_VOIDED'
    bill: { id: string; organizationId: string; propertyId: string; billingMonth: string; amount: number; status: string }
    roomNumber: string
    actor: Actor
    summary: string
    before?: Prisma.InputJsonValue
    after?: Prisma.InputJsonValue
  },
) {
  await recordActivity(
    {
      organizationId: params.bill.organizationId,
      propertyId: params.bill.propertyId,
      actorId: params.actor.id,
      actorName: params.actor.name,
      event: params.event,
      entityType: 'RoomElectricityBill',
      entityId: params.bill.id,
      summary: params.summary,
      meta: { billingMonth: params.bill.billingMonth, room: params.roomNumber, amount: params.bill.amount },
      before: params.before,
      after: params.after,
    },
    tx,
  )
}

// ------------------------------------------------------------------- meters

export async function listMeters(user: SessionUser, params: { propertyId?: string | null; roomId?: string | null }) {
  const scope = await resolveScope(user, params.propertyId)
  const meters = await prisma.electricityMeter.findMany({
    where: {
      organizationId: scope.organizationId,
      propertyId: scope.propertyId ?? { in: scope.allowedPropertyIds },
      ...(params.roomId ? { roomId: params.roomId } : {}),
    },
    include: {
      room: { select: { id: true, number: true, capacity: true, floor: { select: { name: true } } } },
      property: { select: { id: true, name: true } },
      readings: { orderBy: { readingDate: 'desc' }, take: 1 },
    },
    orderBy: [{ property: { name: 'asc' } }, { room: { number: 'asc' } }, { status: 'asc' }],
  })
  return meters.map((m) => ({
    id: m.id,
    meterNumber: m.meterNumber,
    status: m.status,
    installedOn: m.installedOn,
    initialReading: dec(m.initialReading),
    notes: m.notes,
    replacedById: m.replacedById,
    property: m.property,
    room: { id: m.room.id, number: m.room.number, capacity: m.room.capacity, floor: m.room.floor.name },
    lastReading: m.readings[0]
      ? { value: dec(m.readings[0].value), readingDate: m.readings[0].readingDate, kind: m.readings[0].kind }
      : null,
  }))
}

export async function createMeter(user: SessionUser, input: z.infer<typeof meterCreateSchema>) {
  const organizationId = user.organizationId!
  assertInScope(user, input.propertyId)
  const room = await prisma.room.findFirst({
    where: { id: input.roomId, propertyId: input.propertyId, property: { organizationId } },
    select: { id: true, number: true, propertyId: true },
  })
  if (!room) throw new ValidationError('That room is not in this PG')
  const installedOn = parseDate(input.installedOn)
  const actor = actorOf(user)

  try {
    return await prisma.$transaction(async (tx) => {
      const current = await tx.electricityMeter.findFirst({ where: { roomId: room.id, status: 'ACTIVE' } })
      if (current && !input.replaceExisting) {
        throw new ConflictError(`Room ${room.number} already has meter ${current.meterNumber}. Choose “Replace meter” to swap it.`)
      }
      // The old meter steps aside first: only one meter per room may be active.
      if (current) await tx.electricityMeter.update({ where: { id: current.id }, data: { status: 'REPLACED' } })
      const meter = await tx.electricityMeter.create({
        data: {
          organizationId,
          propertyId: room.propertyId,
          roomId: room.id,
          meterNumber: input.meterNumber,
          installedOn,
          initialReading: new Prisma.Decimal(input.initialReading),
          notes: input.notes || null,
        },
      })
      if (current) await tx.electricityMeter.update({ where: { id: current.id }, data: { replacedById: meter.id } })
      await tx.meterReading.create({
        data: {
          organizationId,
          meterId: meter.id,
          readingDate: installedOn,
          value: new Prisma.Decimal(input.initialReading),
          kind: 'INITIAL',
          takenById: actor.id,
          takenByName: actor.name,
          note: current ? `Replaced meter ${current.meterNumber}` : 'Starting reading',
        },
      })
      await recordActivity(
        {
          organizationId,
          propertyId: room.propertyId,
          actorId: actor.id,
          actorName: actor.name,
          event: 'ELECTRICITY_METER_UPDATED',
          entityType: 'ElectricityMeter',
          entityId: meter.id,
          summary: current
            ? `Meter ${current.meterNumber} in Room ${room.number} replaced by ${meter.meterNumber} (starts at ${input.initialReading})`
            : `Meter ${meter.meterNumber} added to Room ${room.number} (starts at ${input.initialReading})`,
          before: current ? { meterNumber: current.meterNumber, status: current.status } : undefined,
          after: { meterNumber: meter.meterNumber, initialReading: input.initialReading, installedOn: input.installedOn },
        },
        tx,
      )
      return meter
    })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new ConflictError(`Meter number ${input.meterNumber} is already used`)
    }
    throw error
  }
}

/**
 * Adds a meter to many rooms in one go. Each room is saved on its own, so
 * one bad row (a used meter number, a room that already has a meter) never
 * blocks the others; those come back in `errors` with the reason.
 */
export async function createMetersBulk(user: SessionUser, input: z.infer<typeof bulkMeterSchema>) {
  assertInScope(user, input.propertyId)
  const rooms = await prisma.room.findMany({
    where: { id: { in: input.meters.map((m) => m.roomId) }, propertyId: input.propertyId, property: { organizationId: user.organizationId! } },
    select: { id: true, number: true },
  })
  const roomNumber = new Map(rooms.map((r) => [r.id, r.number]))
  const created: { meterId: string; roomId: string; roomNumber: string; meterNumber: string }[] = []
  const errors: { roomId: string; roomNumber: string; error: string }[] = []
  const seen = new Set<string>()
  for (const m of input.meters) {
    const number = roomNumber.get(m.roomId) ?? '?'
    if (seen.has(m.roomId)) {
      errors.push({ roomId: m.roomId, roomNumber: number, error: `Room ${number} is listed twice` })
      continue
    }
    seen.add(m.roomId)
    try {
      const meter = await createMeter(user, {
        propertyId: input.propertyId,
        roomId: m.roomId,
        meterNumber: m.meterNumber,
        installedOn: input.installedOn,
        initialReading: m.initialReading,
      })
      created.push({ meterId: meter.id, roomId: m.roomId, roomNumber: number, meterNumber: meter.meterNumber })
    } catch (e) {
      if (e instanceof ValidationError || e instanceof ConflictError || e instanceof NotFoundError) {
        errors.push({ roomId: m.roomId, roomNumber: number, error: e.message })
      } else throw e
    }
  }
  return { created, errors }
}

export async function updateMeter(user: SessionUser, input: z.infer<typeof meterUpdateSchema>) {
  const organizationId = user.organizationId!
  const meter = await loadMeter(prisma, organizationId, input.meterId)
  assertInScope(user, meter.propertyId)
  if (meter.status === 'REPLACED') throw new ConflictError('This meter was replaced and can no longer be changed')
  if (input.status === 'ACTIVE' && meter.status !== 'ACTIVE') {
    const other = await prisma.electricityMeter.findFirst({ where: { roomId: meter.roomId, status: 'ACTIVE', id: { not: meter.id } } })
    if (other) throw new ConflictError(`Room ${meter.room.number} already has an active meter (${other.meterNumber})`)
  }
  try {
    return await prisma.$transaction(async (tx) => {
      const updated = await tx.electricityMeter.update({
        where: { id: meter.id },
        data: {
          ...(input.meterNumber ? { meterNumber: input.meterNumber } : {}),
          ...(input.status ? { status: input.status } : {}),
          ...(input.notes !== undefined ? { notes: input.notes || null } : {}),
        },
      })
      await recordActivity(
        {
          organizationId,
          propertyId: meter.propertyId,
          actorId: user.id,
          actorName: user.name,
          event: 'ELECTRICITY_METER_UPDATED',
          entityType: 'ElectricityMeter',
          entityId: meter.id,
          summary: `Meter ${updated.meterNumber} in Room ${meter.room.number} updated`,
          before: { meterNumber: meter.meterNumber, status: meter.status, notes: meter.notes },
          after: { meterNumber: updated.meterNumber, status: updated.status, notes: updated.notes },
        },
        tx,
      )
      return updated
    })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new ConflictError('That meter number is already used')
    }
    throw error
  }
}

// -------------------------------------------------------------------- rates

export async function listRates(user: SessionUser, propertyId?: string | null) {
  const scope = await resolveScope(user, propertyId)
  const rows = await prisma.electricityRate.findMany({
    where: { organizationId: scope.organizationId, propertyId: scope.propertyId ?? { in: scope.allowedPropertyIds } },
    include: { property: { select: { id: true, name: true } } },
    orderBy: [{ propertyId: 'asc' }, { effectiveFrom: 'desc' }, { createdAt: 'desc' }],
  })
  const today = new Date()
  const current = new Map<string, string>()
  for (const r of rows) {
    if (r.effectiveFrom <= startOfMonth(today) && !current.has(r.propertyId)) current.set(r.propertyId, r.id)
  }
  return rows.map((r) => ({
    id: r.id,
    property: r.property,
    effectiveFrom: r.effectiveFrom,
    month: monthKeyOf(r.effectiveFrom),
    ratePerUnit: dec(r.ratePerUnit),
    note: r.note,
    createdByName: r.createdByName,
    createdAt: r.createdAt,
    current: current.get(r.propertyId) === r.id,
  }))
}

export async function setRate(user: SessionUser, input: z.infer<typeof rateCreateSchema>) {
  const organizationId = user.organizationId!
  assertInScope(user, input.propertyId)
  const property = await prisma.property.findFirst({ where: { id: input.propertyId, organizationId }, select: { id: true, name: true } })
  if (!property) throw new NotFoundError('PG not found')
  const effectiveFrom = toValidation(() => monthStart(input.effectiveFrom))
  return prisma.$transaction(async (tx) => {
    const before = await rateFor(tx, property.id, effectiveFrom)
    const rate = await tx.electricityRate.create({
      data: {
        organizationId,
        propertyId: property.id,
        effectiveFrom,
        ratePerUnit: new Prisma.Decimal(input.ratePerUnit),
        note: input.note || null,
        createdById: user.id,
        createdByName: user.name,
      },
    })
    await recordActivity(
      {
        organizationId,
        propertyId: property.id,
        actorId: user.id,
        actorName: user.name,
        event: 'ELECTRICITY_RATE_SET',
        entityType: 'ElectricityRate',
        entityId: rate.id,
        summary: `Electricity rate for ${property.name} set to ₹${input.ratePerUnit}/unit from ${billingMonthLabel(input.effectiveFrom)}`,
        before: before ? { ratePerUnit: String(before.ratePerUnit), effectiveFrom: monthKeyOf(before.effectiveFrom) } : undefined,
        after: { ratePerUnit: input.ratePerUnit, effectiveFrom: input.effectiveFrom },
      },
      tx,
    )
    return rate
  })
}

// ----------------------------------------------------------------- readings

/** Saves a reading (or corrects an unbilled one on the same date). */
async function saveReading(
  tx: Tx,
  params: {
    meter: MeterWithRoom
    readingDate: Date
    value: string
    kind: 'REGULAR' | 'INTERIM'
    photoUrl?: string
    note?: string
    actor: Actor
  },
): Promise<MeterReading> {
  const { meter } = params
  const tenths = toValidation(() => toTenths(params.value))
  const previous = await tx.meterReading.findFirst({
    where: { meterId: meter.id, readingDate: { lt: params.readingDate } },
    orderBy: { readingDate: 'desc' },
  })
  if (!previous) {
    throw new ValidationError(`Meter ${meter.meterNumber}: the date is before the meter's starting reading.`)
  }
  if (tenths < toTenths(String(previous.value))) {
    throw new ValidationError(
      `Meter ${meter.meterNumber}: ${params.value} is lower than the previous reading (${dec(previous.value)} on ${formatDate(previous.readingDate)}).`,
    )
  }
  const next = await tx.meterReading.findFirst({
    where: { meterId: meter.id, readingDate: { gt: params.readingDate } },
    orderBy: { readingDate: 'asc' },
  })
  if (next && tenths > toTenths(String(next.value))) {
    throw new ValidationError(
      `Meter ${meter.meterNumber}: ${params.value} is higher than the later reading (${dec(next.value)} on ${formatDate(next.readingDate)}).`,
    )
  }

  const existing = await tx.meterReading.findUnique({
    where: { meterId_readingDate: { meterId: meter.id, readingDate: params.readingDate } },
  })
  if (existing) {
    if (toTenths(String(existing.value)) === tenths) return existing
    const used = await tx.roomElectricityBill.findFirst({
      where: { status: { not: 'VOID' }, OR: [{ currentReadingId: existing.id }, { previousReadingId: existing.id }] },
      select: { id: true },
    })
    if (used || existing.kind === 'INITIAL') {
      throw new ConflictError(
        `Meter ${meter.meterNumber} already has a reading of ${dec(existing.value)} on ${formatDate(params.readingDate)} that is used in a bill.`,
      )
    }
    return tx.meterReading.update({
      where: { id: existing.id },
      data: { value: new Prisma.Decimal(params.value), photoUrl: params.photoUrl || existing.photoUrl, takenById: params.actor.id, takenByName: params.actor.name },
    })
  }
  const reading = await tx.meterReading.create({
    data: {
      organizationId: meter.organizationId,
      meterId: meter.id,
      readingDate: params.readingDate,
      value: new Prisma.Decimal(params.value),
      kind: params.kind,
      photoUrl: params.photoUrl || null,
      note: params.note || null,
      takenById: params.actor.id,
      takenByName: params.actor.name,
    },
  })
  await recordActivity(
    {
      organizationId: meter.organizationId,
      propertyId: meter.propertyId,
      actorId: params.actor.id,
      actorName: params.actor.name,
      event: 'METER_READING_RECORDED',
      entityType: 'MeterReading',
      entityId: reading.id,
      summary: `Room ${meter.room.number} meter ${meter.meterNumber}: ${params.value} on ${formatDate(params.readingDate)}`,
      after: { value: params.value, readingDate: params.readingDate.toISOString(), kind: params.kind },
    },
    tx,
  )
  return reading
}

export async function recordReading(user: SessionUser, input: z.infer<typeof readingSchema>) {
  requireReadings(user)
  const organizationId = user.organizationId!
  const meter = await loadMeter(prisma, organizationId, input.meterId)
  assertInScope(user, meter.propertyId)
  if (meter.status !== 'ACTIVE') throw new ConflictError(`Meter ${meter.meterNumber} is ${meter.status.toLowerCase()}`)
  const readingDate = parseDate(input.readingDate)
  if (readingDate > startOfDay(new Date())) throw new ValidationError('A reading cannot be dated in the future')
  return prisma.$transaction((tx) =>
    saveReading(tx, {
      meter,
      readingDate,
      value: input.value,
      kind: 'REGULAR',
      photoUrl: input.photoUrl || undefined,
      note: input.note || undefined,
      actor: actorOf(user),
    }),
  )
}

export async function listReadings(user: SessionUser, meterId: string) {
  const meter = await loadMeter(prisma, user.organizationId!, meterId)
  assertInScope(user, meter.propertyId)
  const rows = await prisma.meterReading.findMany({ where: { meterId }, orderBy: { readingDate: 'desc' }, take: 60 })
  return rows.map((r) => ({ ...r, value: dec(r.value) }))
}

// -------------------------------------------------------------------- bills

type BillInput = {
  propertyId: string
  billingMonth: string
  readingDate?: string
  ratePerUnit?: string
  readings: { meterId: string; value: string; readingDate?: string; photoUrl?: string; ownerAbsorbs?: boolean }[]
}

async function metersFor(user: SessionUser, input: BillInput) {
  const organizationId = user.organizationId!
  assertInScope(user, input.propertyId)
  const ids = [...new Set(input.readings.map((r) => r.meterId))]
  if (ids.length !== input.readings.length) throw new ValidationError('Each meter can appear only once')
  const meters = await prisma.electricityMeter.findMany({
    where: { id: { in: ids }, organizationId, propertyId: input.propertyId },
    include: { room: true, property: true },
  })
  if (meters.length !== ids.length) throw new ValidationError('One of those meters is not in this PG')
  return new Map(meters.map((m) => [m.id, m]))
}

function readingDateFor(input: BillInput, r: BillInput['readings'][number]) {
  const date = r.readingDate ?? input.readingDate
  const day = date ? parseDate(date) : startOfDay(new Date())
  if (day > startOfDay(new Date())) throw new ValidationError('A reading cannot be dated in the future')
  return day
}

/** Works out every room's bill from the readings, saving nothing. */
export async function previewBills(user: SessionUser, input: BillInput) {
  requireReadings(user)
  const settings = await electricitySettings(user.organizationId!)
  const meters = await metersFor(user, input)
  const rows: (RoomBillDraft & { error?: undefined })[] = []
  const errors: { meterId: string; roomNumber: string; error: string }[] = []
  for (const r of input.readings) {
    const meter = meters.get(r.meterId)!
    try {
      const day = readingDateFor(input, r)
      const existing = await prisma.meterReading.findUnique({ where: { meterId_readingDate: { meterId: meter.id, readingDate: day } } })
      rows.push(
        await draftFor(prisma, {
          meter,
          currentValue: r.value,
          currentDate: day,
          billingMonth: input.billingMonth,
          rateOverride: input.ratePerUnit,
          ownerAbsorbs: r.ownerAbsorbs,
          kind: 'REGULAR',
          settings,
          excludeReadingId: existing?.id,
        }),
      )
    } catch (e) {
      if (e instanceof ValidationError || e instanceof ConflictError) {
        errors.push({ meterId: meter.id, roomNumber: meter.room.number, error: e.message })
      } else throw e
    }
  }
  return {
    billingMonth: input.billingMonth,
    splitMethod: settings.splitMethod,
    billingMode: settings.billingMode,
    rows,
    errors,
    totals: {
      units: rows.reduce((s, r) => s + r.units, 0),
      amount: rows.reduce((s, r) => s + r.amount, 0),
      residents: rows.reduce((s, r) => s + r.shares.length, 0),
    },
  }
}

/**
 * Saves the readings and DRAFT bills. Rooms with an error are skipped and
 * reported; the rest are saved, each in its own transaction.
 */
export async function generateDrafts(user: SessionUser, input: BillInput) {
  requireReadings(user)
  const settings = await electricitySettings(user.organizationId!)
  const meters = await metersFor(user, input)
  const actor = actorOf(user)
  const created: { billId: string; roomNumber: string; amount: number }[] = []
  const errors: { meterId: string; roomNumber: string; error: string }[] = []
  for (const r of input.readings) {
    const meter = meters.get(r.meterId)!
    try {
      const day = readingDateFor(input, r)
      const bill = await prisma.$transaction(async (tx) => {
        const reading = await saveReading(tx, { meter, readingDate: day, value: r.value, kind: 'REGULAR', photoUrl: r.photoUrl, actor })
        const draft = await draftFor(tx, {
          meter,
          currentValue: r.value,
          currentDate: day,
          billingMonth: input.billingMonth,
          rateOverride: input.ratePerUnit,
          ownerAbsorbs: r.ownerAbsorbs,
          kind: 'REGULAR',
          settings,
          excludeReadingId: reading.id,
        })
        return tx.roomElectricityBill.create({
          data: {
            ...billData(draft, { organizationId: meter.organizationId, kind: 'REGULAR', currentReadingId: reading.id, actor }),
            shares: { create: draft.shares.map((s) => shareData(s, meter.organizationId)) },
          },
        })
      })
      created.push({ billId: bill.id, roomNumber: meter.room.number, amount: bill.amount })
    } catch (e) {
      if (e instanceof ValidationError || e instanceof ConflictError) {
        errors.push({ meterId: meter.id, roomNumber: meter.room.number, error: e.message })
      } else if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        errors.push({ meterId: meter.id, roomNumber: meter.room.number, error: 'This period was just billed by someone else.' })
      } else throw e
    }
  }
  return { created, errors }
}

function billData(
  draft: RoomBillDraft,
  extra: { organizationId: string; kind: 'REGULAR' | 'INTERIM'; currentReadingId: string; actor: Actor },
) {
  return {
    organizationId: extra.organizationId,
    propertyId: draft.propertyId,
    roomId: draft.roomId,
    meterId: draft.meterId,
    billingMonth: draft.billingMonth,
    kind: extra.kind,
    periodStart: draft.periodStart,
    periodEnd: draft.periodEnd,
    previousReadingId: draft.previousReadingId,
    currentReadingId: extra.currentReadingId,
    previousReading: new Prisma.Decimal(draft.previousReading),
    currentReading: new Prisma.Decimal(draft.currentReading),
    units: new Prisma.Decimal(draft.units),
    ratePerUnit: new Prisma.Decimal(draft.ratePerUnit),
    rateId: draft.rateId,
    amount: draft.amount,
    splitMethod: draft.splitMethod,
    occupantCount: draft.occupantCount,
    ownerAbsorbed: draft.ownerAbsorbed,
    uncollectedAmount: draft.uncollectedAmount,
    createdById: extra.actor.id,
    createdByName: extra.actor.name,
  }
}

function shareData(s: RoomBillDraft['shares'][number], organizationId: string) {
  return {
    organizationId,
    residentId: s.residentId,
    residentName: s.residentName,
    bedLabel: s.bedLabel,
    daysStayed: s.daysStayed,
    weight: s.weight,
    shareAmount: s.share,
    collectible: s.collectible,
  }
}

/** Creates the ResidentCharge (and, in SEPARATE_INVOICE mode, the invoice) for one share. */
async function chargeShare(
  tx: Tx,
  params: {
    bill: { id: string; billingMonth: string; kind: string; periodEnd: Date; propertyId: string; organizationId: string; amount: number }
    draft: RoomBillDraft
    share: RoomBillDraft['shares'][number]
    mode: BillingMode
    actor: Actor
  },
) {
  const { bill, draft, share } = params
  const label = shareLabel({
    month: bill.billingMonth,
    roomNumber: draft.roomNumber,
    units: draft.units,
    rate: draft.ratePerUnit,
    amount: draft.amount,
    daysStayed: share.daysStayed,
    periodDays: draft.periodDays,
    method: draft.splitMethod,
    occupantCount: draft.occupantCount,
    interim: bill.kind === 'INTERIM',
  })
  const charge = await tx.residentCharge.create({
    data: {
      organizationId: bill.organizationId,
      propertyId: bill.propertyId,
      residentId: share.residentId,
      kind: 'ONE_TIME',
      category: 'ELECTRICITY',
      label,
      amount: share.share,
      startDate: bill.periodEnd,
      createdBy: params.actor.name,
    },
  })

  if (params.mode === 'SEPARATE_INVOICE') {
    const resident = await tx.resident.findUniqueOrThrow({
      where: { id: share.residentId },
      include: { organization: { include: { settings: true } } },
    })
    const day = startOfDay(new Date())
    // Stamped inside the reading day (not midnight on the 1st) so it is never
    // mistaken for, or collides with, the monthly rent invoice.
    let stamp = new Date(bill.periodEnd)
    stamp.setHours(23, 59, 50, 0)
    for (let i = 0; i < 40; i++) {
      const taken = await tx.rentInvoice.findUnique({ where: { residentId_periodStart: { residentId: resident.id, periodStart: stamp } }, select: { id: true } })
      if (!taken) break
      stamp = new Date(stamp.getTime() - 1000)
    }
    const number = await nextInvoiceNumber(tx, resident.organizationId, resident.organization.settings?.invoicePrefix ?? 'INV', day)
    const created = await tx.rentInvoice.create({
      data: {
        organizationId: resident.organizationId,
        propertyId: resident.propertyId,
        residentId: resident.id,
        number,
        periodStart: stamp,
        periodEnd: stamp,
        issueDate: day,
        // Due on issue; the PG's own late-fee grace period applies as for rent.
        dueDate: day,
        status: 'PENDING',
        subtotal: share.share,
        total: share.share,
        balance: share.share,
        autoGenerated: false,
        notes: `Electricity · ${billingMonthLabel(bill.billingMonth)}`,
        lines: { create: [{ kind: 'ELECTRICITY', label, quantity: 1, unitPrice: share.share, amount: share.share }] },
      },
    })
    await tx.residentCharge.update({ where: { id: charge.id }, data: { billedInvoiceId: created.id, lastBilledFor: bill.periodEnd } })
    await appendLedger(tx, {
      organizationId: resident.organizationId,
      residentId: resident.id,
      kind: 'CHARGE',
      label: `Invoice ${number} — ${label}`,
      debit: share.share,
      entryDate: day,
      refType: 'RentInvoice',
      refId: created.id,
    })
    await applyAdvanceToInvoice(tx, created)
  }
  return charge
}

/** Rebuilds a bill's draft from its stored readings and rate, with today's occupancy. */
async function redraftStored(tx: Tx, billId: string) {
  const bill = await tx.roomElectricityBill.findUniqueOrThrow({
    where: { id: billId },
    include: { meter: { include: { room: true, property: true } } },
  })
  const settings = await electricitySettings(bill.organizationId, tx)
  const { stays, info } = await roomStays(tx, bill.roomId, bill.periodStart, bill.periodEnd)
  const leaves = settings.excludeLeaveDays ? await approvedLeaves(tx, [...info.keys()], bill.periodStart, bill.periodEnd) : []
  const result = toValidation(() =>
    computeRoomBill({
      previousReading: String(bill.previousReading),
      currentReading: String(bill.currentReading),
      ratePerUnit: String(bill.ratePerUnit),
      periodStart: bill.periodStart,
      periodEnd: bill.periodEnd,
      method: settings.splitMethod,
      stays,
      leaves,
      ownerAbsorbs: bill.ownerAbsorbed,
    }),
  )
  const shares = result.shares.map((s) => {
    const who = info.get(s.residentId)
    return {
      residentId: s.residentId,
      residentName: who?.name ?? 'Resident',
      bedLabel: who?.bed ?? null,
      daysStayed: s.daysStayed,
      weight: s.weight,
      share: s.share,
      collectible: !who?.checkedOut,
    }
  })
  const draft: RoomBillDraft = {
    meterId: bill.meterId,
    meterNumber: bill.meter.meterNumber,
    roomId: bill.roomId,
    roomNumber: bill.meter.room.number,
    propertyId: bill.propertyId,
    billingMonth: bill.billingMonth,
    periodStart: bill.periodStart,
    periodEnd: bill.periodEnd,
    previousReadingId: bill.previousReadingId,
    previousReading: dec(bill.previousReading),
    currentReading: dec(bill.currentReading),
    units: result.units,
    ratePerUnit: result.rate,
    rateId: bill.rateId,
    amount: result.amount,
    splitMethod: settings.splitMethod,
    occupantCount: result.occupantCount,
    periodDays: result.periodDays,
    ownerAbsorbed: result.ownerAbsorbed,
    shares,
    uncollectedAmount: shares.filter((s) => !s.collectible).reduce((sum, s) => sum + s.share, 0),
    warnings: [],
  }
  return { bill, draft, settings }
}

/** Freezes one bill and charges the shares. A no-op when already finalized. */
async function finalizeTx(tx: Tx, billId: string, actor: Actor, opts?: { leaverId?: string }) {
  await tx.$queryRaw`SELECT "id" FROM "RoomElectricityBill" WHERE "id" = ${billId} FOR UPDATE`
  const status = await tx.roomElectricityBill.findUniqueOrThrow({ where: { id: billId }, select: { status: true } })
  if (status.status === 'FINALIZED') return { billId, changed: false }
  if (status.status === 'VOID') throw new ConflictError('This bill was voided')

  const { bill, draft, settings } = await redraftStored(tx, billId)
  await tx.roomElectricityShare.deleteMany({ where: { billId } })
  let charged = 0
  for (const share of draft.shares) {
    let residentChargeId: string | null = null
    if (share.collectible && share.share > 0) {
      // The leaver at a checkout always gets a plain charge: the settlement bills it.
      const mode: BillingMode = opts?.leaverId === share.residentId ? 'NEXT_RENT_INVOICE' : settings.billingMode
      const charge = await chargeShare(tx, { bill, draft, share, mode, actor })
      residentChargeId = charge.id
      charged++
    }
    await tx.roomElectricityShare.create({ data: { ...shareData(share, bill.organizationId), billId, residentChargeId } })
  }
  const before = { status: bill.status, amount: bill.amount, occupantCount: bill.occupantCount }
  const finalized = await tx.roomElectricityBill.update({
    where: { id: billId },
    data: {
      status: 'FINALIZED',
      amount: draft.amount,
      splitMethod: draft.splitMethod,
      occupantCount: draft.occupantCount,
      uncollectedAmount: draft.uncollectedAmount,
      finalizedAt: new Date(),
      finalizedById: actor.id,
      finalizedByName: actor.name,
    },
  })
  await auditBill(tx, {
    event: 'ELECTRICITY_BILL_FINALIZED',
    bill: finalized,
    roomNumber: draft.roomNumber,
    actor,
    summary: `Electricity ${billingMonthLabel(finalized.billingMonth)} for Room ${draft.roomNumber}: ${draft.units} units × ₹${draft.ratePerUnit} = ${formatMoney(draft.amount)}${
      draft.ownerAbsorbed ? ', paid by the owner' : `, shared by ${draft.occupantCount} (${charged} charged)`
    }`,
    before,
    after: {
      status: 'FINALIZED',
      units: draft.units,
      ratePerUnit: draft.ratePerUnit,
      amount: draft.amount,
      splitMethod: draft.splitMethod,
      shares: draft.shares.map((s) => ({ resident: s.residentName, days: s.daysStayed, share: s.share, collectible: s.collectible })),
    },
  })
  return { billId, changed: true }
}

export async function finalizeBills(user: SessionUser, billIds: string[]) {
  const organizationId = user.organizationId!
  const bills = await prisma.roomElectricityBill.findMany({
    where: { id: { in: billIds }, organizationId },
    select: { id: true, propertyId: true },
  })
  if (bills.length !== new Set(billIds).size) throw new NotFoundError('One of those bills was not found')
  for (const b of bills) assertInScope(user, b.propertyId)
  const actor = actorOf(user)
  const results: { billId: string; changed: boolean }[] = []
  const errors: { billId: string; error: string }[] = []
  for (const b of bills) {
    try {
      results.push(await prisma.$transaction((tx) => finalizeTx(tx, b.id, actor)))
    } catch (e) {
      if (e instanceof ValidationError || e instanceof ConflictError) errors.push({ billId: b.id, error: e.message })
      else throw e
    }
  }
  return { finalized: results.filter((r) => r.changed).length, alreadyFinal: results.filter((r) => !r.changed).length, errors }
}

export async function voidBill(user: SessionUser, billId: string, reason: string) {
  const organizationId = user.organizationId!
  const found = await prisma.roomElectricityBill.findFirst({ where: { id: billId, organizationId }, select: { propertyId: true } })
  if (!found) throw new NotFoundError('Bill not found')
  assertInScope(user, found.propertyId)
  const actor = actorOf(user)
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "RoomElectricityBill" WHERE "id" = ${billId} FOR UPDATE`
    const bill = await tx.roomElectricityBill.findUniqueOrThrow({
      where: { id: billId },
      include: { room: { select: { number: true } }, shares: true },
    })
    if (bill.status === 'VOID') return bill
    const chargeIds = bill.shares.flatMap((s) => (s.residentChargeId ? [s.residentChargeId] : []))
    if (chargeIds.length) {
      const billed = await tx.residentCharge.findMany({
        where: { id: { in: chargeIds }, billedInvoiceId: { not: null } },
        select: { billedInvoiceId: true },
      })
      if (billed.length) {
        const invoices = await tx.rentInvoice.findMany({
          where: { id: { in: billed.map((b) => b.billedInvoiceId!) } },
          select: { number: true },
        })
        throw new ConflictError(
          `Some shares are already on invoices (${invoices.map((i) => i.number).join(', ')}). Correct them with a credit note on those invoices instead.`,
        )
      }
      await tx.residentCharge.updateMany({
        where: { id: { in: chargeIds } },
        data: { voidedAt: new Date(), voidReason: `Electricity bill voided: ${reason}` },
      })
    }
    const voided = await tx.roomElectricityBill.update({
      where: { id: billId },
      data: { status: 'VOID', voidedAt: new Date(), voidReason: reason },
    })
    await auditBill(tx, {
      event: 'ELECTRICITY_BILL_VOIDED',
      bill: voided,
      roomNumber: bill.room.number,
      actor,
      summary: `Electricity ${billingMonthLabel(bill.billingMonth)} for Room ${bill.room.number} (${formatMoney(bill.amount)}) voided: ${reason}`,
      before: { status: bill.status, amount: bill.amount },
      after: { status: 'VOID', reason },
    })
    return voided
  })
}

export type BillFilters = {
  propertyId?: string | null
  month?: string | null
  roomId?: string | null
  residentId?: string | null
  status?: string | null
  /** PAID | PARTIALLY_PAID | PENDING | NOT_INVOICED */
  paymentStatus?: string | null
}

/** Bills with their shares and each share's payment state. */
export async function listBills(user: SessionUser, filters: BillFilters) {
  const scope = await resolveScope(user, filters.propertyId)
  const bills = await prisma.roomElectricityBill.findMany({
    where: {
      organizationId: scope.organizationId,
      propertyId: scope.propertyId ?? { in: scope.allowedPropertyIds },
      ...(filters.month ? { billingMonth: filters.month } : {}),
      ...(filters.roomId ? { roomId: filters.roomId } : {}),
      ...(filters.status && ['DRAFT', 'FINALIZED', 'VOID'].includes(filters.status)
        ? { status: filters.status as 'DRAFT' }
        : { status: { not: 'VOID' } }),
      ...(filters.residentId ? { shares: { some: { residentId: filters.residentId } } } : {}),
    },
    include: {
      room: { select: { id: true, number: true } },
      meter: { select: { meterNumber: true } },
      property: { select: { id: true, name: true } },
      shares: { orderBy: { shareAmount: 'desc' } },
    },
    orderBy: [{ periodEnd: 'desc' }, { room: { number: 'asc' } }],
    take: 500,
  })

  const chargeIds = bills.flatMap((b) => b.shares.flatMap((s) => (s.residentChargeId ? [s.residentChargeId] : [])))
  const charges = chargeIds.length
    ? await prisma.residentCharge.findMany({ where: { id: { in: chargeIds } }, select: { id: true, billedInvoiceId: true, voidedAt: true } })
    : []
  const invoiceIds = charges.flatMap((c) => (c.billedInvoiceId ? [c.billedInvoiceId] : []))
  const invoices = invoiceIds.length
    ? await prisma.rentInvoice.findMany({
        where: { id: { in: invoiceIds } },
        select: { id: true, number: true, status: true, total: true, amountPaid: true, balance: true, paidAt: true },
      })
    : []
  const chargeById = new Map(charges.map((c) => [c.id, c]))
  const invoiceById = new Map(invoices.map((i) => [i.id, i]))

  const paymentOf = (share: (typeof bills)[number]['shares'][number]) => {
    if (!share.collectible) return { status: 'UNCOLLECTIBLE' as const, invoice: null }
    if (share.shareAmount === 0) return { status: 'NOTHING_DUE' as const, invoice: null }
    const charge = share.residentChargeId ? chargeById.get(share.residentChargeId) : null
    if (!charge) return { status: 'NOT_FINALIZED' as const, invoice: null }
    if (charge.voidedAt) return { status: 'VOID' as const, invoice: null }
    const invoice = charge.billedInvoiceId ? invoiceById.get(charge.billedInvoiceId) ?? null : null
    if (!invoice) return { status: 'NOT_INVOICED' as const, invoice: null }
    const status = invoice.status === 'PAID' ? 'PAID' : invoice.status === 'PARTIALLY_PAID' ? 'PARTIALLY_PAID' : 'PENDING'
    return { status, invoice }
  }

  const rows = bills.map((b) => ({
    id: b.id,
    property: b.property,
    room: b.room,
    meterNumber: b.meter.meterNumber,
    billingMonth: b.billingMonth,
    kind: b.kind,
    periodStart: b.periodStart,
    periodEnd: b.periodEnd,
    previousReading: dec(b.previousReading),
    currentReading: dec(b.currentReading),
    units: dec(b.units),
    ratePerUnit: dec(b.ratePerUnit),
    amount: b.amount,
    splitMethod: b.splitMethod,
    occupantCount: b.occupantCount,
    perPerson: b.occupantCount ? Math.round(b.amount / b.occupantCount) : 0,
    ownerAbsorbed: b.ownerAbsorbed,
    uncollectedAmount: b.uncollectedAmount,
    status: b.status,
    finalizedAt: b.finalizedAt,
    finalizedByName: b.finalizedByName,
    voidReason: b.voidReason,
    shares: b.shares.map((s) => {
      const pay = paymentOf(s)
      return {
        residentId: s.residentId,
        residentName: s.residentName,
        bedLabel: s.bedLabel,
        daysStayed: s.daysStayed,
        shareAmount: s.shareAmount,
        collectible: s.collectible,
        paymentStatus: pay.status,
        invoice: pay.invoice ? { id: pay.invoice.id, number: pay.invoice.number, status: pay.invoice.status } : null,
      }
    }),
  }))

  const wanted = filters.paymentStatus
  const filtered = wanted
    ? rows
        .map((r) => ({
          ...r,
          shares: r.shares.filter((s) => s.paymentStatus === wanted && (!filters.residentId || s.residentId === filters.residentId)),
        }))
        .filter((r) => r.shares.length)
    : filters.residentId
      ? rows.map((r) => ({ ...r, shares: r.shares.filter((s) => s.residentId === filters.residentId) }))
      : rows
  return filtered
}

// ----------------------------------------------------------------- checkout

/**
 * The leaver's electricity share up to the exit date, from a reading taken at
 * checkout. Preview only: nothing is saved. Null when the room has no meter.
 */
export async function previewCheckoutElectricity(params: {
  residentId: string
  exitDate: Date
  meterReading: string
}): Promise<{ label: string; category: string; amount: number } | null> {
  const ctx = await checkoutMeter(prisma, params.residentId)
  if (!ctx) throw new ValidationError('This resident’s room has no electricity meter')
  const exitDate = startOfDay(params.exitDate)
  const covered = await prisma.roomElectricityBill.findFirst({
    where: { meterId: ctx.meter.id, status: { not: 'VOID' }, periodEnd: { gte: exitDate } },
    select: { id: true },
  })
  if (covered) return null
  const existing = await prisma.meterReading.findUnique({ where: { meterId_readingDate: { meterId: ctx.meter.id, readingDate: exitDate } } })
  const settings = await electricitySettings(ctx.meter.organizationId)
  const draft = await draftFor(prisma, {
    meter: ctx.meter,
    currentValue: params.meterReading,
    currentDate: exitDate,
    billingMonth: monthKeyOf(exitDate),
    kind: 'INTERIM',
    settings,
    excludeReadingId: existing?.id,
  })
  const share = draft.shares.find((s) => s.residentId === params.residentId)
  if (!share || share.share <= 0) return null
  return {
    label: shareLabel({
      month: draft.billingMonth,
      roomNumber: draft.roomNumber,
      units: draft.units,
      rate: draft.ratePerUnit,
      amount: draft.amount,
      daysStayed: share.daysStayed,
      periodDays: draft.periodDays,
      method: draft.splitMethod,
      occupantCount: draft.occupantCount,
      interim: true,
    }),
    category: 'ELECTRICITY',
    amount: share.share,
  }
}

async function checkoutMeter(db: Db, residentId: string) {
  const resident = await db.resident.findUnique({
    where: { id: residentId },
    select: { organizationId: true, bed: { select: { roomId: true } }, roomId: true },
  })
  if (!resident) throw new NotFoundError('Resident not found')
  const roomId = resident.bed?.roomId ?? resident.roomId
  if (!roomId) return null
  const meter = await db.electricityMeter.findFirst({
    where: { roomId, organizationId: resident.organizationId, status: 'ACTIVE' },
    include: { room: true, property: true },
  })
  return meter ? { meter } : null
}

/**
 * At checkout: records the reading on the exit date and finalizes the room's
 * bill for (last reading → exit date), shared by everyone who lived there.
 * The leaver's share becomes an unbilled charge that the settlement includes;
 * everyone else's goes on their next invoice as usual. Runs inside the
 * checkout transaction, before the bed is released.
 */
export async function settleCheckoutElectricityTx(
  tx: Tx,
  params: { residentId: string; exitDate: Date; meterReading: string; actor: Actor },
) {
  const ctx = await checkoutMeter(tx, params.residentId)
  if (!ctx) throw new ValidationError('This resident’s room has no electricity meter')
  const exitDate = startOfDay(params.exitDate)
  const previous = await tx.meterReading.findFirst({
    where: { meterId: ctx.meter.id, readingDate: { lt: exitDate } },
    orderBy: { readingDate: 'desc' },
  })
  if (!previous) throw new ValidationError('The room meter has no reading before the exit date')
  // Already billed up to (or past) the exit date: the leaver's share is in that bill.
  const covered = await tx.roomElectricityBill.findFirst({
    where: { meterId: ctx.meter.id, status: { not: 'VOID' }, periodEnd: { gte: exitDate } },
    select: { id: true },
  })
  if (covered) return null
  const reading = await saveReading(tx, {
    meter: ctx.meter,
    readingDate: exitDate,
    value: params.meterReading,
    kind: 'INTERIM',
    note: 'Taken at checkout',
    actor: params.actor,
  })
  const settings = await electricitySettings(ctx.meter.organizationId, tx)
  const draft = await draftFor(tx, {
    meter: ctx.meter,
    currentValue: params.meterReading,
    currentDate: exitDate,
    billingMonth: monthKeyOf(exitDate),
    kind: 'INTERIM',
    settings,
    excludeReadingId: reading.id,
  })
  const bill = await tx.roomElectricityBill.create({
    data: {
      ...billData(draft, { organizationId: ctx.meter.organizationId, kind: 'INTERIM', currentReadingId: reading.id, actor: params.actor }),
      shares: { create: draft.shares.map((s) => shareData(s, ctx.meter.organizationId)) },
    },
  })
  await finalizeTx(tx, bill.id, params.actor, { leaverId: params.residentId })
  return { billId: bill.id, amount: draft.amount }
}

// ---------------------------------------------------------------- settings

export async function getElectricitySettings(user: SessionUser) {
  return electricitySettings(user.organizationId!)
}

export async function updateElectricitySettings(user: SessionUser, input: z.infer<typeof settingsSchema>) {
  const organizationId = user.organizationId!
  return prisma.$transaction(async (tx) => {
    const before = await electricitySettings(organizationId, tx)
    const updated = await tx.orgSetting.upsert({
      where: { organizationId },
      create: { organizationId, ...input },
      update: input,
      select: { electricitySplitMethod: true, electricityBillingMode: true, electricityExcludeLeaveDays: true },
    })
    await recordActivity(
      {
        organizationId,
        actorId: user.id,
        actorName: user.name,
        event: 'SETTINGS_UPDATED',
        entityType: 'OrgSetting',
        entityId: organizationId,
        summary: 'Electricity billing settings changed',
        before,
        after: updated,
      },
      tx,
    )
    return updated
  })
}

// --------------------------------------------------------------- dashboard

/** This month's electricity across the user's PGs, and readings still to take. */
export async function electricitySummary(user: SessionUser, propertyId?: string | null, month = monthKeyOf(new Date())) {
  const scope = await resolveScope(user, propertyId)
  const where = { organizationId: scope.organizationId, propertyId: scope.propertyId ?? { in: scope.allowedPropertyIds } }
  const [bills, activeMeters, billedRooms] = await Promise.all([
    prisma.roomElectricityBill.findMany({
      where: { ...where, billingMonth: month, status: { not: 'VOID' } },
      select: { amount: true, units: true, status: true, ownerAbsorbed: true, uncollectedAmount: true },
    }),
    prisma.electricityMeter.count({ where: { ...where, status: 'ACTIVE' } }),
    prisma.roomElectricityBill.findMany({
      where: { ...where, billingMonth: month, kind: 'REGULAR', status: { not: 'VOID' } },
      select: { roomId: true },
      distinct: ['roomId'],
    }),
  ])
  return {
    month,
    amount: bills.reduce((s, b) => s + b.amount, 0),
    units: bills.reduce((s, b) => s + dec(b.units), 0),
    drafts: bills.filter((b) => b.status === 'DRAFT').length,
    finalized: bills.filter((b) => b.status === 'FINALIZED').length,
    ownerCost: bills.reduce((s, b) => s + (b.ownerAbsorbed ? b.amount : b.uncollectedAmount), 0),
    activeMeters,
    readingsDue: Math.max(0, activeMeters - billedRooms.length),
  }
}

/** Units and amount per month for the last `months` months (finalized and draft). */
export async function electricityTrend(user: SessionUser, propertyId?: string | null, months = 6) {
  const scope = await resolveScope(user, propertyId)
  const now = new Date()
  const keys = Array.from({ length: months }, (_, i) => monthKeyOf(new Date(now.getFullYear(), now.getMonth() - (months - 1 - i), 1)))
  const rows = await prisma.roomElectricityBill.groupBy({
    by: ['billingMonth'],
    where: {
      organizationId: scope.organizationId,
      propertyId: scope.propertyId ?? { in: scope.allowedPropertyIds },
      billingMonth: { in: keys },
      status: { not: 'VOID' },
    },
    _sum: { amount: true, units: true },
  })
  const byMonth = new Map(rows.map((r) => [r.billingMonth, r]))
  return keys.map((k) => ({
    month: k,
    label: billingMonthLabel(k),
    amount: byMonth.get(k)?._sum.amount ?? 0,
    units: byMonth.get(k)?._sum.units ? dec(byMonth.get(k)!._sum.units!) : 0,
  }))
}

/** CSV rows for /api/exports/electricity: one row per resident share. */
export async function electricityExportRows(user: SessionUser, filters: BillFilters) {
  const bills = await listBills(user, filters)
  return bills.flatMap((b) => {
    const base = [
      b.property.name,
      b.room.number,
      b.meterNumber,
      billingMonthLabel(b.billingMonth),
      b.kind === 'INTERIM' ? 'Checkout' : 'Monthly',
      formatDate(b.periodStart),
      formatDate(b.periodEnd),
      b.previousReading,
      b.currentReading,
      b.units,
      b.ratePerUnit,
      b.amount,
      b.occupantCount,
      b.status,
    ]
    if (!b.shares.length) return [[...base, b.ownerAbsorbed ? 'Owner pays' : '', '', '', '']]
    return b.shares.map((s) => [...base, s.residentName, s.daysStayed, s.shareAmount, s.paymentStatus])
  })
}

export const ELECTRICITY_EXPORT_HEADER = [
  'PG',
  'Room',
  'Meter',
  'Month',
  'Type',
  'From',
  'To',
  'Previous reading',
  'Current reading',
  'Units',
  'Rate per unit',
  'Room bill',
  'People',
  'Bill status',
  'Resident',
  'Days',
  'Share',
  'Payment',
]

/** Parses a JSON request body with a schema and returns the parsed (output) value. */
export async function readBody<S extends z.ZodTypeAny>(request: Request, schema: S): Promise<z.output<S>> {
  let json: unknown
  try {
    json = await request.json()
  } catch {
    throw new ValidationError('Request body must be valid JSON')
  }
  return schema.parse(json)
}
