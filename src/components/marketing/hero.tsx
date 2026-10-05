'use client'

import * as React from 'react'
import { motion } from 'framer-motion'
import {
  ArrowRight,
  Bed,
  CheckCircle2,
  PlayCircle,
  Sparkles,
  Utensils,
  Wallet,
  Wrench,
} from 'lucide-react'
import { cn, formatMoney } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { AnimatedNumber } from '@/components/ui/feedback'

const HERO_STATS = [
  { label: 'Residents', value: 128, tone: 'blue' as const },
  { label: 'Occupancy', value: 82, suffix: '%', tone: 'violet' as const },
  { label: 'Collected', value: 840000, money: true, tone: 'emerald' as const },
  { label: 'Pending', value: 32000, money: true, tone: 'amber' as const },
]

/**
 * The hero, with a live-feeling dashboard preview beside it. The numbers here
 * are illustrative of a mid-size PG and labelled as a preview — they are not
 * presented as customer data.
 */
export function Hero() {
  return (
    <section className="relative overflow-hidden pt-28 sm:pt-32">
      <div className="mesh-blue absolute inset-0 -z-10" />
      <div className="dot-grid absolute inset-0 -z-10 opacity-40" />
      <div
        className="absolute inset-x-0 top-0 -z-10 h-px bg-gradient-to-r from-transparent via-blue-300 to-transparent"
        aria-hidden
      />

      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_1fr]">
          {/* ------------------------------------------------------ Copy */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          >
            <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50/80 px-3 py-1 text-xs font-medium text-blue-700 backdrop-blur">
              <Sparkles className="size-3" />
              An automated operating system for PGs
            </span>

            <h1 className="mt-5 font-display text-4xl font-bold leading-[1.08] tracking-tight text-slate-900 text-balance sm:text-5xl lg:text-6xl">
              Run your entire PG from one place.
            </h1>

            <p className="mt-5 max-w-xl text-lg leading-relaxed text-slate-600 text-pretty">
              Replace notebooks, WhatsApp and phone calls with one platform that manages residents,
              rooms, rent, payments, complaints, food, staff and daily operations — and keeps them
              connected to each other.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button variant="primary" size="xl" asChild>
                <a href="/signup">
                  Start free trial
                  <ArrowRight className="size-4" />
                </a>
              </Button>
              <Button variant="outline" size="xl" asChild>
                <a href="#demo">
                  <PlayCircle className="size-4" />
                  Book a free demo
                </a>
              </Button>
            </div>

            <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2">
              {[
                'Set up in an afternoon',
                'Works on any phone',
                'Your data stays yours',
              ].map((item) => (
                <li key={item} className="flex items-center gap-1.5 text-sm text-slate-600">
                  <CheckCircle2 className="size-4 text-emerald-500" />
                  {item}
                </li>
              ))}
            </ul>
          </motion.div>

          {/* -------------------------------------------- Dashboard preview */}
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.6, delay: 0.12, ease: [0.16, 1, 0.3, 1] }}
            className="relative"
          >
            <div className="absolute -inset-4 -z-10 rounded-[2rem] bg-gradient-to-br from-blue-500/10 via-transparent to-pink-500/10 blur-2xl" />

            <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-float">
              {/* Window chrome */}
              <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50/80 px-4 py-2.5">
                <span className="size-2.5 rounded-full bg-red-400" />
                <span className="size-2.5 rounded-full bg-amber-400" />
                <span className="size-2.5 rounded-full bg-emerald-400" />
                <span className="ml-2 rounded-md bg-white px-2 py-0.5 text-[10px] text-slate-400">
                  Dashboard preview
                </span>
              </div>

              <div className="space-y-4 p-4 sm:p-5">
                {/* PG switcher row */}
                <div className="flex gap-2">
                  <PgPill label="Men's PG" tone="blue" active />
                  <PgPill label="Women's PG" tone="pink" />
                </div>

                {/* Stat grid */}
                <div className="grid grid-cols-2 gap-2.5">
                  {HERO_STATS.map((stat, i) => (
                    <motion.div
                      key={stat.label}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.3 + i * 0.08 }}
                      className="rounded-xl border border-slate-200 bg-white p-3"
                    >
                      <p className="text-[10px] uppercase tracking-wide text-slate-400">
                        {stat.label}
                      </p>
                      <p
                        className={cn(
                          'font-display text-xl font-semibold tabular',
                          stat.tone === 'blue'
                            ? 'text-blue-700'
                            : stat.tone === 'violet'
                              ? 'text-violet-700'
                              : stat.tone === 'emerald'
                                ? 'text-emerald-700'
                                : 'text-amber-700',
                        )}
                      >
                        <AnimatedNumber
                          value={stat.value}
                          format={stat.money ? 'moneyCompact' : 'number'}
                        />
                        {stat.suffix}
                      </p>
                    </motion.div>
                  ))}
                </div>

                {/* Bed map strip */}
                <div className="rounded-xl border border-slate-200 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                      <Bed className="size-3.5 text-slate-400" />
                      Room 204
                    </p>
                    <span className="text-[10px] text-slate-400">3 of 4 filled</span>
                  </div>
                  <div className="flex gap-1.5">
                    {[
                      { label: 'A', state: 'occupied' },
                      { label: 'B', state: 'available' },
                      { label: 'C', state: 'occupied' },
                      { label: 'D', state: 'maintenance' },
                    ].map((bed, i) => (
                      <motion.span
                        key={bed.label}
                        initial={{ scale: 0.8, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ delay: 0.6 + i * 0.07 }}
                        className={cn(
                          'flex size-9 items-center justify-center rounded-lg border text-xs font-semibold',
                          bed.state === 'occupied'
                            ? 'border-slate-200 bg-white text-slate-700'
                            : bed.state === 'available'
                              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                              : 'border-orange-200 bg-orange-50 text-orange-700',
                        )}
                      >
                        {bed.label}
                      </motion.span>
                    ))}
                  </div>
                </div>

                {/* Ops rows */}
                <div className="space-y-1.5">
                  <OpsRow
                    icon={Wallet}
                    label="Rent due today"
                    value="3 residents"
                    tone="amber"
                    delay={0.75}
                  />
                  <OpsRow
                    icon={Utensils}
                    label="Meals to cook"
                    value="118 / 122 / 120"
                    tone="slate"
                    delay={0.82}
                  />
                  <OpsRow
                    icon={Wrench}
                    label="Open complaints"
                    value="7"
                    tone="red"
                    delay={0.89}
                  />
                </div>
              </div>
            </div>

            {/* Floating reminder card */}
            <motion.div
              initial={{ opacity: 0, x: 20, y: 10 }}
              animate={{ opacity: 1, x: 0, y: 0 }}
              transition={{ delay: 1, duration: 0.5 }}
              className="absolute -bottom-6 -left-4 hidden w-56 rounded-2xl border border-emerald-100 bg-[#dcf8c6] p-3 shadow-float sm:block"
            >
              <p className="text-[11px] leading-relaxed text-slate-800">
                Hi Arun 👋
                <br />
                Your PG rent of <strong>{formatMoney(8500)}</strong> is due on 10 October.
                <br />
                Room 204 · StayFlow Men&apos;s
              </p>
              <p className="mt-1.5 text-[10px] font-semibold text-emerald-700">
                Sent automatically
              </p>
            </motion.div>
          </motion.div>
        </div>
      </div>
    </section>
  )
}

