import type { Metadata } from 'next'
import { Bed } from 'lucide-react'
import { requireOrgUser } from '@/lib/auth'
import { resolveScope } from '@/lib/tenancy'
import { prisma } from '@/lib/prisma'
import { themeFor, BRAND_THEME } from '@/lib/theme'
import { PageHeader } from '@/components/app/page-header'
import { EmptyState } from '@/components/ui/feedback'
import { Button } from '@/components/ui/button'
import Link from 'next/link'
import { BedMap } from './bed-map'

export const metadata: Metadata = { title: 'Rooms & Beds' }

export default async function BedsPage({
  searchParams,
}: {
  searchParams: Promise<{ property?: string; room?: string }>
}) {
  const user = await requireOrgUser()
  const params = await searchParams
  const scope = await resolveScope(user, params.property)

  const properties = await prisma.property.findMany({
    where: { id: { in: scope.allowedPropertyIds } },
    select: { id: true, name: true, type: true, standardRent: true },
    orderBy: { name: 'asc' },
  })

  if (!properties.length) {
    return (
      <div className="space-y-6">
        <PageHeader title="Rooms & Beds" subtitle="Your live bed map." icon="bed" />
        <EmptyState
          icon="building"
          title="No PG yet"
          description="Add a PG, then lay out its floors, rooms and beds."
          action={
            <Button variant="primary" asChild>
              <Link href="/app/properties/new">Add a PG</Link>
            </Button>
          }
        />
      </div>
    )
  }

  const activeId = scope.propertyId ?? properties[0].id
  const activeProperty = properties.find((p) => p.id === activeId) ?? properties[0]
  const theme = activeProperty ? themeFor(activeProperty.type) : BRAND_THEME

  const floors = await prisma.floor.findMany({
    where: { propertyId: activeProperty.id },
    orderBy: { level: 'asc' },
    include: {
      rooms: {
        orderBy: { number: 'asc' },
        include: {
          beds: {
            orderBy: { label: 'asc' },
            include: {
              resident: {
                select: {
                  id: true,
                  fullName: true,
                  code: true,
                  phone: true,
                  joiningDate: true,
                  rentAmount: true,
                  status: true,
                  invoices: {
                    where: { status: { in: ['PENDING', 'PARTIALLY_PAID', 'OVERDUE'] } },
                    select: { balance: true },
                  },
                },
              },
            },
          },
        },
      },
    },
  })

  const serialised = floors.map((floor) => ({
    id: floor.id,
    name: floor.name,
    level: floor.level,
    rooms: floor.rooms.map((room) => ({
      id: room.id,
      number: room.number,
      type: room.type,
      capacity: room.capacity,
      baseRent: room.baseRent,
      hasAC: room.hasAC,
      hasBalcony: room.hasBalcony,
      hasAttachedBath: room.hasAttachedBath,
      beds: room.beds.map((bed) => ({
        id: bed.id,
        label: bed.label,
        status: bed.status,
        rent: bed.rent,
        notes: bed.notes,
        blockedReason: bed.blockedReason,
        resident: bed.resident
          ? {
              id: bed.resident.id,
              fullName: bed.resident.fullName,
              code: bed.resident.code,
              phone: bed.resident.phone,
              joiningDate: bed.resident.joiningDate.toISOString(),
              rentAmount: bed.resident.rentAmount,
              status: bed.resident.status,
              outstanding: bed.resident.invoices.reduce((s, i) => s + i.balance, 0),
            }
          : null,
      })),
    })),
  }))

  return (
    <div className="space-y-6">
      <PageHeader
        title="Rooms & Beds"
        subtitle="Your live bed map. Click any bed to see who is in it, change its status, or check someone in."
        icon="bed"
        breadcrumbs={[{ label: 'Dashboard', href: '/app' }, { label: 'Rooms & Beds' }]}
        actions={
          <Button variant="outline" asChild>
            <Link href={`/app/properties/${activeProperty.id}`}>
              <Bed className="size-4" />
              Manage rooms
            </Link>
          </Button>
        }
      />

      <BedMap
        floors={serialised}
        property={{
          id: activeProperty.id,
          name: activeProperty.name,
          type: activeProperty.type,
          standardRent: activeProperty.standardRent,
        }}
        themeKey={theme.key}
        focusRoomId={params.room}
      />
    </div>
  )
}
