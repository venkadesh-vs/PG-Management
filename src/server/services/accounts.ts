import 'server-only'

import { ensureOrgDefaults } from './org-defaults'
import type { AuthTokenKind, Prisma, UserRole } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { generateTempPassword, hashPassword } from '@/lib/password'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/tenancy'
import { slugify } from '@/lib/utils'
import { issueAuthToken, consumeAuthToken, peekAuthToken } from '../auth-tokens'
import { recordActivity } from '../events'
import { sendEmail } from '../integrations/email'
import { sendWhatsApp, type WhatsAppTemplate } from '../integrations/whatsapp'

/**
 * Accounts and onboarding: creating an organization with its owner, invite
 * links, password resets and email verification.
 *
 * Passwords never travel in a message. Every account handover is a
 * single-use link (lib auth-tokens) sent by email and/or WhatsApp; the owner
 * UI may also show the link so it can be shared by hand.
 */

type Tx = Prisma.TransactionClient

export const DEFAULT_EXPENSE_CATEGORIES = [
  { name: 'Groceries', slug: 'groceries', icon: 'ShoppingCart', color: '#f59e0b' },
  { name: 'Food & Kitchen', slug: 'food', icon: 'Utensils', color: '#ef4444' },
  { name: 'Electricity', slug: 'electricity', icon: 'Zap', color: '#eab308' },
  { name: 'Water', slug: 'water', icon: 'Droplets', color: '#0ea5e9' },
  { name: 'Gas', slug: 'gas', icon: 'Flame', color: '#f97316' },
  { name: 'Maintenance', slug: 'maintenance', icon: 'Wrench', color: '#8b5cf6' },
  { name: 'Cleaning', slug: 'cleaning', icon: 'Sparkles', color: '#14b8a6' },
  { name: 'Staff Salary', slug: 'salary', icon: 'Users', color: '#3b82f6' },
  { name: 'Internet', slug: 'internet', icon: 'Wifi', color: '#6366f1' },
  { name: 'Repairs', slug: 'repairs', icon: 'Hammer', color: '#a855f7' },
  { name: 'Other', slug: 'other', icon: 'Receipt', color: '#64748b' },
]

export type SignupSource = 'SELF_SIGNUP' | 'ADMIN' | 'LEAD'

export function normaliseEmail(email: string) {
  return email.trim().toLowerCase()
}

/** Last 10 digits of an Indian mobile number ("+91 98765-43210" → "9876543210"). */
export function localPhone(phone: string) {
  const digits = phone.replace(/\D/g, '')
  return digits.length > 10 ? digits.slice(-10) : digits
}

/**
 * Generated logins (residents/staff without an email) look like
 * res-0001@my-pg.stayflow.app. Those inboxes do not exist, so nothing is
 * emailed to them.
 */
export function isDeliverableEmail(email: string | null | undefined): email is string {
  if (!email) return false
  return !/@[^@]+\.stayflow\.app$/i.test(email)
}

/** Placeholder login email for someone without one. */
export function generatedLoginEmail(code: string, orgSlug: string) {
  return `${code.toLowerCase()}@${orgSlug}.stayflow.app`
}

/** An unusable password for accounts that will be activated through a link. */
export async function unusablePasswordHash() {
  return hashPassword(generateTempPassword(32))
}

async function uniqueOrgSlug(tx: Tx, name: string) {
  const base = slugify(name).slice(0, 40) || 'pg'
  for (let i = 0; i < 50; i++) {
    const slug = i === 0 ? base : `${base}-${i + 1}`
    const taken = await tx.organization.findUnique({ where: { slug }, select: { id: true } })
    if (!taken) return slug
  }
  return `${base}-${Date.now().toString(36)}`
}

/** Default plan's trial length; 14 days when no plan is configured. */
async function defaultTrialDays(tx: Tx) {
  const plan = await tx.plan.findFirst({
    where: { active: true },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    select: { trialDays: true },
  })
  return plan?.trialDays ?? 14
}

export const DUPLICATE_EMAIL_MESSAGE =
  'An account with this email already exists. Sign in, or use "Forgot password" to get back in.'

// --------------------------------------------------------------------------
// Organization bootstrap
// --------------------------------------------------------------------------

