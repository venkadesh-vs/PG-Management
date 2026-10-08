import 'server-only'

import { prisma } from '@/lib/prisma'

export type CycleReading = { value: number; date: string }

/**
 * For each meter: the reading the next bill starts from (`baseline`) and a
 * reading already taken this cycle but not billed yet (`pending`, e.g. typed
 * by the warden). Matches how a bill picks its previous reading: the latest
 * reading before the current one.
 */
export async function meterCycleState(meterIds: string[]) {
  const state = new Map<string, { baseline: CycleReading | null; pending: CycleReading | null }>()
  if (!meterIds.length) return state
  const [readings, lastBills] = await Promise.all([
    prisma.meterReading.findMany({
      where: { meterId: { in: meterIds } },
      select: { meterId: true, value: true, readingDate: true, kind: true },
      orderBy: { readingDate: 'desc' },
    }),
    prisma.roomElectricityBill.groupBy({
      by: ['meterId'],
      where: { meterId: { in: meterIds }, status: { not: 'VOID' } },
      _max: { periodEnd: true },
    }),
  ])
  const billedTo = new Map(lastBills.map((b) => [b.meterId, b._max.periodEnd]))
  const toCycle = (r: { value: unknown; readingDate: Date }) => ({ value: Number(String(r.value)), date: r.readingDate.toISOString() })
  for (const id of meterIds) {
    const own = readings.filter((r) => r.meterId === id)
    const billedUntil = billedTo.get(id) ?? null
    const pending = own.find((r) => r.kind === 'REGULAR' && (!billedUntil || r.readingDate > billedUntil)) ?? null
    const baseline = pending ? own.find((r) => r.readingDate < pending.readingDate) ?? null : own[0] ?? null
    state.set(id, { baseline: baseline ? toCycle(baseline) : null, pending: pending ? toCycle(pending) : null })
  }
  return state
}
