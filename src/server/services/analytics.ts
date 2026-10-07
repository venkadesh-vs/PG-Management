import 'server-only'

import { prisma } from '@/lib/prisma'
import {
  addDays,
  addMonths,
  endOfDay,
  endOfMonth,
  formatMonth,
  startOfDay,
  startOfMonth,
} from '@/lib/utils'
import type { PropertyScope } from '@/lib/tenancy'
import { occupancyFor } from './residents'
import { COUNTED_EXPENSE } from './expense-rules'
import { buildPnl, monthKey } from './pnl'

/**
 * Every dashboard number is computed here, straight from PostgreSQL. Nothing
 * on a screen is hard-coded or cached in a counter column that could drift.
 * Collections count RENT payments only: a security deposit is held money
 * that is refunded at checkout, not revenue.
 */

export type DashboardSummary = Awaited<ReturnType<typeof dashboardSummary>>

export async function dashboardSummary(scope: PropertyScope) {
  const propertyIds = scope.propertyId ? [scope.propertyId] : scope.allowedPropertyIds
  if (!propertyIds.length) return emptySummary()

  const now = new Date()
  const today = startOfDay(now)
  const tomorrow = addDays(today, 1)
  const monthStart = startOfMonth(now)
  const monthEnd = endOfMonth(now)

  const [
    occupancy,
    residents,
    newThisMonth,
    onNotice,
    todayCollection,
    monthCollection,
    pending,
    overdue,
    monthExpenses,
    openComplaints,
    urgentComplaints,
    dueToday,
    checkoutsThisMonth,
    pendingTasks,
    expectedRevenue,
  ] = await Promise.all([
    occupancyFor(propertyIds),
    prisma.resident.count({
      where: { propertyId: { in: propertyIds }, status: { in: ['ACTIVE', 'NOTICE'] } },
    }),
    prisma.resident.count({
      where: { propertyId: { in: propertyIds }, joiningDate: { gte: monthStart, lte: monthEnd } },
    }),
    prisma.resident.count({ where: { propertyId: { in: propertyIds }, status: 'NOTICE' } }),
    prisma.rentPayment.aggregate({
      where: {
        propertyId: { in: propertyIds },
        status: 'SUCCESS',
        purpose: 'RENT',
        paidAt: { gte: today, lt: tomorrow },
      },
      _sum: { amount: true },
      _count: true,
    }),
    prisma.rentPayment.aggregate({
      where: {
        propertyId: { in: propertyIds },
        status: 'SUCCESS',
        purpose: 'RENT',
        paidAt: { gte: monthStart, lte: monthEnd },
      },
      _sum: { amount: true },
      _count: true,
    }),
    prisma.rentInvoice.aggregate({
      where: {
        propertyId: { in: propertyIds },
        status: { in: ['PENDING', 'PARTIALLY_PAID'] },
      },
      _sum: { balance: true },
      _count: true,
    }),
    prisma.rentInvoice.aggregate({
      where: { propertyId: { in: propertyIds }, status: 'OVERDUE' },
      _sum: { balance: true },
      _count: true,
    }),
    prisma.expense.aggregate({
      where: { ...COUNTED_EXPENSE, propertyId: { in: propertyIds }, spentOn: { gte: monthStart, lte: monthEnd } },
      _sum: { amount: true },
    }),
    prisma.complaint.count({
      where: {
        propertyId: { in: propertyIds },
        status: { in: ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD'] },
      },
    }),
    prisma.complaint.count({
      where: {
        propertyId: { in: propertyIds },
        status: { in: ['OPEN', 'ASSIGNED', 'IN_PROGRESS'] },
        priority: { in: ['HIGH', 'URGENT'] },
      },
    }),
    prisma.rentInvoice.findMany({
      where: {
        propertyId: { in: propertyIds },
        status: { in: ['PENDING', 'PARTIALLY_PAID'] },
        dueDate: { gte: today, lt: tomorrow },
      },
      include: { resident: { select: { id: true, fullName: true, phone: true } } },
      take: 10,
    }),
    prisma.resident.count({
      where: {
        propertyId: { in: propertyIds },
        status: 'CHECKED_OUT',
        exitDate: { gte: monthStart, lte: monthEnd },
      },
    }),
    prisma.maintenanceTask.count({
      where: {
        propertyId: { in: propertyIds },
        status: { in: ['PENDING', 'ACCEPTED', 'IN_PROGRESS'] },
      },
    }),
    prisma.resident.aggregate({
      where: { propertyId: { in: propertyIds }, status: { in: ['ACTIVE', 'NOTICE'] } },
      _sum: { rentAmount: true, foodCharge: true, maintenanceFee: true },
    }),
  ])

  const collected = monthCollection._sum.amount ?? 0
  const expenses = monthExpenses._sum.amount ?? 0

  return {
    occupancy,
    residents,
    newThisMonth,
    onNotice,
    checkoutsThisMonth,
    todayCollection: todayCollection._sum.amount ?? 0,
    todayPayments: todayCollection._count,
    monthCollection: collected,
    monthPayments: monthCollection._count,
    pendingRent: pending._sum.balance ?? 0,
    pendingCount: pending._count,
    overdueRent: overdue._sum.balance ?? 0,
    overdueCount: overdue._count,
    monthExpenses: expenses,
    netThisMonth: collected - expenses,
    expectedRevenue:
      (expectedRevenue._sum.rentAmount ?? 0) +
      (expectedRevenue._sum.foodCharge ?? 0) +
      (expectedRevenue._sum.maintenanceFee ?? 0),
    openComplaints,
    urgentComplaints,
    pendingTasks,
    dueToday: dueToday.map((i) => ({
      id: i.id,
      number: i.number,
      amount: i.balance,
      residentId: i.resident.id,
      residentName: i.resident.fullName,
      phone: i.resident.phone,
    })),
  }
}

function emptySummary() {
  return {
    occupancy: {
      total: 0,
      occupied: 0,
      available: 0,
      reserved: 0,
      maintenance: 0,
      blocked: 0,
      rate: 0,
    },
    residents: 0,
    newThisMonth: 0,
    onNotice: 0,
    checkoutsThisMonth: 0,
    todayCollection: 0,
    todayPayments: 0,
    monthCollection: 0,
    monthPayments: 0,
    pendingRent: 0,
    pendingCount: 0,
    overdueRent: 0,
    overdueCount: 0,
    monthExpenses: 0,
    netThisMonth: 0,
    expectedRevenue: 0,
    openComplaints: 0,
    urgentComplaints: 0,
    pendingTasks: 0,
    dueToday: [] as {
      id: string
      number: string
      amount: number
      residentId: string
      residentName: string
      phone: string
    }[],
  }
}

/** Collection vs expenses, month by month. */
export async function revenueTrend(propertyIds: string[], months = 6) {
  if (!propertyIds.length) return []
  const start = startOfMonth(addMonths(new Date(), -(months - 1)))

  const [payments, expenses, invoices] = await Promise.all([
    prisma.rentPayment.findMany({
      where: {
        propertyId: { in: propertyIds },
        status: 'SUCCESS',
        purpose: 'RENT',
        paidAt: { gte: start },
      },
      select: { amount: true, paidAt: true },
    }),
    prisma.expense.findMany({
      where: { ...COUNTED_EXPENSE, propertyId: { in: propertyIds }, spentOn: { gte: start } },
      select: { amount: true, spentOn: true },
    }),
    prisma.rentInvoice.findMany({
      where: { propertyId: { in: propertyIds }, periodStart: { gte: start } },
      select: { total: true, periodStart: true },
    }),
  ])

  const buckets = new Map<
    string,
    { month: string; collected: number; expenses: number; billed: number; sort: number }
  >()
  for (let i = 0; i < months; i++) {
    const d = startOfMonth(addMonths(start, i))
    buckets.set(key(d), {
      month: formatMonth(d),
      collected: 0,
      expenses: 0,
      billed: 0,
      sort: d.getTime(),
    })
  }

  for (const p of payments) {
    const b = buckets.get(key(p.paidAt))
    if (b) b.collected += p.amount
  }
  for (const e of expenses) {
    const b = buckets.get(key(e.spentOn))
    if (b) b.expenses += e.amount
  }
  for (const i of invoices) {
    const b = buckets.get(key(i.periodStart))
    if (b) b.billed += i.total
  }

  return [...buckets.values()].sort((a, b) => a.sort - b.sort)
}

function key(d: Date) {
  return `${d.getFullYear()}-${d.getMonth()}`
}

/** Occupancy percentage over time, from the daily snapshots. */
export async function occupancyTrend(propertyIds: string[], days = 30) {
  if (!propertyIds.length) return []
  const from = startOfDay(addDays(new Date(), -days))
  const snapshots = await prisma.occupancySnapshot.findMany({
    where: { propertyId: { in: propertyIds }, date: { gte: from } },
    orderBy: { date: 'asc' },
  })

  const byDate = new Map<string, { date: string; occupied: number; total: number; sort: number }>()
  for (const s of snapshots) {
    const k = s.date.toISOString().slice(0, 10)
    const entry = byDate.get(k) ?? {
      date: s.date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }),
      occupied: 0,
      total: 0,
      sort: s.date.getTime(),
    }
    entry.occupied += s.occupied
    entry.total += s.totalBeds
    byDate.set(k, entry)
  }

  return [...byDate.values()]
    .sort((a, b) => a.sort - b.sort)
    .map((e) => ({
      date: e.date,
      occupancy: e.total ? Math.round((e.occupied / e.total) * 100) : 0,
      occupied: e.occupied,
      total: e.total,
    }))
}

