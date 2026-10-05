import type { Metadata } from 'next'
import { Pin, Users } from 'lucide-react'
import { requireOrgUser } from '@/lib/auth'
import { resolveScope } from '@/lib/tenancy'
import { prisma } from '@/lib/prisma'
import { themeFor } from '@/lib/theme'
import { cn, formatDateTime, relativeTime } from '@/lib/utils'
import { PageHeader } from '@/components/app/page-header'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/feedback'
import { AnnouncementComposer } from './composer'

export const metadata: Metadata = { title: 'Announcements' }

export default async function AnnouncementsPage({
  searchParams,
}: {
  searchParams: Promise<{ property?: string }>
}) {
  const user = await requireOrgUser()
  const params = await searchParams
  const scope = await resolveScope(user, params.property)
  const propertyIds = scope.propertyId ? [scope.propertyId] : scope.allowedPropertyIds

  const [announcements, properties, floors, residentCount] = await Promise.all([
    prisma.announcement.findMany({
      where: {
        organizationId: scope.organizationId,
        OR: [{ propertyId: null }, { propertyId: { in: propertyIds } }],
      },
      include: {
        property: { select: { name: true, type: true } },
        _count: { select: { targets: true } },
        targets: { where: { readAt: { not: null } }, select: { id: true } },
      },
      orderBy: [{ pinned: 'desc' }, { publishedAt: 'desc' }],
      take: 50,
    }),
    prisma.property.findMany({
      where: { id: { in: propertyIds } },
      select: { id: true, name: true, type: true },
      orderBy: { name: 'asc' },
    }),
    prisma.floor.findMany({
      where: { propertyId: { in: propertyIds } },
      select: { id: true, name: true, propertyId: true },
      orderBy: { level: 'asc' },
    }),
    prisma.resident.count({
      where: {
        organizationId: scope.organizationId,
        propertyId: { in: propertyIds },
        status: { in: ['ACTIVE', 'NOTICE'] },
      },
    }),
  ])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Announcements"
        subtitle={`One message reaches every resident in their app — and optionally on WhatsApp. ${residentCount} residents can be reached right now.`}
        icon="megaphone"
        breadcrumbs={[{ label: 'Dashboard', href: '/app' }, { label: 'Announcements' }]}
        actions={<AnnouncementComposer properties={properties} floors={floors} />}
      />

      {announcements.length === 0 ? (
        <EmptyState
          icon="megaphone"
          title="No announcements yet"
          description="Water tank cleaning, a menu change, a rent reminder — send it once instead of pasting it into five WhatsApp groups."
        />
      ) : (
        <div className="space-y-3">
          {announcements.map((announcement) => {
            const theme = announcement.property ? themeFor(announcement.property.type) : null
            const readCount = announcement.targets.length
            return (
              <Card key={announcement.id} className={cn(announcement.pinned && 'border-amber-200')}>
                <CardContent className="p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        {announcement.pinned && (
                          <Pin className="size-3.5 shrink-0 text-amber-500" />
                        )}
                        <h2 className="font-display text-base font-semibold text-slate-900">
                          {announcement.title}
                        </h2>
                      </div>
                      <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-slate-600">
                        {announcement.body}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-1.5">
                      {theme && announcement.property ? (
                        <Badge variant="outline" size="sm">
                          <span className={cn('size-1.5 rounded-full', theme.bgSolid)} />
                          {announcement.property.name}
                        </Badge>
                      ) : (
                        <Badge variant="violet" size="sm">
                          All PGs
                        </Badge>
                      )}
                      {announcement.sendWhatsapp && (
                        <Badge variant="success" size="sm">
                          WhatsApp
                        </Badge>
                      )}
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-4 border-t border-slate-100 pt-3 text-xs text-slate-500">
                    <span className="flex items-center gap-1.5">
                      <Users className="size-3.5" />
                      Sent to {announcement._count.targets} resident
                      {announcement._count.targets === 1 ? '' : 's'}
                    </span>
                    {announcement._count.targets > 0 && (
                      <span>
                        {readCount} read (
                        {Math.round((readCount / announcement._count.targets) * 100)}%)
                      </span>
                    )}
                    <span title={formatDateTime(announcement.publishedAt)}>
                      {relativeTime(announcement.publishedAt)}
                    </span>
                    {announcement.createdByName && <span>by {announcement.createdByName}</span>}
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

    </div>
  )
}
