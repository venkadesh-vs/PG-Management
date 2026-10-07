import type { Prisma } from '@prisma/client'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { fail, route } from '@/lib/api-helpers'
import { maskIdNumber, requireModule, requirePermission, resolveScope, scopeWhere } from '@/lib/tenancy'
import type { ModuleKey } from '@/lib/modules'
import { endOfDay, startOfDay, toISODate } from '@/lib/utils'
import { dailyCollectionReport } from '@/server/services/billing'
import { profitAndLoss } from '@/server/services/analytics'
import type { PnlFigures } from '@/server/services/pnl'

/**
 * GET /api/exports/<kind>.csv?property=&from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * CSV downloads for owners and managers, limited to the PGs they can see.
 * Written with a UTF-8 BOM so Excel shows ₹ and Indian names correctly.
 * kinds: residents, invoices, payments, expenses (&status=&category=&vendor=), outstanding,
 *        daily-collection (?date=YYYY-MM-DD), pnl (?from=YYYY-MM&to=YYYY-MM — month range)
 */

type Row = (string | number | null | undefined)[]

const KINDS = ['residents', 'invoices', 'payments', 'expenses', 'outstanding', 'daily-collection', 'pnl'] as const
type Kind = (typeof KINDS)[number]

/** The module each export reads from, and the view permission it needs. */
const KIND_ACCESS: Record<Kind, { module: ModuleKey; permission: string }> = {
  residents: { module: 'residents', permission: 'residents.view' },
  invoices: { module: 'rent', permission: 'rent.view' },
  payments: { module: 'rent', permission: 'rent.view' },
  outstanding: { module: 'rent', permission: 'rent.view' },
  'daily-collection': { module: 'rent', permission: 'rent.view' },
  expenses: { module: 'expenses', permission: 'expenses.view' },
  // Revenue is rent money, so P&L also needs rent.view (checked below).
  pnl: { module: 'reports', permission: 'reports.view' },
}

