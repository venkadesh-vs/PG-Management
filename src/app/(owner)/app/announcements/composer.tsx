'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Megaphone, Send } from 'lucide-react'
import { api, ApiError } from '@/lib/client'
import { cn } from '@/lib/utils'
import { useToast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, Input, Select, Textarea } from '@/components/ui/input'
import { Switch } from '@/components/ui/primitives'

type Property = { id: string; name: string; type: 'MENS' | 'WOMENS' | 'COLIVE' }
type Floor = { id: string; name: string; propertyId: string }

/**
 * Compose and send an announcement. Choosing an audience resolves to real
 * residents server-side, so the count shown after sending is the number of
 * people who actually received it.
 */
export function AnnouncementComposer({
  properties,
  floors,
}: {
  properties: Property[]
  floors: Floor[]
}) {
  const router = useRouter()
  const toast = useToast()
  const [open, setOpen] = React.useState(false)
  const [title, setTitle] = React.useState('')
  const [body, setBody] = React.useState('')
  const [audience, setAudience] = React.useState<'ALL_PROPERTIES' | 'PROPERTY' | 'FLOOR'>(
    properties.length > 1 ? 'ALL_PROPERTIES' : 'PROPERTY',
  )
  const [propertyId, setPropertyId] = React.useState(properties[0]?.id ?? '')
  const [floorId, setFloorId] = React.useState('')
  const [pinned, setPinned] = React.useState(false)
  const [sendWhatsapp, setSendWhatsapp] = React.useState(false)
  const [busy, setBusy] = React.useState(false)

  const scopedFloors = floors.filter((f) => f.propertyId === propertyId)

  function reset() {
    setTitle('')
    setBody('')
    setPinned(false)
    setSendWhatsapp(false)
  }

  async function submit() {
    if (!title.trim() || body.trim().length < 10) {
      toast.error('Check the message', 'Add a title and a little more detail.')
      return
    }
    setBusy(true)
    try {
      const result = await api.post<{ message: string; reached: number }>('/api/operations', {
        entity: 'ANNOUNCEMENT',
        title: title.trim(),
        body: body.trim(),
        audience,
        propertyId: audience === 'ALL_PROPERTIES' ? undefined : propertyId,
        floorId: audience === 'FLOOR' ? floorId : undefined,
        pinned,
        sendWhatsapp,
      })
      toast.success('Announcement sent', result.message)
      reset()
      setOpen(false)
      router.refresh()
    } catch (error) {
      toast.error(
        'Unable to send',
        error instanceof ApiError ? error.message : 'Please try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  if (!properties.length) return null

  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        <Megaphone className="size-4" />
        New announcement
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New announcement</DialogTitle>
            <DialogDescription>
              Residents see it in their app immediately, with a notification.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <Field label="Title" required>
              <Input
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Water tank cleaning on Sunday"
              />
            </Field>

            <Field label="Message" required>
              <Textarea
                rows={5}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="The overhead water tanks will be cleaned this Sunday between 10 AM and 2 PM…"
              />
            </Field>

            <Field label="Who should get this?" required>
              <div className="grid gap-2 sm:grid-cols-3">
                {[
                  { value: 'ALL_PROPERTIES', label: 'Everyone', hint: 'All PGs' },
                  { value: 'PROPERTY', label: 'One PG', hint: 'Pick below' },
                  { value: 'FLOOR', label: 'One floor', hint: 'Pick below' },
                ].map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setAudience(option.value as typeof audience)}
                    className={cn(
                      'rounded-xl border p-2.5 text-left transition-colors',
                      audience === option.value
                        ? 'border-blue-300 bg-blue-50/60 ring-2 ring-blue-500/15'
                        : 'border-slate-200 hover:border-slate-300',
                    )}
                  >
                    <span className="block text-sm font-medium text-slate-800">{option.label}</span>
                    <span className="block text-[11px] text-slate-500">{option.hint}</span>
                  </button>
                ))}
              </div>
            </Field>

            {audience !== 'ALL_PROPERTIES' && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="PG" required>
                  <Select value={propertyId} onChange={(e) => setPropertyId(e.target.value)}>
                    {properties.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                {audience === 'FLOOR' && (
                  <Field label="Floor" required>
                    <Select value={floorId} onChange={(e) => setFloorId(e.target.value)}>
                      <option value="">Select a floor</option>
                      {scopedFloors.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                )}
              </div>
            )}

            <label className="flex cursor-pointer items-center justify-between rounded-xl border border-slate-200 p-3">
              <span>
                <span className="block text-sm font-medium text-slate-800">Pin to the top</span>
                <span className="block text-xs text-slate-500">
                  Stays first in the resident&apos;s list.
                </span>
              </span>
              <Switch checked={pinned} onCheckedChange={setPinned} />
            </label>

            <label className="flex cursor-pointer items-center justify-between rounded-xl border border-slate-200 p-3">
              <span>
                <span className="block text-sm font-medium text-slate-800">
                  Also send on WhatsApp
                </span>
                <span className="block text-xs text-slate-500">
                  Demo mode on this deployment — messages go to the outbox, not to phones.
                </span>
              </span>
              <Switch checked={sendWhatsapp} onCheckedChange={setSendWhatsapp} />
            </label>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" loading={busy} onClick={submit}>
              <Send className="size-4" />
              Send announcement
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </>
  )
}
