'use client'

import * as React from 'react'
import { usePathname, useSearchParams } from 'next/navigation'

/**
 * A thin indigo-to-gold bar at the top of the screen while a page loads.
 * Starts on any in-app link click, finishes when the new route renders.
 */
export function RouteProgress() {
  const pathname = usePathname()
  const search = useSearchParams()
  const [state, setState] = React.useState<'idle' | 'loading' | 'done'>('idle')
  const route = `${pathname}?${search.toString()}`
  const last = React.useRef(route)

  // The new route has rendered: run to 100% and fade.
  React.useEffect(() => {
    if (last.current === route) return
    last.current = route
    setState((s) => (s === 'loading' ? 'done' : s))
    const timer = setTimeout(() => setState('idle'), 450)
    return () => clearTimeout(timer)
  }, [route])

  React.useEffect(() => {
    function onClick(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const anchor = (event.target as Element | null)?.closest?.('a')
      if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download')) return
      const href = anchor.getAttribute('href')
      if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return
      const url = new URL(anchor.href, window.location.href)
      if (url.origin !== window.location.origin || url.pathname.startsWith('/api/')) return
      if (url.pathname === window.location.pathname && url.search === window.location.search) return
      setState('loading')
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [])

  return (
    <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 z-[100] h-[2.5px]">
      <div
        className="h-full origin-left bg-gradient-to-r from-blue-500 via-blue-400 to-marigold-300 shadow-[0_0_10px_rgb(104_99_238/0.6)]"
        style={{
          transform: `scaleX(${state === 'idle' ? 0 : state === 'loading' ? 0.82 : 1})`,
          opacity: state === 'idle' ? 0 : 1,
          transition:
            state === 'loading'
              ? 'transform 8s cubic-bezier(0.1, 0.7, 0.2, 1), opacity 0.2s'
              : 'transform 0.25s ease-out, opacity 0.35s ease 0.15s',
        }}
      />
    </div>
  )
}
