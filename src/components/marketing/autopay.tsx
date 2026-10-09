'use client'

import { motion, useReducedMotion } from 'framer-motion'
import { BellRing, CalendarClock, CheckCircle2, Repeat, ShieldCheck } from 'lucide-react'
import { FeatureSection, Pill, PhoneFrame } from './kit'

/*
 * Sample data, clearly labelled on the visual. The numbers agree with each other:
 *   Usual monthly bill ₹10,000 (rent ₹9,500 + maintenance ₹500).
 *   AutoPay limit = 150% of that = ₹15,000.
 *   November invoice = ₹10,000 + the electricity share ₹468 (the same share as the
 *   electricity example above) = ₹10,468, debited on the 7th, the resident's salary day.
 */
const RENT = 9_500
const MAINTENANCE = 500
const ELECTRICITY = 468
const LIMIT = 15_000
const TOTAL = RENT + MAINTENANCE + ELECTRICITY

const inr = (n: number) => `₹${new Intl.NumberFormat('en-IN').format(n)}`

export function AutopaySection() {
  return (
    <FeatureSection
      id="autopay"
      eyebrow="AutoPay"
      icon={Repeat}
      title="Rent that collects itself."
      problem="Rent day means chasing: reminders, “I’ll pay tomorrow”, screenshots of UPI payments to match against a notebook. Salaries land on different days, so a single due date suits nobody."
      solution="Residents approve UPI AutoPay, a bank eMandate or a card once and pick their own debit date, such as the day after salary. Every month StayFlow debits the exact invoice, rent plus electricity and charges, straight into your Razorpay account, with a reminder the day before."
      benefits={[
        'UPI AutoPay, bank eMandate or card',
        'Residents choose their date, within limits you set',
        'The exact amount each month, electricity included',
        'A reminder before every debit; cancel anytime',
        'Their date is the due date, so no unfair late fees',
        'Failed debits retried, and you are alerted',
      ]}
      visual={<AutopayVisual />}
    />
  )
}

export function AutopayVisual() {
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
            <p className="text-xs font-semibold text-slate-900">Rent · Priya, Room 204</p>
            <Pill tone="neutral" dot={false}>
              Sample data
            </Pill>
          </div>

          {/* The mandate */}
          <motion.div {...rise(0.05)} className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="flex items-center gap-2">
              <span className="flex size-7 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
                <Repeat className="size-3.5" aria-hidden />
              </span>
              <span className="text-xs font-semibold text-slate-900">AutoPay</span>
              <span className="rounded-md bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">On</span>
            </div>
            <p className="mt-2 text-[11px] text-slate-600">
              UPI AutoPay · up to <span className="font-semibold tabular-nums text-slate-900">{inr(LIMIT)}</span> a month
            </p>
            <p className="mt-1.5 flex items-center gap-1.5 rounded-lg bg-slate-50 px-2 py-1.5 text-[11px] font-medium text-slate-800">
              <CalendarClock className="size-3.5 text-slate-500" aria-hidden />
              Debited on the 7th, your salary day
            </p>
          </motion.div>

          {/* The reminder */}
          <motion.div {...rise(0.15)} className="flex items-start gap-2 rounded-xl border border-amber-100 bg-amber-50/60 p-3">
            <BellRing className="mt-0.5 size-3.5 shrink-0 text-amber-600" aria-hidden />
            <p className="text-[11px] text-slate-700">
              <span className="block font-semibold text-slate-900">Reminder · 6 Nov</span>
              {inr(TOTAL)} will be debited tomorrow for your November rent.
            </p>
          </motion.div>

          {/* What was debited */}
          <motion.div {...rise(0.25)} className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="space-y-1 text-[11px] text-slate-600">
              <p className="flex justify-between">
                <span>Rent · November</span>
                <span className="tabular-nums">{inr(RENT)}</span>
              </p>
              <p className="flex justify-between">
                <span>Maintenance</span>
                <span className="tabular-nums">{inr(MAINTENANCE)}</span>
              </p>
              <p className="flex justify-between">
                <span>Electricity · 30 of 30 days</span>
                <span className="tabular-nums">{inr(ELECTRICITY)}</span>
              </p>
              <p className="flex justify-between border-t border-slate-100 pt-1 font-semibold text-slate-900">
                <span>Total</span>
                <span className="tabular-nums">{inr(TOTAL)}</span>
              </p>
            </div>
            <p className="mt-2 flex items-center gap-1.5 text-[11px] font-medium text-emerald-700">
              <CheckCircle2 className="size-3.5" aria-hidden />
              Paid automatically on 7 Nov · receipt sent
            </p>
          </motion.div>
        </div>
      </PhoneFrame>

      <motion.div
        {...rise(0.35)}
        className="relative mx-3 -mt-4 flex max-w-[250px] items-center gap-2 rounded-xl border border-slate-200 bg-white p-2.5 text-[11px] text-slate-700 shadow-lift sm:absolute sm:-bottom-10 sm:-right-10 sm:mx-0 sm:mt-0"
      >
        <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
          <ShieldCheck className="size-3.5" aria-hidden />
        </span>
        <span>
          <span className="block font-semibold text-slate-900">Owner view</span>
          <span className="block text-slate-500">18 residents on AutoPay · 0 failed</span>
        </span>
      </motion.div>
    </div>
  )
}
