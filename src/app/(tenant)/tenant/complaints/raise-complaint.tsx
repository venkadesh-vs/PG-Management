'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import {
  AirVent,
  Bath,
  Check,
  Droplets,
  Fan,
  Plus,
  Sofa,
  Sparkles,
  Utensils,
  Wifi,
  Wrench,
  Zap,
  ShieldAlert,
  DoorOpen,
} from 'lucide-react'
import { api } from '@/lib/client'
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
import { Field, Input, Textarea } from '@/components/ui/input'
import { PhotoUpload } from '@/components/app/photo-upload'

/** Icons for the built-in categories; anything the owner adds gets a wrench. */
const CATEGORY_ICON: Record<string, React.ElementType> = {
  PLUMBING: Droplets,
  ELECTRICITY: Zap,
  AC: AirVent,
  FAN: Fan,
  BATHROOM: Bath,
  CLEANING: Sparkles,
  INTERNET: Wifi,
  FOOD: Utensils,
  ROOM: DoorOpen,
  FURNITURE: Sofa,
  SECURITY: ShieldAlert,
  OTHER: Wrench,
}

const PRIORITIES = [
  { value: 'LOW', label: 'Can wait' },
  { value: 'MEDIUM', label: 'Normal' },
  { value: 'HIGH', label: 'Urgent' },
] as const

/**
 * Resident-facing complaint form. Deliberately three taps: pick what is
 * wrong, say a little about it, send.
 */
export function RaiseComplaintButton({
  variant = 'primary',
  categories,
}: {
  variant?: 'primary' | 'outline'
  /** The org's COMPLAINT_CATEGORY lookup list. */
  categories: { value: string; label: string }[]
}) {
  const firstCategory = categories[0]?.value ?? ''
  const router = useRouter()
  const toast = useToast()
  const [open, setOpen] = React.useState(false)
  const [category, setCategory] = React.useState<string>(firstCategory)
  const [priority, setPriority] = React.useState<string>('MEDIUM')
  const [title, setTitle] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [photos, setPhotos] = React.useState<string[]>([])
  const [uploading, setUploading] = React.useState(false)
  const [done, setDone] = React.useState<string | null>(null)

  function reset() {
    setTitle('')
    setDescription('')
    setCategory(firstCategory)
    setPriority('MEDIUM')
    setPhotos([])
    setDone(null)
  }

  async function submit() {
    if (title.trim().length < 4 || description.trim().length < 10) {
      toast.error('A little more detail, please', 'Tell us what is wrong and where.')
      return
    }
    setBusy(true)
    try {
      const result = await api.post<{ complaint: { code: string }; message: string }>(
        '/api/complaints',
        {
          // The server resolves the property from the signed-in resident and
          // ignores this value; it is only here to satisfy the shared schema.
          propertyId: 'self',
          category,
          priority,
          title: title.trim(),
          description: description.trim(),
          photoUrls: photos,
        },
      )
      setDone(result.complaint.code)
      toast.success('Complaint created successfully', 'Your PG owner has been notified.')
      router.refresh()
    } catch (error) {
      toast.fromError(error, 'send this complaint')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button
        variant={variant}
        size={variant === 'primary' ? 'default' : 'sm'}
        onClick={() => {
          reset()
          setOpen(true)
        }}
      >
        <Plus className="size-4" />
        Raise
      </Button>

      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o)
          if (!o) reset()
        }}
      >
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
              <DialogTitle>Complaint {done} raised</DialogTitle>
              <DialogDescription>
                Your PG owner has been notified. You will see it here as soon as somebody is
                assigned, and again when it is fixed.
              </DialogDescription>
              <Button variant="primary" className="w-full" onClick={() => setOpen(false)}>
                Done
              </Button>
            </motion.div>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>What needs fixing?</DialogTitle>
                <DialogDescription>
                  Your PG owner is notified straight away and you can follow the progress here.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                <div>
                  <p className="mb-2 text-sm font-medium text-slate-700">Category</p>
                  <div className="grid grid-cols-4 gap-2">
                    {categories.map((item) => {
                      const Icon = CATEGORY_ICON[item.value] ?? Wrench
                      const active = category === item.value
                      return (
                        <button
                          key={item.value}
                          type="button"
                          onClick={() => setCategory(item.value)}
                          className={cn(
                            'flex flex-col items-center gap-1 rounded-xl border p-2.5 transition-all',
                            active
                              ? 'border-blue-300 bg-blue-50 ring-2 ring-blue-500/15'
                              : 'border-slate-200 hover:border-slate-300',
                          )}
                        >
                          <Icon
                            className={cn('size-4', active ? 'text-blue-600' : 'text-slate-400')}
                          />
                          <span
                            className={cn(
                              'text-[10px] font-medium',
                              active ? 'text-blue-700' : 'text-slate-600',
                            )}
                          >
                            {item.label}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>

                <Field label="In a few words" required>
                  <Input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Bathroom tap is leaking"
                  />
                </Field>

                <Field label="What exactly is the problem?" required>
                  <Textarea
                    rows={4}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="The wash basin tap keeps dripping through the night and water is collecting on the floor."
                  />
                </Field>

                <Field label="Photos" hint="Optional">
                  <PhotoUpload
                    value={photos}
                    onChange={setPhotos}
                    purpose="COMPLAINT"
                    max={3}
                    label="Add photo"
                    hint="A photo of the problem helps us fix it faster. Up to 3."
                    onBusyChange={setUploading}
                  />
                </Field>

                <div>
                  <p className="mb-2 text-sm font-medium text-slate-700">How urgent is it?</p>
                  <div className="grid grid-cols-3 gap-2">
                    {PRIORITIES.map((item) => (
                      <button
                        key={item.value}
                        type="button"
                        onClick={() => setPriority(item.value)}
                        className={cn(
                          'rounded-xl border px-3 py-2 text-sm font-medium transition-all',
                          priority === item.value
                            ? 'border-blue-300 bg-blue-50 text-blue-700 ring-2 ring-blue-500/15'
                            : 'border-slate-200 text-slate-600 hover:border-slate-300',
                        )}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <DialogFooter>
                <Button variant="ghost" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button variant="primary" loading={busy} disabled={uploading} onClick={submit}>
                  {uploading ? 'Uploading photos…' : 'Send complaint'}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
