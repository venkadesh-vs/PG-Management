'use client'

import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  [
    'group/btn relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-semibold',
    'transition-[transform,box-shadow,background-color,border-color,color] duration-200 ease-out',
    'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-500/25',
    'disabled:pointer-events-none disabled:opacity-55 active:scale-[0.97]',
    '[&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:transition-transform',
  ].join(' '),
  {
    variants: {
      variant: {
        default:
          'bg-slate-900 text-white shadow-[0_1px_0_0_rgb(255_255_255/0.1)_inset,0_6px_16px_-8px_rgb(13_12_11/0.6)] hover:bg-slate-800 hover:-translate-y-px',
        primary:
          'shine bg-gradient-to-b from-blue-500 to-blue-600 text-white shadow-brand hover:from-blue-500 hover:to-blue-700 hover:-translate-y-px hover:shadow-[0_1px_0_0_rgb(255_255_255/0.25)_inset,0_10px_22px_-8px_rgb(82_72_224/0.6)]',
        pink:
          'shine bg-gradient-to-b from-pink-500 to-pink-600 text-white shadow-[0_1px_0_0_rgb(255_255_255/0.25)_inset,0_6px_16px_-6px_rgb(219_39_119/0.5)] hover:to-pink-700 hover:-translate-y-px',
        destructive:
          'bg-gradient-to-b from-red-500 to-red-600 text-white shadow-[0_1px_0_0_rgb(255_255_255/0.2)_inset,0_6px_16px_-8px_rgb(220_38_38/0.55)] hover:to-red-700 hover:-translate-y-px',
        outline:
          'border border-slate-200 bg-white text-slate-700 shadow-[0_1px_2px_0_rgb(27_25_24/0.05)] hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900',
        secondary: 'bg-slate-100 text-slate-800 hover:bg-slate-200/80',
        ghost: 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
        link: 'text-blue-600 underline-offset-4 hover:underline',
        success:
          'shine bg-gradient-to-b from-emerald-500 to-emerald-600 text-white shadow-[0_1px_0_0_rgb(255_255_255/0.22)_inset,0_6px_16px_-8px_rgb(5_150_105/0.55)] hover:to-emerald-700 hover:-translate-y-px',
        accent:
          'shine bg-gradient-to-b from-marigold-400 to-marigold-500 text-slate-950 shadow-[0_1px_0_0_rgb(255_255_255/0.35)_inset,0_6px_16px_-8px_rgb(245_133_11/0.6)] hover:to-marigold-600 hover:-translate-y-px',
      },
      size: {
        default: 'h-10 px-4',
        sm: 'h-8 rounded-lg px-3 text-xs',
        lg: 'h-12 rounded-xl px-6 text-[15px]',
        xl: 'h-14 rounded-2xl px-8 text-base',
        icon: 'h-10 w-10',
        'icon-sm': 'h-8 w-8 rounded-lg',
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
