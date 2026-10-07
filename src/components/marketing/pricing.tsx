'use client'

import * as React from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { ArrowRight, Calculator, Check, HelpCircle, Info, Minus, Plus, Tag, X } from 'lucide-react'
import { cn, formatMoney } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Reveal } from '@/components/motion/reveal'
import { SectionHeading } from './kit'
import { FAQS } from './faq-data'

type PricingRule = {
  planName: string
  basis: 'STANDARD_RENT' | 'PER_BED' | 'FLAT'
  multiplier: number
  perBedPrice: number
  flatPrice: number
  minAmount: number
  maxAmount: number
  trialDays: number
}

type PgRow = { id: number; label: string; rent: number; beds: number }

const INCLUDED = [
  'Unlimited residents and beds',
  'Live bed map and bookings',
  'Automatic rent and reminders',
  'UPI collection and receipts',
  'Resident app for every tenant',
  'Worker app for your staff',
  'Complaints with assignment',
  'Food planning and meal counts',
  'Grocery stock and purchases',
  'Expenses and profit reports',
  'Enquiries and visitors',
  'Full activity history',
]

/**
 * Interactive pricing calculator. It uses the live default plan's rule, so
 * what a visitor sees here is what the product would actually charge them.
 */
export function PricingSection({ rule }: { rule: PricingRule }) {
  const [rows, setRows] = React.useState<PgRow[]>([
    { id: 1, label: "Men's PG", rent: 8000, beds: 40 },
    { id: 2, label: "Women's PG", rent: 9000, beds: 32 },
  ])

  function priceFor(row: PgRow) {
    const raw =
      rule.basis === 'STANDARD_RENT'
        ? Math.round((row.rent * rule.multiplier) / 100)
        : rule.basis === 'PER_BED'
          ? row.beds * rule.perBedPrice
          : rule.flatPrice
    return Math.min(rule.maxAmount, Math.max(rule.minAmount, raw))
  }

  const total = rows.reduce((sum, row) => sum + priceFor(row), 0)

  function update(id: number, patch: Partial<PgRow>) {
    setRows((current) => current.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }

  function addPg() {
    setRows((current) => [
      ...current,
      {
        id: Math.max(0, ...current.map((r) => r.id)) + 1,
        label: `PG ${current.length + 1}`,
        rent: 8000,
        beds: 30,
      },
    ])
  }

  function removePg(id: number) {
    setRows((current) => (current.length > 1 ? current.filter((r) => r.id !== id) : current))
  }

  return (
    <section id="pricing" aria-labelledby="pricing-title" className="relative scroll-mt-24 overflow-hidden py-16 sm:py-24">
      <div className="mesh-blue absolute inset-x-0 top-0 -z-10 h-[420px] opacity-50" aria-hidden />
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <SectionHeading
          eyebrow="Pricing"
          icon={Tag}
          title={<span id="pricing-title">Simple pricing. Per PG.</span>}
          description="One PG costs roughly what one resident pays you in rent. No per-tenant charges, no feature tiers, no surprises."
        />

        <div className="mt-12 grid gap-5 lg:grid-cols-[1.1fr_1fr] lg:gap-6">
          {/* ------------------------------------------------- Calculator */}
          <Reveal className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-elevated sm:p-7">
            <div className="flex items-center gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
                <Calculator className="size-4" strokeWidth={1.75} aria-hidden />
              </span>
              <div className="min-w-0">
                <h3 className="font-display text-base font-semibold text-slate-900">Calculate my PG&apos;s price</h3>
                <p className="text-sm text-slate-500">Enter what a standard resident pays you each month.</p>
              </div>
            </div>

            <div className="mt-5 space-y-3">
              {rows.map((row) => (
                <motion.div
                  key={row.id}
                  layout
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 sm:p-4"
                >
                  <div className="flex items-center gap-2">
                    <Input
                      value={row.label}
                      onChange={(e) => update(row.id, { label: e.target.value })}
                      className="h-9 min-w-0 flex-1 border-0 bg-transparent px-0 text-sm font-semibold shadow-none focus-visible:ring-0"
                      aria-label="PG name"
                    />
                    {rows.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removePg(row.id)}
                        aria-label={`Remove ${row.label}`}
                        className="rounded-lg p-1.5 text-slate-400 hover:bg-white hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
                      >
                        <Minus className="size-4" />
                      </button>
                    )}
                  </div>

                  <div className="mt-2 grid gap-3 sm:grid-cols-2">
                    <label className="block min-w-0">
                      <span className="text-xs font-medium text-slate-500">Standard rent (₹)</span>
                      <Input
                        type="number"
                        inputMode="numeric"
                        value={row.rent}
                        onChange={(e) => update(row.id, { rent: Number(e.target.value) || 0 })}
                        className="mt-1 h-10 bg-white"
                      />
                    </label>
                    {rule.basis === 'PER_BED' && (
                      <label className="block min-w-0">
                        <span className="text-xs font-medium text-slate-500">Number of beds</span>
                        <Input
                          type="number"
                          inputMode="numeric"
                          value={row.beds}
                          onChange={(e) => update(row.id, { beds: Number(e.target.value) || 0 })}
                          className="mt-1 h-10 bg-white"
                        />
                      </label>
                    )}
                    <div className="flex items-end justify-end">
                      <div className="text-right">
                        <p className="text-xs text-slate-500">Subscription</p>
                        <motion.p
                          key={priceFor(row)}
                          initial={{ scale: 0.95, opacity: 0.6 }}
                          animate={{ scale: 1, opacity: 1 }}
                          className="font-display text-xl font-semibold text-slate-900 tabular"
                        >
                          {formatMoney(priceFor(row))}
                        </motion.p>
                      </div>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>

            <Button variant="outline" size="sm" className="mt-3 w-full" onClick={addPg}>
              <Plus className="size-3.5" aria-hidden />
              Add another PG
            </Button>

            <motion.div
              layout
              className="relative mt-5 flex flex-col gap-4 overflow-hidden rounded-xl bg-slate-900 p-5 text-white sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="pointer-events-none absolute -right-10 -top-10 size-40 rounded-full bg-blue-500/25 blur-3xl" aria-hidden />
              <div className="relative min-w-0">
                <p className="text-xs font-medium text-white/60">
                  Estimated total for {rows.length} PG{rows.length === 1 ? '' : 's'}
                </p>
                <motion.p
                  key={total}
                  initial={{ scale: 0.96, opacity: 0.7 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className="font-display text-3xl font-bold tracking-tight tabular"
                  aria-live="polite"
                >
                  {formatMoney(total)}
                  <span className="text-base font-medium text-white/60">/month</span>
                </motion.p>
              </div>
              <Button variant="outline" asChild className="relative border-white bg-white text-slate-900 hover:bg-slate-100 hover:text-slate-900">
                <a href="/signup">
                  Start free
                  <ArrowRight className="size-3.5" aria-hidden />
                </a>
              </Button>
            </motion.div>

            <p className="mt-3 flex items-start gap-1.5 text-xs leading-relaxed text-slate-500">
              <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>
                An example based on our current {rule.planName} plan rules —{' '}
                {rule.basis === 'STANDARD_RENT'
                  ? `${rule.multiplier}% of each PG's standard rent`
                  : rule.basis === 'PER_BED'
                    ? `${formatMoney(rule.perBedPrice)} per bed`
                    : 'a flat monthly fee'}
                , kept between {formatMoney(rule.minAmount)} and {formatMoney(rule.maxAmount)}. Your final price is
                confirmed on the demo call.
              </span>
            </p>
          </Reveal>

          {/* ---------------------------------------------- What you get */}
          <Reveal delay={0.1} className="relative min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 shadow-xs sm:p-7">
            <div className="absolute inset-x-0 top-0 h-1 bg-blue-600" aria-hidden />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-display text-lg font-semibold text-slate-900">Everything, included</h3>
              {rule.trialDays > 0 && (
                <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-200">
                  {rule.trialDays}-day free trial
                </span>
              )}
            </div>
            <p className="mt-2 text-sm text-slate-600">No feature gates. Every PG gets the whole product.</p>

            <ul className="mt-5 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              {INCLUDED.map((item) => (
                <li key={item} className="flex min-w-0 items-start gap-2 text-sm text-slate-700">
                  <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-blue-50 ring-1 ring-inset ring-blue-200">
                    <Check className="size-2.5 text-blue-700" strokeWidth={3} aria-hidden />
                  </span>
                  {item}
                </li>
              ))}
            </ul>

            <div className="mt-6 flex flex-wrap gap-2 border-t border-slate-100 pt-5">
              {['No per-tenant pricing', 'No complicated tiers', 'No setup fee'].map((item) => (
                <span key={item} className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                  <X className="size-3 text-slate-400" aria-hidden />
                  {item}
                </span>
              ))}
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  )
}

// ------------------------------------------------------------------- FAQ ----

export function FaqSection() {
  const [open, setOpen] = React.useState<number | null>(0)
  const reduce = useReducedMotion()

  return (
    <section id="faq" aria-labelledby="faq-title" className="scroll-mt-24 bg-slate-50/70 py-16 sm:py-24">
      <div className="mx-auto w-full max-w-3xl px-4 sm:px-6">
        <SectionHeading eyebrow="FAQ" icon={HelpCircle} title={<span id="faq-title">Questions PG owners ask us</span>} />

        <div className="mt-10 space-y-2.5">
          {FAQS.map((faq, i) => {
            const expanded = open === i
            const panelId = `faq-panel-${i}`
            const buttonId = `faq-button-${i}`
            return (
              <Reveal
                key={faq.q}
                delay={Math.min(i * 0.04, 0.24)}
                className={cn(
                  'overflow-hidden rounded-xl border bg-white transition-[border-color,box-shadow] duration-300',
                  expanded ? 'border-slate-300 shadow-elevated' : 'border-slate-200 shadow-xs',
                )}
              >
                <h3>
                  <button
                    id={buttonId}
                    type="button"
                    onClick={() => setOpen(expanded ? null : i)}
                    aria-expanded={expanded}
                    aria-controls={panelId}
                    className="flex w-full items-center gap-3 rounded-xl p-4 text-left sm:p-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500/40"
                  >
                    <span className="min-w-0 flex-1 font-display text-[15px] font-medium text-slate-900 sm:text-base">{faq.q}</span>
                    <span
                      className={cn(
                        'flex size-7 shrink-0 items-center justify-center rounded-full transition-all duration-300',
                        expanded ? 'rotate-45 bg-slate-900 text-white' : 'bg-slate-100 text-slate-500',
                      )}
                      aria-hidden
                    >
                      <Plus className="size-3.5" />
                    </span>
                  </button>
                </h3>
                <motion.div
                  id={panelId}
                  role="region"
                  aria-labelledby={buttonId}
                  initial={false}
                  animate={{ height: expanded ? 'auto' : 0, opacity: expanded ? 1 : 0 }}
                  transition={{ duration: reduce ? 0 : 0.3 }}
                  className="overflow-hidden"
                  hidden={!expanded && reduce ? true : undefined}
                >
                  <p className="px-4 pb-4 text-sm leading-relaxed text-slate-600 sm:px-5 sm:pb-5">{faq.a}</p>
                </motion.div>
              </Reveal>
            )
          })}
        </div>
      </div>
    </section>
  )
}
