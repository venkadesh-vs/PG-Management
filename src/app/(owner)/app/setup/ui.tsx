'use client'

import * as React from 'react'
import { ArrowLeft, ArrowRight, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import type { OnboardingData, SetupStepKey } from './steps'

// --------------------------------------------------------------- types ----

export type WizardFloor = {
  id: string
  name: string
  level: number
  rooms: { id: string; number: string; type: string; capacity: number; beds: number }[]
}

export type WizardProperty = {
  id: string
  name: string
  code: string
  type: 'MENS' | 'WOMENS' | 'COLIVE'
  addressLine: string
  city: string
  state: string
  pincode: string
  contactName: string
  contactPhone: string
  standardRent: number
  standardDeposit: number
  noticePeriodDays: number
  foodIncluded: boolean
  foodCharge: number
  amenities: string[]
  floors: WizardFloor[]
  mealPlan: 'ALL' | 'BREAKFAST_DINNER' | 'DINNER' | null
}

export type WizardSettings = {
  rentDueDay: number
  rentGenerateDay: number
  lateFeeEnabled: boolean
  lateFeeGraceDays: number
  lateFeeAmount: number
  lateFeePerDay: number
  reminderDaysBefore: number
  reminderOnDueDate: boolean
  reminderAfterDays: number
  whatsappEnabled: boolean
  upiId: string
  upiPayeeName: string
  invoicePrefix: string
  receiptPrefix: string
}

export type WizardSnapshot = {
  owner: { name: string; email: string; phone: string | null; emailVerified: boolean; organizationName: string }
  property: WizardProperty | null
  settings: WizardSettings
  facts: { residents: number; staff: number; managers: number; razorpay: boolean; whatsapp: boolean; rentRulesSet: boolean }
  roles: { id: string; name: string }[]
  staffRoles: { value: string; label: string }[]
  data: OnboardingData
  completedAt: string | null
  modules: string[]
  isOwner: boolean
}

/** What every step gets from the wizard shell. */
export type StepContext = {
  snapshot: WizardSnapshot
  /** The PG being set up — known right after creation, before the refresh lands. */
  propertyId: string | undefined
  /** Saves progress (finishing or skipping this step) and moves on. */
  advance: (opts?: { how?: 'complete' | 'skip'; propertyId?: string; answers?: Record<string, unknown> }) => Promise<void>
  back: () => void
  goTo: (step: SetupStepKey) => void
  /** Re-reads the server snapshot after a write. */
  refresh: () => void
  /** Draft answers for steps that run before the PG exists. */
  answers: Record<string, unknown>
}

// ------------------------------------------------------------------ ui ----

export function StepHeading({
  title,
  body,
  optional,
}: {
  title: string
  body?: React.ReactNode
  optional?: boolean
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-display text-xl font-semibold text-slate-900 sm:text-2xl">{title}</h2>
        <span
          className={cn(
            'rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide',
            optional ? 'bg-slate-100 text-slate-500' : 'bg-blue-50 text-blue-700',
          )}
        >
          {optional ? 'Optional' : 'Required'}
        </span>
      </div>
      {body && <p className="text-sm leading-relaxed text-slate-500">{body}</p>}
    </div>
  )
}

export function StepFooter({
  onBack,
  onNext,
  onSkip,
  nextLabel = 'Next',
  busy,
  hideBack,
}: {
  onBack?: () => void
  onNext: () => void
  onSkip?: () => void
  nextLabel?: string
  busy?: boolean
  hideBack?: boolean
}) {
  return (
    <div className="flex flex-col-reverse gap-2 border-t border-slate-100 pt-5 sm:flex-row sm:items-center sm:justify-between">
      <div>
        {!hideBack && onBack && (
          <Button type="button" variant="ghost" onClick={onBack} disabled={busy} className="w-full sm:w-auto">
            <ArrowLeft className="size-4" />
            Back
          </Button>
        )}
      </div>
      <div className="flex flex-col-reverse gap-2 sm:flex-row">
        {onSkip && (
          <Button type="button" variant="outline" onClick={onSkip} disabled={busy} className="w-full sm:w-auto">
            Skip for now
          </Button>
        )}
        <Button type="button" variant="primary" onClick={onNext} loading={busy} className="w-full sm:w-auto">
          {nextLabel}
          <ArrowRight className="size-4" />
        </Button>
      </div>
    </div>
  )
}

/** A tappable option chip (multi or single select). */
export function Choice({
  selected,
  onClick,
  children,
  className,
}: {
  selected: boolean
  onClick: () => void
  children: React.ReactNode
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        'flex min-h-11 items-center gap-2 rounded-xl border px-3.5 py-2 text-left text-sm font-medium transition-colors',
        selected
          ? 'border-blue-500 bg-blue-50 text-blue-800 ring-2 ring-blue-500/15'
          : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300',
        className,
      )}
    >
      <span
        className={cn(
          'flex size-4 shrink-0 items-center justify-center rounded-full border',
          selected ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300',
        )}
      >
        {selected && <Check className="size-3" />}
      </span>
      {children}
    </button>
  )
}

export function Note({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'ok'; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        'rounded-xl border px-3.5 py-3 text-sm leading-relaxed',
        tone === 'info' && 'border-blue-100 bg-blue-50/60 text-blue-900',
        tone === 'warn' && 'border-amber-200 bg-amber-50 text-amber-900',
        tone === 'ok' && 'border-emerald-200 bg-emerald-50 text-emerald-900',
      )}
    >
      {children}
    </div>
  )
}

/** Field-level errors keyed by field name. */
export type Errors = Record<string, string | undefined>

export function hasErrors(errors: Errors) {
  return Object.values(errors).some(Boolean)
}

export const PHONE_RE = /^(\+?91[-\s]?)?[6-9]\d{9}$/

export function toInt(value: string) {
  const n = Number(value)
  return Number.isFinite(n) ? Math.trunc(n) : NaN
}
