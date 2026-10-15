'use client'

import { motion, useReducedMotion } from 'framer-motion'
import {
  BedDouble,
  CheckCircle2,
  Gift,
  IndianRupee,
  LineChart,
  Repeat,
  Smartphone,
  Users,
  UtensilsCrossed,
  Wrench,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Reveal } from '@/components/motion/reveal'
import { SectionHeading } from './kit'

/**
 * The homepage's one overview of the product: every main module as a card in
 * a bento grid. Detail lives in the app; the deep dives below cover only the
 * two signature features (rent collection and the electricity split).
 * Figures inside the cards are sample data.
 */

type Module = {
  icon: LucideIcon
  title: string
  text: string
  points: string[]
  wide?: boolean
  visual?: React.ReactNode
  tone?: 'light' | 'gold'
}

const inr = (n: number) => `₹${new Intl.NumberFormat('en-IN').format(n)}`

const MODULES: Module[] = [
  {
    icon: IndianRupee,
    title: 'Rent & AutoPay',
    text: 'Bills raise themselves every month, reminders go out on WhatsApp, and residents pay by UPI or AutoPay on their own salary day.',
    points: ['Auto invoices', 'UPI & AutoPay', 'Receipts & ledger'],
    wide: true,
    visual: <RentMini />,
  },
  {
    icon: BedDouble,
    title: 'Beds & rooms',
    text: 'Every floor, room and bed at a glance: who stays where, what is free and what is reserved.',
    points: ['Live bed map', 'AC / non-AC', '1–5 sharing'],
  },
  {
    icon: Users,
    title: 'Residents',
    text: 'Check-in to check-out in one profile: KYC, deposit, room moves, notice and final settlement.',
    points: ['KYC & documents', 'Deposits', 'Settlement'],
  },
  {
    icon: Zap,
    title: 'Electricity split',
    text: 'Enter each room’s meter reading. StayFlow splits the bill by the days each resident actually stayed and adds it to their rent.',
    points: ['Room meters', 'Split by days stayed', 'On the next bill'],
    wide: true,
    visual: <ElectricityMini />,
  },
  {
    icon: UtensilsCrossed,
    title: 'Food & kitchen',
    text: 'Residents choose food on or off; the cook sees exactly how many will eat, and stock keeps itself.',
    points: ['Live meal counts', 'Menu', 'Grocery stock'],
  },
  {
    icon: Wrench,
    title: 'Complaints & staff',
    text: 'Complaints go to the right worker’s app; staff log tasks, meter readings and expenses you approve.',
    points: ['Staff app', 'Tasks', 'Expenses'],
  },
  {
    icon: LineChart,
    title: 'Profit & reports',
    text: 'Collections, dues, expenses and profit for every PG on one screen, with vacancy loss in rupees.',
    points: ['Profit per PG', 'Dues', 'Exports'],
  },
  {
    icon: Smartphone,
    title: 'Resident app',
    text: 'Every resident gets their own app in the browser, no install: pay rent, raise complaints, choose food and see notices.',
    points: ['Pay by UPI', 'Complaints', 'Food & notices', 'Their own details'],
    wide: true,
    visual: <ResidentMini />,
  },
  {
    icon: Gift,
    title: 'Refer & earn',
    text: 'Bring another PG owner. When they pay their first month, your next month is half price.',
    points: [`${inr(8000)} → ${inr(4000)}`],
    tone: 'gold',
  },
]

