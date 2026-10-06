'use client'

import * as React from 'react'
import { AnimatePresence, LayoutGroup, motion, useInView, useReducedMotion } from 'framer-motion'
import { BellRing, CheckCheck, FileCheck2, Phone, Search, ShieldCheck } from 'lucide-react'
import { cn } from '@/lib/utils'
import { BED_STYLES, BrowserFrame, Pill, useCycle, type BedState, type Tone } from './kit'

/** Shared: run a looping cycle only while the visual is on screen and motion is allowed. */
function useLiveCycle(length: number, interval: number) {
  const ref = React.useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { margin: '-15% 0px' })
  const reduce = useReducedMotion()
  const index = useCycle(length, interval, inView && !reduce)
  return { ref, index, reduce }
}

// --------------------------------------------------------------- Beds ----

const FLOOR: { room: string; beds: BedState[] }[] = [
  { room: '201', beds: ['occupied', 'occupied', 'available'] },
  { room: '202', beds: ['occupied', 'reserved'] },
  { room: '203', beds: ['occupied', 'occupied', 'occupied'] },
  { room: '204', beds: ['available', 'occupied'] },
  { room: '205', beds: ['maintenance', 'occupied', 'occupied'] },
  { room: '206', beds: ['blocked', 'occupied'] },
]
const LIVE_BED: BedState[] = ['available', 'reserved', 'occupied']

