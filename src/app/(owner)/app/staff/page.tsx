import type { Metadata } from 'next'
import { Suspense } from 'react'
import { Phone } from 'lucide-react'
import { requireAccess } from '@/lib/auth'
import { resolveScope } from '@/lib/tenancy'
import { prisma } from '@/lib/prisma'
import { themeFor } from '@/lib/theme'
import { addDays, cn, formatDate, formatMoney, formatPhone, initials, startOfDay, toISODate } from '@/lib/utils'
import { PageHeader } from '@/components/app/page-header'
import { StatCard, StatGrid } from '@/components/app/stat-card'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback } from '@/components/ui/primitives'
import { EmptyState, TableSkeleton } from '@/components/ui/feedback'
import { FilterBar, FilterSelect, SearchInput } from '@/components/app/filters'
import { ResendInviteButton } from '@/components/app/invite-link'
import { ExportButton } from '@/components/app/export-button'
import { getLookup, getLookupLabels } from '@/server/services/org-defaults'
import { AddStaffButton } from './add-staff-button'
import { AttendanceGrid } from './attendance-grid'

export const metadata: Metadata = { title: 'Staff' }

export default async function StaffPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const user = await requireAccess({ module: 'staff', permission: 'staff.view' })
  const params = await searchParams
  const scope = await resolveScope(user, params.property)
  const propertyIds = scope.propertyId ? [scope.propertyId] : scope.allowedPropertyIds

  const has = (p: string) => user.permissions.includes(p)
  // Logins are for the staff app, so they need it switched on and team.manage.
  const canCreateLogin = has('team.manage') && user.modules.includes('staffApp')
  const q = params.q?.trim() ?? ''
  const role = params.role
  const today = startOfDay(new Date())

  const [staff, properties, presentToday, openTasks, roleOptions, roleLabels, appRoles] = await Promise.all([
    prisma.staff.findMany({
      where: {
        organizationId: scope.organizationId,
        active: true,
        ...(scope.propertyId ? { OR: [{ propertyId: scope.propertyId }, { propertyId: null }] } : {}),
        ...(role ? { role } : {}),
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
        user: { select: { email: true, mustChangePassword: true, lastLoginAt: true } },
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
    getLookup(scope.organizationId, 'STAFF_ROLE'),
    getLookupLabels(scope.organizationId, 'STAFF_ROLE'),
    canCreateLogin
      ? prisma.orgRole.findMany({
          where: { organizationId: scope.organizationId, app: 'STAFF_APP' },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        })
      : Promise.resolve([] as { id: string; name: string }[]),
  ])
  const roleLabel = (value: string) => roleLabels[value] ?? value.replace('_', ' ').toLowerCase()

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
          <>
          {has('reports.export') && (
            <Suspense fallback={null}>
              <ExportButton kind="staff" label="Export staff" />
              {user.modules.includes('complaints') && has('complaints.view') && (
                <ExportButton kind="maintenance" label="Export tasks" />
              )}
            </Suspense>
          )}
          {has('staff.manage') && (
          <AddStaffButton
            fields={[
              { kind: 'text', name: 'name', label: 'Full name', required: true, half: true },
              {
                kind: 'select',
                name: 'role',
                label: 'Role',
                required: true,
                half: true,
                defaultValue: roleOptions.some((o) => o.value === 'CLEANER') ? 'CLEANER' : roleOptions[0]?.value,
                options: roleOptions,
              },
              { kind: 'tel', name: 'phone', label: 'Mobile number', required: true, half: true },
              { kind: 'email', name: 'email', label: 'Email', half: true, hint: 'Optional — the login link is also emailed' },
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
              // Logins need team.manage; the role decides what they see in the staff app.
              ...(canCreateLogin
                ? [
                    {
                      kind: 'switch' as const,
                      name: 'createLogin',
                      label: 'Create a staff app login',
                      hint: 'We send them a link on WhatsApp to set their own password.',
                    },
                    ...(appRoles.length
                      ? [
                          {
                            kind: 'select' as const,
                            name: 'orgRoleId',
                            label: 'Staff app role',
                            hint: 'Used only when a login is created — decides what they can see and do.',
                            defaultValue: appRoles[0]?.id,
                            options: appRoles.map((r) => ({ value: r.id, label: r.name })),
                          },
                        ]
                      : []),
                  ]
                : []),
            ]}
          />
          )}
          </>
        }
      />

      <StatGrid cols={4}>
        <StatCard label="Team size" value={staff.length} icon="users" hint="Active staff" />
        <StatCard
          label="Present today"
          value={presentToday}
          icon="check"
          tone={presentToday >= staff.length ? 'emerald' : 'amber'}
          hint={`of ${staff.length} staff`}
        />
        <StatCard label="Monthly salary" value={salaryTotal} format="money" icon="wallet" />
        <StatCard label="Open tasks" value={openTasks} icon="clipboard" tone={openTasks > 0 ? 'amber' : 'emerald'} />
      </StatGrid>

      <Suspense fallback={<TableSkeleton />}>
        <FilterBar activeCount={activeFilters}>
          <SearchInput placeholder="Search name or phone…" />
          <FilterSelect
            paramKey="role"
            placeholder="All roles"
            options={roleOptions}
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
                      <p className="text-xs text-slate-500">
                        {roleLabel(member.role)} · {member.code}
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
                    {member.user?.mustChangePassword && !member.user.lastLoginAt && (
                      <Badge variant="warning" size="sm">
                        Invite pending
                      </Badge>
                    )}
                  </div>

                  {canCreateLogin && (
                    <ResendInviteButton
                      action="RESEND_STAFF_INVITE"
                      payload={{ staffId: member.id }}
                      label={member.user ? 'Resend login link' : 'Create worker login'}
                      variant="ghost"
                    />
                  )}

                  <div>
                    <div className="mb-1.5 flex items-center justify-between text-xs">
                      <span className="text-slate-500">Attendance · last 30 days</span>
                      <span className="font-semibold text-slate-700">
                        {presentDays}/{member.attendance.length || 30} days
                      </span>
                    </div>
                    <AttendanceGrid
                      canMark={has('staff.manage')}
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