function cell(value: string | number | null | undefined) {
  if (value === null || value === undefined) return ''
  const text = String(value)
  // Neutralise spreadsheet formulas (=, +, -, @) so a resident's name can't run code.
  const safe = /^[=+\-@\t\r]/.test(text) && typeof value === 'string' ? `'${text}` : text
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

function toCsv(header: string[], rows: Row[]) {
  return '﻿' + [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n'
}

const d = (date: Date | null | undefined) => (date ? toISODate(date) : '')

function range(url: URL) {
  const from = url.searchParams.get('from')
  const to = url.searchParams.get('to')
  return {
    gte: from ? startOfDay(new Date(from)) : undefined,
    lte: to ? endOfDay(new Date(to)) : undefined,
  }
}

export const GET = route(
  async ({ user, request }) => {
    const url = new URL(request.url)
    const segments = url.pathname.split('/')
    const kind = segments[segments.length - 1].replace(/\.csv$/, '') as Kind
    if (!KINDS.includes(kind)) return fail('Unknown export', 404)
    requireModule(user, KIND_ACCESS[kind].module)
    requirePermission(user, KIND_ACCESS[kind].permission)

    const scope = await resolveScope(user, url.searchParams.get('property'))
    const where = scopeWhere(scope)
    const dates = range(url)
    const hasRange = Boolean(dates.gte || dates.lte)
    let header: string[] = []
    let rows: Row[] = []

    if (kind === 'residents') {
      const residents = await prisma.resident.findMany({
        where,
        include: { property: { select: { name: true } }, room: { select: { number: true } }, bed: { select: { label: true } } },
        orderBy: [{ status: 'asc' }, { fullName: 'asc' }],
      })
      header = ['Code', 'Name', 'Status', 'PG', 'Room', 'Bed', 'Phone', 'WhatsApp', 'Email', 'Joined', 'Notice date', 'Exit date', 'Rent', 'Deposit', 'Guardian', 'Guardian phone', 'City', 'ID type', 'ID number', 'KYC']
      rows = residents.map((r) => [
        r.code, r.fullName, r.status, r.property.name, r.room?.number, r.bed?.label, r.phone, r.whatsappPhone, r.email,
        d(r.joiningDate), d(r.noticeDate), d(r.exitDate), r.rentAmount, r.depositAmount, r.guardianName, r.guardianPhone, r.city,
        r.idType, maskIdNumber(r.idNumber, user.role), r.kycStatus,
      ])
    }

    if (kind === 'invoices' || kind === 'outstanding') {
      const invoiceWhere: Prisma.RentInvoiceWhereInput = {
        ...where,
        ...(kind === 'outstanding' ? { status: { in: ['PENDING', 'PARTIALLY_PAID', 'OVERDUE'] }, balance: { gt: 0 } } : {}),
        ...(hasRange ? { periodStart: dates } : {}),
      }
      const invoices = await prisma.rentInvoice.findMany({
        where: invoiceWhere,
        include: { resident: { select: { code: true, fullName: true, phone: true } }, property: { select: { name: true } } },
        orderBy: [{ dueDate: 'asc' }, { number: 'asc' }],
      })
      header = ['Invoice', 'Resident code', 'Resident', 'Phone', 'PG', 'Period start', 'Period end', 'Due date', 'Status', 'Subtotal', 'Late fee', 'Total', 'Paid', 'Balance']
      rows = invoices.map((i) => [
        i.number, i.resident.code, i.resident.fullName, i.resident.phone, i.property.name, d(i.periodStart), d(i.periodEnd),
        d(i.dueDate), i.status, i.subtotal, i.lateFee, i.total, i.amountPaid, i.balance,
      ])
    }

    if (kind === 'payments') {
      const payments = await prisma.rentPayment.findMany({
        where: { ...where, ...(hasRange ? { paidAt: dates } : {}) },
        include: { resident: { select: { code: true, fullName: true } }, property: { select: { name: true } } },
        orderBy: { paidAt: 'desc' },
      })
      header = ['Receipt', 'Date', 'Resident code', 'Resident', 'PG', 'Purpose', 'Method', 'Status', 'Amount', 'Refunded', 'Reference', 'UTR', 'Gateway payment id', 'Demo', 'Recorded by', 'Reversal reason']
      rows = payments.map((p) => [
        p.receiptNumber, d(p.paidAt), p.resident.code, p.resident.fullName, p.property.name, p.purpose, p.method, p.status,
        p.amount, p.refundedAmount, p.reference, p.utr, p.gatewayPaymentId, p.isDemo ? 'yes' : '', p.recordedBy, p.reversalReason,
      ])
    }

    if (kind === 'expenses') {
      const status = url.searchParams.get('status')
      const category = url.searchParams.get('category')
      const vendor = url.searchParams.get('vendor')?.trim()
      const expenses = await prisma.expense.findMany({
        where: {
          ...where,
          ...(hasRange ? { spentOn: dates } : {}),
          ...(category ? { categoryId: category } : {}),
          ...(vendor ? { paidTo: { contains: vendor, mode: 'insensitive' as const } } : {}),
          ...(status === 'VOIDED'
            ? { voidedAt: { not: null } }
            : status === 'PENDING' || status === 'REJECTED' || status === 'APPROVED'
              ? { voidedAt: null, approvalStatus: status }
              : {}),
        },
        include: { category: { select: { name: true } }, property: { select: { name: true } } },
        orderBy: { spentOn: 'desc' },
      })
      const origin = url.origin
      header = ['Date', 'PG', 'Category', 'Title', 'Amount', 'Vendor', 'Bill number', 'Mode', 'Reference', 'Status', 'Approved by', 'Recurring', 'Repeats from', 'Attachment', 'Void reason', 'Notes', 'Recorded by']
      rows = expenses.map((e) => [
        d(e.spentOn), e.property.name, e.category.name, e.title, e.amount, e.paidTo, e.billNumber, e.paymentMode, e.reference,
        e.voidedAt ? 'VOIDED' : e.approvalStatus, e.approvedBy, e.isRecurring ? e.recurrence ?? 'MONTHLY' : '', e.recurringFromId ? 'yes' : '',
        e.receiptUrl ? `${origin}${e.receiptUrl}` : '', e.voidReason, e.notes, e.recordedBy,
      ])
    }

    if (kind === 'pnl') {
      requireModule(user, 'rent')
      requirePermission(user, 'rent.view')
      const month = (v: string | null) => {
        const m = v?.match(/^(\d{4})-(\d{2})/)
        return m ? new Date(Number(m[1]), Number(m[2]) - 1, 1) : null
      }
      const toMonth = month(url.searchParams.get('to')) ?? new Date()
      const fromMonth = month(url.searchParams.get('from')) ?? toMonth
      const pnl = await profitAndLoss({
        organizationId: scope.organizationId,
        propertyIds: scope.propertyId ? [scope.propertyId] : scope.allowedPropertyIds,
        from: fromMonth,
        to: toMonth,
      })
      const columns = [{ name: 'All PGs', f: pnl.total }, ...pnl.byProperty.map((p) => ({ name: p.name, f: p }))]
      const line = (label: string, pick: (f: PnlFigures) => number | null): Row => [label, ...columns.map((c) => pick(c.f) ?? '')]
      const categories = pnl.total.expensesByCategory.map((c) => c.name)
      header = ['Line', ...columns.map((c) => c.name)]
      rows = [
        [`Period ${toISODate(fromMonth).slice(0, 7)} to ${toISODate(toMonth).slice(0, 7)} · cash basis, excludes deposits, net of refunds and reversals`],
        line('Revenue: Rent', (f) => f.revenue.rent),
        line('Revenue: Food', (f) => f.revenue.food),
        line('Revenue: Electricity & water', (f) => f.revenue.utilities),
        line('Revenue: Other income', (f) => f.revenue.other),
        line('Revenue: Advance (not yet billed)', (f) => f.revenue.advance),
        line('Total revenue', (f) => f.revenue.total),
        ...categories.map((name) => line(`Expense: ${name}`, (f) => f.expensesByCategory.find((c) => c.name === name)?.amount ?? 0)),
        line('Total expenses', (f) => f.expenses),
        line('Net profit', (f) => f.net),
        line('Billed (invoices for these months)', (f) => f.billed),
        line('Collection rate %', (f) => f.collectionRate),
        line('Outstanding on these invoices', (f) => f.outstanding),
        line('Beds (average)', (f) => f.beds),
        line('Occupied beds (average)', (f) => f.occupiedBeds),
        line('Profit per bed', (f) => f.profitPerBed),
        line('Revenue per occupied bed', (f) => f.revenuePerOccupiedBed),
        line('Estimated vacancy loss', (f) => f.vacancyLoss),
        line('Deposits received via invoices (excluded)', (f) => f.revenue.depositExcluded),
        [],
        ['Month', 'Revenue', 'Expenses', 'Net profit'],
        ...pnl.trend.map((t): Row => [t.key, t.revenue, t.expenses, t.profit]),
      ]
    }

    if (kind === 'daily-collection') {
      const m = url.searchParams.get('date')?.match(/^(\d{4})-(\d{2})-(\d{2})$/)
      const day = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date()
      const report = await dailyCollectionReport({
        organizationId: scope.organizationId,
        propertyIds: scope.propertyId ? [scope.propertyId] : scope.allowedPropertyIds,
        date: day,
      })
      header = ['Section', 'Time', 'Resident code', 'Resident', 'PG', 'Entry', 'Method', 'Reference', 'Amount']
      const t = (at: Date) => at.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
      const section = (name: string, list: typeof report.lists.invoiced, amount: (r: (typeof list)[number]) => number): Row[] =>
        list.map((r) => [name, t(r.at), r.code, r.resident, r.property, r.label, r.method, r.reference, amount(r)])
      rows = [
        ['Summary', toISODate(day), '', '', '', 'Opening outstanding', '', '', report.opening],
        ['Summary', '', '', '', '', 'Invoiced today (+)', '', '', report.invoiced],
        ['Summary', '', '', '', '', 'Collected today (-)', '', '', report.collected],
        ['Summary', '', '', '', '', 'Adjustments (+/-)', '', '', report.adjustments],
        ['Summary', '', '', '', '', 'Closing outstanding', '', '', report.closing],
        ...Object.entries(report.byMethod).map(([method, amount]): Row => ['Collected by method', '', '', '', '', method, method, '', amount]),
        ...section('Invoiced', report.lists.invoiced, (r) => r.debit),
        ...section('Collected', report.lists.collected, (r) => r.credit),
        ...section('Adjustment', report.lists.adjustments, (r) => r.debit - r.credit),
        ...report.openingByResident.map((r): Row => ['Opening by resident', '', r.code, r.resident, r.property, 'Opening balance', '', '', r.balance]),
      ]
    }

    const filename = `stayflow-${kind}-${kind === 'daily-collection' ? (/^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get('date') ?? '') ? url.searchParams.get('date') : toISODate(new Date())) : toISODate(new Date())}.csv`
    return new NextResponse(toCsv(header, rows), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'private, no-store',
      },
    })
  },
  { permission: 'reports.export' },
)