export type BootstrapInput = {
  orgName: string
  ownerName: string
  email: string
  phone: string
  city?: string | null
  source: SignupSource
  /** Self-signup sets a password; admin/lead creation sends an invite instead. */
  password?: string
  actor?: { id: string; name: string; role: UserRole } | null
  ip?: string
}

/**
 * Creates a trial organization with default settings, expense categories and
 * its OWNER, in one transaction. The first PG (and with it the PG's
 * subscription and trial) is added later from the owner dashboard.
 */
export async function bootstrapOrganization(input: BootstrapInput) {
  const email = normaliseEmail(input.email)
  const phone = localPhone(input.phone)
  const passwordHash = input.password ? await hashPassword(input.password) : await unusablePasswordHash()

  const result = await prisma.$transaction(
    async (tx) => {
      const existing = await tx.user.findUnique({ where: { email }, select: { id: true } })
      if (existing) throw new ConflictError(DUPLICATE_EMAIL_MESSAGE)

      const trialDays = await defaultTrialDays(tx)
      const slug = await uniqueOrgSlug(tx, input.orgName)
      const organization = await tx.organization.create({
        data: {
          name: input.orgName.trim(),
          slug,
          ownerName: input.ownerName.trim(),
          contactEmail: email,
          contactPhone: phone,
          whatsappPhone: phone,
          city: input.city?.trim() || null,
          status: 'TRIAL',
          trialEndsAt: new Date(Date.now() + trialDays * 86_400_000),
          signupSource: input.source,
          settings: { create: { upiPayeeName: input.orgName.trim() } },
        },
      })
      await tx.expenseCategory.createMany({
        data: DEFAULT_EXPENSE_CATEGORIES.map((c) => ({ ...c, organizationId: organization.id })),
      })
      // Starting roles (Manager, Accountant, Warden, Cook, Housekeeping) and dropdown lists.
      await ensureOrgDefaults(organization.id, tx)
      const owner = await tx.user.create({
        data: {
          organizationId: organization.id,
          email,
          phone,
          name: input.ownerName.trim(),
          passwordHash,
          role: 'OWNER',
          status: input.password ? 'ACTIVE' : 'INVITED',
          mustChangePassword: !input.password,
          passwordChangedAt: input.password ? new Date() : null,
        },
      })
      await recordActivity(
        {
          organizationId: organization.id,
          actorId: input.actor?.id ?? owner.id,
          actorName: input.actor?.name ?? owner.name,
          actorRole: input.actor?.role ?? 'OWNER',
          event: 'SETTINGS_UPDATED',
          entityType: 'Organization',
          entityId: organization.id,
          summary:
            input.source === 'SELF_SIGNUP'
              ? `${organization.name} signed up for a ${trialDays}-day trial`
              : `${organization.name} account created by ${input.actor?.name ?? 'StayFlow'}`,
          meta: { source: input.source, trialDays },
          ip: input.ip,
        },
        tx,
      )
      return { organization, owner }
    },
    { timeout: 20000 },
  )
  return result
}

// --------------------------------------------------------------------------
// Delivering links
// --------------------------------------------------------------------------

export type DeliveryChannel = 'email' | 'whatsapp'

/** Template names are registered alongside the WhatsApp integration. */
const template = (name: string) => name as WhatsAppTemplate

type LinkRecipient = {
  id: string
  name: string
  email: string
  /** Phone for WhatsApp; null/undefined skips WhatsApp. */
  phone?: string | null
}

/**
 * Sends an account link by email (real inboxes only) and WhatsApp (when a
 * phone is known and allowed). Delivery failures never throw: the caller
 * still has the link to share by hand. Returns the channels used.
 */
