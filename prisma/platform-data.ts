import type { Prisma } from '@prisma/client'

/**
 * Platform data shared by the demo seed and the production bootstrap
 * (scripts/bootstrap-production.ts): subscription plans, feature flags and
 * platform settings. Edit plans here so both stay in step.
 */

export const PLATFORM_PLANS = [
  {
    name: 'Starter',
    slug: 'starter',
    description: 'For a single PG getting off notebooks.',
    pricingBasis: 'STANDARD_RENT',
    multiplier: 100,
    minAmount: 2000,
    maxAmount: 12000,
    trialDays: 14,
    graceDays: 7,
    maxProperties: 1,
    features: ['residents', 'rooms', 'rent', 'complaints', 'whatsapp'],
    isDefault: false,
  },
  {
    name: 'Growth',
    slug: 'growth',
    description:
      'One PG subscription equals roughly one standard resident rent. Everything included.',
    pricingBasis: 'STANDARD_RENT',
    multiplier: 100,
    minAmount: 3000,
    maxAmount: 25000,
    trialDays: 14,
    graceDays: 7,
    features: [
      'residents', 'rooms', 'rent', 'complaints', 'whatsapp',
      'food', 'grocery', 'staff', 'reports', 'tenant_app', 'worker_app',
    ],
    isDefault: true,
  },
  {
    name: 'Scale',
    slug: 'scale',
    description: 'Per-bed pricing for operators running many properties.',
    pricingBasis: 'PER_BED',
    perBedPrice: 90,
    minAmount: 8000,
    maxAmount: 60000,
    trialDays: 7,
    graceDays: 10,
    features: [
      'residents', 'rooms', 'rent', 'complaints', 'whatsapp', 'food',
      'grocery', 'staff', 'reports', 'tenant_app', 'worker_app', 'api', 'priority_support',
    ],
  },
] satisfies Prisma.PlanCreateInput[]

export const PLATFORM_FEATURE_FLAGS = [
    { key: 'whatsapp_reminders', name: 'WhatsApp rent reminders', description: 'Automatic reminders before, on and after the due date.', plans: ['starter', 'growth', 'scale'] },
    { key: 'tenant_app', name: 'Resident app', description: 'Residents pay rent, raise complaints and see the menu.', plans: ['growth', 'scale'] },
    { key: 'worker_app', name: 'Worker app', description: 'Task list for maintenance, kitchen and cleaning staff.', plans: ['growth', 'scale'] },
    { key: 'food_module', name: 'Food & meal planning', description: 'Meal counts derived from live food subscriptions.', plans: ['growth', 'scale'] },
    { key: 'grocery_module', name: 'Grocery & inventory', description: 'Stock, low-stock alerts and purchase lists.', plans: ['growth', 'scale'] },
    { key: 'online_payments', name: 'Online rent collection', description: 'Payment links, UPI and gateway reconciliation.', plans: ['growth', 'scale'] },
    { key: 'multi_property', name: 'Multiple PGs', description: 'Manage more than one property from one login.', plans: ['growth', 'scale'] },
    { key: 'advanced_reports', name: 'Advanced reports', description: 'Profit estimates and PG-versus-PG comparison.', plans: ['scale'] },
    { key: 'api_access', name: 'API access', description: 'Programmatic access for custom integrations.', enabled: false, plans: ['scale'] },
  ] satisfies Prisma.FeatureFlagCreateManyInput[]

export const PLATFORM_SETTINGS = [
    { key: 'platform:name', value: 'StayFlow' as Prisma.InputJsonValue },
    { key: 'platform:support_email', value: 'support@stayflow.app' as Prisma.InputJsonValue },
    {
      key: 'pricing:defaults',
      value: {
        basis: 'STANDARD_RENT',
        multiplier: 100,
        minAmount: 3000,
        maxAmount: 25000,
        trialDays: 14,
        graceDays: 7,
      } as Prisma.InputJsonValue,
    },
  ] satisfies Prisma.SystemSettingCreateManyInput[]
