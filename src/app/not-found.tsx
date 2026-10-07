import Link from 'next/link'
import { SearchX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { LogoMark } from '@/components/marketing/logo'

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-slate-50 px-6 text-center">
      <LogoMark className="size-12" />
      <div className="flex size-14 items-center justify-center rounded-xl border border-slate-200 bg-white shadow-xs">
        <SearchX className="size-6 text-slate-400" />
      </div>
      <div className="max-w-sm space-y-2">
        <h1 className="font-display text-xl font-semibold text-slate-900">Page not found</h1>
        <p className="text-sm leading-relaxed text-slate-500">
          The link may be old, or the record may have been removed or belong to another account.
        </p>
      </div>
      <Button variant="primary" asChild>
        <Link href="/">Go to home</Link>
      </Button>
    </div>
  )
}
