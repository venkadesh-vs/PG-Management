import type { Metadata } from 'next'
import Link from 'next/link'
import {
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  ShoppingCart,
  Utensils,
} from 'lucide-react'
import { requireWorker } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import {
  startOfDay,
} from '@/lib/utils'
import { MEAL_TYPES, expectedMealCount } from '@/server/services/kitchen'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/feedback'
import { TaskCard } from './tasks/task-card'

export const metadata: Metadata = { title: 'Home' }

export default async function WorkerHome() {
  const user = await requireWorker()
  const today = startOfDay(new Date())
  // A switched-off module grants no permission, so these cover both.
  const can = {
    tasks: user.permissions.includes('tasks.work'),
    kitchen: user.permissions.includes('food.view'),
    grocery: user.permissions.includes('grocery.view'),
    attendance: user.permissions.includes('attendance.self'),
  }

  const staff = await prisma.staff.findUnique({
    where: { id: user.staffId },
    include: { property: { select: { id: true, name: true, type: true } } },
  })
  if (!staff) return null

  const [tasks, doneToday, lowStock, attendance] = await Promise.all([
    !can.tasks ? Promise.resolve([]) : prisma.maintenanceTask.findMany({
      where: {
        assignedStaffId: staff.id,
        status: { in: ['PENDING', 'ACCEPTED', 'IN_PROGRESS'] },
      },
      include: {
        property: { select: { name: true, type: true } },
        room: { select: { number: true } },
        complaint: { select: { code: true, category: true } },
      },
      orderBy: [{ priority: 'desc' }, { dueDate: 'asc' }],
      take: 5,
    }),
    !can.tasks
      ? Promise.resolve(0)
      : prisma.maintenanceTask.count({
          where: { assignedStaffId: staff.id, status: 'COMPLETED', completedAt: { gte: today } },
        }),
    can.grocery && staff.propertyId
      ? prisma.groceryItem.findMany({ where: { propertyId: staff.propertyId } })
      : Promise.resolve([]),
    prisma.staffAttendance.findFirst({ where: { staffId: staff.id, date: today } }),
  ])

  const isKitchen = can.kitchen
  const meals = isKitchen && staff.propertyId
    ? await Promise.all(
        MEAL_TYPES.map(async (type) => ({
          type,
          expected: await expectedMealCount(staff.propertyId!, type, today),
          meal: await prisma.meal.findUnique({
            where: { propertyId_date_type: { propertyId: staff.propertyId!, date: today, type } },
          }),
        })),
      )
    : []

  const lowStockItems = lowStock.filter((i) => i.currentStock <= i.minimumStock)
  const overdue = tasks.filter((t) => t.dueDate && t.dueDate < today)

  return (
    <div className="space-y-5">
      {/* --------------------------------------------------------- Header */}
      <div className="relative overflow-hidden rounded-2xl bg-slate-900 p-5 text-white shadow-sm ring-1 ring-white/5">
        <div className="dot-grid absolute inset-0 opacity-[0.12]" />
        <div className="relative">
          <p className="text-sm text-white/75">
            {new Date().getHours() < 12 ? 'Good morning' : 'Good afternoon'},
          </p>
          <h1 className="font-display text-2xl font-semibold tracking-tight">
            {staff.name.split(' ')[0]}
          </h1>
          {can.tasks && (
            <p className="mt-1 text-sm text-white/75">
              {tasks.length === 0
                ? 'No open tasks right now.'
                : `${tasks.length} task${tasks.length === 1 ? '' : 's'} waiting${
                    overdue.length ? ` · ${overdue.length} overdue` : ''
                  }`}
            </p>
          )}

          {(can.tasks || can.attendance) && (
            <div className="mt-4 grid grid-cols-3 gap-2">
              {can.tasks && <Tile label="Open" value={String(tasks.length)} />}
              {can.tasks && <Tile label="Done today" value={String(doneToday)} />}
              {can.attendance && (
                <Tile
                  label="Attendance"
                  value={attendance ? attendance.status.replace('_', ' ').toLowerCase() : 'not marked'}
                />
              )}
            </div>
          )}
        </div>
      </div>

      {/* ---------------------------------------------------------- Tasks */}
      {can.tasks && (
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-display text-sm font-semibold text-slate-900">
            <ClipboardList className="size-4 text-slate-400" />
            Your tasks
          </h2>
          <Link href="/worker/tasks" className="text-xs font-semibold text-blue-600">
            See all
          </Link>
        </div>

        {tasks.length === 0 ? (
          <EmptyState
            icon="check"
            title="Nothing pending"
            description="New work assigned to you shows up here straight away."
            compact
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
                  }}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
      )}

      {/* --------------------------------------------------------- Kitchen */}
      {isKitchen && staff.property && (
        <Card>
          <CardContent className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-2 font-display text-sm font-semibold text-slate-900">
                <Utensils className="size-4 text-slate-500" />
                Today&apos;s kitchen
              </h2>
              <Link href="/worker/food" className="text-xs font-semibold text-blue-600">
                Open
              </Link>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {meals.map((entry) => (
                <div
                  key={entry.type}
                  className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 text-center"
                >
                  <p className="text-[11px] font-medium text-slate-500">
                    {entry.type.toLowerCase()}
                  </p>
                  <p className="font-display text-2xl font-semibold text-slate-900 tabular">
                    {entry.meal?.actualCount ?? entry.expected}
                  </p>
                  <p className="text-[10px] text-slate-400">
                    {entry.meal?.actualCount != null ? 'served' : 'to cook'}
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ------------------------------------------------------ Low stock */}
      {lowStockItems.length > 0 && (
        <Link href="/worker/grocery">
          <Card className="border-rose-200 bg-rose-50/50 transition-shadow hover:shadow-sm">
            <CardContent className="flex items-center gap-3 p-4">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white shadow-sm">
                <ShoppingCart className="size-5 text-rose-600" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-rose-900">
                  {lowStockItems.length} item{lowStockItems.length === 1 ? '' : 's'} running low
                </p>
                <p className="truncate text-xs text-rose-800/80">
                  {lowStockItems
                    .slice(0, 3)
                    .map((i) => i.name)
                    .join(', ')}
                  {lowStockItems.length > 3 ? '…' : ''}
                </p>
              </div>
              <ArrowRight className="size-4 shrink-0 text-rose-400" />
            </CardContent>
          </Card>
        </Link>
      )}

      {doneToday > 0 && (
        <Card className="border-emerald-200 bg-emerald-50/50">
          <CardContent className="flex items-center gap-3 p-4">
            <CheckCircle2 className="size-5 shrink-0 text-emerald-600" />
            <p className="text-sm text-emerald-900">
              You completed {doneToday} task{doneToday === 1 ? '' : 's'} today. Nice work.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/15 bg-white/10 p-2.5 backdrop-blur">
      <p className="text-[11px] font-medium text-white/70">{label}</p>
      <p className="truncate font-display text-lg font-semibold capitalize">{value}</p>
    </div>
  )
}
