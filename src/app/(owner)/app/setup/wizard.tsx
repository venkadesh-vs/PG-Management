'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { LogOut, Sparkles } from 'lucide-react'
import { api } from '@/lib/client'
import { cn } from '@/lib/utils'
import { useToast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/primitives'
import {
  SETUP_STEPS,
  completionPercent,
  markStep,
  needsProperty,
  nextStep,
  prevStep,
  stepIndex,
  type OnboardingData,
  type SetupStepKey,
} from './steps'
import type { StepContext, WizardSnapshot } from './ui'
import { AddressStep, BasicsStep, ConfigStep, WelcomeStep } from './steps-property'
import { BedsStep, FloorsStep, RoomsStep } from './steps-rooms'
import { DepositStep, FoodStep, PaymentsStep, RentStep } from './steps-money'
import { ImportStep, StaffStep, WhatsAppStep } from './steps-team'
import { DoneStep, ReviewStep } from './steps-final'

export type { WizardSnapshot } from './ui'

const VISIBLE = SETUP_STEPS.filter((s) => s.key !== 'welcome' && s.key !== 'done')

export function SetupWizard({ snapshot, initialStep }: { snapshot: WizardSnapshot; initialStep: SetupStepKey }) {
  const router = useRouter()
  const toast = useToast()
  const reduce = useReducedMotion()
  const [step, setStep] = React.useState<SetupStepKey>(initialStep)
  const [direction, setDirection] = React.useState(1)
  const [data, setData] = React.useState<OnboardingData>(snapshot.data)
  const [exiting, setExiting] = React.useState(false)
  const topRef = React.useRef<HTMLDivElement>(null)

  // The server snapshot is the source of truth after each refresh.
  React.useEffect(() => setData(snapshot.data), [snapshot.data])

  const percent = completionPercent(data, snapshot.completedAt)
  const answers = (data.answers ?? {}) as Record<string, unknown>

  const move = React.useCallback(
    (to: SetupStepKey) => {
      setDirection(stepIndex(to) >= stepIndex(step) ? 1 : -1)
      setStep(to)
      // Keep the URL shareable/resumable without a full navigation.
      try {
        window.history.replaceState(null, '', `/app/setup?step=${to}`)
      } catch {
        // ignore
      }
      requestAnimationFrame(() => topRef.current?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' }))
    },
    [step, reduce],
  )

  const advance: StepContext['advance'] = React.useCallback(
    async (opts = {}) => {
      const how = opts.how ?? 'complete'
      const to = nextStep(step)
      const result = await api.post<{ data: OnboardingData }>('/api/onboarding', {
        action: 'SAVE',
        step: to,
        finish: step === 'welcome' || step === 'done' ? undefined : { key: step, how },
        propertyId: opts.propertyId ?? snapshot.property?.id ?? data.propertyId,
        answers: opts.answers,
      })
      setData(result.data ?? markStep(data, step, how))
      router.refresh()
      move(to)
    },
    [step, snapshot.property?.id, data, router, move],
  )

  const back = React.useCallback(() => move(prevStep(step)), [move, step])

  const goTo = React.useCallback(
    (to: SetupStepKey) => {
      if (!snapshot.property && !data.propertyId && needsProperty(to)) {
        toast.error('Create the PG first', 'Finish the PG basics, address and configuration steps.')
        return
      }
      move(to)
    },
    [snapshot.property, data.propertyId, move, toast],
  )

  async function saveAndExit() {
    setExiting(true)
    try {
      await api.post('/api/onboarding', { action: 'SAVE', step, propertyId: snapshot.property?.id ?? data.propertyId })
      toast.success('Progress saved', 'Pick up right here from your dashboard any time.')
      router.push('/app')
    } catch (error) {
      toast.fromError(error, 'save your progress')
      setExiting(false)
    }
  }

  const propertyId = snapshot.property?.id ?? data.propertyId
  const ctx: StepContext = { snapshot, propertyId, advance, back, goTo, refresh: () => router.refresh(), answers }
  const current = SETUP_STEPS[stepIndex(step)]
  const position = VISIBLE.findIndex((s) => s.key === step)

  return (
    <div ref={topRef} className="mx-auto w-full max-w-3xl scroll-mt-20 space-y-5 pb-24 lg:pb-8">
      {/* Header + progress */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-white">
              <Sparkles className="size-4" />
            </span>
            <div className="min-w-0">
              <p className="truncate font-display text-base font-semibold text-slate-900">Set up your PG</p>
              <p className="truncate text-xs text-slate-500">
                {position >= 0 ? `Step ${position + 1} of ${VISIBLE.length} · ${current.title}` : current.title}
              </p>
            </div>
          </div>
          {step !== 'done' && (
            <Button variant="ghost" size="sm" onClick={saveAndExit} loading={exiting} className="shrink-0">
              <LogOut className="size-4" />
              <span className="hidden sm:inline">Save &amp; exit</span>
              <span className="sm:hidden">Exit</span>
            </Button>
          )}
        </div>
        <div className="flex items-center gap-3">
          <Progress value={percent} className="flex-1" />
          <span className="w-10 text-right text-xs font-semibold tabular-nums text-slate-600">{percent}%</span>
        </div>
        {/* Step dots — tap a finished step to jump back to it. */}
        <ol className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
          {VISIBLE.map((s, i) => {
            const finished = data.completed?.includes(s.key) || data.skipped?.includes(s.key)
            const active = s.key === step
            const reachable = finished || active || i <= position
            return (
              <li key={s.key} className="shrink-0">
                <button
                  type="button"
                  disabled={!reachable}
                  onClick={() => goTo(s.key)}
                  className={cn(
                    'rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors',
                    active
                      ? 'bg-blue-600 text-white'
                      : finished
                        ? data.skipped?.includes(s.key)
                          ? 'bg-slate-100 text-slate-500'
                          : 'bg-emerald-50 text-emerald-700'
                        : 'bg-white text-slate-400 ring-1 ring-slate-200',
                    reachable && !active && 'hover:ring-blue-300',
                  )}
                >
                  {s.short}
                </button>
              </li>
            )
          })}
        </ol>
      </div>

      {/* Step body */}
      <div className="relative overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <AnimatePresence mode="wait" initial={false} custom={direction}>
          <motion.div
            key={step}
            custom={direction}
            initial={reduce ? { opacity: 0 } : { opacity: 0, x: direction * 28 }}
            animate={{ opacity: 1, x: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, x: direction * -28 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="space-y-6 p-4 sm:p-7"
          >
            <StepBody step={step} ctx={ctx} />
          </motion.div>
        </AnimatePresence>
      </div>

      {step !== 'done' && (
        <p className="text-center text-xs text-slate-400">
          Your progress is saved after every step.{' '}
          <Link href="/app" className="font-medium text-slate-500 underline-offset-2 hover:underline">
            Go to dashboard
          </Link>
        </p>
      )}
    </div>
  )
}

function StepBody({ step, ctx }: { step: SetupStepKey; ctx: StepContext }) {
  switch (step) {
    case 'welcome':
      return <WelcomeStep ctx={ctx} />
    case 'basics':
      return <BasicsStep ctx={ctx} />
    case 'address':
      return <AddressStep ctx={ctx} />
    case 'config':
      return <ConfigStep ctx={ctx} />
    case 'floors':
      return <FloorsStep ctx={ctx} />
    case 'rooms':
      return <RoomsStep ctx={ctx} />
    case 'beds':
      return <BedsStep ctx={ctx} />
    case 'rent':
      return <RentStep ctx={ctx} />
    case 'deposit':
      return <DepositStep ctx={ctx} />
    case 'food':
      return <FoodStep ctx={ctx} />
    case 'payments':
      return <PaymentsStep ctx={ctx} />
    case 'whatsapp':
      return <WhatsAppStep ctx={ctx} />
    case 'staff':
      return <StaffStep ctx={ctx} />
    case 'import':
      return <ImportStep ctx={ctx} />
    case 'review':
      return <ReviewStep ctx={ctx} />
    case 'done':
      return <DoneStep ctx={ctx} />
  }
}
