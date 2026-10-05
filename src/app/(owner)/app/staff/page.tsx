import type { Metadata } from 'next'
import { Suspense } from 'react'
import { Phone } from 'lucide-react'
import { requireOrgUser } from '@/lib/auth'
import { resolveScope } from '@/lib/tenancy'
import { prisma } from '@/lib/prisma'
import { themeFor } from '@/lib/theme'
import { addDays, cn, formatDate, formatMoney, formatPhone, initials, startOfDay, toISODate } from '@/lib/utils'
import { PageHeader } from '@/components/app/page-header'
import { StatCard } from '@/components/app/stat-card'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback } from '@/components/ui/primitives'
import { EmptyState, TableSkeleton } from '@/components/ui/feedback'
import { FilterBar, FilterSelect, SearchInput } from '@/components/app/filters'
import { QuickForm } from '@/components/app/quick-form'
import { AttendanceGrid } from './attendance-grid'

export const metadata: Metadata = { title: 'Staff' }

const ROLE_OPTIONS = [
  ['MANAGER', 'Manager'],
  ['COOK', 'Cook'],
  ['KITCHEN_HELPER', 'Kitchen helper'],
  ['CLEANER', 'Cleaner'],
  ['SECURITY', 'Security'],
  ['ELECTRICIAN', 'Electrician'],
  ['PLUMBER', 'Plumber'],
  ['MAINTENANCE', 'Maintenance'],
  ['OTHER', 'Other'],
] as const

