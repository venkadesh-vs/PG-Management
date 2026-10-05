'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, CheckCircle2, Copy, CreditCard, Link2, Unplug } from 'lucide-react'
import { api, ApiError } from '@/lib/client'
import { formatDateTime } from '@/lib/utils'
import { useToast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, Input } from '@/components/ui/input'

type Status = {
  connected: boolean
  keyId: string | null
  mode: 'live' | 'test' | null
  verifiedAt: string | null
  lastError: string | null
}

const EVENTS = ['payment.captured', 'payment.failed']

export function RazorpayConnect({
  status,
  webhookUrl,
  encryptionReady,
}: {
  status: Status
  webhookUrl: string
  encryptionReady: boolean
}) {
  const router = useRouter()
  const toast = useToast()
  const [editing, setEditing] = React.useState(!status.connected)
  const [keyId, setKeyId] = React.useState('')
  const [keySecret, setKeySecret] = React.useState('')
  const [webhookSecret, setWebhookSecret] = React.useState('')
  const [busy, setBusy] = React.useState<'save' | 'remove' | null>(null)

  function copy(text: string, label: string) {
    navigator.clipboard.writeText(text).then(
      () => toast.success(`${label} copied`, text),
      () => toast.error('Could not copy', 'Please copy it manually.'),
    )
  }

  async function save(event: React.FormEvent) {
    event.preventDefault()
    setBusy('save')
    try {
      const result = await api.post<{ message: string }>('/api/integrations/razorpay', {
        keyId: keyId.trim(),
        keySecret: keySecret.trim(),
        webhookSecret: webhookSecret.trim() || undefined,
      })
      toast.success('Razorpay connected', result.message)
      setKeySecret('')
      setWebhookSecret('')
      setEditing(false)
      router.refresh()
    } catch (error) {
      toast.error('Could not connect', error instanceof ApiError ? error.message : 'Please try again.')
    } finally {
      setBusy(null)
    }
  }

  async function disconnect() {
    if (!window.confirm('Disconnect Razorpay? Residents will only see your UPI details until you reconnect.')) {
      return
    }
    setBusy('remove')
    try {
      const result = await api.delete<{ message: string }>('/api/integrations/razorpay')
      toast.info('Razorpay disconnected', result.message)
      setEditing(true)
      router.refresh()
    } catch (error) {
      toast.error('Could not disconnect', error instanceof ApiError ? error.message : 'Please try again.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-4">
      {/* Status */}
      <Card className={status.connected ? 'border-emerald-200' : undefined}>
        <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div
              className={
                status.connected
                  ? 'flex size-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600'
                  : 'flex size-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500'
              }
            >
              {status.connected ? <CheckCircle2 className="size-5" /> : <CreditCard className="size-5" />}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-display text-base font-semibold text-slate-900">
                  {status.connected ? 'Razorpay connected' : 'Razorpay not connected'}
                </p>
                {status.mode && (
                  <Badge variant={status.mode === 'live' ? 'success' : 'warning'} size="sm">
                    {status.mode === 'live' ? 'Live' : 'Test mode'}
                  </Badge>
                )}
              </div>
              {status.connected ? (
                <p className="mt-0.5 break-all text-sm text-slate-500">
                  Key <span className="font-mono">{status.keyId}</span>
                  {status.verifiedAt ? ` · verified ${formatDateTime(status.verifiedAt)}` : ''}
                </p>
              ) : (
                <p className="mt-0.5 text-sm text-slate-500">
                  Residents currently pay you by UPI and you mark payments received by hand.
                </p>
              )}
            </div>
          </div>
          {status.connected && (
            <div className="flex gap-2">
              {!editing && (
                <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                  Update keys
                </Button>
              )}
              <Button variant="ghost" size="sm" loading={busy === 'remove'} onClick={disconnect}>
                <Unplug className="size-3.5" />
                Disconnect
              </Button>
            </div>
          )}
        </CardContent>
        {status.lastError && (
          <div className="flex items-start gap-2 border-t border-amber-200 bg-amber-50/70 px-5 py-3 text-xs text-amber-800">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            <span>Last problem: {status.lastError}</span>
          </div>
        )}
      </Card>

      {!encryptionReady && (
        <Card className="border-amber-200 bg-amber-50/50">
          <CardContent className="p-4 text-sm text-amber-800">
            Online payments cannot be connected on this deployment yet — the platform administrator
            must set <span className="font-mono">DATA_ENCRYPTION_KEY</span> so your keys can be stored
            encrypted.
          </CardContent>
        </Card>
      )}

      {/* Keys form */}
      {editing && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">
              {status.connected ? 'Update Razorpay keys' : 'Connect your Razorpay account'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={save}>
              <ol className="list-decimal space-y-1 pl-4 text-xs leading-relaxed text-slate-500">
                <li>
                  In the Razorpay Dashboard open <strong>Account &amp; Settings → API Keys</strong>{' '}
                  and generate a key (use Live mode to collect real rent).
                </li>
                <li>
                  Under <strong>Webhooks</strong>, add the URL below, choose a secret, and enable the
                  events listed.
                </li>
                <li>Paste the Key ID, Key Secret and that webhook secret here.</li>
              </ol>
              <Field label="Key ID" required>
                <Input
                  value={keyId}
                  onChange={(e) => setKeyId(e.target.value)}
                  placeholder="rzp_live_XXXXXXXXXXXX"
                  autoComplete="off"
                  spellCheck={false}
                  required
                />
              </Field>
              <Field label="Key Secret" required hint="Stored encrypted. Never shown again.">
                <Input
                  type="password"
                  value={keySecret}
                  onChange={(e) => setKeySecret(e.target.value)}
                  autoComplete="new-password"
                  required
                />
              </Field>
              <Field
                label="Webhook secret"
                required={!status.connected}
                hint={status.connected ? 'Leave blank to keep the current one.' : 'The secret you typed when creating the webhook.'}
              >
                <Input
                  type="password"
                  value={webhookSecret}
                  onChange={(e) => setWebhookSecret(e.target.value)}
                  autoComplete="new-password"
                  required={!status.connected}
                />
              </Field>
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                {status.connected && (
                  <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
                    Cancel
                  </Button>
                )}
                <Button type="submit" variant="primary" loading={busy === 'save'} disabled={!encryptionReady}>
                  <Link2 className="size-4" />
                  Verify &amp; save
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Webhook */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Webhook (Razorpay Dashboard → Webhooks)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs leading-relaxed text-slate-500">
            The webhook lets StayFlow record a payment even if the resident closes the app before
            returning. It is specific to your account.
          </p>
          <button
            type="button"
            onClick={() => copy(webhookUrl, 'Webhook URL')}
            className="flex w-full items-center gap-3 rounded-xl border border-slate-200 p-3 text-left transition-colors hover:bg-slate-50"
          >
            <span className="min-w-0 flex-1 break-all font-mono text-xs text-slate-700">{webhookUrl}</span>
            <Copy className="size-4 shrink-0 text-slate-400" />
          </button>
          <div>
            <p className="mb-1.5 text-xs font-medium text-slate-600">Active events</p>
            <div className="flex flex-wrap gap-1.5">
              {EVENTS.map((event) => (
                <Badge key={event} variant="outline" className="font-mono">
                  {event}
                </Badge>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
