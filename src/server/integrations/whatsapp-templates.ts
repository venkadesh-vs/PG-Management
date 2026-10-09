/**
 * The WhatsApp message templates StayFlow sends, exactly as they must be
 * submitted for approval in Meta Business Manager.
 *
 * Meta only delivers business-initiated messages that use an APPROVED
 * template, and it matches on name + language. The body text here is the
 * source of truth: the settings page shows it for copy-paste, the sender
 * checks every request against `variables` before calling Meta, and
 * docs/whatsapp-setup.md lists the same texts.
 *
 * Changing a body here does NOT change the approved template — resubmit it in
 * Meta (and keep the variable order) or live messages will be rejected.
 *
 * No server-only imports: the owner settings page renders this list.
 */

export type WhatsAppTemplateCategory = 'UTILITY' | 'AUTHENTICATION' | 'MARKETING'

export type WhatsAppTemplateDef = {
  /** Short label for the outbox and settings UI. */
  label: string
  category: WhatsAppTemplateCategory
  /** Meta language code the template is approved under. */
  language: string
  /** Body with {{1}}..{{n}} placeholders, in order of appearance. */
  body: string
  /** What each placeholder carries, in order. Its length is the variable count. */
  variables: string[]
  /**
   * Sent even to a resident who replied STOP: account access messages the
   * recipient asked for (invite, password reset), never promotional.
   */
  bypassOptOut?: boolean
  /** Shown next to the template on the settings page. */
  note?: string
  /**
   * 'owner': StayFlow's own billing messages to PG owners, sent from the
   * platform number. Not a resident message, so no per-PG on/off switch.
   */
  audience?: 'owner'
}

export const DEFAULT_TEMPLATE_LANGUAGE = 'en'

