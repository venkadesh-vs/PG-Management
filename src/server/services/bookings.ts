import 'server-only'

import { z } from 'zod'
import type { Booking, PaymentMethodKind, Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type { SessionUser } from '@/lib/auth'
import { assertPropertyAccess, ConflictError, NotFoundError, ValidationError } from '@/lib/tenancy'
import { addDays, endOfDay, formatDate, formatMoney, startOfDay } from '@/lib/utils'
import { notifyOrgAdmins, recordActivity } from '../events'
import { nextCounterNumber, retryOnUniqueConflict } from './billing'
import {
  addLeadActivity,
  findOpenLeadByPhone,
  getLeadForUser,
  phoneKey,
  setLeadStatus,
} from './leads'

/**
 * Bed bookings (PRD §32). A CONFIRMED booking holds a bed (status RESERVED)
 * until check-in, cancellation or expiry. The token is money received before
 * check-in; on check-in it becomes the resident's first rent payment.
 */

type Tx = Prisma.TransactionClient

export const TOKEN_METHODS = ['CASH', 'UPI', 'BANK_TRANSFER', 'CARD', 'CHEQUE'] as const
export const ACTIVE_BOOKING_STATUSES = ['PENDING', 'CONFIRMED'] as const

const phone = z
  .string()
  .trim()
  .regex(/^(\+?91[-\s]?)?[6-9]\d{9}$/, 'Enter a valid 10-digit mobile number')
const rupees = z.coerce.number().int('Enter a whole rupee amount').min(0, 'Cannot be negative')
const optionalText = z.string().trim().max(1000).optional().or(z.literal(''))

export const bookingCreateSchema = z.object({
  leadId: z.string().optional().or(z.literal('')),
  propertyId: z.string().min(1, 'Choose a PG'),
  bedId: z.string().optional().or(z.literal('')),
  name: z.string().trim().min(2, 'Enter their name').max(120),
  phone,
  email: z.string().trim().email('Enter a valid email address').optional().or(z.literal('')),
  checkInDate: z.string().min(1, 'Choose the check-in date'),
  rent: rupees.refine((v) => v > 0, 'Rent must be greater than zero'),
  deposit: rupees.default(0),
  tokenAmount: rupees.default(0),
  tokenReceived: z.boolean().default(false),
  tokenMethod: z.enum(TOKEN_METHODS).optional(),
  tokenReference: optionalText,
  expiresAt: z.string().optional().or(z.literal('')),
  /** False saves a tentative (PENDING) booking that does not hold a bed yet. */
  confirm: z.boolean().default(true),
  notes: optionalText,
})
export type BookingCreateInput = z.infer<typeof bookingCreateSchema>

export const bookingActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('RECORD_TOKEN'),
    amount: rupees.refine((v) => v > 0, 'Enter the token amount'),
    method: z.enum(TOKEN_METHODS),
    reference: optionalText,
    paidAt: z.string().optional().or(z.literal('')),
  }),
  z.object({ action: z.literal('CONFIRM'), bedId: z.string().optional().or(z.literal('')) }),
  z.object({ action: z.literal('CANCEL'), reason: z.string().trim().min(2, 'Tell us why').max(500) }),
  z.object({ action: z.literal('EXTEND'), expiresAt: z.string().min(1, 'Pick the new expiry date') }),
])
export type BookingAction = z.infer<typeof bookingActionSchema>

/** Booking hold length: 3 days without a token, 7 with one. */
export function defaultExpiry(checkInDate: Date, withToken: boolean, now = new Date()) {
  const base = checkInDate > now ? checkInDate : now
  return endOfDay(addDays(base, withToken ? 7 : 3))
}

/** BK-0001, BK-0002… from the per-organization counter. */
async function nextBookingCode(tx: Tx, organizationId: string) {
  const head = 'BK-'
  return nextCounterNumber(tx, {
    key: `booking:${organizationId}`,
    head,
    taken: async (code) =>
      Boolean(
        await tx.booking.findUnique({
          where: { organizationId_code: { organizationId, code } },
          select: { id: true },
        }),
      ),
    used: async () =>
      (
        await tx.booking.findMany({
          where: { organizationId, code: { startsWith: head } },
          select: { code: true },
        })
      ).map((b) => b.code),
  })
}

