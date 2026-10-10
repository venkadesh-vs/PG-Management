import { addDays, daysBetween, startOfDay } from './utils'

/**
 * A resident switching food on or off from the resident app. Pure rules, no
 * database, so they are unit-tested (tests/unit/food-choice.test.ts).
 *
 * - The change counts from tomorrow: today's meals are already planned.
 * - Starting food after this period's rent bill was raised adds the remaining
 *   days of that period, pro-rata, to the next bill. From then on the monthly
 *   bill carries the food plan as usual.
 * - Stopping food takes effect from tomorrow. Food already billed for the
 *   current period is not refunded automatically (the owner can adjust it).
 */

/** The first day a change applies to. */
export function foodChangeDate(now: Date): Date {
  return startOfDay(addDays(now, 1))
}

/**
 * The pro-rata food top-up when food starts on `start` inside a period whose
 * bill was raised without food. Zero when the start falls outside the period.
 */
export function foodTopUp(
  monthlyCharge: number,
  start: Date,
  periodStart: Date,
  periodEnd: Date,
): { days: number; totalDays: number; amount: number } {
  const totalDays = daysBetween(periodStart, periodEnd) + 1
  const from = startOfDay(start)
  if (monthlyCharge <= 0 || from < startOfDay(periodStart) || from > startOfDay(periodEnd)) {
    return { days: 0, totalDays, amount: 0 }
  }
  const days = daysBetween(from, periodEnd) + 1
  return { days, totalDays, amount: Math.round((monthlyCharge * days) / totalDays) }
}