export async function deliverAccountLink(params: {
  kind: AuthTokenKind
  url: string
  recipient: LinkRecipient
  organizationId: string | null
  orgName: string | null
  whatsapp?: boolean
}): Promise<DeliveryChannel[]> {
  const { kind, url, recipient } = params
  const first = recipient.name.split(' ')[0] || recipient.name
  const orgName = params.orgName ?? 'StayFlow'
  const channels: DeliveryChannel[] = []

  const copy =
    kind === 'INVITE'
      ? {
          subject: `You're invited to ${orgName} on StayFlow`,
          text:
            `Hi ${first},\n\n${orgName} has set up a StayFlow account for you.\n\n` +
            `Set your password to get started (link valid for 3 days):\n${url}\n\n` +
            `You will sign in with: ${recipient.email}\n\nIf you were not expecting this, you can ignore this message.`,
          wa:
            `Hi ${first} 👋\n\n${orgName} has set up your StayFlow account.\n\n` +
            `Tap to set your password (valid for 3 days):\n${url}`,
          template: 'account_invite',
          variables: [recipient.name, orgName, url],
        }
      : kind === 'PASSWORD_RESET'
        ? {
            subject: 'Reset your StayFlow password',
            text:
              `Hi ${first},\n\nWe received a request to reset your StayFlow password.\n\n` +
              `Choose a new password here (link valid for 1 hour):\n${url}\n\n` +
              `If you did not ask for this, ignore this message — your password stays the same.`,
            wa:
              `Hi ${first},\n\nUse this link to reset your StayFlow password (valid for 1 hour):\n${url}\n\n` +
              `Didn't ask for it? Ignore this message.`,
            template: 'password_reset',
            variables: [recipient.name, url],
          }
        : {
            subject: 'Confirm your email for StayFlow',
            text:
              `Hi ${first},\n\nPlease confirm this is your email address for StayFlow:\n${url}\n\n` +
              `The link is valid for 3 days.`,
            wa: null,
            template: 'email_verify',
            variables: [],
          }

  if (isDeliverableEmail(recipient.email)) {
    const sent = await sendEmail({
      organizationId: params.organizationId,
      to: recipient.email,
      toName: recipient.name,
      subject: copy.subject,
      text: copy.text,
      template: copy.template,
      refType: 'User',
      refId: recipient.id,
    }).catch((error: unknown) => {
      console.error('[accounts] email delivery failed', error)
      return null
    })
    if (sent) channels.push('email')
  }

  if (copy.wa && params.whatsapp !== false && recipient.phone) {
    const sent = await sendWhatsApp({
      organizationId: params.organizationId,
      toName: recipient.name,
      toPhone: recipient.phone,
      template: template(copy.template),
      body: copy.wa,
      variables: copy.variables,
      refType: 'User',
      refId: recipient.id,
    }).catch((error: unknown) => {
      console.error('[accounts] WhatsApp delivery failed', error)
      return null
    })
    if (sent) channels.push('whatsapp')
  }

  return channels
}

// --------------------------------------------------------------------------
// Invites
// --------------------------------------------------------------------------

export type AccessLinkResult = {
  /** INVITE when the account was never activated, PASSWORD_RESET otherwise. */
  kind: 'INVITE' | 'PASSWORD_RESET'
  /**
   * The link, for the inviter to copy and share by hand. Only returned for
   * accounts that have never been activated — a link into an account someone
   * already uses goes to them alone, never to the person who asked.
   */
  inviteUrl: string | null
  sentVia: DeliveryChannel[]
  email: string
}

/**
 * Sends someone their way into StayFlow. Never-activated accounts get an
 * INVITE (and the link is returned to the inviter); accounts already in use
 * get a PASSWORD_RESET sent only to the account holder.
 */
export async function sendAccessLink(
  userId: string,
  options?: { phone?: string | null; whatsapp?: boolean },
): Promise<AccessLinkResult> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { organization: { select: { id: true, name: true } } },
  })
  if (!user) throw new NotFoundError('Account not found')
  if (user.status === 'ARCHIVED') throw new ValidationError('This account is no longer active')

  const activated = Boolean(user.passwordChangedAt) || !user.mustChangePassword
  const kind = activated ? 'PASSWORD_RESET' : 'INVITE'
  const { url } = await issueAuthToken(user.id, kind)
  const sentVia = await deliverAccountLink({
    kind,
    url,
    recipient: {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: options?.phone === undefined ? user.phone : options.phone,
    },
    organizationId: user.organizationId,
    orgName: user.organization?.name ?? null,
    whatsapp: options?.whatsapp,
  })
  return { kind, inviteUrl: activated ? null : url, sentVia, email: user.email }
}

