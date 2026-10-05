'use client'

import * as React from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Download, Plus, Share, X } from 'lucide-react'
import { cn } from '@/lib/utils'

/** Chrome/Edge/Samsung fire this before showing their own install UI. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const DISMISS_KEY = 'stayflow:install-dismissed'
const DISMISS_DAYS = 14

function isStandalone() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

function recentlyDismissed() {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY))
    return Boolean(at) && Date.now() - at < DISMISS_DAYS * 86_400_000
  } catch {
    return false
  }
}

/**
 * "Install the app" card for the phone apps. Android gets a one-tap install
 * button; iPhone, which has no install API, gets the Share → Add to Home
 * Screen steps. Hidden once installed, and for two weeks after "Not now".
 */
export function InstallPrompt({ appName, className }: { appName: string; className?: string }) {
  const [deferred, setDeferred] = React.useState<BeforeInstallPromptEvent | null>(null)
  const [ios, setIos] = React.useState(false)
  const [visible, setVisible] = React.useState(false)

  React.useEffect(() => {
    if (isStandalone() || recentlyDismissed()) return

    const ua = navigator.userAgent
    const isIos = /iphone|ipad|ipod/i.test(ua) || (ua.includes('Mac') && navigator.maxTouchPoints > 1)
    if (isIos) {
      setIos(true)
      setVisible(true)
    }

    function onPrompt(event: Event) {
      event.preventDefault()
      setDeferred(event as BeforeInstallPromptEvent)
      setVisible(true)
    }
    function onInstalled() {
      setVisible(false)
      setDeferred(null)
    }
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  function dismiss() {
    setVisible(false)
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()))
    } catch {
      // Private mode: it just shows again next visit.
    }
  }

  async function install() {
    if (!deferred) return
    await deferred.prompt()
    const { outcome } = await deferred.userChoice
    setDeferred(null)
    if (outcome === 'accepted') setVisible(false)
  }

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          className={cn(
            'relative flex items-start gap-3 rounded-2xl border border-blue-100 bg-blue-50/70 p-4',
            className,
          )}
        >
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white">
            <Download className="size-5" />
          </div>
          <div className="min-w-0 flex-1 pr-6">
            <p className="text-sm font-semibold text-slate-900">Install the {appName} app</p>
            {ios ? (
              <p className="mt-1 text-xs leading-relaxed text-slate-600">
                Tap <Share className="inline size-3.5 -translate-y-px" /> <strong>Share</strong> in
                Safari, then <Plus className="inline size-3.5 -translate-y-px" />{' '}
                <strong>Add to Home Screen</strong>.
              </p>
            ) : (
              <>
                <p className="mt-1 text-xs leading-relaxed text-slate-600">
                  Open it from your home screen, full-screen, like any other app.
                </p>
                <button
                  type="button"
                  onClick={install}
                  className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-lg bg-blue-600 px-3 text-xs font-semibold text-white shadow-sm hover:bg-blue-700"
                >
                  <Download className="size-3.5" />
                  Install app
                </button>
              </>
            )}
          </div>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Not now"
            className="absolute right-2 top-2 rounded-lg p-1.5 text-slate-400 hover:bg-white hover:text-slate-600"
          >
            <X className="size-4" />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
