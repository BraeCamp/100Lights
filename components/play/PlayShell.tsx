'use client'

// Full-screen, phone-first chrome for a /play experience — opened from a bio
// link, so it fills the viewport, brands itself, and keeps a persistent
// "make your own →" CTA in view. The experience component slots into the middle.

import { useEffect, useState, type ComponentType } from 'react'
import Link from 'next/link'
import { LogoMark } from '@/components/Logo'
import { playBySlug, playCtaHref } from '@/lib/play-experiences'

// Takes just the slug (a serialisable prop) and resolves the experience —
// including its lazy loader — on the client, since a function can't cross the
// Server→Client boundary.
export default function PlayShell({ slug }: { slug: string }) {
  const experience = playBySlug(slug)
  const [Comp, setComp] = useState<ComponentType<Record<string, unknown>> | null>(null)
  useEffect(() => {
    if (!experience) return
    let ok = true
    experience.load().then(m => { if (ok) setComp(() => m.default) }).catch(() => { /* keep loading state */ })
    return () => { ok = false }
  }, [experience])

  if (!experience) return null
  const cta = playCtaHref(experience)

  return (
    <div style={{
      minHeight: '100dvh', display: 'flex', flexDirection: 'column',
      background: 'radial-gradient(120% 90% at 50% 0%, #1b1430 0%, #0c0a14 60%, #08070d 100%)',
      color: '#f4f2f7',
    }}>
      {/* Top brand bar */}
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', flexShrink: 0 }}>
        <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none', color: '#f4f2f7' }}>
          <LogoMark size={22} />
          <span style={{ fontSize: 14, fontWeight: 800, letterSpacing: '-0.01em' }}>100Lights</span>
        </Link>
        <span style={{ fontSize: 10.5, color: '#a78bfa', fontWeight: 700, letterSpacing: '0.04em' }}>free · in your browser</span>
      </header>

      {/* Hook */}
      <div style={{ padding: '4px 20px 10px', textAlign: 'center', flexShrink: 0 }}>
        <div style={{ fontSize: 34, lineHeight: 1, marginBottom: 8 }}>{experience.emoji}</div>
        <h1 style={{ fontSize: 24, fontWeight: 850, lineHeight: 1.12, margin: '0 0 8px', textWrap: 'balance', letterSpacing: '-0.02em' }}>{experience.title}</h1>
        <p style={{ fontSize: 13.5, color: '#b8b3c6', lineHeight: 1.5, margin: 0, maxWidth: 460, marginInline: 'auto' }}>{experience.tagline}</p>
      </div>

      {/* The playable experience */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '10px 16px 4px', minHeight: 0 }}>
        {Comp
          ? <Comp cta={cta} />
          : <div style={{ textAlign: 'center', color: '#8b8397', fontSize: 13, padding: 40 }}>Loading…</div>}
      </main>

      {/* Persistent CTA */}
      <footer style={{ padding: '12px 16px calc(16px + env(safe-area-inset-bottom))', flexShrink: 0 }}>
        <Link href={cta} style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          width: '100%', boxSizing: 'border-box', padding: '15px 18px', borderRadius: 14,
          background: 'linear-gradient(135deg, #8b5cf6, #6d28d9)', color: '#fff',
          fontSize: 16, fontWeight: 800, textDecoration: 'none', boxShadow: '0 8px 24px rgba(124,58,237,0.4)',
        }}>
          {experience.ctaLabel}
        </Link>
        <p style={{ textAlign: 'center', fontSize: 10.5, color: '#6f6982', margin: '9px 0 0' }}>
          No download. No account. Start making music in a tab.
        </p>
      </footer>
    </div>
  )
}
