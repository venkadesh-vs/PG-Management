'use client'

import { motion } from 'framer-motion'
import type { ActivityLog, EventType } from '@prisma/client'
import {
  ArrowRightLeft,
  Bed,
  Bell,
  Building2,
  CheckCircle2,
  CreditCard,
  DoorOpen,
  FileText,
  LogIn,
  type LucideIcon,
  Receipt,
  Settings,
  ShoppingCart,
  Sparkles,
  UserPlus,
  UserRound,
  Users,
  Wrench,
  XCircle,
} from 'lucide-react'
import { cn, relativeTime } from '@/lib/utils'
import { EVENT_LABEL, eventTone } from '@/lib/events-meta'
import { EmptyState } from '@/components/ui/feedback'

const EVENT_ICON: Partial<Record<EventType, LucideIcon>> = {
  RESIDENT_CREATED: UserPlus,
  RESIDENT_CHECKED_IN: UserPlus,
  RESIDENT_UPDATED: UserRound,
  BED_ALLOCATED: Bed,
  BED_RELEASED: DoorOpen,
  ROOM_CHANGED: ArrowRightLeft,
  RENT_GENERATED: FileText,
  RENT_DUE: Bell,
  RENT_OVERDUE: XCircle,
  PAYMENT_COMPLETED: CreditCard,
  PAYMENT_FAILED: XCircle,
  REFUND_ISSUED: Receipt,
  CHECKOUT_COMPLETED: DoorOpen,
  COMPLAINT_CREATED: Wrench,
  COMPLAINT_ASSIGNED: Users,
  COMPLAINT_RESOLVED: CheckCircle2,
  COMPLAINT_CLOSED: CheckCircle2,
  TASK_CREATED: Wrench,
  TASK_COMPLETED: CheckCircle2,
  EXPENSE_CREATED: Receipt,
  STOCK_LOW: ShoppingCart,
  STOCK_PURCHASED: ShoppingCart,
  PROPERTY_CREATED: Building2,
  PROPERTY_UPDATED: Building2,
  SUBSCRIPTION_CREATED: Sparkles,
  SUBSCRIPTION_PAYMENT_COMPLETED: Sparkles,
  SUBSCRIPTION_PAYMENT_FAILED: XCircle,
  ANNOUNCEMENT_SENT: Bell,
  STAFF_CREATED: Users,
  VISITOR_LOGGED: UserPlus,
  LEAD_CREATED: Users,
  LEAD_UPDATED: Users,
  AUTH_LOGIN: LogIn,
  SETTINGS_UPDATED: Settings,
}

const TONE_CLASS = {
  success: 'bg-emerald-50 text-emerald-600 ring-emerald-100',
  warning: 'bg-amber-50 text-amber-600 ring-amber-100',
  danger: 'bg-red-50 text-red-600 ring-red-100',
  info: 'bg-sky-50 text-sky-600 ring-sky-100',
  neutral: 'bg-slate-100 text-slate-500 ring-slate-100',
}

type TimelineItem = Pick<
  ActivityLog,
  'id' | 'event' | 'summary' | 'actorName' | 'createdAt' | 'entityType' | 'entityId'
>

/**
 * The audit trail, rendered as a timeline. Same component on the owner
 * dashboard (compact) and the full Activity page.
 */
export function ActivityTimeline({
  items,
  compact,
  className,
}: {
  items: TimelineItem[]
  compact?: boolean
  className?: string
}) {
  if (!items.length) {
    return (
      <EmptyState
        compact
        icon={Bell}
        title="No activity yet"
        description="Check-ins, payments and complaints will show up here as they happen."
      />
    )
  }

  return (
    <ol className={cn('relative space-y-0', className)}>
      {items.map((item, index) => {
        const Icon = EVENT_ICON[item.event] ?? Bell
        const tone = eventTone(item.event)
        const last = index === items.length - 1
        return (
          <motion.li
            key={item.id}
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: Math.min(index * 0.035, 0.3), duration: 0.3 }}
            className="relative flex gap-3 pb-4 last:pb-0"
          >
            {!last && (
              <span className="absolute left-[15px] top-9 bottom-0 w-px bg-slate-100" aria-hidden />
            )}
            <span
              className={cn(
                'relative z-10 flex size-8 shrink-0 items-center justify-center rounded-xl ring-4 ring-white',
                TONE_CLASS[tone],
              )}
            >
              <Icon className="size-4" />
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <p className="text-sm font-medium text-slate-800">{EVENT_LABEL[item.event]}</p>
                <time className="text-xs text-slate-400">{relativeTime(item.createdAt)}</time>
              </div>
              <p className={cn('text-sm leading-relaxed text-slate-500', compact && 'truncate')}>
                {item.summary}
              </p>
              {!compact && item.actorName && (
                <p className="mt-0.5 text-xs text-slate-400">by {item.actorName}</p>
              )}
            </div>
          </motion.li>
        )
      })}
    </ol>
  )
}
