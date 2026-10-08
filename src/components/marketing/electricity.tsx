'use client'

import { motion, useReducedMotion } from 'framer-motion'
import { Camera, Gauge, Lock, Zap } from 'lucide-react'
import { cn } from '@/lib/utils'
import { BrowserFrame, FeatureSection, Pill } from './kit'

/*
 * Sample data, clearly labelled on the visual. The numbers add up exactly:
 *   1,340 − 1,250 = 90 units × ₹13 = ₹1,170 for the room.
 *   30-day period. Arjun 30 days, Priya 30 days, Karthik joined on day 16 → 15 days.
 *   Person-days: 30 + 30 + 15 = 75.
 *   Arjun 1,170 × 30/75 = ₹468 · Priya ₹468 · Karthik 1,170 × 15/75 = ₹234 → 468 + 468 + 234 = ₹1,170.
 *   Bed D was empty all month, so it pays nothing.
 */
const PREVIOUS = 1250
const CURRENT = 1340
const RATE = 13
const PERIOD_DAYS = 30
const SHARES = [
  { name: 'Arjun', bed: 'A', days: 30, share: 468 },
  { name: 'Priya', bed: 'B', days: 30, share: 468 },
  { name: 'Karthik', bed: 'C', days: 15, share: 234, note: 'joined day 16' },
]
const UNITS = CURRENT - PREVIOUS
const BILL = UNITS * RATE

const inr = (n: number) => `₹${new Intl.NumberFormat('en-IN').format(n)}`

export function ElectricitySection() {
  return (
    <FeatureSection
      id="electricity"
      eyebrow="Electricity"
      icon={Zap}
      reverse
      className="bg-slate-50/70"
      title="Electricity, split fairly. By the people who actually lived there."
      problem="One EB bill, a calculator and an argument every month. Someone who moved in last week pays the same as everyone else, and empty beds get counted anyway."
      solution="Each room has its own meter. Enter the reading, and StayFlow multiplies the units by that month’s rate and splits the room’s bill by the days each resident actually stayed. Their share lands on the rent invoice by itself."
      benefits={[
        'Every room’s own meter',
        'A rate per month; old bills never change',
        'Split by people who lived there, never by beds',
        'Added to the rent invoice automatically',
        'Wardens enter readings with a photo',
        'Fair share at checkout, to the day',
      ]}
      visual={<ElectricityVisual />}
    />
  )
}

export function ElectricityVisual() {
  const reduce = useReducedMotion()
  const rise = (delay: number) =>
    reduce
      ? {}
      : {
          initial: { opacity: 0.85, y: 6 },
          whileInView: { opacity: 1, y: 0 },
          viewport: { once: true },
          transition: { delay, duration: 0.35 },
        }

  return (
    <div className="relative">
      <BrowserFrame title="Electricity · October">
        <div className="space-y-3 p-3 sm:p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-slate-900">Room 204 · meter MTR-204</p>
            <Pill tone="neutral" dot={false}>
              Sample data
            </Pill>
          </div>

          {/* Meter: previous → current */}
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 rounded-xl border border-slate-100 bg-slate-50/60 p-3">
            <Reading label="Last month" value={PREVIOUS} />
            <span className="text-slate-300">→</span>
            <Reading label="This month" value={CURRENT} highlight />
          </div>

          {/* The working */}
          <motion.div {...rise(0.05)} className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-blue-100 bg-blue-50/50 px-3 py-2.5 text-xs text-slate-700">
            <Gauge className="size-3.5 text-blue-600" aria-hidden />
            <span className="font-semibold tabular-nums text-slate-900">{UNITS} units</span>
            <span>×</span>
            <span className="tabular-nums">{inr(RATE)} / unit</span>
            <span>=</span>
            <span className="font-display text-sm font-bold tabular-nums text-slate-900">{inr(BILL)}</span>
          </motion.div>

          {/* Who pays */}
          <div className="divide-y divide-slate-100 rounded-xl border border-slate-100">
            {SHARES.map((s, i) => (
              <motion.div key={s.name} {...rise(0.1 + i * 0.06)} className="flex items-center gap-3 px-3 py-2">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-blue-50 text-[10px] font-semibold text-blue-700 ring-1 ring-blue-100">
                  {s.name.slice(0, 1)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-semibold text-slate-900">
                    {s.name} <span className="font-normal text-slate-400">· bed {s.bed}</span>
                  </span>
                  <span className="mt-1 flex items-center gap-2">
                    <span className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-100">
                      <span className="block h-full rounded-full bg-blue-600" style={{ width: `${(s.days / PERIOD_DAYS) * 100}%` }} />
                    </span>
                    <span className="text-[10px] text-slate-500">
                      {s.days} of {PERIOD_DAYS} days{s.note ? ` · ${s.note}` : ''}
                    </span>
                  </span>
                </span>
                <span className="font-display text-sm font-bold tabular-nums text-slate-900">{inr(s.share)}</span>
              </motion.div>
            ))}
            <motion.div {...rise(0.3)} className="flex items-center gap-3 px-3 py-2 text-slate-400">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-dashed border-slate-300 text-[10px]">D</span>
              <span className="flex-1 text-xs">Bed D · empty all month</span>
              <span className="text-sm font-semibold tabular-nums">{inr(0)}</span>
            </motion.div>
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-slate-100 pt-2 text-[11px]">
            <span className="flex items-center gap-1 text-slate-500">
              <Lock className="size-3" aria-hidden /> Rate saved with the bill
            </span>
            <span className="font-medium text-slate-700">
              Total <span className="tabular-nums text-slate-900">{inr(SHARES.reduce((sum, s) => sum + s.share, 0))}</span>
            </span>
          </div>
        </div>
      </BrowserFrame>

      <motion.div
        {...rise(0.4)}
        className="relative mx-3 -mt-4 flex max-w-[240px] items-center gap-2 rounded-xl border border-slate-200 bg-white p-2.5 text-[11px] text-slate-700 shadow-lift sm:absolute sm:-bottom-16 sm:-left-6 sm:mx-0 sm:mt-0"
      >
        <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
          <Camera className="size-3.5" aria-hidden />
        </span>
        <span>
          <span className="block font-semibold text-slate-900">Reading with photo</span>
          <span className="block text-slate-500">Entered by the warden, 8:40 AM</span>
        </span>
      </motion.div>
    </div>
  )
}

function Reading({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className="min-w-0 text-center">
      <p className="text-[10px] text-slate-500">{label}</p>
      <p
        className={cn(
          'mt-0.5 inline-block rounded-md px-2 py-0.5 font-mono text-base font-semibold tabular-nums tracking-wider',
          highlight ? 'bg-slate-900 text-white' : 'bg-white text-slate-700 ring-1 ring-slate-200',
        )}
      >
        {new Intl.NumberFormat('en-IN').format(value)}
      </p>
    </div>
  )
}
