import 'server-only'

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { serverEnv } from '@/lib/env'
import type { SessionUser } from '@/lib/auth'
import {
  completionPercent,
  markStep,
  normalizeData,
  resumeStep,
  type OnboardingData,
  type SetupStepKey,
} from '@/app/(owner)/app/setup/steps'

/**
 * Owner onboarding wizard state. The wizard writes every real record through
 * the existing APIs (properties, rooms, settings, team, operations); this
 * service only remembers where the owner is and what the wizard created, and
 * reads the real data that decides what is "done".
 */

/** Owners, or a manager trusted with both the team and new PGs. */
export function canRunSetup(user: Pick<SessionUser, 'role' | 'permissions'>) {
  if (user.role === 'OWNER') return true
  return user.permissions.includes('team.manage') && user.permissions.includes('properties.create')
}

export async function getOnboarding(organizationId: string) {
  const row = await prisma.orgSetting.findUnique({
    where: { organizationId },
    select: { onboardingStep: true, onboardingData: true, onboardingCompletedAt: true },
  })
  const data = normalizeData(row?.onboardingData)
  // A PG the wizard made and was later archived/deleted no longer counts.
  if (data.propertyId) {
    const exists = await prisma.property.findFirst({
      where: { id: data.propertyId, organizationId, archivedAt: null },
      select: { id: true },
    })
    if (!exists) data.propertyId = undefined
  }
  return {
    started: Boolean(row?.onboardingStep),
    step: resumeStep(row?.onboardingStep, data),
    data,
    completedAt: row?.onboardingCompletedAt ?? null,
    percent: completionPercent(data, row?.onboardingCompletedAt),
  }
}

async function write(organizationId: string, step: SetupStepKey, data: OnboardingData, completedAt?: Date | null) {
  const json = data as unknown as Prisma.InputJsonValue
  await prisma.orgSetting.upsert({
    where: { organizationId },
    create: {
      organizationId,
      onboardingStep: step,
      onboardingData: json,
      ...(completedAt !== undefined ? { onboardingCompletedAt: completedAt } : {}),
    },
    update: {
      onboardingStep: step,
      onboardingData: json,
      ...(completedAt !== undefined ? { onboardingCompletedAt: completedAt } : {}),
    },
  })
}

/** Starts the wizard once (first visit) so the dashboard stops redirecting. */
export async function startOnboarding(organizationId: string) {
  const current = await getOnboarding(organizationId)
  if (!current.started) await write(organizationId, 'welcome', current.data)
  return current
}

/**
 * Saves progress: optionally finishes/skips `finish`, records the PG the
 * wizard created, merges answers and moves the resume point to `step`.
 */
export async function saveProgress(
  organizationId: string,
  input: {
    step: SetupStepKey
    finish?: { key: SetupStepKey; how: 'complete' | 'skip' }
    propertyId?: string
    answers?: Record<string, unknown>
  },
) {
  const current = await getOnboarding(organizationId)
  let data: OnboardingData = { ...current.data }

  if (input.propertyId) {
    // Only ever remember a PG of this organization.
    const property = await prisma.property.findFirst({
      where: { id: input.propertyId, organizationId },
      select: { id: true },
    })
    if (property) data.propertyId = property.id
  }
  if (input.answers) data.answers = { ...(data.answers ?? {}), ...input.answers }
  if (input.finish) data = markStep(data, input.finish.key, input.finish.how)

  await write(organizationId, input.step, data)
  return { step: resumeStep(input.step, data), data, percent: completionPercent(data, current.completedAt) }
}

export async function completeOnboarding(organizationId: string) {
  const current = await getOnboarding(organizationId)
  const data = markStep(current.data, 'review', 'complete')
  await write(organizationId, 'done', data, new Date())
  return { percent: 100 }
}

/** Re-opens the wizard (e.g. "Run setup again") without forgetting what it made. */
export async function reopenOnboarding(organizationId: string) {
  const current = await getOnboarding(organizationId)
  await write(organizationId, 'review', current.data, null)
}

