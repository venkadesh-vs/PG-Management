import type { Metadata } from 'next'
import Link from 'next/link'
import { peekAuthToken } from '@/server/auth-tokens'
import { Button } from '@/components/ui/button'
import { AuthLink, AuthShell } from '../auth-shell'
import { SetPasswordForm } from '../set-password-form'

export const metadata: Metadata = {
  title: 'Reset password',
  robots: { index: false, follow: false },
}

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>
}) {
  const { token = '' } = await searchParams
  const row = token ? await peekAuthToken(token, 'PASSWORD_RESET') : null

  if (!row) {
    return (
      <AuthShell
        title="This link has expired"
        subtitle="Reset links work once, for 1 hour. Request a new one and use the latest message."
      >
        <Button variant="primary" className="w-full" asChild>
          <Link href="/forgot-password">Send me a new link</Link>
        </Button>
      </AuthShell>
    )
  }

  return (
    <AuthShell
      title="Choose a new password"
      subtitle={
        <>
          For <span className="font-medium text-slate-700">{row.user.email}</span>. You&apos;ll be
          signed out of every other device.
        </>
      }
      footer={<AuthLink href="/login">Back to sign in</AuthLink>}
    >
      <SetPasswordForm
        endpoint="/api/auth/reset-password"
        token={token}
        submitLabel="Save and sign in"
        successTitle="Password updated"
      />
    </AuthShell>
  )
}
