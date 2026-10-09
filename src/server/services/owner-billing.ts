import 'server-only'

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { serverEnv } from '@/lib/env'
import { ConflictError, NotFoundError } from '@/lib/tenancy'
import { formatDate, formatMoney, startOfDay } from '@/lib/utils'
import { log } from '@/lib/logger'
import {
  DEFAULT_REMINDER_SCHEDULE,
  OWNER_BILLING_CHANNELS,
  daysLeftLabel,
  dueWhen,
  graceBanner,
  lastActiveDay,
  parsePaymentDetails,
  parseReminderSchedule,
  reminderKey,
  remindersDue,
  upiPayLink,
  type OwnerBillingChannel,
  type OwnerBillingKind,
  type PlatformPaymentDetails,
  type ReminderSchedule,
} from '@/lib/owner-billing'
import { notifyOrgAdmins, notifySuperAdmins, recordActivity } from '../events'
import { sendWhatsApp } from '../integrations/whatsapp'
import { sendEmail } from '../integrations/email'
import type { WhatsAppTemplateName } from '../integrations/whatsapp-templates'
import { assertOwnUploads } from './complaints'

/**
 * StayFlow's own billing conversation with PG owners: every lifecycle notice
 * goes in-app plus (unless the owner opted out) WhatsApp from the platform
 * number and email. Each notice is keyed so it is sent exactly once; a failed
 * send never touches the billing data it describes.
 */

const UNPAID = ['PENDING', 'PARTIALLY_PAID', 'OVERDUE'] as const
const PAYMENT_DETAILS_KEY = 'billing:payment_details'
const SCHEDULE_KEY = 'billing:reminder_schedule'

export function payLink() {
  return `${serverEnv.appUrl}/app/subscription`
}

// ------------------------------------------------------ platform settings ----

export async function getPlatformPaymentDetails(): Promise<PlatformPaymentDetails> {
  const row = await prisma.systemSetting.findUnique({ where: { key: PAYMENT_DETAILS_KEY } })
  return parsePaymentDetails(row?.value)
}

export async function getReminderSchedule(): Promise<ReminderSchedule> {
  const row = await prisma.systemSetting.findUnique({ where: { key: SCHEDULE_KEY } })
  return row ? parseReminderSchedule(row.value) : DEFAULT_REMINDER_SCHEDULE
}

export async function savePlatformBillingSettings(
  /** Already validated by the route; parsed again here so stored values are always clean. */
  input: { paymentDetails?: unknown; schedule?: unknown },
  actor: { id?: string; name: string },
) {
  const before = { paymentDetails: await getPlatformPaymentDetails(), schedule: await getReminderSchedule() }
  if (input.paymentDetails) {
    const value = parsePaymentDetails(input.paymentDetails) as unknown as Prisma.InputJsonValue
    await prisma.systemSetting.upsert({
      where: { key: PAYMENT_DETAILS_KEY },
      create: { key: PAYMENT_DETAILS_KEY, value },
      update: { value },
    })
  }
  if (input.schedule) {
    const value = parseReminderSchedule(input.schedule) as unknown as Prisma.InputJsonValue
    await prisma.systemSetting.upsert({
      where: { key: SCHEDULE_KEY },
      create: { key: SCHEDULE_KEY, value },
      update: { value },
    })
  }
  const after = { paymentDetails: await getPlatformPaymentDetails(), schedule: await getReminderSchedule() }
  await recordActivity({
    actorId: actor.id,
    actorName: actor.name,
    actorRole: 'SUPER_ADMIN',
    event: 'SETTINGS_UPDATED',
    entityType: 'SystemSetting',
    entityId: 'billing',
    summary: 'StayFlow billing settings updated (payment details / reminder schedule)',
    before: before as unknown as Prisma.InputJsonValue,
    after: after as unknown as Prisma.InputJsonValue,
  })
  return after
}

/** Which extra channels this owner gets billing notices on (in-app is always on). */
export async function ownerBillingChannels(organizationId: string): Promise<OwnerBillingChannel[]> {
  const settings = await prisma.orgSetting.findUnique({
    where: { organizationId },
    select: { ownerBillingChannels: true },
  })
  const stored = settings?.ownerBillingChannels ?? OWNER_BILLING_CHANNELS
  return OWNER_BILLING_CHANNELS.filter((c) => stored.includes(c))
}

