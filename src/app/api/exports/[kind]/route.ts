import type { Prisma } from '@prisma/client'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { fail, route } from '@/lib/api-helpers'
import {
  hasPermission,
  maskIdNumber,
  requireModule,
  requirePermission,
  resolveScope,
  scopeWhere,
  type PropertyScope,
} from '@/lib/tenancy'
import type { SessionUser } from '@/lib/auth'
import type { ModuleKey } from '@/lib/modules'
import { endOfDay, startOfDay, toISODate } from '@/lib/utils'
import { dailyCollectionReport } from '@/server/services/billing'
import { profitAndLoss } from '@/server/services/analytics'
import type { PnlFigures } from '@/server/services/pnl'
import { toCsv } from '@/lib/csv'
import { AUDIT_CSV_HEADER, parseAuditFilters } from '@/lib/audit-filters'
import { auditCsvRows, orgAuditWhere } from '@/server/services/audit-log'
import { ELECTRICITY_EXPORT_HEADER, electricityExportRows } from '@/server/services/electricity'

/**
 * GET /api/exports/<kind>.csv?property=&from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * CSV downloads for owners and managers, limited to the PGs they can see.
 * Written with a UTF-8 BOM so Excel shows ₹ and Indian names correctly.
 * kinds: residents, invoices, payments, expenses (&status=&category=&vendor=), outstanding,
 *        daily-collection (?date=YYYY-MM-DD), pnl (?from=YYYY-MM&to=YYYY-MM — month range),
 *        complaints, maintenance, assets, visitors, staff, enquiries, bookings, deposits, charges,
 *        rent-revisions, activity (same filters as /app/activity: q, event, group, actor, entity, range)
 * GET /api/exports/all — owner only: every area as one Excel workbook.
 */

type Row = (string | number | null | undefined)[]

const KINDS = [
  'residents',
  'invoices',
  'payments',
  'expenses',
  'outstanding',
  'daily-collection',
  'pnl',
  'complaints',
  'maintenance',
  'assets',
  'visitors',
  'staff',
  'enquiries',
  'bookings',
  'deposits',
  'charges',
  'rent-revisions',
  'activity',
  'electricity',
] as const
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
  complaints: { module: 'complaints', permission: 'complaints.view' },
  maintenance: { module: 'complaints', permission: 'complaints.view' },
  assets: { module: 'inventory', permission: 'inventory.view' },
  visitors: { module: 'visitors', permission: 'visitors.view' },
  staff: { module: 'staff', permission: 'staff.view' },
  enquiries: { module: 'leads', permission: 'leads.view' },
  bookings: { module: 'leads', permission: 'leads.view' },
  deposits: { module: 'rent', permission: 'rent.view' },
  charges: { module: 'rent', permission: 'rent.view' },
  'rent-revisions': { module: 'rent', permission: 'rent.view' },
  activity: { module: 'activity', permission: 'activity.view' },
  electricity: { module: 'electricity', permission: 'electricity.view' },
}

// Cells are written by toCsv (src/lib/csv.ts), which neutralises spreadsheet
// formulas (=, +, -, @) so a resident's name can't run code.

const d = (date: Date | null | undefined) => (date ? toISODate(date) : '')

function range(url: URL) {
  const from = url.searchParams.get('from')
  const to = url.searchParams.get('to')
  return {
    gte: from ? startOfDay(new Date(from)) : undefined,
    lte: to ? endOfDay(new Date(to)) : undefined,
  }
}

type ExportContext = { user: SessionUser; url: URL; scope: PropertyScope }