/** What the /invite page shows before the password is set. */
export async function describeInvite(token: string) {
  const row = await peekAuthToken(token, 'INVITE')
  if (!row) return null
  const user = await prisma.user.findUnique({
    where: { id: row.userId },
    select: { name: true, email: true, role: true, organization: { select: { name: true } } },
  })
  if (!user) return null
  return {
    name: user.name,
    email: user.email,
    role: user.role,
    orgName: user.organization?.name ?? 'StayFlow',
  }
}

/** Shared by invite acceptance and password reset. */
async function setPasswordWithToken(
  token: string,
  kind: 'INVITE' | 'PASSWORD_RESET',
  password: string,
) {
  const passwordHash = await hashPassword(password)
  return prisma.$transaction(async (tx) => {
    const userId = await consumeAuthToken(token, kind, tx)
    if (!userId) {
      throw new ValidationError(
        kind === 'INVITE'
          ? 'This invite link has expired or was already used. Ask for a new one.'
          : 'This reset link has expired or was already used. Request a new one.',
      )
    }
    const current = await tx.user.findUniqueOrThrow({ where: { id: userId } })
    if (current.status === 'ARCHIVED' || current.status === 'SUSPENDED') {
      throw new ValidationError('This account is not active. Contact your PG owner.')
    }
    const now = new Date()
    const user = await tx.user.update({
      where: { id: userId },
      data: {
        passwordHash,
        mustChangePassword: false,
        passwordChangedAt: now,
        status: 'ACTIVE',
        // Opening the link proves they hold the inbox or phone it went to.
        ...(kind === 'INVITE' && !current.emailVerifiedAt ? { emailVerifiedAt: now } : {}),
      },
    })
    // Every existing session ends; the caller signs this device in afresh.
    await tx.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: now },
    })
    // Any other outstanding links for this account stop working.
    await tx.authToken.updateMany({
      where: { userId, kind: { in: ['INVITE', 'PASSWORD_RESET'] }, usedAt: null },
      data: { usedAt: now },
    })
    await recordActivity(
      {
        organizationId: user.organizationId,
        actorId: user.id,
        actorName: user.name,
        actorRole: user.role,
        event: 'AUTH_PASSWORD_CHANGED',
        entityType: 'User',
        entityId: user.id,
        summary:
          kind === 'INVITE'
            ? `${user.name} accepted their invite and set a password`
            : `${user.name} reset their password`,
      },
      tx,
    )
    return user
  })
}

export function acceptInvite(token: string, password: string) {
  return setPasswordWithToken(token, 'INVITE', password)
}

// --------------------------------------------------------------------------
// Password reset
// --------------------------------------------------------------------------

/**
 * Finds accounts by email or phone and sends each a reset link. Says nothing
 * about whether anything matched — the caller always shows the same message.
 */
export async function requestPasswordReset(identifier: string) {
  const value = identifier.trim()
  const isEmail = value.includes('@')
  const phone = localPhone(value)
  if (!isEmail && phone.length !== 10) return

  const users = await prisma.user.findMany({
    where: {
      status: { in: ['ACTIVE', 'INVITED'] },
      ...(isEmail ? { email: normaliseEmail(value) } : { phone: { endsWith: phone } }),
    },
    include: { organization: { select: { name: true } } },
    take: 3,
  })

  for (const user of users) {
    const { url } = await issueAuthToken(user.id, 'PASSWORD_RESET')
    await deliverAccountLink({
      kind: 'PASSWORD_RESET',
      url,
      recipient: { id: user.id, name: user.name, email: user.email, phone: user.phone },
      organizationId: user.organizationId,
      orgName: user.organization?.name ?? null,
    })
  }
}

export function completePasswordReset(token: string, password: string) {
  return setPasswordWithToken(token, 'PASSWORD_RESET', password)
}

// --------------------------------------------------------------------------
// Email verification
// --------------------------------------------------------------------------

export async function sendVerificationEmail(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { organization: { select: { name: true } } },
  })
  if (!user || user.emailVerifiedAt || !isDeliverableEmail(user.email)) return false
  const { url } = await issueAuthToken(user.id, 'EMAIL_VERIFY')
  const sent = await deliverAccountLink({
    kind: 'EMAIL_VERIFY',
    url,
    recipient: { id: user.id, name: user.name, email: user.email },
    organizationId: user.organizationId,
    orgName: user.organization?.name ?? null,
  })
  return sent.includes('email')
}