export async function setOwnerBillingChannels(
  organizationId: string,
  channels: OwnerBillingChannel[],
  actor: { id?: string; name: string },
) {
  const before = await ownerBillingChannels(organizationId)
  const next = OWNER_BILLING_CHANNELS.filter((c) => channels.includes(c))
  await prisma.orgSetting.upsert({
    where: { organizationId },
    create: { organizationId, ownerBillingChannels: next },
    update: { ownerBillingChannels: next },
  })
  await recordActivity({
    organizationId,
    actorId: actor.id,
    actorName: actor.name,
    event: 'SETTINGS_UPDATED',
    entityType: 'OrgSetting',
    entityId: organizationId,
    summary: `StayFlow billing reminders: ${next.length ? next.join(' + ').toLowerCase() : 'in-app only'}`,
    before: { ownerBillingChannels: before },
    after: { ownerBillingChannels: next },
  })
  return next
}

// ----------------------------------------------------------- messages ----

export type OwnerBillingData = {
  propertyName: string
  amount?: number
  invoiceNumber?: string
  date?: Date
  daysBefore?: number
  daysLeft?: number
  reactivated?: boolean
}

type Rendered = {
  title: string
  body: string
  template: WhatsAppTemplateName
  variables: (ownerName: string) => string[]
  subject: string
}

function render(kind: OwnerBillingKind, d: OwnerBillingData): Rendered {
  const amount = formatMoney(d.amount ?? 0)
  const date = d.date ? formatDate(d.date) : ''
  const link = payLink()
  switch (kind) {
    case 'TRIAL_ENDING':
      return {
        title: d.daysBefore === 1 ? 'Your free trial ends tomorrow' : `Your free trial ends in ${d.daysBefore} days`,
        body: `${d.propertyName}'s StayFlow trial ends on ${date}. The plan then costs ${amount} a month. Pay or set up AutoPay to carry on without a break.`,
        template: 'owner_trial_ending',
        variables: (name) => [name, d.propertyName, date, amount, link],
        subject: `Your StayFlow trial for ${d.propertyName} ends on ${date}`,
      }
    case 'INVOICE_RAISED':
    case 'DUE_SOON': {
      const when = dueWhen(d.daysBefore ?? 99, date)
      return {
        title:
          kind === 'INVOICE_RAISED'
            ? 'Subscription invoice raised'
            : d.daysBefore === 0
              ? 'Subscription payment due today'
              : 'Subscription payment due tomorrow',
        body: `${d.invoiceNumber} · ${amount} for ${d.propertyName} is due ${when}.`,
        template: 'owner_invoice_due',
        variables: (name) => [name, d.invoiceNumber ?? '', amount, d.propertyName, when, link],
        subject: `StayFlow invoice ${d.invoiceNumber} · ${amount} due ${when}`,
      }
    }
    case 'GRACE_STARTED':
    case 'GRACE_REMINDER': {
      const left = daysLeftLabel(d.daysLeft ?? 0)
      return {
        title: kind === 'GRACE_STARTED' ? 'Subscription payment pending' : `Payment pending · ${left}`,
        body: `${amount} for ${d.propertyName} is pending. Your account stays fully active until ${date} (${left}). Pay to avoid a pause.`,
        template: 'owner_grace_reminder',
        variables: (name) => [name, amount, d.propertyName, date, left, link],
        subject: `StayFlow payment pending · account active until ${date}`,
      }
    }
    case 'SUSPENDED':
      return {
        title: 'Account paused — payment needed',
        body: `${d.propertyName}'s StayFlow account is paused because ${amount} is unpaid. Your data is safe. Pay to restore access instantly.`,
        template: 'owner_suspended',
        variables: (name) => [name, d.propertyName, amount, link],
        subject: `Your StayFlow account for ${d.propertyName} is paused`,
      }
    case 'PAYMENT_RECEIVED': {
      const status = d.reactivated ? 'Your account is active again.' : 'Your account is active.'
      return {
        title: d.reactivated ? 'Payment received — account restored' : 'Subscription payment received',
        body: `${amount} for ${d.propertyName}. Invoice ${d.invoiceNumber}. ${status}`,
        template: 'owner_payment_received',
        variables: (name) => [name, amount, d.invoiceNumber ?? '', d.propertyName, status],
        subject: `Payment received · StayFlow invoice ${d.invoiceNumber}`,
      }
    }
  }
}

function isUnique(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}

