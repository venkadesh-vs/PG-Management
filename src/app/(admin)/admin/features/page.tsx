import type { Metadata } from 'next'
import { requireSuperAdmin } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { PageHeader } from '@/components/app/page-header'
import { StatCard } from '@/components/app/stat-card'
import { FeatureToggles } from './feature-toggles'

export const metadata: Metadata = { title: 'Feature Controls' }

export default async function FeaturesPage() {
  await requireSuperAdmin()

  const [features, plans] = await Promise.all([
    prisma.featureFlag.findMany({ orderBy: { name: 'asc' } }),
    prisma.plan.findMany({ select: { slug: true, name: true }, orderBy: { name: 'asc' } }),
  ])

  const enabled = features.filter((f) => f.enabled).length

  return (
    <div className="space-y-6">
      <PageHeader
        title="Feature controls"
        subtitle="Which capabilities are switched on, and which plans include them."
        icon="shield"
        breadcrumbs={[{ label: 'Platform', href: '/admin' }, { label: 'Feature Controls' }]}
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
        <StatCard label="Features" value={features.length} icon="shield" />
        <StatCard label="Enabled" value={enabled} icon="check" />
        <StatCard label="Disabled" value={features.length - enabled} icon="warning" tone={features.length - enabled ? 'amber' : 'default'} />
      </div>

      <FeatureToggles
        features={features.map((f) => ({
          id: f.id,
          key: f.key,
          name: f.name,
          description: f.description,
          enabled: f.enabled,
          plans: f.plans,
        }))}
        plans={plans}
      />
    </div>
  )
}
