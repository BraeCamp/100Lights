import type { Metadata } from 'next'
import { affiliateTaxContext, TAX_CLASSES } from '@/lib/affiliates'
import TaxForm from './TaxForm'
import ConnectPayout from './ConnectPayout'

export const runtime = 'nodejs'
export const metadata: Metadata = { title: 'Your payout & tax details — 100Lights', robots: { index: false, follow: false } }

export default async function TaxDetailsPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const ctx = await affiliateTaxContext(token)

  return (
    <div style={{ maxWidth: 620, margin: '0 auto', padding: '48px 22px 90px' }}>
      {!ctx ? (
        <div style={{ textAlign: 'center', padding: '48px 20px', color: 'var(--text-secondary)' }}>
          <div style={{ fontSize: 30, marginBottom: 10 }}>🔗</div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 8px' }}>This link isn&apos;t valid</h1>
          <p style={{ fontSize: 14, margin: 0 }}>Double-check the link from your welcome email, or ask us to resend it.</p>
        </div>
      ) : (
        <>
          <header style={{ marginBottom: 26 }}>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--accent-light)' }}>100Lights · Affiliate</span>
            <h1 style={{ fontSize: 'clamp(26px, 5vw, 34px)', fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em', margin: '10px 0 12px', lineHeight: 1.1 }}>
              Your payout &amp; tax details
            </h1>
            <p style={{ fontSize: 15.5, color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0 }}>
              Hi {ctx.name} — we need this on file before we can send your commission. It&apos;s the same info a W-9 asks for, so year-end 1099s are handled without chasing you.
            </p>
          </header>
          <TaxForm token={token} classes={TAX_CLASSES} storeTin={ctx.storeTin} existing={ctx.existing} />
          <ConnectPayout token={token} connectReady={ctx.connectReady} connectStarted={ctx.connectStarted} />
        </>
      )}
    </div>
  )
}
