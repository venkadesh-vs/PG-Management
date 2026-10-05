'use client'

import { useEffect } from 'react'

/**
 * Last-resort boundary for errors in the root layout itself. It replaces the
 * whole document, so it cannot rely on the app's fonts or stylesheet.
 */
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif', background: '#f8fafc', color: '#0f172a' }}>
        <div style={{ maxWidth: 420, margin: '15vh auto', padding: 24, textAlign: 'center' }}>
          <h1 style={{ fontSize: 20, marginBottom: 8 }}>Something went wrong</h1>
          <p style={{ fontSize: 14, color: '#64748b', lineHeight: 1.6 }}>
            StayFlow could not load. Please try again in a moment.
          </p>
          {error.digest && (
            <p style={{ fontSize: 12, color: '#94a3b8', fontFamily: 'monospace' }}>Reference: {error.digest}</p>
          )}
          <button
            onClick={() => retry()}
            style={{ marginTop: 16, padding: '10px 18px', borderRadius: 10, border: 0, background: '#2563eb', color: '#fff', fontSize: 14, cursor: 'pointer' }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  )
}
