import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { PauseCircle } from 'lucide-react'
import { getSessionUser, HOME_FOR_ROLE, isOrgRestricted } from '@/lib/auth'
import { LogoMark } from '@/components/marketing/logo'
import { SignOutButton } from './sign-out-button'

export const metadata: Metadata = {
  title: 'Service paused',
  robots: { index: false, follow: false },
}

/** Where residents and staff land while their PG's subscription is suspended. */
export default async function ServicePausedPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  if (!isOrgRestricted(user)) redirect(HOME_FOR_ROLE[user.role])

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-slate-50 px-6 text-center">
      <LogoMark className="size-12" />
      <div className="flex size-14 items-center justify-center rounded-2xl bg-white shadow-card">
        <PauseCircle className="size-6 text-amber-500" />
      </div>
      <div className="max-w-sm space-y-2">
        <h1 className="font-display text-xl font-semibold text-slate-900">The app is paused for now</h1>
        <p className="text-sm leading-relaxed text-slate-500">
          {user.organizationName ?? 'Your PG'}&apos;s StayFlow account is on hold. Your records are
          safe — please contact your PG owner or manager. Everything comes back as soon as the account
          is active again.
        </p>
      </div>
      <SignOutButton />
    </div>
  )
}
