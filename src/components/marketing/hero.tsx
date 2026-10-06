'use client'

import * as React from 'react'
import { motion, useReducedMotion, useScroll, useTransform } from 'framer-motion'
import {
  ArrowRight,
  BedDouble,
  CheckCircle2,
  IndianRupee,
  LayoutDashboard,
  MessageSquareWarning,
  PlayCircle,
  Users,
  UtensilsCrossed,
  Wrench,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { EASE_OUT } from '@/components/motion/reveal'
import { BED_STYLES, BrowserFrame, Pill, Tilt, type BedState } from './kit'

/**
 * Hero: the promise on the left, a floating StayFlow dashboard on the right
 * that drifts with scroll (parallax) and tilts toward the pointer. Figures in
 * the mock-up are sample data for a 48-bed PG, not customer data.
 */
export function Hero() {
  const reduce = useReducedMotion()
  const ref = React.useRef<HTMLElement>(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end start'] })
  const dashY = useTransform(scrollYProgress, [0, 1], [0, reduce ? 0 : 90])
  const chipY = useTransform(scrollYProgress, [0, 1], [0, reduce ? 0 : -60])

  const rise = (delay: number) =>
    reduce
      ? {}
      : {
          initial: { opacity: 0, y: 18 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.7, ease: EASE_OUT, delay },
        }

  return (
    <section ref={ref} aria-labelledby="hero-title" className="grain relative isolate overflow-hidden pb-16 pt-28 sm:pb-24 sm:pt-36">
      <div className="absolute inset-0 -z-10 overflow-hidden" aria-hidden>
        <div className="aurora" />
        <div className="dot-grid absolute inset-0 opacity-50 [mask-image:radial-gradient(ellipse_at_top,black,transparent_70%)]" />
      </div>

      <div className="mx-auto grid w-full max-w-6xl items-center gap-14 px-4 sm:px-6 lg:grid-cols-[1fr_1.08fr] lg:gap-10">
        <div className="min-w-0 text-center lg:text-left">
          <motion.p {...rise(0)} className="inline-flex max-w-full items-center gap-2 rounded-full border border-blue-200/80 bg-white/70 py-1 pl-1 pr-3 text-xs font-semibold text-blue-800 shadow-soft backdrop-blur">
            <span className="rounded-full bg-gradient-to-r from-blue-600 to-violet-600 px-2 py-0.5 text-[10px] uppercase tracking-wider text-white">
              StayFlow
            </span>
            <span className="truncate">The operating system for PGs</span>
          </motion.p>

          <motion.h1
            id="hero-title"
            {...rise(0.06)}
            className="mt-6 font-display text-[2.6rem] font-extrabold leading-[1.02] tracking-tight text-slate-900 sm:text-6xl lg:text-[4.25rem]"
          >
            Your PG.
            <br />
            <span className="text-gradient-animated">Finally under control.</span>
          </motion.h1>

          <motion.p {...rise(0.14)} className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-slate-600 text-pretty lg:mx-0">
            StayFlow is the operating system that helps PG owners manage beds, residents, rent, staff,
            food, complaints and profit — from one place.
          </motion.p>

          <motion.div {...rise(0.22)} className="mt-9 flex flex-col justify-center gap-3 sm:flex-row lg:justify-start">
            <Button variant="primary" size="xl" asChild>
              <a href="/signup">
                Start free
                <ArrowRight className="group-hover/btn:translate-x-0.5" aria-hidden />
              </a>
            </Button>
            <Button variant="outline" size="xl" asChild className="bg-white/80 backdrop-blur">
              <a href="#demo">
                <PlayCircle aria-hidden />
                Book a demo
              </a>
            </Button>
          </motion.div>

          <motion.ul {...rise(0.3)} className="mt-8 flex flex-wrap justify-center gap-x-5 gap-y-2 text-sm text-slate-500 lg:justify-start">
            {['Free trial, no card', 'Works on any phone', 'Set up in an afternoon'].map((item) => (
              <li key={item} className="flex items-center gap-1.5">
                <CheckCircle2 className="size-4 text-emerald-500" aria-hidden />
                {item}
              </li>
            ))}
          </motion.ul>
        </div>

        <motion.div style={{ y: dashY }} className="relative min-w-0" aria-hidden>
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 40, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 1, ease: EASE_OUT, delay: 0.2 }}
          className="relative"
        >
          <div className="absolute inset-6 -z-10 rounded-full bg-blue-500/25 blur-3xl" />
          <Tilt max={5}>
            <HeroDashboard />
          </Tilt>

          <motion.div style={{ y: chipY }} className="pointer-events-none absolute inset-0">
            <FloatingChip className="-left-3 top-[18%] sm:-left-8" delay={0.9}>
              <span className="flex size-7 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
                <IndianRupee className="size-3.5" />
              </span>
              <span>
                <span className="block text-[10px] text-slate-500">Room 204 · Arjun</span>
                <span className="block text-xs font-semibold text-slate-900">₹9,000 paid</span>
              </span>
            </FloatingChip>
            <FloatingChip className="-right-2 top-[46%] sm:-right-6" delay={1.15} slow>
              <span className="flex size-7 items-center justify-center rounded-lg bg-violet-100 text-violet-700">
                <Wrench className="size-3.5" />
              </span>
              <span>
                <span className="block text-[10px] text-slate-500">Fan not working</span>
                <span className="block text-xs font-semibold text-emerald-700">Resolved by Ravi</span>
              </span>
            </FloatingChip>
            <FloatingChip className="bottom-[-14px] left-[12%]" delay={1.4}>
              <span className="flex size-7 items-center justify-center rounded-lg bg-sky-100 text-sky-700">
                <BedDouble className="size-3.5" />
              </span>
              <span>
                <span className="block text-[10px] text-slate-500">Bed 105-B</span>
                <span className="block text-xs font-semibold text-slate-900">Reserved for 1 Nov</span>
              </span>
            </FloatingChip>
          </motion.div>
        </motion.div>
        </motion.div>
      </div>
    </section>
  )
}

