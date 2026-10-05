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
import {
  addDays,
  dayOfMonth,
  daysInMonth,
  endOfMonth,
  formatMoney,
  formatMonth,
  startOfDay,
  startOfMonth,
} from '@/lib/utils'
import { buildUpiLink, sendWhatsApp } from '../integrations/whatsapp'

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
): { lines: InvoiceLineInput[]; subtotal: number; discount: number } {
  const lines: InvoiceLineInput[] = []
  const totalDays = daysInMonth(periodStart)
  const joining = startOfDay(new Date(resident.joiningDate))
  const proRated = joining > periodStart && joining <= periodEnd
  const billableDays = proRated ? totalDays - joining.getDate() + 1 : totalDays
  const factor = billableDays / totalDays

  const rent = Math.round(resident.rentAmount * factor)
  lines.push({
    kind: 'RENT',
    label: proRated
      ? `Room rent — ${formatMonth(periodStart)} (${billableDays}/${totalDays} days)`
      : `Room rent — ${formatMonth(periodStart)}`,
    unitPrice: rent,
  })

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

  return { lines, subtotal, discount }
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
    const dueDate = startOfDay(dayOfMonth(periodStart.getFullYear(), periodStart.getMonth(), dueDay))

    const { lines, subtotal, discount } = buildInvoiceLines(resident, periodStart, periodEnd)
    const total = subtotal - discount

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
async function applyAdvanceToInvoice<T extends RentInvoice>(tx: Tx, invoice: T): Promise<T> {
  if (invoice.balance <= 0) return invoice

  // Lock this resident's payments so two invoices generated at once cannot
  // both spend the same advance.
  await tx.$queryRaw`
    SELECT "id" FROM "RentPayment" WHERE "residentId" = ${invoice.residentId} ORDER BY "id" FOR UPDATE
  `
  const payments = await tx.rentPayment.findMany({
    where: { residentId: invoice.residentId, status: 'SUCCESS', purpose: 'RENT' },
    orderBy: [{ paidAt: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, amount: true, paidAt: true, allocations: { select: { amount: true } } },
  })

  let amountPaid = invoice.amountPaid
  let balance = invoice.balance
  let lastPaidAt: Date | null = null
  for (const payment of payments) {
    if (balance <= 0) break
    const free = payment.amount - payment.allocations.reduce((s, a) => s + a.amount, 0)
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
  notes?: string
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

    const ordered = input.invoiceIds?.length
      ? [
          ...input.invoiceIds
            .map((id) => openInvoices.find((i) => i.id === id))
            .filter((i): i is (typeof openInvoices)[number] => Boolean(i)),
          ...openInvoices.filter((i) => !input.invoiceIds!.includes(i.id)),
        ]
      : openInvoices

    let remaining = input.amount
    const touched: { number: string; applied: number; cleared: boolean }[] = []

    for (const invoice of ordered) {
      if (remaining <= 0) break
      const applied = Math.min(remaining, invoice.balance)
      remaining -= applied

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
      title: stage === 'overdue' ? 'Rent overdue' : 'Rent reminder',
      body: `${formatMoney(invoice.balance)} for ${formatMonth(invoice.periodStart)}.`,
      link: '/tenant/rent',
    })

    sent.push({ stage, resident: invoice.resident.fullName, amount: invoice.balance })
  }

  return { sent: sent.length, details: sent }
}

/** Convenience used by the dashboard "rent due today" card. */
export async function dueTodayCount(organizationId: string, propertyIds: string[]) {
  const today = startOfDay(new Date())
  return prisma.rentInvoice.count({
    where: {
      organizationId,
      propertyId: { in: propertyIds },
      status: { in: ['PENDING', 'PARTIALLY_PAID'] },
      dueDate: { gte: today, lt: addDays(today, 1) },
    },
  })
}
