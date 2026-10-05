import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getSessionUser, HOME_FOR_ROLE } from '@/lib/auth'
import { AuthLink, AuthShell } from '../auth-shell'
import { SignupForm } from './signup-form'

export const metadata: Metadata = {
  title: 'Start your free trial',
  description: 'Create a StayFlow account for your PG in two minutes.',
  robots: { index: false, follow: false },
}

export default async function SignupPage() {
  const user = await getSessionUser()
  if (user) redirect(user.mustChangePassword ? '/change-password' : HOME_FOR_ROLE[user.role])

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
      <SignupForm />
    </AuthShell>
  )
}
