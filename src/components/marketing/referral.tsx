'use client'

import { motion, useReducedMotion } from 'framer-motion'
import { CheckCircle2, Gift, MessageCircle, Receipt, UserPlus } from 'lucide-react'
import { FeatureSection, Pill, PhoneFrame } from './kit'

/*
 * Sample data, clearly labelled on the visual. The numbers agree with each other:
 *   The referrer's usual monthly bill is ₹8,000 (one bed's rent for their PG).
 *   The PG owner they referred pays their first month, so the next bill is 50% off:
 *   ₹8,000 − ₹4,000 = ₹4,000.
 */
const BILL = 8_000
const PERCENT = 50
const OFF = Math.round((BILL * PERCENT) / 100)

const inr = (n: number) => `₹${new Intl.NumberFormat('en-IN').format(n)}`

export function ReferralSection() {
  return (
    <FeatureSection
      id="refer"
      eyebrow="Refer & earn"
      icon={Gift}
      title="Refer a PG owner. Pay half that month."
      problem="You already know other PG owners who still run on notebooks and WhatsApp. Telling them about a tool that works for you should be worth something."
      solution={`Every owner gets a referral code and a link to share on WhatsApp. When an owner you refer pays their first month, your next month's bill is ${PERCENT}% off, automatically. A ${inr(BILL)} bill becomes ${inr(BILL - OFF)}.`}
      benefits={[
        'Your own code and a one-tap WhatsApp share',
        `${PERCENT}% off a whole month, for all your PGs`,
        'Applied to your bill automatically, before GST',
        'Every owner you bring earns another half-price month',
        'See who joined and what you saved',
        'Counts only when they pay, so it is fair to everyone',
      ]}
      visual={<ReferralVisual />}
    />
  )
}

export function ReferralVisual() {
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
    <div className="relative mx-auto max-w-sm">
      <PhoneFrame>
        <div className="space-y-3 p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-slate-900">Refer &amp; earn</p>
            <Pill tone="neutral" dot={false}>
              Sample data
            </Pill>
          </div>

          {/* The code */}
          <motion.div {...rise(0.05)} className="rounded-xl border border-blue-100 bg-gradient-to-br from-blue-50 to-emerald-50 p-3">
            <p className="text-[11px] text-slate-600">Your referral code</p>
            <p className="mt-1 inline-block rounded-lg border border-dashed border-blue-300 bg-white px-2.5 py-1 font-mono text-sm font-semibold tracking-widest text-slate-900">
              RAJESH7K2Q
            </p>
            <p className="mt-2 flex items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-2 py-1.5 text-[11px] font-semibold text-white">
              <MessageCircle className="size-3.5" aria-hidden />
              Share on WhatsApp
            </p>
          </motion.div>

          {/* The referral */}
          <motion.div {...rise(0.15)} className="flex items-start gap-2 rounded-xl border border-slate-200 bg-white p-3">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
              <UserPlus className="size-3.5" aria-hidden />
            </span>
            <p className="min-w-0 text-[11px] text-slate-600">
              <span className="block font-semibold text-slate-900">Sri Balaji PG joined with your code</span>
              Paid their first month on 3 Nov
              <span className="mt-1 flex items-center gap-1 font-medium text-emerald-700">
                <CheckCircle2 className="size-3" aria-hidden />
                Reward earned: {PERCENT}% off a month
              </span>
            </p>
          </motion.div>

          {/* The bill */}
          <motion.div {...rise(0.25)} className="rounded-xl border border-slate-200 bg-white p-3">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-900">
              <Receipt className="size-3.5 text-slate-500" aria-hidden />
              Your December bill
            </p>
            <div className="mt-2 space-y-1 text-[11px] text-slate-600">
              <p className="flex justify-between">
                <span>StayFlow subscription</span>
                <span className="tabular-nums">{inr(BILL)}</span>
              </p>
              <p className="flex justify-between font-medium text-emerald-700">
                <span>Referral reward · {PERCENT}% off</span>
                <span className="tabular-nums">−{inr(OFF)}</span>
              </p>
              <p className="flex justify-between border-t border-slate-100 pt-1 font-semibold text-slate-900">
                <span>You pay</span>
                <span className="tabular-nums">{inr(BILL - OFF)}</span>
              </p>
            </div>
          </motion.div>
        </div>
      </PhoneFrame>

      <motion.div
        {...rise(0.35)}
        className="relative mx-3 -mt-4 flex max-w-[250px] items-center gap-2 rounded-xl border border-slate-200 bg-white p-2.5 text-[11px] text-slate-700 shadow-lift sm:absolute sm:-bottom-10 sm:-right-10 sm:mx-0 sm:mt-0"
      >
        <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
          <Gift className="size-3.5" aria-hidden />
        </span>
        <span>
          <span className="block font-semibold text-slate-900">3 owners referred</span>
          <span className="block text-slate-500">3 half-price months earned</span>
        </span>
      </motion.div>
    </div>
  )
}
