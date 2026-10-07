import 'server-only'

import { prisma } from '@/lib/prisma'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/tenancy'
import { formatMoney } from '@/lib/utils'
import { planAllocation, unallocatedOf } from '@/lib/billing-calc'
import { recordActivity } from '../events'
import {
  nextInvoiceNumber,
  nextReceiptNumber,
  rebuildLedger,
  retryOnUniqueConflict,
} from './billing'
import {
  cellOf,
  displayDate,
  findDuplicates,
  matchKey,
  normalizePhone,
  parseAmount,
  parseImportDate,
  type ColumnMapping,
  type RowCheck,
  type RowOutcome,
  type SheetRow,
} from './import-fields'
import type { ImportScope } from './resident-import'

/**
 * Opening balances for residents already in StayFlow — what each one owed,
 * had paid ahead, or had given as deposit on the day the owner switched over.
 *
 * - Outstanding rent becomes ONE "Opening balance" invoice dated the as-of
 *   day. Monthly invoices are never back-dated.
 * - Advance paid becomes a RENT payment (method Adjustment) marked "Opening
 *   advance", allocated to open invoices like any payment; the rest stays as
 *   advance for the next invoice. Its ledger line is an adjustment, so it is
 *   not counted as money collected on that day.
 * - Deposit held marks the security deposit collected (no new receipt).
 *
 * Each resident is written in one transaction, and a resident who already
 * has an opening balance is skipped, so re-uploading a file is safe.
 */

export const OPENING_INVOICE_NOTE = 'Opening balance — carried over from before StayFlow'
export const OPENING_ADVANCE_NOTE = 'Opening advance — carried over from before StayFlow'

type BalancePlan = {
  residentId: string
  name: string
  asOf: Date
  outstanding: number
  advance: number
  depositHeld: number
}

export type BalanceValidation = { checks: RowCheck[]; notes: string[]; plans: Map<number, BalancePlan> }

