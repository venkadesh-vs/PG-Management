'use client'

import * as React from 'react'
import { motion } from 'framer-motion'
import { ArrowRight, Calculator, Check, Info, Minus, Plus } from 'lucide-react'
import { cn, formatMoney } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SectionHeading } from './sections'

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
    <section id="pricing" className="scroll-mt-20 py-20 sm:py-28">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <SectionHeading
          eyebrow="Pricing"
          title="Simple pricing. Per PG."
          description="One PG costs roughly what one resident pays you in rent. No per-tenant charges, no feature tiers, no surprises."
        />

        <div className="mt-14 grid gap-8 lg:grid-cols-[1.1fr_1fr]">
          {/* ------------------------------------------------- Calculator */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-60px' }}
            transition={{ duration: 0.5 }}
            className="rounded-2xl border border-slate-200 bg-white p-5 shadow-card sm:p-6"
          >
            <div className="flex items-center gap-2">
              <Calculator className="size-4 text-blue-600" />
              <h3 className="font-display text-base font-semibold text-slate-900">
                Calculate my PG&apos;s price
              </h3>
            </div>
            <p className="mt-1 text-sm text-slate-500">
              Enter what a standard resident pays you each month.
            </p>

            <div className="mt-5 space-y-3">
              {rows.map((row) => (
                <motion.div
                  key={row.id}
                  layout
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="rounded-xl border border-slate-200 p-3"
                >
                  <div className="flex items-center gap-2">
                    <Input
                      value={row.label}
                      onChange={(e) => update(row.id, { label: e.target.value })}
                      className="h-9 flex-1 border-0 bg-transparent px-0 text-sm font-medium shadow-none focus-visible:ring-0"
                      aria-label="PG name"
                    />
                    {rows.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removePg(row.id)}
                        aria-label={`Remove ${row.label}`}
                        className="rounded-lg p-1.5 text-slate-300 hover:bg-slate-100 hover:text-slate-500"
                      >
                        <Minus className="size-4" />
                      </button>
                    )}
                  </div>

                  <div className="mt-2 grid gap-3 sm:grid-cols-2">
                    <label className="block">
                      <span className="text-xs text-slate-500">Standard rent</span>
                      <Input
                        type="number"
                        inputMode="numeric"
                        value={row.rent}
                        onChange={(e) => update(row.id, { rent: Number(e.target.value) || 0 })}
                        className="mt-1 h-9"
                      />
                    </label>
                    {rule.basis === 'PER_BED' && (
                      <label className="block">
                        <span className="text-xs text-slate-500">Number of beds</span>
                        <Input
                          type="number"
                          inputMode="numeric"
                          value={row.beds}
                          onChange={(e) => update(row.id, { beds: Number(e.target.value) || 0 })}
                          className="mt-1 h-9"
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
                          className="font-display text-lg font-semibold text-slate-900 tabular"
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
              <Plus className="size-3.5" />
              Add another PG
            </Button>

            <motion.div
              layout
              className="mt-5 flex items-center justify-between rounded-2xl bg-slate-900 p-5 text-white"
            >
              <div>
                <p className="text-xs uppercase tracking-wide text-white/60">
                  Estimated total for {rows.length} PG{rows.length === 1 ? '' : 's'}
                </p>
                <motion.p
                  key={total}
                  initial={{ scale: 0.96, opacity: 0.7 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className="font-display text-3xl font-semibold tabular"
                >
                  {formatMoney(total)}
                  <span className="text-base font-medium text-white/60">/month</span>
                </motion.p>
              </div>
              <Button variant="secondary" asChild className="bg-white text-slate-900 hover:bg-white/90">
                <a href="#demo">
                  Book a demo
                  <ArrowRight className="size-3.5" />
                </a>
              </Button>
            </motion.div>

            <p className="mt-3 flex items-start gap-1.5 text-xs leading-relaxed text-slate-500">
              <Info className="mt-0.5 size-3.5 shrink-0" />
              An example based on our current {rule.planName} plan rules —{' '}
              {rule.basis === 'STANDARD_RENT'
                ? `${rule.multiplier}% of each PG's standard rent`
                : rule.basis === 'PER_BED'
                  ? `${formatMoney(rule.perBedPrice)} per bed`
                  : 'a flat monthly fee'}
              , kept between {formatMoney(rule.minAmount)} and {formatMoney(rule.maxAmount)}. Your
              final price is confirmed on the demo call.
            </p>
          </motion.div>

          {/* ---------------------------------------------- What you get */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-60px' }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="rounded-2xl border border-blue-200 bg-gradient-to-b from-blue-50/80 to-white p-6"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-semibold text-slate-900">
                Everything, included
              </h3>
              {rule.trialDays > 0 && (
                <span className="rounded-full bg-blue-600 px-3 py-1 text-xs font-semibold text-white">
                  {rule.trialDays}-day free trial
                </span>
              )}
            </div>

            <p className="mt-2 text-sm text-slate-600">
              No feature gates. Every PG gets the whole product.
            </p>

            <ul className="mt-5 space-y-2.5">
              {[
                'Unlimited residents and beds',
                'Automatic rent generation and reminders',
                'WhatsApp reminders and receipts',
                'Online rent collection with UPI',
                'Resident app for every tenant',
                'Worker app for your staff',
                'Complaints with worker assignment',
                'Food planning and meal counts',
                'Grocery stock and purchase lists',
                'Expenses and profit reports',
                'Visitors, inventory and announcements',
                'Full activity history',
              ].map((item) => (
                <li key={item} className="flex items-start gap-2 text-sm text-slate-700">
                  <Check className="mt-0.5 size-4 shrink-0 text-blue-600" strokeWidth={3} />
                  {item}
                </li>
              ))}
            </ul>

            <div className="mt-6 space-y-2 border-t border-blue-100 pt-5">
              {[
                'No per-tenant pricing',
                'No complicated tiers',
                'No per-feature charges',
              ].map((item) => (
                <p key={item} className="flex items-center gap-2 text-sm text-slate-500">
                  <Minus className="size-3.5 text-slate-300" />
                  {item}
                </p>
              ))}
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  )
}

// ------------------------------------------------------------------- FAQ ----

const FAQS = [
  {
    q: 'How long does it take to set up?',
    a: 'An afternoon. Add your PG, create the floors and rooms — bulk-add handles a whole floor at once — then check residents in. Most owners start with one PG and add the second once they are comfortable.',
  },
  {
    q: 'Do my residents have to install an app?',
    a: 'No. The resident app runs in any phone browser. You share their login at check-in and they can add it to their home screen if they want to.',
  },
  {
    q: 'What happens to my old records?',
    a: 'You enter current residents once, with their joining date and rent. From that point the rent schedule, ledger and reports build themselves. You do not need to back-fill years of history.',
  },
  {
    q: 'Can my manager use it without seeing everything?',
    a: 'Yes. Managers run day-to-day operations but cannot change settings, delete a PG or touch the subscription. Workers only ever see their own task list.',
  },
  {
    q: 'Are the WhatsApp reminders really automatic?',
    a: 'Yes, once your WhatsApp Business account is connected. Reminders go out before the due date, on it, and after it, using approved templates. Before it is connected, the app shows you exactly what each resident would receive and marks it clearly as not sent.',
  },
  {
    q: 'How do residents pay?',
    a: 'By UPI from the resident app, or in cash which you record in one tap. Online payments are only marked paid after the payment gateway confirms them, so a receipt always means the money arrived.',
  },
  {
    q: 'What if I run two PGs with different rents?',
    a: 'Each PG carries its own rent configuration, its own theme and its own subscription. You switch between them from one selector, and can compare them side by side.',
  },
  {
    q: 'Is my data safe?',
    a: 'It lives in your own PostgreSQL database. Access is checked on the server for every request, each organization is isolated from every other, and every change is recorded in an activity log.',
  },
]

export function FaqSection() {
  const [open, setOpen] = React.useState<number | null>(0)

  return (
    <section id="faq" className="scroll-mt-20 bg-slate-50/70 py-20 sm:py-28">
      <div className="mx-auto w-full max-w-3xl px-4 sm:px-6">
        <SectionHeading eyebrow="FAQ" title="Questions PG owners ask us" />

        <div className="mt-12 space-y-3">
          {FAQS.map((faq, i) => {
            const expanded = open === i
            return (
              <motion.div
                key={faq.q}
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-40px' }}
                transition={{ duration: 0.35, delay: Math.min(i * 0.05, 0.3) }}
                className={cn(
                  'overflow-hidden rounded-2xl border bg-white transition-colors',
                  expanded ? 'border-blue-200 shadow-elevated' : 'border-slate-200 shadow-card',
                )}
              >
                <button
                  type="button"
                  onClick={() => setOpen(expanded ? null : i)}
                  aria-expanded={expanded}
                  className="flex w-full items-center gap-3 p-5 text-left"
                >
                  <span className="flex-1 font-display text-base font-semibold text-slate-900">
                    {faq.q}
                  </span>
                  <span
                    className={cn(
                      'flex size-6 shrink-0 items-center justify-center rounded-full transition-all',
                      expanded ? 'rotate-45 bg-blue-600 text-white' : 'bg-slate-100 text-slate-500',
                    )}
                  >
                    <Plus className="size-3.5" />
                  </span>
                </button>
                <motion.div
                  initial={false}
                  animate={{ height: expanded ? 'auto' : 0, opacity: expanded ? 1 : 0 }}
                  className="overflow-hidden"
                >
                  <p className="px-5 pb-5 text-sm leading-relaxed text-slate-600">{faq.a}</p>
                </motion.div>
              </motion.div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
