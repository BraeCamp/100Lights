import type { Metadata } from 'next'
import Link from 'next/link'
import { PLAY_EXPERIENCES } from '@/lib/play-experiences'

export const metadata: Metadata = {
  title: 'Play — quick music games — 100Lights',
  description: 'Fast, free, no-account music games in your browser. Guess the genre, hear the difference, build a beat — then make your own.',
  alternates: { canonical: 'https://100lights.com/play' },
  openGraph: { title: 'Play — quick music games', description: 'Fast, free, no-account music games in your browser.', url: 'https://100lights.com/play', type: 'website', siteName: '100Lights' },
}

export default function PlayIndex() {
  return (
    <div style={{ minHeight: '100dvh', background: 'radial-gradient(120% 90% at 50% 0%, #1b1430 0%, #0c0a14 60%, #08070d 100%)', color: '#f4f2f7', padding: '40px 20px 60px' }}>
      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        <h1 style={{ fontSize: 30, fontWeight: 850, letterSpacing: '-0.02em', margin: '0 0 8px', textAlign: 'center' }}>Play</h1>
        <p style={{ fontSize: 14, color: '#b8b3c6', textAlign: 'center', margin: '0 0 28px', lineHeight: 1.5 }}>
          Tiny music games — free, no account, in your browser.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {PLAY_EXPERIENCES.map(e => (
            <Link key={e.slug} href={`/play/${e.slug}`} style={{
              display: 'flex', alignItems: 'center', gap: 14, textDecoration: 'none', color: '#f4f2f7',
              padding: '16px 18px', borderRadius: 14, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.04)',
            }}>
              <span style={{ fontSize: 30, flexShrink: 0 }}>{e.emoji}</span>
              <span style={{ minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 16, fontWeight: 800, lineHeight: 1.2 }}>{e.title}</span>
                <span style={{ display: 'block', fontSize: 12.5, color: '#8b8397', marginTop: 3, lineHeight: 1.4 }}>{e.tagline}</span>
              </span>
              <span style={{ marginLeft: 'auto', color: '#a78bfa', fontSize: 20, flexShrink: 0 }}>→</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
