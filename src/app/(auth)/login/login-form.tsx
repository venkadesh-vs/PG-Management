'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { motion, useReducedMotion } from 'framer-motion'
import { ArrowRight, Eye, EyeOff, Lock, Mail, ShieldCheck, UserRound, Users, Wrench } from 'lucide-react'
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
  SUPER_ADMIN: { label: 'Super Admin', icon: ShieldCheck, tone: 'text-slate-600 bg-slate-100' },
  OWNER: { label: 'PG Owner', icon: Users, tone: 'text-slate-600 bg-slate-100' },
  MANAGER: { label: 'Manager', icon: Users, tone: 'text-slate-600 bg-slate-100' },
  WORKER: { label: 'Worker', icon: Wrench, tone: 'text-slate-600 bg-slate-100' },
  TENANT: { label: 'Resident', icon: UserRound, tone: 'text-slate-600 bg-slate-100' },
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
  const reduce = useReducedMotion()
  const rise = (delay: number) =>
    reduce ? {} : { initial: { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] as const, delay } }

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
        <motion.div {...rise(0.25)}>
        <Field label="Email address" required error={form.formState.errors.email?.message} htmlFor="email">
          <div className="relative">
            <Mail className="pointer-events-none absolute left-3.5 top-1/2 size-[18px] -translate-y-1/2 text-slate-400" />
            <Input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="you@yourpg.com"
              className="h-12 pl-11"
              aria-invalid={Boolean(form.formState.errors.email)}
              {...form.register('email')}
            />
          </div>
        </Field>
        </motion.div>

        <motion.div {...rise(0.33)}>
        <Field label="Password" required error={form.formState.errors.password?.message} htmlFor="password">
          <div className="relative">
            <Lock className="pointer-events-none absolute left-3.5 top-1/2 size-[18px] -translate-y-1/2 text-slate-400" />
            <Input
              id="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              placeholder="••••••••"
              className="h-12 pl-11 pr-12"
              aria-invalid={Boolean(form.formState.errors.password)}
              {...form.register('password')}
            />
            <button
              type="button"
              onClick={() => setShowPassword((s) => !s)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              className="absolute right-1.5 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
            >
              {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </Field>
        </motion.div>

        <div className="-mt-1 flex justify-end">
          <Link
            href="/forgot-password"
            className="text-xs font-medium text-blue-600 hover:text-blue-700"
          >
            Forgot password?
          </Link>
        </div>

        <motion.div {...rise(0.41)}>
          <Button
            type="submit"
            variant="primary"
            size="xl"
            className="shine w-full"
            loading={form.formState.isSubmitting}
          >
            Sign in
            {!form.formState.isSubmitting && <ArrowRight className="size-4 transition-transform group-hover/btn:translate-x-0.5" />}
          </Button>
        </motion.div>
      </form>

      {demoUsers.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="rounded-xl border border-slate-200 bg-slate-50/70 p-4"
        >
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-slate-700">
              Demo accounts
            </p>
            <span className="rounded-md bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 ring-1 ring-inset ring-amber-200">
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
