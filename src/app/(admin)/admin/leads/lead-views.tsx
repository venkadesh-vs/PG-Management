'use client'

import * as React from 'react'
import Link from 'next/link'
import { Bed, Building2, CalendarClock } from 'lucide-react'
import { cn, formatDate, formatDateTime, formatPhone, relativeTime } from '@/lib/utils'
import { StatusChip } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableWrap,
} from '@/components/ui/table'
import { FollowUpChip, LeadCard, type CrmLead } from './lead-card'
import type { AdminOption } from './lead-edit-dialog'
import { LEAD_PIPELINE, LEAD_SIDE, leadStyle } from './lead-meta'

type ViewProps = { leads: CrmLead[]; admins: AdminOption[]; currentAdminId: string }

/** Opens the full lead card (notes, stage, convert) in a dialog. */
function useLeadDialog(props: ViewProps) {
  const [openId, setOpenId] = React.useState<string | null>(null)
  const lead = props.leads.find((l) => l.id === openId) ?? null
  const dialog = (
    <Dialog open={Boolean(lead)} onOpenChange={(o) => !o && setOpenId(null)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        {lead && (
          <>
            <DialogHeader>
              <DialogTitle className="sr-only">{lead.name}</DialogTitle>
              <DialogDescription className="sr-only">Lead details, notes and actions</DialogDescription>
            </DialogHeader>
            <LeadCard lead={lead} admins={props.admins} currentAdminId={props.currentAdminId} defaultExpanded bare />
          </>
        )}
      </DialogContent>
    </Dialog>
  )
  return { open: setOpenId, dialog }
}

/** Kanban of the pipeline; side lanes (follow up later, lost, not a fit) at the end. */
export function LeadBoard(props: ViewProps) {
  const { open, dialog } = useLeadDialog(props)
  const columns = [...LEAD_PIPELINE, ...LEAD_SIDE]
  return (
    <>
      <div className="-mx-4 snap-x snap-mandatory overflow-x-auto overscroll-x-contain px-4 pb-3 [scrollbar-width:thin] sm:mx-0 sm:snap-none sm:px-0">
        <div className="flex items-start gap-3" style={{ minWidth: `${columns.length * 16}rem` }}>
          {columns.map((status) => {
            const items = props.leads.filter((l) => l.status === status)
            const style = leadStyle(status)
            return (
              <section
                key={status}
                className="flex w-64 shrink-0 snap-start flex-col rounded-2xl border border-slate-200/70 bg-slate-100/60 p-2"
              >
                <header className="flex items-center justify-between gap-2 px-2 pb-1.5 pt-1">
                  <span className="flex min-w-0 items-center gap-2 text-xs font-semibold text-slate-700">
                    <span className={cn('size-2 shrink-0 rounded-full ring-2 ring-white', style.dot)} />
                    <span className="truncate">{style.label}</span>
                  </span>
                  <span className="min-w-6 rounded-full bg-white px-2 py-0.5 text-center text-[11px] font-semibold text-slate-600 shadow-xs ring-1 ring-inset ring-slate-200/80 tabular">
                    {items.length}
                  </span>
                </header>
                <ul className="mt-1 space-y-2">
                  {items.length === 0 && (
                    <li className="rounded-xl border border-dashed border-slate-300/70 px-3 py-6 text-center text-[11px] text-slate-400">
                      No leads in this stage
                    </li>
                  )}
                  {items.map((lead) => (
                    <li key={lead.id}>
                      <button
                        type="button"
                        onClick={() => open(lead.id)}
                        className="w-full rounded-xl border border-slate-200/80 bg-white p-3.5 text-left shadow-card transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-lift focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
                      >
                        <p className="truncate text-sm font-semibold text-slate-900">{lead.name}</p>
                        <p className="truncate text-xs text-slate-500">
                          {lead.pgName ?? 'PG'}
                          {lead.city ? ` · ${lead.city}` : ''}
                        </p>
                        <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-slate-100 pt-2.5 text-[11px] text-slate-500">
                          <span className="inline-flex items-center gap-1">
                            <Bed className="size-3" />
                            {lead.bedCount ?? '—'}
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <Building2 className="size-3" />
                            {lead.pgCount}
                          </span>
                          <span className="ml-auto">{relativeTime(lead.createdAt)}</span>
                        </div>
                        {lead.status === 'DEMO_SCHEDULED' && lead.demoAt && (
                          <p className="mt-1.5 flex items-center gap-1 text-[11px] text-amber-700">
                            <CalendarClock className="size-3" />
                            {formatDateTime(lead.demoAt)}
                          </p>
                        )}
                        <FollowUpChip lead={lead} className="mt-1.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )
          })}
        </div>
      </div>
      {dialog}
    </>
  )
}

export function LeadTable(props: ViewProps) {
  const { open, dialog } = useLeadDialog(props)
  const ownerName = (id: string | null) => props.admins.find((a) => a.id === id)?.name ?? '—'
  return (
    <>
      <TableWrap className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Lead</TableHead>
              <TableHead>City</TableHead>
              <TableHead className="text-right">Beds</TableHead>
              <TableHead>Stage</TableHead>
              <TableHead>Follow-up</TableHead>
              <TableHead>Owner</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Added</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {props.leads.map((lead) => {
              const style = leadStyle(lead.status)
              return (
                <TableRow key={lead.id} className="cursor-pointer" onClick={() => open(lead.id)}>
                  <TableCell>
                    <p className="font-medium text-slate-900">{lead.name}</p>
                    <p className="text-xs text-slate-500">
                      {lead.pgName ?? 'PG'} · {formatPhone(lead.phone)}
                    </p>
                    {lead.convertedOrgId && (
                      <Link
                        href={`/admin/organizations/${lead.convertedOrgId}`}
                        onClick={(e) => e.stopPropagation()}
                        className="text-xs font-medium text-blue-600 hover:underline"
                      >
                        {lead.convertedOrgName ?? 'Open customer'}
                      </Link>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-slate-600">{lead.city ?? '—'}</TableCell>
                  <TableCell className="text-right tabular">{lead.bedCount ?? '—'}</TableCell>
                  <TableCell>
                    <StatusChip label={style.label} chip={style.chip} />
                  </TableCell>
                  <TableCell>
                    {lead.followUpAt ? (
                      <FollowUpChip lead={lead} />
                    ) : (
                      <span className="text-xs text-slate-400">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-slate-600">{ownerName(lead.salesOwnerId)}</TableCell>
                  <TableCell className="text-sm capitalize text-slate-600">{lead.source}</TableCell>
                  <TableCell className="text-sm text-slate-600">{formatDate(lead.createdAt)}</TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </TableWrap>

      <ul className="space-y-2 md:hidden">
        {props.leads.map((lead) => {
          const style = leadStyle(lead.status)
          return (
            <li key={lead.id}>
              <button
                type="button"
                onClick={() => open(lead.id)}
                className="block w-full rounded-2xl border border-slate-200/80 bg-white p-4 text-left shadow-card transition active:scale-[0.99] hover:border-blue-200 hover:shadow-lift"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 truncate font-semibold text-slate-900">{lead.name}</p>
                  <StatusChip label={style.label} chip={style.chip} />
                </div>
                <p className="mt-0.5 truncate text-xs text-slate-500">
                  {lead.pgName ?? 'PG'} · {lead.city ?? '—'} · {lead.bedCount ?? '—'} beds
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <FollowUpChip lead={lead} />
                  <span>{ownerName(lead.salesOwnerId)}</span>
                </div>
              </button>
            </li>
          )
        })}
      </ul>
      {dialog}
    </>
  )
}
