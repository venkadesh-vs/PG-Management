'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { RotateCcw } from 'lucide-react'
import { api } from '@/lib/client'
import { useToast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'

export function RetryWebhooksButton({ disabled }: { disabled?: boolean }) {
  const router = useRouter()
  const toast = useToast()
  const [busy, setBusy] = React.useState(false)

  async function retry() {
    setBusy(true)
    try {
      const res = await api.post<{ message: string; failed: number }>('/api/admin/health', { action: 'RETRY_WEBHOOKS' })
      if (res.failed) toast.warning('Retried webhooks', res.message)
      else toast.success('Retried webhooks', res.message)
      router.refresh()
    } catch (error) {
      toast.fromError(error, 'retry the webhooks')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={retry} loading={busy} disabled={disabled}>
      <RotateCcw className="size-3.5" />
      Retry failed
    </Button>
  )
}
