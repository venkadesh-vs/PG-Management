'use client'

import Link from 'next/link'
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
    currentPassword: z.string().min(1, 'Enter your current password'),
    newPassword: z
      .string()
      .min(8, 'Use at least 8 characters')
      .regex(/[a-zA-Z]/, 'Include a letter')
      .regex(/\d/, 'Include a number'),
    confirm: z.string(),
  })
  .refine((v) => v.newPassword === v.confirm, { path: ['confirm'], message: 'Passwords do not match' })

type FormValues = z.infer<typeof schema>

export function ChangePasswordForm({ cancelHref }: { cancelHref: string | null }) {
  const router = useRouter()
  const toast = useToast()
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { currentPassword: '', newPassword: '', confirm: '' },
  })
  const errors = form.formState.errors

  async function onSubmit(values: FormValues) {
    try {
      const result = await api.post<{ redirectTo: string }>('/api/auth/password', {
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      })
      toast.success('Password updated', 'Use your new password next time you sign in.')
      router.push(result.redirectTo)
      router.refresh()
    } catch (error) {
      const message = error instanceof ApiError ? error.message : 'Could not update your password'
      form.setError(/current/i.test(message) ? 'currentPassword' : 'newPassword', { message })
    }
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <Field label="Current password" required error={errors.currentPassword?.message} htmlFor="currentPassword">
        <Input id="currentPassword" type="password" autoComplete="current-password" {...form.register('currentPassword')} />
      </Field>
      <Field label="New password" required error={errors.newPassword?.message} hint="At least 8 characters, letters and numbers" htmlFor="newPassword">
        <Input id="newPassword" type="password" autoComplete="new-password" {...form.register('newPassword')} />
      </Field>
      <Field label="Confirm new password" required error={errors.confirm?.message} htmlFor="confirm">
        <Input id="confirm" type="password" autoComplete="new-password" {...form.register('confirm')} />
      </Field>
      <Button type="submit" variant="primary" className="w-full" loading={form.formState.isSubmitting}>
        {!form.formState.isSubmitting && <KeyRound className="size-4" />}
        Update password
      </Button>
      {cancelHref && (
        <Button variant="ghost" className="w-full" asChild>
          <Link href={cancelHref}>Cancel</Link>
        </Button>
      )}
    </form>
  )
}
