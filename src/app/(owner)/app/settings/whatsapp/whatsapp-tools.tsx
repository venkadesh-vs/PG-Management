'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Send, UserCheck, UserX } from 'lucide-react'
import { api, ApiError } from '@/lib/client'
import { formatDateTime } from '@/lib/utils'
import { sampleValue } from '@/lib/notification-prefs'
import { useToast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Field, Input, Select } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

type TemplateInfo = {
  name: string
  label: string
  category: string
  language: string
  body: string
  variables: string[]
  note?: string
  testable: boolean
}

// ------------------------------------------------------------------ test

export function TestMessageForm({ templates, mode }: { templates: TemplateInfo[]; mode: 'demo' | 'platform' | 'own' }) {
  const toast = useToast()
  const router = useRouter()
  const testable = templates.filter((t) => t.testable)
  const [phone, setPhone] = React.useState('')
  const [template, setTemplate] = React.useState(testable[0]?.name ?? '')
  const [busy, setBusy] = React.useState(false)
  const [result, setResult] = React.useState<{ ok: boolean; demo: boolean; text: string } | null>(null)

  async function send(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setResult(null)
    try {
      const res = await api.post<{ outcome?: string; message: string }>('/api/integrations/whatsapp/test', { phone, template })
      const ok = res.outcome === 'sent'
      const demo = res.outcome === 'demo'
      setResult({ ok, demo, text: res.message })
      if (ok) toast.success('Test message sent', res.message)
      else if (demo) toast.warning('Demo mode — not sent', res.message)
      else toast.error('Test message not sent', res.message)
      router.refresh()
    } catch (error) {
      const text = error instanceof ApiError ? error.message : 'Please try again'
      setResult({ ok: false, demo: false, text })
      toast.error('Test message not sent', text)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={send} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Send to (mobile number)" hint="Use your own number">
          <Input
            type="tel"
            inputMode="tel"
            placeholder="98765 43210"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            required
          />
        </Field>
        <Field label="Template">
          <Select value={template} onChange={(e) => setTemplate(e.target.value)}>
            {testable.map((t) => (
              <option key={t.name} value={t.name}>
                {t.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" loading={busy} disabled={!phone || !template}>
          <Send className="size-4" />
          Send test message
        </Button>
        <p className="text-xs text-slate-500">
          {mode === 'demo'
            ? 'Demo mode: the message is stored, not sent.'
            : `Goes out from ${mode === 'own' ? 'your own number' : 'the StayFlow number'} with sample values.`}
        </p>
      </div>
      {result && (
        <p
          role="status"
          className={`rounded-lg border p-3 text-sm ${
            result.ok
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : result.demo
                ? 'border-amber-200 bg-amber-50 text-amber-800'
                : 'border-red-200 bg-red-50 text-red-700'
          }`}
        >
          {result.text}
        </p>
      )}
    </form>
  )
}

// ------------------------------------------------------------------ templates

function fill(body: string, values: string[]) {
  return body.replace(/\{\{(\d+)\}\}/g, (_, n: string) => values[Number(n) - 1] || `{{${n}}}`)
}

export function TemplateList({ templates }: { templates: TemplateInfo[] }) {
  return (
    <div className="space-y-3">
      {templates.map((t) => (
        <TemplateCard key={t.name} template={t} />
      ))}
    </div>
  )
}

function TemplateCard({ template: t }: { template: TemplateInfo }) {
  const [values, setValues] = React.useState(() => t.variables.map(sampleValue))
  const [open, setOpen] = React.useState(false)
  return (
    <div className="rounded-xl border border-slate-200 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <code className="break-all rounded bg-slate-100 px-1.5 py-0.5 text-xs font-semibold text-slate-800">{t.name}</code>
        <Badge variant="blue" size="sm">
          {t.category}
        </Badge>
        <Badge variant="outline" size="sm">
          {t.language}
        </Badge>
        <span className="text-xs text-slate-500">{t.label}</span>
      </div>
      <p className="mt-3 select-all whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-3 font-mono text-xs leading-relaxed text-slate-800">
        {t.body}
      </p>
      <p className="mt-2 text-xs text-slate-500">
        Variables: {t.variables.map((v, i) => `{{${i + 1}}} ${v}`).join(' · ')}
      </p>
      {t.note && <p className="mt-1 text-xs text-amber-700">{t.note}</p>}

      <button
        type="button"
        className="mt-3 text-xs font-medium text-blue-700 hover:underline"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        {open ? 'Hide preview' : 'Preview with sample values'}
      </button>
      {open && (
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            {t.variables.map((v, i) => (
              <Field key={v + i} label={`{{${i + 1}}} ${v}`}>
                <Input
                  value={values[i]}
                  onChange={(e) => setValues(values.map((x, j) => (j === i ? e.target.value : x)))}
                />
              </Field>
            ))}
          </div>
          <div className="min-w-0">
            <p className="mb-1 text-xs font-medium text-slate-500">What the resident sees</p>
            <div className="rounded-2xl rounded-tl-sm border border-emerald-100 bg-[#dcf8c6]/60 p-3">
              <p className="whitespace-pre-line break-words text-sm leading-relaxed text-slate-800">{fill(t.body, values)}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ opt-outs

export type OptOutRow = { id: string; fullName: string; phone: string; status: string; property: string; optedOutAt: string }

export function OptOutList({ initial, residents }: { initial: OptOutRow[]; residents: { id: string; fullName: string }[] }) {
  const toast = useToast()
  const router = useRouter()
  const [target, setTarget] = React.useState<{ id: string; name: string; action: 'OPT_IN' | 'OPT_OUT' } | null>(null)
  const [reason, setReason] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [pick, setPick] = React.useState('')
  const optedOut = new Set(initial.map((r) => r.id))
  const candidates = residents.filter((r) => !optedOut.has(r.id))

  async function submit() {
    if (!target) return
    setBusy(true)
    try {
      const res = await api.post<{ message: string }>('/api/integrations/whatsapp/opt-outs', {
        residentId: target.id,
        action: target.action,
        reason,
      })
      toast.success(res.message)
      setTarget(null)
      setReason('')
      setPick('')
      router.refresh()
    } catch (error) {
      toast.error('Not saved', error instanceof ApiError ? error.message : 'Please try again')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      {initial.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-200 p-4 text-sm text-slate-500">
          No resident has opted out. When someone replies STOP on WhatsApp they appear here and get no
          more WhatsApp messages (login links excepted).
        </p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
          {initial.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-900">
                  {r.fullName}
                  {r.status === 'CHECKED_OUT' && <span className="ml-1 text-xs font-normal text-slate-400">(left)</span>}
                </p>
                <p className="text-xs text-slate-500">
                  {r.phone} · {r.property} · opted out {formatDateTime(r.optedOutAt)}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setTarget({ id: r.id, name: r.fullName, action: 'OPT_IN' })}
              >
                <UserCheck className="size-3.5" />
                Opt back in
              </Button>
            </li>
          ))}
        </ul>
      )}

      {candidates.length > 0 && (
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Resident asked to stop WhatsApp messages?" className="min-w-0 flex-1">
            <Select value={pick} onChange={(e) => setPick(e.target.value)}>
              <option value="">Choose resident…</option>
              {candidates.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.fullName}
                </option>
              ))}
            </Select>
          </Field>
          <Button
            variant="outline"
            disabled={!pick}
            onClick={() => {
              const r = candidates.find((c) => c.id === pick)
              if (r) setTarget({ id: r.id, name: r.fullName, action: 'OPT_OUT' })
            }}
          >
            <UserX className="size-4" />
            Opt out
          </Button>
        </div>
      )}

      <Dialog open={Boolean(target)} onOpenChange={(o) => !o && setTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {target?.action === 'OPT_IN' ? `Opt ${target?.name} back in?` : `Stop WhatsApp for ${target?.name}?`}
            </DialogTitle>
            <DialogDescription>
              {target?.action === 'OPT_IN'
                ? 'WhatsApp rules allow this only when the resident asked to receive messages again. Their consent is recorded with your reason.'
                : 'They will get no more WhatsApp messages until they send START or you opt them back in.'}
            </DialogDescription>
          </DialogHeader>
          <Field label="How did the resident ask?">
            <Input
              placeholder={target?.action === 'OPT_IN' ? 'e.g. Asked at the front desk on 12 Oct' : 'e.g. Asked in person'}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={200}
            />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTarget(null)}>
              Cancel
            </Button>
            <Button onClick={submit} loading={busy} disabled={reason.trim().length < 3}>
              {target?.action === 'OPT_IN' ? 'Opt back in' : 'Opt out'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
