import type { Metadata } from 'next'
import Link from 'next/link'
import { MINI_APPS } from '@/lib/apps-registry'

export const metadata: Metadata = {
  title: '100Lights Apps — Free Browser Music Tools',
  description: 'A growing set of small, focused music tools that run in your browser — sing a melody into an instrument, make a beat, autotune a vocal, and more. Free, no download.',
  alternates: { canonical: 'https://100lights.com/apps' },
  openGraph: {
    title: '100Lights Apps',
    description: 'Free, focused browser music tools — voice-to-instrument, beat maker, autotune, and more.',
    url: 'https://100lights.com/apps',
    type: 'website',
    siteName: '100Lights',
  },
}

export default function AppsIndexPage() {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)' }}>
      <main id="main" className="max-w-3xl mx-auto px-6 py-16">
        <header style={{ marginBottom: 34 }}>
          <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--accent)', margin: '0 0 10px' }}>
            100Lights
          </p>
          <h1 style={{ fontSize: 36, fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 12px', letterSpacing: '-0.02em' }}>
            Apps
          </h1>
          <p style={{ fontSize: 15.5, color: 'var(--text-secondary)', lineHeight: 1.65, margin: 0, maxWidth: '48ch' }}>
            Small, focused music tools that run right in your browser — no account, no download.
            Each one does a single thing well.
          </p>
        </header>

        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
          {MINI_APPS.map(app => (
            <li key={app.slug}>
              <Link
                href={app.href}
                style={{
                  display: 'flex', flexDirection: 'column', height: '100%', gap: 8,
                  padding: '18px 18px 20px', borderRadius: 12,
                  border: '1px solid var(--border)', background: 'var(--bg-card)',
                  textDecoration: 'none', transition: 'border-color 120ms, transform 120ms',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <h2 style={{ fontSize: 18, fontWeight: 750, color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.01em' }}>
                    {app.title}
                  </h2>
                  {app.status === 'beta' && (
                    <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--accent-light, var(--accent))', border: '1px solid var(--border)', borderRadius: 999, padding: '2px 7px' }}>
                      Beta
                    </span>
                  )}
                </div>
                <p style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.45 }}>
                  {app.tagline}
                </p>
                <p style={{ fontSize: 12.5, color: 'var(--text-muted, var(--text-secondary))', margin: '2px 0 0', lineHeight: 1.55 }}>
                  {app.description}
                </p>
                <span style={{ marginTop: 'auto', paddingTop: 10, fontSize: 13, fontWeight: 700, color: 'var(--accent)' }}>
                  Open →
                </span>
              </Link>
            </li>
          ))}
        </ul>

        <p style={{ marginTop: 30, fontSize: 13, color: 'var(--text-muted, var(--text-secondary))', lineHeight: 1.6 }}>
          More on the way. These are the same engines behind the full{' '}
          <Link href="/" style={{ color: 'var(--accent)', textDecoration: 'none', fontWeight: 600 }}>100Lights studio</Link>,
          broken out into single-purpose tools.
        </p>
      </main>
    </div>
  )
}
