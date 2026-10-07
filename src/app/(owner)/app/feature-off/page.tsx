import type { Metadata } from 'next'
import Link from 'next/link'
import { ToggleRight } from 'lucide-react'
import { requireOrgUser } from '@/lib/auth'
import { MODULE_BY_KEY, type ModuleKey } from '@/lib/modules'
import { Button } from '@/components/ui/button'

export const metadata: Metadata = { title: 'Feature switched off' }

/** Where a link to a switched-off module lands, instead of an error. */
export default async function FeatureOffPage({ searchParams }: { searchParams: Promise<{ module?: string }> }) {
  const user = await requireOrgUser()
  const { module } = await searchParams
  const def = module && module in MODULE_BY_KEY ? MODULE_BY_KEY[module as ModuleKey] : null
  const canSwitch = user.permissions.includes('team.manage')

  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-5 py-16 text-center">
      <div className="flex size-14 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
        <ToggleRight className="size-7" />
      </div>
      <div className="space-y-2">
        <h1 className="font-display text-xl font-semibold text-slate-900">
          {def ? `${def.label} is switched off` : 'This feature is switched off'}
        </h1>
        <p className="text-sm leading-relaxed text-slate-500">
          {def?.description ? `${def.description} ` : ''}
          {canSwitch
            ? 'You can turn it on any time from Settings → Features. Nothing you entered before is lost.'
            : 'Your PG owner has turned this off. Ask them if you need it.'}
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        {canSwitch && (
          <Button variant="primary" asChild>
            <Link href="/app/settings?tab=features">Open Features</Link>
          </Button>
        )}
        <Button variant="outline" asChild>
          <Link href="/app">Back to dashboard</Link>
        </Button>
      </div>
    </div>
  )
}
