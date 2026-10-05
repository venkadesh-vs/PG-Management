import type { Metadata } from 'next'
import { requireSuperAdmin } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { PageHeader } from '@/components/app/page-header'
import { StatCard } from '@/components/app/stat-card'
import { PlanEditor } from './plan-editor'

export const metadata: Metadata = { title: 'Plans & Pricing' }

export default async function PlansPage() {
  await requireSuperAdmin()

  const [plans, subscriptions] = await Promise.all([
    prisma.plan.findMany({
      include: { _count: { select: { subscriptions: true } } },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    }),
    prisma.subscription.aggregate({
      where: { status: 'ACTIVE' },
      _sum: { amount: true },
      _avg: { amount: true },
      _count: true,
    }),
  ])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Plans & pricing"
        subtitle="Pricing is a rule, not a number. Each plan says how a PG's subscription is derived — so a ₹8,000-rent PG and a ₹14,000-rent PG price themselves."
        icon="tags"
        breadcrumbs={[{ label: 'Platform', href: '/admin' }, { label: 'Plans' }]}
      />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard label="Plans" value={plans.length} icon="tags" tone="violet" />
        <StatCard
          label="Subscriptions on them"
          value={subscriptions._count}
          icon="sparkles"
          tone="blue"
        />
        <StatCard
          label="Average subscription"
          value={Math.round(subscriptions._avg.amount ?? 0)}
          format="money"
          icon="money"
          tone="emerald"
        />
        <StatCard
          label="Total MRR"
          value={subscriptions._sum.amount ?? 0}
          format="money"
          icon="chart"
          tone="amber"
        />
      </div>

      <PlanEditor
        plans={plans.map((plan) => ({
          id: plan.id,
          name: plan.name,
          slug: plan.slug,
          description: plan.description,
          pricingBasis: plan.pricingBasis,
          multiplier: plan.multiplier,
          perBedPrice: plan.perBedPrice,
          flatPrice: plan.flatPrice,
          minAmount: plan.minAmount,
          maxAmount: plan.maxAmount,
          trialDays: plan.trialDays,
          graceDays: plan.graceDays,
          active: plan.active,
          isDefault: plan.isDefault,
          features: plan.features,
          subscriberCount: plan._count.subscriptions,
        }))}
      />
    </div>
  )
}
