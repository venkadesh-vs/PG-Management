import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ChevronRight, MessageSquare } from 'lucide-react'
import { requireOrgUser } from '@/lib/auth'
import { categoryLabel, isActiveStatus, priorityLabel, PRIORITY_STYLE, TICKET_STATUS_STYLE, type TicketPriority, type TicketStatus } from '@/lib/support'
import { relativeTime } from '@/lib/utils'
import { canUseSupport, listOrgTickets } from '@/server/services/support'
import { PageHeader, SectionHeader } from '@/components/app/page-header'
import { Card, CardContent } from '@/components/ui/card'
import { StatusChip } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/feedback'
import { NewTicket } from './new-ticket'

export const metadata: Metadata = { title: 'Support' }

export default async function SupportPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string; category?: string; subject?: string }>
}) {
  const user = await requireOrgUser()
  if (!canUseSupport(user)) redirect('/app/no-access')
  const params = await searchParams
  const tickets = await listOrgTickets(user)
  const active = tickets.filter((t) => isActiveStatus(t.status as TicketStatus))
  const done = tickets.filter((t) => !isActiveStatus(t.status as TicketStatus))

  const list = (rows: typeof tickets) => (
    <div className="space-y-2">
      {rows.map((t) => {
        const style = TICKET_STATUS_STYLE[t.status as TicketStatus]
        return (
          <Link key={t.id} href={`/app/support/${t.id}`} className="block">
            <Card className="transition-colors hover:border-slate-300">
              <CardContent className="flex items-center gap-3 p-4">
                <MessageSquare className="size-4 shrink-0 text-slate-400" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-900">{t.subject}</p>
                  <p className="truncate text-xs text-slate-500">
                    {t.code} · {categoryLabel(t.category)} · {t._count.messages}{' '}
                    {t._count.messages === 1 ? 'message' : 'messages'} · updated {relativeTime(t.updatedAt)}
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5 sm:hidden">
                    <StatusChip label={style.label} chip={style.chip} />
                  </div>
                </div>
                {t.priority !== 'NORMAL' && (
                  <StatusChip
                    label={priorityLabel(t.priority)}
                    chip={PRIORITY_STYLE[t.priority as TicketPriority] ?? PRIORITY_STYLE.NORMAL}
                    className="hidden sm:inline-flex"
                  />
                )}
                <StatusChip label={style.label} chip={style.chip} className="hidden sm:inline-flex" />
                <ChevronRight className="size-4 shrink-0 text-slate-300" />
              </CardContent>
            </Card>
          </Link>
        )
      })}
    </div>
  )

  return (
    <div className="space-y-6">
      <PageHeader
        title="Support"
        subtitle="Ask the StayFlow team for help. We reply here and send you a notification."
        icon="lifebuoy"
        breadcrumbs={[{ label: 'Dashboard', href: '/app' }, { label: 'Support' }]}
        actions={
          <>
            <Link
              href="/app/help"
              className="inline-flex h-10 items-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Help articles
            </Link>
            <NewTicket
              autoOpen={params.new === '1'}
              defaultCategory={params.category ?? ''}
              defaultSubject={params.subject ?? ''}
            />
          </>
        }
      />

      {tickets.length === 0 ? (
        <EmptyState
          icon="lifebuoy"
          title="No tickets yet"
          description="Stuck on something? Check the help articles, or open a ticket and the StayFlow team will get back to you."
        />
      ) : (
        <>
          <SectionHeader
            title="Open tickets"
            description={active.length ? 'Waiting for the StayFlow team or for your reply.' : undefined}
            icon="messages"
          />
          {active.length ? (
            list(active)
          ) : (
            <EmptyState compact icon="check" title="Nothing open" description="Every ticket has been resolved." />
          )}
          {done.length > 0 && (
            <>
              <SectionHeader title="Resolved and closed" icon="history" />
              {list(done)}
            </>
          )}
        </>
      )}
    </div>
  )
}
