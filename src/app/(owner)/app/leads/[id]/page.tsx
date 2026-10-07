import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { CalendarClock, MessageCircle, Phone, PhoneCall, StickyNote, Activity, BedDouble, Footprints } from 'lucide-react'
import { requireAccess } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { ForbiddenError, NotFoundError } from '@/lib/tenancy'
import { cn, formatDate, formatDateTime, formatMoney, relativeTime } from '@/lib/utils'
import { PageHeader } from '@/components/app/page-header'
import { Card, CardContent } from '@/components/ui/card'
import { getLeadForUser } from '@/server/services/leads'
import { ContactButtons } from '../lead-card'
import { BOOKING_STATUS, ROOM_PREFS, SOURCE_LABEL, STATUS_META, type LeadStatus } from '../lead-meta'
import { AddNote, LeadActions } from './lead-actions'

export const metadata: Metadata = { title: 'Enquiry' }

const KIND_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  NOTE: StickyNote,
  CALL: PhoneCall,
  STATUS: Activity,
  VISIT: Footprints,
  WHATSAPP: MessageCircle,
  BOOKING: BedDouble,
}
const KIND_TONE: Record<string, string> = {
  NOTE: 'bg-slate-100 text-slate-600',
  CALL: 'bg-blue-50 text-blue-600',
  STATUS: 'bg-violet-50 text-violet-600',
  VISIT: 'bg-amber-50 text-amber-600',
  WHATSAPP: 'bg-emerald-50 text-emerald-600',
  BOOKING: 'bg-indigo-50 text-indigo-600',
}

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireAccess({ module: 'leads', permission: 'leads.view' })
  const { id } = await params
  try {
    await getLeadForUser(user, id)
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ForbiddenError) notFound()
    throw error
  }

  const lead = await prisma.residentLead.findUnique({
    where: { id },
    include: {
      property: { select: { id: true, name: true } },
      activities: { orderBy: { createdAt: 'desc' }, take: 200 },
      bookings: {
        orderBy: { createdAt: 'desc' },
        include: { bed: { select: { label: true, room: { select: { number: true } } } } },
      },
    },
  })
  if (!lead) notFound()

  const canManage = user.role === 'SUPER_ADMIN' || user.permissions.includes('leads.manage')
  const canBook = user.role === 'SUPER_ADMIN' || user.permissions.includes('bookings.manage')
  const status = lead.status as LeadStatus
  const meta = STATUS_META[status]
  const openBooking = lead.bookings.find((b) => b.status === 'PENDING' || b.status === 'CONFIRMED') ?? null
  const overdue =
    lead.nextFollowUpAt && status !== 'LOST' && status !== 'CHECKED_IN' && lead.nextFollowUpAt < new Date(new Date().setHours(0, 0, 0, 0))

  const facts: [string, React.ReactNode][] = [
    ['PG', lead.property?.name ?? 'Not chosen yet'],
    ['Source', SOURCE_LABEL[lead.source] ?? lead.source],
    ['Budget', lead.budget ? `${formatMoney(lead.budget)} / month` : '—'],
    ['Room preference', ROOM_PREFS.find((r) => r.value === lead.roomTypePref)?.label ?? lead.roomTypePref ?? '—'],
    ['Move-in date', formatDate(lead.moveInDate)],
    ['Email', lead.email ?? '—'],
    ['Gender', lead.gender ? lead.gender.charAt(0) + lead.gender.slice(1).toLowerCase() : '—'],
    ['Visit', lead.visitAt ? formatDateTime(lead.visitAt) : '—'],
    [
      'Next follow-up',
      <span key="f" className={cn(overdue && 'font-semibold text-rose-600')}>
        {lead.nextFollowUpAt ? `${formatDateTime(lead.nextFollowUpAt)}${overdue ? ' · overdue' : ''}` : '—'}
      </span>,
    ],
  ]
  if (status === 'LOST') facts.push(['Lost because', lead.lostReason ?? '—'])

  return (
    <div className="space-y-6">
      <PageHeader
        title={lead.name}
        subtitle={`Enquired ${relativeTime(lead.createdAt)} · ${meta.label}`}
        icon="user"
        breadcrumbs={[
          { label: 'Dashboard', href: '/app' },
          { label: 'Enquiries', href: '/app/leads' },
          { label: lead.name },
        ]}
        actions={<ContactButtons lead={{ phone: lead.phone, name: lead.name }} />}
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <Card>
            <CardContent className="space-y-4 p-5">
              <div className="flex flex-wrap items-center gap-2">
                <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold', meta.chip)}>
                  <span className={cn('size-1.5 rounded-full', meta.dot)} /> {meta.label}
                </span>
                <a href={`tel:${lead.phone}`} className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-700 tabular hover:text-blue-700">
                  <Phone className="size-3.5" /> {lead.phone}
                </a>
              </div>
              <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                {facts.map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-[11px] text-slate-500">{label}</dt>
                    <dd className="mt-0.5 text-sm text-slate-800">{value}</dd>
                  </div>
                ))}
              </dl>
              {lead.notes && (
                <p className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-600">{lead.notes}</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-4 p-5">
              <h2 className="font-display text-base font-semibold text-slate-900">Timeline</h2>
              {canManage && <AddNote leadId={lead.id} />}
              <ol className="relative space-y-4 before:absolute before:bottom-2 before:left-4 before:top-2 before:w-px before:bg-slate-200">
                {lead.activities.map((a) => {
                  const Icon = KIND_ICON[a.kind] ?? StickyNote
                  return (
                    <li key={a.id} className="relative flex gap-3">
                      <span className={cn('relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full ring-4 ring-white', KIND_TONE[a.kind] ?? KIND_TONE.NOTE)}>
                        <Icon className="size-3.5" />
                      </span>
                      <div className="min-w-0 pt-1">
                        <p className="text-sm text-slate-800 text-pretty">{a.body}</p>
                        <p className="mt-0.5 text-xs text-slate-400">
                          {a.actorName} · {formatDateTime(a.createdAt)}
                        </p>
                      </div>
                    </li>
                  )
                })}
              </ol>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardContent className="space-y-3 p-4">
              <h2 className="text-xs font-medium text-slate-500">Next step</h2>
              <LeadActions
                lead={{ id: lead.id, name: lead.name, status }}
                canManage={canManage}
                canBook={canBook}
                openBookingId={openBooking?.id ?? null}
              />
              {!canManage && !canBook && <p className="text-sm text-slate-500">You can view this enquiry.</p>}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-3 p-4">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <CalendarClock className="size-3.5" /> Bookings
              </h2>
              {lead.bookings.length === 0 ? (
                <p className="text-sm text-slate-500">No booking yet. Once {lead.name.split(' ')[0]} is keen, hold a bed with a booking.</p>
              ) : (
                <ul className="space-y-2">
                  {lead.bookings.map((b) => {
                    const s = BOOKING_STATUS[b.status]
                    return (
                      <li key={b.id}>
                        <Link
                          href={`/app/bookings?q=${b.code}`}
                          className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 px-3 py-2 transition-colors hover:bg-slate-50"
                        >
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-slate-800">{b.code}</p>
                            <p className="truncate text-xs text-slate-500">
                              {b.bed ? `Bed ${b.bed.room.number}-${b.bed.label} · ` : ''}from {formatDate(b.checkInDate)}
                            </p>
                          </div>
                          <span className={cn('rounded-full border px-2 py-px text-[11px] font-medium', s?.chip)}>{s?.label ?? b.status}</span>
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
