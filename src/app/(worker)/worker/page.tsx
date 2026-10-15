import type { Metadata } from 'next'
import Link from 'next/link'
import {
  ArrowRight,
  CalendarCheck,
  CheckCircle2,
  ClipboardList,
  Gauge,
  ReceiptText,
  ShoppingCart,
  Sparkles,
  Utensils,
} from 'lucide-react'
import { requireWorker } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { formatDate, startOfDay } from '@/lib/utils'
import { MEAL_TYPES, expectedMealCount } from '@/server/services/kitchen'
import { EmptyState } from '@/components/ui/feedback'
import { TaskCard } from './tasks/task-card'
import { ActionCard, IconTile, PhoneSection } from './_ui/phone'
import { Stagger, StaggerItem } from './_ui/stagger'

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
    meters: user.modules.includes('electricity') && user.permissions.includes('electricity.readings'),
    expenses: user.permissions.includes('expenses.add'),
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


  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : 'Good afternoon'
  const attendanceLabel = attendance ? attendance.status.replace('_', ' ').toLowerCase() : 'Pending'

  return (
    <Stagger className="space-y-6">
      {/* --------------------------------------------------------- Header */}
      <StaggerItem>
        <section className="relative isolate overflow-hidden rounded-3xl bg-ink-950 p-5 text-white shadow-float ring-1 ring-white/10">
          <div aria-hidden className="pointer-events-none absolute -right-16 -top-20 size-56 rounded-full bg-blue-500/30 blur-3xl" />
          <div aria-hidden className="pointer-events-none absolute -bottom-24 -left-10 size-52 rounded-full bg-marigold-300/20 blur-3xl" />
          <div aria-hidden className="dot-grid pointer-events-none absolute inset-0 opacity-[0.07]" />
          <div className="relative">
            <div className="flex items-center justify-between gap-3">
              <p className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.07] px-2.5 py-1 text-[11px] font-medium text-white/70 ring-1 ring-inset ring-white/10">
                <Sparkles className="size-3 text-marigold-300" />
                {formatDate(today)}
              </p>
              {staff.property && (
                <p className="min-w-0 truncate text-[11px] font-medium text-white/50">{staff.property.name}</p>
              )}
            </div>
            <p className="mt-4 text-sm text-white/60">{greeting},</p>
            <h1 className="font-display text-[28px] font-semibold leading-tight tracking-tight">
              {staff.name.split(' ')[0]}
            </h1>
            {can.tasks && (
              <p className="mt-1.5 text-sm text-white/70">
                {tasks.length === 0 ? (
                  'No open tasks right now.'
                ) : (
                  <>
                    <span className="font-semibold text-marigold-300">
                      {tasks.length} task{tasks.length === 1 ? '' : 's'}
                    </span>{' '}
                    waiting
                    {overdue.length ? (
                      <span className="text-rose-300"> · {overdue.length} overdue</span>
                    ) : null}
                  </>
                )}
              </p>
            )}

            {(can.tasks || can.attendance) && (
              <div className="mt-5 grid grid-cols-3 gap-2">
                {can.tasks && <Tile icon={ClipboardList} label="Open" value={String(tasks.length)} />}
                {can.tasks && <Tile icon={CheckCircle2} label="Done today" value={String(doneToday)} />}
                {can.attendance && (
                  <Tile
                    icon={CalendarCheck}
                    label="Attendance"
                    value={attendanceLabel}
                    highlight={!attendance}
                  />
                )}
              </div>
            )}
          </div>
        </section>
      </StaggerItem>

      {(can.meters || can.expenses) && (
        <StaggerItem className="space-y-3">
          {can.meters && (
            <ActionCard
              href="/worker/meters"
              icon={Gauge}
              tone="amber"
              title="Meter readings"
              description="Enter each room's electricity reading with a photo"
            />
          )}
          {can.expenses && (
            <ActionCard
              href="/worker/expenses"
              icon={ReceiptText}
              tone="emerald"
              title="Add an expense"
              description="Bought floor cleaner, bulbs or gas? Note it here with the bill"
            />
          )}
        </StaggerItem>
      )}

      {/* ------------------------------------------------------ Low stock */}
      {lowStockItems.length > 0 && (
        <StaggerItem>
          <Link
            href="/worker/grocery"
            className="group flex items-center gap-3 rounded-2xl border border-rose-200 bg-gradient-to-br from-rose-50 to-white p-4 shadow-card transition hover:-translate-y-0.5 hover:shadow-lift"
          >
            <IconTile icon={ShoppingCart} tone="rose" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-rose-900">
                {lowStockItems.length} item{lowStockItems.length === 1 ? '' : 's'} running low
              </p>
              <p className="mt-0.5 line-clamp-1 text-xs text-rose-800/80">
                {lowStockItems
                  .slice(0, 3)
                  .map((i) => i.name)
                  .join(', ')}
                {lowStockItems.length > 3 ? '…' : ''}
              </p>
            </div>
            <ArrowRight className="size-4 shrink-0 text-rose-400 transition group-hover:translate-x-0.5" />
          </Link>
        </StaggerItem>
      )}

      {/* ---------------------------------------------------------- Tasks */}
      {can.tasks && (
        <StaggerItem>
          <PhoneSection icon={ClipboardList} title="Your tasks" href="/worker/tasks" />
          {tasks.length === 0 ? (
            <EmptyState
              icon="check"
              title="Nothing pending"
              description="New work assigned to you shows up here straight away."
              compact
            />
          ) : (
            <ul className="space-y-3">
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
        </StaggerItem>
      )}

      {/* --------------------------------------------------------- Kitchen */}
      {isKitchen && staff.property && (
        <StaggerItem>
          <PhoneSection icon={Utensils} title="Today's kitchen" href="/worker/food" linkLabel="Open" />
          <div className="grid grid-cols-3 gap-2">
            {meals.map((entry) => {
              const served = entry.meal?.actualCount != null
              return (
                <div
                  key={entry.type}
                  className={
                    served
                      ? 'rounded-2xl border border-emerald-200 bg-emerald-50/60 p-3 text-center'
                      : 'rounded-2xl border border-slate-200/80 bg-white p-3 text-center shadow-card'
                  }
                >
                  <p className="text-[11px] font-medium capitalize text-slate-500">
                    {entry.type.toLowerCase()}
                  </p>
                  <p className="mt-1 font-display text-2xl font-semibold text-slate-900 tabular">
                    {entry.meal?.actualCount ?? entry.expected}
                  </p>
                  <p className={served ? 'text-[11px] font-medium text-emerald-700' : 'text-[11px] text-slate-400'}>
                    {served ? 'served' : 'to cook'}
                  </p>
                </div>
              )
            })}
          </div>
        </StaggerItem>
      )}

      {doneToday > 0 && (
        <StaggerItem>
          <div className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-4">
            <IconTile icon={CheckCircle2} tone="emerald" size="sm" />
            <p className="text-sm text-emerald-900">
              You completed <span className="font-semibold">{doneToday}</span> task
              {doneToday === 1 ? '' : 's'} today. Nice work.
            </p>
          </div>
        </StaggerItem>
      )}
    </Stagger>
  )
}

function Tile({
  icon: Icon,
  label,
  value,
  highlight,
}: {
  icon: React.ElementType
  label: string
  value: string
  highlight?: boolean
}) {
  return (
    <div
      className={
        highlight
          ? 'rounded-2xl bg-marigold-300/15 p-3 ring-1 ring-inset ring-marigold-300/30'
          : 'rounded-2xl bg-white/[0.06] p-3 ring-1 ring-inset ring-white/10'
      }
    >
      <Icon className={highlight ? 'size-3.5 text-marigold-300' : 'size-3.5 text-white/50'} />
      <p className="mt-2 truncate font-display text-lg font-semibold capitalize leading-none tabular">{value}</p>
      <p className="mt-1 truncate text-[11px] font-medium text-white/55">{label}</p>
    </div>
  )
}
