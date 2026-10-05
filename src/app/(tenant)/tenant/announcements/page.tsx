import type { Metadata } from 'next'
import { Megaphone, Pin } from 'lucide-react'
import { requireTenant } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { formatDate, relativeTime } from '@/lib/utils'
import { cn } from '@/lib/utils'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/feedback'

export const metadata: Metadata = { title: 'Announcements' }

export default async function TenantAnnouncementsPage() {
  const user = await requireTenant()

  const resident = await prisma.resident.findUnique({
    where: { id: user.residentId },
    select: { organizationId: true, propertyId: true },
  })
  if (!resident) return null

  const announcements = await prisma.announcement.findMany({
    where: {
      organizationId: resident.organizationId,
      OR: [{ propertyId: null }, { propertyId: resident.propertyId }],
    },
    orderBy: [{ pinned: 'desc' }, { publishedAt: 'desc' }],
    take: 50,
  })

  // Opening this page marks the resident's announcement targets as read.
  await prisma.announcementTarget.updateMany({
    where: { residentId: user.residentId, readAt: null },
    data: { readAt: new Date() },
  })

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-xl font-semibold tracking-tight text-slate-900">
          Announcements
        </h1>
        <p className="mt-0.5 text-sm text-slate-500">Notices from your PG.</p>
      </div>

      {announcements.length === 0 ? (
        <EmptyState
          icon="megaphone"
          title="Nothing announced yet"
          description="Water supply, menu changes and other notices from your PG will appear here."
        />
      ) : (
        <ul className="space-y-3">
          {announcements.map((announcement) => (
            <li key={announcement.id}>
              <Card className={cn(announcement.pinned && 'border-amber-200 bg-amber-50/30')}>
                <CardContent className="p-5">
                  <div className="flex items-start gap-3">
                    <div
                      className={cn(
                        'flex size-9 shrink-0 items-center justify-center rounded-xl',
                        announcement.pinned ? 'bg-amber-100' : 'bg-sky-50',
                      )}
                    >
                      {announcement.pinned ? (
                        <Pin className="size-4 text-amber-600" />
                      ) : (
                        <Megaphone className="size-4 text-sky-600" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-display text-sm font-semibold text-slate-900">
                        {announcement.title}
                      </p>
                      <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed text-slate-600">
                        {announcement.body}
                      </p>
                      <p
                        className="mt-2 text-[11px] text-slate-400"
                        title={formatDate(announcement.publishedAt)}
                      >
                        {relativeTime(announcement.publishedAt)}
                        {announcement.createdByName ? ` · ${announcement.createdByName}` : ''}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
