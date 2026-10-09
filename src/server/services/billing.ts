import 'server-only'

import { Prisma } from '@prisma/client'
import type {
  InvoiceLineKind,
  LedgerEntryKind,
  PaymentMethodKind,
  RentInvoice,
  Resident,
} from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/tenancy'
import { notifyOrgAdmins, notifyResident, recordActivity } from '../events'
import { isChannelOn, parseNotificationPrefs } from '@/lib/notification-prefs'
import {
  addDays,
  dayOfMonth,
  endOfDay,
  endOfMonth,
  formatMoney,
  formatMonth,
  startOfDay,
  startOfMonth,
} from '@/lib/utils'
import { buildUpiLink, sendWhatsApp } from '../integrations/whatsapp'
import {
  applyAdjustment,
  chargeLinesForPeriod,
  dailyCollection,
  isLikelyDuplicate,
  planAllocation,
  releaseAllocations,
  reverseAllocations,
  revisionDelta,
  composeInvoice,
  prorationFor,
  rentSegments,
  unallocatedOf,
  type Proration,
  type RevisionLike,
} from '@/lib/billing-calc'

type Tx = Prisma.TransactionClient

/**
 * Rent, payments and the resident ledger.
 *
 * Every write here is transactional: an invoice, its lines and its ledger
 * entry are one unit, and so are a payment, its allocations, the invoice
 * updates and the ledger credit. That is what lets the dashboard be a pure
 * projection of the database rather than a set of hand-maintained counters.
 */

// --------------------------------------------------------------------------
// Numbering
// --------------------------------------------------------------------------

async function nextSequence(tx: Tx, key: string, floor = 1): Promise<number> {
  // A row-level counter keeps numbers gapless and race-free: the upsert locks
  // the counter row until the transaction commits, so concurrent callers queue.
  // `floor` lets a caller jump the counter past numbers it did not issue.
  const rows = await tx.$queryRaw<{ value: unknown }[]>`
    INSERT INTO "SystemSetting" ("id", "key", "value", "updatedAt")
    VALUES (gen_random_uuid()::text, ${key}, to_jsonb(${floor}::int), NOW())
    ON CONFLICT ("key")
    DO UPDATE SET "value" = to_jsonb(GREATEST((("SystemSetting"."value")::text)::int + 1, ${floor}::int)), "updatedAt" = NOW()
    RETURNING "value"
  `
  return Number(rows[0]?.value ?? floor)
}

/**
 * Issues `<head><0001>` from a per-organization counter. If the counter is
 * behind numbers that already exist (seeded or imported rows, a reset
 * counter), it jumps past the highest one in use instead of colliding.
 */
export async function nextCounterNumber(
  tx: Tx,
  params: {
    key: string
    head: string
    taken: (candidate: string) => Promise<boolean>
    used: () => Promise<string[]>
  },
) {
  const format = (n: number) => `${params.head}${String(n).padStart(4, '0')}`
  const first = format(await nextSequence(tx, params.key))
  if (!(await params.taken(first))) return first

  const max = (await params.used()).reduce((m, value) => {
    const suffix = value.slice(params.head.length)
    return /^\d+$/.test(suffix) ? Math.max(m, Number(suffix)) : m
  }, 0)
  return format(await nextSequence(tx, params.key, max + 1))
}

