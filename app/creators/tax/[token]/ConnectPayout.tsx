'use client'

import { useState } from 'react'

export default function ConnectPayout({ token, connectReady, connectStarted }: {
  token: string; connectReady: boolean; connectStarted: boolean
}) {
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function start() {
    setLoading(true); setErr(null)
    try {
      const res = await fetch(`/api/creators/tax/${token}/connect`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.url) throw new Error(data.error ?? 'Could not start setup — try again.')
      window.location.href = data.url as string
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Something went wrong.'); setLoading(false)
    }
  }

  return (
    <div style={{ marginTop: 34, paddingTop: 26, borderTop: '1px solid var(--border, #252540)' }}>
      <h2 style={{ fontSize: 18, fontWeight: 750, color: 'var(--text-primary)', margin: '0 0 6px' }}>Get paid by direct deposit</h2>
      {connectReady ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: '#34d399', fontWeight: 600 }}>
          <span>✓</span> Your payout account is connected — commissions land in your bank automatically.
        </div>
      ) : (
        <>
          <p style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.6, margin: '0 0 14px' }}>
            Connect a bank account through Stripe (our payments provider) so we can pay your commission automatically — no invoices, no waiting. Stripe handles your details securely; we never see your bank info.
          </p>
          <button onClick={start} disabled={loading} style={{
            padding: '11px 22px', borderRadius: 11, fontSize: 14.5, fontWeight: 700, border: 'none',
            background: 'var(--accent, #7c3aed)', color: '#fff', cursor: loading ? 'default' : 'pointer', opacity: loading ? 0.65 : 1,
          }}>
            {loading ? 'Opening…' : connectStarted ? 'Finish payout setup →' : 'Set up direct deposit →'}
          </button>
          {err && <p style={{ fontSize: 13, color: '#f87171', margin: '10px 0 0' }}>{err}</p>}
        </>
      )}
    </div>
  )
}
