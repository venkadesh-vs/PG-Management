import type { Metadata } from 'next'
import Link from 'next/link'
import { requireAccess } from '@/lib/auth'
import { resolveScope, hasPermission } from '@/lib/tenancy'
import { prisma } from '@/lib/prisma'
import { listMeters } from '@/server/services/electricity'
import { PageHeader } from '@/components/app/page-header'
import { Button } from '@/components/ui/button'
import { ElectricityTabs } from '../electricity-tabs'
import { MeterManager } from './meter-manager'

export const metadata: Metadata = { title: 'Electricity meters' }

export default async function MetersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireAccess({ module: 'electricity', permission: 'electricity.view' })
  const params = await searchParams
  const scope = await resolveScope(user, params.property)
  const propertyIds = scope.propertyId ? [scope.propertyId] : scope.allowedPropertyIds

  const [meters, rooms] = await Promise.all([
    listMeters(user, { propertyId: scope.propertyId }),
    prisma.room.findMany({
      where: { propertyId: { in: propertyIds } },
      select: { id: true, number: true, propertyId: true, property: { select: { name: true } }, floor: { select: { name: true } } },
      orderBy: [{ property: { name: 'asc' } }, { number: 'asc' }],
    }),
  ])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Electricity meters"
        subtitle="One meter per room, with its own readings. Replace a meter here when the electricity board changes it."
        icon="zap"
        breadcrumbs={[{ label: 'Dashboard', href: '/app' }, { label: 'Electricity', href: '/app/electricity' }, { label: 'Meters' }]}
        actions={
          hasPermission(user, 'electricity.manage') && scope.propertyId ? (
            <Button variant="primary" asChild>
              <Link href={`/app/electricity?property=${scope.propertyId}&setup=1`}>Add meters to all rooms</Link>
            </Button>
          ) : undefined
        }
      />
      <ElectricityTabs active="meters" />
      <MeterManager
        canManage={hasPermission(user, 'electricity.manage')}
        meters={meters.map((m) => ({
          id: m.id,
          meterNumber: m.meterNumber,
          status: m.status,
          installedOn: m.installedOn.toISOString(),
          initialReading: m.initialReading,
          notes: m.notes,
          propertyName: m.property.name,
          propertyId: m.property.id,
          roomId: m.room.id,
          roomNumber: m.room.number,
          floor: m.room.floor,
          lastReading: m.lastReading ? { value: m.lastReading.value, date: m.lastReading.readingDate.toISOString() } : null,
        }))}
        rooms={rooms.map((r) => ({ id: r.id, label: `Room ${r.number} · ${r.floor.name}`, propertyId: r.propertyId, propertyName: r.property.name }))}
      />
    </div>
  )
}
