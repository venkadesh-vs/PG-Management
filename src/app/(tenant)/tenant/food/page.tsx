import type { Metadata } from 'next'
import { CalendarDays, Utensils } from 'lucide-react'
import { redirect } from 'next/navigation'
import { requireTenant } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { addDays, cn, formatDate, formatMoney, startOfDay } from '@/lib/utils'
import { MEAL_TYPES } from '@/server/services/kitchen'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/feedback'
import { MealOptOut } from './meal-opt-out'
import { FoodChoice, type FoodPlanOption } from './food-choice'

export const metadata: Metadata = { title: 'Food' }

const MEAL_TIME = {
  BREAKFAST: '7:30 – 9:30 AM',
  LUNCH: '12:30 – 2:30 PM',
  DINNER: '8:00 – 10:00 PM',
} as const

export default async function TenantFoodPage() {
  const user = await requireTenant()
  // Switched off for this PG: back to the home screen, nothing broken.
  if (!user.modules.includes('food')) redirect('/tenant')
  const today = startOfDay(new Date())

  const resident = await prisma.resident.findUnique({
    where: { id: user.residentId },
    include: {
      property: true,
      foodSubscription: { include: { foodPlan: true } },
      mealAttendance: {
        where: { meal: { date: { gte: today, lte: addDays(today, 6) } } },
        include: { meal: { select: { id: true, date: true, type: true } } },
      },
    },
  })
  if (!resident) return null

  const planRows = await prisma.foodPlan.findMany({
    where: { propertyId: resident.propertyId, active: true },
    orderBy: [{ isDefault: 'desc' }, { monthlyCharge: 'asc' }],
  })
  const plans: FoodPlanOption[] = planRows.map((p) => ({
    id: p.id,
    name: p.name,
    monthlyCharge: p.monthlyCharge,
    meals: [p.includesBreakfast && 'Breakfast', p.includesLunch && 'Lunch', p.includesDinner && 'Dinner'].filter(Boolean).join(' · '),
  }))
  const eating = resident.foodOptIn && Boolean(resident.foodSubscription?.active)
  const choice = (
    <FoodChoice eating={eating} plans={plans} currentPlanId={resident.foodSubscription?.foodPlanId ?? null} />
  )

  if (!eating || !resident.foodSubscription) {
    return (
      <div className="space-y-5">
        <div>
          <h1 className="font-display text-xl font-semibold tracking-tight text-slate-900">Food</h1>
          <p className="mt-0.5 text-sm text-slate-500">Choose whether you eat at {resident.property.name}.</p>
        </div>
        {choice}
        <EmptyState
          icon="utensils"
          title="You are not on a food plan"
          description={
            plans.length
              ? 'Turn on “I need food” above and the daily menu will show up here.'
              : 'Your PG has not set up meals yet. Ask your PG owner.'
          }
        />
      </div>
    )
  }

  const meals = await prisma.meal.findMany({
    where: {
      propertyId: resident.propertyId,
      date: { gte: today, lte: addDays(today, 6) },
    },
    orderBy: [{ date: 'asc' }, { type: 'asc' }],
  })

  const plan = resident.foodSubscription.foodPlan
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i))
  const optOutByMeal = new Map(
    resident.mealAttendance.map((a) => [a.mealId, a.status]),
  )

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-xl font-semibold tracking-tight text-slate-900">Food</h1>
        <p className="mt-0.5 text-sm text-slate-500">This week&apos;s menu at {resident.property.name}.</p>
      </div>

      {choice}

      <Card className="overflow-hidden">
        <CardContent className="flex items-center justify-between gap-3 p-4">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-900">{plan.name}</p>
            <div className="mt-1 flex flex-wrap gap-1">
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
          </div>
          <div className="shrink-0 text-right">
            <p className={'font-display text-lg font-semibold tabular text-slate-900'}>
              {formatMoney(resident.foodCharge)}
            </p>
            <p className="text-[11px] text-slate-500">per month</p>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-4">
        {days.map((day, dayIndex) => {
          const dayMeals = meals.filter(
            (m) => startOfDay(m.date).getTime() === day.getTime(),
          )
          if (dayMeals.length === 0 && dayIndex > 0) return null

          return (
            <div key={day.toISOString()}>
              <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                <CalendarDays className="size-3.5" />
                {dayIndex === 0
                  ? 'Today'
                  : dayIndex === 1
                    ? 'Tomorrow'
                    : day.toLocaleDateString('en-IN', { weekday: 'long' })}
                <span className="font-normal normal-case text-slate-400">{formatDate(day)}</span>
              </p>

              {dayMeals.length === 0 ? (
                <Card>
                  <CardContent className="p-4 text-center text-sm text-slate-500">
                    The menu for this day has not been published yet.
                  </CardContent>
                </Card>
              ) : (
                <ul className="space-y-2">
                  {MEAL_TYPES.map((type) => {
                    const meal = dayMeals.find((m) => m.type === type)
                    if (!meal) return null
                    const included =
                      type === 'BREAKFAST'
                        ? plan.includesBreakfast
                        : type === 'LUNCH'
                          ? plan.includesLunch
                          : plan.includesDinner
                    if (!included) return null

                    const optedOut = ['SKIPPED', 'ON_LEAVE'].includes(
                      optOutByMeal.get(meal.id) ?? '',
                    )

                    return (
                      <li key={meal.id}>
                        <Card className={cn(optedOut && 'opacity-60')}>
                          <CardContent className="flex items-start gap-3 p-4">
                            <div
                              className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-slate-100"
                            >
                              <Utensils className="size-4 text-slate-600" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="text-sm font-semibold capitalize text-slate-900">
                                  {type.toLowerCase()}
                                </p>
                                <span className="text-[11px] text-slate-400">
                                  {MEAL_TIME[type]}
                                </span>
                                {optedOut && (
                                  <Badge variant="default" size="sm">
                                    Skipping
                                  </Badge>
                                )}
                              </div>
                              <p className="mt-0.5 text-sm text-slate-700">{meal.menu}</p>
                            </div>
                            {dayIndex <= 1 && (
                              <MealOptOut
                                mealId={meal.id}
                                mealLabel={`${type.toLowerCase()} on ${formatDate(day)}`}
                                optedOut={optedOut}
                              />
                            )}
                          </CardContent>
                        </Card>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          )
        })}
      </div>

      <p className="text-center text-xs text-slate-400">
        Letting the kitchen know you are skipping a meal helps them cook the right amount.
      </p>
    </div>
  )
}
