'use client'

import * as React from 'react'
import { MailCheck, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/input'
import { api, ApiError } from '@/lib/client'

export function ForgotPasswordForm() {
  const [identifier, setIdentifier] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [sent, setSent] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (identifier.trim().length < 3) {
      setError('Enter your email or mobile number')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const result = await api.post<{ message: string }>('/api/auth/forgot-password', {
        identifier: identifier.trim(),
      })
      setSent(result.message)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Please try again in a moment')
    } finally {
      setBusy(false)
    }
  }

  if (sent) {
    return (
      <div className="space-y-4 text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
          <MailCheck className="size-6" />
        </div>
        <p className="text-sm leading-relaxed text-slate-600">{sent}</p>
        <Button variant="ghost" className="w-full" onClick={() => setSent(null)}>
          Didn&apos;t get it? Try again
        </Button>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <Field label="Email or mobile number" required error={error ?? undefined} htmlFor="identifier">
        <Input
          id="identifier"
          autoComplete="username"
          placeholder="you@example.com or 98765 43210"
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          aria-invalid={Boolean(error)}
        />
      </Field>
      <Button type="submit" variant="primary" className="w-full" loading={busy}>
        {!busy && <Send className="size-4" />}
        Send reset link
      </Button>
    </form>
  )
}
