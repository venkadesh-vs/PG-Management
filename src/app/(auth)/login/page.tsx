import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getSessionUser, HOME_FOR_ROLE } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { serverEnv } from '@/lib/env'
import { LoginForm } from './login-form'
import { Logo } from '@/components/marketing/logo'
import { PgScene } from './pg-scene'
import { FeatureTiles, SceneIntro, SignInCard } from './login-chrome'

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
    <div className="relative grid min-h-dvh bg-ink-950 lg:grid-cols-[1.1fr_1fr]">
      {/* ------------------------------------------------ The PG at dusk */}
      <div className="grain relative isolate overflow-hidden px-5 pb-16 pt-6 sm:px-10 lg:sticky lg:top-0 lg:flex lg:h-dvh lg:flex-col lg:justify-between lg:px-12 lg:py-9">
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute -left-40 -top-40 size-[36rem] rounded-full bg-blue-600/30 blur-[130px]" />
          <div className="absolute -bottom-40 right-0 size-[30rem] rounded-full bg-marigold-400/15 blur-[120px]" />
          <div className="dot-grid absolute inset-0 opacity-[0.07] invert [mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)]" />
          <div className="absolute inset-y-0 right-0 hidden w-px bg-gradient-to-b from-transparent via-marigold-300/30 to-transparent lg:block" />
        </div>

        <Logo variant="light" />

        <div className="mx-auto mt-8 w-full max-w-xl lg:mt-0">
          <SceneIntro />
          <PgScene className="mx-auto mt-7 w-full max-w-[360px] sm:max-w-[400px] xl:max-w-[420px]" />
        </div>

        <FeatureTiles />
      </div>

      {/* ------------------------------------------------------ The form */}
      <div className="relative z-10 -mt-10 flex flex-col justify-center rounded-t-[2rem] bg-slate-50 px-5 pb-10 pt-8 sm:px-10 lg:mt-0 lg:rounded-none lg:px-16">
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden rounded-t-[2rem] lg:rounded-none">
          <div className="absolute -right-24 -top-24 size-80 rounded-full bg-blue-200/40 blur-3xl" />
          <div className="absolute -bottom-24 -left-16 size-72 rounded-full bg-marigold-200/40 blur-3xl" />
        </div>
        <div className="relative mx-auto w-full max-w-md">
          <SignInCard>
            <LoginForm demoUsers={demoUsers} demoPassword={demoPassword} />
          </SignInCard>

          <p className="mt-8 text-center text-sm text-slate-500">
            New here?{' '}
            <Link href="/signup" className="font-semibold text-blue-600 hover:text-blue-700">
              Start your free trial
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
