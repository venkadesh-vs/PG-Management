'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Plus } from 'lucide-react'
import { complaintSchema } from '@/lib/validation'
import type { z } from 'zod'
import { api, ApiError } from '@/lib/client'
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

type Values = z.infer<typeof complaintSchema>

/** Owners log a complaint on a resident's behalf (phone call, walk-in). */
export function NewComplaintButton({
  properties,
  residents,
  defaultPropertyId,
  categories,
}: {
  /** The org's COMPLAINT_CATEGORY lookup list. */
  categories: { value: string; label: string }[]
  properties: { id: string; name: string; type: string }[]
  residents: { id: string; fullName: string; propertyId: string; roomId: string | null }[]
  defaultPropertyId?: string
}) {
  const router = useRouter()
  const toast = useToast()
  const [open, setOpen] = React.useState(false)

  const form = useForm<Values>({
    resolver: zodResolver(complaintSchema),
    defaultValues: {
      propertyId: defaultPropertyId ?? properties[0]?.id ?? '',
      residentId: '',
      category: categories[0]?.value ?? '',
      priority: 'MEDIUM',
      title: '',
      description: '',
      photoUrls: [],
    },
  })

  const propertyId = form.watch('propertyId')
  const scopedResidents = residents.filter((r) => r.propertyId === propertyId)

  async function onSubmit(values: Values) {
    try {
      const resident = residents.find((r) => r.id === values.residentId)
      const result = await api.post<{ message: string }>('/api/complaints', {
        ...values,
        roomId: resident?.roomId ?? undefined,
      })
      toast.success('Complaint created successfully', result.message)
      form.reset()
      setOpen(false)
      router.refresh()
    } catch (error) {
      toast.error(
        'Unable to create this complaint',
        error instanceof ApiError ? error.message : 'Please try again.',
      )
    }
  }

  if (!properties.length) return null

  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        <Plus className="size-4" />
        Log a complaint
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <DialogHeader>
              <DialogTitle>Log a complaint</DialogTitle>
              <DialogDescription>
                For issues reported by phone or in person. Residents can raise their own from the
                app.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="PG" required>
                  <Select {...form.register('propertyId')}>
                    {properties.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Resident" hint="Optional — for common-area issues">
                  <Select {...form.register('residentId')}>
                    <option value="">Not resident-specific</option>
                    {scopedResidents.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.fullName}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Category" required>
                  <Select {...form.register('category')}>
                    {categories.map(({ value, label }) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Priority" required>
                  <Select {...form.register('priority')}>
                    <option value="LOW">Low</option>
                    <option value="MEDIUM">Medium</option>
                    <option value="HIGH">High</option>
                    <option value="URGENT">Urgent</option>
                  </Select>
                </Field>
              </div>

              <Field label="What is the issue?" required error={form.formState.errors.title?.message}>
                <Input placeholder="Bathroom tap is leaking" {...form.register('title')} />
              </Field>
              <Field label="Details" required error={form.formState.errors.description?.message}>
                <Textarea
                  rows={4}
                  placeholder="Where exactly is the problem, and since when?"
                  {...form.register('description')}
                />
              </Field>
            </div>

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" loading={form.formState.isSubmitting}>
                Create complaint
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
