'use client'

import * as React from 'react'
import { AnimatePresence, animate, motion, useInView, useReducedMotion } from 'framer-motion'
import {
  BedDouble,
  CalendarCheck,
  CheckCircle2,
  IndianRupee,
  KeyRound,
  Pause,
  Play,
  ReceiptText,
  TrendingUp,
  Wrench,
  MessageSquareWarning,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { EASE_OUT } from '@/components/motion/reveal'
import { BED_STYLES, Pill, SectionHeading, type BedState, type Tone } from './kit'

type Step = { key: string; label: string; icon: LucideIcon; detail: string }

const STEPS: Step[] = [
  { key: 'vacant', label: 'Vacant bed', icon: BedDouble, detail: 'Bed 204-A shows as available the moment it frees up.' },
  { key: 'booking', label: 'Booking', icon: CalendarCheck, detail: 'An enquiry books the bed with an advance — it turns Reserved.' },
  { key: 'checkin', label: 'Check-in', icon: KeyRound, detail: 'Arjun checks in. The bed turns Occupied and his profile is created.' },
  { key: 'rent', label: 'Rent generated', icon: ReceiptText, detail: 'His monthly rent is generated automatically on the due date.' },
  { key: 'payment', label: 'Payment', icon: IndianRupee, detail: 'He pays by UPI. The payment is verified and the invoice marked paid.' },
  { key: 'complaint', label: 'Complaint', icon: MessageSquareWarning, detail: 'He raises “Fan not working” from the resident app.' },
  { key: 'resolution', label: 'Worker resolution', icon: Wrench, detail: 'Ravi is assigned, fixes it, and closes the ticket with a photo.' },
  { key: 'profit', label: 'Profit update', icon: TrendingUp, detail: 'This month’s profit updates on its own. No notebook, no calls.' },
]

const STEP_MS = 2800
const LAST = STEPS.length - 1

/**
 * "How StayFlow works": an auto-playing, scroll-triggered sequence in which
 * the product UI itself moves through a bed's life — vacant to profit. With
 * reduced motion it starts on the finished state and only changes on click.
 */
export function StorySection() {
  const reduce = useReducedMotion()
  const ref = React.useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { margin: '-20% 0px -20% 0px' })
  const [step, setStep] = React.useState(reduce ? LAST : 0)
  const [phase, setPhase] = React.useState<0 | 1>(reduce ? 1 : 0)
  const [paused, setPaused] = React.useState(false)
  const playing = inView && !paused && !reduce

  React.useEffect(() => {
    if (reduce) {
      setStep(LAST)
      setPhase(1)
    }
  }, [reduce])

  // Each step has two beats (e.g. OPEN → ASSIGNED) before moving on.
  React.useEffect(() => {
    if (!playing) return
    const half = window.setTimeout(() => setPhase(1), STEP_MS / 2)
    const next = window.setTimeout(
      () => {
        setPhase(0)
        setStep((s) => (s >= LAST ? 0 : s + 1))
      },
      step === LAST ? STEP_MS * 1.8 : STEP_MS,
    )
    return () => {
      window.clearTimeout(half)
      window.clearTimeout(next)
    }
  }, [playing, step])

  function jump(i: number) {
    setPaused(true)
    setStep(i)
    setPhase(1)
  }

  return (
    <section id="how" aria-labelledby="how-title" className="relative scroll-mt-24 overflow-hidden bg-slate-950 py-20 text-white sm:py-28">
      <div className="mesh-blue absolute inset-0 opacity-50" aria-hidden />
      <div className="dot-grid absolute inset-0 opacity-[0.08] invert" aria-hidden />

      <div className="relative mx-auto w-full max-w-6xl px-4 sm:px-6">
        <SectionHeading
          dark
          eyebrow="Live product preview"
          title={<span id="how-title">One bed. Every step. Handled.</span>}
          description="Watch a single bed move through StayFlow — from vacant to profit. Every screen updates the next one, so nothing is typed twice and nothing falls through."
        />

        <div ref={ref} className="mt-14 grid gap-8 lg:grid-cols-[300px_1fr] lg:gap-10">
          {/* --------------------------------------------- Step rail */}
          <div className="min-w-0">
            <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-1">
              {STEPS.map((s, i) => {
                const Icon = s.icon
                const active = i === step
                const done = i < step
                return (
                  <li key={s.key} className="min-w-0">
                    <button
                      type="button"
                      onClick={() => jump(i)}
                      aria-current={active ? 'step' : undefined}
                      className={cn(
                        'relative flex w-full min-w-0 items-center gap-2.5 overflow-hidden rounded-xl border px-3 py-2.5 text-left transition-colors',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400',
                        active
                          ? 'border-blue-400/50 bg-white/10 text-white'
                          : done
                            ? 'border-white/10 bg-white/[0.04] text-white/70'
                            : 'border-white/5 text-white/45 hover:text-white/75',
                      )}
                    >
                      <span
                        className={cn(
                          'flex size-7 shrink-0 items-center justify-center rounded-lg',
                          active ? 'bg-blue-500 text-white' : done ? 'bg-emerald-500/20 text-emerald-300' : 'bg-white/5',
                        )}
                      >
                        {done ? <CheckCircle2 className="size-3.5" aria-hidden /> : <Icon className="size-3.5" aria-hidden />}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[10px] font-semibold uppercase tracking-wider text-white/40">Step {i + 1}</span>
                        <span className="block truncate text-sm font-semibold">{s.label}</span>
                      </span>
                      {active && playing && (
                        <motion.span
                          key={`bar-${step}`}
                          className="absolute bottom-0 left-0 h-0.5 bg-gradient-to-r from-blue-400 to-violet-400"
                          initial={{ width: '0%' }}
                          animate={{ width: '100%' }}
                          transition={{ duration: (step === LAST ? STEP_MS * 1.8 : STEP_MS) / 1000, ease: 'linear' }}
                        />
                      )}
                    </button>
                  </li>
                )
              })}
            </ol>

            {!reduce && (
              <button
                type="button"
                onClick={() => setPaused((p) => !p)}
                className="mt-3 inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-white/55 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
              >
                {paused ? <Play className="size-3.5" aria-hidden /> : <Pause className="size-3.5" aria-hidden />}
                {paused ? 'Play the story' : 'Pause'}
              </button>
            )}
          </div>

          {/* ------------------------------------------------ Stage */}
          <div className="min-w-0">
            <p className="min-h-[3rem] text-base font-medium text-white/80 sm:text-lg" aria-live="polite">
              <span className="mr-2 font-display font-bold text-blue-300">{step + 1}.</span>
              {STEPS[step].detail}
            </p>
            <Stage step={step} phase={phase} />
          </div>
        </div>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------- Stage ----

function Stage({ step, phase }: { step: number; phase: 0 | 1 }) {
  const bed: BedState = step === 0 ? 'available' : step === 1 ? 'reserved' : 'occupied'

  const invoice =
    step < 3
      ? null
      : step === 3
        ? ({ label: '₹9,000 Due', tone: 'amber', note: 'Due 5 Nov · reminder scheduled' } as const)
        : step === 4 && phase === 0
          ? ({ label: 'Payment verified', tone: 'blue', note: 'UPI · ref 4182…93 · verifying with gateway' } as const)
          : ({ label: '₹9,000 Paid', tone: 'green', note: 'Receipt #SF-1042 sent to Arjun' } as const)

  const complaint: { label: string; tone: Tone } | null =
    step < 5
      ? null
      : step === 5
        ? phase === 0
          ? { label: 'OPEN', tone: 'red' }
          : { label: 'ASSIGNED', tone: 'blue' }
        : step === 6 && phase === 0
          ? { label: 'IN PROGRESS', tone: 'amber' }
          : { label: 'RESOLVED', tone: 'green' }

  const focus = ['bed', 'resident', 'resident', 'invoice', 'invoice', 'complaint', 'complaint', 'profit'][step]

  return (
    <div aria-hidden className="mt-4 grid gap-3 sm:grid-cols-2">
      {/* Bed */}
      <StageCard focus={focus === 'bed'} title="Bed 204-A" icon={BedDouble} meta="Floor 2 · 3-sharing">
        <div className="flex items-center gap-3">
          <motion.div
            key={bed}
            initial={{ scale: 0.8, opacity: 0.4 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 380, damping: 20 }}
            className={cn('flex size-14 shrink-0 items-center justify-center rounded-xl border-2 font-display text-sm font-bold', BED_STYLES[bed].tile)}
          >
            204A
          </motion.div>
          <div className="min-w-0 space-y-1.5">
            <Swap id={bed}>
              <Pill tone={BED_STYLES[bed].tone}>{BED_STYLES[bed].label}</Pill>
            </Swap>
            <p className="text-xs text-slate-500">₹9,000 / month · AC</p>
          </div>
        </div>
      </StageCard>

      {/* Booking / resident */}
      <StageCard focus={focus === 'resident'} title={step < 2 ? 'Booking' : 'Resident'} icon={step < 2 ? CalendarCheck : KeyRound} meta={step === 0 ? 'Waiting' : step === 1 ? 'Confirmed' : 'Checked in'}>
        <Swap id={step === 0 ? 'none' : step === 1 ? 'booked' : 'in'}>
          {step === 0 ? (
            <p className="py-3 text-sm text-slate-400">No booking yet — the bed is listed as vacant.</p>
          ) : (
            <div className="flex items-center gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-violet-500 text-sm font-bold text-white">
                AK
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-900">Arjun Kumar</p>
                <p className="truncate text-xs text-slate-500">
                  {step === 1 ? 'Advance ₹5,000 · joins 1 Nov' : 'Checked in 1 Nov · KYC done'}
                </p>
              </div>
              <span className="ml-auto">
                <Pill tone={step === 1 ? 'blue' : 'indigo'}>{step === 1 ? 'Booked' : 'Active'}</Pill>
              </span>
            </div>
          )}
        </Swap>
      </StageCard>

      {/* Invoice */}
      <StageCard focus={focus === 'invoice'} title="November rent" icon={ReceiptText} meta="Auto-generated">
        <Swap id={invoice?.label ?? 'none'}>
          {invoice ? (
            <div>
              <div className="flex items-center justify-between gap-2">
                <p className="font-display text-xl font-bold text-slate-900 tabular">₹9,000</p>
                <Pill tone={invoice.tone}>{invoice.label}</Pill>
              </div>
              <p className="mt-1 truncate text-xs text-slate-500">{invoice.note}</p>
            </div>
          ) : (
            <p className="py-3 text-sm text-slate-400">Generated automatically on the due date.</p>
          )}
        </Swap>
      </StageCard>

      {/* Complaint */}
      <StageCard focus={focus === 'complaint'} title="Complaint #318" icon={Wrench} meta="Electrical">
        <Swap id={complaint?.label ?? 'none'}>
          {complaint ? (
            <div>
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-sm font-semibold text-slate-900">Fan not working</p>
                <Pill tone={complaint.tone}>{complaint.label}</Pill>
              </div>
              <p className="mt-1 truncate text-xs text-slate-500">
                {complaint.label === 'OPEN'
                  ? 'Raised by Arjun · Room 204'
                  : complaint.label === 'RESOLVED'
                    ? 'Fixed by Ravi · photo attached · 42 min'
                    : 'Assigned to Ravi (maintenance)'}
              </p>
            </div>
          ) : (
            <p className="py-3 text-sm text-slate-400">No open complaints for this room.</p>
          )}
        </Swap>
      </StageCard>

      {/* Profit */}
      <div
        className={cn(
          'relative overflow-hidden rounded-2xl border p-4 transition-all duration-500 sm:col-span-2',
          focus === 'profit'
            ? 'border-emerald-300/60 bg-gradient-to-br from-emerald-50 to-white shadow-[0_0_0_4px_rgb(16_185_129/0.15)]'
            : 'border-white/10 bg-white',
        )}
      >
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-500">
              <TrendingUp className="size-3.5 text-emerald-600" />
              Profit this month · Sree Balaji PG
            </p>
            <p className="mt-1 font-display text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">
              <Counter value={step === LAST ? 127400 : 118400} />
            </p>
          </div>
          <div className="flex gap-4 text-xs">
            <div>
              <p className="text-slate-400">Occupancy</p>
              <p className="font-semibold text-violet-700 tabular">{step >= 2 ? '43 / 48' : '42 / 48'}</p>
            </div>
            <div>
              <p className="text-slate-400">Collected</p>
              <p className="font-semibold text-emerald-700 tabular">{step >= 4 && !(step === 4 && phase === 0) ? '₹3.29L' : '₹3.20L'}</p>
            </div>
            <div>
              <p className="text-slate-400">Open tickets</p>
              <p className="font-semibold text-slate-700 tabular">{step === 5 || (step === 6 && phase === 0) ? '4' : '3'}</p>
            </div>
          </div>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
          <motion.div
            className="h-full rounded-full bg-gradient-to-r from-blue-500 via-violet-500 to-emerald-500"
            animate={{ width: step === LAST ? '78%' : '72%' }}
            transition={{ duration: 1, ease: EASE_OUT }}
          />
        </div>
      </div>
    </div>
  )
}

function StageCard({
  focus,
  title,
  icon: Icon,
  meta,
  children,
}: {
  focus: boolean
  title: string
  icon: LucideIcon
  meta: string
  children: React.ReactNode
}) {
  return (
    <motion.div
      animate={{ scale: focus ? 1.02 : 1 }}
      transition={{ type: 'spring', stiffness: 300, damping: 24 }}
      className={cn(
        'min-w-0 rounded-2xl border bg-white p-4 text-slate-900 transition-shadow duration-500',
        focus ? 'border-blue-300 shadow-[0_0_0_4px_rgb(104_99_238/0.25),0_20px_40px_-20px_rgb(82_72_224/0.6)]' : 'border-white/10',
      )}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-slate-700">
          <Icon className="size-3.5 shrink-0 text-blue-600" />
          <span className="truncate">{title}</span>
        </p>
        <span className="shrink-0 text-[10px] text-slate-400">{meta}</span>
      </div>
      <div className="min-h-[52px]">{children}</div>
    </motion.div>
  )
}

/** Cross-fades content whenever `id` changes. */
function Swap({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={id}
        initial={{ opacity: 0, y: 6, filter: 'blur(3px)' }}
        animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
        exit={{ opacity: 0, y: -6, filter: 'blur(3px)' }}
        transition={{ duration: 0.28, ease: EASE_OUT }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  )
}

/** A rupee figure that ticks to its new value. */
function Counter({ value }: { value: number }) {
  const reduce = useReducedMotion()
  const [shown, setShown] = React.useState(value)
  const from = React.useRef(value)

  React.useEffect(() => {
    if (reduce) {
      setShown(value)
      from.current = value
      return
    }
    const controls = animate(from.current, value, {
      duration: 1.2,
      ease: EASE_OUT,
      onUpdate: (v) => setShown(Math.round(v)),
    })
    from.current = value
    return () => controls.stop()
  }, [value, reduce])

  return <span className="tabular">₹{new Intl.NumberFormat('en-IN').format(shown)}</span>
}
