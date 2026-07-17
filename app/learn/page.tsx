import type { Metadata } from 'next'
import Link from 'next/link'
import { getArticles } from '@/lib/learn-articles'

export const metadata: Metadata = {
  title: 'Learn — Music Production Guides',
  description: 'Practical guides to making music in your browser: beats, chord progressions, recording, mixing, and arranging — each one doable inside 100Lights for free.',
  alternates: { canonical: 'https://100lights.com/learn' },
  openGraph: {
    title: '100Lights Learn — Music Production Guides',
    description: 'Practical guides to beats, chords, recording, and mixing — all doable in your browser for free.',
    url: 'https://100lights.com/learn',
    type: 'website',
    siteName: '100Lights',
  },
}

export default function LearnIndex() {
  const articles = getArticles()
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)' }}>
      <main id="main" className="max-w-3xl mx-auto px-6 py-14">
        <header style={{ marginBottom: 36 }}>
          <Link href="/" style={{ fontSize: 13, color: 'var(--text-muted)', textDecoration: 'none' }}>← 100Lights</Link>
          <h1 style={{ fontSize: 34, fontWeight: 800, color: 'var(--text-primary)', margin: '14px 0 10px', letterSpacing: '-0.02em' }}>Learn</h1>
          <p style={{ fontSize: 15, color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0 }}>
            Practical music-production guides — every technique here works in the free browser studio, no downloads.
          </p>
        </header>
        {articles.length === 0 && (
          <p style={{ fontSize: 14, color: 'var(--text-muted)' }}>Guides are on their way — check back soon.</p>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {articles.map(a => (
            <Link key={a.slug} href={`/learn/${a.slug}`} style={{
              display: 'block', textDecoration: 'none', padding: '18px 20px', borderRadius: 14,
              border: '1px solid var(--border)', background: 'var(--bg-card)',
            }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                <h2 style={{ fontSize: 17, fontWeight: 750, color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.01em' }}>{a.title}</h2>
                {a.draft && <span style={{ fontSize: 9, fontWeight: 800, color: '#f59e0b', border: '1px solid rgba(245,158,11,0.4)', borderRadius: 99, padding: '1px 8px', letterSpacing: '0.06em' }}>DRAFT</span>}
              </div>
              <p style={{ fontSize: 13.5, color: 'var(--text-secondary)', lineHeight: 1.6, margin: '8px 0 10px' }}>{a.description}</p>
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                {a.minutes} min read{a.tags.length > 0 ? ` · ${a.tags.join(' · ')}` : ''}
              </div>
            </Link>
          ))}
        </div>
      </main>
    </div>
  )
}
