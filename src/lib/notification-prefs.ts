/**
 * Per-type notification switches (Settings → Notifications), stored in
 * OrgSetting.notificationSettings as overrides only:
 *
 *   { "version": 1, "types": { "RENT_REMINDER": { "WHATSAPP": false } } }
 *
 * Anything not stored is ON, so an organization that never opens the page
 * keeps exactly the behaviour it had before these switches existed.
 *
 * Covers what residents receive. Alerts to the owner and team are always on.
 * No server-only imports: the settings UI renders this catalogue.
 */

export const PREF_CHANNELS = ['IN_APP', 'WHATSAPP', 'EMAIL'] as const
export type PrefChannel = (typeof PREF_CHANNELS)[number]

export const CHANNEL_LABEL: Record<PrefChannel, string> = {
  IN_APP: 'In-app',
  WHATSAPP: 'WhatsApp',
  EMAIL: 'Email',
}

export type NotificationTypeDef = {
  label: string
  description: string
  /** Channels this type is actually sent on today. */
  channels: PrefChannel[]
  /** Cannot be switched off (people must always be able to sign in). */
  locked?: boolean
}

export const NOTIFICATION_TYPES = {
  RENT_INVOICE: {
    label: 'New rent invoice',
    description: 'When the month’s rent invoice is raised.',
    channels: ['IN_APP'],
  },
  RENT_REMINDER: {
    label: 'Rent reminder',
    description: 'Before the due date and on the due date.',
    channels: ['IN_APP', 'WHATSAPP'],
  },
  RENT_OVERDUE: {
    label: 'Overdue rent',
    description: 'Repeated after the due date until paid.',
    channels: ['IN_APP', 'WHATSAPP'],
  },
  PAYMENT_RECEIPT: {
    label: 'Payment receipt',
    description: 'When a payment is recorded or received online.',
    channels: ['IN_APP', 'WHATSAPP'],
  },
  COMPLAINT_UPDATE: {
    label: 'Complaint updates',
    description: 'Assigned, work started, resolved and replies.',
    channels: ['IN_APP', 'WHATSAPP'],
  },
  ANNOUNCEMENT: {
    label: 'Announcements',
    description: 'Notices you send from Announcements.',
    channels: ['IN_APP', 'WHATSAPP'],
  },
  STAY_UPDATE: {
    label: 'Welcome & room changes',
    description: 'Welcome message at check-in and room or bed changes.',
    channels: ['IN_APP', 'WHATSAPP'],
  },
  REQUEST_UPDATE: {
    label: 'Request updates',
    description: 'Leave, visitor, room-change and service requests.',
    channels: ['IN_APP'],
  },
  VISITOR: {
    label: 'Visitor at the gate',
    description: 'When a visitor for the resident signs in.',
    channels: ['IN_APP'],
  },
  CHECKOUT: {
    label: 'Checkout & refund',
    description: 'Settlement summary and deposit refund.',
    channels: ['WHATSAPP'],
  },
  ACCOUNT_ACCESS: {
    label: 'Login links',
    description: 'Invites and password resets. Always sent.',
    channels: ['WHATSAPP', 'EMAIL'],
    locked: true,
  },
} satisfies Record<string, NotificationTypeDef>

export type NotificationType = keyof typeof NOTIFICATION_TYPES
export const NOTIFICATION_TYPE_KEYS = Object.keys(NOTIFICATION_TYPES) as NotificationType[]

export function isNotificationType(value: unknown): value is NotificationType {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(NOTIFICATION_TYPES, value)
}

export type NotificationPrefs = {
  version: 1
  /** Only switched-off (false) or explicitly-on entries are stored. */
  types: Partial<Record<NotificationType, Partial<Record<PrefChannel, boolean>>>>
}

export const DEFAULT_PREFS: NotificationPrefs = { version: 1, types: {} }

/**
 * Reads whatever is stored. Unknown types, unknown channels and non-boolean
 * values are dropped, so a malformed row can never switch anything off.
 */
export function parseNotificationPrefs(raw: unknown): NotificationPrefs {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { version: 1, types: {} }
  const types = (raw as { types?: unknown }).types
  const out: NotificationPrefs = { version: 1, types: {} }
  if (!types || typeof types !== 'object' || Array.isArray(types)) return out
  for (const [type, channels] of Object.entries(types as Record<string, unknown>)) {
    if (!isNotificationType(type) || !channels || typeof channels !== 'object' || Array.isArray(channels)) continue
    const entry: Partial<Record<PrefChannel, boolean>> = {}
    for (const channel of PREF_CHANNELS) {
      const value = (channels as Record<string, unknown>)[channel]
      if (typeof value === 'boolean') entry[channel] = value
    }
    if (Object.keys(entry).length) out.types[type] = entry
  }
  return out
}

/** Locked types and channels a type is not sent on are always reported ON. */
export function isChannelOn(prefs: NotificationPrefs, type: NotificationType, channel: PrefChannel): boolean {
  const def: NotificationTypeDef = NOTIFICATION_TYPES[type]
  if (def.locked) return true
  return prefs.types[type]?.[channel] !== false
}

/** Full on/off grid, for the settings UI. */
export function prefsGrid(prefs: NotificationPrefs): Record<NotificationType, Partial<Record<PrefChannel, boolean>>> {
  const grid = {} as Record<NotificationType, Partial<Record<PrefChannel, boolean>>>
  for (const type of NOTIFICATION_TYPE_KEYS) {
    const def: NotificationTypeDef = NOTIFICATION_TYPES[type]
    grid[type] = {}
    for (const channel of def.channels) grid[type][channel] = isChannelOn(prefs, type, channel)
  }
  return grid
}

