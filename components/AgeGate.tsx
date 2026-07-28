'use client'

import { useEffect, useState } from 'react'
import { useAuth, useClerk } from '@clerk/nextjs'

// App-wide 13+ gate. For a signed-in user who hasn't confirmed their age, shows
// a blocking overlay asking for their birth date. Under-13 → blocked + signed
// out. Reads window/Clerk state only; guests and confirmed users see nothing.

type Phase = 'idle' | 'ask' | 'blocked'

export default function AgeGate() {
  const { isLoaded, isSignedIn } = useAuth()
  const { signOut } = useClerk()
  const [phase, setPhase] = useState<Phase>('idle')
  const [birthdate, setBirthdate] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!isLoaded || !isSignedIn) { setPhase('idle'); return }
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/account/age')
        if (!res.ok || cancelled) return
        const data = await res.json() as { confirmed: boolean; blocked: boolean }
        if (cancelled) return
        if (data.blocked) setPhase('blocked')
        else if (!data.confirmed) setPhase('ask')
        else setPhase('idle')
      } catch { /* leave idle — never block the app on a fetch error */ }
    })()
    return () => { cancelled = true }
  }, [isLoaded, isSignedIn])

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setSubmitting(true); setErr(null)
    try {
      const res = await fetch('/api/account/age', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ birthdate }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? 'Please try again.')
      if (data.blocked) setPhase('blocked')
      else setPhase('idle')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Please try again.'); setSubmitting(false)
    }
  }

  if (phase === 'idle') return null

  return (
    <div role="dialog" aria-modal="true" style={{
      position: 'fixed', inset: 0, zIndex: 100000, display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 20, background: 'rgba(8,8,14,0.72)', backdropFilter: 'blur(6px)',
    }}>
      <div style={{
        width: '100%', maxWidth: 400, borderRadius: 16, padding: 28,
        background: 'var(--bg-card, #181828)', border: '1px solid var(--border, #252540)', boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
      }}>
        {phase === 'blocked' ? (
          <>
            <div style={{ fontSize: 30, marginBottom: 12 }}>🔒</div>
            <h2 style={{ fontSize: 19, fontWeight: 800, color: 'var(--text-primary, #f0effe)', margin: '0 0 8px' }}>You must be 13 or older</h2>
            <p style={{ fontSize: 14, color: 'var(--text-secondary, #b8b3ca)', lineHeight: 1.6, margin: '0 0 20px' }}>
              100Lights isn’t available to children under 13. Thanks for your interest — come back when you’re old enough to create.
            </p>
            <button onClick={() => signOut({ redirectUrl: '/' })} style={{
              width: '100%', padding: '11px 16px', borderRadius: 10, fontSize: 14, fontWeight: 700, border: 'none',
              background: 'var(--accent, #7c3aed)', color: '#fff', cursor: 'pointer',
            }}>Sign out</button>
          </>
        ) : (
          <form onSubmit={submit}>
            <h2 style={{ fontSize: 19, fontWeight: 800, color: 'var(--text-primary, #f0effe)', margin: '0 0 8px' }}>One quick thing</h2>
            <p style={{ fontSize: 14, color: 'var(--text-secondary, #b8b3ca)', lineHeight: 1.6, margin: '0 0 18px' }}>
              Confirm your date of birth to continue. 100Lights is for creators 13 and up.
            </p>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary, #b8b3ca)', display: 'block', marginBottom: 6 }}>Date of birth</label>
            <input type="date" required value={birthdate} onChange={e => setBirthdate(e.target.value)} max="2030-12-31" style={{
              width: '100%', padding: '11px 13px', borderRadius: 10, fontSize: 14, marginBottom: 14,
              border: '1px solid var(--border, #252540)', background: 'var(--bg-surface, #131320)', color: 'var(--text-primary, #f0effe)', outline: 'none',
            }} />
            {err && <p style={{ fontSize: 13, color: '#f87171', margin: '0 0 12px' }}>{err}</p>}
            <button type="submit" disabled={submitting || !birthdate} style={{
              width: '100%', padding: '11px 16px', borderRadius: 10, fontSize: 14, fontWeight: 700, border: 'none',
              background: 'var(--accent, #7c3aed)', color: '#fff', cursor: submitting ? 'default' : 'pointer', opacity: (submitting || !birthdate) ? 0.6 : 1,
            }}>{submitting ? 'Confirming…' : 'Continue'}</button>
          </form>
        )}
      </div>
    </div>
  )
}
