import type { Metadata } from 'next'
import Link from 'next/link'
import { TUTORIALS } from '@/lib/tutorials'
import { UI_TIERS, TIER_INFO, lessonRequiresPro } from '@/lib/ui-tiers'

export const metadata: Metadata = {
  title: 'Studio Tutorials — Learn 100Lights Feature by Feature',
  description: 'Short, illustrated walkthroughs of the 100Lights studio — each shows exactly which button to press, then guides you through it live in the browser.',
  alternates: { canonical: 'https://100lights.com/tutorial' },
  openGraph: {
    title: '100Lights Studio Tutorials',
    description: 'Illustrated, click-by-click walkthroughs of the browser studio — free.',
    url: 'https://100lights.com/tutorial',
    type: 'website',
    siteName: '100Lights',
  },
}

export default function TutorialIndex() {
  return (
    <div style={{ minHeight: '100%', background: 'var(--bg-base)' }}>
      <main style={{ maxWidth: 760, margin: '0 auto', padding: '48px 20px 80px' }}>
        <h1 style={{ fontSize: 33, fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1.15, margin: '0 0 10px', letterSpacing: '-0.02em' }}>Studio tutorials</h1>
        <p style={{ fontSize: 16, color: 'var(--text-secondary)', margin: '0 0 32px', lineHeight: 1.5, maxWidth: 560 }}>
          Short walkthroughs of the studio, feature by feature. Each one shows the exact button to press — then opens the studio and guides you through it live.
        </p>

        {TUTORIALS.length === 0 ? (
          <div style={{ padding: '48px 20px', borderRadius: 12, border: '1px dashed var(--border)', textAlign: 'center', color: 'var(--text-muted)', fontSize: 14, lineHeight: 1.6 }}>
            New tutorials are on the way — starting with the Simplified studio and building up. Check back soon.
          </div>
        ) : (
          UI_TIERS.map(tier => {
            const group = TUTORIALS.filter(t => t.tier === tier)
            if (group.length === 0) return null
            const info = TIER_INFO[tier]
            return (
              <section key={tier} style={{ marginBottom: 34 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, margin: '0 0 12px' }}>
                  <h2 style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>{info.name}</h2>
                  <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{info.tagline}</span>
                  {lessonRequiresPro(tier) && (
                    <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.04em', color: 'var(--accent-light)', background: 'var(--accent-subtle)', border: '1px solid rgba(139,92,246,0.35)', borderRadius: 4, padding: '2px 6px' }}>PRO</span>
                  )}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
                  {group.map(t => (
                    <Link key={t.slug} href={`/tutorial/${t.slug}`} style={{
                      display: 'flex', flexDirection: 'column', gap: 6, padding: '16px 16px 18px', borderRadius: 12,
                      background: 'var(--bg-card)', border: '1px solid var(--border)', textDecoration: 'none',
                    }}>
                      <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.3 }}>{t.title}</span>
                      <span style={{ fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.5 }}>{t.tagline}</span>
                    </Link>
                  ))}
                </div>
              </section>
            )
          })
        )}
      </main>
    </div>
  )
}
