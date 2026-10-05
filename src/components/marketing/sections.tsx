'use client'

import * as React from 'react'
import { motion } from 'framer-motion'
import {
  ArrowDown,
  ArrowRight,
  Bed,
  Bell,
  BookText,
  Building2,
  ChartNoAxesCombined,
  CheckCircle2,
  CreditCard,
  MessageSquare,
  Phone,
  Receipt,
  ShoppingCart,
  Smartphone,
  Sparkles,
  UserRound,
  Users,
  Utensils,
  Wallet,
  Wrench,
} from 'lucide-react'
import { cn, formatMoney } from '@/lib/utils'
import { Button } from '@/components/ui/button'

/** Shared section frame: eyebrow, heading, supporting line. */
export function SectionHeading({
  eyebrow,
  title,
  description,
  center = true,
  className,
}: {
  eyebrow?: string
  title: string
  description?: string
  center?: boolean
  className?: string
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-80px' }}
      transition={{ duration: 0.45 }}
      className={cn('max-w-2xl', center && 'mx-auto text-center', className)}
    >
      {eyebrow && (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600">
          {eyebrow}
        </span>
      )}
      <h2 className="mt-4 font-display text-3xl font-bold tracking-tight text-slate-900 text-balance sm:text-4xl">
        {title}
      </h2>
      {description && (
        <p className="mt-4 text-lg leading-relaxed text-slate-600 text-pretty">{description}</p>
      )}
    </motion.div>
  )
}

// ---------------------------------------------------------------- Problem ---

const PROBLEMS = [
  {
    icon: BookText,
    emoji: '📒',
    title: 'The notebook',
    items: ['Resident details', 'Rent records', 'Room allocation', 'Expenses'],
    pain: 'One spill, one lost page, and a year of records is gone.',
  },
  {
    icon: MessageSquare,
    emoji: '📱',
    title: 'WhatsApp',
    items: ['Rent reminders', 'Complaints', 'Announcements', 'Worker coordination'],
    pain: 'Complaints get buried under 200 other messages.',
  },
  {
    icon: Phone,
    emoji: '📞',
    title: 'Phone calls',
    items: ['Payment follow-ups', 'Maintenance', 'Food coordination', 'Staff coordination'],
    pain: 'The same five calls, every single day.',
  },
]

export function ProblemSection() {
  return (
    <section className="py-20 sm:py-28">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <SectionHeading
          eyebrow="The way most PGs run today"
          title="Is your PG still running on notebooks, WhatsApp and phone calls?"
          description="Every one of them works — until you have two PGs, a hundred residents and four workers. Then the gaps start to cost real money."
        />

        <div className="mt-14 grid gap-5 lg:grid-cols-3">
          {PROBLEMS.map((problem, i) => (
            <motion.div
              key={problem.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-60px' }}
              transition={{ duration: 0.45, delay: i * 0.1 }}
              className="group relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 shadow-card transition-shadow hover:shadow-elevated"
            >
              <div className="flex items-center gap-3">
                <span className="text-3xl" aria-hidden>
                  {problem.emoji}
                </span>
                <h3 className="font-display text-lg font-semibold text-slate-900">
                  {problem.title}
                </h3>
              </div>

              <ul className="mt-4 space-y-2">
                {problem.items.map((item) => (
                  <li key={item} className="flex items-center gap-2 text-sm text-slate-600">
                    <span className="size-1 rounded-full bg-slate-300" />
                    {item}
                  </li>
                ))}
              </ul>

              <p className="mt-4 border-t border-slate-100 pt-4 text-sm italic text-slate-500">
                {problem.pain}
              </p>
            </motion.div>
          ))}
        </div>

        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ delay: 0.3 }}
          className="mt-12 flex flex-col items-center gap-4"
        >
          <ArrowDown className="size-5 animate-bounce text-slate-300" />
          <p className="text-center font-display text-xl font-semibold text-slate-900 sm:text-2xl">
            Your PG deserves a better system.
          </p>
          <Button variant="primary" size="lg" asChild>
            <a href="#demo">
              Book a free demo
              <ArrowRight className="size-4" />
            </a>
          </Button>
        </motion.div>
      </div>
    </section>
  )
}

