import type { Metadata } from 'next'
import Link from 'next/link'
import { ChevronRight, UserRound, Wrench } from 'lucide-react'
import { redirect } from 'next/navigation'
import { requireTenant } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { COMPLAINT_STATUS_STYLE, PRIORITY_STYLE } from '@/lib/theme'
import { cn, relativeTime } from '@/lib/utils'
import { StatusChip } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/feedback'
import { getLookup, getLookupLabels } from '@/server/services/org-defaults'
import { Stagger, StaggerItem } from '@/components/motion/reveal'
import { RaiseComplaintButton } from './raise-complaint'
import { IconTile, PhoneHeader, TAPPABLE } from '../_ui/phone-ui'

export const metadata: Metadata = { title: 'Complaints' }

export default async function TenantComplaintsPage() {
  const user = await requireTenant()
  // Switched off for this PG: back to the home screen, nothing broken.
  if (!user.modules.includes('complaints')) redirect('/tenant')

  const orgId = user.organizationId ?? ''
  const [complaints, categories, categoryLabels] = await Promise.all([
    prisma.complaint.findMany({
      where: { residentId: user.residentId },
      include: {
        assignedStaff: { select: { name: true, role: true } },
        _count: { select: { updates: true } },
      },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    }),
    getLookup(orgId, 'COMPLAINT_CATEGORY'),
    getLookupLabels(orgId, 'COMPLAINT_CATEGORY'),
  ])

  const open = complaints.filter((c) =>
    ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD'].includes(c.status),
  )

  return (
    <div className="space-y-5">
      <PhoneHeader
        icon={Wrench}
        title="Complaints"
        subtitle={
          open.length > 0 ? `${open.length} being looked at` : 'Report anything that needs fixing.'
        }
        action={<RaiseComplaintButton categories={categories} />}
      />

      {complaints.length === 0 ? (
        <EmptyState
          icon="wrench"
          title="Nothing reported yet"
          description="A leaking tap, a fan making noise, slow WiFi — raise it here and you can follow exactly what happens next."
          action={<RaiseComplaintButton variant="outline" categories={categories} />}
        />
      ) : (
        <Stagger onView={false} className="space-y-2.5">
          {complaints.map((complaint) => {
            const status = COMPLAINT_STATUS_STYLE[complaint.status]
            const priority = PRIORITY_STYLE[complaint.priority]
            const isOpen = ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD'].includes(complaint.status)
            return (
              <StaggerItem key={complaint.id}>
                <Link
                  href={`/tenant/complaints/${complaint.id}`}
                  className={cn(
                    'flex items-start gap-3 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-card',
                    TAPPABLE,
                  )}
                >
                  <IconTile icon={Wrench} tone={isOpen ? 'blue' : 'slate'} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className="line-clamp-2 text-sm font-semibold leading-snug text-slate-900">
                        {complaint.title}
                      </p>
                      <StatusChip label={status.label} chip={status.chip} className="shrink-0" />
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      {complaint.code} · {categoryLabels[complaint.category] ?? complaint.category} ·{' '}
                      {relativeTime(complaint.createdAt)}
                    </p>
                    <div className="mt-2.5 flex items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <StatusChip label={priority.label} chip={priority.chip} />
                        {complaint.assignedStaff && (
                          <span className="flex min-w-0 items-center gap-1 text-xs text-slate-500">
                            <UserRound className="size-3.5 shrink-0" />
                            <span className="truncate">{complaint.assignedStaff.name} is on it</span>
                          </span>
                        )}
                      </div>
                      <ChevronRight className="size-4 shrink-0 text-slate-300" />
                    </div>
                  </div>
                </Link>
              </StaggerItem>
            )
          })}
        </Stagger>
      )}
    </div>
  )
}