export async function validateBalanceRows(
  scope: ImportScope,
  rows: SheetRow[],
  mapping: ColumnMapping,
): Promise<BalanceValidation> {
  const residents = await prisma.resident.findMany({
    where: {
      organizationId: scope.organizationId,
      propertyId: { in: scope.propertyIds },
      status: { in: ['PENDING', 'ACTIVE', 'NOTICE'] },
    },
    select: {
      id: true,
      code: true,
      fullName: true,
      phone: true,
      depositAmount: true,
      deposit: { select: { amount: true, collected: true } },
      invoices: { where: { notes: OPENING_INVOICE_NOTE }, select: { id: true }, take: 1 },
      payments: { where: { notes: OPENING_ADVANCE_NOTE }, select: { id: true }, take: 1 },
    },
  })
  const byCode = new Map(residents.map((r) => [matchKey(r.code), r]))
  const byPhone = new Map<string, (typeof residents)[number]>()
  for (const r of residents) {
    const p = normalizePhone(r.phone)
    if (p) byPhone.set(p, r)
  }

  const get = (row: SheetRow, key: string) => cellOf(row, mapping, key)
  const today = new Date()
  const matched: (string | null)[] = []
  const checks: RowCheck[] = []
  const plans = new Map<number, BalancePlan>()

  for (const row of rows) {
    const errors: string[] = []
    const warnings: string[] = []
    const check: RowCheck = {
      row: row.line,
      status: 'ready',
      title: get(row, 'fullName') || get(row, 'code') || get(row, 'phone') || '—',
      subtitle: '',
      errors,
      warnings,
    }
    checks.push(check)

    // --- who
    const code = get(row, 'code')
    const phoneText = get(row, 'phone')
    const phone = phoneText ? normalizePhone(phoneText) : null
    if (phoneText && !phone) errors.push(`Phone "${phoneText}" is not a valid 10-digit mobile number`)
    let resident = code ? byCode.get(matchKey(code)) : undefined
    if (code && !resident) errors.push(`No current resident with code ${code} in your PGs`)
    if (!code && !phoneText) errors.push('Phone or resident code is missing')
    if (!resident && !code && phone) {
      resident = byPhone.get(phone)
      if (!resident) errors.push(`No current resident with phone ${phone} in your PGs — import residents first`)
    }
    if (resident && code && phone && normalizePhone(resident.phone) !== phone) {
      errors.push(`Code ${resident.code} belongs to ${resident.fullName}, whose phone is not ${phone}`)
    }
    matched.push(resident?.id ?? null)
    if (resident) {
      check.title = `${resident.fullName} (${resident.code})`
      const name = get(row, 'fullName')
      const first = matchKey(name).split(' ')[0]
      if (name && first && !matchKey(resident.fullName).includes(first)) {
        warnings.push(`Name in the file is "${name}" — matched ${resident.fullName} by ${code ? 'code' : 'phone'}`)
      }
    }

    // --- when
    let asOf = today
    const dateText = get(row, 'asOfDate')
    if (dateText) {
      const d = parseImportDate(dateText)
      if (!d) errors.push(`As of date "${dateText}" is not a date — use DD/MM/YYYY`)
      else if (d.getTime() > today.getTime()) errors.push('As of date cannot be in the future')
      else asOf = d
    } else {
      warnings.push('No as-of date — today is used')
    }

    // --- how much
    const amount = (key: string, label: string) => {
      const text = get(row, key)
      if (!text) return 0
      const r = parseAmount(text)
      if (r.ok) return r.value
      errors.push(r.error === 'negative' ? `${label} cannot be negative` : `${label} "${text}" is not a number`)
      return 0
    }
    let outstanding = amount('outstanding', 'Rent outstanding')
    let advance = amount('advance', 'Advance paid')
    let depositHeld = amount('depositHeld', 'Deposit held')
    if (outstanding > 0 && advance > 0) errors.push('Enter either rent outstanding or advance paid, not both')
    if (outstanding > 1_000_000 || advance > 1_000_000 || depositHeld > 1_000_000) errors.push('Amount looks too high — check it')

    if (errors.length || !resident) {
      check.status = 'error'
      continue
    }

    // --- already done?
    if (outstanding > 0 && resident.invoices.length) {
      warnings.push('Opening balance invoice already exists — outstanding skipped')
      outstanding = 0
    }
    if (advance > 0 && resident.payments.length) {
      warnings.push('Opening advance already recorded — advance skipped')
      advance = 0
    }
    const collected = resident.deposit?.collected ?? 0
    if (depositHeld > 0 && collected >= depositHeld) {
      warnings.push(`Deposit ${formatMoney(collected)} is already marked collected — skipped`)
      depositHeld = 0
    } else if (depositHeld > 0) {
      const agreed = resident.deposit?.amount ?? resident.depositAmount
      if (depositHeld > agreed) warnings.push(`Agreed deposit was ${formatMoney(agreed)} — it becomes ${formatMoney(depositHeld)}`)
    }
    if (!outstanding && !advance && !depositHeld) {
      check.status = 'skip'
      if (!warnings.some((w) => w.includes('skipped'))) warnings.unshift('Nothing to import — all amounts are empty or 0')
      else warnings.unshift('Opening balance already imported')
      continue
    }

    check.subtitle = [
      `As of ${displayDate(asOf)}`,
      outstanding ? `Due ${formatMoney(outstanding)}` : null,
      advance ? `Advance ${formatMoney(advance)}` : null,
      depositHeld ? `Deposit ${formatMoney(depositHeld)}` : null,
    ]
      .filter(Boolean)
      .join(' · ')
    plans.set(row.line, { residentId: resident.id, name: resident.fullName, asOf, outstanding, advance, depositHeld })
  }

  // The same resident twice in one file is ambiguous: refuse both later rows.
  for (const [i, first] of findDuplicates(matched)) {
    const c = checks[i]
    if (c.status === 'error') continue
    c.status = 'error'
    c.errors.push(`Same resident as row ${checks[first].row} in this file`)
    plans.delete(c.row)
  }

  return { checks, notes: [], plans }
}

