import type { Metadata } from 'next'
import Link from 'next/link'
import {
  ArrowRight,
  Bed,
  Building2,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Coffee,
  ListChecks,
  Megaphone,
  Moon,
  ShieldCheck,
  Sparkles,
  Sun,
  Utensils,
  Wallet,
  Wrench,
} from 'lucide-react'
import { requireTenant } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { COMPLAINT_STATUS_STYLE } from '@/lib/theme'
import { cn, daysBetween, formatDate, formatMoney, startOfDay } from '@/lib/utils'
import { MEAL_TYPES } from '@/server/services/kitchen'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { StatusChip } from '@/components/ui/badge'
import { Stagger, StaggerItem } from '@/components/motion/reveal'
import { PayRentButton } from './rent/pay-rent-button'
import { IconTile, PhoneSection, TAPPABLE } from './_ui/phone-ui'

export const metadata: Metadata = { title: 'Home' }

const MEAL_ICON = { BREAKFAST: Coffee, LUNCH: Sun, DINNER: Moon } as const

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

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const statusLine = nextInvoice
    ? overdue
      ? `Rent is ${Math.abs(daysToDue!)} days overdue`
      : daysToDue === 0
        ? 'Rent is due today'
        : `Rent due in ${daysToDue} days`
    : 'You are all paid up'

  return (
    <Stagger onView={false} gap={0.07} className="space-y-5">
      {/* ------------------------------------------------------- Greeting */}
      <StaggerItem>
        <div className="relative isolate overflow-hidden rounded-3xl bg-ink-950 p-5 text-white shadow-float ring-1 ring-white/10">
          <div className="pointer-events-none absolute -right-16 -top-20 -z-10 size-56 rounded-full bg-blue-500/40 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-24 -left-16 -z-10 size-56 rounded-full bg-marigold-300/20 blur-3xl" />
          <div className="dot-grid pointer-events-none absolute inset-0 -z-10 opacity-[0.06]" />

          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-marigold-200">
            <Sparkles className="size-3.5" />
            {greeting}
          </p>
          <h1 className="mt-1.5 font-display text-[28px] font-semibold leading-tight tracking-tight">
            Hi, {resident.fullName.split(' ')[0]}
          </h1>
          <p className="mt-1 flex items-center gap-2 text-sm text-white/65">
            <span
              className={cn(
                'size-1.5 rounded-full',
                overdue ? 'bg-rose-400' : outstanding > 0 ? 'bg-amber-300' : 'bg-emerald-400',
              )}
            />
            {statusLine}
          </p>

          <div className="mt-5 grid grid-cols-3 gap-2">
            <HomeTile icon={Building2} label="PG" value={resident.property.name.replace(/StayFlow\s*/i, '')} />
            <HomeTile
              icon={Bed}
              label="Room"
              value={resident.room ? `${resident.room.number}${resident.bed ? ` / ${resident.bed.label}` : ''}` : '—'}
            />
            <HomeTile icon={Wallet} label="Rent" value={formatMoney(resident.rentAmount)} />
          </div>
        </div>
      </StaggerItem>

      {/* ----------------------------------------------------------- Rent */}
      <StaggerItem>
        <Card className="relative overflow-hidden">
          <div
            className={cn(
              'absolute inset-x-0 top-0 h-1',
              overdue
                ? 'bg-gradient-to-r from-rose-500 to-rose-400'
                : outstanding > 0
                  ? 'bg-gradient-to-r from-amber-400 to-marigold-300'
                  : 'bg-gradient-to-r from-emerald-500 to-emerald-400',
            )}
          />
          <CardContent className="p-5">
            {nextInvoice ? (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      {overdue ? 'Rent overdue' : 'Rent due'}
                    </p>
                    <p
                      className={cn(
                        'mt-1 font-display text-[32px] font-semibold leading-none tabular',
                        overdue ? 'text-rose-600' : 'text-slate-900',
                      )}
                    >
                      {formatMoney(outstanding)}
                    </p>
                  </div>
                  <IconTile icon={Wallet} tone={overdue ? 'rose' : 'amber'} size="lg" />
                </div>
                <p
                  className={cn(
                    'mt-3 flex items-center gap-1.5 text-sm',
                    overdue ? 'font-medium text-rose-600' : 'text-slate-500',
                  )}
                >
                  <CalendarClock className="size-4 shrink-0" />
                  {overdue
                    ? `${Math.abs(daysToDue!)} days overdue · was due ${formatDate(nextInvoice.dueDate)}`
                    : daysToDue === 0
                      ? 'Due today'
                      : `Due in ${daysToDue} days · ${formatDate(nextInvoice.dueDate)}`}
                </p>

                <div className="mt-4 grid grid-cols-2 gap-2 [&>*]:h-11 [&>*]:w-full">
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
                <IconTile icon={CheckCircle2} tone="emerald" size="lg" />
                <div>
                  <p className="font-display text-base font-semibold text-slate-900">You are all paid up</p>
                  <p className="text-sm text-slate-500">
                    Your next invoice will appear here when it is generated.
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </StaggerItem>

      {/* ----------------------------------------------------------- Food */}
      {on.food && resident.foodOptIn && (
        <StaggerItem>
          <PhoneSection
            icon={Utensils}
            title="Today's menu"
            action={<SeeAll href="/tenant/food" label="All meals" />}
          >
            <Card>
              <CardContent className="divide-y divide-slate-100 p-0">
                {MEAL_TYPES.map((type) => {
                  const meal = meals.find((m) => m.type === type)
                  const Icon = MEAL_ICON[type as keyof typeof MEAL_ICON] ?? Utensils
                  return (
                    <div key={type} className="flex items-start gap-3 px-4 py-3.5">
                      <IconTile icon={Icon} tone={type === 'LUNCH' ? 'marigold' : 'blue'} size="sm" />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          {type.charAt(0) + type.slice(1).toLowerCase()}
                        </p>
                        <p
                          className={cn(
                            'mt-0.5 text-sm leading-snug',
                            meal?.menu ? 'font-medium text-slate-800' : 'italic text-slate-400',
                          )}
                        >
                          {meal?.menu ?? 'Menu not published yet'}
                        </p>
                      </div>
                    </div>
                  )
                })}
              </CardContent>
            </Card>
          </PhoneSection>
        </StaggerItem>
      )}

      {/* ----------------------------------------------------- Complaints */}
      {on.complaints && (
        <StaggerItem>
          <PhoneSection
            icon={Wrench}
            title="Your complaints"
            action={<SeeAll href="/tenant/complaints" label="See all" />}
          >
            {resident.complaints.length === 0 ? (
              <div className="flex items-center gap-3 rounded-2xl border border-dashed border-slate-200 bg-white p-4">
                <IconTile icon={CheckCircle2} tone="emerald" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-slate-900">Nothing open right now</p>
                  <p className="text-xs text-slate-500">Something broken? Tell your PG in seconds.</p>
                </div>
                <Button variant="outline" size="sm" className="h-10 shrink-0" asChild>
                  <Link href="/tenant/complaints">Raise a complaint</Link>
                </Button>
              </div>
            ) : (
              <ul className="space-y-2">
                {resident.complaints.map((complaint) => (
                  <li key={complaint.id}>
                    <Link
                      href={`/tenant/complaints/${complaint.id}`}
                      className={cn(
                        'flex min-h-[60px] items-center gap-3 rounded-2xl border border-slate-200/80 bg-white p-3.5 shadow-card',
                        TAPPABLE,
                      )}
                    >
                      <IconTile icon={Wrench} size="sm" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-slate-900">{complaint.title}</p>
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
          </PhoneSection>
        </StaggerItem>
      )}

      {/* ------------------------------------------------------- Requests */}
      {on.requests && (
        <StaggerItem>
          <Link
            href="/tenant/requests"
            className={cn(
              'flex items-center gap-3 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-card',
              TAPPABLE,
            )}
          >
            <IconTile icon={ListChecks} size="lg" />
            <div className="min-w-0 flex-1">
              <p className="font-display text-[15px] font-semibold text-slate-900">Requests</p>
              <p className="text-sm leading-snug text-slate-500">
                Going home, expecting a visitor or want a room change? Ask here.
              </p>
            </div>
            <ChevronRight className="size-5 shrink-0 text-slate-300" />
          </Link>
        </StaggerItem>
      )}

      {/* --------------------------------------------------- Announcement */}
      {announcement && (
        <StaggerItem>
          <Link
            href="/tenant/announcements"
            className={cn(
              'relative flex items-start gap-3 overflow-hidden rounded-2xl border border-marigold-200/70 bg-gradient-to-br from-marigold-50 via-white to-white p-4 shadow-card',
              TAPPABLE,
              'hover:border-marigold-300',
            )}
          >
            <IconTile icon={Megaphone} tone="marigold" />
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-marigold-700">
                Latest notice · {formatDate(announcement.publishedAt)}
              </p>
              <p className="mt-0.5 text-sm font-semibold text-slate-900">{announcement.title}</p>
              <p className="mt-0.5 line-clamp-2 text-sm leading-snug text-slate-600">{announcement.body}</p>
            </div>
            <ChevronRight className="mt-2.5 size-5 shrink-0 text-slate-300" />
          </Link>
        </StaggerItem>
      )}

      {/* ------------------------------------------------------- Stay info */}
      <StaggerItem>
        <PhoneSection icon={Bed} title="Your stay">
          <Card>
            <CardContent className="grid grid-cols-2 gap-x-4 gap-y-5 p-5 text-sm">
              <Info icon={CalendarDays} label="Joined" value={formatDate(resident.joiningDate)} />
              <Info icon={Wallet} label="Monthly rent" value={formatMoney(resident.rentAmount)} />
              <Info
                icon={ShieldCheck}
                label="Security deposit"
                value={formatMoney(resident.deposit?.collected ?? 0)}
              />
              {on.food && (
                <Info
                  icon={Utensils}
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
        </PhoneSection>
      </StaggerItem>
    </Stagger>
  )
}

function SeeAll({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="-my-2 -mr-2 inline-flex min-h-11 items-center gap-0.5 rounded-lg px-2 text-xs font-semibold text-blue-600 transition-colors hover:text-blue-700"
    >
      {label}
      <ChevronRight className="size-3.5" />
    </Link>
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
    <div className="min-w-0 rounded-2xl bg-white/[0.06] p-3 ring-1 ring-inset ring-white/10 backdrop-blur">
      <Icon className="size-4 text-marigold-300" />
      <p className="mt-2 text-[11px] font-medium text-white/50">{label}</p>
      <p className="line-clamp-2 break-words text-sm font-semibold leading-snug">{value}</p>
    </div>
  )
}

function Info({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-start gap-2.5">
      <Icon className="mt-0.5 size-4 shrink-0 text-blue-500" />
      <div className="min-w-0">
        <p className="text-xs text-slate-500">{label}</p>
        <p className="mt-0.5 break-words font-semibold text-slate-800">{value}</p>
      </div>
    </div>
  )
}
