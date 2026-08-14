'use client'

// Route-level error boundary. Without this, a component crash (e.g. a bad render in one editor panel)
// white-screens the whole route — Sentry still logs it, but the user is stuck. This catches it and
// shows a recovery UI. Segment-scoped: only the failing route re-renders here, not the whole app.
import { useEffect } from 'react'
import * as Sentry from '@sentry/nextjs'
import Link from 'next/link'

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { Sentry.captureException(error) }, [error])
  return (
    <div style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 24, background: 'var(--bg-base, #0b0b0f)', color: 'var(--text-primary, #f5f5f7)' }}>
      <div style={{ maxWidth: 460, textAlign: 'center' }}>
        <div style={{ fontSize: 34, marginBottom: 12 }} aria-hidden>⚠️</div>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: '0 0 8px', letterSpacing: '-0.01em' }}>Something went wrong</h1>
        <p style={{ fontSize: 14, color: 'var(--text-secondary, #a1a1aa)', lineHeight: 1.6, margin: '0 0 22px' }}>
          An unexpected error interrupted this page. It’s been reported automatically. Try again, or head back — your saved work isn’t affected.
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button onClick={() => reset()} style={{ padding: '10px 22px', borderRadius: 10, border: 'none', background: 'var(--accent, #7c3aed)', color: '#0e0d12', fontSize: 14, fontWeight: 800, cursor: 'pointer' }}>Try again</button>
          <Link href="/dashboard" style={{ padding: '10px 22px', borderRadius: 10, border: '1px solid var(--border, #2a2a33)', color: 'var(--text-secondary, #a1a1aa)', fontSize: 14, fontWeight: 700, textDecoration: 'none' }}>Go to dashboard</Link>
        </div>
        {error.digest && <p style={{ fontSize: 11, color: 'var(--text-muted, #6b6b76)', marginTop: 18, fontFamily: 'ui-monospace, monospace' }}>Reference: {error.digest}</p>}
      </div>
    </div>
  )
}