/**
 * Sends one StayFlow billing notice to a PG's owners, exactly once per `key`.
 * The key row is written first: a second call (rerun, race, retry) finds it
 * and sends nothing. Never throws — billing must not depend on messaging.
 */
export async function notifyOwnerBilling(
  organizationId: string,
  kind: OwnerBillingKind,
  data: OwnerBillingData,
  opts: { key: string; subscriptionId?: string; invoiceId?: string },
): Promise<{ sent: boolean; channels: string[] }> {
  try {
    const channels = await ownerBillingChannels(organizationId)
    try {
      await prisma.ownerBillingReminder.create({
        data: {
          organizationId,
          subscriptionId: opts.subscriptionId,
          invoiceId: opts.invoiceId,
          kind,
          key: opts.key,
          channels: ['IN_APP', ...channels],
        },
      })
    } catch (error) {
      if (isUnique(error)) return { sent: false, channels: [] }
      throw error
    }

    const message = render(kind, data)
    await notifyOrgAdmins(organizationId, {
      kind: 'SUBSCRIPTION',
      title: message.title,
      body: message.body,
      link: '/app/subscription',
    })

    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { ownerName: true, contactEmail: true, contactPhone: true, whatsappPhone: true },
    })
    if (!org) return { sent: true, channels: ['IN_APP'] }

    if (channels.includes('WHATSAPP')) {
      const phone = org.whatsappPhone || org.contactPhone
      if (phone) {
        // Platform number (organizationId null): this is StayFlow writing to
        // its customer, never the PG's own number.
        await sendWhatsApp({
          organizationId: null,
          toName: org.ownerName,
          toPhone: phone,
          template: message.template,
          body: message.body,
          variables: message.variables(org.ownerName),
          refType: 'OwnerBilling',
          refId: opts.key,
        }).catch((error) => log('warn', 'owner_billing.whatsapp_failed', { organizationId, kind, message: (error as Error).message }))
      }
    }
    if (channels.includes('EMAIL') && org.contactEmail) {
      await sendEmail({
        organizationId,
        to: org.contactEmail,
        toName: org.ownerName,
        subject: message.subject,
        text: `Hi ${org.ownerName},\n\n${message.body}\n\nPay or view your invoices: ${payLink()}\n\n— StayFlow`,
        template: message.template,
        refType: 'OwnerBilling',
        refId: opts.key,
      }).catch((error) => log('warn', 'owner_billing.email_failed', { organizationId, kind, message: (error as Error).message }))
    }
    return { sent: true, channels: ['IN_APP', ...channels] }
  } catch (error) {
    log('error', 'owner_billing.notify_failed', {
      organizationId,
      kind,
      code: 'INTEGRATION_FAILED',
      message: (error as Error).message,
    })
    return { sent: false, channels: [] }
  }
}

// ------------------------------------------------------ daily reminders ----

/**
 * Scheduled reminders (trial ending, due tomorrow / today, grace days left).
 * Safe to run any number of times a day: each reminder's key is recorded.
 */
export async function runOwnerBillingReminders(now = new Date(), organizationId?: string) {
  const schedule = await getReminderSchedule()
  const today = startOfDay(now)
  const subscriptions = await prisma.subscription.findMany({
    where: {
      status: { in: ['TRIALING', 'ACTIVE', 'PAST_DUE', 'GRACE'] },
      ...(organizationId ? { organizationId } : {}),
    },
    include: {
      property: { select: { name: true } },
      invoices: { where: { status: { in: [...UNPAID] } }, orderBy: { dueDate: 'asc' } },
    },
  })

  let sent = 0
  for (const sub of subscriptions) {
    const due = remindersDue({
      today,
      subscription: {
        id: sub.id,
        status: sub.status,
        trialEndsAt: sub.trialEndsAt,
        graceEndsAt: sub.graceEndsAt,
        autopay: sub.autopayEnabled && sub.mandateStatus === 'ACTIVE',
      },
      invoices: sub.invoices.map((i) => ({
        id: i.id,
        number: i.number,
        dueDate: i.dueDate,
        balance: Math.max(0, i.total - i.amountPaid),
      })),
      schedule,
    })
    for (const reminder of due) {
      const result =
        reminder.kind === 'TRIAL_ENDING'
          ? await notifyOwnerBilling(
              sub.organizationId,
              'TRIAL_ENDING',
              { propertyName: sub.property.name, amount: sub.amount, date: reminder.trialEndsAt, daysBefore: reminder.daysBefore },
              { key: reminder.key, subscriptionId: sub.id },
            )
          : reminder.kind === 'DUE_SOON'
            ? await notifyOwnerBilling(
                sub.organizationId,
                'DUE_SOON',
                {
                  propertyName: sub.property.name,
                  amount: reminder.invoice.balance,
                  invoiceNumber: reminder.invoice.number,
                  date: reminder.invoice.dueDate,
                  daysBefore: reminder.daysBefore,
                },
                { key: reminder.key, subscriptionId: sub.id, invoiceId: reminder.invoice.id },
              )
            : await notifyOwnerBilling(
                sub.organizationId,
                'GRACE_REMINDER',
                {
                  propertyName: sub.property.name,
                  amount: reminder.invoice.balance,
                  invoiceNumber: reminder.invoice.number,
                  date: reminder.lastActiveDay,
                  daysLeft: reminder.daysLeft,
                },
                { key: reminder.key, subscriptionId: sub.id, invoiceId: reminder.invoice.id },
              )
      if (result.sent) sent++
    }
  }
  return { sent }
}