function monthStamp(date: Date) {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}`
}

export async function nextInvoiceNumber(tx: Tx, orgId: string, prefix: string, date: Date) {
  const stamp = monthStamp(date)
  const head = `${prefix}-${stamp}-`
  return nextCounterNumber(tx, {
    key: `invoice:${orgId}:${stamp}`,
    head,
    taken: async (number) =>
      Boolean(
        await tx.rentInvoice.findUnique({
          where: { organizationId_number: { organizationId: orgId, number } },
          select: { id: true },
        }),
      ),
    used: async () =>
      (
        await tx.rentInvoice.findMany({
          where: { organizationId: orgId, number: { startsWith: head } },
          select: { number: true },
        })
      ).map((r) => r.number),
  })
}

export async function nextReceiptNumber(tx: Tx, orgId: string, prefix: string, date: Date) {
  const stamp = monthStamp(date)
  const head = `${prefix}-${stamp}-`
  return nextCounterNumber(tx, {
    key: `receipt:${orgId}:${stamp}`,
    head,
    taken: async (receiptNumber) =>
      Boolean(
        await tx.rentPayment.findUnique({
          where: { organizationId_receiptNumber: { organizationId: orgId, receiptNumber } },
          select: { id: true },
        }),
      ),
    used: async () =>
      (
        await tx.rentPayment.findMany({
          where: { organizationId: orgId, receiptNumber: { startsWith: head } },
          select: { receiptNumber: true },
        })
      ).map((r) => r.receiptNumber),
  })
}

/** True when `error` is a unique violation on any of `fields`. */
export function isUniqueViolation(error: unknown, fields?: string[]) {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
    return false
  }
  if (!fields?.length) return true
  const target = error.meta?.target
  // No target reported: assume it is ours rather than skip a safe retry.
  if (target == null) return true
  const text = Array.isArray(target) ? target.join(',') : String(target)
  return fields.some((f) => text.includes(f))
}

/**
 * Re-runs a whole transaction when it loses a race on a unique number.
 * Postgres aborts the transaction on the violation, so the retry must start
 * a fresh one — retrying inside it would only hit "transaction aborted".
 */
export async function retryOnUniqueConflict<T>(
  fn: () => Promise<T>,
  fields: string[],
  attempts = 5,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn()
    } catch (error) {
      if (attempt >= attempts || !isUniqueViolation(error, fields)) throw error
    }
  }
}

// --------------------------------------------------------------------------
// Ledger
// --------------------------------------------------------------------------

/**
 * Appends an entry and carries the running balance forward.
 * Positive balance = the resident owes money.
 */
export async function appendLedger(
  tx: Tx,
  params: {
    organizationId: string
    residentId: string
    kind: LedgerEntryKind
    label: string
    debit?: number
    credit?: number
    entryDate?: Date
    refType?: string
    refId?: string
  },
) {
  const last = await tx.residentLedger.findFirst({
    where: { residentId: params.residentId },
    orderBy: [{ entryDate: 'desc' }, { createdAt: 'desc' }],
    select: { balance: true },
  })
  const debit = params.debit ?? 0
  const credit = params.credit ?? 0
  const balance = (last?.balance ?? 0) + debit - credit

  return tx.residentLedger.create({
    data: {
      organizationId: params.organizationId,
      residentId: params.residentId,
      kind: params.kind,
      label: params.label,
      debit,
      credit,
      balance,
      entryDate: params.entryDate ?? new Date(),
      refType: params.refType,
      refId: params.refId,
    },
  })
}

/** Recomputes every running balance for a resident, oldest first. */
export async function rebuildLedger(tx: Tx, residentId: string) {
  const entries = await tx.residentLedger.findMany({
    where: { residentId },
    orderBy: [{ entryDate: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, debit: true, credit: true },
  })
  let balance = 0
  for (const entry of entries) {
    balance += entry.debit - entry.credit
    await tx.residentLedger.update({ where: { id: entry.id }, data: { balance } })
  }
  return balance
}

export async function outstandingFor(residentId: string): Promise<number> {
  const agg = await prisma.rentInvoice.aggregate({
    where: { residentId, status: { in: ['PENDING', 'PARTIALLY_PAID', 'OVERDUE'] } },
    _sum: { balance: true },
  })
  return agg._sum.balance ?? 0
}

// --------------------------------------------------------------------------
// Invoice generation
// --------------------------------------------------------------------------

export type InvoiceLineInput = {
  kind: InvoiceLineKind
  label: string
  quantity?: number
  unitPrice: number
}

/**
 * Builds the charge lines for one billing period from the resident's own
 * configuration. Pro-rates the first month from the joining date so a
 * resident who moves in on the 18th is not billed a full month.
 */
export function buildInvoiceLines(
  resident: Pick<
    Resident,
    'rentAmount' | 'maintenanceFee' | 'foodOptIn' | 'foodCharge' | 'discountAmount' | 'joiningDate'
  >,
  periodStart: Date,
  periodEnd: Date,
  revisions: RevisionLike[] = [],
): { lines: InvoiceLineInput[]; subtotal: number; discount: number; proration: Proration } {
  const lines: InvoiceLineInput[] = []
  const proration = prorationFor(new Date(resident.joiningDate), periodStart, periodEnd)
  const { totalDays, billableDays, factor, proRated } = proration

  // A rent revision taking effect mid-month splits the rent into runs, each
  // priced pro-rata; with no revision in the month this is one plain line.
  const segments = rentSegments(periodStart, proration, resident.rentAmount, revisions)
  if (segments.length === 1) {
    lines.push({
      kind: 'RENT',
      label: proRated
        ? `Room rent — ${formatMonth(periodStart)} (${billableDays}/${totalDays} days)`
        : `Room rent — ${formatMonth(periodStart)}`,
      unitPrice: segments[0].amount,
    })
  } else {
    for (const seg of segments) {
      lines.push({
        kind: 'RENT',
        label: `Room rent — ${formatMonth(periodStart)} (days ${seg.fromDay}–${seg.toDay} at ${formatMoney(seg.monthlyRent)}/month)`,
        unitPrice: seg.amount,
      })
    }
  }

  if (resident.maintenanceFee > 0) {
    lines.push({
      kind: 'MAINTENANCE',
      label: 'Maintenance',
      unitPrice: Math.round(resident.maintenanceFee * factor),
    })
  }

  if (resident.foodOptIn && resident.foodCharge > 0) {
    lines.push({
      kind: 'FOOD',
      label: proRated ? `Food plan (${billableDays}/${totalDays} days)` : 'Food plan',
      unitPrice: Math.round(resident.foodCharge * factor),
    })
  }

  const subtotal = lines.reduce((sum, l) => sum + l.unitPrice * (l.quantity ?? 1), 0)
  const discount = Math.min(resident.discountAmount ?? 0, subtotal)

  return { lines, subtotal, discount, proration }
}

/**
 * Creates (or returns the existing) invoice for a resident and period.
 * Idempotent on `(residentId, periodStart)` so re-running the automation is
 * always safe.
 */
export async function generateInvoice(params: {
  residentId: string
  periodStart: Date
  actor?: { id?: string; name?: string }
  autoGenerated?: boolean
}) {
  const periodStart = startOfMonth(params.periodStart)
  // Date-only columns hold IST midnight, so the period ends at the start of
  // its last day (comparisons against startOfDay values stay inclusive).
  const periodEnd = startOfDay(endOfMonth(periodStart))

  // A clash on the number or on (resident, period) retries the whole thing;
  // the second case then finds the invoice a concurrent run just created.
  return retryOnUniqueConflict(() => generateInvoiceOnce(params, periodStart, periodEnd), [
    'number',
    'periodStart',
  ])
}

async function generateInvoiceOnce(
  params: { residentId: string; actor?: { id?: string; name?: string }; autoGenerated?: boolean },
  periodStart: Date,
  periodEnd: Date,
) {
  return prisma.$transaction(async (tx) => {
    const resident = await tx.resident.findUnique({
      where: { id: params.residentId },
      include: { organization: { include: { settings: true } }, property: true },
    })
    if (!resident) throw new NotFoundError('Resident not found')
    if (resident.status === 'CHECKED_OUT') {
      throw new ConflictError('Resident has already checked out')
    }

    const existing = await tx.rentInvoice.findUnique({
      where: { residentId_periodStart: { residentId: resident.id, periodStart } },
    })
    if (existing) return { invoice: existing, created: false }

    // Nothing to bill for a period that ends before the resident joined.
    if (startOfDay(new Date(resident.joiningDate)) > periodEnd) {
      return { invoice: null, created: false }
    }

    const settings = resident.organization.settings
    const dueDay = resident.rentDueDay || settings?.rentDueDay || 5
    const regularDue = startOfDay(dayOfMonth(periodStart.getFullYear(), periodStart.getMonth(), dueDay))
    // Someone who joins after this month's due day can't already be late on their first
    // invoice: it falls due on the joining day instead (usually paid at check-in).
    const joinedOn = startOfDay(new Date(resident.joiningDate))
    const dueDate = joinedOn > regularDue && joinedOn <= periodEnd ? joinedOn : regularDue

    // Rent (with any revision in force), the resident's charges and discounts.
    const [revisions, charges] = await Promise.all([
      tx.rentRevision.findMany({
        where: { residentId: resident.id },
        select: { oldRent: true, newRent: true, effectiveFrom: true },
      }),
      tx.residentCharge.findMany({ where: { residentId: resident.id, voidedAt: null } }),
    ])
    const base = buildInvoiceLines(resident, periodStart, periodEnd, revisions)
    const billing = chargeLinesForPeriod(charges, periodStart, periodEnd, base.proration)
    const { lines, subtotal, discount, total } = composeInvoice(
      base.lines,
      billing,
      resident.discountAmount ?? 0,
      resident.discountNote ? `Discount — ${resident.discountNote}` : 'Discount',
    )

    const number = await nextInvoiceNumber(
      tx,
      resident.organizationId,
      settings?.invoicePrefix ?? 'INV',
      periodStart,
    )

    const created = await tx.rentInvoice.create({
      data: {
        organizationId: resident.organizationId,
        propertyId: resident.propertyId,
        residentId: resident.id,
        number,
        periodStart: startOfDay(periodStart),
        periodEnd: startOfDay(periodEnd),
        issueDate: startOfDay(new Date()) < periodStart ? periodStart : startOfDay(new Date()),
        dueDate,
        status: 'PENDING',
        subtotal,
        discount,
        total,
        balance: total,
        autoGenerated: params.autoGenerated ?? true,
        lines: {
          create: lines.map((l) => ({
            kind: l.kind,
            label: l.label,
            quantity: l.quantity ?? 1,
            unitPrice: l.unitPrice,
            amount: l.unitPrice * (l.quantity ?? 1),
          })),
        },
      },
      include: { lines: true },
    })

    // One-time charges bill exactly once: claim them for this invoice, and
    // back out if a concurrent run (another month) got there first.
    if (billing.oneTimeIds.length) {
      const claimed = await tx.residentCharge.updateMany({
        where: { id: { in: billing.oneTimeIds }, billedInvoiceId: null, voidedAt: null },
        data: { billedInvoiceId: created.id, lastBilledFor: periodStart },
      })
      if (claimed.count !== billing.oneTimeIds.length) {
        throw new ConflictError('Charges changed while the invoice was being created. Please try again.')
      }
    }
    const recurringIds = [...billing.recurringIds, ...billing.discountIds]
    if (recurringIds.length) {
      await tx.residentCharge.updateMany({
        where: { id: { in: recurringIds } },
        data: { lastBilledFor: periodStart },
      })
    }

    await appendLedger(tx, {
      organizationId: resident.organizationId,
      residentId: resident.id,
      kind: 'CHARGE',
      label: `Invoice ${number} — ${formatMonth(periodStart)}`,
      debit: total,
      entryDate: created.issueDate,
      refType: 'RentInvoice',
      refId: created.id,
    })

    // Money paid ahead (an overpayment left unallocated) settles the new
    // invoice straight away. The ledger already carries it as a credit.
    const invoice = await applyAdvanceToInvoice(tx, created)
    const advanceApplied = invoice.amountPaid - created.amountPaid

    await recordActivity(
      {
        organizationId: resident.organizationId,
        propertyId: resident.propertyId,
        actorId: params.actor?.id,
        actorName: params.actor?.name ?? 'Automation',
        event: 'RENT_GENERATED',
        entityType: 'RentInvoice',
        entityId: invoice.id,
        summary: `${invoice.number} for ${resident.fullName} — ${formatMoney(total)}`,
        meta: {
          residentId: resident.id,
          total,
          period: formatMonth(periodStart),
          advanceApplied,
        },
      },
      tx,
    )

    const due = dueDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'long' })
    await notifyResident(
      resident.id,
      {
        organizationId: resident.organizationId,
        kind: 'RENT',
        title: `Rent for ${formatMonth(periodStart)}`,
        body:
          invoice.balance <= 0
            ? `${formatMoney(total)} — fully covered by your advance payment.`
            : advanceApplied > 0
              ? `${formatMoney(total)} (${formatMoney(advanceApplied)} covered by your advance) — ${formatMoney(invoice.balance)} is due on ${due}.`
              : `${formatMoney(total)} is due on ${due}.`,
        link: '/tenant/rent',
      },
      tx,
    )

    return { invoice, created: true }
  })
}

/**
 * Allocates a resident's unallocated rent payments (oldest first) to an
 * invoice, exactly as recordPayment would have if the invoice had existed.
 * Deposits are held money and are never used for rent.
 */
export async function applyAdvanceToInvoice<T extends RentInvoice>(tx: Tx, invoice: T): Promise<T> {
  if (invoice.balance <= 0) return invoice

  // Lock this resident's payments so two invoices generated at once cannot
  // both spend the same advance.
  await tx.$queryRaw`
    SELECT "id" FROM "RentPayment" WHERE "residentId" = ${invoice.residentId} ORDER BY "id" FOR UPDATE
  `
  const payments = await tx.rentPayment.findMany({
    where: { residentId: invoice.residentId, status: 'SUCCESS', purpose: 'RENT' },
    orderBy: [{ paidAt: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      amount: true,
      refundedAmount: true,
      paidAt: true,
      allocations: { select: { amount: true } },
    },
  })

  let amountPaid = invoice.amountPaid
  let balance = invoice.balance
  let lastPaidAt: Date | null = null
  for (const payment of payments) {
    if (balance <= 0) break
    const free = unallocatedOf(payment)
    if (free <= 0) continue
    const applied = Math.min(free, balance)
    await tx.paymentAllocation.create({
      data: { paymentId: payment.id, invoiceId: invoice.id, amount: applied },
    })
    amountPaid += applied
    balance -= applied
    lastPaidAt = payment.paidAt
  }
  if (amountPaid === invoice.amountPaid) return invoice

  const cleared = balance <= 0
  const updated = await tx.rentInvoice.update({
    where: { id: invoice.id },
    data: {
      amountPaid,
      balance: Math.max(0, balance),
      status: cleared ? 'PAID' : 'PARTIALLY_PAID',
      paidAt: cleared ? lastPaidAt : null,
    },
  })
  return { ...invoice, ...updated }
}

/**
 * Generates invoices for every active resident of an organization for the
 * given month. This is what removes "create rent every month by hand".
 */
export async function generateMonthlyInvoices(params: {
  organizationId?: string
  month?: Date
  actor?: { id?: string; name?: string }
}) {
  const month = startOfMonth(params.month ?? new Date())
  const residents = await prisma.resident.findMany({
    where: {
      status: { in: ['ACTIVE', 'NOTICE'] },
      ...(params.organizationId ? { organizationId: params.organizationId } : {}),
      joiningDate: { lte: endOfMonth(month) },
    },
    select: { id: true },
  })

  let created = 0
  let skipped = 0
  // One resident's failure must not stop the run, but it must not vanish
  // either — a silently missing invoice is lost rent.
  const failures: { residentId: string; error: string }[] = []
  for (const resident of residents) {
    try {
      const result = await generateInvoice({
        residentId: resident.id,
        periodStart: month,
        actor: params.actor,
      })
      if (result.created) created++
      else skipped++
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      failures.push({ residentId: resident.id, error: message })
      console.error('[billing] invoice generation failed', {
        organizationId: params.organizationId,
        residentId: resident.id,
        month: formatMonth(month),
        error,
      })
    }
  }
  return { created, skipped, failed: failures.length, failures, total: residents.length, month }
}

// --------------------------------------------------------------------------
// Payments
// --------------------------------------------------------------------------

export type RecordPaymentInput = {
  residentId: string
  amount: number
  method: PaymentMethodKind
  paidAt?: Date
  reference?: string
  /** UPI / bank transaction reference, for reconciliation with statements. */
  utr?: string
  notes?: string
  /** Proof of payment (photo or PDF) — an /api/uploads/<id> URL. */
  attachmentUrl?: string
  /** Allocate to these invoices in order; otherwise oldest-due first. */
  invoiceIds?: string[]
  actor?: { id?: string; name?: string }
  gateway?: {
    provider: string
    orderId?: string
    paymentId?: string
    signature?: string
    isDemo: boolean
  }
}

/**
 * Records a payment and settles everything connected to it in one
 * transaction: allocations, invoice balances and statuses, the ledger, the
 * receipt number, the audit log and the notifications.
 */
export async function recordPayment(input: RecordPaymentInput) {
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new ValidationError('Payment amount must be greater than zero')
  }

  // A receipt-number clash retries with the next number. A clash on the
  // gateway payment id is NOT retried: that is a duplicate delivery.
  const result = await retryOnUniqueConflict(() => recordPaymentOnce(input), ['receiptNumber'])

  // Outbound messaging happens after commit: a WhatsApp failure must never
  // roll back a recorded payment.
  await sendWhatsApp({
    organizationId: result.resident.organizationId,
    toName: result.resident.fullName,
    toPhone: result.resident.whatsappPhone || result.resident.phone,
    template: 'payment_receipt',
    body:
      `Hi ${result.resident.fullName.split(' ')[0]} 👋\n\n` +
      `We have received your payment of ${formatMoney(result.payment.amount)}.\n` +
      `Receipt: ${result.payment.receiptNumber}\n` +
      `PG: ${result.resident.property.name}\n\n` +
      `Thank you.`,
    variables: [
      result.resident.fullName,
      formatMoney(result.payment.amount),
      result.payment.receiptNumber,
    ],
    refType: 'RentPayment',
    refId: result.payment.id,
  }).catch(() => undefined)

  return result
}

/**
 * recordPayment for a gateway-confirmed payment, idempotent on the gateway
 * payment id: the checkout callback and the webhook can both deliver the same
 * payment (even concurrently) and exactly one RentPayment results. The second
 * caller gets the existing receipt back with `duplicate: true`.
 */
export async function recordGatewayPayment(
  input: RecordPaymentInput & { gateway: NonNullable<RecordPaymentInput['gateway']> & { paymentId: string } },
): Promise<{ duplicate: boolean; payment: { id: string; receiptNumber: string; amount: number } }> {
  const select = { id: true, receiptNumber: true, amount: true } as const
  const existing = await prisma.rentPayment.findUnique({
    where: { gatewayPaymentId: input.gateway.paymentId },
    select,
  })
  if (existing) return { duplicate: true, payment: existing }
  try {
    const result = await recordPayment(input)
    return {
      duplicate: false,
      payment: {
        id: result.payment.id,
        receiptNumber: result.payment.receiptNumber,
        amount: result.payment.amount,
      },
    }
  } catch (error) {
    if (!isUniqueViolation(error, ['gatewayPaymentId'])) throw error
    const winner = await prisma.rentPayment.findUnique({
      where: { gatewayPaymentId: input.gateway.paymentId },
      select,
    })
    if (!winner) throw error
    return { duplicate: true, payment: winner }
  }
}

async function recordPaymentOnce(input: RecordPaymentInput) {
  return prisma.$transaction(async (tx) => {
    const resident = await tx.resident.findUnique({
      where: { id: input.residentId },
      include: { organization: { include: { settings: true } }, property: true },
    })
    if (!resident) throw new NotFoundError('Resident not found')

    // Lock the resident's invoices so concurrent payments (or a late fee
    // being added) cannot both read the same balance and overwrite each other.
    await tx.$queryRaw`
      SELECT "id" FROM "RentInvoice" WHERE "residentId" = ${resident.id} ORDER BY "id" FOR UPDATE
    `

    const paidAt = input.paidAt ?? new Date()

    // The same UPI/bank transfer entered twice (two staff, a double tap) is
    // refused. Gateway payments are protected by their unique payment id.
    if (!input.gateway && (input.utr || input.reference)) {
      const now = new Date()
      const recent = await tx.rentPayment.findMany({
        where: {
          residentId: resident.id,
          amount: input.amount,
          OR: [
            { paidAt: { gte: addDays(paidAt, -1), lte: addDays(paidAt, 1) } },
            { createdAt: { gte: addDays(now, -1) } },
          ],
        },
        select: { receiptNumber: true, amount: true, utr: true, reference: true, paidAt: true, createdAt: true, status: true },
      })
      const dup = isLikelyDuplicate({ amount: input.amount, utr: input.utr, reference: input.reference, paidAt }, recent, now)
      if (dup) {
        throw new ConflictError(
          `This looks like a duplicate: ${formatMoney(dup.amount)} with the same reference was already recorded as receipt ${dup.receiptNumber}. Check the payments list before recording it again.`,
        )
      }
    }

    if (input.invoiceIds?.length) {
      const owned = await tx.rentInvoice.count({
        where: { id: { in: input.invoiceIds }, residentId: resident.id },
      })
      if (owned !== new Set(input.invoiceIds).size) {
        throw new ValidationError('Some of the chosen invoices do not belong to this resident')
      }
    }

    const receiptNumber = await nextReceiptNumber(
      tx,
      resident.organizationId,
      resident.organization.settings?.receiptPrefix ?? 'RCP',
      paidAt,
    )

    const payment = await tx.rentPayment.create({
      data: {
        organizationId: resident.organizationId,
        propertyId: resident.propertyId,
        residentId: resident.id,
        receiptNumber,
        amount: input.amount,
        method: input.method,
        // Only rent payments are recorded here, so only they are allocated to
        // invoices. Deposits are recorded at check-in with purpose DEPOSIT.
        purpose: 'RENT',
        status: 'SUCCESS',
        paidAt,
        reference: input.reference,
        utr: input.utr,
        attachmentUrl: input.attachmentUrl,
        notes: input.notes,
        recordedBy: input.actor?.name,
        gatewayProvider: input.gateway?.provider,
        gatewayOrderId: input.gateway?.orderId,
        gatewayPaymentId: input.gateway?.paymentId,
        gatewaySignature: input.gateway?.signature,
        isDemo: input.gateway?.isDemo ?? false,
      },
    })

    // Allocate: explicit invoices first (in the order given), then the rest
    // oldest-due-first so the longest-overdue month clears first.
    const openInvoices = await tx.rentInvoice.findMany({
      where: {
        residentId: resident.id,
        status: { in: ['PENDING', 'PARTIALLY_PAID', 'OVERDUE'] },
        balance: { gt: 0 },
      },
      orderBy: { dueDate: 'asc' },
    })

    const plan = planAllocation(openInvoices, input.amount, input.invoiceIds)
    const remaining = plan.advance
    const touched: { number: string; applied: number; cleared: boolean }[] = []

    for (const { invoiceId, amount: applied } of plan.allocations) {
      const invoice = openInvoices.find((i) => i.id === invoiceId)!
      await tx.paymentAllocation.create({
        data: { paymentId: payment.id, invoiceId: invoice.id, amount: applied },
      })

      const amountPaid = invoice.amountPaid + applied
      const balance = invoice.total - amountPaid
      const cleared = balance <= 0

      await tx.rentInvoice.update({
        where: { id: invoice.id },
        data: {
          amountPaid,
          balance: Math.max(0, balance),
          status: cleared ? 'PAID' : 'PARTIALLY_PAID',
          paidAt: cleared ? paidAt : null,
        },
      })
      touched.push({ number: invoice.number, applied, cleared })
    }

    await appendLedger(tx, {
      organizationId: resident.organizationId,
      residentId: resident.id,
      kind: 'PAYMENT',
      label: `Payment ${receiptNumber} — ${input.method.replace('_', ' ').toLowerCase()}`,
      credit: input.amount,
      entryDate: paidAt,
      refType: 'RentPayment',
      refId: payment.id,
    })

    // An overpayment stays on the ledger as an advance (negative balance) and
    // is consumed automatically by the next invoice.
    await recordActivity(
      {
        organizationId: resident.organizationId,
        propertyId: resident.propertyId,
        actorId: input.actor?.id,
        actorName: input.actor?.name ?? 'System',
        event: 'PAYMENT_COMPLETED',
        entityType: 'RentPayment',
        entityId: payment.id,
        summary: `${formatMoney(input.amount)} from ${resident.fullName} (${receiptNumber})`,
        meta: {
          residentId: resident.id,
          amount: input.amount,
          method: input.method,
          invoices: touched.map((t) => t.number),
          advance: remaining > 0 ? remaining : 0,
        },
      },
      tx,
    )

    await notifyResident(
      resident.id,
      {
        organizationId: resident.organizationId,
        kind: 'PAYMENT',
        title: 'Payment received',
        body: `We have received ${formatMoney(input.amount)}. Receipt ${receiptNumber}.`,
        link: `/tenant/rent`,
      },
      tx,
    )

    await notifyOrgAdmins(
      resident.organizationId,
      {
        kind: 'PAYMENT',
        title: 'Rent payment received',
        body: `${resident.fullName} paid ${formatMoney(input.amount)} — receipt ${receiptNumber}.`,
        link: `/app/payments`,
      },
      tx,
    )

    return { payment, resident, allocations: touched, advance: Math.max(0, remaining) }
  })
}

// --------------------------------------------------------------------------
// Adjustments, waivers, charges and rent revisions
// --------------------------------------------------------------------------

type Actor = { id?: string; name?: string }

const OPEN_STATUSES = ['PENDING', 'PARTIALLY_PAID', 'OVERDUE'] as const

/** Locks a resident's invoices and payments for the rest of the transaction. */
async function lockResidentMoney(tx: Tx, residentId: string) {
  await tx.$queryRaw`
    SELECT "id" FROM "RentInvoice" WHERE "residentId" = ${residentId} ORDER BY "id" FOR UPDATE
  `
  await tx.$queryRaw`
    SELECT "id" FROM "RentPayment" WHERE "residentId" = ${residentId} ORDER BY "id" FOR UPDATE
  `
}

/** Spends any unapplied advance on the resident's open invoices, oldest first. */
async function settleOpenWithAdvance(tx: Tx, residentId: string) {
  const open = await tx.rentInvoice.findMany({
    where: { residentId, status: { in: [...OPEN_STATUSES] }, balance: { gt: 0 } },
    orderBy: { dueDate: 'asc' },
  })
  for (const invoice of open) await applyAdvanceToInvoice(tx, invoice)
}

function invoiceSnapshot(i: Pick<RentInvoice, 'total' | 'amountPaid' | 'balance' | 'status'>) {
  return { total: i.total, amountPaid: i.amountPaid, balance: i.balance, status: i.status }
}

/**
 * The only way an issued invoice changes: a credit or debit note. Writes the
 * InvoiceAdjustment, a CREDIT_NOTE / DEBIT_NOTE line, the ledger entry and the
 * recomputed totals, and audits before/after. A credit that takes the total
 * below what was already paid releases the excess as an advance.
 */
async function adjustInvoiceTx(
  tx: Tx,
  params: {
    invoiceId: string
    kind: 'CREDIT' | 'DEBIT'
    amount: number
    reason: string
    actor?: Actor
    waiver?: boolean
  },
) {
  const invoice = await tx.rentInvoice.findUnique({
    where: { id: params.invoiceId },
    include: { allocations: true, resident: { select: { fullName: true } } },
  })
  if (!invoice) throw new NotFoundError('Invoice not found')
  if (invoice.status === 'CANCELLED') throw new ConflictError('A cancelled invoice cannot be adjusted')
  if (invoice.status === 'DRAFT') throw new ConflictError('Issue the invoice before adjusting it')
  if (params.kind === 'CREDIT' && params.amount > invoice.total) {
    throw new ValidationError(`A credit note cannot be more than the invoice total (${formatMoney(invoice.total)})`)
  }

  const next = applyAdjustment(invoice, params.kind, params.amount, startOfDay(new Date()), {
    waiver: params.waiver,
  })

  // Release paid money above the new total from the newest allocations.
  for (const r of releaseAllocations(invoice.allocations, next.excessPaid)) {
    if (r.amount <= 0) await tx.paymentAllocation.delete({ where: { id: r.id } })
    else await tx.paymentAllocation.update({ where: { id: r.id }, data: { amount: r.amount } })
  }

  const adjustment = await tx.invoiceAdjustment.create({
    data: {
      organizationId: invoice.organizationId,
      invoiceId: invoice.id,
      kind: params.kind,
      amount: params.amount,
      reason: params.reason,
      createdBy: params.actor?.name,
    },
  })
  const signed = params.kind === 'CREDIT' ? -params.amount : params.amount
  await tx.invoiceLine.create({
    data: {
      invoiceId: invoice.id,
      kind: params.kind === 'CREDIT' ? 'CREDIT_NOTE' : 'DEBIT_NOTE',
      label: `${params.waiver ? 'Waiver' : params.kind === 'CREDIT' ? 'Credit note' : 'Debit note'} — ${params.reason}`,
      quantity: 1,
      unitPrice: signed,
      amount: signed,
    },
  })
  const updated = await tx.rentInvoice.update({
    where: { id: invoice.id },
    data: {
      total: next.total,
      amountPaid: next.amountPaid,
      balance: next.balance,
      status: next.status,
      paidAt: next.balance <= 0 ? (invoice.paidAt ?? new Date()) : null,
      ...(params.waiver ? { notes: params.reason } : {}),
    },
  })

  await appendLedger(tx, {
    organizationId: invoice.organizationId,
    residentId: invoice.residentId,
    kind: params.waiver ? 'WAIVER' : 'ADJUSTMENT',
    label: `${params.waiver ? 'Waiver' : params.kind === 'CREDIT' ? 'Credit note' : 'Debit note'} on ${invoice.number} — ${params.reason}`,
    ...(params.kind === 'CREDIT' ? { credit: params.amount } : { debit: params.amount }),
    refType: 'InvoiceAdjustment',
    refId: adjustment.id,
  })

  await recordActivity(
    {
      organizationId: invoice.organizationId,
      propertyId: invoice.propertyId,
      actorId: params.actor?.id,
      actorName: params.actor?.name ?? 'System',
      event: params.waiver ? 'INVOICE_WAIVED' : 'INVOICE_ADJUSTED',
      entityType: 'RentInvoice',
      entityId: invoice.id,
      summary: `${params.waiver ? 'Waived' : params.kind === 'CREDIT' ? 'Credit note' : 'Debit note'} ${formatMoney(params.amount)} on ${invoice.number} (${invoice.resident.fullName}) — ${params.reason}`,
      meta: {
        residentId: invoice.residentId,
        adjustmentId: adjustment.id,
        kind: params.kind,
        amount: params.amount,
        reason: params.reason,
        releasedAsAdvance: next.excessPaid,
      },
      before: invoiceSnapshot(invoice),
      after: invoiceSnapshot(updated),
    },
    tx,
  )

  // Released money, or an existing advance, may now settle other dues.
  await settleOpenWithAdvance(tx, invoice.residentId)
  return { adjustment, invoice: updated, releasedAsAdvance: next.excessPaid }
}

async function findOrgInvoice(organizationId: string, invoiceId: string) {
  const invoice = await prisma.rentInvoice.findFirst({
    where: { id: invoiceId, organizationId },
    select: { id: true, residentId: true, propertyId: true },
  })
  if (!invoice) throw new NotFoundError('Invoice not found')
  return invoice
}

/** Raise a credit or debit note against an issued invoice. */
export async function adjustInvoice(params: {
  organizationId: string
  invoiceId: string
  kind: 'CREDIT' | 'DEBIT'
  amount: number
  reason: string
  actor?: Actor
}) {
  if (!Number.isInteger(params.amount) || params.amount <= 0) {
    throw new ValidationError('Enter an amount greater than zero')
  }
  if (!params.reason.trim()) throw new ValidationError('Add a reason — it appears on the invoice')
  const ref = await findOrgInvoice(params.organizationId, params.invoiceId)
  return prisma.$transaction(async (tx) => {
    await lockResidentMoney(tx, ref.residentId)
    return adjustInvoiceTx(tx, { ...params, reason: params.reason.trim() })
  })
}

/** Waive what is still owed on an invoice: a credit for the remaining balance. */
export async function waiveInvoice(params: {
  organizationId: string
  invoiceId: string
  reason: string
  actor?: Actor
}) {
  const reason = params.reason.trim()
  if (!reason) throw new ValidationError('Add a reason for the waiver')
  const ref = await findOrgInvoice(params.organizationId, params.invoiceId)
  return prisma.$transaction(async (tx) => {
    await lockResidentMoney(tx, ref.residentId)
    const invoice = await tx.rentInvoice.findUniqueOrThrow({ where: { id: ref.id } })
    if (!(OPEN_STATUSES as readonly string[]).includes(invoice.status) || invoice.balance <= 0) {
      throw new ConflictError('Only an invoice with money still owed can be waived')
    }
    return adjustInvoiceTx(tx, {
      invoiceId: invoice.id,
      kind: 'CREDIT',
      amount: invoice.balance,
      reason,
      actor: params.actor,
      waiver: true,
    })
  })
}

// ---- Charges ---------------------------------------------------------------

export type AddChargeInput = {
  organizationId: string
  residentId: string
  kind: 'RECURRING' | 'ONE_TIME' | 'DISCOUNT'
  category: string
  label: string
  amount: number
  startDate: Date
  endDate?: Date | null
  actor?: Actor
}

/** Adds a recurring charge, a one-time charge or a discount to a resident. */
export async function addCharge(input: AddChargeInput) {
  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    throw new ValidationError('Enter an amount greater than zero')
  }
  const startDate = startOfDay(input.startDate)
  const endDate = input.endDate ? startOfDay(input.endDate) : null
  if (endDate && endDate < startDate) throw new ValidationError('The end date is before the start date')

  return prisma.$transaction(async (tx) => {
    const resident = await tx.resident.findFirst({
      where: { id: input.residentId, organizationId: input.organizationId },
    })
    if (!resident) throw new NotFoundError('Resident not found')
    if (resident.status === 'CHECKED_OUT') {
      throw new ConflictError('This resident has checked out — add it to the settlement instead')
    }
    const charge = await tx.residentCharge.create({
      data: {
        organizationId: resident.organizationId,
        propertyId: resident.propertyId,
        residentId: resident.id,
        kind: input.kind,
        category: input.category,
        label: input.label.trim(),
        amount: input.amount,
        startDate,
        endDate: input.kind === 'ONE_TIME' ? null : endDate,
        createdBy: input.actor?.name,
      },
    })
    await recordActivity(
      {
        organizationId: resident.organizationId,
        propertyId: resident.propertyId,
        actorId: input.actor?.id,
        actorName: input.actor?.name,
        event: 'CHARGE_ADDED',
        entityType: 'ResidentCharge',
        entityId: charge.id,
        summary: `${input.kind === 'DISCOUNT' ? 'Discount' : 'Charge'} "${charge.label}" ${formatMoney(charge.amount)}${input.kind === 'ONE_TIME' ? '' : '/month'} for ${resident.fullName}`,
        meta: { residentId: resident.id, kind: charge.kind, category: charge.category },
        after: {
          kind: charge.kind,
          category: charge.category,
          label: charge.label,
          amount: charge.amount,
          startDate: charge.startDate.toISOString(),
          endDate: charge.endDate?.toISOString() ?? null,
        },
      },
      tx,
    )
    return charge
  })
}

/**
 * Voids a charge. Charges are never edited: void and add a new one.
 * A recurring charge or discount simply stops from the next invoice; a
 * one-time charge already billed is credited back on its invoice.
 */
export async function voidCharge(params: {
  organizationId: string
  chargeId: string
  reason: string
  actor?: Actor
}) {
  const reason = params.reason.trim()
  if (!reason) throw new ValidationError('Add a reason for voiding this charge')
  const ref = await prisma.residentCharge.findFirst({
    where: { id: params.chargeId, organizationId: params.organizationId },
    select: { residentId: true },
  })
  if (!ref) throw new NotFoundError('Charge not found')

  return prisma.$transaction(async (tx) => {
    await lockResidentMoney(tx, ref.residentId)
    const charge = await tx.residentCharge.findUniqueOrThrow({ where: { id: params.chargeId } })
    if (charge.voidedAt) throw new ConflictError('This charge is already void')

    const voided = await tx.residentCharge.update({
      where: { id: charge.id },
      data: { voidedAt: new Date(), voidReason: reason },
    })

    let credited: string | null = null
    if (charge.kind === 'ONE_TIME' && charge.billedInvoiceId) {
      const invoice = await tx.rentInvoice.findUnique({ where: { id: charge.billedInvoiceId } })
      if (invoice && invoice.status !== 'CANCELLED') {
        await adjustInvoiceTx(tx, {
          invoiceId: invoice.id,
          kind: 'CREDIT',
          amount: Math.min(charge.amount, invoice.total),
          reason: `${charge.label} voided — ${reason}`,
          actor: params.actor,
        })
        credited = invoice.number
      }
    }

    await recordActivity(
      {
        organizationId: charge.organizationId,
        propertyId: charge.propertyId,
        actorId: params.actor?.id,
        actorName: params.actor?.name,
        event: 'CHARGE_VOIDED',
        entityType: 'ResidentCharge',
        entityId: charge.id,
        summary: `Voided "${charge.label}" (${formatMoney(charge.amount)}) — ${reason}${credited ? ` · credited on ${credited}` : ''}`,
        meta: { residentId: charge.residentId, creditedInvoice: credited },
        before: { voidedAt: null, amount: charge.amount, label: charge.label },
        after: { voidedAt: voided.voidedAt?.toISOString() ?? null, voidReason: reason },
      },
      tx,
    )
    return { charge: voided, creditedInvoice: credited }
  })
}

// ---- Rent revisions --------------------------------------------------------

/** A monthly invoice (not a checkout settlement, which is stamped at 23:59:59). */
function isMonthlyInvoice(i: Pick<RentInvoice, 'periodStart' | 'periodEnd'>) {
  return i.periodStart.getDate() === 1 && i.periodStart.getHours() === 0 && i.periodEnd > i.periodStart
}

/**
 * Changes a resident's rent from a date.
 *
 * Invoices for periods from `effectiveFrom` use the new rent. Issued invoices
 * are never rewritten: when the date falls in (or before) a month already
 * invoiced, the pro-rata difference for that month is raised as a debit note
 * (rent went up) or credit note (rent went down) on that invoice. That keeps
 * the date the owner chose, leaves the original invoice intact and puts every
 * rupee of the difference on the ledger with a reason — safer than quietly
 * deferring the change to the next cycle, where the books and the agreement
 * would disagree for the overlap.
 */
export async function reviseRent(params: {
  organizationId: string
  residentId: string
  newRent: number
  effectiveFrom: Date
  reason: string
  actor?: Actor
}) {
  return prisma.$transaction((tx) => reviseRentTx(tx, params))
}

/**
 * reviseRent inside a caller's transaction — a room transfer changes the bed
 * and the rent together, or neither.
 */
export async function reviseRentTx(
  tx: Tx,
  params: {
    organizationId: string
    residentId: string
    newRent: number
    effectiveFrom: Date
    reason: string
    actor?: Actor
  },
) {
  if (!Number.isInteger(params.newRent) || params.newRent <= 0) {
    throw new ValidationError('Enter the new monthly rent')
  }
  const reason = params.reason.trim()
  if (!reason) throw new ValidationError('Add a reason for the rent change')
  const effectiveFrom = startOfDay(params.effectiveFrom)

  {
    const resident = await tx.resident.findFirst({
      where: { id: params.residentId, organizationId: params.organizationId },
    })
    if (!resident) throw new NotFoundError('Resident not found')
    if (resident.status === 'CHECKED_OUT') throw new ConflictError('This resident has checked out')
    await lockResidentMoney(tx, resident.id)

    if (effectiveFrom < startOfDay(resident.joiningDate)) {
      throw new ValidationError('The new rent cannot start before the joining date')
    }
    const revisions = await tx.rentRevision.findMany({
      where: { residentId: resident.id },
      select: { oldRent: true, newRent: true, effectiveFrom: true },
      orderBy: { effectiveFrom: 'asc' },
    })
    const latest = revisions[revisions.length - 1]
    if (latest && effectiveFrom <= startOfDay(latest.effectiveFrom)) {
      throw new ValidationError(
        `A rent change from ${formatDateShort(latest.effectiveFrom)} already exists. Pick a later date.`,
      )
    }
    if (params.newRent === resident.rentAmount) {
      throw new ValidationError(`The rent is already ${formatMoney(params.newRent)}`)
    }

    const revision = await tx.rentRevision.create({
      data: {
        organizationId: resident.organizationId,
        residentId: resident.id,
        oldRent: resident.rentAmount,
        newRent: params.newRent,
        effectiveFrom,
        reason,
        createdBy: params.actor?.name,
      },
    })
    await tx.resident.update({ where: { id: resident.id }, data: { rentAmount: params.newRent } })

    // Months already invoiced on or after the effective date get a note for
    // the difference; months not yet invoiced simply bill the new rent.
    const after = [...revisions, revision]
    const invoiced = await tx.rentInvoice.findMany({
      where: {
        residentId: resident.id,
        periodEnd: { gte: effectiveFrom },
        status: { notIn: ['CANCELLED', 'WAIVED', 'DRAFT'] },
      },
      orderBy: { periodStart: 'asc' },
    })
    const notes: { invoice: string; kind: 'CREDIT' | 'DEBIT'; amount: number }[] = []
    for (const invoice of invoiced.filter(isMonthlyInvoice)) {
      const periodEnd = startOfDay(endOfMonth(invoice.periodStart))
      const proration = prorationFor(resident.joiningDate, invoice.periodStart, periodEnd)
      const delta = revisionDelta(
        invoice.periodStart,
        proration,
        resident.rentAmount,
        revisions,
        params.newRent,
        after,
      )
      if (delta === 0) continue
      const kind = delta > 0 ? 'DEBIT' : 'CREDIT'
      const amount = Math.min(Math.abs(delta), kind === 'CREDIT' ? invoice.total : Infinity)
      if (amount <= 0) continue
      await adjustInvoiceTx(tx, {
        invoiceId: invoice.id,
        kind,
        amount,
        reason: `Rent revised ${formatMoney(resident.rentAmount)} → ${formatMoney(params.newRent)} from ${formatDateShort(effectiveFrom)}`,
        actor: params.actor,
      })
      notes.push({ invoice: invoice.number, kind, amount })
    }

    await recordActivity(
      {
        organizationId: resident.organizationId,
        propertyId: resident.propertyId,
        actorId: params.actor?.id,
        actorName: params.actor?.name,
        event: 'RENT_REVISED',
        entityType: 'Resident',
        entityId: resident.id,
        summary: `${resident.fullName}'s rent ${formatMoney(resident.rentAmount)} → ${formatMoney(params.newRent)} from ${formatDateShort(effectiveFrom)} — ${reason}`,
        meta: { revisionId: revision.id, adjustments: notes },
        before: { rentAmount: resident.rentAmount },
        after: { rentAmount: params.newRent, effectiveFrom: effectiveFrom.toISOString() },
      },
      tx,
    )
    return { revision, adjustments: notes }
  }
}

