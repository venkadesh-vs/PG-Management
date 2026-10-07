'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlarmClock,
  Bed,
  Building2,
  CalendarClock,
  ChevronDown,
  Laptop,
  Mail,
  MapPin,
  MessageSquare,
  Phone,
  Send,
  UserRound,
} from 'lucide-react'
import { api } from '@/lib/client'
import { cn, formatDate, formatDateTime, formatPhone, relativeTime } from '@/lib/utils'
import { publicEnv } from '@/lib/public-env'
import { useToast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { StatusChip } from '@/components/ui/badge'
import { Input, Select, Textarea } from '@/components/ui/input'
import { CreateClientDialog } from '../organizations/create-client-dialog'
import { LEAD_STATUSES, LOST_REASONS, followUpState, leadStyle } from './lead-meta'
import { LeadEditDialog, type AdminOption } from './lead-edit-dialog'

export type CrmLead = {
  id: string
  name: string
  phone: string
  whatsapp: string | null
  email: string | null
  pgName: string | null
  pgCount: number
  pgTypes: string | null
  bedCount: number | null
  rentRange: string | null
  currentMethod: string | null
  currentSoftware: string | null
  city: string | null
  message: string | null
  status: string
  source: string
  createdAt: string
  lastContactedAt: string | null
  demoAt: string | null
  followUpAt: string | null
  lostReason: string | null
  salesOwnerId: string | null
  convertedOrgId: string | null
  convertedOrgName?: string | null
  notes: { id: string; body: string; authorName: string; createdAt: string; statusTo: string | null }[]
}

/** "Overdue" / "Follow up today" chip for a lead's next follow-up. */
export function FollowUpChip({
  lead,
  className,
}: {
  lead: Pick<CrmLead, 'followUpAt' | 'status'>
  className?: string
}) {
  const state = followUpState(lead.followUpAt, new Date(), lead.status)
  if (state === 'none') return null
  const style =
    state === 'overdue'
      ? 'border-red-200 bg-red-50 text-red-700'
      : state === 'today'
        ? 'border-amber-200 bg-amber-50 text-amber-700'
        : 'border-slate-200 bg-slate-50 text-slate-600'
  const label =
    state === 'overdue'
      ? `Overdue · ${formatDate(lead.followUpAt)}`
      : state === 'today'
        ? 'Follow up today'
        : `Follow up ${formatDate(lead.followUpAt)}`
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-px text-[11px] font-medium',
        style,
        className,
      )}
    >
      <AlarmClock className="size-3" />
      {label}
    </span>
  )
}

const PG_TYPE: Record<string, string> = { BOTH: 'Both', MENS: "Men's", WOMENS: "Women's" }

/**
 * One enquiry, with the pipeline controls in place. Everything the PG owner
 * typed on the website is here so the first call is an informed one.
 */
