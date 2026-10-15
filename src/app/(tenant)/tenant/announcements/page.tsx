import type { Metadata } from 'next'
import { Megaphone, Pin } from 'lucide-react'
import { redirect } from 'next/navigation'
import { requireTenant } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { formatDate, relativeTime } from '@/lib/utils'
import { cn } from '@/lib/utils'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/feedback'
import { Stagger, StaggerItem } from '@/components/motion/reveal'
import { IconTile, PhoneHeader } from '../_ui/phone-ui'

export const metadata: Metadata = { title: 'Announcements' }

export default async function TenantAnnouncementsPage() {
  const user = await requireTenant()
  // Switched off for this PG: back to the home screen, nothing broken.
  if (!user.modules.includes('announcements')) redirect('/tenant')

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
      <PhoneHeader icon={Megaphone} title="Announcements" subtitle="Notices from your PG." />

      {announcements.length === 0 ? (
        <EmptyState
          icon="megaphone"
          title="Nothing announced yet"
          description="Water supply, menu changes and other notices from your PG will appear here."
        />
      ) : (
        <Stagger onView={false} className="space-y-3">
          {announcements.map((announcement) => (
            <StaggerItem key={announcement.id}>
              <Card
                className={cn(
                  'relative overflow-hidden',
                  announcement.pinned &&
                    'border-marigold-200/80 bg-gradient-to-br from-marigold-50/80 via-white to-white',
                )}
              >
                <CardContent className="p-5">
                  <div className="flex items-start gap-3">
                    <IconTile icon={announcement.pinned ? Pin : Megaphone} tone={announcement.pinned ? 'marigold' : 'blue'} />
                    <div className="min-w-0 flex-1">
                      {announcement.pinned && (
                        <p className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide text-marigold-700">
                          Pinned
                        </p>
                      )}
                      <p className="font-display text-[15px] font-semibold leading-snug text-slate-900">
                        {announcement.title}
                      </p>
                      <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed text-slate-600">
                        {announcement.body}
                      </p>
                      <p
                        className="mt-3 text-xs text-slate-400"
                        title={formatDate(announcement.publishedAt)}
                      >
                        {relativeTime(announcement.publishedAt)}
                        {announcement.createdByName ? ` · ${announcement.createdByName}` : ''}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </StaggerItem>
          ))}
        </Stagger>
      )}
    </div>
  )
}
