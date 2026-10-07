import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { requireOrgUser } from '@/lib/auth'
import { NotFoundError } from '@/lib/tenancy'
import { categoryLabel, priorityLabel, PRIORITY_STYLE, TICKET_STATUS_STYLE, type TicketPriority, type TicketStatus } from '@/lib/support'
import { formatDateTime } from '@/lib/utils'
import { canUseSupport, getTicket } from '@/server/services/support'
import { PageHeader } from '@/components/app/page-header'
import { StatusChip } from '@/components/ui/badge'
import { SupportThread } from '@/components/app/support-thread'

export const metadata: Metadata = { title: 'Support ticket' }

export default async function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireOrgUser()
  if (!canUseSupport(user)) redirect('/app/no-access')
  const { id } = await params
  let data: Awaited<ReturnType<typeof getTicket>>
  try {
    data = await getTicket(user, id)
  } catch (error) {
    if (error instanceof NotFoundError) notFound()
    throw error
  }
  const { ticket, messages } = data
  const status = ticket.status as TicketStatus
  const style = TICKET_STATUS_STYLE[status]

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader
        title={ticket.subject}
        subtitle={`${ticket.code} · ${categoryLabel(ticket.category)} · opened by ${ticket.createdByName} on ${formatDateTime(ticket.createdAt)}`}
        icon="lifebuoy"
        breadcrumbs={[
          { label: 'Dashboard', href: '/app' },
          { label: 'Support', href: '/app/support' },
          { label: ticket.code },
        ]}
        actions={
          <div className="flex flex-wrap gap-1.5">
            <StatusChip label={style.label} chip={style.chip} />
            <StatusChip
              label={`${priorityLabel(ticket.priority)} priority`}
              chip={PRIORITY_STYLE[ticket.priority as TicketPriority] ?? PRIORITY_STYLE.NORMAL}
            />
          </div>
        }
      />
      {status === 'WAITING_ON_CUSTOMER' && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          The StayFlow team is waiting for your reply.
        </p>
      )}
      <SupportThread
        ticketId={ticket.id}
        status={status}
        messages={messages.map((m) => ({ ...m, createdAt: m.createdAt.toISOString() }))}
      />
    </div>
  )
}