function PgPill({
  label,
  tone,
  active,
}: {
  label: string
  tone: 'blue' | 'pink'
  active?: boolean
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium',
        active
          ? tone === 'blue'
            ? 'border-blue-200 bg-blue-50 text-blue-700'
            : 'border-pink-200 bg-pink-50 text-pink-700'
          : 'border-slate-200 bg-white text-slate-500',
      )}
    >
      <span
        className={cn('size-1.5 rounded-full', tone === 'blue' ? 'bg-blue-500' : 'bg-pink-500')}
      />
      {label}
    </span>
  )
}

function OpsRow({
  icon: Icon,
  label,
  value,
  tone,
  delay,
}: {
  icon: React.ElementType
  label: string
  value: string
  tone: 'amber' | 'slate' | 'red'
  delay: number
}) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay }}
      className="flex items-center gap-2.5 rounded-lg border border-slate-100 px-2.5 py-2"
    >
      <Icon
        className={cn(
          'size-3.5',
          tone === 'amber' ? 'text-amber-500' : tone === 'red' ? 'text-red-500' : 'text-slate-400',
        )}
      />
      <span className="flex-1 text-xs text-slate-600">{label}</span>
      <span className="text-xs font-semibold text-slate-800 tabular">{value}</span>
    </motion.div>
  )
}