function FloatingChip({
  children,
  className,
  delay,
  slow,
}: {
  children: React.ReactNode
  className?: string
  delay: number
  slow?: boolean
}) {
  const reduce = useReducedMotion()
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, scale: 0.85, y: 10 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 260, damping: 22, delay }}
      className={cn('absolute hidden sm:block', className)}
    >
      <div className={cn('glass flex items-center gap-2.5 rounded-2xl px-3 py-2 shadow-lift', slow ? 'animate-float-slow' : 'animate-float')}>
        {children}
      </div>
    </motion.div>
  )
}

// ---------------------------------------------------------- Dashboard ----

const NAV = [
  { icon: LayoutDashboard, label: 'Overview', active: true },
  { icon: BedDouble, label: 'Beds' },
  { icon: Users, label: 'Residents' },
  { icon: IndianRupee, label: 'Rent' },
  { icon: UtensilsCrossed, label: 'Food' },
  { icon: MessageSquareWarning, label: 'Complaints' },
]

const BEDS: BedState[] = [
  'occupied', 'occupied', 'available', 'occupied', 'reserved', 'occupied',
  'occupied', 'maintenance', 'occupied', 'occupied', 'available', 'occupied',
  'occupied', 'occupied', 'blocked', 'occupied', 'occupied', 'reserved',
]

