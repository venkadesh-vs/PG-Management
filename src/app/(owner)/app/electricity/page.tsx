import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import { requireAccess } from '@/lib/auth'
import { resolveScope, hasPermission } from '@/lib/tenancy'
import { prisma } from '@/lib/prisma'
import { CHART_COLORS } from '@/lib/theme'
import { billingMonthLabel, monthKeyOf, monthStart } from '@/lib/electricity'
import {
  electricitySettings,
  electricitySummary,
  electricityTrend,
  listBills,
  listMeters,
  rateFor,
} from '@/server/services/electricity'
import { PageHeader } from '@/components/app/page-header'
import { StatCard, StatGrid } from '@/components/app/stat-card'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { CategoryBarChart } from '@/components/app/charts'
import { ExportButton } from '@/components/app/export-button'
import { FilterBar, FilterSelect } from '@/components/app/filters'
import { Button } from '@/components/ui/button'
import { ElectricityTabs } from './electricity-tabs'
import { meterCycleState } from '@/server/services/electricity-cycle'
import { MonthlyReadings, type MonthlyRoom } from './monthly-readings'
import { ElectricitySetup, type SetupRoom } from './setup'
import { BillHistory } from './bill-history'

export const metadata: Metadata = { title: 'Electricity' }

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/

export default async function ElectricityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const user = await requireAccess({ module: 'electricity', permission: 'electricity.view' })
  const params = await searchParams
  const scope = await resolveScope(user, params.property)
  const properties = await prisma.property.findMany({
    where: { id: { in: scope.allowedPropertyIds } },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  })

  // The monthly flow works one PG at a time: the switcher's PG, or the only one.
  const propertyId = scope.propertyId ?? (properties.length === 1 ? properties[0].id : null)
  const month = params.month && MONTH_RE.test(params.month) ? params.month : monthKeyOf(new Date())
  const canReadings = hasPermission(user, 'electricity.readings') || hasPermission(user, 'electricity.manage')
  const canManage = hasPermission(user, 'electricity.manage')

  const [summary, trend, bills, meters, drafts, settings] = await Promise.all([
    electricitySummary(user, propertyId, month),
    electricityTrend(user, propertyId),
    listBills(user, {
      propertyId,
      month,
      roomId: params.roomId,
      residentId: params.residentId,
      status: params.status,
      paymentStatus: params.paymentStatus,
    }),
    propertyId ? listMeters(user, { propertyId }) : Promise.resolve([]),
    propertyId ? listBills(user, { propertyId, month, status: 'DRAFT' }) : Promise.resolve([]),
    electricitySettings(user.organizationId!),
  ])
  const activeMeters = meters.filter((m) => m.status === 'ACTIVE')
  const setup = propertyId ? await loadSetup(propertyId, month, activeMeters) : null
  const showSetup = Boolean(setup && (setup.anyRate === null || !activeMeters.length || params.setup === '1'))

  // Filter options come from the bills themselves.
  const rooms = [...new Map(bills.map((b) => [b.room.id, b.room.number])).entries()]
  const residents = [
    ...new Map(bills.flatMap((b) => b.shares.map((s) => [s.residentId, s.residentName] as const))).entries(),
  ]
  const monthOptions = Array.from({ length: 12 }, (_, i) => {
    const d = new Date()
    const key = monthKeyOf(new Date(d.getFullYear(), d.getMonth() - i, 1))
    return { value: key, label: billingMonthLabel(key) }
  })
  const activeFilters = ['roomId', 'residentId', 'status', 'paymentStatus'].filter((k) => params[k]).length

  return (
    <div className="space-y-6">
      <PageHeader
        title="Electricity"
        subtitle="Each room's own meter, billed at the month's rate and shared only by the people who actually stayed."
        icon="zap"
        breadcrumbs={[{ label: 'Dashboard', href: '/app' }, { label: 'Electricity' }]}
        actions={<ExportButton kind="electricity" carry={['month', 'roomId', 'residentId', 'status', 'paymentStatus']} />}
      />
      <ElectricityTabs active="billing" />

      {/* ---------------------------------------------------- Monthly flow */}
      {!propertyId ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Pick a PG to enter readings</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {properties.map((p) => (
              <Button key={p.id} variant="outline" asChild>
                <Link href={`/app/electricity?property=${p.id}&month=${month}`}>{p.name}</Link>
              </Button>
            ))}
            {!properties.length && <p className="text-sm text-slate-500">Add a PG first.</p>}
          </CardContent>
        </Card>
      ) : showSetup && setup ? (
        <ElectricitySetup
          propertyId={propertyId}
          propertyName={properties.find((p) => p.id === propertyId)?.name ?? ''}
          currentRate={setup.anyRate}
          rooms={setup.setupRooms}
          canManage={canManage}
        />
      ) : setup ? (
        <MonthlyReadings
          propertyId={propertyId}
          propertyName={properties.find((p) => p.id === propertyId)?.name ?? ''}
          month={month}
          monthLabel={billingMonthLabel(month)}
          monthOptions={monthOptions}
          rate={setup.monthRate}
          rooms={setup.monthlyRooms}
          drafts={drafts.map(toRow)}
          roomsWithoutMeter={setup.setupRooms.filter((r) => !r.meterNumber).length}
          canReadings={canReadings}
          canManage={canManage}
          splitText={SPLIT_TEXT[settings.splitMethod] ?? ''}
          modeText={MODE_TEXT[settings.billingMode] ?? ''}
        />
      ) : null}

      {!showSetup && (
      <StatGrid cols={3}>
        <StatCard label={`Electricity · ${billingMonthLabel(month)}`} value={summary.amount} format="money" icon="zap" hint={`${formatUnits(summary.units)} units`} />
        <StatCard label="Readings due" value={summary.readingsDue} icon="clock" tone={summary.readingsDue ? 'amber' : 'default'} hint={`${summary.activeMeters} active meter${summary.activeMeters === 1 ? '' : 's'}`} />
        <StatCard label="Saved, not charged" value={summary.drafts} icon="file" tone={summary.drafts ? 'amber' : 'default'} hint={`${summary.finalized} charged`} />
        <StatCard label="Charged bills" value={summary.finalized} icon="check" />
        <StatCard label="Paid by the owner" value={summary.ownerCost} format="money" icon="wallet" hint="Empty rooms and residents already gone" />
        <StatCard label="Units this month" value={Math.round(summary.units)} icon="gauge" />
      </StatGrid>
      )}
      {/* --------------------------------------------------------- History */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card id="electricity-history" className="min-w-0 scroll-mt-20 lg:col-span-2">
          <CardHeader className="space-y-3">
            <CardTitle className="text-sm">Room bills · {billingMonthLabel(month)}</CardTitle>
            <Suspense>
              <FilterBar activeCount={activeFilters}>
                <FilterSelect paramKey="month" placeholder="This month" options={monthOptions} />
                <FilterSelect paramKey="roomId" placeholder="All rooms" options={rooms.map(([value, label]) => ({ value, label: `Room ${label}` }))} />
                <FilterSelect paramKey="residentId" placeholder="All residents" options={residents.map(([value, label]) => ({ value, label }))} />
                <FilterSelect
                  paramKey="status"
                  placeholder="Draft and final"
                  options={[
                    { value: 'DRAFT', label: 'Draft' },
                    { value: 'FINALIZED', label: 'Finalized' },
                    { value: 'VOID', label: 'Voided' },
                  ]}
                />
                <FilterSelect
                  paramKey="paymentStatus"
                  placeholder="Any payment"
                  options={[
                    { value: 'PAID', label: 'Paid' },
                    { value: 'PARTIALLY_PAID', label: 'Partly paid' },
                    { value: 'PENDING', label: 'Pending' },
                    { value: 'NOT_INVOICED', label: 'Waiting for the rent invoice' },
                    { value: 'UNCOLLECTIBLE', label: 'Owner pays' },
                  ]}
                />
              </FilterBar>
            </Suspense>
          </CardHeader>
          <CardContent className="pt-0">
            <BillHistory bills={bills.map(toRow)} canManage={canManage} />
          </CardContent>
        </Card>
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle className="text-sm">Last 6 months</CardTitle>
          </CardHeader>
          <CardContent className="pt-2">
            <CategoryBarChart
              layout="horizontal"
              color={CHART_COLORS[0]}
              height={240}
              data={trend.map((t) => ({ name: t.label.split(' ')[0], amount: t.amount }))}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function formatUnits(units: number) {
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 }).format(units)
}

