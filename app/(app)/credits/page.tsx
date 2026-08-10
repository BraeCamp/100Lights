'use client'

// AI-credits page — balance + tier/top-up purchase. Signed-in (checkout needs auth). The credit tier
// isn't stored distinctly (any paid sub is "Pro" for features), so we infer the current tier from the
// monthly grant matching a tier's allotment — good enough to highlight "Current plan".
import { useEffect, useState } from 'react'
import { Zap } from 'lucide-react'
import CreditsPricing from '@/components/CreditsPricing'
import { CREDIT_TIERS, type CreditTier } from '@/lib/credit-tiers'

export default function CreditsPage() {
  const [info, setInfo] = useState<{ balance: number; monthlyGrant: number } | null>(null)
  useEffect(() => {
    fetch('/api/credits').then(r => (r.ok ? r.json() : null)).then(setInfo).catch(() => {})
  }, [])

  const currentTier = info
    ? (Object.keys(CREDIT_TIERS) as CreditTier[]).find(t => t !== 'free' && CREDIT_TIERS[t].monthlyCredits === info.monthlyGrant)
    : undefined

  return (
    <main style={{ maxWidth: 980, margin: '0 auto', padding: '40px 20px 64px' }}>
      <header style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 28, fontWeight: 850, color: 'var(--text-primary)', margin: 0 }}>AI Credits</h1>
        <p style={{ fontSize: 14.5, color: 'var(--text-secondary)', margin: '8px 0 0', maxWidth: 640, lineHeight: 1.55 }}>
          Credits power the AI features across every 100Lights app — music generation, stem separation, sheet-music vision.
          Everything non-AI stays free, and our hybrid tools (like chord transcription) run locally at no cost.
        </p>
        {info && (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginTop: 16, padding: '8px 14px', borderRadius: 999, background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
            <Zap size={15} style={{ color: 'var(--accent)' }} />
            <span style={{ fontSize: 13.5, fontWeight: 750, color: 'var(--text-primary)' }}>{info.balance.toLocaleString('en-US')}</span>
            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>credits available</span>
          </div>
        )}
      </header>
      <CreditsPricing currentTier={currentTier} />
    </main>
  )
}
