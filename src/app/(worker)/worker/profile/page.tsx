import type { Metadata } from 'next'
import { Building2, CalendarDays, Phone, Wallet } from 'lucide-react'
import { requireWorker } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { addDays, cn, formatDate, formatMoney, formatPhone, initials, startOfDay } from '@/lib/utils'
import { Card, CardContent } from '@/components/ui/card'
import { Avatar, AvatarFallback } from '@/components/ui/primitives'
import { MarkAttendanceButton } from './mark-attendance'

export const metadata: Metadata = { title: 'Profile' }

const ATTENDANCE_STYLE: Record<string, string> = {
  PRESENT: 'bg-emerald-400',
  LATE: 'bg-amber-400',
  HALF_DAY: 'bg-sky-300',
  LEAVE: 'bg-violet-300',
  ABSENT: 'bg-red-400',
  WEEKLY_OFF: 'bg-slate-200',
}

export default async function WorkerProfilePage() {
  const user = await requireWorker()
  const today = startOfDay(new Date())

  const staff = await prisma.staff.findUnique({
    where: { id: user.staffId },
    include: {
      property: { select: { name: true, addressLine: true, city: true, contactPhone: true } },
      attendance: {
        where: { date: { gte: addDays(today, -29) } },
        orderBy: { date: 'asc' },
      },
      _count: {
        select: {
          tasks: { where: { status: 'COMPLETED' } },
          complaints: { where: { status: { in: ['RESOLVED', 'CLOSED'] } } },
        },
      },
    },
  })
  if (!staff) return null

  const todayAttendance = staff.attendance.find(
    (a) => startOfDay(a.date).getTime() === today.getTime(),
  )
  const presentDays = staff.attendance.filter((a) =>
    ['PRESENT', 'LATE', 'HALF_DAY'].includes(a.status),
  ).length

  return (
    <div className="space-y-5">
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-amber-500 via-orange-500 to-amber-600 p-5 text-white shadow-elevated">
        <div className="dot-grid absolute inset-0 opacity-[0.12]" />
        <div className="relative flex items-center gap-4">
          <Avatar className="size-16 border-2 border-white/30">
            <AvatarFallback className="bg-white/15 text-lg font-semibold text-white">
              {initials(staff.name)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <h1 className="truncate font-display text-xl font-semibold tracking-tight">
              {staff.name}
            </h1>
            <p className="text-sm capitalize text-white/75">
              {staff.role.replace('_', ' ').toLowerCase()} · {staff.code}
            </p>
          </div>
        </div>
      </div>

      <MarkAttendanceButton
        staffName={staff.name}
        currentStatus={todayAttendance?.status ?? null}
      />

      <div className="grid grid-cols-2 gap-3">
        <Card>
          <CardContent className="p-4 text-center">
            <p className="font-display text-2xl font-semibold text-slate-900 tabular">
              {staff._count.tasks}
            </p>
            <p className="text-xs text-slate-500">Tasks completed</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="font-display text-2xl font-semibold text-slate-900 tabular">
              {staff._count.complaints}
            </p>
            <p className="text-xs text-slate-500">Complaints fixed</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Attendance · last 30 days
            </p>
            <span className="text-xs font-semibold text-slate-700">
              {presentDays} days present
            </span>
          </div>
          <div className="flex flex-wrap gap-[3px]">
            {Array.from({ length: 30 }, (_, i) => {
              const date = addDays(today, -(29 - i))
              const entry = staff.attendance.find(
                (a) => startOfDay(a.date).getTime() === date.getTime(),
              )
              return (
                <span
                  key={i}
                  title={`${formatDate(date)}${entry ? ` — ${entry.status.replace('_', ' ').toLowerCase()}` : ''}`}
                  className={cn(
                    'size-3.5 rounded-[3px]',
                    entry ? ATTENDANCE_STYLE[entry.status] : 'bg-slate-100',
                  )}
                />
              )
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Your job</p>
          <Row icon={Building2} label="PG" value={staff.property?.name ?? 'Not assigned'} />
          <Row icon={CalendarDays} label="Joined" value={formatDate(staff.joiningDate)} />
          <Row icon={Wallet} label="Monthly salary" value={formatMoney(staff.salary)} />
          <Row icon={Phone} label="Your number" value={formatPhone(staff.phone)} />
          {staff.property?.contactPhone && (
            <a
              href={`tel:${staff.property.contactPhone}`}
              className="flex items-center gap-2 pt-1 text-sm font-medium text-amber-600"
            >
              <Phone className="size-4" />
              Call the PG office
            </a>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function Row({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType
  label: string
  value: string
}) {
  return (
    <div className="flex items-start gap-3">
      <Icon className="mt-0.5 size-4 shrink-0 text-slate-400" />
      <div className="min-w-0 flex-1">
        <p className="text-xs text-slate-500">{label}</p>
        <p className="text-sm font-medium text-slate-800">{value}</p>
      </div>
    </div>
  )
}