/**
 * Atomically moves a free bed to RESERVED. A concurrent booking or check-in
 * blocks on the row, then matches nothing.
 */
async function claimBed(tx: Tx, bedId: string, propertyId: string) {
  const bed = await tx.bed.findFirst({
    where: { id: bedId, propertyId },
    include: { room: { select: { number: true } } },
  })
  if (!bed) throw new NotFoundError('That bed is not in this PG')
  const claim = await tx.bed.updateMany({
    where: { id: bed.id, status: 'AVAILABLE', residentId: null },
    data: { status: 'RESERVED' },
  })
  if (claim.count !== 1) throw new ConflictError('That bed was just taken — pick another one')
  return bed
}

/** Puts a bed held by a booking back on the market. */
export async function releaseBookedBed(tx: Tx, bookingId: string, bedId: string | null) {
  if (!bedId) return false
  // Another live booking might hold the same bed (should not happen, but a
  // release must never free a bed someone else is counting on).
  const other = await tx.booking.findFirst({
    where: { bedId, id: { not: bookingId }, status: { in: ['CONFIRMED'] } },
    select: { id: true },
  })
  if (other) return false
  const released = await tx.bed.updateMany({
    where: { id: bedId, status: 'RESERVED', residentId: null },
    data: { status: 'AVAILABLE' },
  })
  return released.count === 1
}

export function bedName(bed: { label: string; room: { number: string } } | null | undefined) {
  return bed ? `${bed.room.number}-${bed.label}` : null
}

export async function getBookingForUser(user: SessionUser, id: string) {
  const booking = await prisma.booking.findFirst({
    where: { id, organizationId: user.organizationId ?? '__none__' },
    include: {
      bed: { include: { room: { select: { number: true } } } },
      property: { select: { id: true, name: true } },
      lead: { select: { id: true, status: true, name: true } },
    },
  })
  if (!booking) throw new NotFoundError('Booking not found')
  await assertPropertyAccess(user, booking.propertyId)
  return booking
}

// --------------------------------------------------------------------------
// Create
// --------------------------------------------------------------------------

