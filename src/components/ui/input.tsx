'use client'

import * as React from 'react'
import * as LabelPrimitive from '@radix-ui/react-label'
import { AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

/** Shared look for every text control: calm at rest, a soft brand glow on focus. */
const CONTROL = [
  'w-full rounded-lg border border-slate-200 bg-white text-[15px] text-slate-900 shadow-xs sm:text-sm',
  'transition-[border-color,box-shadow,background-color] duration-150',
  'placeholder:text-slate-400 hover:border-slate-300',
  'focus-visible:outline-none focus-visible:border-blue-500 focus-visible:ring-[3px] focus-visible:ring-blue-500/15',
  'disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500',
  'aria-[invalid=true]:border-red-400 aria-[invalid=true]:bg-red-50/30 aria-[invalid=true]:ring-4 aria-[invalid=true]:ring-red-500/10 aria-[invalid=true]:animate-shake',
].join(' ')

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      ref={ref}
      className={cn(
        CONTROL,
        'flex h-10 px-3 py-2',
        'file:border-0 file:bg-transparent file:text-sm file:font-medium',
        className,
      )}
      {...props}
    />
  ),
)
Input.displayName = 'Input'

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      CONTROL,
      'flex min-h-[96px] px-3.5 py-2.5 leading-relaxed',
      className,
    )}
    {...props}
  />
))
Textarea.displayName = 'Textarea'

const Label = React.forwardRef<
  React.ElementRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root> & { required?: boolean }
>(({ className, required, children, ...props }, ref) => (
  <LabelPrimitive.Root
    ref={ref}
    className={cn(
      'text-[13px] font-semibold leading-none text-slate-700 peer-disabled:cursor-not-allowed peer-disabled:opacity-70',
      className,
    )}
    {...props}
  >
    {children}
    {required && <span className="ml-0.5 text-red-500">*</span>}
  </LabelPrimitive.Root>
))
Label.displayName = 'Label'

/** Native select styled to match Input — used where a full combobox is overkill. */
const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, children, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      CONTROL,
      'flex h-10 appearance-none px-3 py-2 pr-9',
      'bg-[url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 fill=%27none%27 viewBox=%270 0 24 24%27 stroke-width=%272%27 stroke=%27%2394a3b8%27%3E%3Cpath stroke-linecap=%27round%27 stroke-linejoin=%27round%27 d=%27m19.5 8.25-7.5 7.5-7.5-7.5%27/%3E%3C/svg%3E")] bg-[length:16px] bg-[right_0.65rem_center] bg-no-repeat',
      className,
    )}
    {...props}
  >
    {children}
  </select>
))
Select.displayName = 'Select'

/** Label + control + error message, the standard field wrapper. */
export function Field({
  label,
  required,
  error,
  hint,
  htmlFor,
  className,
  children,
}: {
  label?: string
  required?: boolean
  error?: string
  hint?: string
  htmlFor?: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={cn('space-y-2', className)}>
      {label && (
        <Label htmlFor={htmlFor} required={required}>
          {label}
        </Label>
      )}
      {children}
      {error ? (
        <p role="alert" className="flex animate-fade-up items-start gap-1.5 text-xs font-medium text-red-600">
          <AlertCircle className="mt-px size-3.5 shrink-0" />
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-slate-500">{hint}</p>
      ) : null}
    </div>
  )
}

export { Input, Textarea, Label, Select }
