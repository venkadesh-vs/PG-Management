import Link from 'next/link'
import { BedDouble, CalendarClock, ChevronRight, CircleCheck, Clock, LogOut, PackageMinus, PhoneCall, Wallet, Inbox } from 'lucide-react'
import type { AttentionCounts, AttentionFlags } from '@/server/services/analytics'
import { LONG_VACANT_DAYS } from '@/server/services/analytics'
import { cn, formatMoney } from '@/lib/utils'
import { Stagger, StaggerItem } from '@/components/motion/reveal'

type Severity = 'red' | 'amber' | 'blue'

type AttentionItem = {
  key: string
  icon: React.ComponentType<{ className?: string }>
  severity: Severity
  value: number
  text: string
  href: string
}

const SEVERITY: Record<Severity, { card: string; icon: string; value: string }> = {
  red: { card: 'hover:border-rose-200', icon: 'bg-rose-50 text-rose-600', value: 'text-slate-900' },
  amber: { card: 'hover:border-amber-200', icon: 'bg-amber-50 text-amber-600', value: 'text-slate-900' },
  blue: { card: 'hover:border-blue-200', icon: 'bg-slate-100 text-slate-600', value: 'text-slate-900' },
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)

function buildItems(c: AttentionCounts, f: AttentionFlags, withProperty: (href: string) => string): AttentionItem[] {
  const items: AttentionItem[] = []
  if (f.rent && c.overdueResidents > 0) {
    items.push({
      key: 'rent',
      icon: Wallet,
      severity: 'red',
      value: c.overdueResidents,
      text: `${plural(c.overdueResidents, 'resident hasn’t', 'residents haven’t')} paid rent — ${formatMoney(c.overdueAmount)} overdue`,
      href: withProperty('/app/rent?status=OVERDUE'),
    })
  }
  if (f.complaints && c.slaBreached > 0) {
    items.push({
      key: 'sla',
      icon: Clock,
      severity: 'red',
      value: c.slaBreached,
      text: `${plural(c.slaBreached, 'complaint has', 'complaints have')} gone past the promised fix time`,
      href: withProperty('/app/complaints?sla=breached'),
    })
  }
  if (f.beds && c.longVacantBeds > 0) {
    items.push({
      key: 'beds',
      icon: BedDouble,
      severity: 'amber',
      value: c.longVacantBeds,
      text: `${plural(c.longVacantBeds, 'bed has', 'beds have')} been empty for ${LONG_VACANT_DAYS}+ days`,
      href: withProperty('/app/beds'),
    })
  }
  if (f.residents && c.leavingThisWeek > 0) {
    items.push({
      key: 'leaving',
      icon: LogOut,
      severity: 'amber',
      value: c.leavingThisWeek,
      text: `${plural(c.leavingThisWeek, 'resident is', 'residents are')} moving out this week`,
      href: withProperty('/app/residents?status=NOTICE'),
    })
  }
  if (f.bookings && c.expiringBookings > 0) {
    items.push({
      key: 'bookings',
      icon: CalendarClock,
      severity: 'amber',
      value: c.expiringBookings,
      text: `${plural(c.expiringBookings, 'booking expires', 'bookings expire')} in the next 2 days`,
      href: withProperty('/app/bookings'),
    })
  }
  if (f.grocery && c.lowStock > 0) {
    items.push({
      key: 'grocery',
      icon: PackageMinus,
      severity: 'amber',
      value: c.lowStock,
      text: `${plural(c.lowStock, 'grocery item is', 'grocery items are')} running low`,
      href: withProperty('/app/grocery'),
    })
  }
  if (f.requests && c.pendingRequests > 0) {
    items.push({
      key: 'requests',
      icon: Inbox,
      severity: 'blue',
      value: c.pendingRequests,
      text: `${plural(c.pendingRequests, 'resident request is', 'resident requests are')} waiting for your answer`,
      href: withProperty('/app/requests'),
    })
  }
  if (f.leads && c.followUpsDue > 0) {
    items.push({
      key: 'leads',
      icon: PhoneCall,
      severity: 'blue',
      value: c.followUpsDue,
      text: `${plural(c.followUpsDue, 'enquiry needs', 'enquiries need')} a follow-up call today`,
      href: withProperty('/app/leads'),
    })
  }
  return items
}

/** PRD §22: the first thing an owner sees — only what they can act on. */
export function AttentionPanel({
  counts,
  flags,
  propertyId,
}: {
  counts: AttentionCounts
  flags: AttentionFlags
  propertyId: string | null
}) {
  const withProperty = (href: string) =>
    propertyId ? `${href}${href.includes('?') ? '&' : '?'}property=${propertyId}` : href
  const items = buildItems(counts, flags, withProperty)

  if (items.length === 0) {
    return (
      <div className="flex items-center gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-xs sm:p-5">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600" aria-hidden>
          <CircleCheck className="size-5" strokeWidth={1.75} />
        </span>
        <div>
          <p className="text-sm font-semibold text-slate-900">All clear today</p>
          <p className="text-sm text-slate-500">Rent, complaints and beds are all on track. Enjoy the calm.</p>
        </div>
      </div>
    )
  }

  return (
    <section aria-labelledby="attention-title" className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h2 id="attention-title" className="text-[15px] font-semibold text-slate-900">
          Needs attention
        </h2>
        <span className="text-xs font-medium text-slate-500">
          {items.length} {plural(items.length, 'thing', 'things')} to look at
        </span>
      </div>
      <Stagger onView={false} gap={0.05} className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((item) => {
          const tone = SEVERITY[item.severity]
          return (
            <StaggerItem key={item.key}>
              <Link
                href={item.href}
                className={cn(
                  'group flex h-full items-center gap-3 rounded-xl border border-slate-200 bg-white p-3.5 shadow-xs transition-colors',
                  tone.card,
                )}
              >
                <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-lg', tone.icon)}>
                  <item.icon className="size-[18px]" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className={cn('block text-lg font-semibold leading-tight tabular', tone.value)}>

                    {item.value}
                  </span>
                  <span className="block text-sm leading-snug text-slate-600">{item.text}</span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-slate-500" />
              </Link>
            </StaggerItem>
          )
        })}
      </Stagger>
    </section>
  )
}