export const WHATSAPP_TEMPLATES = {
  rent_reminder_upcoming: {
    label: 'Rent reminder — before due',
    category: 'UTILITY',
    language: DEFAULT_TEMPLATE_LANGUAGE,
    body:
      'Hi {{1}}, this is a friendly reminder that your rent of {{2}} is due on {{3}} for {{4}} (room {{5}}). ' +
      'You can pay from the StayFlow resident app. Please ignore this message if you have already paid.',
    variables: ['Resident name', 'Amount', 'Due date', 'PG name', 'Room / bed'],
  },
  rent_reminder_due_today: {
    label: 'Rent reminder — due today',
    category: 'UTILITY',
    language: DEFAULT_TEMPLATE_LANGUAGE,
    body:
      'Hi {{1}}, your rent of {{2}} is due today, {{3}}, for {{4}} (room {{5}}). ' +
      'You can pay from the StayFlow resident app. Please ignore this message if you have already paid.',
    variables: ['Resident name', 'Amount', 'Due date', 'PG name', 'Room / bed'],
  },
  rent_reminder_overdue: {
    label: 'Rent reminder — overdue',
    category: 'UTILITY',
    language: DEFAULT_TEMPLATE_LANGUAGE,
    body:
      'Hi {{1}}, your rent of {{2}} was due on {{3}} for {{4}} (room {{5}}) and is still pending. ' +
      'Please pay at the earliest from the StayFlow resident app to avoid late fees. Ignore this message if you have already paid.',
    variables: ['Resident name', 'Balance', 'Due date', 'PG name', 'Room / bed'],
  },
  payment_receipt: {
    label: 'Payment receipt',
    category: 'UTILITY',
    language: DEFAULT_TEMPLATE_LANGUAGE,
    body:
      'Hi {{1}}, we have received your payment of {{2}}. Your receipt number is {{3}}. ' +
      'You can download the receipt from the StayFlow resident app. Thank you!',
    variables: ['Resident name', 'Amount', 'Receipt number'],
  },
  complaint_update: {
    label: 'Complaint update',
    category: 'UTILITY',
    language: DEFAULT_TEMPLATE_LANGUAGE,
    body:
      'Hi {{1}}, your complaint {{2}} ({{3}}) has been marked as resolved. ' +
      'If the issue is still there, you can reopen it from the StayFlow resident app.',
    variables: ['Resident name', 'Complaint code', 'Complaint title'],
  },
  announcement: {
    label: 'Announcement',
    category: 'UTILITY',
    language: DEFAULT_TEMPLATE_LANGUAGE,
    body: 'Hi {{1}}, there is a new notice from your PG. {{2}}: {{3}} — You can see all notices in the StayFlow resident app.',
    variables: ['Resident name', 'Announcement title', 'Announcement text'],
    note: 'Carries the announcement text as a variable (line breaks become " · "). Meta may re-classify it as MARKETING if it is used for offers — keep announcements operational.',
  },
  welcome_resident: {
    label: 'Welcome message',
    category: 'UTILITY',
    language: DEFAULT_TEMPLATE_LANGUAGE,
    body:
      'Hi {{1}}, welcome to {{2}}! Your room / bed is {{3}}. ' +
      'You can pay rent, raise complaints and see the food menu from the StayFlow resident app.',
    variables: ['Resident name', 'PG name', 'Room / bed'],
  },
  checkout_settlement: {
    label: 'Checkout settlement',
    category: 'UTILITY',
    language: DEFAULT_TEMPLATE_LANGUAGE,
    body:
      'Hi {{1}}, your checkout is complete. Deposit refund due to you: {{2}}. ' +
      'Any balance still payable is shown in the StayFlow resident app. Thank you for staying with us.',
    variables: ['Resident name', 'Refund amount'],
  },
  account_invite: {
    label: 'Account invite',
    category: 'UTILITY',
    language: DEFAULT_TEMPLATE_LANGUAGE,
    body: 'Hi {{1}}, you have been invited to join {{2}} on StayFlow. Set up your account here: {{3}} — this link expires soon.',
    variables: ['Name', 'Organization name', 'Invite link'],
    bypassOptOut: true,
    note: 'Account access message — sent even after a STOP. Submit as UTILITY: Meta’s AUTHENTICATION category only accepts its fixed one-time-code layout and no links.',
  },
  password_reset: {
    label: 'Password reset',
    category: 'UTILITY',
    language: DEFAULT_TEMPLATE_LANGUAGE,
    body: 'Hi {{1}}, use this link to reset your StayFlow password: {{2}} — it expires soon. If you did not ask for this, ignore this message.',
    variables: ['Name', 'Reset link'],
    bypassOptOut: true,
    note: 'Account access message — sent even after a STOP. Submit as UTILITY: Meta’s AUTHENTICATION category only accepts its fixed one-time-code layout and no links.',
  },
  // ---- StayFlow billing to PG owners, sent from the platform number ----
  owner_trial_ending: {
    audience: 'owner',
    label: 'Owner — trial ending',
    category: 'UTILITY',
    language: DEFAULT_TEMPLATE_LANGUAGE,
    body:
      'Hi {{1}}, your StayFlow free trial for {{2}} ends on {{3}}. After that the plan is {{4}} a month. ' +
      'You can pay or set up AutoPay here: {{5}}',
    variables: ['Owner name', 'PG name', 'Trial end date', 'Monthly amount', 'Pay link'],
    note: 'Sent from the StayFlow platform number to the PG owner.',
  },
  owner_invoice_due: {
    audience: 'owner',
    label: 'Owner — invoice due',
    category: 'UTILITY',
    language: DEFAULT_TEMPLATE_LANGUAGE,
    body: 'Hi {{1}}, your StayFlow invoice {{2}} of {{3}} for {{4}} is due {{5}}. Pay securely here: {{6}}',
    variables: ['Owner name', 'Invoice number', 'Amount', 'PG name', 'When it is due (e.g. "tomorrow, 12 Oct")', 'Pay link'],
    note: 'Sent when the invoice is raised and again before the due date.',
  },
  owner_grace_reminder: {
    audience: 'owner',
    label: 'Owner — payment pending (grace)',
    category: 'UTILITY',
    language: DEFAULT_TEMPLATE_LANGUAGE,
    body:
      'Hi {{1}}, your StayFlow payment of {{2}} for {{3}} is pending. Your account stays fully active until {{4}} ({{5}}). ' +
      'Pay here to avoid a pause: {{6}}',
    variables: ['Owner name', 'Amount', 'PG name', 'Last active date', 'Days left (e.g. "3 days left")', 'Pay link'],
  },
  owner_suspended: {
    audience: 'owner',
    label: 'Owner — account paused',
    category: 'UTILITY',
    language: DEFAULT_TEMPLATE_LANGUAGE,
    body:
      'Hi {{1}}, your StayFlow account for {{2}} is paused because {{3}} is unpaid. Your data is safe. ' +
      'Pay here to restore access instantly: {{4}}',
    variables: ['Owner name', 'PG name', 'Amount due', 'Pay link'],
  },
  owner_payment_received: {
    audience: 'owner',
    label: 'Owner — payment received',
    category: 'UTILITY',
    language: DEFAULT_TEMPLATE_LANGUAGE,
    body: 'Hi {{1}}, we have received {{2}} for StayFlow invoice {{3}} ({{4}}). {{5}} Thank you!',
    variables: ['Owner name', 'Amount', 'Invoice number', 'PG name', 'Status line (e.g. "Your account is active.")'],
  },
} satisfies Record<string, WhatsAppTemplateDef>