// --------------------------------------------------------------- Solution ---

const MODULES = [
  {
    icon: UserRound,
    title: 'Residents',
    body: 'Add a resident once. Their room, rent, food plan, deposit and app account are connected automatically.',
  },
  {
    icon: Bed,
    title: 'Rooms & beds',
    body: 'A live bed map. Occupancy updates the moment someone checks in or out — nothing to recount.',
  },
  {
    icon: Wallet,
    title: 'Rent & payments',
    body: 'Invoices generate monthly, reminders go out on their own, and receipts and ledgers stay in step.',
  },
  {
    icon: Wrench,
    title: 'Complaints',
    body: 'Residents raise issues from the app. Workers get tasks. You see progress without asking anyone.',
  },
  {
    icon: Utensils,
    title: 'Food',
    body: 'Meal counts come from who is actually subscribed, not from a head count at the door.',
  },
  {
    icon: ShoppingCart,
    title: 'Grocery',
    body: 'Stock, low-stock alerts and a purchase list worked out from your real meal counts.',
  },
  {
    icon: Users,
    title: 'Staff',
    body: 'Attendance, salaries and a simple task list your workers can actually use.',
  },
  {
    icon: Receipt,
    title: 'Expenses',
    body: 'Record what you spend once; the profit estimate and reports follow.',
  },
  {
    icon: ChartNoAxesCombined,
    title: 'Reports',
    body: 'Occupancy, collections, pending rent and profit — without opening a notebook.',
  },
]

export function SolutionSection() {
  const [active, setActive] = React.useState<number | null>(null)

  return (
    <section id="features" className="scroll-mt-20 bg-slate-50/70 py-20 sm:py-28">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <SectionHeading
          eyebrow="One platform"
          title="One platform. Your entire PG."
          description="Every module writes to the same database, so entering something once updates everything attached to it."
        />

        <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {MODULES.map((module, i) => {
            const Icon = module.icon
            const open = active === i
            return (
              <motion.button
                key={module.title}
                type="button"
                onClick={() => setActive(open ? null : i)}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-40px' }}
                transition={{ duration: 0.4, delay: (i % 3) * 0.08 }}
                className={cn(
                  'group rounded-2xl border bg-white p-5 text-left transition-all',
                  open
                    ? 'border-blue-300 shadow-elevated ring-2 ring-blue-500/10'
                    : 'border-slate-200 shadow-card hover:border-slate-300 hover:shadow-elevated',
                )}
              >
                <div
                  className={cn(
                    'flex size-10 items-center justify-center rounded-xl transition-colors',
                    open ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600',
                  )}
                >
                  <Icon className="size-5" />
                </div>
                <h3 className="mt-3 font-display text-base font-semibold text-slate-900">
                  {module.title}
                </h3>
                <motion.p
                  initial={false}
                  animate={{ height: open ? 'auto' : 0, opacity: open ? 1 : 0 }}
                  className="overflow-hidden text-sm leading-relaxed text-slate-600"
                >
                  <span className="block pt-2">{module.body}</span>
                </motion.p>
                {!open && (
                  <p className="mt-1 text-xs text-slate-400 group-hover:text-blue-600">
                    Tap to see what it does
                  </p>
                )}
              </motion.button>
            )
          })}
        </div>
      </div>
    </section>
  )
}

// ------------------------------------------------------------- Automation ---

const WORKFLOWS = [
  {
    trigger: 'A resident checks in',
    steps: [
      'Bed marked occupied',
      'Room, floor and PG occupancy updated',
      'Rent schedule created and pro-rated',
      'Deposit ledger opened',
      'Food plan activated',
      'Resident app account created',
    ],
    tone: 'blue' as const,
    icon: UserRound,
  },
  {
    trigger: 'Rent falls due',
    steps: [
      'Reminder 3 days before',
      'Reminder on the due date',
      'Payment link and UPI QR included',
      'Payment verified by the gateway',
      'Invoice marked paid, receipt issued',
      'Ledger and dashboard updated',
    ],
    tone: 'emerald' as const,
    icon: Wallet,
  },
  {
    trigger: 'A resident raises a complaint',
    steps: [
      'You are notified instantly',
      'You assign a worker',
      'Worker gets it in their app',
      'Worker marks it done',
      'Resident is told what was fixed',
      'Complaint closes itself',
    ],
    tone: 'amber' as const,
    icon: Wrench,
  },
]

