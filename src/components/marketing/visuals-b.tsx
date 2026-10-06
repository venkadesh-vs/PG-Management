'use client'

import * as React from 'react'
import { AnimatePresence, motion, useInView, useReducedMotion } from 'framer-motion'
import {
  Bell,
  ChevronRight,
  Coffee,
  IndianRupee,
  Megaphone,
  Moon,
  Package,
  Soup,
  Sparkles,
  TrendingDown,
  Wrench,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { BrowserFrame, PhoneFrame, Pill, useCycle, type Tone } from './kit'

function useLiveCycle(length: number, interval: number) {
  const ref = React.useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { margin: '-15% 0px' })
  const reduce = useReducedMotion()
  const index = useCycle(length, interval, inView && !reduce)
  return { ref, index, reduce, inView }
}

// --------------------------------------------------------------- Food ----

const MEALS = [
  { name: 'Breakfast', icon: Coffee, menu: 'Idli, sambar, chutney', counts: [38, 41] },
  { name: 'Lunch', icon: Soup, menu: 'Rice, dal, poriyal, curd', counts: [24, 22] },
  { name: 'Dinner', icon: Moon, menu: 'Chapati, paneer butter masala', counts: [40, 43] },
]

export function FoodVisual() {
  const { ref, index, reduce } = useLiveCycle(2, 2400)
  const phase = reduce ? 1 : index

  return (
    <div ref={ref}>
      <BrowserFrame title="Food · Today">
        <div className="space-y-2 p-3 sm:p-4">
          {MEALS.map((meal) => {
            const Icon = meal.icon
            const count = meal.counts[phase]
            return (
              <div key={meal.name} className="flex items-center gap-3 rounded-xl border border-slate-100 p-2.5">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-orange-50 text-orange-600">
                  <Icon className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-slate-900">{meal.name}</p>
                  <p className="truncate text-[10px] text-slate-500">{meal.menu}</p>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <motion.div
                      className="h-full rounded-full bg-gradient-to-r from-orange-400 to-marigold-500"
                      animate={{ width: `${(count / 48) * 100}%` }}
                      transition={{ duration: 0.8 }}
                    />
                  </div>
                </div>
                <div className="text-right">
                  <AnimatePresence mode="wait" initial={false}>
                    <motion.p
                      key={count}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -6 }}
                      className="font-display text-lg font-bold text-slate-900 tabular"
                    >
                      {count}
                    </motion.p>
                  </AnimatePresence>
                  <p className="text-[9px] text-slate-400">plates</p>
                </div>
              </div>
            )
          })}
          <div className="flex items-center gap-2 rounded-xl bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
            <Package className="size-3.5 shrink-0" />
            <span className="min-w-0 flex-1 truncate">Low stock: toor dal (2 kg), cooking oil (1 L)</span>
            <span className="shrink-0 font-semibold">Add to list</span>
          </div>
        </div>
      </BrowserFrame>
    </div>
  )
}

// ---------------------------------------------------------- Complaints ----

const FLOW: { label: string; tone: Tone }[] = [
  { label: 'OPEN', tone: 'red' },
  { label: 'ASSIGNED', tone: 'blue' },
  { label: 'IN PROGRESS', tone: 'amber' },
  { label: 'RESOLVED', tone: 'green' },
]