export function LeadCard({
  lead,
  admins = [],
  currentAdminId,
  defaultExpanded = false,
  bare = false,
}: {
  lead: CrmLead
  admins?: AdminOption[]
  currentAdminId?: string
  defaultExpanded?: boolean
  /** Without the card frame (inside a dialog). */
  bare?: boolean
}) {
  const router = useRouter()
  const toast = useToast()
  const [expanded, setExpanded] = React.useState(defaultExpanded)
  const [note, setNote] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [pending, setPending] = React.useState<null | 'LOST' | 'DEMO_SCHEDULED'>(null)
  const [lostReason, setLostReason] = React.useState(lead.lostReason ?? '')
  const [demoAt, setDemoAt] = React.useState('')

  const style = leadStyle(lead.status)
  const owner = admins.find((a) => a.id === lead.salesOwnerId)
  const whatsappNumber = (lead.whatsapp || lead.phone).replace(/\D/g, '')
  const whatsappLink = `https://wa.me/${whatsappNumber.length === 10 ? `91${whatsappNumber}` : whatsappNumber}?text=${encodeURIComponent(
    `Hi ${lead.name.split(' ')[0]}, this is ${publicEnv.appName} following up on your demo request for ${lead.pgName ?? 'your PG'}.`,
  )}`

  async function update(payload: Record<string, unknown>) {
    setBusy(true)
    try {
      const result = await api.post<{ message: string }>('/api/admin/leads', {
        leadId: lead.id,
        ...payload,
      })
      toast.success('Lead updated', result.message)
      setNote('')
      setPending(null)
      router.refresh()
    } catch (error) {
      toast.fromError(error, 'update the lead')
    } finally {
      setBusy(false)
    }
  }

  function onStatus(status: string) {
    if (status === 'LOST' && !lead.lostReason) return setPending('LOST')
    if (status === 'DEMO_SCHEDULED') return setPending('DEMO_SCHEDULED')
    setPending(null)
    void update({ status, note: note || undefined })
  }

  const clientDefaults = {
    orgName: lead.pgName ?? '',
    ownerName: lead.name,
    email: lead.email ?? '',
    phone: lead.whatsapp || lead.phone,
    city: lead.city ?? '',
  }

  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-display text-sm font-semibold text-slate-900">{lead.name}</p>
          <p className="truncate text-xs text-slate-500">
            {lead.pgName ?? 'PG owner'}
            {lead.city ? ` · ${lead.city}` : ''} · {relativeTime(lead.createdAt)}
          </p>
        </div>
        <StatusChip label={style.label} chip={style.chip} />
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <FollowUpChip lead={lead} />
        {owner && (
          <span className="inline-flex items-center gap-1 text-[11px] text-slate-500">
            <UserRound className="size-3" />
            {owner.name}
          </span>
        )}
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <Metric icon={Building2} label="PGs" value={String(lead.pgCount)} />
        <Metric icon={Bed} label="Beds" value={lead.bedCount ? String(lead.bedCount) : '—'} />
        <Metric icon={MapPin} label="Type" value={(lead.pgTypes && PG_TYPE[lead.pgTypes]) || '—'} />
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="outline" size="sm" asChild>
          <a href={`tel:${lead.phone}`}>
            <Phone className="size-3.5" />
            {formatPhone(lead.phone)}
          </a>
        </Button>
        <Button variant="outline" size="sm" asChild>
          <a href={whatsappLink} target="_blank" rel="noopener noreferrer">
            <MessageSquare className="size-3.5" />
            WhatsApp
          </a>
        </Button>
        {lead.email && (
          <Button variant="ghost" size="sm" asChild>
            <a href={`mailto:${lead.email}`}>
              <Mail className="size-3.5" />
              Email
            </a>
          </Button>
        )}
        {lead.convertedOrgId ? (
          <Button variant="ghost" size="sm" asChild>
            <Link href={`/admin/organizations/${lead.convertedOrgId}`}>
              <Building2 className="size-3.5" />
              {lead.convertedOrgName ? `Open ${lead.convertedOrgName}` : 'Open customer'}
            </Link>
          </Button>
        ) : (
          <>
            <CreateClientDialog
              trigger="Start trial"
              triggerVariant="outline"
              triggerSize="sm"
              title={`Start a free trial for ${lead.name}`}
              endpoint="/api/admin/leads"
              payload={{ action: 'CONVERT', leadId: lead.id, mode: 'TRIAL' }}
              defaults={clientDefaults}
            />
            <CreateClientDialog
              trigger="Convert to customer"
              triggerVariant="outline"
              triggerSize="sm"
              title={`Convert ${lead.name} to a customer`}
              endpoint="/api/admin/leads"
              payload={{ action: 'CONVERT', leadId: lead.id, mode: 'CONVERTED' }}
              defaults={clientDefaults}
            />
          </>
        )}
        <LeadEditDialog
          trigger="icon"
          admins={admins}
          currentAdminId={currentAdminId}
          lead={{
            id: lead.id,
            name: lead.name,
            phone: lead.phone,
            whatsapp: lead.whatsapp,
            email: lead.email,
            pgName: lead.pgName,
            city: lead.city,
            bedCount: lead.bedCount,
            pgCount: lead.pgCount,
            currentSoftware: lead.currentSoftware,
            source: lead.source,
            salesOwnerId: lead.salesOwnerId,
            followUpAt: lead.followUpAt,
            demoAt: lead.demoAt,
            lostReason: lead.lostReason,
            status: lead.status,
          }}
        />
        <Button variant="ghost" size="sm" onClick={() => setExpanded((e) => !e)}>
          Details
          <ChevronDown className={cn('size-3.5 transition-transform', expanded && 'rotate-180')} />
        </Button>
      </div>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="mt-3 space-y-3 border-t border-slate-100 pt-3">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <Detail label="Rent range" value={lead.rentRange} />
                <Detail label="Managing with" value={lead.currentSoftware || lead.currentMethod} />
                <Detail label="Source" value={lead.source} />
                <Detail
                  label="Last contacted"
                  value={lead.lastContactedAt ? formatDate(lead.lastContactedAt) : 'Not yet'}
                />
                {lead.demoAt && <Detail label="Demo" value={formatDateTime(lead.demoAt)} />}
                {lead.followUpAt && <Detail label="Next follow-up" value={formatDate(lead.followUpAt)} />}
                {lead.lostReason && <Detail label="Lost because" value={lead.lostReason} />}
                <Detail label="Sales owner" value={owner?.name ?? 'Unassigned'} />
              </dl>

              {lead.message && (
                <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">What they said</p>
                  <p className="mt-1 text-sm text-slate-700">{lead.message}</p>
                </div>
              )}

              {lead.notes.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Timeline</p>
                  <ol className="relative space-y-2 border-l border-slate-200 pl-4">
                    {lead.notes.map((n) => (
                      <li key={n.id} className="relative">
                        <span
                          className={cn(
                            'absolute -left-[21px] top-1.5 size-2.5 rounded-full ring-2 ring-white',
                            n.statusTo ? leadStyle(n.statusTo).dot : 'bg-slate-300',
                          )}
                        />
                        <p className="text-sm text-slate-700">{n.body}</p>
                        <p className="mt-0.5 text-[11px] text-slate-400">
                          {n.authorName} · {relativeTime(n.createdAt)}
                        </p>
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              <div className="space-y-2">
                <Textarea
                  rows={2}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Add a note from your call…"
                />
                <div className="flex flex-wrap items-center gap-2">
                  <Select
                    value={pending ?? lead.status}
                    onChange={(e) => onStatus(e.target.value)}
                    disabled={busy}
                    className="min-w-[10rem] flex-1"
                    aria-label="Stage"
                  >
                    {LEAD_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {leadStyle(s).label}
                      </option>
                    ))}
                  </Select>
                  <Button
                    variant="primary"
                    size="sm"
                    loading={busy}
                    onClick={() => update({ note })}
                    disabled={!note.trim()}
                  >
                    <Send className="size-3.5" />
                    Save note
                  </Button>
                </div>

                {pending === 'LOST' && (
                  <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 p-2">
                    <Select
                      value={lostReason}
                      onChange={(e) => setLostReason(e.target.value)}
                      className="min-w-[10rem] flex-1"
                      aria-label="Lost reason"
                    >
                      <option value="">Why was it lost?</option>
                      {LOST_REASONS.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </Select>
                    <Button size="sm" variant="outline" onClick={() => setPending(null)}>
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={!lostReason}
                      loading={busy}
                      onClick={() => update({ status: 'LOST', lostReason, note: note || undefined })}
                    >
                      Mark lost
                    </Button>
                  </div>
                )}

                {pending === 'DEMO_SCHEDULED' && (
                  <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50/60 p-2">
                    <Input
                      type="datetime-local"
                      value={demoAt}
                      onChange={(e) => setDemoAt(e.target.value)}
                      className="min-w-[12rem] flex-1"
                      aria-label="Demo date and time"
                    />
                    <Button size="sm" variant="outline" onClick={() => setPending(null)}>
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      variant="primary"
                      disabled={!demoAt}
                      loading={busy}
                      onClick={() => update({ status: 'DEMO_SCHEDULED', demoAt, note: note || undefined })}
                    >
                      <CalendarClock className="size-3.5" />
                      Schedule demo
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {lead.demoAt && !expanded && lead.status === 'DEMO_SCHEDULED' && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-amber-600">
          <CalendarClock className="size-3.5" />
          Demo {formatDateTime(lead.demoAt)}
        </p>
      )}
      {lead.currentSoftware && !expanded && (
        <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
          <Laptop className="size-3.5" />
          Uses {lead.currentSoftware}
        </p>
      )}
    </>
  )

  if (bare) return <div>{body}</div>
  return (
    <Card>
      <CardContent className="p-4">{body}</CardContent>
    </Card>
  )
}

function Metric({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <div className="rounded-lg bg-slate-50 px-2 py-1.5">
      <Icon className="mx-auto size-3 text-slate-400" />
      <p className="mt-0.5 font-display text-sm font-semibold text-slate-900">{value}</p>
      <p className="text-[10px] uppercase tracking-wide text-slate-400">{label}</p>
    </div>
  )
}

function Detail({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="text-sm text-slate-800 first-letter:uppercase">{value || '—'}</dd>
    </div>
  )
}
