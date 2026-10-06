'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { Check } from 'lucide-react'
import { api } from '@/lib/client'
import { addDays, cn, toISODate } from '@/lib/utils'
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

export type FormKind = 'LEAVE' | 'VISITOR' | 'ROOM_CHANGE' | 'SERVICE'

const COPY: Record<FormKind, { title: string; description: string; submit: string }> = {
  LEAVE: {
    title: 'Going home for a bit?',
    description: 'Let your PG know when you leave and when you are back.',
    submit: 'Send leave request',
  },
  VISITOR: {
    title: 'Expecting a visitor',
    description: 'Once approved, the gate will have their name ready, so sign-in is quick.',
    submit: 'Ask for approval',
  },
  ROOM_CHANGE: {
    title: 'Change my room',
    description: 'Tell us what you would like. Your PG owner will check what is free.',
    submit: 'Send request',
  },
  SERVICE: {
    title: 'Something else',
    description: 'Extra cleaning, a spare key, a new mattress: ask for anything here.',
    submit: 'Send request',
  },
}

const SHARING = ['Single room', '2-sharing', '3-sharing', '4-sharing', 'AC room', 'Non-AC room']

/** One short form per request kind, in a dialog. */
export function RequestFormDialog({
  kind,
  onClose,
  canPauseMeals,
}: {
  kind: FormKind | null
  onClose: () => void
  canPauseMeals: boolean
}) {
  const router = useRouter()
  const toast = useToast()
  const today = toISODate(new Date())
  const [busy, setBusy] = React.useState(false)
  const [done, setDone] = React.useState(false)
  const [form, setForm] = React.useState<Record<string, string | boolean>>({})

  React.useEffect(() => {
    if (!kind) return
    setDone(false)
    setForm({
      fromDate: today,
      toDate: toISODate(addDays(new Date(), 2)),
      date: today,
      visitorCount: '1',
      pauseMeals: canPauseMeals,
      preference: SHARING[0],
    })
  }, [kind, today, canPauseMeals])

  const set = (key: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }))
  const text = (key: string) => (typeof form[key] === 'string' ? (form[key] as string) : '')

  function payload() {
    switch (kind) {
      case 'LEAVE':
        return {
          kind,
          fromDate: text('fromDate'),
          toDate: text('toDate'),
          reason: text('reason'),
          pauseMeals: canPauseMeals && Boolean(form.pauseMeals),
        }
      case 'VISITOR':
        return {
          kind,
          visitorName: text('visitorName'),
          visitorPhone: text('visitorPhone'),
          visitorCount: Number(text('visitorCount') || 1),
          date: text('date'),
          fromTime: text('fromTime'),
          toTime: text('toTime'),
          relation: text('relation'),
          note: text('note'),
        }
      case 'ROOM_CHANGE':
        return {
          kind,
          preference: [text('preference'), text('preferenceNote')].filter(Boolean).join(', '),
          reason: text('reason'),
          fromDate: text('fromDate'),
        }
      default:
        return { kind: 'SERVICE', title: text('title'), details: text('details') }
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      await api.post('/api/requests', payload())
      setDone(true)
      router.refresh()
    } catch (error) {
      toast.fromError(error, 'send this request')
    } finally {
      setBusy(false)
    }
  }

  const copy = kind ? COPY[kind] : null

  return (
    <Dialog open={Boolean(kind)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        {done ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            className="space-y-4 text-center"
          >
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 320, damping: 18 }}
              className="mx-auto flex size-14 items-center justify-center rounded-full bg-emerald-100"
            >
              <Check className="size-7 text-emerald-600" strokeWidth={3} />
            </motion.div>
            <DialogTitle>Request sent</DialogTitle>
            <DialogDescription>
              Your PG owner has been notified. You will get a notification as soon as it is answered.
            </DialogDescription>
            <Button variant="primary" className="w-full" onClick={onClose}>
              Done
            </Button>
          </motion.div>
        ) : (
          copy && (
            <form onSubmit={submit}>
              <DialogHeader>
                <DialogTitle>{copy.title}</DialogTitle>
                <DialogDescription>{copy.description}</DialogDescription>
              </DialogHeader>

              <div className="mt-4 space-y-4">
                {kind === 'LEAVE' && (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Leaving on" required>
                        <Input type="date" min={today} value={text('fromDate')} onChange={set('fromDate')} required />
                      </Field>
                      <Field label="Back on" required>
                        <Input type="date" min={text('fromDate') || today} value={text('toDate')} onChange={set('toDate')} required />
                      </Field>
                    </div>
                    <Field label="Where are you going?" required>
                      <Textarea rows={2} value={text('reason')} onChange={set('reason')} placeholder="Going home for Diwali" required />
                    </Field>
                    {canPauseMeals && (
                      <label
                        className={cn(
                          'flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors',
                          form.pauseMeals ? 'border-blue-300 bg-blue-50/60' : 'border-slate-200',
                        )}
                      >
                        <input
                          type="checkbox"
                          className="mt-0.5 size-4 accent-blue-600"
                          checked={Boolean(form.pauseMeals)}
                          onChange={(e) => setForm((f) => ({ ...f, pauseMeals: e.target.checked }))}
                        />
                        <span>
                          <span className="block text-sm font-medium text-slate-800">Pause my meals</span>
                          <span className="block text-xs text-slate-500">
                            The kitchen will not cook for you while you are away.
                          </span>
                        </span>
                      </label>
                    )}
                  </>
                )}

                {kind === 'VISITOR' && (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Visitor’s name" required className="col-span-2">
                        <Input value={text('visitorName')} onChange={set('visitorName')} placeholder="Ramesh Kumar" required />
                      </Field>
                      <Field label="Phone">
                        <Input type="tel" inputMode="tel" value={text('visitorPhone')} onChange={set('visitorPhone')} placeholder="98765 43210" />
                      </Field>
                      <Field label="How many people?">
                        <Input type="number" min={1} max={20} value={text('visitorCount')} onChange={set('visitorCount')} />
                      </Field>
                      <Field label="Relation">
                        <Input value={text('relation')} onChange={set('relation')} placeholder="Father" />
                      </Field>
                      <Field label="Date" required>
                        <Input type="date" min={today} value={text('date')} onChange={set('date')} required />
                      </Field>
                      <Field label="From">
                        <Input type="time" value={text('fromTime')} onChange={set('fromTime')} />
                      </Field>
                      <Field label="Until">
                        <Input type="time" value={text('toTime')} onChange={set('toTime')} />
                      </Field>
                    </div>
                    <Field label="Anything else?" hint="Optional">
                      <Textarea rows={2} value={text('note')} onChange={set('note')} placeholder="Bringing some things for me" />
                    </Field>
                  </>
                )}

                {kind === 'ROOM_CHANGE' && (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="I would like" required>
                        <Select value={text('preference')} onChange={set('preference')}>
                          {SHARING.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Field label="From" required>
                        <Input type="date" min={today} value={text('fromDate')} onChange={set('fromDate')} required />
                      </Field>
                    </div>
                    <Field label="Any preference?" hint="Optional: floor, window, a friend’s room">
                      <Input value={text('preferenceNote')} onChange={set('preferenceNote')} placeholder="Ground floor, near a window" />
                    </Field>
                    <Field label="Why do you want to move?" required>
                      <Textarea rows={3} value={text('reason')} onChange={set('reason')} placeholder="My roommate and I have very different timings." required />
                    </Field>
                  </>
                )}

                {kind === 'SERVICE' && (
                  <>
                    <Field label="What do you need?" required>
                      <Input value={text('title')} onChange={set('title')} placeholder="Extra cleaning on Saturday" required />
                    </Field>
                    <Field label="Details" hint="Optional">
                      <Textarea rows={3} value={text('details')} onChange={set('details')} placeholder="Friends are visiting this weekend, so an extra clean would help." />
                    </Field>
                  </>
                )}
              </div>

              <DialogFooter className="mt-5">
                <Button type="button" variant="ghost" onClick={onClose}>
                  Cancel
                </Button>
                <Button type="submit" variant="primary" loading={busy}>
                  {copy.submit}
                </Button>
              </DialogFooter>
            </form>
          )
        )}
      </DialogContent>
    </Dialog>
  )
}
