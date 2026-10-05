import type { Metadata } from 'next'
import Link from 'next/link'
import type { BookingStatus, Prisma } from '@prisma/client'
import { ClipboardList } from 'lucide-react'
import { requireAccess } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { resolveScope } from '@/lib/tenancy'
import { addDays, cn } from '@/lib/utils'
import { PageHeader } from '@/components/app/page-header'
import { StatCard } from '@/components/app/stat-card'
import { Button } from '@/components/ui/button'
import { getLeadForUser } from '@/server/services/leads'
import { BOOKING_STATUS } from '../leads/lead-meta'
import { BookingsList, type BookingRow } from './bookings-list'
import { NewBookingButton, type BookingPrefill } from './new-booking'

export const metadata: Metadata = { title: 'Bookings' }

const STATUS_TABS: { value: string; label: string }[] = [
  { value: '', label: 'Active' },
  { value: 'CONFIRMED', label: 'Confirmed' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'CHECKED_IN', label: 'Checked in' },
  { value: 'EXPIRED', label: 'Expired' },
  { value: 'CANCELLED', label: 'Cancelled' },
  { value: 'ALL', label: 'All' },
]

export default async function BookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ property?: string; status?: string; q?: string; new?: string; lead?: string }>
}) {
  const user = await requireAccess({ module: 'leads', permission: 'leads.view' })
  const params = await searchParams
  const scope = await resolveScope(user, params.property)
  const propertyIds = scope.propertyId ? [scope.propertyId] : scope.allowedPropertyIds
  const canBook = user.role === 'SUPER_ADMIN' || user.permissions.includes('bookings.manage')
  const canCheckIn = user.role === 'SUPER_ADMIN' || user.permissions.includes('residents.manage')
  const status = params.status ?? ''
  const q = params.q?.trim() ?? ''

  const base: Prisma.BookingWhereInput = { organizationId: scope.organizationId, propertyId: { in: propertyIds } }
  const where: Prisma.BookingWhereInput = {
    ...base,
    ...(status === 'ALL'
      ? {}
      : status
        ? { status: status as BookingStatus }
        : { status: { in: ['PENDING', 'CONFIRMED'] } }),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { code: { contains: q, mode: 'insensitive' } },
            { phone: { contains: q.replace(/\D/g, '') || q } },
          ],
        }
      : {}),
  }

  const now = new Date()
  const [rows, confirmed, pending, tokens, expiringSoon, properties] = await Promise.all([
    prisma.booking.findMany({
      where,
      include: {
        bed: { select: { label: true, room: { select: { number: true } } } },
        property: { select: { id: true, name: true } },
        lead: { select: { id: true } },
      },
      orderBy: [{ checkInDate: 'asc' }, { createdAt: 'desc' }],
      take: 200,
    }),
    prisma.booking.count({ where: { ...base, status: 'CONFIRMED' } }),
    prisma.booking.count({ where: { ...base, status: 'PENDING' } }),
    prisma.booking.aggregate({
      where: { ...base, status: { in: ['PENDING', 'CONFIRMED'] }, tokenPaidAt: { not: null } },
      _sum: { tokenAmount: true },
    }),
    prisma.booking.count({
      where: { ...base, status: { in: ['PENDING', 'CONFIRMED'] }, expiresAt: { lte: addDays(now, 2) } },
    }),
    prisma.property.findMany({
      where: { id: { in: scope.allowedPropertyIds } },
      select: { id: true, name: true, standardRent: true, standardDeposit: true },
      orderBy: { name: 'asc' },
    }),
  ])

  // "Create booking" from an enquiry lands here with ?new=1&lead=…
  let prefill: BookingPrefill | null = null
  if (params.new && canBook) {
    prefill = {}
    if (params.lead) {
      const lead = await getLeadForUser(user, params.lead).catch(() => null)
      if (lead) {
        prefill = {
          leadId: lead.id,
          name: lead.name,
          phone: lead.phone,
          email: lead.email ?? '',
          propertyId: lead.propertyId ?? undefined,
          checkInDate: lead.moveInDate && lead.moveInDate > now ? lead.moveInDate.toISOString() : undefined,
        }
      }
    }
  }

  const bookings: BookingRow[] = rows.map((b) => ({
    id: b.id,
    code: b.code,
    name: b.name,
    phone: b.phone,
    status: b.status,
    checkInDate: b.checkInDate.toISOString(),
    expiresAt: b.expiresAt?.toISOString() ?? null,
    rent: b.rent,
    deposit: b.deposit,
    tokenAmount: b.tokenAmount,
    tokenPaidAt: b.tokenPaidAt?.toISOString() ?? null,
    tokenMethod: b.tokenMethod,
    cancelReason: b.cancelReason,
    bed: b.bed ? `${b.bed.room.number}-${b.bed.label}` : null,
    property: b.property,
    leadId: b.lead?.id ?? null,
    residentId: b.residentId,
  }))

  return (
    <div className="space-y-6">
      <PageHeader
        title="Bookings"
        subtitle="Beds held for people moving in soon. Take a token, keep the bed safe, and check them in with one tap."
        icon="calendar"
        breadcrumbs={[{ label: 'Dashboard', href: '/app' }, { label: 'Bookings' }]}
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href="/app/leads">
                <ClipboardList /> Enquiries
              </Link>
            </Button>
            {canBook && <NewBookingButton properties={properties} defaultPropertyId={scope.propertyId} prefill={prefill} />}
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Beds on hold" value={confirmed} icon="bed" tone="blue" hint="Confirmed bookings" />
        <StatCard label="Pending" value={pending} icon="clock" tone="amber" hint="Not holding a bed yet" />
        <StatCard label="Tokens collected" value={tokens._sum.tokenAmount ?? 0} format="money" icon="wallet" tone="emerald" hint="On active bookings" />
        <StatCard label="Expiring in 48h" value={expiringSoon} icon="warning" tone="red" hint={expiringSoon ? 'Call them or extend' : 'Nothing urgent'} />
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 scrollbar-slim sm:mx-0 sm:px-0">
          {STATUS_TABS.map((tab) => {
            const active = tab.value === status
            const query = new URLSearchParams()
            if (tab.value) query.set('status', tab.value)
            if (params.property) query.set('property', params.property)
            if (q) query.set('q', q)
            const meta = BOOKING_STATUS[tab.value]
            return (
              <Link
                key={tab.label}
                href={`/app/bookings${query.size ? `?${query}` : ''}`}
                className={cn(
                  'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors',
                  active ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50',
                )}
              >
                {meta && <span className={cn('size-1.5 rounded-full', meta.dot)} />}
                {tab.label}
              </Link>
            )
          })}
        </div>
        <form className="sm:w-64" action="/app/bookings">
          {status && <input type="hidden" name="status" value={status} />}
          {params.property && <input type="hidden" name="property" value={params.property} />}
          <input
            name="q"
            defaultValue={q}
            placeholder="Search name, phone or BK-…"
            className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none transition-shadow focus:border-blue-400 focus:ring-4 focus:ring-blue-500/10"
          />
        </form>
      </div>

      <BookingsList
        bookings={bookings}
        canBook={canBook}
        canCheckIn={canCheckIn}
        filtered={Boolean(status || q)}
        newButton={canBook ? <NewBookingButton properties={properties} defaultPropertyId={scope.propertyId} label="Hold a bed" /> : null}
      />
    </div>
  )
}