export function ComplaintsVisual() {
  const { ref, index } = useLiveCycle(FLOW.length, 1700)
  const status = FLOW[index]

  return (
    <div ref={ref} className="flex flex-col items-center gap-6 sm:flex-row sm:items-end">
      <BrowserFrame title="Complaints" className="w-full sm:flex-1">
        <div className="space-y-2 p-3 sm:p-4">
          {[
            { t: 'Fan not working', r: 'Room 204 · Electrical', s: status, live: true },
            { t: 'Water leakage in bathroom', r: 'Room 112 · Plumbing', s: FLOW[2] },
            { t: 'Wi-Fi slow on floor 3', r: 'Floor 3 · Internet', s: FLOW[3] },
          ].map((c) => (
            <div
              key={c.t}
              className={cn('flex items-center gap-2 rounded-xl border p-2.5', c.live ? 'border-blue-200 bg-blue-50/40' : 'border-slate-100')}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-semibold text-slate-900">{c.t}</span>
                <span className="block truncate text-[10px] text-slate-500">{c.r}</span>
              </span>
              <AnimatePresence mode="wait" initial={false}>
                <motion.span key={c.s.label} initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}>
                  <Pill tone={c.s.tone}>{c.s.label}</Pill>
                </motion.span>
              </AnimatePresence>
            </div>
          ))}
          <div className="flex items-center gap-1 pt-1">
            {FLOW.map((f, i) => (
              <span key={f.label} className={cn('h-1 flex-1 rounded-full transition-colors duration-500', i <= index ? 'bg-blue-500' : 'bg-slate-200')} />
            ))}
          </div>
        </div>
      </BrowserFrame>

      <PhoneFrame className="w-[200px] sm:-mb-6">
        <div className="bg-gradient-to-b from-slate-900 to-slate-800 px-3 pb-3 pt-7 text-white">
          <p className="text-[9px] text-white/50">Worker app · Ravi</p>
          <p className="font-display text-sm font-bold">My tasks</p>
        </div>
        <div className="space-y-2 p-2.5">
          <div className="rounded-xl border border-slate-200 bg-white p-2.5">
            <p className="flex items-center gap-1 text-[10px] font-semibold text-slate-800">
              <Wrench className="size-3 text-blue-600" /> Fan not working
            </p>
            <p className="text-[9px] text-slate-500">Room 204 · raised 10:12 AM</p>
            <div
              className={cn(
                'mt-2 rounded-lg py-1.5 text-center text-[10px] font-semibold text-white transition-colors duration-500',
                index >= 3 ? 'bg-emerald-500' : index === 2 ? 'bg-amber-500' : 'bg-blue-600',
              )}
            >
              {index >= 3 ? 'Done · photo added' : index === 2 ? 'Mark resolved' : 'Start work'}
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-2.5 opacity-60">
            <p className="text-[10px] font-semibold text-slate-800">Clean water tank</p>
            <p className="text-[9px] text-slate-500">Daily · 4:00 PM</p>
          </div>
        </div>
      </PhoneFrame>
    </div>
  )
}

// ------------------------------------------------------------ Revenue ----

const FLOORS = [
  { name: 'Ground', vacant: 1, loss: 9000 },
  { name: 'Floor 1', vacant: 0, loss: 0 },
  { name: 'Floor 2', vacant: 3, loss: 25500 },
  { name: 'Floor 3', vacant: 1, loss: 8000 },
]

