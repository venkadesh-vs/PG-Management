import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Phone } from 'lucide-react'
import { requireSuperAdmin } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { NotFoundError } from '@/lib/tenancy'
import { ADMIN_STATUS_LABEL, categoryLabel, TICKET_STATUS_STYLE, type TicketStatus } from '@/lib/support'
import { formatDateTime, formatPhone } from '@/lib/utils'
import { getTicket } from '@/server/services/support'
import { PageHeader } from '@/components/app/page-header'
import { StatusChip } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { SupportThread } from '@/components/app/support-thread'

export const metadata: Metadata = { title: 'Support ticket' }

export default async function AdminTicketPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requireSuperAdmin()
  const { id } = await params
  let data: Awaited<ReturnType<typeof getTicket>>
  try {
    data = await getTicket(admin, id)
  } catch (error) {
    if (error instanceof NotFoundError) notFound()
    throw error
  }
  const { ticket, messages } = data
  const status = ticket.status as TicketStatus

  const [team, org] = await Promise.all([
    prisma.user.findMany({
      where: { role: 'SUPER_ADMIN', status: 'ACTIVE' },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    prisma.organization.findUnique({
      where: { id: ticket.organizationId },
      select: { id: true, name: true, ownerName: true, contactPhone: true, contactEmail: true, status: true },
    }),
  ])

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader
        title={ticket.subject}
        subtitle={`${ticket.code} · ${categoryLabel(ticket.category)} · opened by ${ticket.createdByName} on ${formatDateTime(ticket.createdAt)}`}
        icon="lifebuoy"
        breadcrumbs={[
          { label: 'Platform', href: '/admin' },
          { label: 'Support', href: '/admin/support' },
          { label: ticket.code },
        ]}
        actions={<StatusChip label={ADMIN_STATUS_LABEL[status]} chip={TICKET_STATUS_STYLE[status].chip} />}
      />
      {org && (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-3 p-4">
            <div className="min-w-0 flex-1">
              <Link
                href={`/admin/organizations/${org.id}`}
                className="block truncate text-sm font-semibold text-slate-900 hover:text-blue-700"
              >
                {org.name}
              </Link>
              <p className="truncate text-xs text-slate-500">
                {org.ownerName} · {formatPhone(org.contactPhone)}
                {org.contactEmail ? ` · ${org.contactEmail}` : ''} · {org.status.toLowerCase()}
              </p>
            </div>
            <a
              href={`tel:${org.contactPhone}`}
              className="shrink-0 rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              aria-label={`Call ${org.ownerName}`}
            >
              <Phone className="size-4" />
            </a>
          </CardContent>
        </Card>
      )}
      <SupportThread
        team
        ticketId={ticket.id}
        status={status}
        priority={ticket.priority}
        assignedTo={ticket.assignedTo}
        teamMembers={team}
        currentUserId={admin.id}
        messages={messages.map((m) => ({ ...m, createdAt: m.createdAt.toISOString() }))}
      />
    </div>
  )
}