/** Rent collection status for the current month, as a donut. */
export async function collectionBreakdown(propertyIds: string[], month = new Date()) {
  if (!propertyIds.length) return { paid: 0, pending: 0, overdue: 0, total: 0 }
  const periodStart = startOfMonth(month)
  const invoices = await prisma.rentInvoice.findMany({
    where: { propertyId: { in: propertyIds }, periodStart },
    select: { total: true, amountPaid: true, balance: true, status: true },
  })
  const paid = invoices.reduce((s, i) => s + i.amountPaid, 0)
  const overdue = invoices
    .filter((i) => i.status === 'OVERDUE')
    .reduce((s, i) => s + i.balance, 0)
  const pending = invoices
    .filter((i) => i.status === 'PENDING' || i.status === 'PARTIALLY_PAID')
    .reduce((s, i) => s + i.balance, 0)
  return { paid, pending, overdue, total: paid + pending + overdue }
}

/** Expense split by category for a period. */
export async function expenseBreakdown(propertyIds: string[], from: Date, to: Date) {
  if (!propertyIds.length) return []
  const rows = await prisma.expense.groupBy({
    by: ['categoryId'],
    where: { ...COUNTED_EXPENSE, propertyId: { in: propertyIds }, spentOn: { gte: from, lte: to } },
    _sum: { amount: true },
  })
  const categories = await prisma.expenseCategory.findMany({
    where: { id: { in: rows.map((r) => r.categoryId) } },
  })
  return rows
    .map((r) => ({
      name: categories.find((c) => c.id === r.categoryId)?.name ?? 'Other',
      amount: r._sum.amount ?? 0,
    }))
    .sort((a, b) => b.amount - a.amount)
}

