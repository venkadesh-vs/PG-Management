'use client'

import Link from 'next/link'
import { motion, useReducedMotion } from 'framer-motion'
import { ArrowUpRight, Building2, Sparkles, UserPlus } from 'lucide-react'
import { AnimatedNumber } from '@/components/ui/feedback'

/**
 * The premium "control room" summary at the top of the platform dashboard:
 * MRR as the hero number with run rate, customers and new sign-ups beside it.
 */
export function PlatformHero({
  mrr,
  arr,
  activeSubscriptions,
  customers,
  activeCustomers,
  trialCustomers,
  newThisMonth,
}: {
  mrr: number
  arr: number
  activeSubscriptions: number
  customers: number
  activeCustomers: number
  trialCustomers: number
  newThisMonth: number
}) {
  const reduce = useReducedMotion()
  const activeShare = customers > 0 ? Math.round((activeCustomers / customers) * 100) : 0

  return (
    <motion.section
      initial={reduce ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
      className="relative isolate overflow-hidden rounded-2xl bg-ink-950 p-5 text-white shadow-float sm:p-7"
    >
      {/* Soft glows */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-24 -top-28 -z-10 size-80 rounded-full bg-blue-600/30 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-32 left-1/3 -z-10 size-72 rounded-full bg-marigold-400/10 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_1px_1px,rgb(255_255_255/0.05)_1px,transparent_0)] [background-size:22px_22px] [mask-image:linear-gradient(to_bottom,black,transparent)]"
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:items-end lg:gap-10">
        <Link
          href="/admin/subscriptions"
          className="group block min-w-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marigold-300/60"
        >
          <p className="inline-flex items-center gap-2 rounded-full bg-white/[0.06] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-marigold-200 ring-1 ring-inset ring-white/10">
            <Sparkles className="size-3.5" />
            Monthly recurring revenue
          </p>
          <div className="mt-4 flex flex-wrap items-end gap-x-3 gap-y-1">
            <AnimatedNumber
              value={mrr}
              format="money"
              className="font-display text-4xl font-semibold tracking-tight sm:text-5xl"
            />
            <span className="mb-1.5 text-sm text-ink-400">/ month</span>
          </div>
          <p className="mt-2 flex items-center gap-1.5 text-sm text-ink-300">
            {activeSubscriptions} active subscription{activeSubscriptions === 1 ? '' : 's'}
            <ArrowUpRight className="size-3.5 text-ink-500 transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-marigold-300" />
          </p>
        </Link>

        <div className="grid grid-cols-3 divide-x divide-white/10 rounded-xl bg-white/[0.04] ring-1 ring-inset ring-white/10">
          <div className="min-w-0 px-3 py-3.5 sm:px-5 sm:py-4">
            <p className="truncate text-[11px] font-medium uppercase tracking-wider text-ink-400">Run rate</p>
            <div className="mt-1.5">
              <AnimatedNumber
                value={arr}
                format="moneyCompact"
                className="font-display text-lg font-semibold tracking-tight text-marigold-200 sm:text-2xl"
              />
            </div>
            <p className="mt-0.5 truncate text-[11px] text-ink-500">MRR × 12</p>
          </div>
          <Link
            href="/admin/organizations"
            className="group min-w-0 px-3 py-3.5 transition-colors hover:bg-white/[0.04] sm:px-5 sm:py-4"
          >
            <p className="flex items-center gap-1 truncate text-[11px] font-medium uppercase tracking-wider text-ink-400">
              <Building2 className="hidden size-3 shrink-0 sm:block" />
              Customers
            </p>
            <div className="mt-1.5">
              <AnimatedNumber
                value={customers}
                className="font-display text-lg font-semibold tracking-tight sm:text-2xl"
              />
            </div>
            <p className="mt-0.5 truncate text-[11px] text-ink-500">
              {activeCustomers} active · {trialCustomers} trial
            </p>
          </Link>
          <div className="min-w-0 px-3 py-3.5 sm:px-5 sm:py-4">
            <p className="flex items-center gap-1 truncate text-[11px] font-medium uppercase tracking-wider text-ink-400">
              <UserPlus className="hidden size-3 shrink-0 sm:block" />
              New
            </p>
            <div className="mt-1.5">
              <AnimatedNumber
                value={newThisMonth}
                className="font-display text-lg font-semibold tracking-tight sm:text-2xl"
              />
            </div>
            <p className="mt-0.5 truncate text-[11px] text-ink-500">This month</p>
          </div>
        </div>
      </div>

      {/* Paying share bar */}
      <div className="mt-6 sm:mt-7">
        <div className="flex items-center justify-between text-[11px] text-ink-400">
          <span>Paying customers</span>
          <span className="tabular-nums text-ink-300">{activeShare}%</span>
        </div>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/10">
          <motion.div
            initial={reduce ? false : { width: 0 }}
            animate={{ width: `${activeShare}%` }}
            transition={{ duration: 0.9, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="h-full rounded-full bg-gradient-to-r from-blue-400 to-marigold-300"
            style={reduce ? { width: `${activeShare}%` } : undefined}
          />
        </div>
      </div>
    </motion.section>
  )
}
