import type { Metadata } from 'next'
import Link from 'next/link'
import { GraduationCap } from 'lucide-react'
import { getArticles } from '@/lib/learn-articles'
import LearnBrowser, { type CardArticle } from '@/components/learn/LearnBrowser'
import { TOOL_PROMOS } from '@/components/learn/tool-promos'

export const metadata: Metadata = {
  title: 'Learn Music Production — Free Guides & Ear Training',
  description: 'Learn to make music from scratch: beats, chord progressions, recording, mixing, and arranging. Practical guides you can do free in your browser, no downloads.',
  alternates: { canonical: 'https://100lights.com/learn' },
  openGraph: {
    title: '100Lights Learn — Music Production Guides',
    description: 'Practical guides to beats, chords, recording, and mixing — all doable in your browser for free.',
    url: 'https://100lights.com/learn',
    type: 'website',
    siteName: '100Lights',
  },
}

export const revalidate = 60

export default async function LearnIndex() {
  const articles = await getArticles()
  const cards: CardArticle[] = articles.map(a => ({
    slug: a.slug, title: a.title, description: a.description, tags: a.tags, minutes: a.minutes, date: a.date,
  }))

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)' }}>
      <main id="main" className="max-w-4xl mx-auto px-6 py-14">
        <nav style={{ marginBottom: 26 }}>
          <Link href="/" style={{ fontSize: 13, color: 'var(--text-muted)', textDecoration: 'none' }}>← 100Lights</Link>
        </nav>

        <header style={{ marginBottom: 36, maxWidth: 640 }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 16,
            fontSize: 12, fontWeight: 600, padding: '5px 12px', borderRadius: 99,
            color: 'var(--accent-light)', background: 'var(--accent-subtle)', border: '1px solid rgba(139,92,246,0.25)',
          }}>
            <GraduationCap size={13} /> Free guides · do them in your browser
          </div>
          <h1 style={{ fontSize: 42, fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 14px', letterSpacing: '-0.03em', lineHeight: 1.05 }}>
            Learn to actually{' '}
            <span style={{ background: 'linear-gradient(135deg, #8b5cf6, #3b82f6)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              make music
            </span>
          </h1>
          <p style={{ fontSize: 16.5, color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0 }}>
            Not theory for its own sake — practical guides that make a claim, name the songs, and give you something to try. Every one is doable free in the 100Lights studio.
          </p>
        </header>

        {cards.length === 0 ? (
          <p style={{ fontSize: 14, color: 'var(--text-muted)' }}>Guides are on their way — check back soon.</p>
        ) : (
          <LearnBrowser articles={cards} />
        )}

        {/* Try-a-tool strip: the interactive way in, and internal links to /tools */}
        <section style={{ marginTop: 44, paddingTop: 28, borderTop: '1px solid var(--border)' }}>
          <h2 style={{ fontSize: 17, fontWeight: 750, color: 'var(--text-primary)', margin: '0 0 4px' }}>Or just start pressing buttons</h2>
          <p style={{ fontSize: 13.5, color: 'var(--text-secondary)', margin: '0 0 16px' }}>Free tools you can play with right now — no reading required.</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
            {TOOL_PROMOS.map(t => {
              const Icon = t.icon
              return (
                <Link key={t.href} href={t.href} style={{
                  display: 'flex', alignItems: 'center', gap: 12, textDecoration: 'none',
                  padding: '14px 16px', borderRadius: 13, border: '1px solid var(--border)', background: 'var(--bg-card)',
                }}>
                  <div style={{ width: 36, height: 36, flexShrink: 0, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', background: `linear-gradient(135deg, ${t.from}, ${t.to})`, color: '#fff' }}>
                    <Icon size={18} />
                  </div>
                  <div>
                    <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-primary)' }}>{t.title}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{t.hook}</div>
                  </div>
                </Link>
              )
            })}
          </div>
        </section>
      </main>
    </div>
  )
}
