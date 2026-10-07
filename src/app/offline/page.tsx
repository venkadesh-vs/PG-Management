import type { Metadata } from 'next'
import { WifiOff } from 'lucide-react'
import { LogoMark } from '@/components/marketing/logo'
import { ReloadButton } from './reload-button'

export const metadata: Metadata = {
  title: 'Offline',
  robots: { index: false, follow: false },
}

/**
 * Served by the service worker when an installed app opens without a
 * connection. Rent, complaints and the rest are live data, so nothing stale is
 * shown in their place.
 */
export default function OfflinePage() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-slate-50 px-6 text-center">
      <LogoMark className="size-12" />
      <div className="flex size-14 items-center justify-center rounded-xl border border-slate-200 bg-white shadow-xs">
        <WifiOff className="size-6 text-slate-400" />
      </div>
      <div className="max-w-xs space-y-2">
        <h1 className="font-display text-xl font-semibold text-slate-900">You&apos;re offline</h1>
        <p className="text-sm leading-relaxed text-slate-500">
          Check your Wi-Fi or mobile data. Your rent, complaints and notices will load as soon as
          you&apos;re back online.
        </p>
      </div>
      <ReloadButton />
    </div>
  )
}
