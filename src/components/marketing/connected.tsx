'use client'

import * as React from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import {
  BarChart3,
  BedDouble,
  HardHat,
  IndianRupee,
  Inbox,
  MessageSquareWarning,
  Users,
  UtensilsCrossed,
  type LucideIcon,
} from 'lucide-react'
import { LogoMark } from './logo'
import { SectionHeading } from './kit'

type Node = { label: string; icon: LucideIcon; color: string; note: string }

const NODES: Node[] = [
  { label: 'Beds', icon: BedDouble, color: 'text-blue-700 bg-blue-50', note: 'Live status of every bed' },
  { label: 'Residents', icon: Users, color: 'text-blue-700 bg-blue-50', note: 'Profiles, KYC, check-in and exit' },
  { label: 'Rent', icon: IndianRupee, color: 'text-blue-700 bg-blue-50', note: 'Generated, reminded, collected' },
  { label: 'Complaints', icon: MessageSquareWarning, color: 'text-blue-700 bg-blue-50', note: 'Raised, assigned, resolved' },
  { label: 'Staff', icon: HardHat, color: 'text-blue-700 bg-blue-50', note: 'Tasks for every worker' },
  { label: 'Food', icon: UtensilsCrossed, color: 'text-blue-700 bg-blue-50', note: 'Menus, meal counts, grocery' },
  { label: 'Enquiries', icon: Inbox, color: 'text-blue-700 bg-blue-50', note: 'Leads to bookings to beds' },
  { label: 'Reports', icon: BarChart3, color: 'text-blue-700 bg-blue-50', note: 'Collections, expenses, profit' },
]

/** Positions on a circle, in % of the square stage. */
function position(i: number) {
  const angle = (i / NODES.length) * Math.PI * 2 - Math.PI / 2
  return { x: 50 + Math.cos(angle) * 39, y: 50 + Math.sin(angle) * 39 }
}

/**
 * "Everything connected": the modules orbit one hub with data pulses running
 * along the links, showing that a change in one place updates the rest.
 */
export function ConnectedSection() {
  const reduce = useReducedMotion()

  return (
    <section id="features" aria-labelledby="connected-title" className="relative scroll-mt-24 overflow-hidden py-16 sm:py-24">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <SectionHeading
          eyebrow="Everything connected"
          title={<span id="connected-title">Not eight apps. One system that talks to itself.</span>}
          description="Notebooks, spreadsheets and WhatsApp groups don’t know about each other. In StayFlow, a check-in fills a bed, starts rent, adds a meal count and shows up in your profit — automatically."
        />

        <div className="mt-12 grid items-center gap-10 lg:grid-cols-[1.1fr_1fr] lg:gap-12">
          {/* Hub diagram */}
          <div aria-hidden className="relative mx-auto aspect-square w-full max-w-[520px] min-w-0">
            <div className="absolute inset-[18%] rounded-full bg-blue-100/60 blur-3xl" />
            <svg viewBox="0 0 100 100" className="absolute inset-0 size-full">
              <circle cx="50" cy="50" r="39" fill="none" stroke="rgb(82 72 224 / 0.12)" strokeWidth="0.3" strokeDasharray="1 1.5" />
              {NODES.map((_, i) => {
                const p = position(i)
                return (
                  <g key={i}>
                    <line x1="50" y1="50" x2={p.x} y2={p.y} stroke="rgb(82 72 224 / 0.18)" strokeWidth="0.35" />
                    {!reduce && (
                      <motion.circle
                        r="0.9"
                        fill="#6863ee"
                        initial={{ cx: p.x, cy: p.y, opacity: 0 }}
                        animate={{ cx: [p.x, 50], cy: [p.y, 50], opacity: [0, 1, 1, 0] }}
                        transition={{ duration: 2.4, repeat: Infinity, delay: i * 0.3, ease: 'easeInOut' }}
                      />
                    )}
                  </g>
                )
              })}
            </svg>

            {/* Hub */}
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
              <div className="relative flex size-20 items-center justify-center rounded-2xl bg-white shadow-lift ring-1 ring-slate-200 sm:size-24">
                {!reduce && <span className="absolute inset-0 animate-pulse-ring rounded-2xl bg-blue-400/20" />}
                <LogoMark className="size-12 rounded-2xl sm:size-14 [&_svg]:size-7" />
              </div>
            </div>

            {NODES.map((node, i) => {
              const p = position(i)
              const Icon = node.icon
              return (
                <div
                  key={node.label}
                  className="absolute -translate-x-1/2 -translate-y-1/2"
                  style={{ left: `${p.x}%`, top: `${p.y}%` }}
                >
                <motion.div
                  initial={reduce ? false : { opacity: 0.85, scale: 0.92 }}
                  whileInView={{ opacity: 1, scale: 1 }}
                  viewport={{ once: true }}
                  transition={{ type: 'spring', stiffness: 260, damping: 20, delay: 0.1 + i * 0.06 }}
                >
                  <div className="flex flex-col items-center gap-1 rounded-xl border border-slate-200 bg-white px-2 py-2 shadow-xs sm:px-3">
                    <span className={`flex size-7 items-center justify-center rounded-lg sm:size-9 ${node.color}`}>
                      <Icon className="size-3.5 sm:size-4" />
                    </span>
                    <span className="text-[10px] font-medium text-slate-700 sm:text-xs">{node.label}</span>
                  </div>
                </motion.div>
                </div>
              )
            })}
          </div>

          {/* What connects to what */}
          <ul className="grid min-w-0 gap-3 sm:grid-cols-2">
            {NODES.map((node, i) => {
              const Icon = node.icon
              return (
                <motion.li
                  key={node.label}
                  initial={reduce ? false : { opacity: 0.85, y: 8 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: '-40px' }}
                  transition={{ duration: 0.45, delay: i * 0.04 }}
                  className="card-lift flex min-w-0 items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-xs"
                >
                  <span className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${node.color}`}>
                    <Icon className="size-4" strokeWidth={1.75} aria-hidden />
                  </span>
                  <span className="min-w-0">
                    <span className="block font-display text-sm font-semibold text-slate-900">{node.label}</span>
                    <span className="block text-sm text-slate-500">{node.note}</span>
                  </span>
                </motion.li>
              )
            })}
          </ul>
        </div>
      </div>
    </section>
  )
}
