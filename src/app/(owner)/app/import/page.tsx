import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { requireOrgUser } from '@/lib/auth'
import { resolveScope } from '@/lib/tenancy'
import { prisma } from '@/lib/prisma'
import { PageHeader } from '@/components/app/page-header'
import { IMPORT_KINDS, KIND_LABELS, type ImportKind } from '@/server/services/import-fields'
import { listJobs } from '@/server/services/import-jobs'
import { canImport } from '@/server/services/import-runner'
import { ImportWizard } from './import-wizard'
import { ImportHistory } from './import-history'

export const metadata: Metadata = { title: 'Import data' }

export default async function ImportPage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  const user = await requireOrgUser()
  const kinds = IMPORT_KINDS.filter((k) => canImport(user, k))
  if (!kinds.length) redirect('/app/no-access')
  const { kind } = await searchParams
  const initialKind = (kinds as string[]).includes(kind ?? '') ? (kind as ImportKind) : kinds.includes('residents') ? 'residents' : kinds[0]

  const scope = await resolveScope(user)
  const [properties, jobs] = await Promise.all([
    prisma.property.findMany({
      where: { id: { in: scope.allowedPropertyIds } },
      select: { name: true, code: true },
      orderBy: { name: 'asc' },
    }),
    listJobs(user.organizationId!),
  ])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Import from Excel or CSV"
        subtitle="Moving from a register or spreadsheet? Upload it, match the columns, check every row, then import — nothing is saved until you confirm."
        icon="file"
        breadcrumbs={[{ label: 'Dashboard', href: '/app' }, { label: 'Import' }]}
      />
      <ImportWizard
        kinds={kinds.map((k) => ({ key: k, title: KIND_LABELS[k].title }))}
        initialKind={initialKind}
        properties={properties}
        loginsAvailable={user.modules.includes('residentApp')}
        whatsappAvailable={user.modules.includes('whatsapp')}
      />
      <ImportHistory
        jobs={jobs.map((j) => ({
          ...j,
          kindLabel: KIND_LABELS[j.kind as ImportKind]?.title ?? j.kind,
          createdAt: j.createdAt.toISOString(),
          finishedAt: j.finishedAt?.toISOString() ?? null,
        }))}
      />
    </div>
  )
}