export function BedsVisual() {
  const { ref, index } = useLiveCycle(LIVE_BED.length, 1800)
  const live = LIVE_BED[index]
  const states: BedState[] = ['available', 'reserved', 'occupied', 'maintenance', 'blocked']

  return (
    <div ref={ref}>
      <BrowserFrame title="Beds · Floor 2">
        <div className="p-3 sm:p-4">
          <div className="flex flex-wrap gap-1.5">
            {states.map((s) => (
              <Pill key={s} tone={BED_STYLES[s].tone}>
                {BED_STYLES[s].label}
              </Pill>
            ))}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {FLOOR.map((room, r) => (
              <div key={room.room} className="min-w-0 rounded-xl border border-slate-100 bg-slate-50/60 p-2">
                <p className="text-[10px] font-semibold text-slate-500">Room {room.room}</p>
                <div className="mt-1.5 flex gap-1">
                  {room.beds.map((bed, b) => {
                    const isLive = r === 3 && b === 0
                    const state = isLive ? live : bed
                    return (
                      <motion.span
                        key={b}
                        layout
                        animate={isLive ? { scale: [1, 1.12, 1] } : undefined}
                        transition={{ duration: 0.45 }}
                        className={cn(
                          'flex h-8 flex-1 items-center justify-center rounded-md border text-[9px] font-bold transition-colors duration-500',
                          BED_STYLES[state].tile,
                          isLive && 'ring-2 ring-blue-400/50 ring-offset-1',
                        )}
                      >
                        {String.fromCharCode(65 + b)}
                      </motion.span>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-between rounded-xl bg-slate-900 px-3 py-2 text-white">
            <span className="text-[11px] text-white/70">Bed 204-A</span>
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={live}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                className="text-[11px] font-semibold"
              >
                {live === 'available' ? 'Available — listed for enquiries' : live === 'reserved' ? 'Reserved · advance ₹5,000' : 'Occupied · Arjun Kumar'}
              </motion.span>
            </AnimatePresence>
          </div>
        </div>
      </BrowserFrame>
    </div>
  )
}

// ---------------------------------------------------------- Residents ----

const RESIDENTS = [
  { name: 'Arjun Kumar', room: '204-A', since: 'Nov 2025', rent: 'Paid', tone: 'green' as Tone, kyc: true },
  { name: 'Priya Sharma', room: '108-B', since: 'Jun 2025', rent: 'Due', tone: 'amber' as Tone, kyc: true },
  { name: 'Karthik R', room: '112-A', since: 'Feb 2026', rent: 'Overdue', tone: 'red' as Tone, kyc: false },
  { name: 'Meena Iyer', room: '301-A', since: 'Aug 2024', rent: 'Paid', tone: 'green' as Tone, kyc: true },
]

export function ResidentsVisual() {
  const { ref, index } = useLiveCycle(RESIDENTS.length, 2200)
  const selected = RESIDENTS[index]

  return (
    <div ref={ref} className="relative">
      <BrowserFrame title="Residents">
        <div className="p-3 sm:p-4">
          <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] text-slate-400">
            <Search className="size-3.5" />
            Search name, room or phone
          </div>
          <div className="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-100">
            {RESIDENTS.map((r, i) => (
              <div
                key={r.name}
                className={cn('flex items-center gap-2.5 px-2.5 py-2 transition-colors duration-300', i === index && 'bg-blue-50/70')}
              >
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-violet-500 text-[10px] font-bold text-white">
                  {r.name.split(' ').map((p) => p[0]).join('')}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-semibold text-slate-900">{r.name}</span>
                  <span className="block text-[10px] text-slate-500">
                    {r.room} · since {r.since}
                  </span>
                </span>
                <Pill tone={r.tone}>{r.rent}</Pill>
              </div>
            ))}
          </div>
        </div>
      </BrowserFrame>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={selected.name}
          initial={{ opacity: 0, x: 16 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -8 }}
          transition={{ duration: 0.35 }}
          className="glass relative mx-3 -mt-6 rounded-2xl p-3 shadow-lift sm:absolute sm:-bottom-8 sm:-right-6 sm:mx-0 sm:mt-0 sm:w-60"
        >
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Profile</p>
          <p className="font-display text-sm font-bold text-slate-900">{selected.name}</p>
          <div className="mt-2 space-y-1 text-[11px] text-slate-600">
            <p className="flex items-center gap-1.5">
              <Phone className="size-3" /> 98400 •• •••
            </p>
            <p className="flex items-center gap-1.5">
              {selected.kyc ? <ShieldCheck className="size-3 text-emerald-600" /> : <FileCheck2 className="size-3 text-amber-600" />}
              {selected.kyc ? 'KYC verified · Aadhaar on file' : 'KYC pending · reminder sent'}
            </p>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

// --------------------------------------------------------------- Rent ----

const INVOICES = [
  { name: 'Arjun · 204-A', amount: '₹9,000', flow: ['Due', 'Paid'] },
  { name: 'Priya · 108-B', amount: '₹8,500', flow: ['Due', 'Due'] },
  { name: 'Karthik · 112-A', amount: '₹7,500', flow: ['Overdue', 'Overdue'] },
  { name: 'Meena · 301-A', amount: '₹9,500', flow: ['Paid', 'Paid'] },
]
const STATUS_TONE: Record<string, Tone> = { Paid: 'green', Due: 'amber', Overdue: 'red' }

export function RentVisual() {
  const { ref, index, reduce } = useLiveCycle(2, 2600)
  const phase = reduce ? 1 : index
  const collected = phase ? 78 : 64

  return (
    <div ref={ref} className="relative">
      <BrowserFrame title="Rent · November">
        <div className="grid gap-3 p-3 sm:grid-cols-[120px_1fr] sm:p-4">
          <div className="flex flex-row items-center gap-3 rounded-xl border border-slate-100 p-3 sm:flex-col sm:justify-center">
            <svg viewBox="0 0 36 36" className="size-16 shrink-0 -rotate-90 sm:size-20">
              <circle cx="18" cy="18" r="15.9" fill="none" stroke="#f4f4f2" strokeWidth="3.5" />
              <motion.circle
                cx="18"
                cy="18"
                r="15.9"
                fill="none"
                stroke="#10b981"
                strokeWidth="3.5"
                strokeLinecap="round"
                strokeDasharray="100 100"
                animate={{ strokeDashoffset: 100 - collected }}
                transition={{ duration: 0.9 }}
              />
            </svg>
            <div className="sm:text-center">
              <p className="font-display text-lg font-bold text-slate-900 tabular">{collected}%</p>
              <p className="text-[10px] text-slate-500">collected</p>
            </div>
          </div>
          <div className="min-w-0 divide-y divide-slate-100 rounded-xl border border-slate-100">
            {INVOICES.map((inv) => {
              const status = inv.flow[phase]
              return (
                <div key={inv.name} className="flex items-center justify-between gap-2 px-2.5 py-2">
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-semibold text-slate-800">{inv.name}</span>
                    <span className="block text-[10px] text-slate-500 tabular">{inv.amount}</span>
                  </span>
                  <AnimatePresence mode="wait" initial={false}>
                    <motion.span key={status} initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}>
                      <Pill tone={STATUS_TONE[status]}>{status}</Pill>
                    </motion.span>
                  </AnimatePresence>
                </div>
              )
            })}
          </div>
        </div>
      </BrowserFrame>

      <motion.div
        initial={reduce ? false : { opacity: 0, y: 12 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ delay: 0.4 }}
        className="relative mx-3 -mt-5 max-w-[260px] rounded-2xl rounded-tl-sm bg-[#dcf8c6] p-3 text-[11px] leading-relaxed text-slate-800 shadow-lift sm:absolute sm:-bottom-10 sm:-left-6 sm:mx-0 sm:mt-0"
      >
        <p className="flex items-center gap-1 text-[10px] font-semibold text-emerald-800">
          <BellRing className="size-3" /> Rent reminder
        </p>
        Hi Priya, your November rent of ₹8,500 is due on 5 Nov. Pay by UPI from your StayFlow app.
        <span className="mt-1 flex items-center justify-end gap-1 text-[9px] text-slate-500">
          9:00 AM <CheckCheck className="size-3 text-sky-500" />
        </span>
      </motion.div>
    </div>
  )
}

// ----------------------------------------------------------- Enquiries ----

const COLUMNS = ['New', 'Visit', 'Booked'] as const
const LEADS = [
  { name: 'Rahul M.', want: 'Single · ₹10–12K' },
  { name: 'Sneha P.', want: '2-sharing · from 1 Dec' },
  { name: 'Vikram S.', want: '3-sharing · near metro' },
]

export function EnquiriesVisual() {
  const { ref, index } = useLiveCycle(COLUMNS.length, 2000)
  // Rahul's card travels New → Visit → Booked; the others stay put.
  const where = [index, 1, 0]

  return (
    <div ref={ref}>
      <BrowserFrame title="Enquiries & bookings">
        <LayoutGroup>
          <div className="grid grid-cols-3 gap-2 p-3 sm:p-4">
            {COLUMNS.map((col, c) => (
              <div key={col} className="min-w-0 rounded-xl bg-slate-50 p-1.5 sm:p-2">
                <p className="mb-1.5 flex items-center justify-between px-1 text-[10px] font-semibold text-slate-500">
                  {col}
                  <span className="rounded bg-white px-1 text-slate-400">{where.filter((w) => w === c).length}</span>
                </p>
                <div className="min-h-[120px] space-y-1.5">
                  {LEADS.map((lead, i) =>
                    where[i] === c ? (
                      <motion.div
                        key={lead.name}
                        layoutId={`lead-${lead.name}`}
                        transition={{ type: 'spring', stiffness: 300, damping: 28 }}
                        className={cn(
                          'rounded-lg border bg-white p-1.5 shadow-soft sm:p-2',
                          i === 0 ? 'border-blue-200 ring-2 ring-blue-400/20' : 'border-slate-100',
                        )}
                      >
                        <p className="truncate text-[10px] font-semibold text-slate-800 sm:text-[11px]">{lead.name}</p>
                        <p className="truncate text-[9px] text-slate-500">{lead.want}</p>
                        {i === 0 && c === 2 && (
                          <span className="mt-1 inline-block">
                            <Pill tone="blue">Bed 204-A</Pill>
                          </span>
                        )}
                      </motion.div>
                    ) : null,
                  )}
                </div>
              </div>
            ))}
          </div>
        </LayoutGroup>
      </BrowserFrame>
    </div>
  )
}