export function RevenueVisual() {
  const { ref, inView, reduce } = useLiveCycle(1, 1000)
  const total = FLOORS.reduce((s, f) => s + f.loss, 0)
  const [shown, setShown] = React.useState(reduce ? total : 0)

  React.useEffect(() => {
    if (reduce || !inView) {
      if (reduce) setShown(total)
      return
    }
    let frame = 0
    const start = performance.now()
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / 1400)
      setShown(Math.round(total * (1 - Math.pow(1 - t, 3))))
      if (t < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [inView, reduce, total])

  return (
    <div ref={ref}>
      <BrowserFrame title="Revenue intelligence">
        <div className="p-3 sm:p-4">
          <div className="rounded-2xl border border-amber-100 bg-gradient-to-br from-amber-50 to-white p-4">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-800">
              <TrendingDown className="size-3.5" /> Vacancy loss
            </p>
            <p className="mt-1 text-xs text-slate-600">You are losing approximately</p>
            <p className="font-display text-3xl font-extrabold tracking-tight text-amber-700 tabular">
              ₹{new Intl.NumberFormat('en-IN').format(shown)}
              <span className="text-sm font-semibold text-amber-600">/month</span>
            </p>
            <p className="text-xs text-slate-600">from 5 vacant beds.</p>
          </div>
          <div className="mt-3 space-y-2">
            {FLOORS.map((f) => (
              <div key={f.name} className="flex items-center gap-2 text-[11px]">
                <span className="w-14 shrink-0 text-slate-500">{f.name}</span>
                <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-slate-100">
                  <motion.div
                    className="h-full rounded-full bg-gradient-to-r from-amber-400 to-red-400"
                    initial={reduce ? false : { width: 0 }}
                    whileInView={{ width: `${(f.loss / 25500) * 100}%` }}
                    viewport={{ once: true }}
                    transition={{ duration: 1, delay: 0.2 }}
                  />
                </div>
                <span className="w-16 shrink-0 text-right font-semibold text-slate-700 tabular">
                  {f.loss ? `₹${new Intl.NumberFormat('en-IN').format(f.loss)}` : '—'}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-2 rounded-xl border border-dashed border-violet-200 bg-violet-50/50 px-3 py-2 text-[11px] text-violet-800">
            <Sparkles className="size-3.5 shrink-0" />
            <span className="min-w-0 flex-1">AI daily brief</span>
            <span className="shrink-0 rounded-full bg-violet-100 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide">Coming soon</span>
          </div>
        </div>
      </BrowserFrame>
    </div>
  )
}

// -------------------------------------------------------- Resident app ----

export function ResidentAppVisual() {
  const { ref, index, reduce } = useLiveCycle(2, 2600)
  const paid = reduce ? true : index === 1

  return (
    <div ref={ref} className="relative flex justify-center">
      <div className="absolute inset-x-10 top-10 -z-10 h-64 rounded-full bg-violet-300/30 blur-3xl" />
      <PhoneFrame>
        <div className="bg-gradient-to-br from-blue-600 to-violet-600 px-4 pb-5 pt-8 text-white">
          <div className="flex items-center justify-between">
            <p className="text-[10px] text-white/70">Sree Balaji PG · 204-A</p>
            <Bell className="size-3.5 text-white/80" />
          </div>
          <p className="mt-1 font-display text-base font-bold">Hi Arjun 👋</p>
          <div className="mt-3 rounded-2xl bg-white/15 p-3 backdrop-blur">
            <p className="text-[10px] text-white/70">November rent</p>
            <div className="flex items-center justify-between">
              <p className="font-display text-xl font-bold tabular">₹9,000</p>
              <AnimatePresence mode="wait" initial={false}>
                <motion.span key={String(paid)} initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}>
                  <span className={cn('rounded-full px-2 py-0.5 text-[9px] font-bold', paid ? 'bg-emerald-400 text-emerald-950' : 'bg-amber-300 text-amber-950')}>
                    {paid ? 'PAID' : 'DUE 5 NOV'}
                  </span>
                </motion.span>
              </AnimatePresence>
            </div>
            <div className={cn('mt-2 flex items-center justify-center gap-1 rounded-xl py-1.5 text-[10px] font-semibold transition-colors duration-500', paid ? 'bg-white/20 text-white' : 'bg-white text-blue-700')}>
              <IndianRupee className="size-3" />
              {paid ? 'Download receipt' : 'Pay with UPI'}
            </div>
          </div>
        </div>
        <div className="space-y-2 p-3">
          {[
            { icon: Soup, label: "Today's menu", sub: 'Chapati, paneer masala' },
            { icon: Wrench, label: 'Raise a complaint', sub: 'Track it till resolved' },
            { icon: Megaphone, label: 'Notices', sub: 'Water off 2–4 PM Sunday' },
          ].map(({ icon: Icon, label, sub }) => (
            <div key={label} className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-white p-2.5">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                <Icon className="size-3.5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[11px] font-semibold text-slate-800">{label}</span>
                <span className="block truncate text-[9px] text-slate-500">{sub}</span>
              </span>
              <ChevronRight className="size-3 text-slate-300" />
            </div>
          ))}
        </div>
      </PhoneFrame>
    </div>
  )
}
