import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { requireWorker } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { formatDate, formatMoney } from '@/lib/utils'
import { expenseStatus } from '@/server/services/expense-rules'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/feedback'
import { WorkerExpenseForm } from './expense-form'

export const metadata: Metadata = { title: 'Expenses' }

const STATUS = {
  APPROVED: { label: 'Approved', variant: 'success' },
  PENDING: { label: 'Waiting for owner', variant: 'warning' },
  REJECTED: { label: 'Rejected', variant: 'danger' },
  VOIDED: { label: 'Cancelled', variant: 'default' },
} as const

/**
 * Staff note what they bought for the PG (floor cleaner, bulbs, gas). Every
 * entry waits for the owner's approval before it counts in the accounts.
 */
export default async function WorkerExpensesPage() {
  const user = await requireWorker()
  if (!user.permissions.includes('expenses.add')) redirect('/worker')

  const staff = await prisma.staff.findUnique({
    where: { id: user.staffId },
    include: { property: { select: { id: true, name: true } } },
  })
  if (!staff?.property) {
    return (
      <div className="space-y-5">
        <h1 className="font-display text-xl font-semibold tracking-tight text-slate-900">Expenses</h1>
        <EmptyState icon="receipt" title="No PG assigned" description="Ask your PG owner to assign you to a property to record expenses." />
      </div>
    )
  }

  // Exactly what this login recorded, from the activity log (names can repeat).
  const mine = await prisma.activityLog.findMany({
    where: { organizationId: user.organizationId!, actorId: user.id, event: 'EXPENSE_CREATED', entityType: 'Expense' },
    select: { entityId: true },
    orderBy: { createdAt: 'desc' },
    take: 30,
  })
  const [categories, expenses] = await Promise.all([
    prisma.expenseCategory.findMany({
      where: { organizationId: user.organizationId! },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    prisma.expense.findMany({
      where: { organizationId: user.organizationId!, id: { in: mine.map((m) => m.entityId!).filter(Boolean) } },
      include: { category: { select: { name: true } } },
      orderBy: [{ spentOn: 'desc' }, { createdAt: 'desc' }],
    }),
  ])

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-xl font-semibold tracking-tight text-slate-900">Expenses</h1>
        <p className="text-sm text-slate-500">
          {staff.property.name}. Note what you bought for the PG. The owner approves each one.
        </p>
      </div>

      <WorkerExpenseForm propertyId={staff.property.id} categories={categories} />

      <div>
        <h2 className="mb-2 font-display text-sm font-semibold text-slate-900">Your recent expenses</h2>
        {!expenses.length ? (
          <EmptyState icon="receipt" title="Nothing recorded yet" description="Expenses you add show up here with the owner's decision." />
        ) : (
          <ul className="space-y-2">
            {expenses.map((e) => {
              const status = STATUS[expenseStatus(e)]
              return (
                <li key={e.id}>
                  <Card>
                    <CardContent className="flex items-start justify-between gap-3 p-4">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-900">{e.title}</p>
                        <p className="text-xs text-slate-500">
                          {e.category.name} · {formatDate(e.spentOn)}
                          {e.paidTo ? ` · ${e.paidTo}` : ''}
                        </p>
                        <Badge variant={status.variant} size="sm" className="mt-1.5">
                          {status.label}
                        </Badge>
                      </div>
                      <p className="shrink-0 font-display text-base font-semibold tabular text-slate-900">
                        {formatMoney(e.amount)}
                      </p>
                    </CardContent>
                  </Card>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
