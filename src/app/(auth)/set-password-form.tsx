'use client'

import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { KeyRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { api, ApiError } from '@/lib/client'

const schema = z
  .object({
    password: z
      .string()
      .min(8, 'Use at least 8 characters')
      .regex(/[a-zA-Z]/, 'Include a letter')
      .regex(/\d/, 'Include a number'),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'Passwords do not match' })

type FormValues = z.infer<typeof schema>

/** Choose-a-password form shared by /invite and /reset-password. */
export function SetPasswordForm({
  endpoint,
  token,
  submitLabel,
  successTitle,
}: {
  endpoint: '/api/auth/invite' | '/api/auth/reset-password'
  token: string
  submitLabel: string
  successTitle: string
}) {
  const router = useRouter()
  const toast = useToast()
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { password: '', confirm: '' },
  })
  const errors = form.formState.errors

  async function onSubmit(values: FormValues) {
    try {
      const result = await api.post<{ redirectTo: string; user: { name: string } }>(endpoint, {
        token,
        password: values.password,
      })
      toast.success(successTitle, `Welcome, ${result.user.name.split(' ')[0]}.`)
      router.push(result.redirectTo)
      router.refresh()
    } catch (error) {
      const message = error instanceof ApiError ? error.message : 'Could not set your password'
      form.setError('password', { message: message.replace(/^password:\s*/, '') })
    }
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <Field
        label="New password"
        required
        error={errors.password?.message}
        hint="At least 8 characters, letters and numbers"
        htmlFor="password"
      >
        <Input id="password" type="password" autoComplete="new-password" {...form.register('password')} />
      </Field>
      <Field label="Confirm password" required error={errors.confirm?.message} htmlFor="confirm">
        <Input id="confirm" type="password" autoComplete="new-password" {...form.register('confirm')} />
      </Field>
      <Button type="submit" variant="primary" className="w-full" loading={form.formState.isSubmitting}>
        {!form.formState.isSubmitting && <KeyRound className="size-4" />}
        {submitLabel}
      </Button>
    </form>
  )
}
