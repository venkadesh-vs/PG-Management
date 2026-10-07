import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium transition-colors whitespace-nowrap',
  {
    variants: {
      variant: {
        default: 'border-slate-200/80 bg-slate-50 text-slate-700',
        outline: 'border-slate-200 bg-white text-slate-600',
        success: 'border-emerald-200/70 bg-emerald-50 text-emerald-700',
        warning: 'border-amber-200/70 bg-amber-50 text-amber-800',
        danger: 'border-rose-200/70 bg-rose-50 text-rose-700',
        info: 'border-sky-200/70 bg-sky-50 text-sky-700',
        blue: 'border-blue-200/70 bg-blue-50 text-blue-700',
        pink: 'border-pink-200 bg-pink-50 text-pink-700',
        // Folded into the brand accent so there is one purple, not two.
        violet: 'border-blue-200/70 bg-blue-50 text-blue-700',
      },
      size: {
        default: 'px-2 py-0.5 text-xs',
        sm: 'px-2 py-px text-[11px]',
        lg: 'px-3 py-1 text-sm',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  /** Renders a small leading status dot. */
  dot?: string
}

function Badge({ className, variant, size, dot, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant, size }), className)} {...props}>
      {dot && <span className={cn('size-1.5 rounded-full', dot)} />}
      {children}
    </span>
  )
}

/** Renders a status chip from the token strings in lib/theme. */
export function StatusChip({
  label,
  chip,
  className,
  dot,
}: {
  label: string
  chip: string
  className?: string
  dot?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border px-2 py-0.5 text-xs font-medium',
        chip,
        className,
      )}
    >
      {dot && <span className={cn('size-1.5 rounded-full', dot)} />}
      {label}
    </span>
  )
}

export { Badge, badgeVariants }
