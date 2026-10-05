'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * Shared body for every error boundary: says what happened in plain words,
 * offers a retry and a way home, and shows the digest so support can find
 * the matching server log line.
 */
export function ErrorView({
  error,
  retry,
  homeHref = '/',
}: {
  error: Error & { digest?: string }
  retry: () => void
  homeHref?: string
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-5 px-6 py-16 text-center">
      <div className="flex size-14 items-center justify-center rounded-2xl bg-red-50 text-red-600">
        <AlertTriangle className="size-6" />
      </div>
      <div className="space-y-2">
        <h1 className="font-display text-xl font-semibold text-slate-900">Something went wrong</h1>
        <p className="text-sm leading-relaxed text-slate-500">
          This page could not load. Your data is safe — try again, and if it keeps happening, contact
          support with the reference below.
        </p>
        {error.digest && (
          <p className="font-mono text-xs text-slate-400">Reference: {error.digest}</p>
        )}
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <Button variant="primary" onClick={() => retry()}>
          <RefreshCw className="size-4" />
          Try again
        </Button>
        <Button variant="outline" asChild>
          <Link href={homeHref}>Go to home</Link>
        </Button>
      </div>
    </div>
  )
}
