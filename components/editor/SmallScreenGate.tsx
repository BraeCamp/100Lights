'use client'

// The studio is a desktop tool — on a phone it's a wall of tiny controls.
// Under 760px we say so honestly, point back to the parts of the product
// that DO work on a phone, and still let determined users through.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { MonitorSmartphone } from 'lucide-react'

const DISMISS_KEY = '100lights-small-screen-ok'

export function SmallScreenGate() {
  const [small, setSmall] = useState(false)
  const [dismissed, setDismissed] = useState(true)  // assume fine until measured
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const check = () => setSmall(window.innerWidth < 760)
    check()
    setDismissed(sessionStorage.getItem(DISMISS_KEY) === '1')
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  if (!small || dismissed) return null

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2200)
    } catch { /* clipboard blocked — the other options still work */ }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 4000, background: 'var(--bg-base)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: 28, textAlign: 'center', gap: 14,
    }}>
      <MonitorSmartphone size={34} color="#a78bfa" />
      <h1 style={{ fontSize: 19, fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>The studio wants a bigger screen</h1>
      <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.6, maxWidth: 340 }}>
        Editing works best on a laptop or desktop browser. Save the link to pick up
        on a computer — or on your phone, browse and listen to everything the
        community has shared.
      </p>
      <button onClick={copyLink} style={{
        marginTop: 6, padding: '11px 26px', borderRadius: 999, background: 'var(--accent, #8b5cf6)',
        color: '#fff', fontSize: 13, fontWeight: 700, border: 'none', cursor: 'pointer',
      }}>{copied ? 'Link copied ✓' : 'Copy the link for your computer'}</button>
      <Link href="/community" style={{
        padding: '10px 24px', borderRadius: 999, background: 'transparent',
        color: 'var(--text-primary)', fontSize: 13, fontWeight: 700, textDecoration: 'none',
        border: '1px solid var(--border)',
      }}>Browse the Community →</Link>
      <button
        onClick={() => { sessionStorage.setItem(DISMISS_KEY, '1'); setDismissed(true) }}
        style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 11.5, cursor: 'pointer', textDecoration: 'underline' }}
      >Continue to the studio anyway</button>
    </div>
  )
}
