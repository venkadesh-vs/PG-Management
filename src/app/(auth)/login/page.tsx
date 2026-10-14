import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getSessionUser, HOME_FOR_ROLE } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { serverEnv } from '@/lib/env'
import { LoginForm } from './login-form'
import { Logo } from '@/components/marketing/logo'
import { BrandPanel } from '../brand-panel'

export const metadata: Metadata = {
  title: 'Sign in',
  description: 'Sign in to your StayFlow PG management account.',
  robots: { index: false, follow: false },
}


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
      <BrandPanel />

      {/* Form panel */}
      <div className="relative isolate flex flex-col justify-center overflow-hidden bg-white px-5 py-10 sm:px-10 lg:px-16">
        <div aria-hidden className="mesh-blue pointer-events-none absolute inset-x-0 top-0 -z-10 h-64 opacity-40 lg:hidden" />
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
