'use client'

import { useRouter } from 'next/navigation'
import { LogOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/client'

export function SignOutButton() {
  const router = useRouter()
  async function signOut() {
    await api.post('/api/auth/logout').catch(() => undefined)
    router.push('/login')
    router.refresh()
  }
  return (
    <Button variant="outline" onClick={signOut}>
      <LogOut className="size-4" />
      Sign out
    </Button>
  )
}