/**
 * The meal plan picked in the wizard. Property creation only adds a default
 * plan when food was on at that moment, so the wizard tops it up here.
 */
export async function ensureDefaultFoodPlan(
  organizationId: string,
  propertyId: string,
  input: { monthlyCharge: number; mealPlan: 'ALL' | 'BREAKFAST_DINNER' | 'DINNER' },
) {
  const meals = {
    includesBreakfast: input.mealPlan !== 'DINNER',
    includesLunch: input.mealPlan === 'ALL',
    includesDinner: true,
  }
  const name =
    input.mealPlan === 'ALL' ? 'Full board (3 meals)' : input.mealPlan === 'BREAKFAST_DINNER' ? 'Breakfast & dinner' : 'Dinner only'
  const existing = await prisma.foodPlan.findFirst({
    where: { organizationId, propertyId, isDefault: true },
    select: { id: true },
  })
  if (existing) {
    await prisma.foodPlan.update({
      where: { id: existing.id },
      data: { name, monthlyCharge: input.monthlyCharge, active: true, ...meals },
    })
  } else {
    await prisma.foodPlan.create({
      data: { organizationId, propertyId, name, monthlyCharge: input.monthlyCharge, isDefault: true, ...meals },
    })
  }
}

/** Real-data facts behind the Getting Started checklist and the final check. */
export async function setupFacts(organizationId: string) {
  const [
    property,
    floors,
    rooms,
    beds,
    residents,
    settings,
    rentActivity,
    razorpay,
    whatsapp,
    staff,
    managers,
  ] = await Promise.all([
    prisma.property.findFirst({
      where: { organizationId, archivedAt: null },
      select: { id: true, name: true },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.floor.count({ where: { property: { organizationId, archivedAt: null } } }),
    prisma.room.count({ where: { property: { organizationId, archivedAt: null } } }),
    prisma.bed.count({ where: { property: { organizationId, archivedAt: null } } }),
    prisma.resident.count({ where: { organizationId } }),
    prisma.orgSetting.findUnique({ where: { organizationId }, select: { upiId: true, onboardingData: true } }),
    prisma.activityLog.findFirst({ where: { organizationId, event: 'SETTINGS_UPDATED' }, select: { id: true } }),
    prisma.integrationCredential.findFirst({ where: { organizationId, kind: 'RAZORPAY', active: true }, select: { id: true } }),
    prisma.integrationCredential.findFirst({ where: { organizationId, kind: 'WHATSAPP_META', active: true }, select: { id: true } }),
    prisma.staff.count({ where: { organizationId } }),
    prisma.user.count({ where: { organizationId, role: 'MANAGER', archivedAt: null } }),
  ])
  const data = normalizeData(settings?.onboardingData)
  return {
    property,
    floors,
    rooms,
    beds,
    residents,
    rentRulesSet: Boolean(rentActivity) || (data.completed ?? []).includes('rent'),
    upi: Boolean(settings?.upiId),
    razorpay: Boolean(razorpay),
    whatsapp: Boolean(whatsapp) || serverEnv.whatsapp.isLive,
    staff,
    managers,
  }
}

export type SetupFacts = Awaited<ReturnType<typeof setupFacts>>

/**
 * A brand-new owner (no PG ever, wizard never opened or finished) is sent to
 * the setup wizard on their first visit to the dashboard. Once the wizard has
 * been opened, the dashboard shows "Continue setup" instead.
 */
export async function shouldStartSetup(user: Pick<SessionUser, 'role' | 'organizationId'>) {
  if (user.role !== 'OWNER' || !user.organizationId) return false
  const [settings, property] = await Promise.all([
    prisma.orgSetting.findUnique({
      where: { organizationId: user.organizationId },
      select: { onboardingStep: true, onboardingCompletedAt: true },
    }),
    prisma.property.findFirst({ where: { organizationId: user.organizationId }, select: { id: true } }),
  ])
  return !property && !settings?.onboardingCompletedAt && !settings?.onboardingStep
}
