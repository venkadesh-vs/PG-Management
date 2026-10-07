'use client'

import * as React from 'react'
import Link from 'next/link'
import { ArrowRight, ChevronDown, CircleCheck, Circle, MailWarning, Rocket, Sparkles, X } from 'lucide-react'
import { motion } from 'framer-motion'
import { api, ApiError } from '@/lib/client'
import { cn } from '@/lib/utils'
import { useToast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Progress } from '@/components/ui/primitives'

export type ChecklistItem = {
  key: string
  title: string
  body: string
  done: boolean
  href?: string
  action?: 'resend-verify'
}

const DISMISS_KEY = 'stayflow:onboarding-dismissed'

function useResendVerification() {
  const toast = useToast()
  const [busy, setBusy] = React.useState(false)
  async function resend() {
    setBusy(true)
    try {
      const res = await api.post<{ message: string }>('/api/auth/verify-email', { action: 'RESEND' })
      toast.success('Check your inbox', res.message)
    } catch (error) {
      toast.error('Could not send', error instanceof ApiError ? error.message : 'Please try again.')
    } finally {
      setBusy(false)
    }
  }
  return { busy, resend }
}

/** Small, persistent banner until the owner confirms their email. */
export function VerifyEmailBanner({ email }: { email: string }) {
  const { busy, resend } = useResendVerification()
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="flex min-w-0 items-start gap-2.5 text-sm text-amber-900">
        <MailWarning className="mt-0.5 size-4 shrink-0 text-amber-600" strokeWidth={1.75} />
        <span className="min-w-0">
          Verify your email. We sent a link to <span className="font-medium break-all">{email}</span>.
        </span>
      </p>
      <Button size="sm" variant="outline" loading={busy} onClick={resend} className="shrink-0 self-start bg-white sm:self-auto">
        Resend link
      </Button>
    </div>
  )
}

/** "Continue setup" — back to the wizard step the owner left off at (shown only when the checklist is not). */
export function ContinueSetupCard({ percent, step }: { percent: number; step: string }) {
  return (
    <motion.div initial={{ opacity: 0.85, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
      <Link
        href={`/app/setup?step=${encodeURIComponent(step)}`}
        className="group flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-xs transition-colors hover:border-blue-300 sm:flex-row sm:items-center sm:justify-between sm:p-5"
      >
        <span className="flex min-w-0 items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
            <Sparkles className="size-4" strokeWidth={1.75} />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-slate-900">Continue setup</span>
            <span className="block text-sm text-slate-500">Pick up where you left off. Most owners finish in under an hour.</span>
          </span>
        </span>
        <span className="flex items-center gap-3 sm:w-56">
          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
            <span className="block h-full rounded-full bg-blue-600" style={{ width: `${percent}%` }} />
          </span>
          <span className="text-xs font-medium text-slate-500 tabular">{percent}%</span>
          <ArrowRight className="size-4 shrink-0 text-slate-400 transition-transform group-hover:translate-x-0.5" />
        </span>
      </Link>
    </motion.div>
  )
}

/**
 * Getting-started steps; dismissible for the current browser session.
 * Remaining steps are listed; finished ones fold into a single line.
 */
export function OnboardingChecklist({ items, continueHref }: { items: ChecklistItem[]; continueHref?: string }) {
  const [dismissed, setDismissed] = React.useState(false)
  const [showDone, setShowDone] = React.useState(false)
  const { busy, resend } = useResendVerification()

  React.useEffect(() => {
    try {
      setDismissed(sessionStorage.getItem(DISMISS_KEY) === '1')
    } catch {
      // Storage blocked — just show the checklist.
    }
  }, [])

  function dismiss() {
    setDismissed(true)
    try {
      sessionStorage.setItem(DISMISS_KEY, '1')
    } catch {
      // ignore
    }
  }

  if (dismissed) return null
  const doneItems = items.filter((i) => i.done)
  const remaining = items.filter((i) => !i.done)
  const next = remaining[0]
  const pct = Math.round((doneItems.length / items.length) * 100)

  return (
    <Card>
      <CardContent className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
              <Rocket className="size-4" strokeWidth={1.75} />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-900">Getting started</p>
              <p className="text-sm text-slate-500">
                {doneItems.length} of {items.length} done
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {continueHref && (
              <Button size="sm" variant="primary" asChild>
                <Link href={continueHref}>
                  Continue setup
                  <ArrowRight className="size-3.5" />
                </Link>
              </Button>
            )}
            <button
              type="button"
              onClick={dismiss}
              aria-label="Hide for now"
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Progress value={pct} className="flex-1" />
          <span className="text-xs font-medium text-slate-500 tabular">{pct}%</span>
        </div>

        <ul className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200">
          {remaining.map((item) => {
            const isNext = item.key === next?.key
            const content = (
              <>
                <Circle
                  className={cn('mt-0.5 size-4 shrink-0', isNext ? 'text-blue-500' : 'text-slate-300')}
                  strokeWidth={1.75}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-slate-900">{item.title}</span>
                  <span className="block text-xs text-slate-500">{item.body}</span>
                </span>
                {(item.href || item.action) && (
                  <ArrowRight className="mt-0.5 size-4 shrink-0 text-slate-400 transition-transform group-hover:translate-x-0.5" />
                )}
              </>
            )
            const className = cn(
              'group flex w-full items-start gap-3 px-3.5 py-3 text-left transition-colors hover:bg-slate-50',
              isNext && 'bg-blue-50/40',
            )
            return (
              <li key={item.key}>
                {item.action === 'resend-verify' ? (
                  <button type="button" className={className} onClick={resend} disabled={busy}>
                    {content}
                  </button>
                ) : (
                  <Link href={item.href ?? '/app'} className={className}>
                    {content}
                  </Link>
                )}
              </li>
            )
          })}
        </ul>

        {doneItems.length > 0 && (
          <div className="text-sm">
            <button
              type="button"
              onClick={() => setShowDone((v) => !v)}
              className="inline-flex items-center gap-1.5 font-medium text-slate-500 hover:text-slate-800"
              aria-expanded={showDone}
            >
              <CircleCheck className="size-4 text-emerald-500" strokeWidth={1.75} />
              {doneItems.length} completed
              <ChevronDown className={cn('size-3.5 transition-transform', showDone && 'rotate-180')} />
            </button>
            {showDone && (
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {doneItems.map((item) => (
                  <li
                    key={item.key}
                    className="inline-flex items-center gap-1 rounded-md bg-slate-50 px-2 py-1 text-xs text-slate-600"
                  >
                    <CircleCheck className="size-3 text-emerald-500" strokeWidth={2} />
                    {item.title}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
