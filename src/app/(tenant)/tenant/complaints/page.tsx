import type { Metadata } from 'next'
import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { requireTenant } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { COMPLAINT_STATUS_STYLE, PRIORITY_STYLE } from '@/lib/theme'
import { relativeTime } from '@/lib/utils'
import { Card, CardContent } from '@/components/ui/card'
import { StatusChip } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/feedback'
import { RaiseComplaintButton } from './raise-complaint'

export const metadata: Metadata = { title: 'Complaints' }

export default async function TenantComplaintsPage() {
  const user = await requireTenant()

  const complaints = await prisma.complaint.findMany({
    where: { residentId: user.residentId },
    include: {
      assignedStaff: { select: { name: true, role: true } },
      _count: { select: { updates: true } },
    },
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
  })

  const open = complaints.filter((c) =>
    ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD'].includes(c.status),
  )

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-semibold tracking-tight text-slate-900">
            Complaints
          </h1>
          <p className="mt-0.5 text-sm text-slate-500">
            {open.length > 0
              ? `${open.length} being looked at`
              : 'Report anything that needs fixing.'}
          </p>
        </div>
        <RaiseComplaintButton />
      </div>

      {complaints.length === 0 ? (
        <EmptyState
          icon="wrench"
          title="Nothing reported yet"
          description="A leaking tap, a fan making noise, slow WiFi — raise it here and you can follow exactly what happens next."
          action={<RaiseComplaintButton variant="outline" />}
        />
      ) : (
        <ul className="space-y-2">
          {complaints.map((complaint) => {
            const status = COMPLAINT_STATUS_STYLE[complaint.status]
            const priority = PRIORITY_STYLE[complaint.priority]
            return (
              <li key={complaint.id}>
                <Link href={`/tenant/complaints/${complaint.id}`}>
                  <Card className="transition-shadow hover:shadow-elevated">
                    <CardContent className="flex items-center gap-3 p-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <p className="truncate text-sm font-medium text-slate-900">
                            {complaint.title}
                          </p>
                          <StatusChip label={priority.label} chip={priority.chip} />
                        </div>
                        <p className="mt-0.5 truncate text-xs text-slate-500">
                          {complaint.code} · {relativeTime(complaint.createdAt)}
                          {complaint.assignedStaff
                            ? ` · ${complaint.assignedStaff.name} is on it`
                            : ''}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <StatusChip label={status.label} chip={status.chip} />
                        <ChevronRight className="size-4 text-slate-300" />
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