/** Header and rows for one export kind. Access checks happen in the caller. */
async function buildExport(kind: Kind, { user, url, scope }: ExportContext): Promise<{ header: string[]; rows: Row[] }> {
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

  // Records tied to a resident rather than directly to a PG (deposits, rent revisions).
  const residentScoped = { organizationId: scope.organizationId, resident: { propertyId: where.propertyId } }
  // Staff and enquiries may belong to no single PG; those show in the all-PG view only.
  const orUnassigned = scope.propertyId ? [] : [{ propertyId: null }]
  const label = (v: string | null | undefined) => (v ? v.replace(/_/g, ' ').toLowerCase() : '')

  if (kind === 'complaints') {
    const complaints = await prisma.complaint.findMany({
      where: { ...where, ...(hasRange ? { createdAt: dates } : {}) },
      include: {
        property: { select: { name: true } },
        room: { select: { number: true } },
        resident: { select: { code: true, fullName: true } },
        assignedStaff: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
    })
    header = ['Code', 'Raised', 'PG', 'Room', 'Resident code', 'Resident', 'Category', 'Priority', 'Status', 'Title', 'Description', 'Assigned to', 'SLA due', 'SLA breached', 'Resolved', 'Closed', 'Resolution note', 'Rating']
    rows = complaints.map((c) => [
      c.code, d(c.createdAt), c.property.name, c.room?.number, c.resident?.code, c.resident?.fullName, c.category, c.priority, c.status,
      c.title, c.description, c.assignedStaff?.name, d(c.slaDueAt), c.slaBreachedAt ? 'yes' : '', d(c.resolvedAt), d(c.closedAt),
      c.resolutionNote, c.rating,
    ])
  }

  if (kind === 'maintenance') {
    const tasks = await prisma.maintenanceTask.findMany({
      where: { ...where, ...(hasRange ? { createdAt: dates } : {}) },
      include: {
        property: { select: { name: true } },
        room: { select: { number: true } },
        complaint: { select: { code: true } },
        assignedStaff: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
    })
    header = ['Created', 'PG', 'Room', 'Title', 'Kind', 'Priority', 'Status', 'Complaint', 'Assigned to', 'Due', 'Started', 'Completed', 'Vendor', 'Vendor phone', 'Estimate', 'Estimate approved', 'Actual cost', 'Linked expense', 'Completion note']
    rows = tasks.map((t) => [
      d(t.createdAt), t.property.name, t.room?.number, t.title, t.kind, t.priority, t.status, t.complaint?.code, t.assignedStaff?.name,
      d(t.dueDate), d(t.startedAt), d(t.completedAt), t.vendorName, t.vendorPhone, t.estimateAmount, d(t.estimateApprovedAt),
      t.actualCost, t.expenseId ? 'yes' : '', t.completionNote,
    ])
  }

  if (kind === 'assets') {
    const assets = await prisma.asset.findMany({
      where,
      include: { property: { select: { name: true } }, room: { select: { number: true } } },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    })
    header = ['Name', 'Category', 'PG', 'Room', 'Location', 'Quantity', 'Condition', 'Status', 'Purchase date', 'Purchase cost', 'Current value', 'Warranty till', 'Serial number', 'Notes']
    rows = assets.map((a) => [
      a.name, a.category, a.property.name, a.room?.number, a.location, a.quantity, a.condition, a.status, d(a.purchaseDate),
      a.purchaseCost, a.currentValue, d(a.warrantyTill), a.serialNumber, a.notes,
    ])
  }

  if (kind === 'visitors') {
    const visitors = await prisma.visitor.findMany({
      where: { ...where, ...(hasRange ? { entryAt: dates } : {}) },
      include: { property: { select: { name: true } }, resident: { select: { code: true, fullName: true } } },
      orderBy: { entryAt: 'desc' },
    })
    const time = (at: Date | null) => (at ? at.toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' }) : '')
    header = ['In', 'Out', 'PG', 'Visitor', 'Phone', 'Purpose', 'Relation', 'Resident code', 'Resident', 'ID proof', 'Notes']
    rows = visitors.map((v) => [
      time(v.entryAt), time(v.exitAt), v.property.name, v.name, v.phone, v.purpose, v.relation, v.resident?.code, v.resident?.fullName,
      maskIdNumber(v.idProof, user.role), v.notes,
    ])
  }

  if (kind === 'staff') {
    // Salary is pay data: only for people who manage staff.
    const showSalary = hasPermission(user, 'staff.manage')
    const staff = await prisma.staff.findMany({
      where: { organizationId: scope.organizationId, OR: [{ propertyId: where.propertyId }, ...orUnassigned] },
      include: { property: { select: { name: true } } },
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
    })
    header = ['Code', 'Name', 'Role', 'PG', 'Phone', 'Email', 'Joined', 'Exit date', 'Active', ...(showSalary ? ['Salary'] : []), 'ID number']
    rows = staff.map((s) => [
      s.code, s.name, label(s.role), s.property?.name ?? 'All PGs', s.phone, s.email, d(s.joiningDate), d(s.exitDate), s.active ? 'yes' : 'no',
      ...(showSalary ? [s.salary] : []), maskIdNumber(s.idNumber, user.role),
    ])
  }

  if (kind === 'enquiries') {
    const leads = await prisma.residentLead.findMany({
      where: {
        organizationId: scope.organizationId,
        OR: [{ propertyId: where.propertyId }, ...orUnassigned],
        ...(hasRange ? { createdAt: dates } : {}),
      },
      include: { property: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    })
    header = ['Received', 'Name', 'Phone', 'Email', 'Gender', 'PG', 'Source', 'Status', 'Budget', 'Room preference', 'Move-in date', 'Visit', 'Next follow-up', 'Lost reason', 'Notes']
    rows = leads.map((l) => [
      d(l.createdAt), l.name, l.phone, l.email, l.gender, l.property?.name, l.source, l.status, l.budget, l.roomTypePref, d(l.moveInDate),
      d(l.visitAt), d(l.nextFollowUpAt), l.lostReason, l.notes,
    ])
  }

  if (kind === 'bookings') {
    const bookings = await prisma.booking.findMany({
      where: { ...where, ...(hasRange ? { createdAt: dates } : {}) },
      include: { property: { select: { name: true } }, bed: { select: { label: true, room: { select: { number: true } } } } },
      orderBy: { createdAt: 'desc' },
    })
    header = ['Code', 'Booked', 'Name', 'Phone', 'Email', 'PG', 'Room', 'Bed', 'Check-in date', 'Rent', 'Deposit', 'Token', 'Token paid', 'Token method', 'Token reference', 'Status', 'Expires', 'Cancel reason']
    rows = bookings.map((b) => [
      b.code, d(b.createdAt), b.name, b.phone, b.email, b.property.name, b.bed?.room.number, b.bed?.label, d(b.checkInDate), b.rent, b.deposit,
      b.tokenAmount, d(b.tokenPaidAt), b.tokenMethod, b.tokenReference, b.status, d(b.expiresAt), b.cancelReason,
    ])
  }

  if (kind === 'deposits') {
    const deposits = await prisma.securityDeposit.findMany({
      where: { ...residentScoped, ...(hasRange ? { collectedAt: dates } : {}) },
      include: { resident: { select: { code: true, fullName: true, status: true, property: { select: { name: true } } } } },
      orderBy: { createdAt: 'desc' },
    })
    header = ['Resident code', 'Resident', 'Resident status', 'PG', 'Agreed', 'Collected', 'Deductions', 'Refunded', 'Held now', 'Status', 'Collected on', 'Refunded on', 'Refund method', 'Refund reference', 'Notes']
    rows = deposits.map((x) => [
      x.resident.code, x.resident.fullName, x.resident.status, x.resident.property.name, x.amount, x.collected, x.deductions, x.refunded,
      Math.max(0, x.collected - x.deductions - x.refunded), x.status, d(x.collectedAt), d(x.refundedAt), x.refundMethod, x.refundReference,
      x.refundNote ?? x.reason,
    ])
  }

  if (kind === 'charges') {
    const charges = await prisma.residentCharge.findMany({
      where: { ...where, ...(hasRange ? { startDate: dates } : {}) },
      include: { resident: { select: { code: true, fullName: true, property: { select: { name: true } } } } },
      orderBy: { createdAt: 'desc' },
    })
    header = ['Resident code', 'Resident', 'PG', 'Type', 'Category', 'Label', 'Amount', 'Starts', 'Ends', 'Last billed for', 'Status', 'Void reason', 'Added on']
    rows = charges.map((c) => [
      c.resident.code, c.resident.fullName, c.resident.property.name, c.kind, c.category, c.label, c.kind === 'DISCOUNT' ? -c.amount : c.amount,
      d(c.startDate), d(c.endDate), d(c.lastBilledFor), c.voidedAt ? 'VOIDED' : 'ACTIVE', c.voidReason, d(c.createdAt),
    ])
  }

  if (kind === 'rent-revisions') {
    const revisions = await prisma.rentRevision.findMany({
      where: { ...residentScoped, ...(hasRange ? { effectiveFrom: dates } : {}) },
      include: { resident: { select: { code: true, fullName: true, property: { select: { name: true } } } } },
      orderBy: { effectiveFrom: 'desc' },
    })
    header = ['Resident code', 'Resident', 'PG', 'Old rent', 'New rent', 'Change', 'Effective from', 'Reason', 'Recorded on']
    rows = revisions.map((r) => [
      r.resident.code, r.resident.fullName, r.resident.property.name, r.oldRent, r.newRent, r.newRent - r.oldRent, d(r.effectiveFrom),
      r.reason, d(r.createdAt),
    ])
  }

  if (kind === 'electricity') {
    // One row per resident share (?month=YYYY-MM&roomId=&status=&paymentStatus=).
    header = ELECTRICITY_EXPORT_HEADER
    rows = await electricityExportRows(user, {
      propertyId: scope.propertyId,
      month: url.searchParams.get('month'),
      roomId: url.searchParams.get('roomId'),
      residentId: url.searchParams.get('residentId'),
      status: url.searchParams.get('status'),
      paymentStatus: url.searchParams.get('paymentStatus'),
    })
  }

  if (kind === 'activity') {
    // Same filters as the Activity page (q, event, group, actor, entity, range, from/to).
    header = AUDIT_CSV_HEADER
    rows = await auditCsvRows(orgAuditWhere(user, scope, parseAuditFilters(url.searchParams)))
  }

  return { header, rows }
}

/** Kinds included in the owner's "download all my data" workbook (sheet name per kind). */
const ALL_DATA_SHEETS: [Kind, string][] = [
  ['residents', 'Residents'],
  ['invoices', 'Invoices'],
  ['payments', 'Payments'],
  ['deposits', 'Deposits'],
  ['charges', 'Charges'],
  ['rent-revisions', 'Rent revisions'],
  ['electricity', 'Electricity'],
  ['expenses', 'Expenses'],
  ['complaints', 'Complaints'],
  ['maintenance', 'Maintenance'],
  ['assets', 'Assets'],
  ['visitors', 'Visitors'],
  ['staff', 'Staff'],
  ['enquiries', 'Enquiries'],
  ['bookings', 'Bookings'],
  ['activity', 'Activity log'],
]

const canExportKind = (user: SessionUser, kind: Kind) =>
  user.modules.includes(KIND_ACCESS[kind].module) && hasPermission(user, KIND_ACCESS[kind].permission)

/**
 * GET /api/exports/all — the PG owner's full data export: one Excel workbook
 * with a sheet per area, every PG, all dates. Owner only.
 */
async function allDataWorkbook(user: SessionUser) {
  const scope = await resolveScope(user, null)
  // No date filter; the activity sheet covers all time.
  const url = new URL('http://export.local/?range=all')
  const ExcelJS = (await import('exceljs')).default
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'StayFlow'
  workbook.created = new Date()
  const summary = workbook.addWorksheet('About')
  summary.addRow(['StayFlow data export'])
  summary.addRow(['Generated', new Date().toLocaleString('en-IN')])
  summary.addRow(['Exported by', user.name])
  summary.addRow([])
  summary.addRow(['Sheet', 'Rows'])
  for (const [kind, name] of ALL_DATA_SHEETS) {
    if (!canExportKind(user, kind)) continue
    const { header, rows } = await buildExport(kind, { user, url, scope })
    const sheet = workbook.addWorksheet(name)
    sheet.addRow(header).font = { bold: true }
    for (const row of rows) sheet.addRow(row.map((v) => (v === null || v === undefined ? '' : v)))
    sheet.views = [{ state: 'frozen', ySplit: 1 }]
    summary.addRow([name, rows.length])
  }
  summary.getColumn(1).width = 24
  return Buffer.from(await workbook.xlsx.writeBuffer())
}

export const GET = route(
  async ({ user, request }) => {
    const url = new URL(request.url)
    const segments = url.pathname.split('/')
    const name = segments[segments.length - 1]

    if (name === 'all' || name === 'all.xlsx') {
      if (user.role !== 'OWNER') return fail('Only the PG owner can download all data', 403)
      const file = await allDataWorkbook(user)
      return new NextResponse(new Uint8Array(file), {
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="stayflow-all-data-${toISODate(new Date())}.xlsx"`,
          'Cache-Control': 'private, no-store',
        },
      })
    }

    const kind = name.replace(/\.csv$/, '') as Kind
    if (!KINDS.includes(kind)) return fail('Unknown export', 404)
    requireModule(user, KIND_ACCESS[kind].module)
    requirePermission(user, KIND_ACCESS[kind].permission)

    const scope = await resolveScope(user, url.searchParams.get('property'))
    const { header, rows } = await buildExport(kind, { user, url, scope })

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