function formatDateShort(d: Date) {
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

// ---- Payment reversal, refund, edit -----------------------------------------

async function findOrgPayment(organizationId: string, paymentId: string) {
  const payment = await prisma.rentPayment.findFirst({
    where: { id: paymentId, organizationId },
    select: { id: true, residentId: true, propertyId: true },
  })
  if (!payment) throw new NotFoundError('Payment not found')
  return payment
}

/**
 * Reverses a payment entered by mistake or a bounced cheque. The payment is
 * kept (marked REVERSED with who, when and why), its allocations are removed,
 * the invoices it paid reopen, and a ledger entry puts the amount back as owed.
 */
export async function reversePayment(params: {
  organizationId: string
  paymentId: string
  reason: string
  actor?: Actor
}) {
  const reason = params.reason.trim()
  if (!reason) throw new ValidationError('Add a reason for the reversal')
  const ref = await findOrgPayment(params.organizationId, params.paymentId)

  return prisma.$transaction(async (tx) => {
    await lockResidentMoney(tx, ref.residentId)
    const payment = await tx.rentPayment.findUniqueOrThrow({
      where: { id: ref.id },
      include: { allocations: true, resident: { select: { fullName: true } } },
    })
    if (payment.status === 'REVERSED') throw new ConflictError('This payment is already reversed')
    if (payment.status !== 'SUCCESS') throw new ConflictError('Only a successful payment can be reversed')
    if (payment.purpose !== 'RENT') {
      throw new ConflictError('Deposit payments are corrected from the deposit card, not reversed here')
    }
    if (payment.refundedAmount > 0) {
      throw new ConflictError('Part of this payment was refunded, so it cannot be reversed')
    }

    const invoices = await tx.rentInvoice.findMany({
      where: { id: { in: payment.allocations.map((a) => a.invoiceId) } },
    })
    const restored = reverseAllocations(invoices, payment.allocations, startOfDay(new Date()))
    for (const inv of restored) {
      await tx.rentInvoice.update({
        where: { id: inv.id },
        data: {
          amountPaid: inv.amountPaid,
          balance: inv.balance,
          status: inv.status,
          paidAt: inv.balance > 0 ? null : inv.paidAt,
        },
      })
    }
    await tx.paymentAllocation.deleteMany({ where: { paymentId: payment.id } })

    const now = new Date()
    const updated = await tx.rentPayment.update({
      where: { id: payment.id },
      data: {
        status: 'REVERSED',
        reversedAt: now,
        reversedBy: params.actor?.name ?? 'System',
        reversalReason: reason,
      },
    })

    await appendLedger(tx, {
      organizationId: payment.organizationId,
      residentId: payment.residentId,
      kind: 'ADJUSTMENT',
      label: `Payment ${payment.receiptNumber} reversed — ${reason}`,
      debit: payment.amount,
      entryDate: now,
      refType: 'RentPayment',
      refId: payment.id,
    })

    await recordActivity(
      {
        organizationId: payment.organizationId,
        propertyId: payment.propertyId,
        actorId: params.actor?.id,
        actorName: params.actor?.name,
        event: 'PAYMENT_REVERSED',
        entityType: 'RentPayment',
        entityId: payment.id,
        summary: `Reversed ${payment.receiptNumber} (${formatMoney(payment.amount)}) from ${payment.resident.fullName} — ${reason}`,
        meta: { residentId: payment.residentId, reopened: invoices.map((i) => i.number) },
        before: {
          status: payment.status,
          allocations: payment.allocations.map((a) => ({ invoiceId: a.invoiceId, amount: a.amount })),
        },
        after: { status: 'REVERSED', reversalReason: reason },
      },
      tx,
    )

    // Another advance on file may cover what just reopened.
    await settleOpenWithAdvance(tx, payment.residentId)
    return { payment: updated, reopened: invoices.map((i) => i.number) }
  })
}

/**
 * Refunds money from a payment that is not applied to any invoice (an
 * overpayment or an advance). Applied money must be freed first, by a
 * credit note or by reversing the payment.
 */
export async function refundPayment(params: {
  organizationId: string
  paymentId: string
  amount: number
  method: PaymentMethodKind
  reference?: string
  reason: string
  actor?: Actor
}) {
  if (!Number.isInteger(params.amount) || params.amount <= 0) {
    throw new ValidationError('Enter the amount refunded')
  }
  const reason = params.reason.trim()
  if (!reason) throw new ValidationError('Add a reason for the refund')
  const ref = await findOrgPayment(params.organizationId, params.paymentId)

  return prisma.$transaction(async (tx) => {
    await lockResidentMoney(tx, ref.residentId)
    const payment = await tx.rentPayment.findUniqueOrThrow({
      where: { id: ref.id },
      include: { allocations: true, resident: { select: { fullName: true } } },
    })
    if (payment.status !== 'SUCCESS' || payment.purpose !== 'RENT') {
      throw new ConflictError('Only a successful rent payment can be refunded')
    }
    const free = unallocatedOf(payment)
    if (params.amount > free) {
      throw new ValidationError(
        free > 0
          ? `Only ${formatMoney(free)} of this payment is not applied to an invoice and can be refunded.`
          : 'All of this payment is applied to invoices. Raise a credit note or reverse the payment first.',
      )
    }
    const refundedAmount = payment.refundedAmount + params.amount
    const updated = await tx.rentPayment.update({
      where: { id: payment.id },
      data: {
        refundedAmount,
        status: refundedAmount >= payment.amount ? 'REFUNDED' : 'SUCCESS',
      },
    })
    await appendLedger(tx, {
      organizationId: payment.organizationId,
      residentId: payment.residentId,
      kind: 'REFUND',
      label: `Refund from ${payment.receiptNumber} — ${params.method.replace('_', ' ').toLowerCase()}${params.reference ? ` (${params.reference})` : ''} — ${reason}`,
      debit: params.amount,
      refType: 'RentPayment',
      refId: payment.id,
    })
    await recordActivity(
      {
        organizationId: payment.organizationId,
        propertyId: payment.propertyId,
        actorId: params.actor?.id,
        actorName: params.actor?.name,
        event: 'REFUND_ISSUED',
        entityType: 'RentPayment',
        entityId: payment.id,
        summary: `Refunded ${formatMoney(params.amount)} of ${payment.receiptNumber} to ${payment.resident.fullName} — ${reason}`,
        meta: { residentId: payment.residentId, method: params.method, reference: params.reference ?? null },
        before: { refundedAmount: payment.refundedAmount, status: payment.status },
        after: { refundedAmount, status: updated.status },
      },
      tx,
    )
    return { payment: updated }
  })
}

/**
 * Edits the descriptive fields of a payment. Amount, date and method are
 * money: to change them, reverse the payment and record it again.
 */
export async function editPayment(params: {
  organizationId: string
  paymentId: string
  changes: { notes?: string | null; reference?: string | null; utr?: string | null; attachmentUrl?: string | null }
  actor?: Actor
}) {
  const ref = await findOrgPayment(params.organizationId, params.paymentId)
  return prisma.$transaction(async (tx) => {
    const payment = await tx.rentPayment.findUniqueOrThrow({ where: { id: ref.id } })
    const keys = ['notes', 'reference', 'utr', 'attachmentUrl'] as const
    const before: Record<string, string | null> = {}
    const after: Record<string, string | null> = {}
    for (const key of keys) {
      if (params.changes[key] === undefined) continue
      const value = params.changes[key]?.trim() || null
      if ((payment[key] ?? null) === value) continue
      before[key] = payment[key] ?? null
      after[key] = value
    }
    if (!Object.keys(after).length) return { payment, changed: false }
    const updated = await tx.rentPayment.update({ where: { id: payment.id }, data: after })
    await recordActivity(
      {
        organizationId: payment.organizationId,
        propertyId: payment.propertyId,
        actorId: params.actor?.id,
        actorName: params.actor?.name,
        event: 'PAYMENT_EDITED',
        entityType: 'RentPayment',
        entityId: payment.id,
        summary: `Edited ${payment.receiptNumber}: ${Object.keys(after).join(', ')}`,
        meta: { residentId: payment.residentId },
        before,
        after,
      },
      tx,
    )
    return { payment: updated, changed: true }
  })
}

// ---- Daily collection report -------------------------------------------------

/**
 * Opening outstanding + invoiced − collected ± adjustments = closing, for one
 * day across the given PGs, with the entries behind every number.
 */
export async function dailyCollectionReport(params: {
  organizationId: string
  propertyIds: string[]
  date: Date
}) {
  const from = startOfDay(params.date)
  const to = endOfDay(params.date)
  const residentWhere = { organizationId: params.organizationId, resident: { propertyId: { in: params.propertyIds } } }

  const [openingRows, todays] = await Promise.all([
    prisma.residentLedger.groupBy({
      by: ['residentId'],
      where: { ...residentWhere, entryDate: { lt: from } },
      _sum: { debit: true, credit: true },
    }),
    prisma.residentLedger.findMany({
      where: { ...residentWhere, entryDate: { gte: from, lte: to } },
      orderBy: [{ entryDate: 'asc' }, { createdAt: 'asc' }],
    }),
  ])

  // Opening balances enter the calculation as one entry per resident.
  const openingEntries = openingRows.map((r) => ({
    id: `opening-${r.residentId}`,
    residentId: r.residentId,
    entryDate: new Date(from.getTime() - 1),
    kind: 'OPENING',
    label: 'Opening balance',
    debit: r._sum.debit ?? 0,
    credit: r._sum.credit ?? 0,
  }))
  const result = dailyCollection([...openingEntries, ...todays], from, to)

  const residentIds = [...new Set([...openingRows.map((r) => r.residentId), ...todays.map((e) => e.residentId)])]
  const paymentIds = todays.filter((e) => e.refType === 'RentPayment' && e.refId).map((e) => e.refId!)
  const [residents, payments] = await Promise.all([
    prisma.resident.findMany({
      where: { id: { in: residentIds } },
      select: { id: true, fullName: true, code: true, property: { select: { name: true } } },
    }),
    prisma.rentPayment.findMany({
      where: { id: { in: paymentIds } },
      select: { id: true, method: true, receiptNumber: true, utr: true, reference: true },
    }),
  ])
  const who = new Map(residents.map((r) => [r.id, r]))
  const pay = new Map(payments.map((p) => [p.id, p]))

  const row = (e: (typeof todays)[number]) => {
    const r = who.get(e.residentId)
    const p = e.refId ? pay.get(e.refId) : undefined
    return {
      id: e.id,
      at: e.entryDate,
      residentId: e.residentId,
      resident: r?.fullName ?? '—',
      code: r?.code ?? '',
      property: r?.property.name ?? '',
      kind: e.kind,
      label: e.label,
      debit: e.debit,
      credit: e.credit,
      method: p?.method ?? null,
      reference: p ? (p.utr ?? p.reference ?? null) : null,
    }
  }
  const asRows = (list: typeof result.entries.invoiced) =>
    list.map((e) => row(todayById.get(e.id)!))

  const todayById = new Map(todays.map((t) => [t.id, t]))
  const byMethod: Record<string, number> = {}
  for (const e of result.entries.collected) {
    const refId = todayById.get(e.id)?.refId
    const m = (refId ? pay.get(refId)?.method : undefined) ?? 'OTHER'
    byMethod[m] = (byMethod[m] ?? 0) + e.credit
  }

  return {
    date: from,
    opening: result.opening,
    invoiced: result.invoiced,
    collected: result.collected,
    adjustments: result.adjustments,
    closing: result.closing,
    byMethod,
    openingByResident: [...result.openingByResident.entries()]
      .filter(([, v]) => v !== 0)
      .map(([id, balance]) => ({
        residentId: id,
        resident: who.get(id)?.fullName ?? '—',
        code: who.get(id)?.code ?? '',
        property: who.get(id)?.property.name ?? '',
        balance,
      }))
      .sort((a, b) => b.balance - a.balance),
    lists: {
      invoiced: asRows(result.entries.invoiced),
      collected: asRows(result.entries.collected),
      adjustments: asRows(result.entries.adjustments),
    },
  }
}

// --------------------------------------------------------------------------
// Overdue + late fees
// --------------------------------------------------------------------------

/**
 * Flags unpaid invoices past their due date as OVERDUE and keeps each one's
 * late fee at the configured amount for today:
 *   flat + perDay × (days overdue − grace days), once past the grace period.
 * Only the difference to what is already charged is added, so running this
 * any number of times on the same day charges the same total.
 */
export async function applyOverdueAndLateFees(organizationId?: string) {
  const today = startOfDay(new Date())
  const invoices = await prisma.rentInvoice.findMany({
    where: {
      status: { in: ['PENDING', 'PARTIALLY_PAID', 'OVERDUE'] },
      balance: { gt: 0 },
      dueDate: { lt: today },
      ...(organizationId ? { organizationId } : {}),
    },
    include: { organization: { include: { settings: true } } },
  })

  let flagged = 0
  let feesApplied = 0

  for (const invoice of invoices) {
    const settings = invoice.organization.settings
    const graceDays = settings?.lateFeeGraceDays ?? 5
    const overdueDays = Math.floor(
      (today.getTime() - startOfDay(invoice.dueDate).getTime()) / 86400000,
    )

    const outcome = await prisma.$transaction(async (tx) => {
      // Serialise with recordPayment (which locks the same rows) so the
      // re-read below sees any payment that landed after the scan.
      await tx.$queryRaw`SELECT "id" FROM "RentInvoice" WHERE "id" = ${invoice.id} FOR UPDATE`

      // Conditional flip: an invoice paid since the scan stays PAID.
      const flip = await tx.rentInvoice.updateMany({
        where: {
          id: invoice.id,
          status: { in: ['PENDING', 'PARTIALLY_PAID'] },
          balance: { gt: 0 },
        },
        data: { status: 'OVERDUE' },
      })
      const flipped = flip.count === 1

      if (!(settings?.lateFeeEnabled ?? true) || overdueDays <= graceDays) {
        return { flipped, fee: 0 }
      }

      const current = await tx.rentInvoice.findUnique({ where: { id: invoice.id } })
      if (!current || current.status !== 'OVERDUE' || current.balance <= 0) {
        return { flipped, fee: 0 }
      }

      const daysPastGrace = overdueDays - graceDays
      const target =
        (settings?.lateFeeAmount ?? 0) + (settings?.lateFeePerDay ?? 0) * daysPastGrace
      const fee = target - current.lateFee
      if (fee <= 0) return { flipped, fee: 0 }

      await tx.invoiceLine.create({
        data: {
          invoiceId: invoice.id,
          kind: 'LATE_FEE',
          label:
            current.lateFee === 0
              ? `Late fee (${daysPastGrace} days past grace)`
              : `Late fee increase (${daysPastGrace} days past grace)`,
          quantity: 1,
          unitPrice: fee,
          amount: fee,
        },
      })
      await tx.rentInvoice.update({
        where: { id: invoice.id },
        data: {
          lateFee: target,
          total: current.total + fee,
          balance: current.balance + fee,
        },
      })
      await appendLedger(tx, {
        organizationId: invoice.organizationId,
        residentId: invoice.residentId,
        kind: 'CHARGE',
        label: `Late fee — ${invoice.number}`,
        debit: fee,
        refType: 'RentInvoice',
        refId: invoice.id,
      })
      await recordActivity(
        {
          organizationId: invoice.organizationId,
          propertyId: invoice.propertyId,
          actorName: 'Automation',
          event: 'RENT_OVERDUE',
          entityType: 'RentInvoice',
          entityId: invoice.id,
          summary: `${invoice.number} overdue by ${overdueDays} days — late fee ${formatMoney(fee)} (total ${formatMoney(target)})`,
        },
        tx,
      )
      return { flipped, fee }
    })

    if (outcome.flipped) flagged++
    if (outcome.fee > 0) feesApplied++
  }

  return { flagged, feesApplied }
}

// --------------------------------------------------------------------------
// Reminders
// --------------------------------------------------------------------------

export type ReminderStage = 'upcoming' | 'due_today' | 'overdue'

export function buildReminderMessage(params: {
  residentName: string
  propertyName: string
  roomLabel: string
  amount: number
  dueDate: Date
  stage: ReminderStage
  payLink?: string
  upiLink?: string
}): string {
  const first = params.residentName.split(' ')[0]
  const due = params.dueDate.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })

  const head =
    params.stage === 'upcoming'
      ? `Your PG rent of ${formatMoney(params.amount)} is due on ${due}.`
      : params.stage === 'due_today'
        ? `Your PG rent of ${formatMoney(params.amount)} is due today (${due}).`
        : `Your PG rent of ${formatMoney(params.amount)} was due on ${due} and is now overdue.`

  return [
    `Hi ${first} 👋`,
    '',
    head,
    '',
    `PG: ${params.propertyName}`,
    `Room: ${params.roomLabel}`,
    `Amount: ${formatMoney(params.amount)}`,
    `Due date: ${due}`,
    params.payLink ? `\nPay here: ${params.payLink}` : '',
    params.upiLink ? `UPI: ${params.upiLink}` : '',
    '',
    'Thank you.',
  ]
    .filter((l) => l !== '')
    .join('\n')
}

