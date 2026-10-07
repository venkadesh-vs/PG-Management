'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { motion } from 'framer-motion'
import { Eye, EyeOff, LogIn, ShieldCheck, UserRound, Users, Wrench } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { api, ApiError } from '@/lib/client'
import { cn } from '@/lib/utils'

const schema = z.object({
  email: z.string().min(1, 'Email is required').email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
})

type FormValues = z.infer<typeof schema>

const ROLE_META: Record<string, { label: string; icon: React.ElementType; tone: string }> = {
  SUPER_ADMIN: { label: 'Super Admin', icon: ShieldCheck, tone: 'text-violet-600 bg-violet-50' },
  OWNER: { label: 'PG Owner', icon: Users, tone: 'text-blue-600 bg-blue-50' },
  MANAGER: { label: 'Manager', icon: Users, tone: 'text-sky-600 bg-sky-50' },
  WORKER: { label: 'Worker', icon: Wrench, tone: 'text-amber-600 bg-amber-50' },
  TENANT: { label: 'Resident', icon: UserRound, tone: 'text-emerald-600 bg-emerald-50' },
}

export function LoginForm({
  demoUsers,
  demoPassword,
}: {
  demoUsers: { email: string; role: string; name: string }[]
  demoPassword: string
}) {
  const router = useRouter()
  const toast = useToast()
  const [showPassword, setShowPassword] = React.useState(false)

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '' },
  })

  async function onSubmit(values: FormValues) {
    try {
      const result = await api.post<{ redirectTo: string; user: { name: string } }>(
        '/api/auth/login',
        values,
      )
      toast.success('Signed in', `Welcome back, ${result.user.name.split(' ')[0]}.`)
      router.push(result.redirectTo)
      router.refresh()
    } catch (error) {
      const message = error instanceof ApiError ? error.message : 'Unable to sign in right now'
      toast.error('Sign in failed', message)
      form.setError('password', { message })
    }
  }

  function fillDemo(email: string) {
    form.setValue('email', email)
    form.setValue('password', demoPassword)
    form.clearErrors()
    toast.info('Demo credentials filled', 'Press Sign in to continue.')
  }

  return (
    <div className="space-y-6">
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <Field label="Email address" required error={form.formState.errors.email?.message} htmlFor="email">
          <Input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="you@yourpg.com"
            aria-invalid={Boolean(form.formState.errors.email)}
            {...form.register('email')}
          />
        </Field>

        <Field label="Password" required error={form.formState.errors.password?.message} htmlFor="password">
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              placeholder="••••••••"
              className="pr-11"
              aria-invalid={Boolean(form.formState.errors.password)}
              {...form.register('password')}
            />
            <button
              type="button"
              onClick={() => setShowPassword((s) => !s)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              className="absolute right-1 top-1 flex size-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
            >
              {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </Field>

        <div className="-mt-1 flex justify-end">
          <Link
            href="/forgot-password"
            className="text-xs font-medium text-blue-600 hover:text-blue-700"
          >
            Forgot password?
          </Link>
        </div>

        <Button
          type="submit"
          variant="primary"
          size="lg"
          className="w-full"
          loading={form.formState.isSubmitting}
        >
          {!form.formState.isSubmitting && <LogIn className="size-4" />}
          Sign in
        </Button>
      </form>

      {demoUsers.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4"
        >
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Demo accounts
            </p>
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
              Demo data
            </span>
          </div>
          <p className="mt-1.5 text-xs text-slate-500">
            Tap a role to fill the form. Every account uses the password{' '}
            <code className="rounded bg-white px-1 py-0.5 font-mono text-[11px] text-slate-700">
              {demoPassword}
            </code>
            .
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {demoUsers.map((user) => {
              const meta = ROLE_META[user.role] ?? ROLE_META.TENANT
              const Icon = meta.icon
              return (
                <button
                  key={user.email}
                  type="button"
                  onClick={() => fillDemo(user.email)}
                  className="group flex items-center gap-2.5 rounded-xl border border-slate-200 bg-white p-2.5 text-left transition-all hover:border-blue-300 hover:shadow-sm"
                >
                  <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-lg', meta.tone)}>
                    <Icon className="size-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-xs font-semibold text-slate-800">{meta.label}</span>
                    <span className="block truncate text-[11px] text-slate-500">{user.email}</span>
                  </span>
                </button>
              )
            })}
          </div>
        </motion.div>
      )}
    </div>
  )
}
