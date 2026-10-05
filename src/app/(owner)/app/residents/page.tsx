import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import { Bed, Building2, Phone, UserPlus } from 'lucide-react'

import type { Prisma, ResidentStatus } from '@prisma/client'
import { requireOrgUser } from '@/lib/auth'
import { resolveScope } from '@/lib/tenancy'
import { prisma } from '@/lib/prisma'
import { RESIDENT_STATUS_STYLE, themeFor } from '@/lib/theme'
import { cn, formatDate, formatMoney, formatPhone, initials } from '@/lib/utils'
import { PageHeader } from '@/components/app/page-header'
import { ExportButton } from '@/components/app/export-button'
import { Button } from '@/components/ui/button'
import { StatusChip } from '@/components/ui/badge'
import { EmptyState, TableSkeleton } from '@/components/ui/feedback'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableWrap,
} from '@/components/ui/table'
import { FilterBar, FilterSelect, Pagination, SearchInput } from '@/components/app/filters'
import { Avatar, AvatarFallback } from '@/components/ui/primitives'

export const metadata: Metadata = { title: 'Residents' }

const PAGE_SIZE = 20

const STATUS_OPTIONS = [
  { value: 'ACTIVE', label: 'Active' },
  { value: 'NOTICE', label: 'On notice' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'CHECKED_OUT', label: 'Checked out' },
]

const DUES_OPTIONS = [
  { value: 'overdue', label: 'Has overdue rent' },
  { value: 'pending', label: 'Has pending rent' },
  { value: 'clear', label: 'Fully paid' },
]

