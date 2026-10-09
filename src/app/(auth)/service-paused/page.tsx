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
  // Owners and managers get the paywall, where they can pay.
  if (user.role === 'OWNER' || user.role === 'MANAGER') redirect('/paywall')

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-slate-50 px-6 text-center">
      <LogoMark className="size-12" />
      <div className="flex size-14 items-center justify-center rounded-xl border border-slate-200 bg-white shadow-xs">
        <PauseCircle className="size-6 text-amber-500" />
      </div>
      <div className="max-w-sm space-y-2">
        <h1 className="font-display text-xl font-semibold text-slate-900">Temporarily paused</h1>
        <p className="text-sm leading-relaxed text-slate-500">
          {user.organizationName ?? 'Your PG'}&apos;s app is temporarily paused. Your records are
          safe — please contact your PG owner. Everything comes back as soon as the account is active
          again.
        </p>
      </div>
      <SignOutButton />
    </div>
  )
}
