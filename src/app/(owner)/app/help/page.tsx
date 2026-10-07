import type { Metadata } from 'next'
import Link from 'next/link'
import { requireOrgUser } from '@/lib/auth'
import { HELP_ARTICLES } from '@/lib/help-articles'
import { canUseSupport } from '@/server/services/support'
import { PageHeader } from '@/components/app/page-header'
import { HelpSearch } from './help-search'

export const metadata: Metadata = { title: 'Help centre' }

export default async function HelpPage() {
  const user = await requireOrgUser()
  const support = canUseSupport(user)
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title="Help centre"
        subtitle="Short guides to every part of StayFlow. Can’t find it? Ask us."
        icon="help"
        breadcrumbs={[{ label: 'Dashboard', href: '/app' }, { label: 'Help' }]}
        actions={
          support ? (
            <Link
              href="/app/support"
              className="inline-flex h-10 items-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              My support tickets
            </Link>
          ) : undefined
        }
      />
      <HelpSearch articles={HELP_ARTICLES} supportHref={support ? '/app/support?new=1' : null} />
    </div>
  )
}
