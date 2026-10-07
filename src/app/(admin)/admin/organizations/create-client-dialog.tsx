'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Building2, Plus } from 'lucide-react'
import { api, ApiError } from '@/lib/client'
import { useToast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { InviteLinkPanel, type AccessLink } from '@/components/app/invite-link'

type ClientValues = { orgName: string; ownerName: string; email: string; phone: string; city: string }

const EMPTY: ClientValues = { orgName: '', ownerName: '', email: '', phone: '', city: '' }

const FIELDS: { name: keyof ClientValues; label: string; type?: string; half?: boolean; required?: boolean }[] = [
  { name: 'orgName', label: 'Business / PG name', required: true },
  { name: 'ownerName', label: 'Owner name', required: true },
  { name: 'email', label: 'Owner email', type: 'email', half: true, required: true },
  { name: 'phone', label: 'Owner mobile', type: 'tel', half: true, required: true },
  { name: 'city', label: 'City' },
]

/**
 * Creates a client account (trial organization + OWNER invite). Used for
 * "Create client" and, prefilled, for "Convert to client" on a lead.
 */
export function CreateClientDialog({
  trigger = 'Create client',
  triggerVariant = 'primary',
  triggerSize = 'default',
  title = 'Create a client account',
  defaults,
  endpoint = '/api/admin/organizations',
  payload = { action: 'CREATE' },
}: {
  trigger?: string
  triggerVariant?: 'primary' | 'outline' | 'ghost'
  triggerSize?: 'default' | 'sm'
  title?: string
  defaults?: Partial<ClientValues>
  endpoint?: string
  payload?: Record<string, string>
}) {
  const router = useRouter()
  const toast = useToast()
  const [open, setOpen] = React.useState(false)
  const [values, setValues] = React.useState<ClientValues>({ ...EMPTY, ...defaults })
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [created, setCreated] = React.useState<(AccessLink & { organization: { id: string; name: string } }) | null>(null)

  function openDialog() {
    setValues({ ...EMPTY, ...defaults })
    setError(null)
    setCreated(null)
    setOpen(true)
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    const missing = FIELDS.find((f) => f.required && !values[f.name].trim())
    if (missing) {
      setError(`${missing.label} is required`)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await api.post<AccessLink & { organization: { id: string; name: string }; message: string }>(
        endpoint,
        { ...payload, ...values },
      )
      toast.success('Client created', res.message)
      setCreated(res)
      router.refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button variant={triggerVariant} size={triggerSize} onClick={openDialog}>
        {triggerVariant === 'primary' ? <Plus className="size-4" /> : <Building2 className="size-3.5" />}
        {trigger}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          {created ? (
            <>
              <DialogHeader>
                <DialogTitle>{created.organization.name} is ready</DialogTitle>
                <DialogDescription>
                  A trial account was created. The owner sets their password from the invite link.
                </DialogDescription>
              </DialogHeader>
              <InviteLinkPanel link={created} title="Owner invite" />
              <DialogFooter>
                <Button variant="outline" asChild>
                  <Link href={`/admin/organizations/${created.organization.id}`}>Open account</Link>
                </Button>
                <Button variant="primary" onClick={() => setOpen(false)}>
                  Done
                </Button>
              </DialogFooter>
            </>
          ) : (
            <form onSubmit={submit}>
              <DialogHeader>
                <DialogTitle>{title}</DialogTitle>
                <DialogDescription>
                  Starts a trial with default settings. The owner gets an invite by email and WhatsApp.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-3 sm:grid-cols-2">
                {FIELDS.map((field) => (
                  <Field
                    key={field.name}
                    label={field.label}
                    required={field.required}
                    className={field.half ? undefined : 'sm:col-span-2'}
                  >
                    <Input
                      type={field.type ?? 'text'}
                      value={values[field.name]}
                      onChange={(e) => setValues((v) => ({ ...v, [field.name]: e.target.value }))}
                    />
                  </Field>
                ))}
                {error && <p className="text-xs font-medium text-rose-600 sm:col-span-2">{error}</p>}
              </div>
              <DialogFooter>
                <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" variant="primary" loading={busy}>
                  Create account
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}

/** "Resend owner invite" on the organization detail page. */
export function ResendOwnerInviteButton({ organizationId }: { organizationId: string }) {
  const router = useRouter()
  const toast = useToast()
  const [busy, setBusy] = React.useState(false)
  const [result, setResult] = React.useState<AccessLink | null>(null)

  async function send() {
    setBusy(true)
    try {
      const res = await api.post<AccessLink & { message: string }>('/api/admin/organizations', {
        action: 'RESEND_OWNER_INVITE',
        organizationId,
      })
      toast.success('Link sent', res.message)
      setResult(res)
      router.refresh()
    } catch (err) {
      toast.error('Could not send', err instanceof ApiError ? err.message : 'Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button variant="outline" onClick={send} loading={busy}>
        Resend owner invite
      </Button>
      <Dialog open={Boolean(result)} onOpenChange={(o) => !o && setResult(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Owner login link</DialogTitle>
            <DialogDescription>Sending a new link cancels the previous one.</DialogDescription>
          </DialogHeader>
          {result && <InviteLinkPanel link={result} />}
          <DialogFooter>
            <Button variant="primary" onClick={() => setResult(null)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
