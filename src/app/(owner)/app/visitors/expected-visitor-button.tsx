'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { LogIn } from 'lucide-react'
import { api } from '@/lib/client'
import { useToast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'

/** One-tap sign-in for a visitor the resident pre-approved through a request. */
export function SignInExpectedButton({
  visitor,
  purpose,
}: {
  visitor: {
    propertyId: string
    residentId: string
    visitorName: string
    visitorPhone: string | null
    relation: string | null
    visitorCount: number
  }
  /** A VISITOR_PURPOSE lookup value. */
  purpose: string
}) {
  const router = useRouter()
  const toast = useToast()
  const [busy, setBusy] = React.useState(false)

  async function signIn() {
    setBusy(true)
    try {
      await api.post('/api/operations', {
        entity: 'VISITOR',
        propertyId: visitor.propertyId,
        residentId: visitor.residentId,
        name: visitor.visitorName,
        phone: visitor.visitorPhone ?? undefined,
        purpose,
        relation: visitor.relation ?? undefined,
        notes:
          visitor.visitorCount > 1
            ? `Pre-approved request · group of ${visitor.visitorCount}`
            : 'Pre-approved request',
      })
      toast.success('Visitor signed in', 'The resident has been notified.')
      router.refresh()
    } catch (error) {
      toast.fromError(error, 'sign in this visitor')
      setBusy(false)
    }
  }

  return (
    <Button variant="primary" size="sm" loading={busy} onClick={signIn}>
      <LogIn className="size-3.5" />
      Sign in
    </Button>
  )
}
