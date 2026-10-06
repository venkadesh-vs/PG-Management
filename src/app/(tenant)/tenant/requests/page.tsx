import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { requireTenant } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { residentRequests } from '@/server/services/requests'
import { RequestsHome, type TenantRequest } from './requests-home'

export const metadata: Metadata = { title: 'Requests' }

export default async function TenantRequestsPage() {
  const user = await requireTenant()
  // Switched off for this PG: back to the home screen, nothing broken.
  if (!user.modules.includes('requests')) redirect('/tenant')

  const [rows, resident] = await Promise.all([
    residentRequests(user.residentId),
    prisma.resident.findUnique({
      where: { id: user.residentId },
      select: { foodOptIn: true, property: { select: { type: true } } },
    }),
  ])

  const requests: TenantRequest[] = rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    status: r.status,
    title: r.title,
    details: r.details,
    fromDate: r.fromDate?.toISOString() ?? null,
    toDate: r.toDate?.toISOString() ?? null,
    visitorCount: r.visitorCount,
    decisionNote: r.decisionNote,
    decidedBy: r.decidedBy,
    decidedAt: r.decidedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  }))

  return (
    <RequestsHome
      requests={requests}
      canPauseMeals={user.modules.includes('food') && Boolean(resident?.foodOptIn)}
      accent={resident?.property.type === 'WOMENS' ? 'pink' : 'blue'}
    />
  )
}
