'use client'

import { useEffect, useState } from 'react'
import { X, Gift } from 'lucide-react'
import RedeemCode from '@/components/RedeemCode'

const DISMISS_KEY = 'starter-code-dismissed'

// Shown on the dashboard (the post-signup landing) to users who are on the
// free plan and have never redeemed a starter code. Dismissible, and hides
// itself the moment a code is redeemed.
export default function StarterCodeBanner() {
  const [show, setShow] = useState(false)

  useEffect(() => {
    if (typeof window !== 'undefined' && localStorage.getItem(DISMISS_KEY)) return
    let alive = true
    fetch('/api/codes/redeem')
      .then(r => (r.ok ? r.json() : null))
      .then((d: { usedStarter?: boolean; plan?: string } | null) => {
        if (alive && d && !d.usedStarter && d.plan !== 'pro') setShow(true)
      })
      .catch(() => {})
    return () => { alive = false }
  }, [])

  function dismiss() {
    setShow(false)
    try { localStorage.setItem(DISMISS_KEY, '1') } catch { /* ignore */ }
  }

  if (!show) return null

  return (
    <div style={{
      position: 'relative', marginBottom: 28, padding: '18px 20px', borderRadius: 14,
      background: 'linear-gradient(135deg, rgba(124,58,237,0.12), rgba(52,211,153,0.08))',
      border: '1px solid rgba(139,92,246,0.28)',
    }}>
      <button onClick={dismiss} aria-label="Dismiss" style={{
        position: 'absolute', top: 12, right: 12, background: 'none', border: 'none',
        cursor: 'pointer', color: 'var(--text-muted)', padding: 2,
      }}><X size={16} /></button>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 4 }}>
        <Gift size={16} color="var(--accent-light)" />
        <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>Have a starter code?</p>
      </div>
      <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12, maxWidth: 520 }}>
        Redeem it for free Pro time — more storage, unlimited projects, and every module unlocked.
        You can only use one starter code, so make it count.
      </p>
      <div style={{ maxWidth: 440 }}>
        <RedeemCode variant="starter" compact onRedeemed={() => setTimeout(dismiss, 2500)} />
      </div>
    </div>
  )
}