async function importOne(plan: BalancePlan, actor: { id: string; name: string }) {
  return retryOnUniqueConflict(
    () =>
      prisma.$transaction(async (tx) => {
        const resident = await tx.resident.findUnique({
          where: { id: plan.residentId },
          include: { organization: { include: { settings: true } }, deposit: true },
        })
        if (!resident) throw new NotFoundError('Resident not found')
        if (resident.status === 'CHECKED_OUT') throw new ConflictError('This resident has checked out')
        await tx.$queryRaw`SELECT "id" FROM "RentInvoice" WHERE "residentId" = ${resident.id} ORDER BY "id" FOR UPDATE`
        await tx.$queryRaw`SELECT "id" FROM "RentPayment" WHERE "residentId" = ${resident.id} ORDER BY "id" FOR UPDATE`

        const done: string[] = []
        const asOfLabel = displayDate(plan.asOf)
        // Stamped just before the settlement's 23:59:59, never midnight on the
        // 1st, so it is not mistaken for a monthly invoice.
        const stamp = new Date(plan.asOf)
        stamp.setHours(23, 59, 58, 0)
        const day = new Date(plan.asOf)
        day.setHours(0, 0, 0, 0)

        // 1. Outstanding → one opening-balance invoice.
        if (plan.outstanding > 0) {
          const exists = await tx.rentInvoice.findFirst({
            where: { residentId: resident.id, notes: OPENING_INVOICE_NOTE },
            select: { id: true },
          })
          if (!exists) {
            const number = await nextInvoiceNumber(tx, resident.organizationId, resident.organization.settings?.invoicePrefix ?? 'INV', day)
            let invoice = await tx.rentInvoice.create({
              data: {
                organizationId: resident.organizationId,
                propertyId: resident.propertyId,
                residentId: resident.id,
                number,
                periodStart: stamp,
                periodEnd: stamp,
                issueDate: day,
                dueDate: day,
                status: 'PENDING',
                subtotal: plan.outstanding,
                total: plan.outstanding,
                balance: plan.outstanding,
                autoGenerated: false,
                notes: OPENING_INVOICE_NOTE,
                lines: {
                  create: [
                    {
                      kind: 'OTHER',
                      label: `Opening balance — rent due as of ${asOfLabel} (before StayFlow)`,
                      quantity: 1,
                      unitPrice: plan.outstanding,
                      amount: plan.outstanding,
                    },
                  ],
                },
              },
            })
            await tx.residentLedger.create({
              data: {
                organizationId: resident.organizationId,
                residentId: resident.id,
                kind: 'CHARGE',
                label: `Invoice ${number} — opening balance as of ${asOfLabel}`,
                debit: plan.outstanding,
                credit: 0,
                balance: 0,
                entryDate: day,
                refType: 'RentInvoice',
                refId: invoice.id,
              },
            })
            // Money already paid ahead settles it, as for any new invoice.
            const payments = await tx.rentPayment.findMany({
              where: { residentId: resident.id, status: 'SUCCESS', purpose: 'RENT' },
              orderBy: [{ paidAt: 'asc' }, { createdAt: 'asc' }],
              select: { id: true, amount: true, refundedAmount: true, paidAt: true, allocations: { select: { amount: true } } },
            })
            let balance = invoice.balance
            for (const p of payments) {
              if (balance <= 0) break
              const applied = Math.min(unallocatedOf(p), balance)
              if (applied <= 0) continue
              await tx.paymentAllocation.create({ data: { paymentId: p.id, invoiceId: invoice.id, amount: applied } })
              balance -= applied
            }
            if (balance !== invoice.balance) {
              invoice = await tx.rentInvoice.update({
                where: { id: invoice.id },
                data: {
                  amountPaid: invoice.total - balance,
                  balance,
                  status: balance <= 0 ? 'PAID' : 'PARTIALLY_PAID',
                  paidAt: balance <= 0 ? new Date() : null,
                },
              })
            }
            done.push(`opening balance ${formatMoney(plan.outstanding)} (${number})`)
          }
        }

        // 2. Advance → a RENT payment marked as opening advance.
        if (plan.advance > 0) {
          const exists = await tx.rentPayment.findFirst({
            where: { residentId: resident.id, notes: OPENING_ADVANCE_NOTE },
            select: { id: true },
          })
          if (!exists) {
            const receiptNumber = await nextReceiptNumber(tx, resident.organizationId, resident.organization.settings?.receiptPrefix ?? 'RCP', day)
            const payment = await tx.rentPayment.create({
              data: {
                organizationId: resident.organizationId,
                propertyId: resident.propertyId,
                residentId: resident.id,
                receiptNumber,
                amount: plan.advance,
                method: 'ADJUSTMENT',
                purpose: 'RENT',
                status: 'SUCCESS',
                paidAt: day,
                notes: OPENING_ADVANCE_NOTE,
                recordedBy: actor.name,
              },
            })
            const open = await tx.rentInvoice.findMany({
              where: { residentId: resident.id, status: { in: ['PENDING', 'PARTIALLY_PAID', 'OVERDUE'] }, balance: { gt: 0 } },
              orderBy: { dueDate: 'asc' },
            })
            const allocation = planAllocation(open, plan.advance)
            for (const a of allocation.allocations) {
              const inv = open.find((i) => i.id === a.invoiceId)!
              await tx.paymentAllocation.create({ data: { paymentId: payment.id, invoiceId: inv.id, amount: a.amount } })
              const amountPaid = inv.amountPaid + a.amount
              const left = inv.total - amountPaid
              await tx.rentInvoice.update({
                where: { id: inv.id },
                data: {
                  amountPaid,
                  balance: Math.max(0, left),
                  status: left <= 0 ? 'PAID' : 'PARTIALLY_PAID',
                  paidAt: left <= 0 ? day : null,
                },
              })
            }
            await tx.residentLedger.create({
              data: {
                organizationId: resident.organizationId,
                residentId: resident.id,
                kind: 'ADJUSTMENT',
                label: `Opening advance as of ${asOfLabel} (${receiptNumber})`,
                debit: 0,
                credit: plan.advance,
                balance: 0,
                entryDate: day,
                refType: 'RentPayment',
                refId: payment.id,
              },
            })
            done.push(`advance ${formatMoney(plan.advance)} (${receiptNumber})`)
          }
        }

        // 3. Deposit held → mark the deposit collected.
        if (plan.depositHeld > 0) {
          const current = resident.deposit
          if (!current || current.collected < plan.depositHeld) {
            const amount = Math.max(plan.depositHeld, current?.amount ?? resident.depositAmount)
            const status = plan.depositHeld >= amount ? 'COLLECTED' : 'PENDING'
            const deposit = current
              ? await tx.securityDeposit.update({
                  where: { id: current.id },
                  data: { amount, collected: plan.depositHeld, status, collectedAt: day },
                })
              : await tx.securityDeposit.create({
                  data: {
                    organizationId: resident.organizationId,
                    residentId: resident.id,
                    amount,
                    collected: plan.depositHeld,
                    status,
                    collectedAt: day,
                  },
                })
            if (amount !== resident.depositAmount) {
              await tx.resident.update({ where: { id: resident.id }, data: { depositAmount: amount } })
            }
            // Memo line: a deposit is held money, not a payment towards rent.
            await tx.residentLedger.create({
              data: {
                organizationId: resident.organizationId,
                residentId: resident.id,
                kind: 'DEPOSIT',
                label: `Security deposit held as of ${asOfLabel} — ${formatMoney(plan.depositHeld)} (before StayFlow)`,
                debit: 0,
                credit: 0,
                balance: 0,
                entryDate: day,
                refType: 'SecurityDeposit',
                refId: deposit.id,
              },
            })
            done.push(`deposit held ${formatMoney(plan.depositHeld)}`)
          }
        }

        if (!done.length) return { done }
        // Entries were dated in the past: recompute every running balance.
        await rebuildLedger(tx, resident.id)
        await recordActivity(
          {
            organizationId: resident.organizationId,
            propertyId: resident.propertyId,
            actorId: actor.id,
            actorName: actor.name,
            event: 'IMPORT_COMPLETED',
            entityType: 'Resident',
            entityId: resident.id,
            summary: `Opening balance imported for ${resident.fullName}: ${done.join(', ')}`,
            meta: { residentId: resident.id, asOf: day.toISOString(), outstanding: plan.outstanding, advance: plan.advance, depositHeld: plan.depositHeld },
          },
          tx,
        )
        return { done }
      }),
    ['number', 'receiptNumber'],
  )
}