// ------------------------------------------------------- grace & paywall ----

async function unpaidInvoices(organizationId: string) {
  return prisma.subscriptionInvoice.findMany({
    where: { subscription: { organizationId }, status: { in: [...UNPAID] } },
    include: { subscription: { select: { property: { select: { name: true } } } } },
    orderBy: { dueDate: 'asc' },
  })
}

/** The owner's grace banner, or null. */
export async function graceBannerFor(organizationId: string, now = new Date()) {
  const [subs, invoices] = await Promise.all([
    prisma.subscription.findMany({
      where: { organizationId },
      select: { status: true, graceEndsAt: true },
    }),
    unpaidInvoices(organizationId),
  ])
  return graceBanner({
    today: now,
    subscriptions: subs,
    invoices: invoices.map((i) => ({
      number: i.number,
      dueDate: i.dueDate,
      balance: Math.max(0, i.total - i.amountPaid),
    })),
  })
}

/** Everything the paywall shows. */
export async function paywallState(organizationId: string) {
  const [org, invoices, details, claims] = await Promise.all([
    prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true, status: true } }),
    unpaidInvoices(organizationId),
    getPlatformPaymentDetails(),
    prisma.subscriptionPaymentClaim.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      take: 5,
    }),
  ])
  if (!org) throw new NotFoundError('Account not found')
  const rows = invoices.map((i) => ({
    id: i.id,
    number: i.number,
    propertyName: i.subscription.property.name,
    periodStart: i.periodStart,
    periodEnd: i.periodEnd,
    amount: i.amount,
    tax: i.tax,
    total: i.total,
    paid: i.amountPaid,
    balance: Math.max(0, i.total - i.amountPaid),
  }))
  const totalDue = rows.reduce((sum, r) => sum + r.balance, 0)
  const notes = rows.map((r) => r.number).join(', ')
  return {
    organizationName: org.name,
    status: org.status,
    invoices: rows,
    totalDue,
    details,
    upiLink: upiPayLink({
      upiId: details.upiId,
      payeeName: details.payeeName,
      amount: totalDue,
      note: notes ? `StayFlow ${notes}`.slice(0, 50) : 'StayFlow subscription',
    }),
    claims: claims.map((c) => ({
      id: c.id,
      invoiceId: c.invoiceId,
      amount: c.amount,
      method: c.method,
      utr: c.utr,
      status: c.status,
      rejectReason: c.rejectReason,
      createdAt: c.createdAt,
    })),
  }
}

// ---------------------------------------------------------------- claims ----