export async function createBooking(user: SessionUser, input: BookingCreateInput) {
  const organizationId = user.organizationId!
  await assertPropertyAccess(user, input.propertyId)
  const lead = input.leadId ? await getLeadForUser(user, input.leadId) : null
  if (lead && (lead.status === 'CHECKED_IN' || lead.status === 'LOST')) {
    throw new ConflictError(
      lead.status === 'LOST'
        ? `${lead.name} is marked lost. Reopen the enquiry first.`
        : `${lead.name} has already checked in`,
    )
  }
  if (input.confirm && !input.bedId) throw new ValidationError('Pick a free bed to hold')

  const checkInDate = startOfDay(new Date(input.checkInDate))
  if (Number.isNaN(checkInDate.getTime())) throw new ValidationError('Enter a valid check-in date')
  const token = input.tokenReceived ? input.tokenAmount : 0
  if (input.tokenReceived && token <= 0) throw new ValidationError('Enter the token amount received')
  if (input.tokenReceived && !input.tokenMethod) throw new ValidationError('How was the token paid?')

  const expiresAt = input.expiresAt
    ? endOfDay(new Date(input.expiresAt))
    : defaultExpiry(checkInDate, token > 0)
  if (Number.isNaN(expiresAt.getTime()) || expiresAt < new Date()) {
    throw new ValidationError('The hold must expire in the future')
  }

  const actorName = user.name
  const booking = await retryOnUniqueConflict(
    () =>
      prisma.$transaction(async (tx) => {
        const property = await tx.property.findFirst({
          where: { id: input.propertyId, organizationId, archivedAt: null },
          select: { id: true, name: true },
        })
        if (!property) throw new NotFoundError('PG not found')

        // An open booking for the same lead blocks a second one.
        if (lead) {
          const live = await tx.booking.findFirst({
            where: { leadId: lead.id, status: { in: [...ACTIVE_BOOKING_STATUSES] } },
            select: { code: true },
          })
          if (live) throw new ConflictError(`${lead.name} already has booking ${live.code}`)
        }

        const bed = input.bedId ? await tx.bed.findFirst({
          where: { id: input.bedId, propertyId: property.id },
          include: { room: { select: { number: true } } },
        }) : null
        if (input.bedId && !bed) throw new NotFoundError('That bed is not in this PG')
        if (input.confirm && bed) await claimBed(tx, bed.id, property.id)
        else if (bed && (bed.status !== 'AVAILABLE' || bed.residentId)) {
          throw new ConflictError('That bed is no longer free — pick another one')
        }

        // A fresh booking whose phone matches an open enquiry joins that
        // enquiry, so the pipeline and conversion numbers stay true.
        const linkedLead =
          lead ?? (await findOpenLeadByPhone(organizationId, input.phone, tx).then((l) =>
            l && (!l.propertyId || l.propertyId === property.id) ? l : null,
          ))
        if (!lead && linkedLead) {
          const live = await tx.booking.findFirst({
            where: { leadId: linkedLead.id, status: { in: [...ACTIVE_BOOKING_STATUSES] } },
            select: { id: true },
          })
          if (live) throw new ConflictError(`${linkedLead.name} already has an open booking`)
        }

        const code = await nextBookingCode(tx, organizationId)
        const created = await tx.booking.create({
          data: {
            organizationId,
            propertyId: property.id,
            leadId: linkedLead?.id ?? null,
            bedId: bed?.id ?? null,
            code,
            name: input.name.trim(),
            phone: phoneKey(input.phone),
            email: input.email?.trim() || null,
            checkInDate,
            rent: input.rent,
            deposit: input.deposit,
            tokenAmount: token,
            tokenPaidAt: token > 0 ? new Date() : null,
            tokenMethod: token > 0 ? input.tokenMethod : null,
            tokenReference: token > 0 ? input.tokenReference || null : null,
            status: input.confirm ? 'CONFIRMED' : 'PENDING',
            expiresAt,
            notes: input.notes || null,
            createdBy: actorName,
          },
          include: {
            bed: { include: { room: { select: { number: true } } } },
            property: { select: { id: true, name: true } },
          },
        })

        if (linkedLead) {
          await setLeadStatus(tx, linkedLead, token > 0 ? 'TOKEN_PAID' : 'BOOKED', actorName, {
            property: { connect: { id: property.id } },
            moveInDate: checkInDate,
            nextFollowUpAt: null,
          })
          await addLeadActivity(
            tx,
            linkedLead.id,
            'BOOKING',
            `Booking ${code} created${bed ? ` · bed ${bedName(created.bed)} held` : ''}${token > 0 ? ` · token ${formatMoney(token)} received` : ''}`,
            actorName,
          )
        }

        await recordActivity(
          {
            organizationId,
            propertyId: property.id,
            actorId: user.id,
            actorName,
            actorRole: user.role,
            event: 'LEAD_UPDATED',
            entityType: 'Booking',
            entityId: created.id,
            summary: `Booking ${code} for ${created.name}${created.bed ? ` · bed ${bedName(created.bed)} reserved` : ''}`,
            meta: { code, token, rent: input.rent },
          },
          tx,
        )
        return created
      }),
    ['code'],
  )

  return { booking, message: bookingMessage(booking) }
}

function bookingMessage(booking: Pick<Booking, 'code' | 'name' | 'status' | 'expiresAt'> & {
  bed: { label: string; room: { number: string } } | null
}) {
  const first = booking.name.split(' ')[0]
  if (booking.status === 'CONFIRMED' && booking.bed) {
    return `Booking ${booking.code} confirmed — bed ${bedName(booking.bed)} is reserved for ${first} until ${formatDate(booking.expiresAt)}`
  }
  return `Booking ${booking.code} saved for ${first}. Confirm it to hold a bed.`
}

// --------------------------------------------------------------------------
// Actions
// --------------------------------------------------------------------------