export default async function StaffPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const user = await requireOrgUser()
  const params = await searchParams
  const scope = await resolveScope(user, params.property)
  const propertyIds = scope.propertyId ? [scope.propertyId] : scope.allowedPropertyIds

  const q = params.q?.trim() ?? ''
  const role = params.role
  const today = startOfDay(new Date())

  const [staff, properties, presentToday, openTasks] = await Promise.all([
    prisma.staff.findMany({
      where: {
        organizationId: scope.organizationId,
        active: true,
        ...(scope.propertyId ? { OR: [{ propertyId: scope.propertyId }, { propertyId: null }] } : {}),
        ...(role ? { role: role as never } : {}),
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: 'insensitive' } },
                { phone: { contains: q } },
                { code: { contains: q, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      include: {
        property: { select: { name: true, type: true } },
        user: { select: { email: true } },
        attendance: {
          where: { date: { gte: addDays(today, -29) } },
          orderBy: { date: 'desc' },
        },
        _count: {
          select: {
            tasks: { where: { status: { in: ['PENDING', 'ACCEPTED', 'IN_PROGRESS'] } } },
            complaints: { where: { status: { in: ['ASSIGNED', 'IN_PROGRESS'] } } },
          },
        },
      },
      orderBy: [{ role: 'asc' }, { name: 'asc' }],
    }),
    prisma.property.findMany({
      where: { id: { in: propertyIds } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    prisma.staffAttendance.count({
      where: {
        date: today,
        status: { in: ['PRESENT', 'LATE'] },
        staff: { organizationId: scope.organizationId },
      },
    }),
    prisma.maintenanceTask.count({
      where: {
        organizationId: scope.organizationId,
        status: { in: ['PENDING', 'ACCEPTED', 'IN_PROGRESS'] },
      },
    }),
  ])

  const salaryTotal = staff.reduce((s, member) => s + member.salary, 0)
  const activeFilters = [q, role].filter(Boolean).length

  return (
    <div className="space-y-6">
      <PageHeader
        title="Staff"
        subtitle="Cooks, cleaners, security and maintenance — with attendance and the tasks each of them is carrying."
        icon="users"
        breadcrumbs={[{ label: 'Dashboard', href: '/app' }, { label: 'Staff' }]}
        actions={
          <QuickForm
            trigger="Add staff"
            title="Add a staff member"
            description="Give them a login and they get the worker app — a simple task list, nothing else."
            endpoint="/api/operations"
            payload={{ entity: 'STAFF' }}
            successTitle="Staff member added"
            submitLabel="Add staff"
            fields={[
              { kind: 'text', name: 'name', label: 'Full name', required: true, half: true },
              {
                kind: 'select',
                name: 'role',
                label: 'Role',
                required: true,
                half: true,
                defaultValue: 'CLEANER',
                options: ROLE_OPTIONS.map(([value, label]) => ({ value, label })),
              },
              { kind: 'tel', name: 'phone', label: 'Mobile number', required: true, half: true },
              { kind: 'email', name: 'email', label: 'Email', half: true, hint: 'Needed for a worker login' },
              {
                kind: 'select',
                name: 'propertyId',
                label: 'Assigned PG',
                half: true,
                options: properties.map((p) => ({ value: p.id, label: p.name })),
              },
              {
                kind: 'date',
                name: 'joiningDate',
                label: 'Joining date',
                required: true,
                half: true,
                defaultValue: toISODate(new Date()),
              },
              { kind: 'number', name: 'salary', label: 'Monthly salary', half: true },
              { kind: 'text', name: 'idNumber', label: 'ID number', half: true },
              {
                kind: 'switch',
                name: 'createLogin',
                label: 'Create a worker app login',
                hint: 'They can accept, update and complete tasks from their phone.',
              },
            ]}
          />
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Team size" value={staff.length} icon="users" tone="blue" hint="Active staff" />
        <StatCard
          label="Present today"
          value={presentToday}
          icon="check"
          tone={presentToday >= staff.length ? 'emerald' : 'amber'}
          hint={`of ${staff.length} staff`}
        />
        <StatCard label="Monthly salary" value={salaryTotal} format="money" icon="wallet" tone="violet" />
        <StatCard label="Open tasks" value={openTasks} icon="clipboard" tone={openTasks > 0 ? 'amber' : 'emerald'} />
      </div>

      <Suspense fallback={<TableSkeleton />}>
        <FilterBar activeCount={activeFilters}>
          <SearchInput placeholder="Search name or phone…" />
          <FilterSelect
            paramKey="role"
            placeholder="All roles"
            options={ROLE_OPTIONS.map(([value, label]) => ({ value, label }))}
          />
        </FilterBar>
      </Suspense>

      {staff.length === 0 ? (
        <EmptyState
          icon="users"
          title={activeFilters ? 'Nobody matches these filters' : 'No staff added yet'}
          description="Add your cook, cleaner and security so complaints can be assigned to a real person."
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {staff.map((member) => {
            const theme = member.property ? themeFor(member.property.type) : null
            const presentDays = member.attendance.filter((a) =>
              ['PRESENT', 'LATE'].includes(a.status),
            ).length
            return (
              <Card key={member.id}>
                <CardHeader className="pb-3">
                  <div className="flex items-start gap-3">
                    <Avatar className="size-11">
                      <AvatarFallback
                        className={cn(theme ? cn(theme.bg, theme.text) : 'bg-slate-100 text-slate-600')}
                      >
                        {initials(member.name)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <CardTitle className="truncate text-sm">{member.name}</CardTitle>
                      <p className="text-xs capitalize text-slate-500">
                        {member.role.replace('_', ' ').toLowerCase()} · {member.code}
                      </p>
                      <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
                        <Phone className="size-3" />
                        {formatPhone(member.phone)}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-semibold text-slate-800 tabular">
                        {formatMoney(member.salary)}
                      </p>
                      <p className="text-[11px] text-slate-400">per month</p>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex flex-wrap gap-1.5">
                    {member.property && theme && (
                      <Badge variant="outline" size="sm">
                        <span className={cn('size-1.5 rounded-full', theme.bgSolid)} />
                        {member.property.name}
                      </Badge>
                    )}
                    {member.user && (
                      <Badge variant="info" size="sm">
                        Worker app
                      </Badge>
                    )}
                    {member._count.tasks + member._count.complaints > 0 && (
                      <Badge variant="warning" size="sm">
                        {member._count.tasks + member._count.complaints} open task
                        {member._count.tasks + member._count.complaints === 1 ? '' : 's'}
                      </Badge>
                    )}
                    <Badge variant="default" size="sm">
                      Since {formatDate(member.joiningDate)}
                    </Badge>
                  </div>

                  <div>
                    <div className="mb-1.5 flex items-center justify-between text-xs">
                      <span className="text-slate-500">Attendance · last 30 days</span>
                      <span className="font-semibold text-slate-700">
                        {presentDays}/{member.attendance.length || 30} days
                      </span>
                    </div>
                    <AttendanceGrid
                      staffId={member.id}
                      staffName={member.name}
                      days={member.attendance.map((a) => ({
                        date: a.date.toISOString(),
                        status: a.status,
                      }))}
                    />
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
