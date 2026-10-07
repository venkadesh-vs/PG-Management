'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, Link2, MessageCircle, ShieldAlert, Unplug } from 'lucide-react'
import { api, ApiError } from '@/lib/client'
import { cn, formatDateTime } from '@/lib/utils'
import { useToast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'

type Connection = {
  mode: 'demo' | 'platform' | 'own'
  platformLive: boolean
  own: {
    phoneNumberId: string
    displayPhoneNumber: string | null
    verifiedName: string | null
    wabaId: string | null
    hasAppSecret: boolean
    active: boolean
    verifiedAt: string | null
    lastError: string | null
    readable: boolean
  } | null
}

const MODE_COPY: Record<Connection['mode'], { title: string; text: string; tone: 'emerald' | 'blue' | 'amber' }> = {
  own: {
    title: 'Your own number',
    text: 'Messages go out from your WhatsApp Business number, under your business name.',
    tone: 'emerald',
  },
  platform: {
    title: 'StayFlow platform number',
    text: 'Messages go out from the StayFlow WhatsApp Business number. Nothing to set up — connect your own below if you want residents to see your PG’s name.',
    tone: 'blue',
  },
  demo: {
    title: 'Demo — nothing is delivered',
    text: 'No WhatsApp number is connected on this deployment, so messages are kept in the outbox and marked “not sent”.',
    tone: 'amber',
  },
}

export function WhatsAppConnect({ initial, webhookUrl }: { initial: Connection; webhookUrl: string }) {
  const router = useRouter()
  const toast = useToast()
  const [connection, setConnection] = React.useState(initial)
  const [busy, setBusy] = React.useState<'connect' | 'disconnect' | null>(null)
  const [form, setForm] = React.useState({ phoneNumberId: '', wabaId: '', accessToken: '', appSecret: '' })
  const [editing, setEditing] = React.useState(!initial.own)

  const copy = MODE_COPY[connection.mode]
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }))

  async function connect(e: React.FormEvent) {
    e.preventDefault()
    setBusy('connect')
    try {
      const next = await api.post<Connection>('/api/integrations/whatsapp', form)
      setConnection(next)
      setForm({ phoneNumberId: '', wabaId: '', accessToken: '', appSecret: '' })
      setEditing(false)
      toast.success('WhatsApp number connected', next.own?.displayPhoneNumber ?? undefined)
      router.refresh()
    } catch (error) {
      toast.error('Could not connect', error instanceof ApiError ? error.message : 'Please try again')
    } finally {
      setBusy(null)
    }
  }

  async function disconnect() {
    if (!window.confirm('Disconnect your WhatsApp number? Messages will go out from the StayFlow number instead.')) return
    setBusy('disconnect')
    try {
      const next = await api.delete<Connection>('/api/integrations/whatsapp')
      setConnection(next)
      setEditing(true)
      toast.success('Disconnected', 'Messages now use the StayFlow number.')
      router.refresh()
    } catch (error) {
      toast.error('Could not disconnect', error instanceof ApiError ? error.message : 'Please try again')
    } finally {
      setBusy(null)
    }
  }

  const own = connection.own

  return (
    <div className="space-y-4">
      <Card
        className={cn(
          copy.tone === 'emerald' && 'border-emerald-200 bg-emerald-50/50',
          copy.tone === 'blue' && 'border-blue-200 bg-blue-50/40',
          copy.tone === 'amber' && 'border-amber-200 bg-amber-50/50',
        )}
      >
        <CardContent className="flex items-start gap-3 p-5">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white shadow-sm">
            {connection.mode === 'demo' ? (
              <ShieldAlert className="size-5 text-amber-600" />
            ) : (
              <MessageCircle className={cn('size-5', copy.tone === 'emerald' ? 'text-emerald-600' : 'text-blue-600')} />
            )}
          </div>
          <div className="min-w-0">
            <p className="text-xs text-slate-500">Sending from</p>
            <p className="text-sm font-semibold text-slate-900">
              {copy.title}
              {connection.mode === 'own' && own?.displayPhoneNumber ? ` · ${own.displayPhoneNumber}` : ''}
            </p>
            <p className="mt-1 text-sm leading-relaxed text-slate-600">{copy.text}</p>
          </div>
        </CardContent>
      </Card>

      {own && (
        <Card>
          <CardHeader>
            <CardTitle>Your WhatsApp Business number</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <dl className="grid gap-3 sm:grid-cols-2">
              <Detail label="Number" value={own.displayPhoneNumber} />
              <Detail label="Business name" value={own.verifiedName} />
              <Detail label="Phone number ID" value={own.phoneNumberId} />
              <Detail label="Business Account ID" value={own.wabaId} />
              <Detail label="Verified" value={own.verifiedAt ? formatDateTime(own.verifiedAt) : null} />
              <Detail label="Delivery receipts" value={own.hasAppSecret ? 'App secret saved' : 'Using StayFlow app only'} />
            </dl>
            {!own.readable && (
              <p className="rounded-lg bg-rose-50 p-3 text-xs text-rose-700">
                The saved token can no longer be read on this server (encryption key changed). Reconnect
                the number — until then messages use the StayFlow number.
              </p>
            )}
            {own.lastError && <p className="text-xs text-rose-600">{own.lastError}</p>}
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button type="button" variant="outline" onClick={() => setEditing((v) => !v)}>
                <Link2 className="size-4" />
                {editing ? 'Cancel' : 'Replace credentials'}
              </Button>
              <Button type="button" variant="destructive" loading={busy === 'disconnect'} onClick={disconnect}>
                <Unplug className="size-4" />
                Disconnect
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {editing && (
        <Card>
          <CardHeader>
            <CardTitle>{own ? 'Replace credentials' : 'Connect your own number (optional)'}</CardTitle>
            <p className="text-sm leading-relaxed text-slate-500">
              From Meta Business Suite → WhatsApp Manager → API setup. Use a permanent System User
              token with whatsapp_business_messaging permission. We check it with Meta before saving
              and store it encrypted.
            </p>
          </CardHeader>
          <CardContent>
            <form onSubmit={connect} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Phone number ID" required htmlFor="wa-phone-id">
                  <Input id="wa-phone-id" inputMode="numeric" autoComplete="off" value={form.phoneNumberId} onChange={set('phoneNumberId')} required />
                </Field>
                <Field label="WhatsApp Business Account ID" required htmlFor="wa-waba-id">
                  <Input id="wa-waba-id" inputMode="numeric" autoComplete="off" value={form.wabaId} onChange={set('wabaId')} required />
                </Field>
              </div>
              <Field label="Permanent access token" required htmlFor="wa-token">
                <Input id="wa-token" type="password" autoComplete="off" value={form.accessToken} onChange={set('accessToken')} required />
              </Field>
              <Field
                label="Meta App secret"
                htmlFor="wa-app-secret"
                hint={`Only if your number's webhook is on your own Meta app: point it at ${webhookUrl} with the verify token from StayFlow support, and paste the app secret here so delivery ticks and STOP replies are accepted.`}
              >
                <Input id="wa-app-secret" type="password" autoComplete="off" value={form.appSecret} onChange={set('appSecret')} />
              </Field>
              <Button type="submit" variant="primary" loading={busy === 'connect'} className="w-full sm:w-auto">
                <CheckCircle2 className="size-4" />
                Verify and connect
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {!own && !connection.platformLive && (
        <p className="text-xs text-slate-500">
          <Badge variant="warning" size="sm">Note</Badge> This deployment has no platform number yet.
        </p>
      )}
    </div>
  )
}

function Detail({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-0.5 break-words text-sm text-slate-800">{value || '—'}</dd>
    </div>
  )
}