/** Owner reports a UPI / bank transfer: a Super Admin verifies and marks it paid. */
export async function createPaymentClaim(params: {
  organizationId: string
  invoiceId: string
  method: 'UPI' | 'BANK_TRANSFER'
  utr: string
  proofUrl?: string | null
  note?: string | null
  actor: { id: string; name: string }
}) {
  const invoice = await prisma.subscriptionInvoice.findFirst({
    where: { id: params.invoiceId, subscription: { organizationId: params.organizationId } },
    include: { subscription: { select: { propertyId: true, property: { select: { name: true } } } } },
  })
  if (!invoice) throw new NotFoundError('Invoice not found')
  if (!UNPAID.includes(invoice.status as (typeof UNPAID)[number])) {
    throw new ConflictError('This invoice is already paid')
  }
  if (params.proofUrl) await assertOwnUploads(params.organizationId, [params.proofUrl])
  const pending = await prisma.subscriptionPaymentClaim.findFirst({
    where: { invoiceId: invoice.id, status: 'PENDING' },
  })
  if (pending) throw new ConflictError('We already have your payment details for this invoice and are checking them')

  const amount = Math.max(0, invoice.total - invoice.amountPaid)
  const claim = await prisma.subscriptionPaymentClaim.create({
    data: {
      organizationId: params.organizationId,
      invoiceId: invoice.id,
      amount,
      method: params.method,
      utr: params.utr,
      proofUrl: params.proofUrl || null,
      note: params.note || null,
      createdById: params.actor.id,
      createdByName: params.actor.name,
    },
  })
  await recordActivity({
    organizationId: params.organizationId,
    propertyId: invoice.subscription.propertyId,
    actorId: params.actor.id,
    actorName: params.actor.name,
    event: 'SUBSCRIPTION_CHANGED',
    entityType: 'SubscriptionInvoice',
    entityId: invoice.id,
    summary: `Payment reported for ${invoice.number}: ${formatMoney(amount)} by ${params.method === 'UPI' ? 'UPI' : 'bank transfer'} (UTR ${params.utr})`,
    meta: { claimId: claim.id },
  })

  const org = await prisma.organization.findUnique({ where: { id: params.organizationId }, select: { name: true } })
  const title = 'Payment to verify'
  const body = `${org?.name ?? 'A PG'} reports ${formatMoney(amount)} for ${invoice.number} by ${params.method === 'UPI' ? 'UPI' : 'bank transfer'}, UTR ${params.utr}. Check your bank and mark it paid.`
  await notifySuperAdmins({ kind: 'SUBSCRIPTION', title, body, link: '/admin/payments?tab=claims' }).catch(() => undefined)
  // Tell the platform owner outside the app too.
  const admins = await prisma.user.findMany({
    where: { role: 'SUPER_ADMIN', status: 'ACTIVE' },
    select: { email: true, name: true },
  })
  for (const admin of admins) {
    await sendEmail({
      organizationId: null,
      to: admin.email,
      toName: admin.name,
      subject: `${title}: ${invoice.number} · ${formatMoney(amount)}`,
      text: `${body}\n\nVerify: ${serverEnv.appUrl}/admin/payments?tab=claims`,
      refType: 'PaymentClaim',
      refId: claim.id,
    }).catch(() => undefined)
  }
  return claim
}

export async function listPaymentClaims(status?: 'PENDING' | 'APPROVED' | 'REJECTED') {
  const claims = await prisma.subscriptionPaymentClaim.findMany({
    where: status ? { status } : {},
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: { organization: { select: { name: true } } },
  })
  const invoices = await prisma.subscriptionInvoice.findMany({
    where: { id: { in: claims.map((c) => c.invoiceId) } },
    select: { id: true, number: true, status: true, total: true, amountPaid: true },
  })
  const byId = new Map(invoices.map((i) => [i.id, i]))
  return claims.map((c) => ({ ...c, invoice: byId.get(c.invoiceId) ?? null }))
}

