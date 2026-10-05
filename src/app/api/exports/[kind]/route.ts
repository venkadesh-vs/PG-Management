import type { Prisma } from '@prisma/client'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { fail, route } from '@/lib/api-helpers'
import { maskIdNumber, requireModule, requirePermission, resolveScope, scopeWhere } from '@/lib/tenancy'
import type { ModuleKey } from '@/lib/modules'
import { endOfDay, startOfDay, toISODate } from '@/lib/utils'

/**
 * GET /api/exports/<kind>.csv?property=&from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * CSV downloads for owners and managers, limited to the PGs they can see.
 * Written with a UTF-8 BOM so Excel shows ₹ and Indian names correctly.
 * kinds: residents, invoices, payments, expenses, outstanding
 */

type Row = (string | number | null | undefined)[]

const KINDS = ['residents', 'invoices', 'payments', 'expenses', 'outstanding'] as const
type Kind = (typeof KINDS)[number]

/** The module each export reads from, and the view permission it needs. */
const KIND_ACCESS: Record<Kind, { module: ModuleKey; permission: string }> = {
  residents: { module: 'residents', permission: 'residents.view' },
  invoices: { module: 'rent', permission: 'rent.view' },
  payments: { module: 'rent', permission: 'rent.view' },
  outstanding: { module: 'rent', permission: 'rent.view' },
  expenses: { module: 'expenses', permission: 'expenses.view' },
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
      header = ['Receipt', 'Date', 'Resident code', 'Resident', 'PG', 'Purpose', 'Method', 'Status', 'Amount', 'Reference', 'Gateway payment id', 'Demo', 'Recorded by']
      rows = payments.map((p) => [
        p.receiptNumber, d(p.paidAt), p.resident.code, p.resident.fullName, p.property.name, p.purpose, p.method, p.status,
        p.amount, p.reference, p.gatewayPaymentId, p.isDemo ? 'yes' : '', p.recordedBy,
      ])
    }

    if (kind === 'expenses') {
      const expenses = await prisma.expense.findMany({
        where: { ...where, ...(hasRange ? { spentOn: dates } : {}) },
        include: { category: { select: { name: true } }, property: { select: { name: true } } },
        orderBy: { spentOn: 'desc' },
      })
      header = ['Date', 'PG', 'Category', 'Title', 'Amount', 'Paid to', 'Mode', 'Reference', 'Notes', 'Recorded by']
      rows = expenses.map((e) => [
        d(e.spentOn), e.property.name, e.category.name, e.title, e.amount, e.paidTo, e.paymentMode, e.reference, e.notes, e.recordedBy,
      ])
    }

    const filename = `stayflow-${kind}-${toISODate(new Date())}.csv`
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
