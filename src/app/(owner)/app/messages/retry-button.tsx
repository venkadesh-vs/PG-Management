'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { RotateCw } from 'lucide-react'
import { api, ApiError } from '@/lib/client'
import { useToast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'

/** Resends one failed WhatsApp message with its original variables. */
export function RetryButton({ messageId }: { messageId: string }) {
  const router = useRouter()
  const toast = useToast()
  const [busy, setBusy] = React.useState(false)

  async function retry() {
    setBusy(true)
    try {
      await api.post('/api/integrations/whatsapp/retry', { messageId })
      toast.success('Message sent')
    } catch (error) {
      toast.error('Retry failed', error instanceof ApiError ? error.message : 'Please try again')
    } finally {
      setBusy(false)
      router.refresh()
    }
  }

  return (
    <Button type="button" variant="outline" size="sm" loading={busy} onClick={retry}>
      <RotateCw className="size-3.5" />
      Retry
    </Button>
  )
}
