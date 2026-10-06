import type { Metadata } from 'next'
import { requireAccess } from '@/lib/auth'
import { resolveScope } from '@/lib/tenancy'
import { prisma } from '@/lib/prisma'
import { PageHeader } from '@/components/app/page-header'
import { ImportWizard } from './import-wizard'

export const metadata: Metadata = { title: 'Import residents' }

export default async function ImportResidentsPage() {
  const user = await requireAccess({ module: 'residents', permission: 'residents.manage' })
  const scope = await resolveScope(user)
  const properties = await prisma.property.findMany({
    where: { id: { in: scope.allowedPropertyIds } },
    select: { id: true, name: true, code: true },
    orderBy: { name: 'asc' },
  })

  return (
    <div className="space-y-6">
      <PageHeader
        title="Import residents"
        subtitle="Moving from a notebook or spreadsheet? Upload a CSV, check every row, then check everyone in at once."
        icon="user"
        breadcrumbs={[
          { label: 'Dashboard', href: '/app' },
          { label: 'Residents', href: '/app/residents' },
          { label: 'Import' },
        ]}
      />
      <ImportWizard
        properties={properties.map((p) => ({ name: p.name, code: p.code }))}
        loginsAvailable={user.modules.includes('residentApp')}
        whatsappAvailable={user.modules.includes('whatsapp')}
      />
    </div>
  )
}