/**
 * Applies changes from the settings UI. Ignores locked types and channels a
 * type is not sent on; stores only what is OFF (ON is the default).
 */
export function applyPrefChanges(
  prefs: NotificationPrefs,
  changes: { type: string; channel: string; enabled: boolean }[],
): NotificationPrefs {
  const next: NotificationPrefs = { version: 1, types: {} }
  for (const [type, entry] of Object.entries(prefs.types)) next.types[type as NotificationType] = { ...entry }
  for (const change of changes) {
    if (!isNotificationType(change.type)) continue
    const def: NotificationTypeDef = NOTIFICATION_TYPES[change.type]
    const channel = change.channel as PrefChannel
    if (def.locked || !def.channels.includes(channel)) continue
    const entry = { ...(next.types[change.type] ?? {}) }
    if (change.enabled) delete entry[channel]
    else entry[channel] = false
    if (Object.keys(entry).length) next.types[change.type] = entry
    else delete next.types[change.type]
  }
  return next
}

/** Which switch governs each WhatsApp template. */
export const TEMPLATE_TYPE: Record<string, NotificationType> = {
  rent_reminder_upcoming: 'RENT_REMINDER',
  rent_reminder_due_today: 'RENT_REMINDER',
  rent_reminder_overdue: 'RENT_OVERDUE',
  payment_receipt: 'PAYMENT_RECEIPT',
  complaint_update: 'COMPLAINT_UPDATE',
  announcement: 'ANNOUNCEMENT',
  welcome_resident: 'STAY_UPDATE',
  checkout_settlement: 'CHECKOUT',
  account_invite: 'ACCOUNT_ACCESS',
  password_reset: 'ACCOUNT_ACCESS',
}

export function typeForTemplate(template: string | null | undefined): NotificationType | null {
  return template ? (TEMPLATE_TYPE[template] ?? null) : null
}

/**
 * In-app notifications to residents carry a NotificationKind. Senders may
 * name the type explicitly; otherwise it follows from the kind.
 */
export function typeForKind(kind: string): NotificationType | null {
  switch (kind) {
    case 'RENT':
      return 'RENT_INVOICE'
    case 'PAYMENT':
      return 'PAYMENT_RECEIPT'
    case 'COMPLAINT':
    case 'MAINTENANCE':
      return 'COMPLAINT_UPDATE'
    case 'ANNOUNCEMENT':
      return 'ANNOUNCEMENT'
    case 'SYSTEM':
      return 'STAY_UPDATE'
    default:
      return null
  }
}

// ------------------------------------------------------------------ centre

/** Groups used by the notification centre's "type" filter. */
export const MESSAGE_GROUPS = {
  rent: { label: 'Rent & reminders', templates: ['rent_reminder_upcoming', 'rent_reminder_due_today', 'rent_reminder_overdue'], kinds: ['RENT'] },
  payment: { label: 'Payments', templates: ['payment_receipt'], kinds: ['PAYMENT'] },
  complaint: { label: 'Complaints', templates: ['complaint_update'], kinds: ['COMPLAINT', 'MAINTENANCE'] },
  announcement: { label: 'Announcements', templates: ['announcement'], kinds: ['ANNOUNCEMENT'] },
  stay: { label: 'Check-in, checkout & requests', templates: ['welcome_resident', 'checkout_settlement'], kinds: ['SYSTEM'] },
  account: { label: 'Login links', templates: ['account_invite', 'password_reset'], kinds: [] },
  other: { label: 'Kitchen, staff, leads & billing', templates: [], kinds: ['FOOD', 'GROCERY', 'SUBSCRIPTION', 'LEAD'] },
} as const

export type MessageGroup = keyof typeof MESSAGE_GROUPS

export function isMessageGroup(value: unknown): value is MessageGroup {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(MESSAGE_GROUPS, value)
}

/** Sample values for a template preview ("{{1}}" → "Priya Sharma"). */
export function sampleValue(variable: string): string {
  const v = variable.toLowerCase()
  if (v.includes('resident') || v === 'name') return 'Priya Sharma'
  if (v.includes('amount') || v.includes('balance')) return '₹8,500'
  if (v.includes('date')) return '5 November'
  if (v.includes('pg')) return 'Sunrise Residency'
  if (v.includes('room')) return '204 · Bed B'
  if (v.includes('receipt')) return 'RCP-0142'
  if (v.includes('complaint code')) return 'CMP-0031'
  if (v.includes('complaint title')) return 'Geyser not working'
  if (v.includes('announcement title')) return 'Water supply'
  if (v.includes('announcement text')) return 'No water from 10 am to 1 pm on Sunday for tank cleaning.'
  if (v.includes('organization')) return 'Sunrise Residency'
  if (v.includes('link')) return 'https://stayflow.app/l/abc123'
  if (v.includes('refund')) return '₹12,000'
  if (v.includes('owner')) return 'Murugan S'
  if (v.includes('invoice number')) return 'SF-202611-0004'
  if (v.includes('when it is due')) return 'tomorrow, 12 Nov'
  if (v.includes('days left')) return '3 days left'
  if (v.includes('status line')) return 'Your account is active.'
  return variable
}
