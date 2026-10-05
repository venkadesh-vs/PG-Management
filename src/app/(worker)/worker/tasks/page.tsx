import type { Metadata } from 'next'
import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { requireWorker } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { startOfDay } from '@/lib/utils'
import { EmptyState, TableSkeleton } from '@/components/ui/feedback'
import { FilterBar, FilterSelect } from '@/components/app/filters'
import { TaskCard } from './task-card'
import { refreshSlaBreaches } from '@/server/services/complaints'

export const metadata: Metadata = { title: 'My Tasks' }

export default async function WorkerTasksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const user = await requireWorker()
  // Not part of this person's role (or the module is off): back to home.
  if (!user.permissions.includes('tasks.work')) redirect('/worker')
  const params = await searchParams
  const status = params.status
  const today = startOfDay(new Date())
  if (user.organizationId) await refreshSlaBreaches(user.organizationId)

  const tasks = await prisma.maintenanceTask.findMany({
    where: {
      assignedStaffId: user.staffId,
      ...(status
        ? { status: status as never }
        : { status: { in: ['PENDING', 'ACCEPTED', 'IN_PROGRESS'] } }),
    },
    include: {
      property: { select: { name: true, type: true } },
      room: { select: { number: true } },
      complaint: {
        select: {
          code: true,
          category: true,
          status: true,
          photoUrls: true,
          slaDueAt: true,
          createdAt: true,
          resolvedAt: true,
        },
      },
    },
    orderBy: [{ status: 'asc' }, { priority: 'desc' }, { dueDate: 'asc' }],
    take: 60,
  })

  const counts = await prisma.maintenanceTask.groupBy({
    by: ['status'],
    where: { assignedStaffId: user.staffId },
    _count: { _all: true },
  })
  const countFor = (s: string) => counts.find((c) => c.status === s)?._count._all ?? 0

  const overdue = tasks.filter((t) => t.dueDate && t.dueDate < today && t.status !== 'COMPLETED')

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-xl font-semibold tracking-tight text-slate-900">
          My tasks
        </h1>
        <p className="mt-0.5 text-sm text-slate-500">
          {tasks.length === 0
            ? 'Nothing assigned right now.'
            : `${tasks.length} task${tasks.length === 1 ? '' : 's'}${
                overdue.length ? ` · ${overdue.length} overdue` : ''
              }`}
        </p>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Tile label="New" value={countFor('PENDING')} tone="amber" />
        <Tile label="In progress" value={countFor('IN_PROGRESS') + countFor('ACCEPTED')} tone="sky" />
        <Tile label="Completed" value={countFor('COMPLETED')} tone="emerald" />
      </div>

      <Suspense fallback={<TableSkeleton rows={3} cols={2} />}>
        <FilterBar activeCount={status ? 1 : 0}>
          <FilterSelect
            paramKey="status"
            placeholder="Open tasks"
            options={[
              { value: 'PENDING', label: 'New' },
              { value: 'ACCEPTED', label: 'Accepted' },
              { value: 'IN_PROGRESS', label: 'In progress' },
              { value: 'COMPLETED', label: 'Completed' },
            ]}
          />
        </FilterBar>
      </Suspense>

      {tasks.length === 0 ? (
        <EmptyState
          icon="check"
          title={status ? 'Nothing here' : 'All caught up'}
          description="Work assigned to you appears here the moment your PG owner assigns it."
        />
      ) : (
        <ul className="space-y-2">
          {tasks.map((task) => (
            <li key={task.id}>
              <TaskCard
                task={{
                  id: task.id,
                  title: task.title,
                  description: task.description,
                  status: task.status,
                  priority: task.priority,
                  kind: task.kind,
                  dueDate: task.dueDate?.toISOString() ?? null,
                  propertyName: task.property.name,
                  propertyType: task.property.type,
                  roomNumber: task.room?.number ?? null,
                  complaintCode: task.complaint?.code ?? null,
                  createdAt: task.createdAt.toISOString(),
                  complaintPhotos: task.complaint?.photoUrls ?? [],
                  completionPhotoUrl: task.completionPhotoUrl,
                  sla: task.complaint
                    ? {
                        status: task.complaint.status,
                        dueAt: task.complaint.slaDueAt?.toISOString() ?? null,
                        createdAt: task.complaint.createdAt.toISOString(),
                        resolvedAt: task.complaint.resolvedAt?.toISOString() ?? null,
                      }
                    : null,
                }}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Tile({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone: 'amber' | 'sky' | 'emerald'
}) {
  const tones = {
    amber: 'border-amber-100 bg-amber-50/60 text-amber-700',
    sky: 'border-sky-100 bg-sky-50/60 text-sky-700',
    emerald: 'border-emerald-100 bg-emerald-50/60 text-emerald-700',
  }
  return (
    <div className={`rounded-2xl border px-3 py-2.5 text-center ${tones[tone]}`}>
      <p className="font-display text-xl font-semibold tabular">{value}</p>
      <p className="text-[10px] uppercase tracking-wide opacity-80">{label}</p>
    </div>
  )
}
