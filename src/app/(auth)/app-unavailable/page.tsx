import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { Smartphone } from 'lucide-react'
import { getSessionUser, HOME_FOR_ROLE } from '@/lib/auth'
import { LogoMark } from '@/components/marketing/logo'
import { SignOutButton } from '../service-paused/sign-out-button'

export const metadata: Metadata = { title: 'App not in use', robots: { index: false, follow: false } }

/** Residents or staff whose PG has switched their phone app off. */
export default async function AppUnavailablePage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  const app = user.role === 'TENANT' ? 'residentApp' : user.role === 'WORKER' ? 'staffApp' : null
  if (!app || user.modules.includes(app)) redirect(HOME_FOR_ROLE[user.role])

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-slate-50 px-6 text-center">
      <LogoMark className="size-12" />
      <div className="flex size-14 items-center justify-center rounded-xl border border-slate-200 bg-white shadow-xs">
        <Smartphone className="size-6 text-slate-400" />
      </div>
      <div className="max-w-sm space-y-2">
        <h1 className="font-display text-xl font-semibold text-slate-900">
          {user.organizationName ?? 'Your PG'} isn&apos;t using the {user.role === 'TENANT' ? 'resident' : 'staff'} app
        </h1>
        <p className="text-sm leading-relaxed text-slate-500">
          Your account is safe. Please contact your PG owner or manager — they can switch the app on at any time.
        </p>
      </div>
      <SignOutButton />
    </div>
  )
}
