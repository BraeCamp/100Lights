import type { Metadata } from 'next'
import SiteHeader from '@/components/site/SiteHeader'
import SiteFooter from '@/components/site/SiteFooter'
import PricingSection from '@/components/PricingSection'
import StoreModules from '@/components/site/StoreModules'
import CreditsPricing from '@/components/CreditsPricing'
import { CREDITS_ENABLED } from '@/lib/credits'

export const metadata: Metadata = {
  title: 'Store — Membership, Studios & Lumens',
  description: 'Everything you can buy on 100Lights in one place: the Pro membership, one-time studio licenses, and Lumens — the AI credits that work across every app.',
  alternates: { canonical: 'https://100lights.com/store' },
}

function SectionHeading({ title, sub }: { title: string; sub: string }) {
  return (
    <header style={{ margin: '0 0 20px', textAlign: 'center' }}>
      <h2 style={{ fontSize: 24, fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 8px', letterSpacing: '-0.01em' }}>{title}</h2>
      <p style={{ fontSize: 14, color: 'var(--text-secondary)', margin: '0 auto', maxWidth: '56ch', lineHeight: 1.6 }}>{sub}</p>
    </header>
  )
}

export default function StorePage() {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)', display: 'flex', flexDirection: 'column' }}>
      <SiteHeader />
      <main id="main" style={{ flex: 1 }}>
        <header className="max-w-4xl mx-auto px-6 pt-14 pb-4 text-center">
          <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--accent)', margin: '0 0 10px' }}>
            Store
          </p>
          <h1 style={{ fontSize: 36, fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 12px', letterSpacing: '-0.02em' }}>
            One account, your choice of how to pay
          </h1>
          <p style={{ fontSize: 15.5, color: 'var(--text-secondary)', lineHeight: 1.65, margin: '0 auto', maxWidth: '58ch' }}>
            The music studio is free forever. When you want more, pick the shape that fits:
            a membership that includes everything, a one-time license for a single studio,
            or Lumens for the AI features — no subscription required.
          </p>
        </header>

        {/* ── Membership ── */}
        <PricingSection />

        {/* ── Studio licenses ── */}
        <section aria-labelledby="licenses-heading" className="max-w-4xl mx-auto px-6 pb-16 sm:pb-24">
          <SectionHeading
            title="Own a studio outright"
            sub="Not a subscription person? Buy a studio once and it's yours for good — every future update included."
          />
          <StoreModules />
        </section>

        {/* ── Lumens ── */}
        <section aria-labelledby="lumens-heading" className="max-w-4xl mx-auto px-6 pb-16 sm:pb-24">
          <SectionHeading
            title="Lumens — AI, pay as you glow"
            sub="Lumens are the shared AI credits behind generation, stem separation, and sheet-music vision, across every 100Lights app. Everything non-AI stays free."
          />
          {CREDITS_ENABLED ? (
            <CreditsPricing />
          ) : (
            <div style={{
              padding: '36px 24px', borderRadius: 16, textAlign: 'center',
              border: '1px dashed var(--border)', background: 'var(--bg-card)',
            }}>
              <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 6px' }}>Coming soon</p>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '0 auto', maxWidth: '46ch', lineHeight: 1.6 }}>
                Lumens plans (Spark, Glow, Beam) and one-time top-ups are almost ready.
                Until then, the AI features run on the free monthly allowance.
              </p>
            </div>
          )}
        </section>

        {/* ── On the horizon ── */}
        <section className="max-w-4xl mx-auto px-6 pb-16 sm:pb-24">
          <div style={{
            display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'center',
            padding: '18px 20px', borderRadius: 14, border: '1px solid var(--border)', background: 'var(--bg-card)',
          }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              Next up in the store: creator sound packs and per-app unlocks — sell what you make, own only what you use.
            </span>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  )
}