export type WhatsAppTemplateName = keyof typeof WHATSAPP_TEMPLATES

export function getTemplate(name: string): WhatsAppTemplateDef | null {
  return Object.prototype.hasOwnProperty.call(WHATSAPP_TEMPLATES, name)
    ? (WHATSAPP_TEMPLATES as Record<string, WhatsAppTemplateDef>)[name]
    : null
}

export function templateLabel(name: string | null | undefined): string {
  if (!name) return 'Message'
  return getTemplate(name)?.label ?? name
}

/** Meta's ceiling for a template body after the variables are filled in. */
export const MAX_TEMPLATE_BODY = 1024

/**
 * Meta rejects template parameters containing newlines, tabs or more than
 * four consecutive spaces, and empty ones. Flatten instead of failing:
 * line breaks become " · ", runs of whitespace collapse to one space.
 */
export function sanitizeVariable(value: unknown): string {
  // Trim first so leading/trailing line breaks don't become a stray " · ".
  const text = String(value ?? '')
    .trim()
    .replace(/\r\n?/g, '\n')
    .replace(/\s*\n+\s*/g, ' · ')
    .replace(/[\t\f\v ]+/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim()
  const clean = text.slice(0, MAX_TEMPLATE_BODY).trim()
  return clean || '-'
}

/** Fills {{n}} placeholders, for previews and length checks. */
export function renderTemplate(def: WhatsAppTemplateDef, variables: string[]): string {
  return def.body.replace(/\{\{(\d+)\}\}/g, (_, n: string) => variables[Number(n) - 1] ?? `{{${n}}}`)
}

/**
 * Sanitises every variable, then shortens the longest one(s) until the
 * rendered body fits Meta's 1024-character limit.
 */
export function prepareVariables(def: WhatsAppTemplateDef, raw: unknown[]): string[] {
  const vars = raw.map(sanitizeVariable)
  let overflow = renderTemplate(def, vars).length - MAX_TEMPLATE_BODY
  while (overflow > 0) {
    let longest = 0
    for (let i = 1; i < vars.length; i++) if (vars[i].length > vars[longest].length) longest = i
    const current = vars[longest]
    const keep = Math.max(1, current.length - overflow - 1)
    if (keep >= current.length) break
    vars[longest] = `${current.slice(0, keep).trimEnd()}…`
    overflow = renderTemplate(def, vars).length - MAX_TEMPLATE_BODY
  }
  return vars
}
