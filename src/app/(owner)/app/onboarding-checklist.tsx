'use client'

import * as React from 'react'
import Link from 'next/link'
import { ArrowRight, CircleCheck, Circle, MailWarning, Rocket, Sparkles, X } from 'lucide-react'
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
    <div className="flex flex-col gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="flex items-start gap-2 text-sm text-amber-900">
        <MailWarning className="mt-0.5 size-4 shrink-0" />
        <span>
          Please verify your email — we sent a link to <span className="font-medium break-all">{email}</span>.
        </span>
      </p>
      <Button size="sm" variant="outline" loading={busy} onClick={resend} className="shrink-0 self-start sm:self-auto">
        Resend link
      </Button>
    </div>
  )
}

/** "Continue setup (60%)" — back to the wizard step the owner left off at. */
export function ContinueSetupCard({ percent, step }: { percent: number; step: string }) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
      <Link
        href={`/app/setup?step=${encodeURIComponent(step)}`}
        className="group flex flex-col gap-3 rounded-2xl bg-gradient-to-br from-blue-600 to-blue-800 p-4 text-white shadow-brand sm:flex-row sm:items-center sm:justify-between sm:p-5"
      >
        <span className="flex min-w-0 items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white/15">
            <Sparkles className="size-5" />
          </span>
          <span className="min-w-0">
            <span className="block font-display text-base font-semibold">Continue setup ({percent}%)</span>
            <span className="block text-sm text-blue-100">Pick up right where you left off — most owners finish in under an hour.</span>
          </span>
        </span>
        <span className="flex items-center gap-3 sm:w-56">
          <span className="h-2 flex-1 overflow-hidden rounded-full bg-white/20">
            <span className="block h-full rounded-full bg-white" style={{ width: `${percent}%` }} />
          </span>
          <ArrowRight className="size-4 shrink-0 transition-transform group-hover:translate-x-0.5" />
        </span>
      </Link>
    </motion.div>
  )
}

/** Getting-started steps; dismissible for the current browser session. */
export function OnboardingChecklist({ items }: { items: ChecklistItem[] }) {
  const [dismissed, setDismissed] = React.useState(false)
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
  const done = items.filter((i) => i.done).length
  const next = items.find((i) => !i.done)
  const pct = Math.round((done / items.length) * 100)

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
              <Rocket className="size-4" />
            </div>
            <div>
              <p className="font-display text-base font-semibold text-slate-900">Getting started</p>
              <p className="text-sm text-slate-500">
                {done} of {items.length} done · {pct}%
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Hide for now"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="size-4" />
          </button>
        </div>
        <Progress value={pct} />
        <ul className="grid gap-2 sm:grid-cols-2">
          {items.map((item) => {
            const isNext = item.key === next?.key
            const Icon = item.done ? CircleCheck : Circle
            const content = (
              <>
                <Icon
                  className={cn('mt-0.5 size-4 shrink-0', item.done ? 'text-emerald-500' : 'text-slate-300')}
                />
                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      'block text-sm font-medium',
                      item.done ? 'text-slate-400 line-through' : 'text-slate-800',
                    )}
                  >
                    {item.title}
                  </span>
                  {!item.done && <span className="block text-xs text-slate-500">{item.body}</span>}
                </span>
                {!item.done && (item.href || item.action) && (
                  <ArrowRight className="mt-0.5 size-4 shrink-0 text-slate-400" />
                )}
              </>
            )
            const className = cn(
              'flex w-full items-start gap-2.5 rounded-xl border p-3 text-left transition-colors',
              isNext ? 'border-blue-200 bg-blue-50/50' : 'border-slate-200',
              !item.done && 'hover:border-blue-300',
            )
            return (
              <li key={item.key}>
                {item.done ? (
                  <div className={className}>{content}</div>
                ) : item.action === 'resend-verify' ? (
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
      </CardContent>
    </Card>
  )
}
