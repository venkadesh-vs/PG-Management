import type { Metadata } from 'next'
import Link from 'next/link'
import {
  ArrowRight,
  Bed,
  Building2,
  CalendarClock,
  CheckCircle2,
  Megaphone,
  Utensils,
  Wallet,
  Wrench,
  ListChecks,
} from 'lucide-react'
import { requireTenant } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { COMPLAINT_STATUS_STYLE } from '@/lib/theme'
import { cn, daysBetween, formatDate, formatMoney, startOfDay } from '@/lib/utils'
import { MEAL_TYPES } from '@/server/services/kitchen'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { StatusChip } from '@/components/ui/badge'
import { PayRentButton } from './rent/pay-rent-button'

export const metadata: Metadata = { title: 'Home' }

export default async function TenantHome() {
  const user = await requireTenant()
  const today = startOfDay(new Date())
  const on = {
    food: user.modules.includes('food'),
    complaints: user.modules.includes('complaints'),
    announcements: user.modules.includes('announcements'),
    requests: user.modules.includes('requests'),
  }

  const resident = await prisma.resident.findUnique({
    where: { id: user.residentId },
    include: {
      property: true,
      room: true,
      bed: true,
      deposit: true,
      foodSubscription: { include: { foodPlan: true } },
      invoices: {
        where: { status: { in: ['PENDING', 'PARTIALLY_PAID', 'OVERDUE'] } },
        orderBy: { dueDate: 'asc' },
      },
      complaints: {
        where: { status: { in: ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD'] } },
        orderBy: { createdAt: 'desc' },
        take: 3,
      },
    },
  })
  if (!resident) return null
  const nextInvoice = resident.invoices[0]
  const outstanding = resident.invoices.reduce((s, i) => s + i.balance, 0)
  const daysToDue = nextInvoice ? daysBetween(today, nextInvoice.dueDate) : null
  const overdue = Boolean(nextInvoice && daysToDue !== null && daysToDue < 0)

  const [meals, announcement] = await Promise.all([
    on.food
      ? prisma.meal.findMany({
          where: { propertyId: resident.propertyId, date: today },
          orderBy: { type: 'asc' },
        })
      : Promise.resolve([]),
    on.announcements
      ? prisma.announcement.findFirst({
          where: {
            organizationId: resident.organizationId,
            OR: [{ propertyId: null }, { propertyId: resident.propertyId }],
          },
          orderBy: [{ pinned: 'desc' }, { publishedAt: 'desc' }],
        })
      : Promise.resolve(null),
  ])

  return (
    <div className="space-y-5">
      {/* ------------------------------------------------------- Greeting */}
      <div
        className={cn(
          'relative overflow-hidden rounded-2xl bg-gradient-to-br from-blue-700 to-blue-600 p-5 text-white shadow-sm ring-1 ring-blue-900/10',
        )}
      >
        <div className="dot-grid absolute inset-0 opacity-[0.12]" />
        <div className="relative">
          <p className="text-sm text-white/75">
            {new Date().getHours() < 12
              ? 'Good morning'
              : new Date().getHours() < 17
                ? 'Good afternoon'
                : 'Good evening'}
            ,
          </p>
          <h1 className="font-display text-2xl font-semibold tracking-tight">
            {resident.fullName.split(' ')[0]}
          </h1>

          <div className="mt-4 grid grid-cols-3 gap-2">
            <HomeTile icon={Building2} label="PG" value={resident.property.name.replace(/StayFlow\s*/i, '')} />
            <HomeTile
              icon={Bed}
              label="Room"
              value={resident.room ? `${resident.room.number}${resident.bed ? ` / ${resident.bed.label}` : ''}` : '—'}
            />
            <HomeTile icon={Wallet} label="Rent" value={formatMoney(resident.rentAmount)} />
          </div>
        </div>
      </div>

      {/* ----------------------------------------------------------- Rent */}
      <Card
        className={cn(
          'overflow-hidden',
          overdue ? 'border-rose-200' : outstanding > 0 ? 'border-amber-200' : 'border-emerald-200',
        )}
      >
        <CardContent className="p-5">
          {nextInvoice ? (
            <>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-medium text-slate-500">
                    {overdue ? 'Rent overdue' : 'Rent due'}
                  </p>
                  <p
                    className={cn(
                      'mt-1 font-display text-3xl font-semibold tabular',
                      overdue ? 'text-rose-600' : 'text-slate-900',
                    )}
                  >
                    {formatMoney(outstanding)}
                  </p>
                  <p
                    className={cn(
                      'mt-1 flex items-center gap-1.5 text-sm',
                      overdue ? 'text-rose-600' : 'text-slate-500',
                    )}
                  >
                    <CalendarClock className="size-3.5" />
                    {overdue
                      ? `${Math.abs(daysToDue!)} days overdue · was due ${formatDate(nextInvoice.dueDate)}`
                      : daysToDue === 0
                        ? 'Due today'
                        : `Due in ${daysToDue} days · ${formatDate(nextInvoice.dueDate)}`}
                  </p>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <PayRentButton
                  invoice={{
                    id: nextInvoice.id,
                    number: nextInvoice.number,
                    balance: nextInvoice.balance,
                  }}
                  propertyType={resident.property.type}
                />
                <Button variant="outline" asChild>
                  <Link href="/tenant/rent">
                    View invoices
                    <ArrowRight className="size-3.5" />
                  </Link>
                </Button>
              </div>
            </>
          ) : (
            <div className="flex items-center gap-3">
              <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-emerald-50">
                <CheckCircle2 className="size-5 text-emerald-600" />
              </div>
              <div>
                <p className="font-display text-base font-semibold text-slate-900">
                  You are all paid up
                </p>
                <p className="text-sm text-slate-500">
                  Your next invoice will appear here when it is generated.
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ----------------------------------------------------------- Food */}
      {on.food && resident.foodOptIn && (
        <Card>
          <CardContent className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <p className="flex items-center gap-2 font-display text-sm font-semibold text-slate-900">
                <Utensils className="size-4 text-slate-500" />
                Today&apos;s menu
              </p>
              <Link href="/tenant/food" className="text-xs font-semibold text-blue-600">
                All meals
              </Link>
            </div>
            <div className="space-y-2">
              {MEAL_TYPES.map((type) => {
                const meal = meals.find((m) => m.type === type)
                return (
                  <div
                    key={type}
                    className="flex items-start justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900">
                        {type.charAt(0) + type.slice(1).toLowerCase()}
                      </p>
                      <p className="text-sm text-slate-700">
                        {meal?.menu ?? 'Menu not published yet'}
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ----------------------------------------------------- Complaints */}
      {on.complaints && (
      <Card>
        <CardContent className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <p className="flex items-center gap-2 font-display text-sm font-semibold text-slate-900">
              <Wrench className="size-4 text-slate-400" />
              Your complaints
            </p>
            <Link href="/tenant/complaints" className="text-xs font-semibold text-blue-600">
              See all
            </Link>
          </div>

          {resident.complaints.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 p-4 text-center">
              <p className="text-sm text-slate-500">Nothing open right now.</p>
              <Button variant="outline" size="sm" className="mt-2" asChild>
                <Link href="/tenant/complaints">Raise a complaint</Link>
              </Button>
            </div>
          ) : (
            <ul className="space-y-2">
              {resident.complaints.map((complaint) => (
                <li key={complaint.id}>
                  <Link
                    href={`/tenant/complaints/${complaint.id}`}
                    className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-3 transition-colors hover:bg-slate-50"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-800">
                        {complaint.title}
                      </p>
                      <p className="text-xs text-slate-500">
                        {complaint.code} · {formatDate(complaint.createdAt)}
                      </p>
                    </div>
                    <StatusChip
                      label={COMPLAINT_STATUS_STYLE[complaint.status].label}
                      chip={COMPLAINT_STATUS_STYLE[complaint.status].chip}
                    />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      )}

      {/* ------------------------------------------------------- Requests */}
      {on.requests && (
        <Link href="/tenant/requests">
          <Card className="transition-shadow hover:shadow-sm">
            <CardContent className="flex items-center gap-3 p-5">
              <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-slate-100">
                <ListChecks className="size-5 text-slate-600" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-display text-sm font-semibold text-slate-900">Requests</p>
                <p className="text-sm text-slate-500">
                  Going home, expecting a visitor or want a room change? Ask here.
                </p>
              </div>
              <ArrowRight className="size-4 shrink-0 text-slate-300" />
            </CardContent>
          </Card>
        </Link>
      )}

      {/* --------------------------------------------------- Announcement */}
      {announcement && (
        <Link href="/tenant/announcements">
          <Card className="border-sky-200 bg-sky-50/50 transition-shadow hover:shadow-sm">
            <CardContent className="flex items-start gap-3 p-5">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-white shadow-sm">
                <Megaphone className="size-4 text-sky-600" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-sky-900">{announcement.title}</p>
                <p className="mt-0.5 line-clamp-2 text-sm text-sky-800/80">{announcement.body}</p>
                <p className="mt-1 text-[11px] text-sky-700/70">
                  {formatDate(announcement.publishedAt)}
                </p>
              </div>
            </CardContent>
          </Card>
        </Link>
      )}

      {/* ------------------------------------------------------- Stay info */}
      <Card>
        <CardContent className="grid grid-cols-2 gap-4 p-5 text-sm">
          <Info label="Joined" value={formatDate(resident.joiningDate)} />
          <Info label="Monthly rent" value={formatMoney(resident.rentAmount)} />
          <Info
            label="Security deposit"
            value={formatMoney(resident.deposit?.collected ?? 0)}
          />
          {on.food && (
            <Info
              label="Food plan"
              value={
                resident.foodSubscription?.active
                  ? resident.foodSubscription.foodPlan.name
                  : 'Not subscribed'
              }
            />
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function HomeTile({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType
  label: string
  value: string
}) {
  return (
    <div className="rounded-xl border border-white/15 bg-white/10 p-2.5 backdrop-blur">
      <Icon className="size-3.5 text-white/70" />
      <p className="mt-1 text-[11px] font-medium text-white/70">{label}</p>
      <p className="truncate text-sm font-semibold">{value}</p>
    </div>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-0.5 font-medium text-slate-800">{value}</p>
    </div>
  )
}