export async function updateBooking(user: SessionUser, id: string, input: BookingAction) {
  const booking = await getBookingForUser(user, id)
  const actorName = user.name
  const active = booking.status === 'PENDING' || booking.status === 'CONFIRMED'

  const result = await prisma.$transaction(async (tx) => {
    switch (input.action) {
      case 'RECORD_TOKEN': {
        if (!active) throw new ConflictError(`Booking ${booking.code} is ${booking.status.toLowerCase()}`)
        if (booking.tokenAmount > 0 && booking.tokenPaidAt) {
          throw new ConflictError(`A token of ${formatMoney(booking.tokenAmount)} is already recorded`)
        }
        const paidAt = input.paidAt ? new Date(input.paidAt) : new Date()
        // A token buys a longer hold.
        const longer = defaultExpiry(booking.checkInDate, true)
        const updated = await tx.booking.update({
          where: { id: booking.id },
          data: {
            tokenAmount: input.amount,
            tokenPaidAt: paidAt,
            tokenMethod: input.method,
            tokenReference: input.reference || null,
            expiresAt: !booking.expiresAt || booking.expiresAt < longer ? longer : booking.expiresAt,
          },
        })
        if (booking.leadId && booking.lead) {
          if (booking.lead.status === 'BOOKED') {
            await setLeadStatus(tx, booking.lead, 'TOKEN_PAID', actorName)
          }
          await addLeadActivity(
            tx,
            booking.leadId,
            'BOOKING',
            `Token ${formatMoney(input.amount)} received (${input.method.replace('_', ' ').toLowerCase()}) for ${booking.code}`,
            actorName,
          )
        }
        return {
          booking: updated,
          message: `Token of ${formatMoney(input.amount)} recorded for ${booking.code}. It counts as ${booking.name.split(' ')[0]}’s first rent payment at check-in.`,
        }
      }
      case 'CONFIRM': {
        if (booking.status !== 'PENDING') throw new ConflictError(`Booking ${booking.code} is ${booking.status.toLowerCase()}`)
        const bedId = input.bedId || booking.bedId
        if (!bedId) throw new ValidationError('Pick a free bed to hold')
        const bed = await claimBed(tx, bedId, booking.propertyId)
        const expiresAt =
          booking.expiresAt && booking.expiresAt > new Date()
            ? booking.expiresAt
            : defaultExpiry(booking.checkInDate, booking.tokenAmount > 0)
        const updated = await tx.booking.update({
          where: { id: booking.id },
          data: { status: 'CONFIRMED', bedId: bed.id, expiresAt },
        })
        if (booking.leadId) {
          await addLeadActivity(tx, booking.leadId, 'BOOKING', `Booking ${booking.code} confirmed · bed ${bedName(bed)} held`, actorName)
        }
        return {
          booking: updated,
          message: `Booking ${booking.code} confirmed — bed ${bedName(bed)} is reserved for ${booking.name.split(' ')[0]} until ${formatDate(expiresAt)}`,
        }
      }
      case 'CANCEL': {
        if (!active) throw new ConflictError(`Booking ${booking.code} is already ${booking.status.toLowerCase()}`)
        const updated = await tx.booking.update({
          where: { id: booking.id },
          data: { status: 'CANCELLED', cancelReason: input.reason },
        })
        const released = booking.status === 'CONFIRMED' ? await releaseBookedBed(tx, booking.id, booking.bedId) : false
        if (booking.leadId && booking.lead) {
          if (booking.lead.status === 'BOOKED' || booking.lead.status === 'TOKEN_PAID') {
            await setLeadStatus(tx, booking.lead, 'INTERESTED', actorName, { nextFollowUpAt: new Date() })
          }
          await addLeadActivity(tx, booking.leadId, 'BOOKING', `Booking ${booking.code} cancelled — ${input.reason}`, actorName)
        }
        const tokenNote = booking.tokenAmount > 0 ? ` Settle the ${formatMoney(booking.tokenAmount)} token with them.` : ''
        return {
          booking: updated,
          message: `Booking ${booking.code} cancelled${released && booking.bed ? ` and bed ${bedName(booking.bed)} is free again` : ''}.${tokenNote}`,
        }
      }
      case 'EXTEND': {
        if (!active) throw new ConflictError(`Booking ${booking.code} is ${booking.status.toLowerCase()}`)
        const expiresAt = endOfDay(new Date(input.expiresAt))
        if (Number.isNaN(expiresAt.getTime()) || expiresAt < new Date()) {
          throw new ValidationError('Pick a date in the future')
        }
        const updated = await tx.booking.update({ where: { id: booking.id }, data: { expiresAt } })
        if (booking.leadId) {
          await addLeadActivity(tx, booking.leadId, 'BOOKING', `Hold on ${booking.code} extended to ${formatDate(expiresAt)}`, actorName)
        }
        return { booking: updated, message: `Hold extended — ${booking.code} now expires ${formatDate(expiresAt)}` }
      }
    }
  })

  await recordActivity({
    organizationId: booking.organizationId,
    propertyId: booking.propertyId,
    actorId: user.id,
    actorName,
    actorRole: user.role,
    event: input.action === 'CANCEL' && booking.bedId ? 'BED_RELEASED' : 'LEAD_UPDATED',
    entityType: 'Booking',
    entityId: booking.id,
    summary: result.message,
  }).catch(() => undefined)

  return result
}