/** Super Admin decision on a reported payment. Approval marks the invoice paid. */
export async function reviewPaymentClaim(params: {
  claimId: string
  decision: 'APPROVE' | 'REJECT'
  reason?: string
  actor: { id: string; name: string }
  markPaid: (invoiceId: string, method: 'UPI' | 'BANK_TRANSFER', reference: string) => Promise<unknown>
}) {
  const claim = await prisma.subscriptionPaymentClaim.findUnique({ where: { id: params.claimId } })
  if (!claim) throw new NotFoundError('Payment report not found')
  if (claim.status !== 'PENDING') throw new ConflictError('This payment report was already reviewed')

  // Claim the review first so two admins cannot both act on it.
  const moved = await prisma.subscriptionPaymentClaim.updateMany({
    where: { id: claim.id, status: 'PENDING' },
    data: {
      status: params.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED',
      reviewedById: params.actor.id,
      reviewedByName: params.actor.name,
      reviewedAt: new Date(),
      rejectReason: params.decision === 'REJECT' ? (params.reason ?? null) : null,
    },
  })
  if (moved.count !== 1) throw new ConflictError('This payment report was already reviewed')

  if (params.decision === 'APPROVE') {
    try {
      await params.markPaid(claim.invoiceId, claim.method === 'UPI' ? 'UPI' : 'BANK_TRANSFER', `UTR ${claim.utr}`)
    } catch (error) {
      // Put the claim back so it can be looked at again.
      await prisma.subscriptionPaymentClaim.update({
        where: { id: claim.id },
        data: { status: 'PENDING', reviewedById: null, reviewedByName: null, reviewedAt: null },
      })
      throw error
    }
  } else {
    const invoice = await prisma.subscriptionInvoice.findUnique({ where: { id: claim.invoiceId }, select: { number: true } })
    await notifyOrgAdmins(claim.organizationId, {
      kind: 'SUBSCRIPTION',
      title: 'Payment could not be verified',
      body: `We could not find your payment for ${invoice?.number ?? 'the invoice'} (UTR ${claim.utr}).${params.reason ? ` ${params.reason}` : ''} Please check the details or contact support.`,
      link: '/paywall',
    }).catch(() => undefined)
    await recordActivity({
      organizationId: claim.organizationId,
      actorId: params.actor.id,
      actorName: params.actor.name,
      actorRole: 'SUPER_ADMIN',
      event: 'ADMIN_ACTION',
      entityType: 'SubscriptionPaymentClaim',
      entityId: claim.id,
      summary: `Payment report UTR ${claim.utr} rejected${params.reason ? `: ${params.reason}` : ''}`,
      meta: { action: 'REJECT_PAYMENT_CLAIM' },
    })
  }
  return { status: params.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED' }
}

/** Key-and-send helpers used by the subscription lifecycle. */
export const ownerBillingEvents = {
  invoiceRaised: (sub: { id: string; organizationId: string; propertyName: string }, invoice: { id: string; number: string; total: number; dueDate: Date }) =>
    notifyOwnerBilling(
      sub.organizationId,
      'INVOICE_RAISED',
      { propertyName: sub.propertyName, amount: invoice.total, invoiceNumber: invoice.number, date: invoice.dueDate },
      { key: reminderKey.invoiceRaised(invoice.id), subscriptionId: sub.id, invoiceId: invoice.id },
    ),
  graceStarted: async (sub: { id: string; organizationId: string; propertyName: string; graceEndsAt: Date }, now = new Date()) => {
    const invoice = await prisma.subscriptionInvoice.findFirst({
      where: { subscriptionId: sub.id, status: { in: [...UNPAID] } },
      orderBy: { dueDate: 'asc' },
    })
    if (!invoice) return { sent: false, channels: [] as string[] }
    const left = Math.max(1, Math.round((startOfDay(sub.graceEndsAt).getTime() - startOfDay(now).getTime()) / 86400000))
    return notifyOwnerBilling(
      sub.organizationId,
      'GRACE_STARTED',
      {
        propertyName: sub.propertyName,
        amount: Math.max(0, invoice.total - invoice.amountPaid),
        invoiceNumber: invoice.number,
        date: lastActiveDay(sub.graceEndsAt),
        daysLeft: left,
      },
      { key: reminderKey.graceStarted(invoice.id), subscriptionId: sub.id, invoiceId: invoice.id },
    )
  },
  suspended: async (sub: { id: string; organizationId: string; propertyName: string; graceEndsAt: Date | null }) => {
    const invoices = await prisma.subscriptionInvoice.findMany({
      where: { subscriptionId: sub.id, status: { in: [...UNPAID] } },
    })
    const due = invoices.reduce((s, i) => s + Math.max(0, i.total - i.amountPaid), 0)
    return notifyOwnerBilling(
      sub.organizationId,
      'SUSPENDED',
      { propertyName: sub.propertyName, amount: due },
      { key: reminderKey.suspended(sub.id, sub.graceEndsAt ?? new Date()), subscriptionId: sub.id },
    )
  },
  paymentReceived: (
    organizationId: string,
    invoice: { id: string; number: string; propertyName: string; subscriptionId: string },
    amount: number,
    reactivated: boolean,
  ) =>
    notifyOwnerBilling(
      organizationId,
      'PAYMENT_RECEIVED',
      { propertyName: invoice.propertyName, amount, invoiceNumber: invoice.number, reactivated },
      { key: reminderKey.paymentReceived(invoice.id), subscriptionId: invoice.subscriptionId, invoiceId: invoice.id },
    ),
}