export default async function ResidentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const user = await requireOrgUser()
  const params = await searchParams
  const scope = await resolveScope(user, params.property)
  const propertyIds = scope.propertyId ? [scope.propertyId] : scope.allowedPropertyIds

  const page = Math.max(1, Number(params.page) || 1)
  const q = params.q?.trim() ?? ''
  const status = params.status as ResidentStatus | undefined
  const dues = params.dues

  const where: Prisma.ResidentWhereInput = {
    organizationId: scope.organizationId,
    propertyId: { in: propertyIds },
    ...(status ? { status } : {}),
    ...(q
      ? {
          OR: [
            { fullName: { contains: q, mode: 'insensitive' } },
            { code: { contains: q, mode: 'insensitive' } },
            { phone: { contains: q } },
            { email: { contains: q, mode: 'insensitive' } },
          ],
        }
      : {}),
    ...(dues === 'overdue'
      ? { invoices: { some: { status: 'OVERDUE' } } }
      : dues === 'pending'
        ? { invoices: { some: { status: { in: ['PENDING', 'PARTIALLY_PAID'] } } } }
        : dues === 'clear'
          ? { invoices: { none: { status: { in: ['PENDING', 'PARTIALLY_PAID', 'OVERDUE'] } } } }
          : {}),
  }

  const [residents, total, counts] = await Promise.all([
    prisma.resident.findMany({
      where,
      include: {
        property: { select: { name: true, type: true } },
        room: { select: { number: true } },
        bed: { select: { label: true } },
        invoices: {
          where: { status: { in: ['PENDING', 'PARTIALLY_PAID', 'OVERDUE'] } },
          select: { balance: true, status: true },
        },
      },
      orderBy: [{ status: 'asc' }, { fullName: 'asc' }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.resident.count({ where }),
    prisma.resident.groupBy({
      by: ['status'],
      where: { organizationId: scope.organizationId, propertyId: { in: propertyIds } },
      _count: { _all: true },
    }),
  ])

  const activeFilters = [q, status, dues].filter(Boolean).length
  const countFor = (s: string) => counts.find((c) => c.status === s)?._count._all ?? 0

  return (
    <div className="space-y-6">
      <PageHeader
        title="Residents"
        subtitle="Everyone living in your PGs, with their room, rent and outstanding balance."
        icon="user"
        breadcrumbs={[{ label: 'Dashboard', href: '/app' }, { label: 'Residents' }]}
        actions={
          <>
          <Suspense fallback={null}>
            <ExportButton kind="residents" />
          </Suspense>
          <Button variant="primary" asChild>
            <Link href={`/app/residents/new${scope.propertyId ? `?property=${scope.propertyId}` : ''}`}>
              <UserPlus className="size-4" />
              Check in resident
            </Link>
          </Button>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-4">
        <SummaryTile label="Active" value={countFor('ACTIVE')} tone="emerald" />
        <SummaryTile label="On notice" value={countFor('NOTICE')} tone="amber" />
        <SummaryTile label="Pending" value={countFor('PENDING')} tone="sky" />
        <SummaryTile label="Checked out" value={countFor('CHECKED_OUT')} tone="slate" />
      </div>

      <Suspense fallback={<TableSkeleton />}>
        <FilterBar activeCount={activeFilters}>
          <SearchInput placeholder="Search name, code or phone…" />
          <FilterSelect paramKey="status" placeholder="All statuses" options={STATUS_OPTIONS} />
          <FilterSelect paramKey="dues" placeholder="Any dues" options={DUES_OPTIONS} />
        </FilterBar>
      </Suspense>

      {residents.length === 0 ? (
        <EmptyState
          icon="user"
          title={activeFilters ? 'No residents match these filters' : 'No residents yet'}
          description={
            activeFilters
              ? 'Try clearing a filter or searching for a different name.'
              : 'Check in your first resident — their bed, rent schedule, food plan and app account are created automatically.'
          }
          action={
            !activeFilters && (
              <Button variant="primary" asChild>
                <Link href="/app/residents/new">
                  <UserPlus className="size-4" />
                  Check in resident
                </Link>
              </Button>
            )
          }
        />
      ) : (
        <>
          {/* Desktop table */}
          <TableWrap className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Resident</TableHead>
                  <TableHead>PG · Room · Bed</TableHead>
                  <TableHead>Joined</TableHead>
                  <TableHead className="text-right">Rent</TableHead>
                  <TableHead className="text-right">Outstanding</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {residents.map((resident) => {
                  const outstanding = resident.invoices.reduce((s, i) => s + i.balance, 0)
                  const hasOverdue = resident.invoices.some((i) => i.status === 'OVERDUE')
                  const theme = themeFor(resident.property.type)
                  return (
                    <TableRow key={resident.id}>
                      <TableCell>
                        <Link href={`/app/residents/${resident.id}`} className="flex items-center gap-3 group">
                          <Avatar className="size-9">
                            <AvatarFallback className={cn(theme.bg, theme.text)}>
                              {initials(resident.fullName)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <p className="truncate font-medium text-slate-900 group-hover:text-blue-700">
                              {resident.fullName}
                            </p>
                            <p className="truncate text-xs text-slate-500">
                              {resident.code} · {formatPhone(resident.phone)}
                            </p>
                          </div>
                        </Link>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className={cn('size-2 shrink-0 rounded-full', theme.bgSolid)} />
                          <div className="min-w-0">
                            <p className="truncate text-sm text-slate-700">{resident.property.name}</p>
                            <p className="text-xs text-slate-500">
                              {resident.room ? `Room ${resident.room.number}` : 'No room'}
                              {resident.bed ? ` · Bed ${resident.bed.label}` : ''}
                            </p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-slate-600">
                        {formatDate(resident.joiningDate)}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular">
                        {formatMoney(resident.rentAmount)}
                      </TableCell>
                      <TableCell className="text-right">
                        <span
                          className={cn(
                            'font-semibold tabular',
                            outstanding === 0
                              ? 'text-emerald-600'
                              : hasOverdue
                                ? 'text-red-600'
                                : 'text-amber-600',
                          )}
                        >
                          {outstanding === 0 ? '—' : formatMoney(outstanding)}
                        </span>
                      </TableCell>
                      <TableCell>
                        <StatusChip
                          label={RESIDENT_STATUS_STYLE[resident.status].label}
                          chip={RESIDENT_STATUS_STYLE[resident.status].chip}
                        />
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </TableWrap>

          {/* Mobile cards */}
          <ul className="space-y-2 md:hidden">
            {residents.map((resident) => {
              const outstanding = resident.invoices.reduce((s, i) => s + i.balance, 0)
              const theme = themeFor(resident.property.type)
              return (
                <li key={resident.id}>
                  <Link
                    href={`/app/residents/${resident.id}`}
                    className="block rounded-2xl border border-slate-200 bg-white p-4 shadow-card"
                  >
                    <div className="flex items-start gap-3">
                      <Avatar className="size-10">
                        <AvatarFallback className={cn(theme.bg, theme.text)}>
                          {initials(resident.fullName)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <p className="truncate font-medium text-slate-900">{resident.fullName}</p>
                          <StatusChip
                            label={RESIDENT_STATUS_STYLE[resident.status].label}
                            chip={RESIDENT_STATUS_STYLE[resident.status].chip}
                          />
                        </div>
                        <p className="mt-0.5 flex items-center gap-1 text-xs text-slate-500">
                          <Building2 className="size-3" />
                          {resident.property.name}
                          {resident.room && (
                            <>
                              <Bed className="ml-1 size-3" />
                              {resident.room.number}
                              {resident.bed ? `/${resident.bed.label}` : ''}
                            </>
                          )}
                        </p>
                        <div className="mt-2 flex items-center justify-between gap-2 text-sm">
                          <span className="flex items-center gap-1 text-xs text-slate-500">
                            <Phone className="size-3" />
                            {formatPhone(resident.phone)}
                          </span>
                          <span
                            className={cn(
                              'font-semibold tabular',
                              outstanding === 0 ? 'text-emerald-600' : 'text-red-600',
                            )}
                          >
                            {outstanding === 0 ? 'No dues' : formatMoney(outstanding)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </Link>
                </li>
              )
            })}
          </ul>

          <Suspense fallback={null}>
            <Pagination page={page} pageSize={PAGE_SIZE} total={total} />
          </Suspense>
        </>
      )}
    </div>
  )
}

function SummaryTile({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone: 'emerald' | 'amber' | 'sky' | 'slate'
}) {
  const tones = {
    emerald: 'border-emerald-100 bg-emerald-50/60 text-emerald-700',
    amber: 'border-amber-100 bg-amber-50/60 text-amber-700',
    sky: 'border-sky-100 bg-sky-50/60 text-sky-700',
    slate: 'border-slate-200 bg-slate-50 text-slate-600',
  }
  return (
    <div className={cn('rounded-2xl border px-4 py-3', tones[tone])}>
      <p className="text-xs font-medium uppercase tracking-wide opacity-80">{label}</p>
      <p className="mt-0.5 font-display text-2xl font-semibold tabular">{value}</p>
    </div>
  )
}
