import type { Metadata } from 'next'
import Link from 'next/link'
import { Lock } from 'lucide-react'
import { requireOrgUser } from '@/lib/auth'
import { Button } from '@/components/ui/button'

export const metadata: Metadata = { title: 'No access' }

/** Where a page lands when the person's role doesn't cover it. */
export default async function NoAccessPage() {
  const user = await requireOrgUser()
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-5 py-16 text-center">
      <div className="flex size-14 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
        <Lock className="size-6" />
      </div>
      <div className="space-y-2">
        <h1 className="font-display text-xl font-semibold text-slate-900">You don&apos;t have access to this page</h1>
        <p className="text-sm leading-relaxed text-slate-500">
          Your role{user.roleName ? ` (${user.roleName})` : ''} doesn&apos;t include this part of StayFlow.
          If you need it for your work, ask your PG owner to add it to your role.
        </p>
      </div>
      <Button variant="outline" asChild>
        <Link href="/app">Back to dashboard</Link>
      </Button>
    </div>
  )
}