export async function importBalanceRows(params: {
  validation: BalanceValidation
  actor: { id: string; name: string }
}): Promise<RowOutcome[]> {
  const outcomes: RowOutcome[] = []
  for (const check of params.validation.checks) {
    const plan = params.validation.plans.get(check.row)
    if (!plan || check.status !== 'ready') {
      outcomes.push({
        row: check.row,
        title: check.title,
        status: check.status === 'skip' ? 'skipped' : 'failed',
        message: check.status === 'skip' ? check.warnings[0] : check.errors.join('; ') || 'Not imported',
      })
      continue
    }
    try {
      const { done } = await importOne(plan, params.actor)
      outcomes.push({
        row: check.row,
        title: check.title,
        status: done.length ? 'imported' : 'skipped',
        message: done.length ? `Added ${done.join(', ')}` : 'Opening balance already imported',
        link: `/app/residents/${plan.residentId}`,
      })
    } catch (error) {
      const known = error instanceof ValidationError || error instanceof ConflictError || error instanceof NotFoundError
      if (!known) console.error('[import-balances] row failed', { row: check.row, error })
      outcomes.push({
        row: check.row,
        title: check.title,
        status: 'failed',
        message: known ? (error as Error).message : 'Could not save this balance. Try this row again.',
      })
    }
  }
  return outcomes
}
