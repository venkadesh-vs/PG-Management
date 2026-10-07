import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { requireOrgUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { ensureOrgDefaults } from '@/server/services/org-defaults'
import { canRunSetup, setupFacts, startOnboarding } from '@/server/services/onboarding'
import { isStepKey, needsProperty, type SetupStepKey } from './steps'
import { SetupWizard, type WizardSnapshot } from './wizard'

export const metadata: Metadata = { title: 'Set up your PG' }

/**
 * /app/setup — the owner onboarding wizard. This page only reads; every
 * write goes through the existing APIs from the client, then refreshes.
 */
export default async function SetupPage({ searchParams }: { searchParams: Promise<{ step?: string }> }) {
  const user = await requireOrgUser()
  if (!canRunSetup(user)) redirect('/app/no-access')
  const organizationId = user.organizationId
  await ensureOrgDefaults(organizationId)

  const onboarding = await startOnboarding(organizationId)
  const data = onboarding.data

  // Adopt an existing PG instead of creating a second one.
  let propertyId = data.propertyId
  if (!propertyId) {
    const first = await prisma.property.findFirst({
      where: { organizationId, archivedAt: null },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    })
    propertyId = first?.id
  }

  const [property, settings, roles, staffRoles, facts, firstLogin] = await Promise.all([
    propertyId
      ? prisma.property.findUnique({
          where: { id: propertyId },
          include: {
            floors: {
              orderBy: { level: 'asc' },
              include: {
                rooms: {
                  orderBy: { number: 'asc' },
                  select: { id: true, number: true, type: true, capacity: true, _count: { select: { beds: true } } },
                },
              },
            },
            foodPlans: { where: { isDefault: true }, take: 1 },
          },
        })
      : null,
    prisma.orgSetting.findUnique({ where: { organizationId } }),
    prisma.orgRole.findMany({
      where: { organizationId, app: 'DASHBOARD' },
      select: { id: true, name: true },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.orgLookup.findMany({
      where: { organizationId, type: 'STAFF_ROLE', active: true },
      select: { value: true, label: true },
      orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
    }),
    setupFacts(organizationId),
    prisma.user.findUnique({ where: { id: user.id }, select: { email: true, phone: true, emailVerifiedAt: true } }),
  ])

  const params = await searchParams
  let initialStep: SetupStepKey = isStepKey(params.step) ? params.step : onboarding.step
  if (!property && needsProperty(initialStep)) initialStep = onboarding.step

  const snapshot: WizardSnapshot = {
    owner: {
      name: user.name,
      email: firstLogin?.email ?? user.email,
      phone: firstLogin?.phone ?? null,
      emailVerified: Boolean(firstLogin?.emailVerifiedAt),
      organizationName: user.organizationName ?? '',
    },
    property: property
      ? {
          id: property.id,
          name: property.name,
          code: property.code,
          type: property.type,
          addressLine: property.addressLine,
          city: property.city,
          state: property.state,
          pincode: property.pincode,
          contactName: property.contactName ?? '',
          contactPhone: property.contactPhone ?? '',
          standardRent: property.standardRent,
          standardDeposit: property.standardDeposit,
          noticePeriodDays: property.noticePeriodDays,
          foodIncluded: property.foodIncluded,
          foodCharge: property.foodCharge,
          amenities: property.amenities,
          floors: property.floors.map((f) => ({
            id: f.id,
            name: f.name,
            level: f.level,
            rooms: f.rooms.map((r) => ({ id: r.id, number: r.number, type: r.type, capacity: r.capacity, beds: r._count.beds })),
          })),
          mealPlan: property.foodPlans[0]
            ? property.foodPlans[0].includesLunch
              ? 'ALL'
              : property.foodPlans[0].includesBreakfast
                ? 'BREAKFAST_DINNER'
                : 'DINNER'
            : null,
        }
      : null,
    settings: {
      rentDueDay: settings?.rentDueDay ?? 5,
      rentGenerateDay: settings?.rentGenerateDay ?? 1,
      lateFeeEnabled: settings?.lateFeeEnabled ?? true,
      lateFeeGraceDays: settings?.lateFeeGraceDays ?? 5,
      lateFeeAmount: settings?.lateFeeAmount ?? 200,
      lateFeePerDay: settings?.lateFeePerDay ?? 0,
      reminderDaysBefore: settings?.reminderDaysBefore ?? 3,
      reminderOnDueDate: settings?.reminderOnDueDate ?? true,
      reminderAfterDays: settings?.reminderAfterDays ?? 3,
      whatsappEnabled: settings?.whatsappEnabled ?? true,
      upiId: settings?.upiId ?? '',
      upiPayeeName: settings?.upiPayeeName ?? '',
      invoicePrefix: settings?.invoicePrefix ?? 'INV',
      receiptPrefix: settings?.receiptPrefix ?? 'RCP',
    },
    facts: {
      residents: facts.residents,
      staff: facts.staff,
      managers: facts.managers,
      razorpay: facts.razorpay,
      whatsapp: facts.whatsapp,
      rentRulesSet: facts.rentRulesSet,
    },
    roles,
    staffRoles,
    data: { ...data, propertyId: property?.id },
    completedAt: onboarding.completedAt?.toISOString() ?? null,
    modules: user.modules,
    isOwner: user.role === 'OWNER',
  }

  return <SetupWizard snapshot={snapshot} initialStep={initialStep} />
}
