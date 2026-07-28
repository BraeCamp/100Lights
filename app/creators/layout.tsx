import Link from 'next/link'
import type { Metadata } from 'next'
import { LogoMark } from '@/components/Logo'

export const metadata: Metadata = {
  title: 'Creator Program — Earn Recurring Commission with 100Lights',
  description: 'Join the 100Lights Founding Affiliate beta: recurring commission on every producer you refer, plus free Pro to hand your own audience. A full DAW in the browser — no download for your fans to try.',
  alternates: { canonical: 'https://100lights.com/creators' },
  openGraph: {
    title: '100Lights Creator Program — Founding Affiliate Beta',
    description: 'Recurring commission for referring producers, plus free Pro to gift your audience. Limited founding seats.',
    url: 'https://100lights.com/creators',
    type: 'website',
    siteName: '100Lights',
  },
}

export default function CreatorsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', background: 'var(--bg-base, #0d0d14)' }}>
      <header style={{
        position: 'sticky', top: 0, zIndex: 50, display: 'flex', alignItems: 'center', gap: 14,
        padding: '0 18px', height: 52, flexShrink: 0,
        background: 'rgba(13,13,20,0.86)', backdropFilter: 'blur(10px)',
        borderBottom: '1px solid var(--border, #252540)',
      }}>
        <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none' }}>
          <LogoMark size={24} />
          <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary, #f0effe)', letterSpacing: '-0.01em' }}>100Lights</span>
          <span style={{ fontSize: 10, fontWeight: 700, color: '#a78bfa', background: 'rgba(124,58,237,0.16)', border: '1px solid rgba(167,139,250,0.35)', borderRadius: 999, padding: '2px 9px', letterSpacing: '0.05em', textTransform: 'uppercase' }}>Creators</span>
        </Link>
        <div style={{ marginLeft: 'auto' }}>
          <Link href="/" style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted, #7d7d9c)', textDecoration: 'none' }}>← Back to 100Lights</Link>
        </div>
      </header>
      <main style={{ flex: 1 }}>{children}</main>
    </div>
  )
}