/** The hero mock-up: a compact StayFlow owner overview. */
function HeroDashboard() {
  const reduce = useReducedMotion()
  return (
    <BrowserFrame title="app.stayflow.in/overview" className="shadow-[0_40px_80px_-30px_rgb(48_44_126/0.45)]">
      <div className="flex">
        <div className="hidden w-36 shrink-0 border-r border-slate-100 bg-slate-50/70 p-2.5 sm:block">
          {NAV.map(({ icon: Icon, label, active }) => (
            <div
              key={label}
              className={cn(
                'mb-0.5 flex items-center gap-2 rounded-lg px-2 py-1.5 text-[11px] font-medium',
                active ? 'bg-white text-blue-700 shadow-soft' : 'text-slate-500',
              )}
            >
              <Icon className="size-3.5" />
              {label}
            </div>
          ))}
        </div>

        <div className="min-w-0 flex-1 p-3 sm:p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[10px] text-slate-400">Sree Balaji PG · Sample data</p>
              <p className="truncate font-display text-sm font-bold text-slate-900">Good morning, Lakshmi</p>
            </div>
            <Pill tone="green">Live</Pill>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { k: 'Occupancy', v: '87%', s: '42 / 48 beds', c: 'text-violet-700' },
              { k: 'Collected', v: '₹3.2L', s: 'this month', c: 'text-emerald-700' },
              { k: 'Due', v: '₹54K', s: '6 residents', c: 'text-amber-700' },
              { k: 'Complaints', v: '3', s: '1 urgent', c: 'text-red-600' },
            ].map((stat, i) => (
              <motion.div
                key={stat.k}
                initial={reduce ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5 + i * 0.08, duration: 0.5, ease: EASE_OUT }}
                className="rounded-xl border border-slate-100 bg-white p-2.5 shadow-soft"
              >
                <p className="text-[10px] text-slate-500">{stat.k}</p>
                <p className={cn('font-display text-base font-bold tabular', stat.c)}>{stat.v}</p>
                <p className="text-[9px] text-slate-400">{stat.s}</p>
              </motion.div>
            ))}
          </div>

          <div className="mt-3 grid gap-2 sm:grid-cols-[1.25fr_1fr]">
            <div className="rounded-xl border border-slate-100 p-2.5">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-semibold text-slate-700">Floor 1 · beds</p>
                <p className="text-[9px] text-slate-400">tap a bed</p>
              </div>
              <div className="mt-2 grid grid-cols-6 gap-1">
                {BEDS.map((state, i) => (
                  <motion.span
                    key={i}
                    initial={reduce ? false : { opacity: 0, scale: 0.6 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: 0.7 + i * 0.025, type: 'spring', stiffness: 400, damping: 22 }}
                    className={cn('flex h-6 items-center justify-center rounded-md border text-[8px] font-semibold', BED_STYLES[state].tile)}
                  >
                    {101 + Math.floor(i / 2)}
                    {i % 2 ? 'B' : 'A'}
                  </motion.span>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-slate-100 p-2.5">
              <p className="text-[11px] font-semibold text-slate-700">Rent this month</p>
              <div className="mt-2 space-y-1.5">
                {[
                  { n: 'Arjun · 204A', s: 'Paid', t: 'green' as const },
                  { n: 'Priya · 108B', s: 'Due', t: 'amber' as const },
                  { n: 'Karthik · 112A', s: 'Overdue', t: 'red' as const },
                  { n: 'Meena · 301A', s: 'Paid', t: 'green' as const },
                ].map((row) => (
                  <div key={row.n} className="flex items-center justify-between gap-1">
                    <span className="truncate text-[10px] text-slate-600">{row.n}</span>
                    <Pill tone={row.t}>{row.s}</Pill>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-2 rounded-xl border border-slate-100 p-2.5">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-semibold text-slate-700">Collections · last 6 months</p>
              <p className="text-[10px] font-semibold text-emerald-600">+12%</p>
            </div>
            <svg viewBox="0 0 300 54" className="mt-1 h-12 w-full" preserveAspectRatio="none">
              <defs>
                <linearGradient id="hero-area" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="#6863ee" stopOpacity="0.35" />
                  <stop offset="100%" stopColor="#6863ee" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path d="M0 44 C40 40 60 34 100 32 S160 30 190 22 S250 12 300 6 L300 54 L0 54Z" fill="url(#hero-area)" />
              <motion.path
                d="M0 44 C40 40 60 34 100 32 S160 30 190 22 S250 12 300 6"
                fill="none"
                stroke="#5248e0"
                strokeWidth="2.2"
                strokeLinecap="round"
                initial={reduce ? false : { pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 1.6, delay: 0.8, ease: EASE_OUT }}
              />
            </svg>
          </div>
        </div>
      </div>
    </BrowserFrame>
  )
}
