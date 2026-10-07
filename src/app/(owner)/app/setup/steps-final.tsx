'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { motion, useReducedMotion } from 'framer-motion'
import { AlertTriangle, ArrowRight, CheckCircle2, CircleDashed, PartyPopper, Pencil, UserPlus } from 'lucide-react'
import { api } from '@/lib/client'
import { cn, formatMoney } from '@/lib/utils'
import { useToast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { Note, StepFooter, StepHeading, type StepContext } from './ui'
import { missingRequired, stepMeta, type SetupStepKey } from './steps'

const TYPE_LABEL = { MENS: 'Men’s PG', WOMENS: 'Women’s PG', COLIVE: 'Co-living' } as const
const MEAL_LABEL = { ALL: '3 meals', BREAKFAST_DINNER: 'Breakfast & dinner', DINNER: 'Dinner only' } as const

type Row = { step: SetupStepKey; label: string; value: React.ReactNode; ok: boolean; warn?: string }

export function ReviewStep({ ctx }: { ctx: StepContext }) {
  const toast = useToast()
  const [busy, setBusy] = React.useState(false)
  const { property, settings, facts, data } = ctx.snapshot
  const floors = property?.floors ?? []
  const rooms = floors.reduce((s, f) => s + f.rooms.length, 0)
  const beds = floors.reduce((s, f) => s + f.rooms.reduce((t, r) => t + r.beds, 0), 0)
  const skipped = new Set(data.skipped ?? [])
  const blockers = missingRequired(data).filter((k) => {
    // Real data counts too: a PG with beds needs no wizard tick for them.
    if ((k === 'basics' || k === 'address' || k === 'config') && property) return false
    if (k === 'floors' && floors.length > 0) return false
    if ((k === 'rooms' || k === 'beds') && beds > 0) return false
    if (k === 'rent' && facts.rentRulesSet) return false
    return true
  })

  const rows: Row[] = [
    {
      step: 'basics',
      label: 'PG',
      value: property ? `${property.name} (${property.code}) · ${TYPE_LABEL[property.type]}` : 'Not created',
      ok: Boolean(property),
    },
    {
      step: 'address',
      label: 'Address',
      value: property ? `${property.addressLine}, ${property.city} ${property.pincode}` : '—',
      ok: Boolean(property),
    },
    {
      step: 'rooms',
      label: 'Rooms & beds',
      value: `${floors.length} floors · ${rooms} rooms · ${beds} beds`,
      ok: beds > 0,
      warn: beds === 0 ? 'No beds yet — residents need a bed to check in.' : undefined,
    },
    {
      step: 'rent',
      label: 'Rent',
      value: property ? `${formatMoney(property.standardRent)}/month · due on day ${settings.rentDueDay}${settings.lateFeeEnabled ? ` · late fee ${formatMoney(settings.lateFeeAmount)} after ${settings.lateFeeGraceDays} days` : ' · no late fee'}` : '—',
      ok: facts.rentRulesSet,
    },
    {
      step: 'deposit',
      label: 'Deposit',
      value: property ? `${formatMoney(property.standardDeposit)} · ${property.noticePeriodDays}-day notice` : '—',
      ok: (data.completed ?? []).includes('deposit'),
    },
    {
      step: 'food',
      label: 'Food',
      value: property?.foodIncluded
        ? `${formatMoney(property.foodCharge)}/month${property.mealPlan ? ` · ${MEAL_LABEL[property.mealPlan]}` : ''}`
        : 'No food',
      ok: !skipped.has('food'),
    },
    {
      step: 'payments',
      label: 'Payments',
      value: [settings.upiId && `UPI ${settings.upiId}`, facts.razorpay && 'Razorpay connected'].filter(Boolean).join(' · ') || 'Cash / manual only',
      ok: Boolean(settings.upiId) || facts.razorpay,
      warn: !settings.upiId && !facts.razorpay ? 'Add a UPI ID so reminders carry a pay link.' : undefined,
    },
    {
      step: 'whatsapp',
      label: 'WhatsApp',
      value: facts.whatsapp ? 'Your own number' : 'StayFlow platform number',
      ok: facts.whatsapp,
    },
    {
      step: 'staff',
      label: 'Team',
      value: `${facts.managers} manager${facts.managers === 1 ? '' : 's'} · ${facts.staff} staff`,
      ok: facts.managers + facts.staff > 0,
    },
    {
      step: 'import',
      label: 'Residents',
      value: `${facts.residents} added`,
      ok: facts.residents > 0,
    },
  ]

  async function finish() {
    if (blockers.length) {
      toast.error('A few required steps are left', blockers.map((k) => stepMeta(k).title).join(', '))
      ctx.goTo(blockers[0])
      return
    }
    setBusy(true)
    try {
      await api.post('/api/onboarding', { action: 'COMPLETE' })
      ctx.refresh()
      ctx.goTo('done')
    } catch (e) {
      toast.fromError(e, 'finish setup')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <StepHeading title="Final check" body="Everything in one place. Tap Edit to change anything." />
      {blockers.length > 0 && (
        <Note tone="warn">
          <span className="flex items-start gap-1.5">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span>
              Still required:{' '}
              {blockers.map((k, i) => (
                <React.Fragment key={k}>
                  {i > 0 && ', '}
                  <button type="button" className="font-semibold underline" onClick={() => ctx.goTo(k)}>
                    {stepMeta(k).title}
                  </button>
                </React.Fragment>
              ))}
            </span>
          </span>
        </Note>
      )}
      <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
        {rows.map((r) => (
          <li key={r.label} className="flex items-start gap-3 px-3.5 py-3">
            {r.ok ? (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" />
            ) : (
              <CircleDashed className="mt-0.5 size-4 shrink-0 text-slate-300" />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-slate-500">{r.label}</p>
              <p className="break-words text-sm text-slate-800">{r.value}</p>
              {r.warn && <p className="mt-0.5 text-xs text-amber-700">{r.warn}</p>}
            </div>
            <button
              type="button"
              onClick={() => ctx.goTo(r.step)}
              className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50"
            >
              <Pencil className="size-3" />
              Edit
            </button>
          </li>
        ))}
      </ul>
      <StepFooter onBack={ctx.back} onNext={finish} busy={busy} nextLabel="Finish setup" />
    </>
  )
}

export function DoneStep({ ctx }: { ctx: StepContext }) {
  const router = useRouter()
  const reduce = useReducedMotion()
  const name = ctx.snapshot.property?.name ?? 'Your PG'
  const dots = React.useMemo(
    () => Array.from({ length: 14 }, (_, i) => ({ x: (i % 7) * 15 - 45, d: i * 0.04, c: i % 3 })),
    [],
  )

  return (
    <div className="space-y-6 py-4 text-center">
      <div className="relative mx-auto size-20">
        {!reduce &&
          dots.map((dot, i) => (
            <motion.span
              key={i}
              initial={{ opacity: 0, x: 0, y: 0 }}
              animate={{ opacity: [0, 1, 0], x: dot.x, y: -50 - (i % 4) * 12 }}
              transition={{ duration: 1.1, delay: dot.d, ease: 'easeOut' }}
              className={cn(
                'absolute left-1/2 top-1/2 size-2 rounded-full',
                dot.c === 0 ? 'bg-blue-500' : dot.c === 1 ? 'bg-marigold-400' : 'bg-emerald-400',
              )}
            />
          ))}
        <motion.span
          initial={reduce ? false : { scale: 0.4, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 320, damping: 18 }}
          className="flex size-16 items-center justify-center rounded-xl bg-blue-600 text-white shadow-sm"
        >
          <PartyPopper className="size-9" />
        </motion.span>
      </div>
      <div className="space-y-2">
        <h2 className="font-display text-2xl font-semibold text-slate-900">{name} is ready!</h2>
        <p className="mx-auto max-w-md text-sm leading-relaxed text-slate-500">
          Rent schedules, reminders and the resident app switch on as you check residents in. Your dashboard keeps a
          short checklist of anything you skipped.
        </p>
      </div>
      <div className="flex flex-col justify-center gap-2 sm:flex-row">
        <Button variant="primary" size="lg" onClick={() => router.push('/app')}>
          Go to dashboard
          <ArrowRight className="size-4" />
        </Button>
        <Button variant="outline" size="lg" asChild>
          <Link href="/app/residents/new">
            <UserPlus className="size-4" />
            Check in a resident
          </Link>
        </Button>
      </div>
    </div>
  )
}