export function AutomationSection() {
  return (
    <section id="how" className="scroll-mt-20 py-20 sm:py-28">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <SectionHeading
          eyebrow="Automation"
          title="Stop managing. Start automating."
          description="These are not features you operate — they are chains that run themselves once the first thing is entered."
        />

        <div className="mt-14 grid gap-6 lg:grid-cols-3">
          {WORKFLOWS.map((workflow, i) => {
            const Icon = workflow.icon
            const tones = {
              blue: 'from-blue-600 to-sky-500',
              emerald: 'from-emerald-600 to-teal-500',
              amber: 'from-amber-500 to-orange-500',
            }
            return (
              <motion.div
                key={workflow.trigger}
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-60px' }}
                transition={{ duration: 0.5, delay: i * 0.12 }}
                className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-card"
              >
                <div className={cn('bg-gradient-to-br p-5 text-white', tones[workflow.tone])}>
                  <Icon className="size-5" />
                  <p className="mt-2 text-xs uppercase tracking-wide text-white/70">Trigger</p>
                  <p className="font-display text-lg font-semibold">{workflow.trigger}</p>
                </div>

                <ol className="space-y-0 p-5">
                  {workflow.steps.map((step, index) => (
                    <motion.li
                      key={step}
                      initial={{ opacity: 0, x: -8 }}
                      whileInView={{ opacity: 1, x: 0 }}
                      viewport={{ once: true }}
                      transition={{ delay: 0.15 + index * 0.06 }}
                      className="relative flex gap-3 pb-4 last:pb-0"
                    >
                      {index < workflow.steps.length - 1 && (
                        <span className="absolute left-[9px] top-5 h-full w-px bg-slate-200" />
                      )}
                      <span className="relative z-10 mt-1 flex size-[18px] shrink-0 items-center justify-center rounded-full bg-emerald-100 ring-4 ring-white">
                        <CheckCircle2 className="size-3 text-emerald-600" strokeWidth={3} />
                      </span>
                      <span className="text-sm text-slate-600">{step}</span>
                    </motion.li>
                  ))}
                </ol>
              </motion.div>
            )
          })}
        </div>

        <p className="mx-auto mt-10 max-w-2xl text-center text-sm text-slate-500">
          WhatsApp delivery and online payments need your own WhatsApp Business and payment
          gateway accounts connected. Until they are, the app clearly shows what would be sent
          rather than pretending it went out.
        </p>
      </div>
    </section>
  )
}

// ------------------------------------------------------- Rent automation ---

