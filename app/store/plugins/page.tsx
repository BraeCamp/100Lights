import type { Metadata } from 'next'
import Link from 'next/link'
import SiteHeader from '@/components/site/SiteHeader'
import SiteFooter from '@/components/site/SiteFooter'
import PluginDemoPlayer from '@/components/site/PluginDemoPlayer'
import { LUZ, formatPrice } from '@/lib/plugins-catalog'

export const metadata: Metadata = {
  title: 'Plugins — Luz for your DAW',
  description:
    'Luz is a hybrid synthesiser that also listens: play it from a keyboard, or plug a guitar or microphone in and it turns what you play into MIDI. Audio Unit, VST3, CLAP and standalone.',
  alternates: { canonical: 'https://100lights.com/store/plugins' },
  openGraph: {
    title: 'Luz — a synthesiser that listens',
    description:
      'Three plug-ins, one engine. Play it, or plug an instrument in and let it turn your playing into notes.',
    url: 'https://100lights.com/store/plugins',
  },
}

const C = {
  card: 'var(--bg-card)',
  border: 'var(--border)',
  text: 'var(--text-primary)',
  sub: 'var(--text-secondary)',
  muted: 'var(--text-muted)',
  accent: 'var(--accent)',
} as const

export default function PluginsPage() {
  const p = LUZ

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)', display: 'flex', flexDirection: 'column' }}>
      <SiteHeader />

      <main id="main" style={{ flex: 1 }}>
        {/* ── Hero ─────────────────────────────────────────────────────── */}
        <header className="max-w-4xl mx-auto px-6 pt-14 pb-6 text-center">
          <p style={{
            fontSize: 12, fontWeight: 700, letterSpacing: '0.14em',
            textTransform: 'uppercase', color: C.accent, margin: '0 0 10px',
          }}>
            Plugins
          </p>
          <h1 style={{
            fontSize: 40, fontWeight: 800, color: C.text,
            margin: '0 0 12px', letterSpacing: '-0.02em',
          }}>
            {p.name} — {p.tagline}
          </h1>
          <p style={{
            fontSize: 16, color: C.sub, lineHeight: 1.65,
            margin: '0 auto', maxWidth: '58ch',
          }}>
            {p.summary}
          </p>

          <div style={{
            display: 'flex', gap: 10, justifyContent: 'center',
            flexWrap: 'wrap', margin: '22px 0 8px',
          }}>
            {p.formats.map(f => (
              <span key={f} style={{
                fontSize: 11, fontWeight: 700, letterSpacing: '0.08em',
                textTransform: 'uppercase', color: C.muted,
                border: `1px solid ${C.border}`, borderRadius: 999, padding: '5px 12px',
              }}>{f}</span>
            ))}
          </div>
        </header>

        {/* ── Buy ──────────────────────────────────────────────────────── */}
        <section className="max-w-4xl mx-auto px-6 pb-14">
          <div style={{
            border: `1px solid ${C.border}`, borderRadius: 16, background: C.card,
            padding: '28px 24px', textAlign: 'center',
          }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 10 }}>
              <span style={{ fontSize: 38, fontWeight: 800, color: C.text, letterSpacing: '-0.02em' }}>
                {formatPrice(p.priceCents, p.currency)}
              </span>
              <span style={{ fontSize: 13, color: C.muted }}>one time, {p.seats} machines</span>
            </div>

            <p style={{ fontSize: 13, color: C.sub, margin: '10px auto 20px', maxWidth: '46ch', lineHeight: 1.6 }}>
              Every future 1.x update included. No subscription.
            </p>

            {p.available ? (
              <a
                href={`/api/checkout/plugin/${p.slug}`}
                style={{
                  display: 'inline-block', padding: '12px 30px', borderRadius: 10,
                  background: C.accent, color: '#111', fontWeight: 700, fontSize: 15,
                  textDecoration: 'none',
                }}
              >
                Buy {p.name}
              </a>
            ) : (
              <div>
                <span style={{
                  display: 'inline-block', padding: '12px 30px', borderRadius: 10,
                  border: `1px dashed ${C.border}`, color: C.muted, fontWeight: 700, fontSize: 15,
                }}>
                  Not on sale yet
                </span>
                <p style={{ fontSize: 12, color: C.muted, margin: '12px auto 0', maxWidth: '44ch', lineHeight: 1.6 }}>
                  The build is finished and signed. Checkout opens once notarisation
                  and the installer are in place.
                </p>
              </div>
            )}

            <p style={{ fontSize: 12.5, color: C.muted, margin: '18px auto 0', maxWidth: '52ch', lineHeight: 1.6 }}>
              <strong style={{ color: C.sub }}>Try it first.</strong> {p.demoTerms}
            </p>
          </div>
        </section>

        {/* ── Hear it ──────────────────────────────────────────────────── */}
        <section className="max-w-4xl mx-auto px-6 pb-16">
          <header style={{ margin: '0 0 18px', textAlign: 'center' }}>
            <h2 style={{ fontSize: 24, fontWeight: 800, color: C.text, margin: '0 0 8px', letterSpacing: '-0.01em' }}>
              Hear it
            </h2>
            <p style={{ fontSize: 14, color: C.sub, margin: '0 auto', maxWidth: '52ch', lineHeight: 1.6 }}>
              Straight out of the factory bank, no mixing, no processing after the plug-in.
            </p>
          </header>
          <PluginDemoPlayer demos={p.demos} />
        </section>

        {/* ── What it does ─────────────────────────────────────────────── */}
        <section className="max-w-4xl mx-auto px-6 pb-16">
          <div style={{
            display: 'grid', gap: 14,
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          }}>
            {p.highlights.map(h => (
              <div key={h.title} style={{
                border: `1px solid ${C.border}`, borderRadius: 14,
                background: C.card, padding: '18px 18px',
              }}>
                <h3 style={{ fontSize: 15, fontWeight: 700, color: C.text, margin: '0 0 7px' }}>
                  {h.title}
                </h3>
                <p style={{ fontSize: 13.5, color: C.sub, margin: 0, lineHeight: 1.6 }}>
                  {h.body}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Requirements ─────────────────────────────────────────────── */}
        <section className="max-w-4xl mx-auto px-6 pb-20">
          <div style={{
            border: `1px solid ${C.border}`, borderRadius: 14,
            background: C.card, padding: '20px 22px',
          }}>
            <h3 style={{ fontSize: 13, fontWeight: 700, color: C.text, margin: '0 0 10px',
                         letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              What you need
            </h3>
            <ul style={{ margin: 0, padding: '0 0 0 18px', color: C.sub, fontSize: 13.5, lineHeight: 1.8 }}>
              {p.requirements.map(r => <li key={r}>{r}</li>)}
            </ul>
            <p style={{ fontSize: 12.5, color: C.muted, margin: '14px 0 0', lineHeight: 1.6 }}>
              Windows is not built yet. If you want it, say so — it moves up the list.
            </p>
          </div>
        </section>

        {/* ── Back to the store ────────────────────────────────────────── */}
        <section className="max-w-4xl mx-auto px-6 pb-20 text-center">
          <Link href="/store" style={{ fontSize: 13, color: C.muted, textDecoration: 'none' }}>
            ← Everything else in the store
          </Link>
        </section>
      </main>

      <SiteFooter />
    </div>
  )
}