// --------------------------------------------------------------------------
// Automation: expire stale holds
// --------------------------------------------------------------------------

export async function expireBookings(params?: { organizationId?: string; now?: Date }) {
  const now = params?.now ?? new Date()
  const stale = await prisma.booking.findMany({
    where: {
      ...(params?.organizationId ? { organizationId: params.organizationId } : {}),
      status: { in: [...ACTIVE_BOOKING_STATUSES] },
      expiresAt: { lt: now },
    },
    include: {
      bed: { include: { room: { select: { number: true } } } },
      lead: { select: { id: true, status: true } },
    },
    take: 500,
  })

  let expired = 0
  let released = 0
  for (const booking of stale) {
    try {
      await prisma.$transaction(async (tx) => {
        // Conditional update: a check-in racing the sweep wins.
        const hit = await tx.booking.updateMany({
          where: { id: booking.id, status: { in: [...ACTIVE_BOOKING_STATUSES] } },
          data: { status: 'EXPIRED' },
        })
        if (hit.count !== 1) return
        expired++
        if (booking.status === 'CONFIRMED' && (await releaseBookedBed(tx, booking.id, booking.bedId))) released++
        if (booking.lead && (booking.lead.status === 'BOOKED' || booking.lead.status === 'TOKEN_PAID')) {
          await setLeadStatus(tx, booking.lead, 'INTERESTED', 'Automation', { nextFollowUpAt: now })
        }
        if (booking.leadId) {
          await addLeadActivity(tx, booking.leadId, 'BOOKING', `Booking ${booking.code} expired — the hold ran out`, 'Automation')
        }
        await recordActivity(
          {
            organizationId: booking.organizationId,
            propertyId: booking.propertyId,
            actorName: 'Automation',
            event: booking.bedId ? 'BED_RELEASED' : 'LEAD_UPDATED',
            entityType: 'Booking',
            entityId: booking.id,
            summary: `Booking ${booking.code} for ${booking.name} expired${booking.bed ? ` · bed ${bedName(booking.bed)} released` : ''}`,
          },
          tx,
        )
        await notifyOrgAdmins(
          booking.organizationId,
          {
            kind: 'LEAD',
            title: `Booking ${booking.code} expired`,
            body: `${booking.name}’s hold ran out${booking.bed ? `, so bed ${bedName(booking.bed)} is free again` : ''}.${booking.tokenAmount > 0 ? ` A token of ${formatMoney(booking.tokenAmount)} was paid.` : ''}`,
            link: '/app/bookings?status=EXPIRED',
          },
          tx,
        )
      })
    } catch (error) {
      console.error('[bookings] expiry failed', { bookingId: booking.id, error })
    }
  }
  return { expired, released }
}

/** Token payment details for check-in conversion. */
export function tokenPaymentMethod(method: string | null | undefined): PaymentMethodKind {
  return (TOKEN_METHODS as readonly string[]).includes(method ?? '') ? (method as PaymentMethodKind) : 'CASH'
}
