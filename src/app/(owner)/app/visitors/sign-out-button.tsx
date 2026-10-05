'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { LogOut } from 'lucide-react'
import { api, ApiError } from '@/lib/client'
import { useToast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'

/** Marks a visitor as having left, closing the entry in the register. */
export function SignOutVisitorButton({ visitorId, name }: { visitorId: string; name: string }) {
  const router = useRouter()
  const toast = useToast()
  const [busy, setBusy] = React.useState(false)

  async function signOut() {
    setBusy(true)
    try {
      const result = await api.post<{ message: string }>('/api/operations', {
        entity: 'VISITOR_EXIT',
        visitorId,
      })
      toast.success('Visitor signed out', result.message)
      router.refresh()
    } catch (error) {
      toast.error(
        'Unable to sign out',
        error instanceof ApiError ? error.message : 'Please try again.',
      )
      setBusy(false)
    }
  }

  return (
    <Button variant="outline" size="sm" loading={busy} onClick={signOut}>
      <LogOut className="size-3.5" />
      <span className="sr-only sm:not-sr-only">Sign out {name.split(' ')[0]}</span>
    </Button>
  )
}
