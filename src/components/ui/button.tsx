'use client'

import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  [
    'group/btn relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium',
    'transition-[box-shadow,background-color,border-color,color] duration-150 ease-out',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 focus-visible:ring-offset-1',
    'disabled:pointer-events-none disabled:opacity-55',
    '[&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:transition-transform',
  ].join(' '),
  {
    variants: {
      variant: {
        default: 'bg-slate-900 text-white shadow-xs hover:bg-slate-800',
        primary:
          'bg-blue-600 text-white shadow-[0_1px_0_0_rgb(255_255_255/0.12)_inset,0_1px_2px_0_rgb(27_25_24/0.12)] hover:bg-blue-700',
        pink: 'bg-pink-600 text-white shadow-xs hover:bg-pink-700',
        destructive: 'bg-rose-600 text-white shadow-xs hover:bg-rose-700',
        outline:
          'border border-slate-200 bg-white text-slate-700 shadow-xs hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900',
        secondary: 'bg-slate-100 text-slate-800 hover:bg-slate-200/80',
        ghost: 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
        link: 'text-blue-600 underline-offset-4 hover:underline',
        success: 'bg-emerald-600 text-white shadow-xs hover:bg-emerald-700',
        accent: 'bg-marigold-400 text-slate-950 shadow-xs hover:bg-marigold-500',
      },
      size: {
        default: 'h-10 px-4',
        sm: 'h-8 px-3 text-xs',
        lg: 'h-11 px-5 text-[15px]',
        xl: 'h-12 px-6 text-base',
        icon: 'h-10 w-10',
        'icon-sm': 'h-8 w-8',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
  loading?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading, children, disabled, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={disabled || loading}
        {...props}
      >
        {loading && !asChild ? (
          <>
            <Loader2 className="animate-spin" />
            {children}
          </>
        ) : (
          children
        )}
      </Comp>
    )
  },
)
Button.displayName = 'Button'

export { Button, buttonVariants }
