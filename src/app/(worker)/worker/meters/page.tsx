import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { requireWorker } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { EmptyState } from '@/components/ui/feedback'
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
    select: {
      id: true,
      meterNumber: true,
      room: { select: { number: true, floor: { select: { name: true } } } },
      readings: { orderBy: { readingDate: 'desc' }, take: 1, select: { value: true, readingDate: true } },
    },
    orderBy: { room: { number: 'asc' } },
  })

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-xl font-semibold tracking-tight text-slate-900">Meter readings</h1>
        <p className="text-sm text-slate-500">{staff.property.name}. Pick the room, type what the meter shows and add a photo.</p>
      </div>
      {!meters.length ? (
        <EmptyState icon="zap" title="No meters yet" description="The PG owner adds each room's meter first." />
      ) : (
        <ReadingForm
          meters={meters.map((m) => ({
            id: m.id,
            label: `Room ${m.room.number} · ${m.room.floor.name}`,
            meterNumber: m.meterNumber,
            last: m.readings[0] ? { value: Number(String(m.readings[0].value)), date: m.readings[0].readingDate.toISOString() } : null,
          }))}
        />
      )}
    </div>
  )
}