type BillRow = Awaited<ReturnType<typeof listBills>>[number]

/** Plain, serialisable shape for the client components. */
function toRow(b: BillRow) {
  return {
    id: b.id,
    propertyName: b.property.name,
    roomNumber: b.room.number,
    meterNumber: b.meterNumber,
    billingMonth: b.billingMonth,
    kind: b.kind,
    periodStart: b.periodStart.toISOString(),
    periodEnd: b.periodEnd.toISOString(),
    previousReading: b.previousReading,
    currentReading: b.currentReading,
    units: b.units,
    ratePerUnit: b.ratePerUnit,
    amount: b.amount,
    occupantCount: b.occupantCount,
    perPerson: b.perPerson,
    ownerAbsorbed: b.ownerAbsorbed,
    status: b.status,
    voidReason: b.voidReason,
    shares: b.shares.map((s) => ({
      residentId: s.residentId,
      residentName: s.residentName,
      bedLabel: s.bedLabel,
      daysStayed: s.daysStayed,
      shareAmount: s.shareAmount,
      paymentStatus: s.paymentStatus,
      invoiceNumber: s.invoice?.number ?? null,
    })),
  }
}

export type ElectricityBillRow = ReturnType<typeof toRow>

const SPLIT_TEXT: Record<string, string> = {
  DAYS_STAYED: 'Each room’s bill is shared by the people who stayed, by their days in the room.',
  EQUAL_PRESENT: 'Each room’s bill is shared equally by the people living there on the reading date.',
}
const MODE_TEXT: Record<string, string> = {
  NEXT_RENT_INVOICE: 'Shares go on the next rent invoice.',
  SEPARATE_INVOICE: 'Each resident gets a separate electricity bill.',
}

