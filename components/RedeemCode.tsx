'use client'

import { useState } from 'react'
import { Gift, Check } from 'lucide-react'

interface Props {
  /** Tailors the copy; the endpoint enforces rules by the code's real kind. */
  variant?: 'promo' | 'starter'
  /** Called after a successful redemption (e.g. to refresh billing state). */
  onRedeemed?: (result: { grantDays: number; until: string; kind: string }) => void
  compact?: boolean
}

export default function RedeemCode({ variant = 'promo', onRedeemed, compact }: Props) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState<{ grantDays: number; until: string } | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!code.trim() || busy) return
    setBusy(true); setError(''); setDone(null)
    try {
      const res = await fetch('/api/codes/redeem', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim() }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.ok) throw new Error(data.error ?? 'Could not redeem that code.')
      setDone({ grantDays: data.grantDays, until: data.until })
      setCode('')
      onRedeemed?.({ grantDays: data.grantDays, until: data.until, kind: data.kind })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not redeem that code.')
    } finally { setBusy(false) }
  }

  if (done) {
    const until = new Date(done.until).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    return (
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderRadius: 10,
        background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.3)',
      }}>
        <Check size={18} color="#34d399" />
        <div>
          <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
            {done.grantDays} days of Pro unlocked 🎉
          </p>
          <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Free access through {until}.</p>
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 180 }}>
          <Gift size={15} style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            value={code}
            onChange={e => { setCode(e.target.value.toUpperCase()); setError('') }}
            placeholder={variant === 'starter' ? 'Enter your starter code' : 'Enter a code'}
            aria-label={variant === 'starter' ? 'Starter code' : 'Redemption code'}
            style={{
              width: '100%', padding: '9px 12px 9px 34px', borderRadius: 9, fontSize: 13,
              fontFamily: 'monospace', letterSpacing: '0.04em', textTransform: 'uppercase',
              border: `1px solid ${error ? 'rgba(239,68,68,0.5)' : 'var(--border)'}`,
              background: 'var(--bg-base)', color: 'var(--text-primary)', outline: 'none',
            }}
          />
        </div>
        <button type="submit" disabled={busy || !code.trim()} style={{
          padding: '9px 18px', borderRadius: 9, fontSize: 13, fontWeight: 700,
          cursor: busy || !code.trim() ? 'default' : 'pointer',
          background: 'var(--accent)', color: '#fff', border: 'none',
          opacity: busy || !code.trim() ? 0.55 : 1, whiteSpace: 'nowrap',
        }}>
          {busy ? 'Redeeming…' : 'Redeem'}
        </button>
      </div>
      {error && <p style={{ fontSize: 12, color: '#ef4444' }}>{error}</p>}
      {!error && !compact && (
        <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          {variant === 'starter'
            ? 'A starter code gives you free Pro time. You can only use one, ever.'
            : 'Have a code? Redeem it for free Pro time. Promo codes stack.'}
        </p>
      )}
    </form>
  )
}
