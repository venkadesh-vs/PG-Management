'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Eye, EyeOff, Rocket } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/primitives'
import { useToast } from '@/components/ui/toast'
import { api, ApiError } from '@/lib/client'
import { phoneSchema } from '@/lib/validation'

const schema = z.object({
  ownerName: z.string().trim().min(2, 'Enter your name'),
  orgName: z.string().trim().min(2, 'Enter your PG or business name'),
  email: z.string().trim().min(1, 'Email is required').email('Enter a valid email address'),
  phone: phoneSchema,
  city: z.string().trim().min(2, 'Enter your city'),
  password: z
    .string()
    .min(8, 'Use at least 8 characters')
    .regex(/[a-zA-Z]/, 'Include a letter')
    .regex(/\d/, 'Include a number'),
  acceptTerms: z.boolean().refine((v) => v, 'Please accept the terms to continue'),
})

type FormValues = z.infer<typeof schema>
const FIELDS = ['ownerName', 'orgName', 'email', 'phone', 'city', 'password'] as const

export function SignupForm() {
  const router = useRouter()
  const toast = useToast()
  const [showPassword, setShowPassword] = React.useState(false)
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      ownerName: '',
      orgName: '',
      email: '',
      phone: '',
      city: '',
      password: '',
      acceptTerms: false,
    },
  })
  const errors = form.formState.errors
  const accepted = form.watch('acceptTerms')

  async function onSubmit(values: FormValues) {
    try {
      const result = await api.post<{ redirectTo: string }>('/api/auth/signup', values)
      toast.success('Your account is ready', 'Next: add your first PG.')
      router.push(result.redirectTo)
      router.refresh()
    } catch (error) {
      const message = error instanceof ApiError ? error.message : 'Could not create your account'
      // "password: Use at least…" → put it on the field it names.
      const field = FIELDS.find((f) => message.startsWith(`${f}:`))
      if (field) form.setError(field, { message: message.slice(field.length + 1).trim() })
      else if (/email/i.test(message)) form.setError('email', { message })
      else toast.error('Sign-up failed', message)
    }
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <Field label="Your name" required error={errors.ownerName?.message} htmlFor="ownerName">
        <Input id="ownerName" autoComplete="name" placeholder="Murugan S" {...form.register('ownerName')} />
      </Field>
      <Field
        label="PG / business name"
        required
        error={errors.orgName?.message}
        hint="Shown to your residents on receipts and messages"
        htmlFor="orgName"
      >
        <Input id="orgName" autoComplete="organization" placeholder="Sri Balaji PG" {...form.register('orgName')} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Email" required error={errors.email?.message} htmlFor="email">
          <Input id="email" type="email" autoComplete="email" placeholder="you@example.com" {...form.register('email')} />
        </Field>
        <Field label="Mobile number" required error={errors.phone?.message} htmlFor="phone">
          <Input id="phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="98765 43210" {...form.register('phone')} />
        </Field>
      </div>
      <Field label="City" required error={errors.city?.message} htmlFor="city">
        <Input id="city" autoComplete="address-level2" placeholder="Chennai" {...form.register('city')} />
      </Field>
      <Field
        label="Password"
        required
        error={errors.password?.message}
        hint="At least 8 characters, letters and numbers"
        htmlFor="password"
      >
        <div className="relative">
          <Input
            id="password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="new-password"
            className="pr-11"
            {...form.register('password')}
          />
          <button
            type="button"
            onClick={() => setShowPassword((s) => !s)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            className="absolute right-1 top-1 flex size-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
      </Field>

      <div className="space-y-1.5">
        <label className="flex cursor-pointer items-start gap-3 text-sm text-slate-600">
          <Checkbox
            checked={accepted}
            onCheckedChange={(checked) =>
              form.setValue('acceptTerms', checked === true, { shouldValidate: true })
            }
            className="mt-0.5"
            aria-invalid={Boolean(errors.acceptTerms)}
          />
          <span>
            I agree to the{' '}
            <Link href="/terms" target="_blank" className="font-medium text-blue-600 hover:underline">
              Terms
            </Link>{' '}
            and{' '}
            <Link href="/privacy" target="_blank" className="font-medium text-blue-600 hover:underline">
              Privacy Policy
            </Link>
            .
          </span>
        </label>
        {errors.acceptTerms && (
          <p className="text-xs font-medium text-red-600">{errors.acceptTerms.message}</p>
        )}
      </div>

      <Button type="submit" variant="primary" size="lg" className="w-full" loading={form.formState.isSubmitting}>
        {!form.formState.isSubmitting && <Rocket className="size-4" />}
        Create my account
      </Button>
    </form>
  )
}