export function RentSection() {
  return (
    <section className="bg-slate-50/70 py-20 sm:py-28">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <div className="grid items-center gap-12 lg:grid-cols-2">
          <div>
            <SectionHeading
              center={false}
              eyebrow="Rent automation"
              title="Never chase rent again."
              description="Invoices generate themselves on the 1st. Reminders go out before the due date, on it, and after it. When money arrives, the receipt and the ledger update in the same breath."
            />

            <ul className="mt-8 space-y-3">
              {[
                'Rent schedules created at check-in, pro-rated from the joining date',
                'Reminders before due, on due and after due — configurable',
                'Payment link and UPI QR inside the message',
                'Payment confirmed by the gateway, never by the browser',
                'Receipt, ledger, dashboard and reports update together',
                'Late fees applied automatically after your grace period',
              ].map((item) => (
                <motion.li
                  key={item}
                  initial={{ opacity: 0, x: -10 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.4 }}
                  className="flex items-start gap-2.5 text-slate-700"
                >
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" />
                  <span className="text-sm leading-relaxed">{item}</span>
                </motion.li>
              ))}
            </ul>
          </div>

          {/* Phone mock with the actual reminder text */}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-60px' }}
            transition={{ duration: 0.55 }}
            className="mx-auto w-full max-w-[320px]"
          >
            <div className="rounded-[2.2rem] border-[10px] border-slate-900 bg-slate-900 shadow-float">
              <div className="overflow-hidden rounded-[1.5rem] bg-[#ece5dd]">
                <div className="flex items-center gap-2 bg-[#075e54] px-4 py-3 text-white">
                  <div className="flex size-8 items-center justify-center rounded-full bg-white/20 text-xs font-bold">
                    SF
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">StayFlow Men&apos;s Residence</p>
                    <p className="text-[10px] text-white/70">business account</p>
                  </div>
                </div>

                <div className="space-y-2 p-3">
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: 0.25 }}
                    className="max-w-[85%] rounded-xl rounded-tl-sm bg-white p-3 shadow-sm"
                  >
                    <p className="whitespace-pre-line text-[13px] leading-relaxed text-slate-800">
                      {`Hi Arun 👋

Your PG rent of ${formatMoney(8500)} is due on 10 October 2026.

PG: StayFlow Men's Residence
Room: 204 · Bed A
Amount: ${formatMoney(8500)}
Due date: 10 October 2026`}
                    </p>
                    <button
                      type="button"
                      className="mt-2 w-full rounded-lg bg-[#25d366] px-3 py-1.5 text-xs font-semibold text-white"
                    >
                      Pay rent
                    </button>
                    <p className="mt-1 text-right text-[9px] text-slate-400">9:00 AM</p>
                  </motion.div>

                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: 0.55 }}
                    className="ml-auto max-w-[70%] rounded-xl rounded-tr-sm bg-[#dcf8c6] p-3 shadow-sm"
                  >
                    <p className="text-[13px] text-slate-800">Paid just now 👍</p>
                    <p className="mt-1 text-right text-[9px] text-slate-400">9:04 AM</p>
                  </motion.div>

                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: 0.85 }}
                    className="max-w-[85%] rounded-xl rounded-tl-sm bg-white p-3 shadow-sm"
                  >
                    <p className="whitespace-pre-line text-[13px] leading-relaxed text-slate-800">
                      {`We have received your payment of ${formatMoney(8500)}.
Receipt: RCP-202610-0042

Thank you.`}
                    </p>
                    <p className="mt-1 text-right text-[9px] text-slate-400">9:04 AM</p>
                  </motion.div>
                </div>
              </div>
            </div>
            <p className="mt-3 text-center text-xs text-slate-500">
              Example of an automated reminder. Delivery requires a connected WhatsApp Business
              account.
            </p>
          </motion.div>
        </div>
      </div>
    </section>
  )
}

// ----------------------------------------------------------- Resident app ---

