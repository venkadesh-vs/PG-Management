import type { Metadata } from 'next'
import { Utensils } from 'lucide-react'
import { redirect } from 'next/navigation'
import { requireWorker } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { themeFor } from '@/lib/theme'
import { cn, formatDate, startOfDay } from '@/lib/utils'
import { MEAL_TYPES, expectedMealCount } from '@/server/services/kitchen'
import { EmptyState } from '@/components/ui/feedback'
import { MealServedCard } from './meal-served-card'

export const metadata: Metadata = { title: 'Kitchen' }

export default async function WorkerFoodPage() {
  const user = await requireWorker()
  // Not part of this person's role (or the module is off): back to home.
  if (!user.permissions.includes('food.view')) redirect('/worker')
  const today = startOfDay(new Date())

  const staff = await prisma.staff.findUnique({
    where: { id: user.staffId },
    include: { property: { select: { id: true, name: true, type: true } } },
  })

  if (!staff?.property) {
    return (
      <div className="space-y-5">
        <h1 className="font-display text-xl font-semibold tracking-tight text-slate-900">Kitchen</h1>
        <EmptyState
          icon="utensils"
          title="No PG assigned"
          description="Ask your PG owner to assign you to a property to see the kitchen board."
        />
      </div>
    )
  }

  const property = staff.property
  const theme = themeFor(property.type)

  const board = await Promise.all(
    MEAL_TYPES.map(async (type) => {
      const meal = await prisma.meal.findUnique({
        where: { propertyId_date_type: { propertyId: property.id, date: today, type } },
      })
      const expected = await expectedMealCount(property.id, type, today)
      return {
        type,
        expected,
        mealId: meal?.id ?? null,
        menu: meal?.menu ?? null,
        actual: meal?.actualCount ?? null,
      }
    }),
  )

  const totalToCook = board.reduce((s, m) => s + (m.actual ?? m.expected), 0)

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-xl font-semibold tracking-tight text-slate-900">Kitchen</h1>
        <p className="mt-0.5 text-sm text-slate-500">
          {property.name} · {formatDate(today)}
        </p>
      </div>

      <div
        className={cn(
          'relative overflow-hidden rounded-3xl bg-gradient-to-br p-5 text-white shadow-elevated',
          theme.gradient,
        )}
      >
        <div className="dot-grid absolute inset-0 opacity-[0.12]" />
        <div className="relative text-center">
          <Utensils className="mx-auto size-5 text-white/70" />
          <p className="mt-2 font-display text-4xl font-semibold tabular">{totalToCook}</p>
          <p className="text-sm text-white/75">meals across the day</p>
        </div>
      </div>

      <div className="space-y-3">
        {board.map((meal) => (
          <MealServedCard
            key={meal.type}
            meal={meal}
            propertyName={property.name}
            propertyType={property.type}
            canManage={user.permissions.includes('food.manage')}
          />
        ))}
      </div>

      <p className="text-center text-xs text-slate-400">
        Counts come from residents who are actually on a food plan today, minus anyone who told the
        app they are skipping. Recording what you served updates the grocery stock.
      </p>
    </div>
  )
}
