import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { requireWorker } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { EmptyState } from '@/components/ui/feedback'
import { meterCycleState } from '@/server/services/electricity-cycle'
import { ReadingForm } from './reading-form'

export const metadata: Metadata = { title: 'Meter readings' }

export default async function WorkerMetersPage() {
  const user = await requireWorker()
  // Not part of this person's role (or the feature is off): back to home.
  if (!user.modules.includes('electricity') || !user.permissions.includes('electricity.readings')) redirect('/worker')

  const staff = await prisma.staff.findUnique({
    where: { id: user.staffId },
    include: { property: { select: { id: true, name: true } } },
  })

  if (!staff?.property) {
    return (
      <div className="space-y-5">
        <h1 className="font-display text-xl font-semibold tracking-tight text-slate-900">Meter readings</h1>
        <EmptyState icon="zap" title="No PG assigned" description="Ask your PG owner to assign you to a property to enter meter readings." />
      </div>
    )
  }

  const meters = await prisma.electricityMeter.findMany({
    where: { organizationId: user.organizationId!, propertyId: staff.property.id, status: 'ACTIVE' },
    select: { id: true, meterNumber: true, room: { select: { number: true, floor: { select: { name: true, level: true } } } } },
    orderBy: [{ room: { floor: { level: 'asc' } } }, { room: { number: 'asc' } }],
  })
  const cycle = await meterCycleState(meters.map((m) => m.id))

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-xl font-semibold tracking-tight text-slate-900">Meter readings</h1>
        <p className="text-sm text-slate-500">{staff.property.name}. Type what each room’s meter shows, then save. The owner checks the split.</p>
      </div>
      {!meters.length ? (
        <EmptyState icon="zap" title="No meters yet" description="The PG owner adds each room's meter first." />
      ) : (
        <ReadingForm
          meters={meters.map((m) => ({
            id: m.id,
            roomNumber: m.room.number,
            floor: m.room.floor.name,
            meterNumber: m.meterNumber,
            baseline: cycle.get(m.id)?.baseline ?? null,
            pending: cycle.get(m.id)?.pending ?? null,
          }))}
        />
      )}
    </div>
  )
}
