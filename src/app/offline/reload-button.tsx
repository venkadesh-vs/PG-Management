'use client'

import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function ReloadButton() {
  return (
    <Button variant="primary" onClick={() => window.location.reload()}>
      <RefreshCw className="size-4" />
      Try again
    </Button>
  )
}
