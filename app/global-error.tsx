'use client'

// Last-resort boundary — catches errors in the ROOT layout itself (which app/error.tsx can't, since it
// renders inside that layout). Must supply its own <html>/<body>. Kept dependency-free + inline-styled
// so it works even if the app's CSS/providers are what failed.
import { useEffect } from 'react'
import * as Sentry from '@sentry/nextjs'

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { Sentry.captureException(error) }, [error])
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'system-ui, -apple-system, sans-serif', background: '#0b0b0f', color: '#f5f5f7', minHeight: '100dvh', display: 'grid', placeItems: 'center' }}>
        <div style={{ textAlign: 'center', padding: 24, maxWidth: 440 }}>
          <div style={{ fontSize: 34, marginBottom: 12 }} aria-hidden>⚠️</div>
          <h1 style={{ fontSize: 22, fontWeight: 800, margin: '0 0 8px' }}>Something went wrong</h1>
          <p style={{ color: '#a1a1aa', lineHeight: 1.6, margin: '0 0 22px', fontSize: 14 }}>The app hit an unexpected error and has reported it. Reloading usually fixes it.</p>
          <button onClick={() => reset()} style={{ padding: '10px 22px', borderRadius: 10, border: 'none', background: '#7c3aed', color: '#fff', fontSize: 14, fontWeight: 800, cursor: 'pointer' }}>Reload</button>
          {error.digest && <p style={{ fontSize: 11, color: '#6b6b76', marginTop: 18, fontFamily: 'ui-monospace, monospace' }}>Reference: {error.digest}</p>}
        </div>
      </body>
    </html>
  )
}
