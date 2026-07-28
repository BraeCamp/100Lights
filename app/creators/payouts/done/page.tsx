import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = { title: 'Payout setup — 100Lights', robots: { index: false, follow: false } }

export default function PayoutsDonePage() {
  return (
    <div style={{ maxWidth: 520, margin: '0 auto', padding: '64px 22px', textAlign: 'center' }}>
      <div style={{ fontSize: 34, marginBottom: 12 }}>🎉</div>
      <h1 style={{ fontSize: 26, fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 10px', letterSpacing: '-0.02em' }}>You&apos;re set to get paid</h1>
      <p style={{ fontSize: 15, color: 'var(--text-secondary)', lineHeight: 1.6, margin: '0 0 22px' }}>
        Thanks for connecting your payout account. Once Stripe finishes verifying your details, your commissions will deposit automatically — nothing more for you to do.
      </p>
      <Link href="/creators" style={{ fontSize: 14, fontWeight: 700, color: 'var(--accent-light)', textDecoration: 'none' }}>Back to the creator program →</Link>
    </div>
  )
}
