import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getSessionUser, HOME_FOR_ROLE } from '@/lib/auth'
import { Logo } from '@/components/marketing/logo'
import { ChangePasswordForm } from './change-password-form'

export const metadata: Metadata = {
  title: 'Change password',
  robots: { index: false, follow: false },
}

/**
 * Self-service password change. Accounts created with a one-time password
 * (residents, staff) are held here at first sign-in until they pick their own.
 */
export default async function ChangePasswordPage() {
  // Not requireUser(): that redirects pending accounts back here.
  const user = await getSessionUser()
  if (!user) redirect('/login')

  return (
    <div className="flex min-h-dvh items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-sm space-y-6">
        <Logo href={null} />
        <div className="space-y-1.5">
          <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-900">
            {user.mustChangePassword ? 'Set your own password' : 'Change password'}
          </h1>
          <p className="text-sm text-slate-500">
            {user.mustChangePassword
              ? 'You signed in with a one-time password. Choose a new one to continue — other devices will be signed out.'
              : 'Use at least 8 characters with letters and numbers. Other devices will be signed out.'}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-card">
          <ChangePasswordForm
            cancelHref={user.mustChangePassword ? null : HOME_FOR_ROLE[user.role]}
          />
        </div>
      </div>
    </div>
  )
}
