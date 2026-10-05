import type { Metadata } from 'next'
import Link from 'next/link'
import { describeInvite } from '@/server/services/accounts'
import { Button } from '@/components/ui/button'
import { AuthShell } from '../auth-shell'
import { SetPasswordForm } from '../set-password-form'

export const metadata: Metadata = {
  title: 'Accept invitation',
  robots: { index: false, follow: false },
}

export default async function InvitePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>
}) {
  const { token = '' } = await searchParams
  const invite = token ? await describeInvite(token) : null

  if (!invite) {
    return (
      <AuthShell
        title="This invite has expired"
        subtitle="Invite links work once and expire after 3 days. Ask your PG to send a new one — or, if you already set a password, just sign in."
      >
        <div className="space-y-2">
          <Button variant="primary" className="w-full" asChild>
            <Link href="/login">Sign in</Link>
          </Button>
          <Button variant="ghost" className="w-full" asChild>
            <Link href="/forgot-password">Forgot password?</Link>
          </Button>
        </div>
      </AuthShell>
    )
  }

  return (
    <AuthShell
      title={`Hi ${invite.name.split(' ')[0]}, welcome!`}
      subtitle={
        <>
          Set your password to join <span className="font-medium text-slate-700">{invite.orgName}</span>{' '}
          on StayFlow.
        </>
      }
    >
      <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
        <p className="text-xs text-slate-500">You&apos;ll sign in with</p>
        <p className="break-all text-sm font-medium text-slate-800">{invite.email}</p>
      </div>
      <SetPasswordForm
        endpoint="/api/auth/invite"
        token={token}
        submitLabel="Set password and continue"
        successTitle="You're all set"
      />
    </AuthShell>
  )
}
