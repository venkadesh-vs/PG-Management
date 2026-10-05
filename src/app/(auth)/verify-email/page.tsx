import type { Metadata } from 'next'
import Link from 'next/link'
import { CircleCheck, CircleX } from 'lucide-react'
import { getSessionUser, HOME_FOR_ROLE } from '@/lib/auth'
import { verifyEmailToken } from '@/server/services/accounts'
import { Button } from '@/components/ui/button'
import { AuthShell } from '../auth-shell'

export const metadata: Metadata = {
  title: 'Confirm email',
  robots: { index: false, follow: false },
}

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>
}) {
  const { token = '' } = await searchParams
  const verified = token ? await verifyEmailToken(token) : null
  const user = await getSessionUser()
  const next = user ? HOME_FOR_ROLE[user.role] : '/login'

  if (!verified) {
    return (
      <AuthShell
        title="This link has expired"
        subtitle="Confirmation links work once and expire after 3 days. You can send a fresh one from your dashboard."
      >
        <div className="space-y-4 text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-amber-50 text-amber-600">
            <CircleX className="size-6" />
          </div>
          <Button variant="primary" className="w-full" asChild>
            <Link href={next}>{user ? 'Go to dashboard' : 'Sign in'}</Link>
          </Button>
        </div>
      </AuthShell>
    )
  }

  return (
    <AuthShell title="Email confirmed" subtitle={`Thanks — ${verified.email} is now confirmed.`}>
      <div className="space-y-4 text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
          <CircleCheck className="size-6" />
        </div>
        <Button variant="primary" className="w-full" asChild>
          <Link href={next}>{user ? 'Continue to dashboard' : 'Sign in'}</Link>
        </Button>
      </div>
    </AuthShell>
  )
}