/** Side-by-side comparison used by the multi-PG dashboard. */
export async function propertyComparison(organizationId: string, propertyIds: string[]) {
  if (!propertyIds.length) return []
  const properties = await prisma.property.findMany({
    where: { organizationId, id: { in: propertyIds }, archivedAt: null },
    orderBy: { name: 'asc' },
  })
  const monthStart = startOfMonth(new Date())
  const monthEnd = endOfMonth(new Date())

  return Promise.all(
    properties.map(async (property) => {
      const [occupancy, residents, collection, pending, expenses, complaints] = await Promise.all([
        occupancyFor([property.id]),
        prisma.resident.count({
          where: { propertyId: property.id, status: { in: ['ACTIVE', 'NOTICE'] } },
        }),
        prisma.rentPayment.aggregate({
          where: {
            propertyId: property.id,
            status: 'SUCCESS',
            purpose: 'RENT',
            paidAt: { gte: monthStart, lte: monthEnd },
          },
          _sum: { amount: true },
        }),
        prisma.rentInvoice.aggregate({
          where: {
            propertyId: property.id,
            status: { in: ['PENDING', 'PARTIALLY_PAID', 'OVERDUE'] },
          },
          _sum: { balance: true },
        }),
        prisma.expense.aggregate({
          where: { ...COUNTED_EXPENSE, propertyId: property.id, spentOn: { gte: monthStart, lte: monthEnd } },
          _sum: { amount: true },
        }),
        prisma.complaint.count({
          where: {
            propertyId: property.id,
            status: { in: ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD'] },
          },
        }),
      ])
      return {
        id: property.id,
        name: property.name,
        type: property.type,
        city: property.city,
        occupancy,
        residents,
        collection: collection._sum.amount ?? 0,
        pending: pending._sum.balance ?? 0,
        expenses: expenses._sum.amount ?? 0,
        complaints,
      }
    }),
  )
}

/** Complaint status distribution for the dashboard chart. */
export async function complaintBreakdown(propertyIds: string[]) {
  if (!propertyIds.length) return []
  const rows = await prisma.complaint.groupBy({
    by: ['status'],
    where: { propertyId: { in: propertyIds } },
    _count: { _all: true },
  })
  return rows.map((r) => ({ status: r.status, count: r._count._all }))
}

/** Top-line numbers for a reporting period. */
export async function reportTotals(propertyIds: string[], from: Date, to: Date) {
  if (!propertyIds.length) {
    return {
      billed: 0,
      collected: 0,
      outstanding: 0,
      expenses: 0,
      net: 0,
      checkIns: 0,
      checkOuts: 0,
      complaints: 0,
      resolved: 0,
    }
  }
  const [billed, collected, outstanding, expenses, checkIns, checkOuts, complaints, resolved] =
    await Promise.all([
      prisma.rentInvoice.aggregate({
        where: { propertyId: { in: propertyIds }, issueDate: { gte: from, lte: to } },
        _sum: { total: true },
      }),
      prisma.rentPayment.aggregate({
        where: {
          propertyId: { in: propertyIds },
          status: 'SUCCESS',
          purpose: 'RENT',
          paidAt: { gte: from, lte: endOfDay(to) },
        },
        _sum: { amount: true },
      }),
      prisma.rentInvoice.aggregate({
        where: {
          propertyId: { in: propertyIds },
          status: { in: ['PENDING', 'PARTIALLY_PAID', 'OVERDUE'] },
        },
        _sum: { balance: true },
      }),
      prisma.expense.aggregate({
        where: { ...COUNTED_EXPENSE, propertyId: { in: propertyIds }, spentOn: { gte: from, lte: to } },
        _sum: { amount: true },
      }),
      prisma.resident.count({
        where: { propertyId: { in: propertyIds }, joiningDate: { gte: from, lte: endOfDay(to) } },
      }),
      prisma.resident.count({
        where: { propertyId: { in: propertyIds }, exitDate: { gte: from, lte: endOfDay(to) } },
      }),
      prisma.complaint.count({
        where: { propertyId: { in: propertyIds }, createdAt: { gte: from, lte: endOfDay(to) } },
      }),
      prisma.complaint.count({
        where: { propertyId: { in: propertyIds }, resolvedAt: { gte: from, lte: endOfDay(to) } },
      }),
    ])

  const collectedAmount = collected._sum.amount ?? 0
  const expenseAmount = expenses._sum.amount ?? 0

  return {
    billed: billed._sum.total ?? 0,
    collected: collectedAmount,
    outstanding: outstanding._sum.balance ?? 0,
    expenses: expenseAmount,
    net: collectedAmount - expenseAmount,
    checkIns,
    checkOuts,
    complaints,
    resolved,
  }
}

/* ------------------------------------------------------------------ */
/* Needs attention (PRD §22, §112)                                     */
/* ------------------------------------------------------------------ */

export type AttentionFlags = {
  rent: boolean
  complaints: boolean
  beds: boolean
  grocery: boolean
  bookings: boolean
  leads: boolean
  residents: boolean
  /** Resident requests waiting for a decision (module + requests.view). */
  requests?: boolean
}

export type AttentionCounts = Awaited<ReturnType<typeof attentionSummary>>

/** A bed is "long vacant" once it has sat AVAILABLE for this many days. */
export const LONG_VACANT_DAYS = 15

const OPEN_COMPLAINT = ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD'] as const

/**
 * Everything on the dashboard's "Needs attention" panel, in one parallel
 * round of queries. Each block runs only when the person can see that area
 * (flags), so a cook never pays for a rent query and never sees its result.
 */
export async function attentionSummary(scope: PropertyScope, flags: AttentionFlags) {
  const propertyIds = scope.propertyId ? [scope.propertyId] : scope.allowedPropertyIds
  const now = new Date()
  const today = startOfDay(now)
  const todayEnd = endOfDay(now)
  const weekEnd = endOfDay(addDays(today, 6))
  const vacantCutoff = addDays(today, -LONG_VACANT_DAYS)
  const skip = <T,>(on: boolean, run: () => Promise<T>, empty: T) =>
    on && propertyIds.length ? run() : Promise.resolve(empty)

  const [overdue, slaBreached, availableBeds, lowStock, expiringBookings, followUps, leaving] =
    await Promise.all([
      // Overdue = flagged OVERDUE by the cron, or unpaid past its due date
      // (covers the hours between the due date and the next cron run).
      skip(
        flags.rent,
        () =>
          prisma.rentInvoice.groupBy({
            by: ['residentId'],
            where: {
              propertyId: { in: propertyIds },
              balance: { gt: 0 },
              OR: [
                { status: 'OVERDUE' },
                { status: { in: ['PENDING', 'PARTIALLY_PAID'] }, dueDate: { lt: today } },
              ],
            },
            _sum: { balance: true },
          }),
        [],
      ),
      skip(
        flags.complaints,
        () =>
          prisma.complaint.count({
            where: {
              propertyId: { in: propertyIds },
              status: { in: [...OPEN_COMPLAINT] },
              OR: [{ slaBreachedAt: { not: null } }, { slaDueAt: { lt: now } }],
            },
          }),
        0,
      ),
      // Vacant-since = the most recent BedAllocation.toDate (the last
      // checkout/transfer out). A bed that has never been allocated falls
      // back to bed.updatedAt as a proxy (it moves when the bed's status was
      // last changed, e.g. created or set back to AVAILABLE).
      skip(
        flags.beds,
        () =>
          prisma.bed.findMany({
            where: { propertyId: { in: propertyIds }, status: 'AVAILABLE' },
            select: {
              id: true,
              updatedAt: true,
              allocations: {
                where: { toDate: { not: null } },
                orderBy: { toDate: 'desc' },
                take: 1,
                select: { toDate: true },
              },
            },
          }),
        [],
      ),
      skip(
        flags.grocery,
        () =>
          prisma.groceryItem.count({
            where: {
              propertyId: { in: propertyIds },
              currentStock: { lt: prisma.groceryItem.fields.minimumStock },
            },
          }),
        0,
      ),
      skip(
        flags.bookings,
        () =>
          prisma.booking.count({
            where: {
              organizationId: scope.organizationId,
              propertyId: { in: propertyIds },
              status: { in: ['PENDING', 'CONFIRMED'] },
              expiresAt: { gte: now, lte: endOfDay(addDays(today, 2)) },
            },
          }),
        0,
      ),
      skip(
        flags.leads,
        () =>
          prisma.residentLead.count({
            where: {
              organizationId: scope.organizationId,
              status: { notIn: ['BOOKED', 'CHECKED_IN', 'LOST'] },
              nextFollowUpAt: { lte: todayEnd },
              // Enquiries not yet tied to a PG are visible org-wide.
              ...(scope.propertyId
                ? { propertyId: scope.propertyId }
                : { OR: [{ propertyId: { in: propertyIds } }, { propertyId: null }] }),
            },
          }),
        0,
      ),
      skip(
        flags.residents,
        () =>
          prisma.resident.count({
            where: {
              propertyId: { in: propertyIds },
              status: 'NOTICE',
              exitDate: { gte: today, lte: weekEnd },
            },
          }),
        0,
      ),
    ])

  const pendingRequests = flags.requests && propertyIds.length
    ? await prisma.residentRequest.count({
        where: { organizationId: scope.organizationId, propertyId: { in: propertyIds }, status: 'PENDING' },
      })
    : 0

  const longVacantBeds = availableBeds.filter((b) => {
    const since = b.allocations[0]?.toDate ?? b.updatedAt
    return since < vacantCutoff
  }).length

  return {
    overdueResidents: overdue.length,
    overdueAmount: overdue.reduce((s, r) => s + (r._sum.balance ?? 0), 0),
    slaBreached,
    longVacantBeds,
    lowStock,
    expiringBookings,
    followUpsDue: followUps,
    leavingThisWeek: leaving,
    pendingRequests,
  }
}

/* ------------------------------------------------------------------ */
/* Vacancy intelligence (PRD §48)                                      */
/* ------------------------------------------------------------------ */

export type VacancyInsight = Awaited<ReturnType<typeof vacancyIntelligence>>

/**
 * What empty beds cost. Each PG's vacant beds are priced at the average rent
 * its current residents actually pay; a PG with nobody in it yet falls back
 * to its standard rent. Three grouped queries, no per-bed lookups.
 */
export async function vacancyIntelligence(scope: PropertyScope) {
  const propertyIds = scope.propertyId ? [scope.propertyId] : scope.allowedPropertyIds
  const [properties, vacant, rents] = await Promise.all([
    prisma.property.findMany({
      where: { organizationId: scope.organizationId, id: { in: propertyIds }, archivedAt: null },
      select: { id: true, name: true, type: true, standardRent: true },
      orderBy: { name: 'asc' },
    }),
    prisma.bed.groupBy({
      by: ['propertyId'],
      where: { propertyId: { in: propertyIds }, status: 'AVAILABLE' },
      _count: { _all: true },
    }),
    prisma.resident.groupBy({
      by: ['propertyId'],
      where: { propertyId: { in: propertyIds }, status: { in: ['ACTIVE', 'NOTICE'] } },
      _avg: { rentAmount: true },
      _sum: { rentAmount: true },
      _count: { _all: true },
    }),
  ])

  const vacantBy = new Map(vacant.map((v) => [v.propertyId, v._count._all]))
  const rentBy = new Map(rents.map((r) => [r.propertyId, r]))

  const byProperty = properties
    .map((p) => {
      const r = rentBy.get(p.id)
      const avgRent = Math.round(r?._avg.rentAmount ?? p.standardRent)
      const vacantBeds = vacantBy.get(p.id) ?? 0
      return {
        id: p.id,
        name: p.name,
        type: p.type,
        vacantBeds,
        averageRent: avgRent,
        monthlyLoss: vacantBeds * avgRent,
      }
    })
    .filter((p) => p.vacantBeds > 0)
    .sort((a, b) => b.monthlyLoss - a.monthlyLoss)

  const occupiedCount = rents.reduce((s, r) => s + r._count._all, 0)
  const occupiedRent = rents.reduce((s, r) => s + (r._sum.rentAmount ?? 0), 0)
  const fallback = properties.length
    ? Math.round(properties.reduce((s, p) => s + p.standardRent, 0) / properties.length)
    : 0

  return {
    vacantBeds: byProperty.reduce((s, p) => s + p.vacantBeds, 0),
    averageRent: occupiedCount ? Math.round(occupiedRent / occupiedCount) : fallback,
    monthlyLoss: byProperty.reduce((s, p) => s + p.monthlyLoss, 0),
    byProperty,
  }
}

/* ------------------------------------------------------------------ */
/* Profit & loss (phase 9) — basis documented in ./pnl                  */
/* ------------------------------------------------------------------ */

/**
 * Loads the period's collections, expenses, invoices and bed counts and
 * hands them to the pure buildPnl. `from`/`to` are whole months.
 */
export async function profitAndLoss(params: {
  organizationId: string
  propertyIds: string[]
  from: Date
  to: Date
}) {
  const from = startOfMonth(params.from)
  const to = endOfMonth(params.to)
  const months: { key: string; label: string }[] = []
  for (let d = from; d <= to; d = startOfMonth(addMonths(d, 1))) {
    months.push({ key: monthKey(d), label: formatMonth(d) })
  }
  const ids = params.propertyIds
  if (!ids.length) {
    return {
      months,
      ...buildPnl({ months, properties: [], payments: [], expenses: [], invoices: [], beds: {}, averageRent: {} }),
    }
  }

  const [properties, payments, expenses, invoices, snapshots, beds, rents] = await Promise.all([
    prisma.property.findMany({
      where: { organizationId: params.organizationId, id: { in: ids } },
      select: { id: true, name: true, type: true, standardRent: true },
      orderBy: { name: 'asc' },
    }),
    // REVERSED payments are out; a fully REFUNDED one nets to zero anyway.
    prisma.rentPayment.findMany({
      where: {
        organizationId: params.organizationId,
        propertyId: { in: ids },
        purpose: 'RENT',
        status: { in: ['SUCCESS', 'REFUNDED'] },
        paidAt: { gte: from, lte: to },
      },
      select: {
        propertyId: true,
        amount: true,
        refundedAmount: true,
        paidAt: true,
        allocations: { select: { amount: true, invoiceId: true }, orderBy: { createdAt: 'asc' } },
      },
    }),
    prisma.expense.findMany({
      where: {
        ...COUNTED_EXPENSE,
        organizationId: params.organizationId,
        propertyId: { in: ids },
        spentOn: { gte: from, lte: to },
      },
      select: { propertyId: true, amount: true, spentOn: true, category: { select: { name: true } } },
    }),
    prisma.rentInvoice.findMany({
      where: {
        organizationId: params.organizationId,
        propertyId: { in: ids },
        periodStart: { gte: from, lte: to },
        status: { notIn: ['CANCELLED', 'DRAFT'] },
      },
      select: { propertyId: true, total: true, amountPaid: true, balance: true },
    }),
    prisma.occupancySnapshot.findMany({
      where: { propertyId: { in: ids }, date: { gte: from, lte: to } },
      select: { propertyId: true, totalBeds: true, occupied: true },
    }),
    prisma.bed.groupBy({
      by: ['propertyId', 'status'],
      where: { propertyId: { in: ids } },
      _count: { _all: true },
    }),
    prisma.resident.groupBy({
      by: ['propertyId'],
      where: { propertyId: { in: ids }, status: { in: ['ACTIVE', 'NOTICE'] } },
      _avg: { rentAmount: true },
    }),
  ])

  const invoiceIds = [...new Set(payments.flatMap((p) => p.allocations.map((a) => a.invoiceId)))]
  const lines = invoiceIds.length
    ? await prisma.invoiceLine.findMany({
        where: { invoiceId: { in: invoiceIds } },
        select: { invoiceId: true, kind: true, amount: true },
      })
    : []
  const linesBy = new Map<string, { kind: string; amount: number }[]>()
  for (const l of lines) {
    const list = linesBy.get(l.invoiceId) ?? []
    list.push({ kind: l.kind, amount: l.amount })
    linesBy.set(l.invoiceId, list)
  }

  // Average beds over the period from the daily snapshots; today's bed
  // counts when there are none yet (a new account).
  const bedAvg: Record<string, { total: number; occupied: number }> = {}
  for (const p of properties) {
    const snaps = snapshots.filter((s) => s.propertyId === p.id)
    if (snaps.length) {
      bedAvg[p.id] = {
        total: snaps.reduce((s, x) => s + x.totalBeds, 0) / snaps.length,
        occupied: snaps.reduce((s, x) => s + x.occupied, 0) / snaps.length,
      }
    } else {
      const rows = beds.filter((b) => b.propertyId === p.id)
      bedAvg[p.id] = {
        total: rows.reduce((s, r) => s + r._count._all, 0),
        occupied: rows.filter((r) => r.status === 'OCCUPIED').reduce((s, r) => s + r._count._all, 0),
      }
    }
  }
  const rentBy = new Map(rents.map((r) => [r.propertyId, r._avg.rentAmount]))
  const averageRent: Record<string, number> = {}
  for (const p of properties) averageRent[p.id] = Math.round(rentBy.get(p.id) ?? p.standardRent)

  const report = buildPnl({
    months,
    properties: properties.map((p) => ({ id: p.id, name: p.name, type: p.type })),
    payments: payments.map((p) => ({
      propertyId: p.propertyId,
      month: monthKey(p.paidAt),
      amount: p.amount,
      refundedAmount: p.refundedAmount,
      allocations: p.allocations.map((a) => ({ amount: a.amount, lines: linesBy.get(a.invoiceId) ?? [] })),
    })),
    expenses: expenses.map((e) => ({
      propertyId: e.propertyId,
      month: monthKey(e.spentOn),
      amount: e.amount,
      category: e.category.name,
    })),
    invoices,
    beds: bedAvg,
    averageRent,
  })
  return { months, ...report }
}

/* ------------------------------------------------------------------ */
/* Vacancy details (phase 10) — the /app/vacancy page                   */
/* ------------------------------------------------------------------ */

export type VacancyDetails = Awaited<ReturnType<typeof vacancyDetails>>

/**
 * Bed counts by status per PG, every vacant bed with how long it has been
 * empty and its rent, and the rooms that still have space. Days vacant
 * follow attentionSummary: since the last checkout/transfer out, or since
 * the bed last changed when it was never occupied.
 */
export async function vacancyDetails(scope: PropertyScope) {
  const propertyIds = scope.propertyId ? [scope.propertyId] : scope.allowedPropertyIds
  const [insight, properties, counts, vacant] = await Promise.all([
    vacancyIntelligence(scope),
    prisma.property.findMany({
      where: { organizationId: scope.organizationId, id: { in: propertyIds }, archivedAt: null },
      select: { id: true, name: true, type: true, standardRent: true },
      orderBy: { name: 'asc' },
    }),
    prisma.bed.groupBy({
      by: ['propertyId', 'status'],
      where: { propertyId: { in: propertyIds } },
      _count: { _all: true },
    }),
    prisma.bed.findMany({
      where: { propertyId: { in: propertyIds }, status: 'AVAILABLE' },
      select: {
        id: true,
        label: true,
        rent: true,
        updatedAt: true,
        propertyId: true,
        room: { select: { id: true, number: true, type: true, baseRent: true } },
        floor: { select: { name: true } },
        allocations: {
          where: { toDate: { not: null } },
          orderBy: { toDate: 'desc' },
          take: 1,
          select: { toDate: true },
        },
      },
    }),
  ])

  const today = startOfDay(new Date())
  const propertyById = new Map(properties.map((p) => [p.id, p]))
  type Counts = { total: number; occupied: number; reserved: number; available: number; maintenance: number; blocked: number }
  const empty = (): Counts => ({ total: 0, occupied: 0, reserved: 0, available: 0, maintenance: 0, blocked: 0 })
  const totals = empty()
  const byProperty = properties.map((p) => {
    const c = empty()
    for (const row of counts) {
      if (row.propertyId !== p.id) continue
      const n = row._count._all
      c.total += n
      c[row.status.toLowerCase() as Exclude<keyof Counts, 'total'>] += n
    }
    for (const k of Object.keys(c) as (keyof Counts)[]) totals[k] += c[k]
    const loss = insight.byProperty.find((x) => x.id === p.id)
    return {
      id: p.id,
      name: p.name,
      type: p.type,
      ...c,
      rate: c.total ? Math.round((c.occupied / c.total) * 100) : 0,
      monthlyLoss: loss?.monthlyLoss ?? 0,
    }
  })

  const beds = vacant
    .filter((b) => propertyById.has(b.propertyId))
    .map((b) => {
      const since = b.allocations[0]?.toDate ?? b.updatedAt
      const property = propertyById.get(b.propertyId)!
      return {
        id: b.id,
        label: b.label,
        propertyId: b.propertyId,
        propertyName: property.name,
        propertyType: property.type,
        roomId: b.room.id,
        roomNumber: b.room.number,
        roomType: b.room.type,
        floor: b.floor.name,
        rent: b.rent ?? b.room.baseRent ?? property.standardRent,
        vacantSince: since,
        daysVacant: Math.max(0, Math.round((today.getTime() - startOfDay(since).getTime()) / 86400000)),
      }
    })
    .sort((a, b) => b.daysVacant - a.daysVacant)

  type RoomSpace = {
    id: string
    number: string
    type: string
    propertyName: string
    propertyType: (typeof beds)[number]['propertyType']
    floor: string
    free: number
    rent: number
  }
  const roomMap = new Map<string, RoomSpace>()
  for (const b of beds) {
    const room = roomMap.get(b.roomId) ?? {
      id: b.roomId,
      number: b.roomNumber,
      type: b.roomType,
      propertyName: b.propertyName,
      propertyType: b.propertyType,
      floor: b.floor,
      free: 0,
      rent: b.rent,
    }
    room.free++
    room.rent = Math.min(room.rent, b.rent)
    roomMap.set(b.roomId, room)
  }

  return {
    totals: { ...totals, rate: totals.total ? Math.round((totals.occupied / totals.total) * 100) : 0 },
    monthlyLoss: insight.monthlyLoss,
    averageRent: insight.averageRent,
    longVacant: beds.filter((b) => b.daysVacant >= LONG_VACANT_DAYS).length,
    byProperty,
    beds,
    rooms: [...roomMap.values()].sort((a, b) => b.free - a.free),
  }
}