/** Consumes an EMAIL_VERIFY link. Returns the verified user's name, or null. */
export async function verifyEmailToken(token: string) {
  if (!token) return null
  return prisma.$transaction(async (tx) => {
    const userId = await consumeAuthToken(token, 'EMAIL_VERIFY', tx)
    if (!userId) return null
    const user = await tx.user.update({
      where: { id: userId },
      data: { emailVerifiedAt: new Date() },
      select: { name: true, email: true },
    })
    return user
  })
}

// --------------------------------------------------------------------------
// Team (owners & managers)
// --------------------------------------------------------------------------

type Actor = { id: string; name: string; role: UserRole }

/**
 * Invites a MANAGER. An empty `propertyIds` means every PG (no
 * PropertyAccess rows); otherwise they are limited to the chosen PGs.
 */
export async function inviteManager(params: {
  organizationId: string
  actor: Actor
  name: string
  email: string
  phone: string
  propertyIds: string[]
}) {
  const email = normaliseEmail(params.email)
  const propertyIds = [...new Set(params.propertyIds)]
  const passwordHash = await unusablePasswordHash()

  const manager = await prisma.$transaction(async (tx) => {
    const existing = await tx.user.findUnique({ where: { email }, select: { id: true } })
    if (existing) throw new ConflictError('That email already has a StayFlow login')
    if (propertyIds.length) {
      const owned = await tx.property.count({
        where: { id: { in: propertyIds }, organizationId: params.organizationId, archivedAt: null },
      })
      if (owned !== propertyIds.length) throw new ValidationError('Choose PGs from your own account')
    }
    const user = await tx.user.create({
      data: {
        organizationId: params.organizationId,
        email,
        phone: localPhone(params.phone),
        name: params.name.trim(),
        passwordHash,
        role: 'MANAGER',
        status: 'INVITED',
        mustChangePassword: true,
        propertyAccess: propertyIds.length
          ? { create: propertyIds.map((propertyId) => ({ propertyId })) }
          : undefined,
      },
    })
    const scope = propertyIds.length
      ? `for ${propertyIds.length} PG${propertyIds.length === 1 ? '' : 's'}`
      : 'for all PGs'
    await recordActivity(
      {
        organizationId: params.organizationId,
        actorId: params.actor.id,
        actorName: params.actor.name,
        actorRole: params.actor.role,
        event: 'STAFF_CREATED',
        entityType: 'User',
        entityId: user.id,
        summary: `${user.name} invited as manager ${scope}`,
      },
      tx,
    )
    return user
  })

  const access = await sendAccessLink(manager.id)
  return { user: manager, ...access }
}

async function teamMember(organizationId: string, userId: string) {
  const member = await prisma.user.findFirst({
    where: { id: userId, organizationId, role: { in: ['OWNER', 'MANAGER'] } },
  })
  if (!member) throw new NotFoundError('Team member not found')
  return member
}

export async function resendTeamInvite(params: { organizationId: string; userId: string }) {
  const member = await teamMember(params.organizationId, params.userId)
  if (member.status === 'SUSPENDED') throw new ValidationError('Reactivate this person first')
  return sendAccessLink(member.id)
}

/** Deactivate (SUSPENDED + signed out everywhere) or reactivate a team member. */
export async function setTeamMemberActive(params: {
  organizationId: string
  actor: Actor
  userId: string
  active: boolean
}) {
  if (params.userId === params.actor.id) {
    throw new ValidationError('You cannot deactivate your own login')
  }
  const member = await teamMember(params.organizationId, params.userId)

  if (!params.active && member.role === 'OWNER' && member.status === 'ACTIVE') {
    const owners = await prisma.user.count({
      where: { organizationId: params.organizationId, role: 'OWNER', status: 'ACTIVE' },
    })
    if (owners <= 1) throw new ValidationError('An account needs at least one active owner')
  }

  const status = params.active
    ? member.mustChangePassword && !member.passwordChangedAt
      ? 'INVITED'
      : 'ACTIVE'
    : 'SUSPENDED'

  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: member.id }, data: { status } })
    if (!params.active) {
      await tx.session.updateMany({
        where: { userId: member.id, revokedAt: null },
        data: { revokedAt: new Date() },
      })
    }
    await recordActivity(
      {
        organizationId: params.organizationId,
        actorId: params.actor.id,
        actorName: params.actor.name,
        actorRole: params.actor.role,
        event: 'SETTINGS_UPDATED',
        entityType: 'User',
        entityId: member.id,
        summary: `${member.name} ${params.active ? 'reactivated' : 'deactivated'} by ${params.actor.name}`,
      },
      tx,
    )
  })
  return { name: member.name, status }
}

