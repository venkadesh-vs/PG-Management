import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Building2, ShieldCheck, Sparkles, Zap } from 'lucide-react'
import { getSessionUser, HOME_FOR_ROLE } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { serverEnv } from '@/lib/env'
import { LoginForm } from './login-form'
import { Logo } from '@/components/marketing/logo'

export const metadata: Metadata = {
  title: 'Sign in',
  description: 'Sign in to your StayFlow PG management account.',
  robots: { index: false, follow: false },
}

const HIGHLIGHTS = [
  { icon: Zap, title: 'Rent runs itself', body: 'Invoices, reminders and receipts generate on schedule.' },
  { icon: Building2, title: 'Every bed accounted for', body: 'Occupancy updates the moment someone checks in.' },
  { icon: ShieldCheck, title: 'Role-based access', body: 'Owners, workers and residents each see only their own view.' },
]

export default async function LoginPage() {
  const user = await getSessionUser()
  if (user) redirect(HOME_FOR_ROLE[user.role])

  // Demo credentials are shown only on a deployment explicitly marked as a
  // public demo (DEMO_MODE=true) — never just because seeded accounts exist.
  const demoUsers = serverEnv.demoMode
    ? await prisma.user.findMany({
        where: { email: { endsWith: '@stayflow.app' }, status: 'ACTIVE' },
        select: { email: true, role: true, name: true },
        orderBy: { role: 'asc' },
      })
    : []
  const demoPassword = serverEnv.demoMode ? serverEnv.seedPassword : ''

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      {/* Brand panel — hidden on mobile so the form is immediately usable. */}
      <div className="relative hidden overflow-hidden bg-slate-950 lg:block">
        <div className="mesh-blue absolute inset-0 opacity-80" />
        <div className="dot-grid absolute inset-0 opacity-[0.12] invert" />
        <div className="absolute inset-y-0 right-0 w-px bg-gradient-to-b from-transparent via-white/15 to-transparent" />
        <div className="relative flex h-full flex-col justify-between p-12">
          <Logo variant="light" />

          <div className="max-w-md space-y-8">
            <div className="space-y-4">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.06] px-3 py-1 text-xs font-medium text-white/80 backdrop-blur">
                <Sparkles className="size-3 text-blue-300" />
                An operating system for PGs
              </span>
              <h1 className="font-display text-4xl font-semibold leading-tight tracking-tight text-white text-balance">
                Run your entire PG from one place.
              </h1>
              <p className="text-base leading-relaxed text-white/70">
                Residents, rooms, rent, complaints, food and staff — connected, so entering
                something once updates everything attached to it.
              </p>
            </div>

            <ul className="space-y-4">
              {HIGHLIGHTS.map((item) => (
                <li key={item.title} className="flex gap-3">
                  <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.06]">
                    <item.icon className="size-4 text-blue-200" strokeWidth={1.75} />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-white">{item.title}</p>
                    <p className="text-sm text-white/60">{item.body}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <p className="text-xs text-white/40">
            © {new Date().getFullYear()} StayFlow. Built around real PG workflows.
          </p>
        </div>
      </div>

      {/* Form panel */}
      <div className="flex flex-col justify-center bg-white px-5 py-10 sm:px-10 lg:px-16">
        <div className="mx-auto w-full max-w-md">
          <div className="lg:hidden">
            <Logo />
          </div>

          <div className="mt-10 space-y-2 lg:mt-0">
            <h2 className="font-display text-[1.75rem] font-semibold tracking-tight text-slate-900">
              Sign in
            </h2>
            <p className="text-sm text-slate-500">
              Welcome back. Enter your details to open your dashboard.
            </p>
          </div>

          <div className="mt-8">
            <LoginForm demoUsers={demoUsers} demoPassword={demoPassword} />
          </div>

          <p className="mt-8 text-center text-sm text-slate-500">
            New here?{' '}
            <Link href="/signup" className="font-semibold text-blue-600 hover:text-blue-700">
              Create an account
            </Link>
          </p>
          <p className="mt-2 text-center text-xs text-slate-400">
            Prefer a walkthrough?{' '}
            <Link href="/#demo" className="font-medium text-slate-600 hover:text-slate-900">
              Book a free demo
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
