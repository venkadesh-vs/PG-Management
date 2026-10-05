import type { Metadata } from 'next'
import { ChefHat, Utensils } from 'lucide-react'
import { requireOrgUser } from '@/lib/auth'
import { resolveScope } from '@/lib/tenancy'
import { prisma } from '@/lib/prisma'
import { themeFor } from '@/lib/theme'
import { addDays, cn, formatDate, formatMoney, startOfDay, toISODate } from '@/lib/utils'
import { MEAL_TYPES, expectedMealCount } from '@/server/services/kitchen'
import { PageHeader } from '@/components/app/page-header'
import { StatCard } from '@/components/app/stat-card'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/feedback'
import { MealPlanner } from './meal-planner'

export const metadata: Metadata = { title: 'Food' }

export default async function FoodPage({
  searchParams,
}: {
  searchParams: Promise<{ property?: string; date?: string }>
}) {
  const user = await requireOrgUser()
  const params = await searchParams
  const scope = await resolveScope(user, params.property)
  const propertyIds = scope.propertyId ? [scope.propertyId] : scope.allowedPropertyIds

  const date = params.date ? startOfDay(new Date(params.date)) : startOfDay(new Date())

  const properties = await prisma.property.findMany({
    where: { id: { in: propertyIds } },
    select: { id: true, name: true, type: true, foodCharge: true },
    orderBy: { name: 'asc' },
  })

  if (!properties.length) {
    return (
      <div className="space-y-6">
        <PageHeader title="Food" subtitle="Plan meals and track counts." icon="utensils" />
        <EmptyState icon="building" title="No PG yet" description="Add a PG to start planning meals." />
      </div>
    )
  }

  // Build the board for each property × meal, with the expected count derived
  // from live food subscriptions rather than typed in.
  const board = await Promise.all(
    properties.map(async (property) => {
      const meals = await prisma.meal.findMany({
        where: { propertyId: property.id, date },
      })
      const rows = await Promise.all(
        MEAL_TYPES.map(async (type) => {
          const meal = meals.find((m) => m.type === type)
          const expected = await expectedMealCount(property.id, type, date)
          return {
            type,
            mealId: meal?.id ?? null,
            menu: meal?.menu ?? '',
            expected,
            actual: meal?.actualCount ?? null,
          }
        }),
      )
      return { property, rows }
    }),
  )

  const [subscribers, plans, weekMeals] = await Promise.all([
    prisma.foodSubscription.count({
      where: {
        active: true,
        resident: { propertyId: { in: propertyIds }, status: { in: ['ACTIVE', 'NOTICE'] } },
      },
    }),
    prisma.foodPlan.findMany({
      where: { propertyId: { in: propertyIds }, active: true },
      include: { property: { select: { name: true, type: true } }, _count: { select: { subscriptions: true } } },
      orderBy: { monthlyCharge: 'desc' },
    }),
    prisma.meal.findMany({
      where: { propertyId: { in: propertyIds }, date: { gte: addDays(date, -6), lte: date } },
      orderBy: { date: 'asc' },
    }),
  ])

  const totalExpectedToday = board.reduce(
    (sum, entry) => sum + entry.rows.reduce((s, r) => s + r.expected, 0),
    0,
  )
  const servedThisWeek = weekMeals.reduce((s, m) => s + (m.actualCount ?? 0), 0)
  const monthlyFoodRevenue = await prisma.resident.aggregate({
    where: { propertyId: { in: propertyIds }, status: { in: ['ACTIVE', 'NOTICE'] }, foodOptIn: true },
    _sum: { foodCharge: true },
  })

  return (
    <div className="space-y-6">
      <PageHeader
        title="Food"
        subtitle="Meal counts come from who is actually subscribed — nobody has to count heads at the door."
        icon="utensils"
        breadcrumbs={[{ label: 'Dashboard', href: '/app' }, { label: 'Food' }]}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Meals expected today"
          value={totalExpectedToday}
          icon="utensils"
          tone="amber"
          hint="Breakfast + lunch + dinner"
        />
        <StatCard label="On a food plan" value={subscribers} icon="users" tone="blue" hint="Active residents" />
        <StatCard label="Served in 7 days" value={servedThisWeek} icon="check" tone="emerald" />
        <StatCard
          label="Food revenue"
          value={monthlyFoodRevenue._sum.foodCharge ?? 0}
          format="money"
          icon="wallet"
          tone="violet"
          hint="Billed per month"
        />
      </div>

      <MealPlanner
        date={toISODate(date)}
        board={board.map((entry) => ({
          propertyId: entry.property.id,
          propertyName: entry.property.name,
          propertyType: entry.property.type,
          rows: entry.rows,
        }))}
      />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <ChefHat className="size-4 text-slate-400" />
            Food plans
          </CardTitle>
        </CardHeader>
        <CardContent>
          {plans.length === 0 ? (
            <p className="text-sm text-slate-500">No food plans configured yet.</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {plans.map((plan) => {
                const theme = themeFor(plan.property.type)
                return (
                  <div
                    key={plan.id}
                    className="rounded-2xl border border-slate-200 bg-white p-4 shadow-card"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-900">{plan.name}</p>
                        <p className="flex items-center gap-1.5 text-xs text-slate-500">
                          <span className={cn('size-1.5 rounded-full', theme.bgSolid)} />
                          {plan.property.name}
                        </p>
                      </div>
                      {plan.isDefault && (
                        <Badge variant="info" size="sm">
                          Default
                        </Badge>
                      )}
                    </div>
                    <p className="mt-2 font-display text-lg font-semibold text-slate-900 tabular">
                      {formatMoney(plan.monthlyCharge)}
                      <span className="text-xs font-normal text-slate-500">/month</span>
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {[
                        plan.includesBreakfast && 'Breakfast',
                        plan.includesLunch && 'Lunch',
                        plan.includesDinner && 'Dinner',
                      ]
                        .filter(Boolean)
                        .map((meal) => (
                          <span
                            key={String(meal)}
                            className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600"
                          >
                            {meal}
                          </span>
                        ))}
                    </div>
                    <p className="mt-2 text-xs text-slate-500">
                      {plan._count.subscriptions} resident
                      {plan._count.subscriptions === 1 ? '' : 's'} subscribed
                    </p>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Utensils className="size-4 text-slate-400" />
            Last 7 days
          </CardTitle>
        </CardHeader>
        <CardContent>
          {weekMeals.length === 0 ? (
            <p className="text-sm text-slate-500">No meals recorded in the last week.</p>
          ) : (
            <div className="overflow-x-auto scrollbar-slim">
              <div className="flex gap-2">
                {Array.from({ length: 7 }, (_, i) => {
                  const day = addDays(date, -(6 - i))
                  const dayMeals = weekMeals.filter(
                    (m) => startOfDay(m.date).getTime() === day.getTime(),
                  )
                  const expected = dayMeals.reduce((s, m) => s + m.expectedCount, 0)
                  const served = dayMeals.reduce((s, m) => s + (m.actualCount ?? 0), 0)
                  return (
                    <div
                      key={i}
                      className="min-w-[110px] flex-1 rounded-xl border border-slate-200 bg-slate-50/60 p-3 text-center"
                    >
                      <p className="text-[11px] text-slate-500">{formatDate(day)}</p>
                      <p className="mt-1 font-display text-lg font-semibold text-slate-900 tabular">
                        {served || expected}
                      </p>
                      <p className="text-[10px] text-slate-400">
                        {served ? 'served' : 'expected'}
                      </p>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
