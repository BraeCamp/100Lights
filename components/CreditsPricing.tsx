'use client'

// AI-credits purchase UI — tier subscriptions + one-time top-ups. Posts to /api/credits/checkout
// (same fetch→redirect pattern as the Pro upgrade in settings) and reads the client-safe tier config
// from lib/credit-tiers.ts. Credits are AI-only and shared across every 100Lights app; all non-AI
// editing stays free, so this page only ever sells the AI headroom.
import { useState } from 'react'
import { Check, Zap } from 'lucide-react'
import { CREDIT_TIERS, CREDIT_TOPUPS, type CreditTier } from '@/lib/credit-tiers'

const ORDER: CreditTier[] = ['free', 'starter', 'creator', 'pro']
const RECOMMENDED: CreditTier = 'creator'
const BLURB: Record<CreditTier, string> = {
  free:    'Everything non-AI, unlimited. A little AI to try.',
  starter: 'Pro features + light AI use.',
  creator: 'Best value for regular AI use.',
  pro:     'For heavy, everyday AI workflows.',
}
const PERKS: Record<CreditTier, string[]> = {
  free:    ['Unlimited non-AI editing & tools', 'Local transcription (chords resolved free)'],
  starter: ['Everything in Free', 'All Pro features unlocked'],
  creator: ['Everything in Spark', 'Best Lumens-per-dollar'],
  pro:     ['Everything in Creator', 'Highest monthly credit grant'],
}
const fmt = (n: number) => n.toLocaleString('en-US')

export default function CreditsPricing({ currentTier }: { currentTier?: CreditTier }) {
  const [loading, setLoading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const go = async (body: { tier?: CreditTier; topupCredits?: number }, key: string) => {
    setLoading(key); setError(null)
    try {
      const res = await fetch('/api/credits/checkout', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.url) throw new Error(data.error || 'Could not start checkout. Try again.')
      window.location.href = data.url
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.'); setLoading(null)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
      {error && (
        <div style={{ padding: '10px 14px', borderRadius: 10, fontSize: 13, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.35)', color: '#ef4444' }}>
          {error}
        </div>
      )}

      {/* Tiers */}
      <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))' }}>
        {ORDER.map(tier => {
          const t = CREDIT_TIERS[tier]
          const isCurrent = currentTier === tier
          const isFree = tier === 'free'
          const isRec = tier === RECOMMENDED
          return (
            <div
              key={tier}
              style={{
                display: 'flex', flexDirection: 'column', gap: 12, padding: 20, borderRadius: 16,
                background: isRec ? 'linear-gradient(160deg, rgba(124,58,237,0.12), rgba(59,130,246,0.06))' : 'var(--bg-card)',
                border: `1px solid ${isRec ? 'rgba(139,92,246,0.5)' : 'var(--border)'}`,
                position: 'relative',
              }}
            >
              {isRec && (
                <span style={{ position: 'absolute', top: -10, left: 16, fontSize: 10.5, fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase', padding: '3px 8px', borderRadius: 6, background: 'var(--accent)', color: '#fff' }}>
                  Best value
                </span>
              )}
              <div>
                <p style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>{t.label}</p>
                <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', margin: '4px 0 0', minHeight: 34 }}>{BLURB[tier]}</p>
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                <span style={{ fontSize: 30, fontWeight: 850, color: 'var(--text-primary)' }}>${t.price}</span>
                {!isFree && <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>/mo</span>}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700, color: 'var(--accent-light, var(--accent))' }}>
                <Zap size={14} /> {fmt(t.monthlyCredits)} Lumens / mo
              </div>
              <ul style={{ listStyle: 'none', margin: '2px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {PERKS[tier].map(p => (
                  <li key={p} style={{ display: 'flex', gap: 7, fontSize: 12.5, color: 'var(--text-secondary)' }}>
                    <Check size={15} style={{ flexShrink: 0, color: 'var(--accent)', marginTop: 1 }} /> {p}
                  </li>
                ))}
              </ul>
              <div style={{ flex: 1 }} />
              {isFree ? (
                <div style={{ textAlign: 'center', padding: '9px 0', fontSize: 12.5, fontWeight: 700, color: 'var(--text-muted)' }}>
                  {isCurrent ? 'Your plan' : 'Included'}
                </div>
              ) : (
                <button
                  onClick={() => go({ tier }, `tier:${tier}`)}
                  disabled={isCurrent || loading !== null}
                  style={{
                    padding: '10px 0', borderRadius: 10, fontSize: 13, fontWeight: 750, cursor: isCurrent ? 'default' : 'pointer',
                    border: 'none', background: isCurrent ? 'var(--bg-surface)' : 'var(--accent)', color: isCurrent ? 'var(--text-muted)' : '#fff',
                    opacity: loading && loading !== `tier:${tier}` ? 0.6 : 1,
                  }}
                >
                  {isCurrent ? 'Current plan' : loading === `tier:${tier}` ? 'Starting…' : `Get ${t.label}`}
                </button>
              )}
            </div>
          )
        })}
      </div>

      {/* One-time top-ups */}
      <div style={{ padding: 20, borderRadius: 16, background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
        <p style={{ fontSize: 14, fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>Need a one-time boost?</p>
        <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', margin: '4px 0 14px' }}>
          Buy Lumens without subscribing. They never expire and work across every app.
        </p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {CREDIT_TOPUPS.map(tp => (
            <button
              key={tp.credits}
              onClick={() => go({ topupCredits: tp.credits }, `topup:${tp.credits}`)}
              disabled={loading !== null}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2, padding: '10px 16px', borderRadius: 12,
                border: '1px solid var(--border)', background: 'var(--bg-surface)', cursor: 'pointer',
                opacity: loading && loading !== `topup:${tp.credits}` ? 0.6 : 1,
              }}
            >
              <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)' }}>${tp.usd}</span>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                {loading === `topup:${tp.credits}` ? 'Starting…' : `${fmt(tp.credits)} Lumens`}
              </span>
            </button>
          ))}
        </div>
      </div>

      <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0, textAlign: 'center' }}>
        Lumens are used only for AI features and are shared across every 100Lights app. All non-AI editing, playback, and export are always free.
      </p>
    </div>
  )
}
