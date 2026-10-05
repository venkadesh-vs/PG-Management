'use client'

import * as React from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Global toast system. Every meaningful action in the product reports back
 * through this — success, error, warning or information — with an icon, a
 * title, an optional description, an auto-dismiss progress bar and a close
 * button.
 */

export type ToastTone = 'success' | 'error' | 'warning' | 'info'

export type ToastOptions = {
  title: string
  description?: string
  tone?: ToastTone
  /** Milliseconds before auto-dismiss. 0 keeps it until dismissed. */
  duration?: number
  action?: { label: string; onClick: () => void }
}

type ToastItem = ToastOptions & { id: string; tone: ToastTone; duration: number }

type ToastContextValue = {
  toast: (options: ToastOptions) => string
  success: (title: string, description?: string) => string
  error: (title: string, description?: string) => string
  warning: (title: string, description?: string) => string
  info: (title: string, description?: string) => string
  dismiss: (id: string) => void
}

const ToastContext = React.createContext<ToastContextValue | null>(null)

export function useToast(): ToastContextValue {
  const ctx = React.useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>')
  return ctx
}

const TONE_STYLES: Record<
  ToastTone,
  { icon: React.ElementType; ring: string; iconBg: string; iconColor: string; bar: string }
> = {
  success: {
    icon: CheckCircle2,
    ring: 'ring-emerald-500/15',
    iconBg: 'bg-emerald-50',
    iconColor: 'text-emerald-600',
    bar: 'bg-emerald-500',
  },
  error: {
    icon: XCircle,
    ring: 'ring-red-500/15',
    iconBg: 'bg-red-50',
    iconColor: 'text-red-600',
    bar: 'bg-red-500',
  },
  warning: {
    icon: AlertTriangle,
    ring: 'ring-amber-500/15',
    iconBg: 'bg-amber-50',
    iconColor: 'text-amber-600',
    bar: 'bg-amber-500',
  },
  info: {
    icon: Info,
    ring: 'ring-blue-500/15',
    iconBg: 'bg-blue-50',
    iconColor: 'text-blue-600',
    bar: 'bg-blue-500',
  },
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<ToastItem[]>([])

  const dismiss = React.useCallback((id: string) => {
    setToasts((current) => current.filter((t) => t.id !== id))
  }, [])

  const toast = React.useCallback((options: ToastOptions) => {
    const id = Math.random().toString(36).slice(2)
    const item: ToastItem = {
      ...options,
      id,
      tone: options.tone ?? 'info',
      duration: options.duration ?? 4500,
    }
    // Keep at most four on screen; the oldest rolls off.
    setToasts((current) => [...current.slice(-3), item])
    return id
  }, [])

  const value = React.useMemo<ToastContextValue>(
    () => ({
      toast,
      dismiss,
      success: (title, description) => toast({ title, description, tone: 'success' }),
      error: (title, description) => toast({ title, description, tone: 'error' }),
      warning: (title, description) => toast({ title, description, tone: 'warning' }),
      info: (title, description) => toast({ title, description, tone: 'info' }),
    }),
    [toast, dismiss],
  )

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-[100] flex flex-col items-center gap-2 p-4 sm:inset-x-auto sm:right-0 sm:top-0 sm:bottom-auto sm:items-end sm:p-6"
      >
        <AnimatePresence initial={false}>
          {toasts.map((item) => (
            <ToastCard key={item.id} item={item} onDismiss={() => dismiss(item.id)} />
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  )
}

function ToastCard({ item, onDismiss }: { item: ToastItem; onDismiss: () => void }) {
  const tone = TONE_STYLES[item.tone]
  const Icon = tone.icon
  const [paused, setPaused] = React.useState(false)

  React.useEffect(() => {
    if (!item.duration || paused) return
    const timer = setTimeout(onDismiss, item.duration)
    return () => clearTimeout(timer)
  }, [item.duration, paused, onDismiss])

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 16, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, x: 24, scale: 0.96, transition: { duration: 0.18 } }}
      transition={{ type: 'spring', stiffness: 380, damping: 30 }}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      className={cn(
        'pointer-events-auto relative w-full max-w-sm overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-float ring-4',
        tone.ring,
      )}
      role="status"
    >
      <div className="flex gap-3 p-4">
        <div className={cn('mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl', tone.iconBg)}>
          <Icon className={cn('size-[18px]', tone.iconColor)} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-900">{item.title}</p>
          {item.description && (
            <p className="mt-0.5 text-sm leading-relaxed text-slate-500">{item.description}</p>
          )}
          {item.action && (
            <button
              type="button"
              onClick={() => {
                item.action?.onClick()
                onDismiss()
              }}
              className="mt-2 text-sm font-semibold text-blue-600 hover:text-blue-700"
            >
              {item.action.label}
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss notification"
          className="-mr-1 -mt-1 size-7 shrink-0 rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
        >
          <X className="mx-auto size-4" />
        </button>
      </div>
      {item.duration > 0 && (
        <motion.div
          className={cn('h-0.5 origin-left', tone.bar)}
          initial={{ scaleX: 1 }}
          animate={{ scaleX: paused ? 1 : 0 }}
          transition={{ duration: item.duration / 1000, ease: 'linear' }}
        />
      )}
    </motion.div>
  )
}
