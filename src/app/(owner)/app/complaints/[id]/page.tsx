import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Building2, Clock, DoorOpen, Phone, Star, UserRound } from 'lucide-react'
import { requireOrgUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { inScope } from '@/lib/tenancy'
import { COMPLAINT_STATUS_STYLE, PRIORITY_STYLE, themeFor } from '@/lib/theme'
import { cn, formatDateTime, formatPhone, relativeTime } from '@/lib/utils'
import { PageHeader } from '@/components/app/page-header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { StatusChip } from '@/components/ui/badge'
import { ComplaintWorkflow } from './complaint-workflow'
import { ComplaintThread } from './complaint-thread'

export const metadata: Metadata = { title: 'Complaint' }

export default async function ComplaintDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const user = await requireOrgUser()
  const { id } = await params

  const complaint = await prisma.complaint.findUnique({
    where: { id },
    include: {
      property: true,
      room: true,
      resident: { select: { id: true, fullName: true, code: true, phone: true } },
      assignedStaff: { select: { id: true, name: true, role: true, phone: true } },
      updates: { orderBy: { createdAt: 'asc' } },
      tasks: true,
    },
  })
  // Another org's complaint, or a PG this manager is not assigned to, is
  // indistinguishable from a missing one.
  if (!complaint) notFound()
  if (complaint.organizationId !== user.organizationId) notFound()
  if (!inScope(user, complaint.propertyId)) notFound()

  const staff = await prisma.staff.findMany({
    where: {
      organizationId: user.organizationId,
      active: true,
      OR: [{ propertyId: complaint.propertyId }, { propertyId: null }],
    },
    select: { id: true, name: true, role: true },
    orderBy: { name: 'asc' },
  })

  const theme = themeFor(complaint.property.type)
  const statusStyle = COMPLAINT_STATUS_STYLE[complaint.status]
  const priorityStyle = PRIORITY_STYLE[complaint.priority]

  return (
    <div className="space-y-6">
      <PageHeader
        title={complaint.title}
        subtitle={`${complaint.code} · raised ${relativeTime(complaint.createdAt)}`}
        breadcrumbs={[
          { label: 'Dashboard', href: '/app' },
          { label: 'Complaints', href: '/app/complaints' },
          { label: complaint.code },
        ]}
        actions={
          <ComplaintWorkflow
            complaint={{
              id: complaint.id,
              code: complaint.code,
              status: complaint.status,
              assignedStaffId: complaint.assignedStaffId,
            }}
            staff={staff}
          />
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          {/* --------------------------------------------- Issue summary */}
          <Card>
            <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
              <div>
                <CardTitle className="text-base">{complaint.title}</CardTitle>
                <p className="mt-1 text-xs capitalize text-slate-500">
                  {complaint.category.toLowerCase()} · {complaint.code}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
                <StatusChip label={statusStyle.label} chip={statusStyle.chip} />
                <StatusChip label={priorityStyle.label} chip={priorityStyle.chip} />
              </div>
            </CardHeader>
            <CardContent>
              <p className="whitespace-pre-line text-sm leading-relaxed text-slate-700">
                {complaint.description}
              </p>

              {complaint.resolutionNote && (
                <div className="mt-4 rounded-xl border border-emerald-100 bg-emerald-50/70 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
                    Resolution
                  </p>
                  <p className="mt-1 text-sm text-emerald-900">{complaint.resolutionNote}</p>
                </div>
              )}

              {complaint.rating && (
                <div className="mt-3 flex items-center gap-1.5">
                  <span className="text-xs text-slate-500">Resident rating:</span>
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Star
                      key={i}
                      className={cn(
                        'size-3.5',
                        i < complaint.rating! ? 'fill-amber-400 text-amber-400' : 'text-slate-200',
                      )}
                    />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* -------------------------------------------------- Timeline */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Activity & messages</CardTitle>
            </CardHeader>
            <CardContent>
              <ComplaintThread
                complaintId={complaint.id}
                updates={complaint.updates.map((u) => ({
                  id: u.id,
                  authorName: u.authorName,
                  authorRole: u.authorRole,
                  message: u.message,
                  statusTo: u.statusTo,
                  createdAt: u.createdAt.toISOString(),
                }))}
              />
            </CardContent>
          </Card>
        </div>

        {/* ------------------------------------------------------- Aside */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Where</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2.5">
              <InfoRow icon={Building2} label={complaint.property.name} />
              {complaint.room && (
                <InfoRow icon={DoorOpen} label={`Room ${complaint.room.number}`} />
              )}
              <div className="flex items-center gap-2">
                <span className={cn('size-2 rounded-full', theme.bgSolid)} />
                <span className="text-xs text-slate-500">{theme.label}</span>
              </div>
            </CardContent>
          </Card>

          {complaint.resident && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Raised by</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2.5">
                <Link
                  href={`/app/residents/${complaint.resident.id}`}
                  className="flex items-center gap-2 text-sm font-medium text-slate-800 hover:text-blue-700"
                >
                  <UserRound className="size-4 text-slate-400" />
                  {complaint.resident.fullName}
                </Link>
                <InfoRow icon={Phone} label={formatPhone(complaint.resident.phone)} />
                <p className="text-xs text-slate-400">{complaint.resident.code}</p>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Assigned to</CardTitle>
            </CardHeader>
            <CardContent>
              {complaint.assignedStaff ? (
                <div className="space-y-2.5">
                  <p className="text-sm font-medium text-slate-800">
                    {complaint.assignedStaff.name}
                  </p>
                  <p className="text-xs capitalize text-slate-500">
                    {complaint.assignedStaff.role.replace('_', ' ').toLowerCase()}
                  </p>
                  <InfoRow icon={Phone} label={formatPhone(complaint.assignedStaff.phone)} />
                  {complaint.assignedAt && (
                    <InfoRow icon={Clock} label={`Assigned ${relativeTime(complaint.assignedAt)}`} />
                  )}
                </div>
              ) : (
                <p className="text-sm text-slate-500">
                  Nobody yet. Assign a worker and they will see it in their app straight away.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Timeline</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs">
              <TimeRow label="Raised" value={formatDateTime(complaint.createdAt)} />
              {complaint.assignedAt && (
                <TimeRow label="Assigned" value={formatDateTime(complaint.assignedAt)} />
              )}
              {complaint.startedAt && (
                <TimeRow label="Work started" value={formatDateTime(complaint.startedAt)} />
              )}
              {complaint.resolvedAt && (
                <TimeRow label="Resolved" value={formatDateTime(complaint.resolvedAt)} />
              )}
              {complaint.closedAt && (
                <TimeRow label="Closed" value={formatDateTime(complaint.closedAt)} />
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

function InfoRow({ icon: Icon, label }: { icon: React.ElementType; label: string }) {
  return (
    <p className="flex items-center gap-2 text-sm text-slate-600">
      <Icon className="size-4 shrink-0 text-slate-400" />
      {label}
    </p>
  )
}

function TimeRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-slate-500">{label}</span>
      <span className="text-right font-medium text-slate-700">{value}</span>
    </div>
  )
}