export function ResidentAppSection() {
  return (
    <section id="residents" className="scroll-mt-20 py-20 sm:py-28">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <SectionHeading
          eyebrow="Resident app"
          title="Give your residents their own PG app."
          description="They stop calling you for every small thing — because they can see and do it themselves."
        />

        <div className="mt-14 grid items-center gap-12 lg:grid-cols-2">
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: '-60px' }}
            transition={{ duration: 0.5 }}
            className="order-2 lg:order-1"
          >
            <div className="space-y-3">
              {[
                { icon: Wallet, title: 'Pay rent', body: 'See what is due, pay by UPI, get the receipt instantly.' },
                { icon: Wrench, title: 'Raise a complaint', body: 'Pick the category, describe it, and watch it move to resolved.' },
                { icon: Utensils, title: 'See the menu', body: 'This week\'s meals, and a switch to skip one so the kitchen knows.' },
                { icon: Bell, title: 'Get announcements', body: 'Water tank cleaning, menu changes — in the app, not in a group chat.' },
                { icon: Receipt, title: 'Check their account', body: 'Every charge, payment and the deposit you are holding.' },
              ].map((item, i) => {
                const Icon = item.icon
                return (
                  <motion.div
                    key={item.title}
                    initial={{ opacity: 0, y: 12 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: i * 0.08 }}
                    className="flex gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-card"
                  >
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-blue-50">
                      <Icon className="size-5 text-blue-600" />
                    </div>
                    <div>
                      <p className="font-display text-sm font-semibold text-slate-900">
                        {item.title}
                      </p>
                      <p className="text-sm text-slate-600">{item.body}</p>
                    </div>
                  </motion.div>
                )
              })}
            </div>

            <div className="mt-6 rounded-2xl border border-blue-100 bg-blue-50/60 p-5">
              <p className="font-display text-base font-semibold text-blue-900">
                &ldquo;Residents don&apos;t need to call you for every small issue.&rdquo;
              </p>
              <p className="mt-1 text-sm text-blue-800/80">
                Bathroom tap leaking → photo → submit. You are notified, a worker is assigned, and
                the resident sees it resolved — with nobody dialling a number.
              </p>
            </div>
          </motion.div>

          {/* Phone preview */}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-60px' }}
            transition={{ duration: 0.55 }}
            className="order-1 mx-auto w-full max-w-[300px] lg:order-2"
          >
            <div className="rounded-[2.2rem] border-[10px] border-slate-900 bg-slate-900 shadow-float">
              <div className="overflow-hidden rounded-[1.5rem] bg-slate-50">
                <div className="bg-gradient-to-br from-blue-600 to-sky-500 p-4 text-white">
                  <p className="text-xs text-white/75">Good morning,</p>
                  <p className="font-display text-xl font-semibold">Arun</p>
                  <div className="mt-3 grid grid-cols-3 gap-1.5">
                    {[
                      { label: 'PG', value: "Men's" },
                      { label: 'Room', value: '204/A' },
                      { label: 'Rent', value: '₹8.5K' },
                    ].map((tile) => (
                      <div
                        key={tile.label}
                        className="rounded-lg border border-white/15 bg-white/10 p-1.5 backdrop-blur"
                      >
                        <p className="text-[8px] uppercase text-white/60">{tile.label}</p>
                        <p className="text-[11px] font-semibold">{tile.value}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="space-y-2 p-3">
                  <div className="rounded-xl border border-amber-200 bg-white p-3">
                    <p className="text-[9px] uppercase tracking-wide text-slate-400">Rent due</p>
                    <p className="font-display text-xl font-semibold text-slate-900">
                      {formatMoney(8500)}
                    </p>
                    <p className="text-[10px] text-slate-500">Due in 3 days · 10 October</p>
                    <button
                      type="button"
                      className="mt-2 w-full rounded-lg bg-blue-600 py-1.5 text-[11px] font-semibold text-white"
                    >
                      Pay ₹8,500
                    </button>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-white p-3">
                    <p className="flex items-center gap-1 text-[11px] font-semibold text-slate-800">
                      <Utensils className="size-3 text-orange-500" />
                      Today&apos;s menu
                    </p>
                    <p className="mt-1 text-[10px] text-slate-600">
                      Breakfast · Idli, sambar, chutney
                    </p>
                    <p className="text-[10px] text-slate-600">Lunch · Rice, sambar, poriyal</p>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-white p-3">
                    <p className="flex items-center gap-1 text-[11px] font-semibold text-slate-800">
                      <Wrench className="size-3 text-slate-400" />
                      Your complaint
                    </p>
                    <p className="mt-1 text-[10px] text-slate-600">Bathroom tap is leaking</p>
                    <span className="mt-1 inline-block rounded-full bg-emerald-50 px-1.5 py-0.5 text-[9px] font-medium text-emerald-700">
                      Resolved
                    </span>
                  </div>
                </div>

                <div className="flex justify-around border-t border-slate-200 bg-white px-2 py-2">
                  {[Smartphone, Wallet, Wrench, Utensils, UserRound].map((Icon, i) => (
                    <Icon
                      key={i}
                      className={cn('size-4', i === 0 ? 'text-blue-600' : 'text-slate-300')}
                    />
                  ))}
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  )
}

// ---------------------------------------------------------- Multi-PG + ops ---

export function MultiPgSection() {
  return (
    <section className="bg-slate-950 py-20 text-white sm:py-28">
      <div className="mesh-blue absolute inset-x-0 opacity-30" aria-hidden />
      <div className="relative mx-auto w-full max-w-6xl px-4 sm:px-6">
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.45 }}
          className="mx-auto max-w-2xl text-center"
        >
          <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-medium text-white/80 backdrop-blur">
            <Building2 className="size-3" />
            Multiple properties
          </span>
          <h2 className="mt-4 font-display text-3xl font-bold tracking-tight text-balance sm:text-4xl">
            Manage multiple PGs from one login.
          </h2>
          <p className="mt-4 text-lg leading-relaxed text-white/70 text-pretty">
            Switch between properties from one selector. Each PG carries its own identity, rent
            configuration and numbers — and you can still see them side by side.
          </p>
        </motion.div>

        <div className="mt-14 grid gap-5 lg:grid-cols-2">
          {[
            {
              name: "StayFlow Men's Residence",
              tone: 'blue' as const,
              residents: 72,
              occupancy: 86,
              collection: 520000,
              pending: 18000,
            },
            {
              name: "StayFlow Women's Residence",
              tone: 'pink' as const,
              residents: 56,
              occupancy: 78,
              collection: 320000,
              pending: 14000,
            },
          ].map((pg, i) => (
            <motion.div
              key={pg.name}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-60px' }}
              transition={{ duration: 0.5, delay: i * 0.12 }}
              className="overflow-hidden rounded-2xl border border-white/10 bg-white/5 backdrop-blur"
            >
              <div
                className={cn(
                  'bg-gradient-to-r p-5',
                  pg.tone === 'blue'
                    ? 'from-blue-600 to-sky-500'
                    : 'from-pink-600 via-rose-500 to-fuchsia-500',
                )}
              >
                <p className="font-display text-lg font-semibold">{pg.name}</p>
                <p className="text-sm text-white/75">
                  {pg.tone === 'blue' ? 'Blue identity' : 'Pink identity'} · {pg.residents} residents
                </p>
              </div>
              <div className="grid grid-cols-3 gap-3 p-5">
                <Tile label="Occupancy" value={`${pg.occupancy}%`} />
                <Tile label="Collected" value={formatMoney(pg.collection, { compact: true })} />
                <Tile label="Pending" value={formatMoney(pg.pending, { compact: true })} />
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-center">
      <p className="font-display text-lg font-semibold tabular">{value}</p>
      <p className="text-[10px] uppercase tracking-wide text-white/50">{label}</p>
    </div>
  )
}

// ------------------------------------------------------- Food & maintenance ---

export function OperationsSection() {
  return (
    <section className="py-20 sm:py-28">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <div className="grid gap-12 lg:grid-cols-2">
          <div>
            <SectionHeading
              center={false}
              eyebrow="Food & grocery"
              title="From kitchen to grocery — stay in control."
              description="Meal counts come from who is actually on a plan today. The purchase list follows from those counts using quantities you configure — nothing about your kitchen is assumed."
            />
            <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-5 shadow-card">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <p className="text-sm font-semibold text-slate-800">Today&apos;s kitchen</p>
                <span className="text-xs text-slate-500">StayFlow Men&apos;s</span>
              </div>
              <div className="grid grid-cols-3 gap-2 py-3">
                {[
                  { meal: 'Breakfast', count: 118 },
                  { meal: 'Lunch', count: 122 },
                  { meal: 'Dinner', count: 120 },
                ].map((row) => (
                  <div key={row.meal} className="rounded-xl bg-slate-50 p-3 text-center">
                    <p className="font-display text-xl font-semibold text-slate-900 tabular">
                      {row.count}
                    </p>
                    <p className="text-[10px] uppercase tracking-wide text-slate-400">{row.meal}</p>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50/70 p-3">
                <ShoppingCart className="size-4 shrink-0 text-amber-600" />
                <p className="text-xs text-amber-900">
                  <strong>3 items running low</strong> — Urad dal, coconut oil, coffee powder
                </p>
              </div>
            </div>
          </div>

          <div>
            <SectionHeading
              center={false}
              eyebrow="Maintenance"
              title="Every complaint has a clear owner."
              description="No more scrolling through WhatsApp to find out whether the plumber ever came."
            />
            <div className="mt-8 space-y-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-card">
              {[
                { label: 'Resident raises it', detail: 'Bathroom tap leaking · Room 204', tone: 'blue' },
                { label: 'You assign a worker', detail: 'Suresh, plumber', tone: 'violet' },
                { label: 'Worker starts', detail: 'Accepted on their phone', tone: 'amber' },
                { label: 'Marked resolved', detail: 'Replaced the washer', tone: 'emerald' },
                { label: 'Resident notified', detail: 'Rated 5 out of 5', tone: 'emerald' },
              ].map((step, i, arr) => (
                <motion.div
                  key={step.label}
                  initial={{ opacity: 0, x: -10 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.1 }}
                  className="relative flex gap-3 pb-5 last:pb-0"
                >
                  {i < arr.length - 1 && (
                    <span className="absolute left-[11px] top-6 h-full w-px bg-slate-200" />
                  )}
                  <span
                    className={cn(
                      'relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full text-white ring-4 ring-white',
                      step.tone === 'blue'
                        ? 'bg-blue-500'
                        : step.tone === 'violet'
                          ? 'bg-violet-500'
                          : step.tone === 'amber'
                            ? 'bg-amber-500'
                            : 'bg-emerald-500',
                    )}
                  >
                    <CheckCircle2 className="size-3.5" strokeWidth={3} />
                  </span>
                  <div>
                    <p className="text-sm font-medium text-slate-800">{step.label}</p>
                    <p className="text-xs text-slate-500">{step.detail}</p>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

// ------------------------------------------------------------------ Trust ---

export function TrustSection() {
  return (
    <section id="reports" className="scroll-mt-20 bg-slate-50/70 py-20 sm:py-28">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <SectionHeading
          eyebrow="Reports & trust"
          title="Know what's happening in your PG — without asking anyone."
          description="Occupancy, collections, pending rent, expenses and a profit estimate, drawn from the same records your team enters every day."
        />

        <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[
            {
              icon: ChartNoAxesCombined,
              title: 'Built around real PG workflows',
              body: 'Designed from how a PG actually runs — admission forms, rent cycles, meal counts and worker tasks.',
            },
            {
              icon: Sparkles,
              title: 'PostgreSQL-backed',
              body: 'Every figure on every screen is computed from your data. Nothing on a dashboard is decorative.',
            },
            {
              icon: Users,
              title: 'Role-based access',
              body: 'Owners, managers, workers and residents each see only what belongs to them.',
            },
            {
              icon: CreditCard,
              title: 'Verified payments',
              body: 'Online rent is only marked paid from a verified gateway webhook, never from the browser.',
            },
            {
              icon: Bell,
              title: 'Full activity history',
              body: 'Every check-in, payment, complaint and setting change is logged with who did it.',
            },
            {
              icon: Building2,
              title: 'Data isolation',
              body: 'Each PG owner sees only their own organization. Access is enforced server-side on every request.',
            },
          ].map((item, i) => {
            const Icon = item.icon
            return (
              <motion.div
                key={item.title}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-40px' }}
                transition={{ duration: 0.4, delay: (i % 3) * 0.08 }}
                className="rounded-2xl border border-slate-200 bg-white p-5 shadow-card"
              >
                <div className="flex size-10 items-center justify-center rounded-xl bg-slate-100">
                  <Icon className="size-5 text-slate-600" />
                </div>
                <h3 className="mt-3 font-display text-base font-semibold text-slate-900">
                  {item.title}
                </h3>
                <p className="mt-1 text-sm leading-relaxed text-slate-600">{item.body}</p>
              </motion.div>
            )
          })}
        </div>

        <p className="mx-auto mt-10 max-w-2xl text-center text-sm text-slate-500">
          StayFlow is new. Rather than showing you invented logos or testimonials, we would rather
          walk you through your own PG&apos;s workflow on a call.
        </p>
      </div>
    </section>
  )
}
