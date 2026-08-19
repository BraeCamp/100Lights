import type { Metadata } from 'next'
import Link from 'next/link'
import SiteHeader from '@/components/site/SiteHeader'
import SiteFooter from '@/components/site/SiteFooter'
import { MODULES, APPS, TOOLS, GAMES } from '@/lib/lights-registry'
import { MINI_APPS } from '@/lib/apps-registry'

export const metadata: Metadata = {
  title: '100Lights Apps — Free Browser Music Tools',
  description: 'The 100Lights constellation: full music and video studios plus focused free apps — sing a melody into an instrument, make a beat, design a synth patch, autotune a vocal, and more. In your browser, no download.',
  alternates: { canonical: 'https://100lights.com/apps' },
  openGraph: {
    title: '100Lights Apps',
    description: 'Free, focused browser music tools — voice-to-instrument, beat maker, synthesizer, autotune, and more.',
    url: 'https://100lights.com/apps',
    type: 'website',
    siteName: '100Lights',
  },
}

function SectionHeading({ title, sub }: { title: string; sub: string }) {
  return (
    <header style={{ margin: '0 0 18px' }}>
      <h2 style={{ fontSize: 20, fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 6px', letterSpacing: '-0.01em' }}>{title}</h2>
      <p style={{ fontSize: 13.5, color: 'var(--text-secondary)', margin: 0 }}>{sub}</p>
    </header>
  )
}

export default function AppsIndexPage() {
  const modules = MODULES.filter(m => m.status !== 'hidden')
  const apps = APPS.filter(a => a.status !== 'hidden')
  const describe = (slug: string) => MINI_APPS.find(a => a.slug === slug)?.description

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)', display: 'flex', flexDirection: 'column' }}>
      <SiteHeader />
      <main id="main" className="max-w-5xl mx-auto px-6 py-14 w-full" style={{ flex: 1 }}>
        <header style={{ marginBottom: 40 }}>
          <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--accent)', margin: '0 0 10px' }}>
            The Constellation
          </p>
          <h1 style={{ fontSize: 36, fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 12px', letterSpacing: '-0.02em' }}>
            Apps
          </h1>
          <p style={{ fontSize: 15.5, color: 'var(--text-secondary)', lineHeight: 1.65, margin: 0, maxWidth: '52ch' }}>
            Everything you can open with one 100Lights account — the full studios, plus small
            focused tools that each do a single thing well. Free to open, right in your browser.
          </p>
        </header>

        {/* ── Studios ── */}
        <section aria-label="Studios" style={{ marginBottom: 44 }}>
          <SectionHeading title="Studios" sub="The flagship editors — full creative environments." />
          <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
            {modules.map(m => (
              <Link key={m.slug} href={m.href} style={{
                display: 'flex', flexDirection: 'column', gap: 8, padding: '20px 20px 22px', borderRadius: 14,
                border: `1px solid color-mix(in srgb, ${m.color} 26%, var(--border))`,
                background: `linear-gradient(145deg, color-mix(in srgb, ${m.color} 8%, var(--bg-card)) 0%, var(--bg-card) 60%)`,
                textDecoration: 'none',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span aria-hidden="true" style={{ fontSize: 22 }}>{m.icon}</span>
                  <h3 style={{ fontSize: 19, fontWeight: 800, color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.01em' }}>{m.name}</h3>
                </div>
                <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>{m.tagline}</p>
              </Link>
            ))}
          </div>
        </section>

        {/* ── Apps ── */}
        <section aria-label="Apps" style={{ marginBottom: 44 }}>
          <SectionHeading title="Apps" sub="Focused tools — each one does a single thing well. No account needed." />
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
            {apps.map(app => (
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
                    <span aria-hidden="true" style={{ fontSize: 16 }}>{app.icon}</span>
                    <h3 style={{ fontSize: 17, fontWeight: 750, color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.01em' }}>
                      {app.name}
                    </h3>
                    {app.status === 'beta' && (
                      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--accent-light, var(--accent))', border: '1px solid var(--border)', borderRadius: 999, padding: '2px 7px' }}>
                        Beta
                      </span>
                    )}
                  </div>
                  <p style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.45 }}>
                    {app.tagline}
                  </p>
                  {describe(app.slug) && (
                    <p style={{ fontSize: 12.5, color: 'var(--text-muted, var(--text-secondary))', margin: '2px 0 0', lineHeight: 1.55 }}>
                      {describe(app.slug)}
                    </p>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </section>

        {/* ── Tools & Play ── */}
        <section aria-label="Tools and games">
          <SectionHeading title="Tools & Play" sub="Quick utilities and ear-training games." />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {[...TOOLS, ...GAMES].map(t => (
              <Link key={t.slug} href={t.href} style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px',
                borderRadius: 999, border: '1px solid var(--border)', background: 'var(--bg-card)',
                fontSize: 12.5, fontWeight: 600, color: 'var(--text-secondary)', textDecoration: 'none',
              }}>
                <span aria-hidden="true">{t.icon}</span>
                {t.name}
              </Link>
            ))}
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  )
}
