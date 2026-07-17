import Link from 'next/link'
import { UserButton } from '@clerk/nextjs'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Community — Free Sounds, Samples & Chord Recipes',
  description: 'Browse and play free samples, chord progressions, presets, and full songs shared by 100Lights producers. Listen in the browser, no account needed — import anything into your own project with one click.',
  alternates: { canonical: 'https://100lights.com/community' },
  openGraph: {
    title: '100Lights Community — Free Sounds & Chord Recipes',
    description: 'Free samples, chord progressions, presets, and songs from 100Lights producers. Listen instantly, import with one click.',
    url: 'https://100lights.com/community',
    type: 'website',
    siteName: '100Lights',
  },
}

// The community feed lives outside the (app) group on purpose: it's a public
// square, not a workspace, so it gets its own minimal chrome instead of the
// project sidebar.
export default function CommunityLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', background: 'var(--bg-base, #0f0f11)' }}>
      <header style={{
        position: 'sticky', top: 0, zIndex: 50, display: 'flex', alignItems: 'center', gap: 14,
        padding: '0 18px', height: 52, flexShrink: 0,
        background: 'rgba(15,15,17,0.86)', backdropFilter: 'blur(10px)',
        borderBottom: '1px solid var(--border, #26262b)',
      }}>
        <Link href="/dashboard" style={{ display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none' }}>
          <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary, #f1f0ff)', letterSpacing: '-0.01em' }}>100Lights</span>
          <span style={{ fontSize: 10, fontWeight: 700, color: '#a78bfa', background: 'rgba(124,58,237,0.16)', border: '1px solid rgba(167,139,250,0.35)', borderRadius: 999, padding: '2px 9px', letterSpacing: '0.05em', textTransform: 'uppercase' }}>Community</span>
        </Link>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 14 }}>
          <Link href="/dashboard" style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted, #a3a2b5)', textDecoration: 'none' }}>
            Open Studio →
          </Link>
          <UserButton />
        </div>
      </header>
      <main id="main" style={{ flex: 1, minHeight: 0 }}>{children}</main>
    </div>
  )
}