export function ModulesSection() {
  return (
    <section id="modules" aria-labelledby="modules-title" className="relative bg-slate-50/70 py-20 sm:py-28">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <SectionHeading
          eyebrow="One app for the whole PG"
          title={<span id="modules-title">Everything your PG runs on. Nothing it doesn’t need.</span>}
          description="Owner dashboard, staff app and resident app, working from the same records."
        />

        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {MODULES.map((m, i) => (
            <Reveal key={m.title} delay={Math.min(i, 5) * 0.05} className={cn('min-w-0', m.wide && 'lg:col-span-2')}>
              <ModuleCard module={m} />
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}

function ModuleCard({ module: m }: { module: Module }) {
  const gold = m.tone === 'gold'
  const Icon = m.icon
  // A soft light follows the pointer across the card.
  function track(event: React.MouseEvent<HTMLElement>) {
    const box = event.currentTarget.getBoundingClientRect()
    event.currentTarget.style.setProperty('--x', `${event.clientX - box.left}px`)
    event.currentTarget.style.setProperty('--y', `${event.clientY - box.top}px`)
  }
  return (
    <article
      onMouseMove={track}
      className={cn(
        'group relative flex h-full flex-col overflow-hidden rounded-3xl p-6 transition duration-300 hover:-translate-y-0.5',
        gold
          ? 'bg-ink-950 text-white shadow-[0_24px_60px_-30px_rgb(11_16_26/0.8)] ring-1 ring-marigold-300/25'
          : 'bg-white shadow-[0_1px_2px_rgb(27_25_24/0.04),0_18px_40px_-28px_rgb(27_25_24/0.28)] ring-1 ring-slate-200/80 hover:ring-blue-200',
      )}
    >
      <div
        aria-hidden
        className={cn(
          'pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100',
          gold
            ? 'bg-[radial-gradient(360px_circle_at_var(--x)_var(--y),rgb(252_191_77/0.16),transparent_45%)]'
            : 'bg-[radial-gradient(360px_circle_at_var(--x)_var(--y),rgb(104_99_238/0.09),transparent_45%)]',
        )}
      />
      {gold && (
        <div aria-hidden className="pointer-events-none absolute -right-16 -top-16 size-48 animate-float-slow rounded-full bg-marigold-400/20 blur-3xl" />
      )}
      <div className={cn('relative flex min-w-0 flex-1 flex-col gap-5', m.visual && 'md:flex-row md:items-center')}>
        <div className="min-w-0 flex-1">
          <span
            className={cn(
              'flex size-11 items-center justify-center rounded-2xl',
              gold ? 'bg-marigold-400/15 text-marigold-300 ring-1 ring-marigold-300/30' : 'bg-gradient-to-br from-blue-50 to-blue-100/60 text-blue-700 ring-1 ring-blue-100',
            )}
          >
            <Icon className="size-5" strokeWidth={1.75} aria-hidden />
          </span>
          <h3 className={cn('mt-4 font-display text-lg font-semibold tracking-tight', gold ? 'text-white' : 'text-slate-900')}>{m.title}</h3>
          <p className={cn('mt-1.5 text-sm leading-relaxed', gold ? 'text-white/70' : 'text-slate-600')}>{m.text}</p>
          <ul className="mt-4 flex flex-wrap gap-1.5">
            {m.points.map((p) => (
              <li
                key={p}
                className={cn(
                  'rounded-full px-2.5 py-1 text-[11px] font-medium',
                  gold ? 'bg-marigold-300 text-ink-950' : 'bg-slate-100 text-slate-600',
                )}
              >
                {p}
              </li>
            ))}
          </ul>
        </div>
        {m.visual && (
          <div aria-hidden className="w-full min-w-0 md:w-[46%] md:shrink-0">
            {m.visual}
          </div>
        )}
      </div>
    </article>
  )
}

// ----------------------------------------------------------------- minis --

function MiniFrame({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl bg-slate-50 p-3 ring-1 ring-slate-200/70">{children}</div>
}

function RentMini() {
  const reduce = useReducedMotion()
  const rows: [string, string, 'Paid' | 'AutoPay · 7th' | 'Due'][] = [
    ['Arjun · 204A', inr(9000), 'Paid'],
    ['Priya · 108B', inr(10468), 'AutoPay · 7th'],
    ['Karthik · 112A', inr(8500), 'Due'],
  ]
  return (
    <MiniFrame>
      <p className="mb-2 flex items-center justify-between text-[11px] font-semibold text-slate-900">
        November rent <span className="font-normal text-slate-400">Sample</span>
      </p>
      <ul className="space-y-1.5">
        {rows.map(([who, amount, state], i) => (
          <motion.li
            key={who}
            initial={reduce ? false : { opacity: 0, x: 8 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 + i * 0.08 }}
            className="flex items-center justify-between gap-2 rounded-lg bg-white px-2.5 py-1.5 text-[11px] ring-1 ring-slate-200/70"
          >
            <span className="truncate text-slate-700">{who}</span>
            <span className="flex shrink-0 items-center gap-2">
              <span className="tabular-nums font-medium text-slate-900">{amount}</span>
              <span
                className={cn(
                  'rounded-md px-1.5 py-0.5 text-[10px] font-medium',
                  state === 'Paid' ? 'bg-emerald-50 text-emerald-700' : state === 'Due' ? 'bg-amber-50 text-amber-800' : 'bg-blue-50 text-blue-700',
                )}
              >
                {state === 'AutoPay · 7th' && <Repeat className="mr-0.5 inline size-2.5" aria-hidden />}
                {state}
              </span>
            </span>
          </motion.li>
        ))}
      </ul>
    </MiniFrame>
  )
}

function ElectricityMini() {
  // Room 204: 120 units at ₹13 = ₹1,560, split by days stayed (30 + 30 + 15 = 75 days).
  const rows: [string, number, number][] = [
    ['Arjun', 30, 624],
    ['Rahul', 30, 624],
    ['Vikram', 15, 312],
  ]
  return (
    <MiniFrame>
      <p className="mb-2 flex items-center justify-between text-[11px] font-semibold text-slate-900">
        Room 204 · 120 units × ₹13 <span className="tabular-nums">{inr(1560)}</span>
      </p>
      <ul className="space-y-1.5">
        {rows.map(([who, days, share]) => (
          <li key={who} className="rounded-lg bg-white px-2.5 py-1.5 text-[11px] ring-1 ring-slate-200/70">
            <span className="flex items-center justify-between">
              <span className="text-slate-700">
                {who} <span className="text-slate-400">· {days} days</span>
              </span>
              <span className="tabular-nums font-medium text-slate-900">{inr(share)}</span>
            </span>
            <span className="mt-1 block h-1 overflow-hidden rounded-full bg-slate-100">
              <span className="block h-full rounded-full bg-gradient-to-r from-amber-300 to-marigold-400" style={{ width: `${(days / 30) * 100}%` }} />
            </span>
          </li>
        ))}
      </ul>
    </MiniFrame>
  )
}

function ResidentMini() {
  return (
    <MiniFrame>
      <div className="grid grid-cols-2 gap-1.5 text-[11px]">
        {[
          ['Rent due', `${inr(9000)} · Pay`, 'text-blue-700'],
          ['Food', 'On · 3 meals', 'text-emerald-700'],
          ['Complaint', 'Fan · Resolved', 'text-emerald-700'],
          ['Notice', 'Water off 2–4 PM', 'text-slate-700'],
        ].map(([label, value, tone]) => (
          <div key={label} className="rounded-lg bg-white px-2.5 py-2 ring-1 ring-slate-200/70">
            <p className="text-[10px] text-slate-400">{label}</p>
            <p className={cn('mt-0.5 truncate font-semibold', tone)}>{value}</p>
          </div>
        ))}
      </div>
      <p className="mt-2 flex items-center gap-1 text-[10px] text-slate-500">
        <CheckCircle2 className="size-3 text-emerald-600" aria-hidden />
        Opens from a link, no app store
      </p>
    </MiniFrame>
  )
}
