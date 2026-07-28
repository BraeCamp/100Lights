import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Payout setup — 100Lights', robots: { index: false, follow: false } }

export default function PayoutsRefreshPage() {
  return (
    <div style={{ maxWidth: 520, margin: '0 auto', padding: '64px 22px', textAlign: 'center' }}>
      <div style={{ fontSize: 30, marginBottom: 12 }}>🔗</div>
      <h1 style={{ fontSize: 24, fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 10px', letterSpacing: '-0.02em' }}>Let&apos;s pick that back up</h1>
      <p style={{ fontSize: 15, color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0 }}>
        Your setup link expired before you finished. Open the <strong>&ldquo;Set up direct deposit&rdquo;</strong> button on your tax-details page again (the link from your welcome email) to continue.
      </p>
    </div>
  )
}
