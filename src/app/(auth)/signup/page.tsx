import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getSessionUser, HOME_FOR_ROLE } from '@/lib/auth'
import { AuthLink, AuthShell } from '../auth-shell'
import { SignupForm } from './signup-form'
import { referrerForCode } from '@/server/services/referrals'

export const metadata: Metadata = {
  title: 'Start your free trial',
  description: 'Create a StayFlow account for your PG in two minutes.',
  robots: { index: false, follow: false },
}

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ ref?: string | string[] }> }) {
  const user = await getSessionUser()
  if (user) redirect(user.mustChangePassword ? '/change-password' : HOME_FOR_ROLE[user.role])
  // A shared "refer a PG owner" link: fill the code and say who invited them.
  const { ref } = await searchParams
  const referrer = await referrerForCode(Array.isArray(ref) ? ref[0] : ref).catch(() => null)

  return (
    <AuthShell
      wide
      title="Start your free trial"
      subtitle="Set up your PG account in two minutes. No card needed — add your first PG right after."
      footer={
        <>
          Already have an account? <AuthLink href="/login">Sign in</AuthLink>
        </>
      }
    >
      <SignupForm
        referral={referrer && !referrer.expired ? { code: referrer.referralCode!, by: referrer.name } : null}
        expiredCode={referrer?.expired ? referrer.referralCode : null}
      />
    </AuthShell>
  )
}
