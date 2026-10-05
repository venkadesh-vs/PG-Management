import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, CheckCircle2, Clock, UserCog } from 'lucide-react'
import { requireTenant } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { ForbiddenError } from '@/lib/tenancy'
import { COMPLAINT_STATUS_STYLE, PRIORITY_STYLE } from '@/lib/theme'
import { cn, formatDateTime, relativeTime } from '@/lib/utils'
import { Card, CardContent } from '@/components/ui/card'
import { StatusChip } from '@/components/ui/badge'
import { ComplaintThread } from '@/app/(owner)/app/complaints/[id]/complaint-thread'
import { TenantComplaintActions } from './tenant-actions'

export const metadata: Metadata = { title: 'Complaint' }

const STEPS = ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED'] as const

export default async function TenantComplaintPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const user = await requireTenant()
  const { id } = await params

  const complaint = await prisma.complaint.findUnique({
    where: { id },
    include: {
      assignedStaff: { select: { name: true, role: true } },
      updates: { orderBy: { createdAt: 'asc' } },
      property: { select: { name: true } },
      room: { select: { number: true } },
    },
  })
  if (!complaint) notFound()
  if (complaint.residentId !== user.residentId) throw new ForbiddenError()

  const status = COMPLAINT_STATUS_STYLE[complaint.status]
  const priority = PRIORITY_STYLE[complaint.priority]
  const currentStep =
    complaint.status === 'CLOSED' || complaint.status === 'RESOLVED'
      ? 3
      : complaint.status === 'IN_PROGRESS'
        ? 2
        : complaint.status === 'ASSIGNED'
          ? 1
          : 0

  return (
    <div className="space-y-5">
      <Link
        href="/tenant/complaints"
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800"
      >
        <ArrowLeft className="size-4" />
        All complaints
      </Link>

      <Card>
        <CardContent className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <h1 className="font-display text-lg font-semibold tracking-tight text-slate-900">
                {complaint.title}
              </h1>
              <p className="text-xs text-slate-500">
                {complaint.code} · raised {relativeTime(complaint.createdAt)}
              </p>
            </div>
            <div className="flex shrink-0 gap-1.5">
              <StatusChip label={priority.label} chip={priority.chip} />
              <StatusChip label={status.label} chip={status.chip} />
            </div>
          </div>

          <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-slate-600">
            {complaint.description}
          </p>
        </CardContent>
      </Card>

      {/* --------------------------------------------------- Progress rail */}
      <Card>
        <CardContent className="p-5">
          <p className="mb-4 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Progress
          </p>
          <ol className="space-y-4">
            {STEPS.map((step, index) => {
              const reached = index <= currentStep
              const isLast = index === STEPS.length - 1
              const label =
                step === 'OPEN'
                  ? 'Complaint received'
                  : step === 'ASSIGNED'
                    ? complaint.assignedStaff
                      ? `${complaint.assignedStaff.name} assigned`
                      : 'Someone will be assigned'
                    : step === 'IN_PROGRESS'
                      ? 'Work started'
                      : 'Resolved'
              const at =
                step === 'OPEN'
                  ? complaint.createdAt
                  : step === 'ASSIGNED'
                    ? complaint.assignedAt
                    : step === 'IN_PROGRESS'
                      ? complaint.startedAt
                      : complaint.resolvedAt

              return (
                <li key={step} className="relative flex gap-3">
                  {!isLast && (
                    <span
                      className={cn(
                        'absolute left-[11px] top-6 h-full w-px',
                        index < currentStep ? 'bg-emerald-300' : 'bg-slate-200',
                      )}
                    />
                  )}
                  <span
                    className={cn(
                      'relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full ring-4 ring-white',
                      reached ? 'bg-emerald-500 text-white' : 'bg-slate-200 text-slate-400',
                    )}
                  >
                    {reached ? (
                      <CheckCircle2 className="size-3.5" strokeWidth={3} />
                    ) : (
                      <Clock className="size-3" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1 pt-0.5">
                    <p
                      className={cn(
                        'text-sm',
                        reached ? 'font-medium text-slate-800' : 'text-slate-400',
                      )}
                    >
                      {label}
                    </p>
                    {at && <p className="text-xs text-slate-400">{formatDateTime(at)}</p>}
                  </div>
                </li>
              )
            })}
          </ol>

          {complaint.resolutionNote && (
            <div className="mt-4 rounded-xl border border-emerald-100 bg-emerald-50/70 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
                What was done
              </p>
              <p className="mt-1 text-sm text-emerald-900">{complaint.resolutionNote}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {complaint.assignedStaff && (
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex size-10 items-center justify-center rounded-xl bg-amber-50">
              <UserCog className="size-5 text-amber-600" />
            </div>
            <div>
              <p className="text-sm font-medium text-slate-800">
                {complaint.assignedStaff.name}
              </p>
              <p className="text-xs capitalize text-slate-500">
                {complaint.assignedStaff.role.replace('_', ' ').toLowerCase()} · handling this
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <TenantComplaintActions
        complaintId={complaint.id}
        status={complaint.status}
        rating={complaint.rating}
      />

      <Card>
        <CardContent className="p-5">
          <p className="mb-4 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Updates
          </p>
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
  )
}
