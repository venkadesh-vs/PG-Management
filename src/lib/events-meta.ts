import type { EventType } from '@prisma/client'

/**
 * Presentation metadata for audit events. Kept out of `server/events.ts` on
 * purpose — the activity timeline is a client component and must not pull in
 * a `server-only` module.
 */

export const EVENT_LABEL: Record<EventType, string> = {
  RESIDENT_CREATED: 'Resident created',
  RESIDENT_CHECKED_IN: 'Resident checked in',
  RESIDENT_UPDATED: 'Resident updated',
  BED_ALLOCATED: 'Bed allocated',
  BED_RELEASED: 'Bed released',
  ROOM_CHANGED: 'Room changed',
  RENT_GENERATED: 'Rent generated',
  RENT_DUE: 'Rent due',
  RENT_OVERDUE: 'Rent overdue',
  PAYMENT_COMPLETED: 'Payment received',
  PAYMENT_FAILED: 'Payment failed',
  REFUND_ISSUED: 'Refund issued',
  CHECKOUT_COMPLETED: 'Checkout completed',
  COMPLAINT_CREATED: 'Complaint raised',
  COMPLAINT_ASSIGNED: 'Complaint assigned',
  COMPLAINT_RESOLVED: 'Complaint resolved',
  COMPLAINT_CLOSED: 'Complaint closed',
  TASK_CREATED: 'Task created',
  TASK_COMPLETED: 'Task completed',
  EXPENSE_CREATED: 'Expense added',
  STOCK_LOW: 'Stock running low',
  STOCK_PURCHASED: 'Stock purchased',
  PROPERTY_CREATED: 'PG created',
  PROPERTY_UPDATED: 'PG updated',
  SUBSCRIPTION_CREATED: 'Subscription created',
  SUBSCRIPTION_PAYMENT_COMPLETED: 'Subscription charged',
  SUBSCRIPTION_PAYMENT_FAILED: 'Subscription payment failed',
  ANNOUNCEMENT_SENT: 'Announcement sent',
  STAFF_CREATED: 'Staff added',
  VISITOR_LOGGED: 'Visitor logged',
  LEAD_CREATED: 'New enquiry',
  LEAD_UPDATED: 'Enquiry updated',
  AUTH_LOGIN: 'Signed in',
  AUTH_PASSWORD_CHANGED: 'Password changed',
  PAYMENT_REVERSED: 'Payment reversed',
  PAYMENT_EDITED: 'Payment edited',
  RENT_REVISED: 'Rent revised',
  CHARGE_ADDED: 'Charge added',
  CHARGE_VOIDED: 'Charge voided',
  INVOICE_ADJUSTED: 'Invoice adjusted',
  INVOICE_WAIVED: 'Invoice waived',
  EXPENSE_UPDATED: 'Expense updated',
  EXPENSE_VOIDED: 'Expense voided',
  ROLE_CHANGED: 'Role changed',
  PERMISSION_CHANGED: 'Permissions changed',
  SUBSCRIPTION_CHANGED: 'Subscription changed',
  SUBSCRIPTION_CANCELLED: 'Subscription cancelled',
  IMPORT_COMPLETED: 'Import completed',
  SUPPORT_TICKET: 'Support ticket',
  ADMIN_ACTION: 'Admin action',
  AUTH_LOGIN_FAILED: 'Failed sign-in',
  SETTLEMENT_ADJUSTED: 'Settlement adjusted',
  MAINTENANCE_UPDATED: 'Maintenance updated',
  ASSET_UPDATED: 'Asset updated',
  ELECTRICITY_METER_UPDATED: 'Electricity meter updated',
  ELECTRICITY_RATE_SET: 'Electricity rate set',
  METER_READING_RECORDED: 'Meter reading recorded',
  ELECTRICITY_BILL_FINALIZED: 'Electricity bill finalized',
  ELECTRICITY_BILL_VOIDED: 'Electricity bill voided',
  AUTOPAY_MANDATE_UPDATED: 'AutoPay updated',
  AUTOPAY_CHARGE: 'AutoPay debit',
  SETTINGS_UPDATED: 'Settings updated',
}

export type EventTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral'

export function eventTone(event: EventType): EventTone {
  if (
    event === 'PAYMENT_COMPLETED' ||
    event === 'COMPLAINT_RESOLVED' ||
    event === 'RESIDENT_CHECKED_IN' ||
    event === 'SUBSCRIPTION_PAYMENT_COMPLETED' ||
    event === 'TASK_COMPLETED'
  )
    return 'success'
  if (event === 'RENT_DUE' || event === 'STOCK_LOW' || event === 'COMPLAINT_CREATED')
    return 'warning'
  if (
    event === 'RENT_OVERDUE' ||
    event === 'PAYMENT_FAILED' ||
    event === 'SUBSCRIPTION_PAYMENT_FAILED'
  )
    return 'danger'
  if (event === 'CHECKOUT_COMPLETED' || event === 'REFUND_ISSUED') return 'info'
  return 'neutral'
}

/** Groups used by the activity page filter. */
export const EVENT_GROUPS: { label: string; events: EventType[] }[] = [
  {
    label: 'Residents',
    events: ['RESIDENT_CREATED', 'RESIDENT_CHECKED_IN', 'RESIDENT_UPDATED', 'CHECKOUT_COMPLETED'],
  },
  { label: 'Rooms & beds', events: ['BED_ALLOCATED', 'BED_RELEASED', 'ROOM_CHANGED'] },
  {
    label: 'Money',
    events: [
      'RENT_GENERATED',
      'RENT_DUE',
      'RENT_OVERDUE',
      'PAYMENT_COMPLETED',
      'PAYMENT_FAILED',
      'REFUND_ISSUED',
      'EXPENSE_CREATED',
      'ELECTRICITY_RATE_SET',
      'ELECTRICITY_BILL_FINALIZED',
      'ELECTRICITY_BILL_VOIDED',
      'AUTOPAY_MANDATE_UPDATED',
      'AUTOPAY_CHARGE',
    ],
  },
  {
    label: 'Operations',
    events: [
      'COMPLAINT_CREATED',
      'COMPLAINT_ASSIGNED',
      'COMPLAINT_RESOLVED',
      'COMPLAINT_CLOSED',
      'TASK_CREATED',
      'TASK_COMPLETED',
      'STOCK_LOW',
      'STOCK_PURCHASED',
      'VISITOR_LOGGED',
      'METER_READING_RECORDED',
      'ELECTRICITY_METER_UPDATED',
    ],
  },
  {
    label: 'Account',
    events: [
      'PROPERTY_CREATED',
      'PROPERTY_UPDATED',
      'SUBSCRIPTION_CREATED',
      'SUBSCRIPTION_PAYMENT_COMPLETED',
      'SUBSCRIPTION_PAYMENT_FAILED',
      'STAFF_CREATED',
      'SETTINGS_UPDATED',
      'AUTH_LOGIN',
      'AUTH_PASSWORD_CHANGED',
    ],
  },
]
