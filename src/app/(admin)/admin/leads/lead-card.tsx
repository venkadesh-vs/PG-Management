'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Bed,
  Building2,
  CalendarClock,
  ChevronDown,
  Mail,
  MapPin,
  MessageSquare,
  Phone,
  Send,
} from 'lucide-react'
import { api, ApiError } from '@/lib/client'
import { cn, formatDate, formatPhone, relativeTime } from '@/lib/utils'
import { LEAD_STATUS_STYLE } from '@/lib/theme'
import { publicEnv } from '@/lib/public-env'
import { useToast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { StatusChip } from '@/components/ui/badge'
import { Select, Textarea } from '@/components/ui/input'
import { CreateClientDialog } from '../organizations/create-client-dialog'

type Lead = {
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
  city: string | null
  message: string | null
  status: string
  source: string
  createdAt: string
  lastContactedAt: string | null
  demoAt: string | null
  convertedOrgId: string | null
  notes: { id: string; body: string; authorName: string; createdAt: string }[]
}

const STATUSES = [
  'NEW',
  'CONTACTED',
  'DEMO_SCHEDULED',
  'DEMO_COMPLETED',
  'TRIAL',
  'CONVERTED',
  'LOST',
] as const

/**
 * One enquiry, with the pipeline controls in place. Everything the PG owner
 * typed on the website is here so the first call is an informed one.
 */
export function LeadCard({ lead }: { lead: Lead }) {
  const router = useRouter()
  const toast = useToast()
  const [expanded, setExpanded] = React.useState(false)
  const [note, setNote] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  const style = LEAD_STATUS_STYLE[lead.status]
  const whatsappNumber = (lead.whatsapp || lead.phone).replace(/\D/g, '')
  const whatsappLink = `https://wa.me/${whatsappNumber.length === 10 ? `91${whatsappNumber}` : whatsappNumber}?text=${encodeURIComponent(
    `Hi ${lead.name.split(' ')[0]}, this is ${publicEnv.appName} following up on your demo request for ${lead.pgName ?? 'your PG'}.`,
  )}`

  async function update(payload: { status?: string; note?: string }) {
    setBusy(true)
    try {
      const result = await api.post<{ message: string }>('/api/admin/leads', {
        leadId: lead.id,
        ...payload,
      })
      toast.success('Lead updated', result.message)
      setNote('')
      router.refresh()
    } catch (error) {
      toast.error(
        'Unable to update',
        error instanceof ApiError ? error.message : 'Please try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate font-display text-sm font-semibold text-slate-900">
              {lead.name}
            </p>
            <p className="truncate text-xs text-slate-500">
              {lead.pgName ?? 'PG owner'}
              {lead.city ? ` · ${lead.city}` : ''} · {relativeTime(lead.createdAt)}
            </p>
          </div>
          <StatusChip label={style.label} chip={style.chip} />
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          <Metric icon={Building2} label="PGs" value={String(lead.pgCount)} />
          <Metric icon={Bed} label="Beds" value={lead.bedCount ? String(lead.bedCount) : '—'} />
          <Metric
            icon={MapPin}
            label="Type"
            value={
              lead.pgTypes === 'BOTH'
                ? 'Both'
                : lead.pgTypes === 'MENS'
                  ? "Men's"
                  : lead.pgTypes === 'WOMENS'
                    ? "Women's"
                    : '—'
            }
          />
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
              <a href={`/admin/organizations/${lead.convertedOrgId}`}>
                <Building2 className="size-3.5" />
                Open client
              </a>
            </Button>
          ) : (
            <CreateClientDialog
              trigger="Convert to client"
              triggerVariant="outline"
              triggerSize="sm"
              title={`Convert ${lead.name} to a client`}
              endpoint="/api/admin/leads"
              payload={{ action: 'CONVERT', leadId: lead.id }}
              defaults={{
                orgName: lead.pgName ?? '',
                ownerName: lead.name,
                email: lead.email ?? '',
                phone: lead.whatsapp || lead.phone,
                city: lead.city ?? '',
              }}
            />
          )}
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
                  <Detail label="Managing with" value={lead.currentMethod} />
                  <Detail label="Source" value={lead.source} />
                  <Detail
                    label="Last contacted"
                    value={lead.lastContactedAt ? formatDate(lead.lastContactedAt) : 'Not yet'}
                  />
                  {lead.demoAt && (
                    <Detail label="Demo" value={formatDate(lead.demoAt)} />
                  )}
                </dl>

                {lead.message && (
                  <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      What they said
                    </p>
                    <p className="mt-1 text-sm text-slate-700">{lead.message}</p>
                  </div>
                )}

                {lead.notes.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Notes
                    </p>
                    {lead.notes.map((n) => (
                      <div key={n.id} className="rounded-lg bg-slate-50 px-3 py-2">
                        <p className="text-sm text-slate-700">{n.body}</p>
                        <p className="mt-0.5 text-[11px] text-slate-400">
                          {n.authorName} · {relativeTime(n.createdAt)}
                        </p>
                      </div>
                    ))}
                  </div>
                )}

                <div className="space-y-2">
                  <Textarea
                    rows={2}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Add a note from your call…"
                  />
                  <div className="flex items-center gap-2">
                    <Select
                      value={lead.status}
                      onChange={(e) => update({ status: e.target.value, note: note || undefined })}
                      disabled={busy}
                      className="flex-1"
                    >
                      {STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {LEAD_STATUS_STYLE[s].label}
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
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {lead.demoAt && !expanded && (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-amber-600">
            <CalendarClock className="size-3.5" />
            Demo {formatDate(lead.demoAt)}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

function Metric({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType
  label: string
  value: string
}) {
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
      <dd className="text-sm capitalize text-slate-800">{value || '—'}</dd>
    </div>
  )
}
