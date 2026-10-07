'use client'

import Link from 'next/link'
import { CalendarClock, Home, MessageCircle, Phone, Wallet } from 'lucide-react'
import { cn, formatDate, formatDateTime, formatMoney } from '@/lib/utils'
import { SOURCE_LABEL, STATUS_META, telLink, whatsappLink, type LeadCardData } from './lead-meta'

const CLOSED = new Set(['LOST', 'CHECKED_IN'])

export function followUpState(lead: Pick<LeadCardData, 'nextFollowUpAt' | 'status'>, now = new Date()) {
  if (!lead.nextFollowUpAt || CLOSED.has(lead.status)) return null
  const at = new Date(lead.nextFollowUpAt)
  const endToday = new Date(now)
  endToday.setHours(23, 59, 59, 999)
  const startToday = new Date(now)
  startToday.setHours(0, 0, 0, 0)
  if (at < startToday) return 'overdue' as const
  if (at <= endToday) return 'today' as const
  return 'later' as const
}

export function ContactButtons({ lead, compact }: { lead: Pick<LeadCardData, 'phone' | 'name'>; compact?: boolean }) {
  const first = lead.name.split(' ')[0]
  return (
    <div className="flex items-center gap-1.5">
      <a
        href={telLink(lead.phone)}
        onClick={(e) => e.stopPropagation()}
        aria-label={`Call ${lead.name}`}
        className={cn(
          'inline-flex items-center justify-center gap-1 rounded-lg border border-slate-200 bg-white text-slate-600 transition-colors hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700',
          compact ? 'size-7' : 'h-8 px-2.5 text-xs font-semibold',
        )}
      >
        <Phone className="size-3.5" />
        {!compact && 'Call'}
      </a>
      <a
        href={whatsappLink(lead.phone, `Hi ${first}, thanks for asking about a bed with us!`)}
        target="_blank"
        rel="noreferrer"
        onClick={(e) => e.stopPropagation()}
        aria-label={`WhatsApp ${lead.name}`}
        className={cn(
          'inline-flex items-center justify-center gap-1 rounded-lg border border-slate-200 bg-white text-slate-600 transition-colors hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700',
          compact ? 'size-7' : 'h-8 px-2.5 text-xs font-semibold',
        )}
      >
        <MessageCircle className="size-3.5" />
        {!compact && 'WhatsApp'}
      </a>
    </div>
  )
}

export function LeadCard({ lead, showStatus }: { lead: LeadCardData; showStatus?: boolean }) {
  const follow = followUpState(lead)
  const meta = STATUS_META[lead.status]
  return (
    <div className="group rounded-xl border border-slate-200/80 bg-white p-3 shadow-xs transition-shadow hover:border-slate-300">
      <div className="flex items-start justify-between gap-2">
        <Link href={`/app/leads/${lead.id}`} className="min-w-0 flex-1">
          <p className="truncate font-display text-sm font-semibold text-slate-900 group-hover:text-blue-700">
            {lead.name}
          </p>
          <p className="truncate text-xs text-slate-500 tabular">{lead.phone}</p>
        </Link>
        <ContactButtons lead={lead} compact />
      </div>

      <div className="mt-2.5 space-y-1 text-xs text-slate-600">
        {lead.property && (
          <p className="flex items-center gap-1.5 truncate">
            <Home className="size-3.5 shrink-0 text-slate-400" /> {lead.property.name}
          </p>
        )}
        {(lead.budget || lead.moveInDate) && (
          <p className="flex items-center gap-1.5 truncate">
            <Wallet className="size-3.5 shrink-0 text-slate-400" />
            {lead.budget ? `${formatMoney(lead.budget)}/mo` : 'Budget —'}
            {lead.moveInDate && <span className="text-slate-400">· moves {formatDate(lead.moveInDate)}</span>}
          </p>
        )}
        {lead.status === 'VISIT_SCHEDULED' && lead.visitAt && (
          <p className="flex items-center gap-1.5 truncate font-medium text-amber-700">
            <CalendarClock className="size-3.5 shrink-0" /> Visit {formatDateTime(lead.visitAt)}
          </p>
        )}
        {lead.status === 'LOST' && lead.lostReason && (
          <p className="truncate text-slate-400">Lost · {lead.lostReason}</p>
        )}
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        {showStatus && (
          <span className={cn('rounded-full border px-2 py-px text-[11px] font-medium', meta.chip)}>{meta.label}</span>
        )}
        <span className="rounded-full bg-slate-100 px-2 py-px text-[11px] font-medium text-slate-600">
          {SOURCE_LABEL[lead.source] ?? lead.source}
        </span>
        {follow && (
          <span
            className={cn(
              'rounded-full px-2 py-px text-[11px] font-semibold',
              follow === 'overdue' && 'bg-rose-50 text-rose-700',
              follow === 'today' && 'bg-amber-50 text-amber-700',
              follow === 'later' && 'bg-slate-50 text-slate-500',
            )}
          >
            {follow === 'overdue' ? 'Overdue · ' : follow === 'today' ? 'Today · ' : 'Follow up '}
            {formatDate(lead.nextFollowUpAt)}
          </span>
        )}
      </div>
    </div>
  )
}