type ActiveMeter = Awaited<ReturnType<typeof listMeters>>[number]

/**
 * Everything the setup and monthly screens need for one PG: the rate, every
 * room with its people and meter, and for each meter the reading the next
 * bill starts from plus any reading already taken this cycle (e.g. by the
 * warden) that is not billed yet.
 */
async function loadSetup(propertyId: string, month: string, activeMeters: ActiveMeter[]) {
  const meterIds = activeMeters.map((m) => m.id)
  const [rooms, occupied, cycle, monthRate, nowRate, latestRate] = await Promise.all([
    prisma.room.findMany({
      where: { propertyId },
      select: { id: true, number: true, floor: { select: { name: true, level: true } } },
      orderBy: [{ floor: { level: 'asc' } }, { number: 'asc' }],
    }),
    prisma.bed.groupBy({ by: ['roomId'], where: { propertyId, residentId: { not: null } }, _count: { _all: true } }),
    meterCycleState(meterIds),
    rateFor(prisma, propertyId, monthStart(month)),
    rateFor(prisma, propertyId, new Date()),
    prisma.electricityRate.findFirst({ where: { propertyId }, orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }] }),
  ])
  const people = new Map(occupied.map((o) => [o.roomId, o._count._all]))
  const meterByRoom = new Map(activeMeters.map((m) => [m.room.id, m]))

  const setupRooms: SetupRoom[] = rooms.map((r) => ({
    id: r.id,
    number: r.number,
    floor: r.floor.name,
    people: people.get(r.id) ?? 0,
    meterNumber: meterByRoom.get(r.id)?.meterNumber ?? null,
  }))

  const monthlyRooms: MonthlyRoom[] = rooms
    .filter((r) => meterByRoom.has(r.id))
    .map((r) => {
      const meter = meterByRoom.get(r.id)!
      const state = cycle.get(meter.id)
      return {
        meterId: meter.id,
        meterNumber: meter.meterNumber,
        roomNumber: r.number,
        floor: r.floor.name,
        people: people.get(r.id) ?? 0,
        baseline: state?.baseline ?? null,
        pending: state?.pending ?? null,
      }
    })

  const rateNumber = (r: { ratePerUnit: unknown } | null) => (r ? Number(String(r.ratePerUnit)) : null)
  return {
    setupRooms,
    monthlyRooms,
    monthRate: rateNumber(monthRate),
    anyRate: rateNumber(nowRate) ?? rateNumber(latestRate),
  }
}