/**
 * Sends rent reminders at the three configured stages. Idempotent per day —
 * a resident is never messaged twice for the same invoice on the same day.
 */
export async function sendRentReminders(params?: { organizationId?: string; now?: Date }) {
  const now = params?.now ?? new Date()
  const today = startOfDay(now)

  const invoices = await prisma.rentInvoice.findMany({
    where: {
      status: { in: ['PENDING', 'PARTIALLY_PAID', 'OVERDUE'] },
      balance: { gt: 0 },
      ...(params?.organizationId ? { organizationId: params.organizationId } : {}),
    },
    include: {
      resident: { include: { bed: true, room: true } },
      property: true,
      organization: { include: { settings: true } },
    },
  })

  const sent: { stage: ReminderStage; resident: string; amount: number }[] = []

  for (const invoice of invoices) {
    const settings = invoice.organization.settings
    if (settings && !settings.whatsappEnabled) continue
    // Reminders go out on WhatsApp; with the module off there is nothing to send.
    if (settings?.disabledModules.includes('whatsapp')) continue

    const due = startOfDay(invoice.dueDate)
    const diffDays = Math.round((due.getTime() - today.getTime()) / 86400000)

    let stage: ReminderStage | null = null
    if (diffDays === (settings?.reminderDaysBefore ?? 3)) stage = 'upcoming'
    else if (diffDays === 0 && (settings?.reminderOnDueDate ?? true)) stage = 'due_today'
    else if (diffDays < 0 && Math.abs(diffDays) % (settings?.reminderAfterDays ?? 3) === 0)
      stage = 'overdue'
    if (!stage) continue

    // Both channels switched off for this reminder type: nothing to send.
    const prefs = parseNotificationPrefs(settings?.notificationSettings)
    const prefType = stage === 'overdue' ? 'RENT_OVERDUE' : 'RENT_REMINDER'
    if (!isChannelOn(prefs, prefType, 'WHATSAPP') && !isChannelOn(prefs, prefType, 'IN_APP')) continue

    // Already reminded today?
    if (invoice.lastReminderAt && startOfDay(invoice.lastReminderAt).getTime() === today.getTime())
      continue

    // Claim today's reminder BEFORE sending: of two overlapping runs only the
    // one whose conditional update lands sends the message.
    const claim = await prisma.rentInvoice.updateMany({
      where: {
        id: invoice.id,
        OR: [{ lastReminderAt: null }, { lastReminderAt: { lt: today } }],
      },
      data: { reminderCount: { increment: 1 }, lastReminderAt: now },
    })
    if (claim.count !== 1) continue

    const roomLabel = invoice.resident.room
      ? `${invoice.resident.room.number}${invoice.resident.bed ? ` · Bed ${invoice.resident.bed.label}` : ''}`
      : 'Not allocated'

    const upiLink =
      settings?.upiId && settings.upiPayeeName
        ? buildUpiLink({
            upiId: settings.upiId,
            payeeName: settings.upiPayeeName,
            amount: invoice.balance,
            note: `Rent ${invoice.number}`,
          })
        : undefined

    const body = buildReminderMessage({
      residentName: invoice.resident.fullName,
      propertyName: invoice.property.name,
      roomLabel,
      amount: invoice.balance,
      dueDate: invoice.dueDate,
      stage,
      payLink: `${process.env.NEXT_PUBLIC_SITE_URL ?? ''}/tenant/rent`,
      upiLink,
    })

    try {
      await sendWhatsApp({
        organizationId: invoice.organizationId,
        toName: invoice.resident.fullName,
        toPhone: invoice.resident.whatsappPhone || invoice.resident.phone,
        template:
          stage === 'upcoming'
            ? 'rent_reminder_upcoming'
            : stage === 'due_today'
              ? 'rent_reminder_due_today'
              : 'rent_reminder_overdue',
        body,
        variables: [
          invoice.resident.fullName,
          formatMoney(invoice.balance),
          invoice.dueDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'long' }),
          invoice.property.name,
          roomLabel,
        ],
        refType: 'RentInvoice',
        refId: invoice.id,
      })
    } catch (error) {
      // Release our claim so a later run today can try again.
      await prisma.rentInvoice.updateMany({
        where: { id: invoice.id, lastReminderAt: now },
        data: { reminderCount: { decrement: 1 }, lastReminderAt: invoice.lastReminderAt },
      })
      console.error('[billing] rent reminder failed', { invoiceId: invoice.id, error })
      continue
    }

    await notifyResident(invoice.residentId, {
      organizationId: invoice.organizationId,
      kind: 'RENT',
      type: stage === 'overdue' ? 'RENT_OVERDUE' : 'RENT_REMINDER',
      title: stage === 'overdue' ? 'Rent overdue' : 'Rent reminder',
      body: `${formatMoney(invoice.balance)} for ${formatMonth(invoice.periodStart)}.`,
      link: '/tenant/rent',
    })

    sent.push({ stage, resident: invoice.resident.fullName, amount: invoice.balance })
  }

  return { sent: sent.length, details: sent }
}

