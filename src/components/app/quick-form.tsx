'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Plus } from 'lucide-react'
import { api, ApiError } from '@/lib/client'
import { cn } from '@/lib/utils'
import { useToast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, Input, Select, Textarea } from '@/components/ui/input'
import { Switch } from '@/components/ui/primitives'

/**
 * A declarative create/edit dialog for the simpler modules (expense, visitor,
 * asset, staff, grocery item…). Each module still owns its own field list and
 * copy — this only removes the repeated dialog/submit/toast plumbing.
 */

export type QuickField =
  | {
      kind: 'text' | 'number' | 'date' | 'tel' | 'email'
      name: string
      label: string
      required?: boolean
      hint?: string
      placeholder?: string
      defaultValue?: string | number
      /** Half-width on desktop. */
      half?: boolean
    }
  | {
      kind: 'select'
      name: string
      label: string
      required?: boolean
      hint?: string
      options: { value: string; label: string }[]
      defaultValue?: string
      half?: boolean
    }
  | {
      kind: 'textarea'
      name: string
      label: string
      required?: boolean
      hint?: string
      placeholder?: string
      rows?: number
      defaultValue?: string
    }
  | {
      kind: 'switch'
      name: string
      label: string
      hint?: string
      defaultValue?: boolean
    }

export type QuickFormProps = {
  /** Button label; omit to render the dialog only (controlled by `open`). */
  trigger?: string
  triggerVariant?: 'primary' | 'outline' | 'default' | 'ghost'
  title: string
  description?: string
  fields: QuickField[]
  /** Submit target. */
  endpoint: string
  /** HTTP method; defaults to POST. Use PATCH for edit dialogs. */
  method?: 'POST' | 'PATCH' | 'PUT'
  /** Merged into the payload — the entity discriminator and any fixed ids. */
  payload?: Record<string, unknown>
  submitLabel?: string
  successTitle: string
  /** Called with the API response, for extra toasts or navigation. */
  onSuccess?: (result: { message?: string } & Record<string, unknown>) => void
  open?: boolean
  onOpenChange?: (open: boolean) => void
  size?: 'sm' | 'default' | 'lg'
}

function initialValues(fields: QuickField[]) {
  const values: Record<string, string | boolean> = {}
  for (const field of fields) {
    values[field.name] =
      field.kind === 'switch' ? (field.defaultValue ?? false) : String(field.defaultValue ?? '')
  }
  return values
}

export function QuickForm({
  trigger,
  triggerVariant = 'primary',
  title,
  description,
  fields,
  endpoint,
  method = 'POST',
  payload,
  submitLabel,
  successTitle,
  onSuccess,
  open: controlledOpen,
  onOpenChange,
  size = 'default',
}: QuickFormProps) {
  const router = useRouter()
  const toast = useToast()
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false)
  const open = controlledOpen ?? uncontrolledOpen
  const setOpen = onOpenChange ?? setUncontrolledOpen

  const [values, setValues] = React.useState(() => initialValues(fields))
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    if (open) {
      setValues(initialValues(fields))
      setErrors({})
    }
    // Re-seeding on every field identity change would clobber typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  function set(name: string, value: string | boolean) {
    setValues((current) => ({ ...current, [name]: value }))
    setErrors((current) => {
      if (!current[name]) return current
      const next = { ...current }
      delete next[name]
      return next
    })
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()

    const missing: Record<string, string> = {}
    for (const field of fields) {
      if ('required' in field && field.required && !String(values[field.name] ?? '').trim()) {
        missing[field.name] = `${field.label} is required`
      }
    }
    if (Object.keys(missing).length) {
      setErrors(missing)
      toast.error('Check the highlighted fields', 'A few details are still missing.')
      return
    }

    setBusy(true)
    try {
      const send = method === 'PATCH' ? api.patch : method === 'PUT' ? api.put : api.post
      const result = await send<{ message?: string } & Record<string, unknown>>(endpoint, {
        ...payload,
        ...values,
      })
      toast.success(successTitle, result.message)
      setOpen(false)
      onSuccess?.(result)
      router.refresh()
    } catch (error) {
      const message = error instanceof ApiError ? error.message : 'Please try again.'
      toast.error('Something went wrong', message)
      // Surface a field-level error when the API names the field.
      const field = fields.find((f) => message.toLowerCase().startsWith(f.name.toLowerCase()))
      if (field) setErrors({ [field.name]: message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {trigger && (
        <Button variant={triggerVariant} onClick={() => setOpen(true)}>
          <Plus className="size-4" />
          {trigger}
        </Button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size={size}>
          <form onSubmit={submit}>
            <DialogHeader>
              <DialogTitle>{title}</DialogTitle>
              {description && <DialogDescription>{description}</DialogDescription>}
            </DialogHeader>

            <div className="grid gap-4 py-2 sm:grid-cols-2">
              {fields.map((field) => {
                const half = 'half' in field && field.half
                const className = cn(!half && 'sm:col-span-2')
                const error = errors[field.name]

                if (field.kind === 'switch') {
                  return (
                    <label
                      key={field.name}
                      className={cn(
                        'flex cursor-pointer items-center justify-between rounded-xl border border-slate-200 p-3',
                        className,
                      )}
                    >
                      <span>
                        <span className="block text-sm font-medium text-slate-800">
                          {field.label}
                        </span>
                        {field.hint && (
                          <span className="block text-xs text-slate-500">{field.hint}</span>
                        )}
                      </span>
                      <Switch
                        checked={Boolean(values[field.name])}
                        onCheckedChange={(checked) => set(field.name, checked)}
                      />
                    </label>
                  )
                }

                return (
                  <Field
                    key={field.name}
                    className={className}
                    label={field.label}
                    required={'required' in field ? field.required : undefined}
                    hint={field.hint}
                    error={error}
                  >
                    {field.kind === 'select' ? (
                      <Select
                        value={String(values[field.name] ?? '')}
                        onChange={(e) => set(field.name, e.target.value)}
                        aria-invalid={Boolean(error)}
                      >
                        {!field.required && <option value="">Not set</option>}
                        {field.options.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </Select>
                    ) : field.kind === 'textarea' ? (
                      <Textarea
                        rows={field.rows ?? 3}
                        value={String(values[field.name] ?? '')}
                        placeholder={field.placeholder}
                        onChange={(e) => set(field.name, e.target.value)}
                        aria-invalid={Boolean(error)}
                      />
                    ) : (
                      <Input
                        type={field.kind === 'number' ? 'number' : field.kind}
                        inputMode={
                          field.kind === 'number' ? 'numeric' : field.kind === 'tel' ? 'tel' : undefined
                        }
                        value={String(values[field.name] ?? '')}
                        placeholder={field.placeholder}
                        onChange={(e) => set(field.name, e.target.value)}
                        aria-invalid={Boolean(error)}
                      />
                    )}
                  </Field>
                )
              })}
            </div>

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" loading={busy}>
                {submitLabel ?? 'Save'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
