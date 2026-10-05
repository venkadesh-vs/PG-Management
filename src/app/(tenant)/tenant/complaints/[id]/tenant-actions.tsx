'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { CheckCircle2, Star } from 'lucide-react'
import { api, ApiError } from '@/lib/client'
import { cn } from '@/lib/utils'
import { useToast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

/**
 * A resident can confirm the fix and rate it. Everything else on a complaint
 * belongs to the owner or the worker.
 */
export function TenantComplaintActions({
  complaintId,
  status,
  rating,
}: {
  complaintId: string
  status: string
  rating: number | null
}) {
  const router = useRouter()
  const toast = useToast()
  const [busy, setBusy] = React.useState(false)
  const [hovered, setHovered] = React.useState(0)

  if (status !== 'RESOLVED' && status !== 'CLOSED') return null

  async function close(stars: number) {
    setBusy(true)
    try {
      await api.patch('/api/complaints', {
        complaintId,
        action: 'STATUS',
        status: 'CLOSED',
        rating: stars,
        message: `Resident confirmed the fix and rated it ${stars} out of 5.`,
      })
      toast.success('Thanks for confirming', 'This complaint is now closed.')
      router.refresh()
    } catch (error) {
      toast.error(
        'Something went wrong',
        error instanceof ApiError ? error.message : 'Please try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  if (status === 'CLOSED') {
    return (
      <Card className="border-emerald-200 bg-emerald-50/50">
        <CardContent className="flex items-center gap-3 p-4">
          <CheckCircle2 className="size-5 shrink-0 text-emerald-600" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-emerald-900">Closed</p>
            {rating && (
              <div className="mt-0.5 flex items-center gap-0.5">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Star
                    key={i}
                    className={cn(
                      'size-3.5',
                      i < rating ? 'fill-amber-400 text-amber-400' : 'text-emerald-200',
                    )}
                  />
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="border-emerald-200 bg-emerald-50/50">
      <CardContent className="p-5 text-center">
        <p className="font-display text-sm font-semibold text-emerald-900">
          Is this sorted now?
        </p>
        <p className="mt-1 text-sm text-emerald-800/80">
          Rate the work to close it. If the problem is still there, add a message below instead and
          it will be reopened.
        </p>
        <div className="mt-3 flex items-center justify-center gap-1">
          {[1, 2, 3, 4, 5].map((star) => (
            <motion.button
              key={star}
              type="button"
              whileHover={{ scale: 1.15 }}
              whileTap={{ scale: 0.95 }}
              disabled={busy}
              onMouseEnter={() => setHovered(star)}
              onMouseLeave={() => setHovered(0)}
              onClick={() => close(star)}
              aria-label={`Rate ${star} out of 5`}
              className="p-1"
            >
              <Star
                className={cn(
                  'size-7 transition-colors',
                  star <= hovered ? 'fill-amber-400 text-amber-400' : 'text-emerald-300',
                )}
              />
            </motion.button>
          ))}
        </div>
        <Button variant="ghost" size="sm" className="mt-1" loading={busy} onClick={() => close(5)}>
          Yes, close it
        </Button>
      </CardContent>
    </Card>
  )
}