// --------------------------------------------------------------------------
// Resident & staff logins
// --------------------------------------------------------------------------

/**
 * Sends a resident their login link, creating the TENANT account first if
 * they were checked in without one.
 */
export async function sendResidentAccess(params: { organizationId: string; residentId: string }) {
  const resident = await prisma.resident.findFirst({
    where: { id: params.residentId, organizationId: params.organizationId },
    include: { organization: { select: { slug: true } } },
  })
  if (!resident) throw new NotFoundError('Resident not found')
  if (resident.status === 'CHECKED_OUT') {
    throw new ValidationError('This resident has checked out')
  }

  let userId = resident.userId
  if (!userId) {
    const preferred = resident.email ? normaliseEmail(resident.email) : null
    const taken = preferred
      ? await prisma.user.findUnique({ where: { email: preferred }, select: { id: true } })
      : null
    const email =
      preferred && !taken ? preferred : generatedLoginEmail(resident.code, resident.organization.slug)
    const passwordHash = await unusablePasswordHash()
    userId = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          organizationId: resident.organizationId,
          email,
          phone: resident.phone,
          name: resident.fullName,
          passwordHash,
          role: 'TENANT',
          status: 'ACTIVE',
          mustChangePassword: true,
          avatarUrl: resident.photoUrl,
        },
      })
      await tx.resident.update({ where: { id: resident.id }, data: { userId: user.id } })
      return user.id
    })
  }

  return sendAccessLink(userId, {
    phone: resident.whatsappPhone || resident.phone,
    whatsapp: !resident.whatsappOptOutAt,
  })
}

/** Sends a staff member their worker-app link, creating the login if needed. */
export async function sendStaffAccess(params: { organizationId: string; staffId: string }) {
  const staff = await prisma.staff.findFirst({
    where: { id: params.staffId, organizationId: params.organizationId },
    include: { organization: { select: { slug: true } } },
  })
  if (!staff) throw new NotFoundError('Staff member not found')
  if (!staff.active) throw new ValidationError('This staff member is no longer active')

  let userId = staff.userId
  if (!userId) {
    userId = await createWorkerLogin({
      organizationId: staff.organizationId,
      orgSlug: staff.organization.slug,
      code: staff.code,
      name: staff.name,
      phone: staff.phone,
      email: staff.email,
    })
    await prisma.staff.update({ where: { id: staff.id }, data: { userId } })
  }
  return sendAccessLink(userId, { phone: staff.phone })
}

/** Creates a WORKER login with an unusable password, activated by invite. */
export async function createWorkerLogin(params: {
  organizationId: string
  orgSlug: string
  code: string
  name: string
  phone: string
  email?: string | null
}) {
  const preferred = params.email ? normaliseEmail(params.email) : null
  if (preferred) {
    const taken = await prisma.user.findUnique({ where: { email: preferred }, select: { id: true } })
    if (taken) throw new ConflictError('That email already has a StayFlow login')
  }
  const user = await prisma.user.create({
    data: {
      organizationId: params.organizationId,
      email: preferred ?? generatedLoginEmail(params.code, params.orgSlug),
      phone: params.phone,
      name: params.name,
      passwordHash: await unusablePasswordHash(),
      mustChangePassword: true,
      role: 'WORKER',
      status: 'ACTIVE',
    },
  })
  return user.id
}

/** Resends the OWNER's link for an organization (platform admin). */
export async function sendOwnerAccess(organizationId: string) {
  const owner = await prisma.user.findFirst({
    where: { organizationId, role: 'OWNER', status: { in: ['ACTIVE', 'INVITED'] } },
    orderBy: { createdAt: 'asc' },
    select: { id: true, name: true },
  })
  if (!owner) throw new NotFoundError('This organization has no active owner login')
  return { owner, ...(await sendAccessLink(owner.id)) }
}
