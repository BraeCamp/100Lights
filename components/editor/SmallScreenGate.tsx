'use client'

// The studio is a desktop tool — on a phone it's a wall of tiny controls.
// A NEW/blank session on a small screen is auto-sent to the mobile studio (/m)
// so phone visitors land in the touch DAW without touching the URL. A SAVED
// project stays gated (redirecting to /m would drop them into a blank beat and
// lose their project) — there we point back to the parts that work on a phone.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { MonitorSmartphone } from 'lucide-react'

const DISMISS_KEY = '100lights-small-screen-ok'

export function SmallScreenGate() {
  const router = useRouter()
  const pathname = usePathname()
  const [small, setSmall] = useState(false)
  const [dismissed, setDismissed] = useState(true)  // assume fine until measured
  const [copied, setCopied] = useState(false)
  const [redirecting, setRedirecting] = useState(false)

  // A new/blank studio session belongs in the mobile studio; a saved project
  // (/projects/<id>) does not — that one keeps the informational gate.
  const isNewSession = pathname === '/new'

  useEffect(() => {
    const check = () => setSmall(window.innerWidth < 760)
    check()
    setDismissed(sessionStorage.getItem(DISMISS_KEY) === '1')
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  // Auto-route a phone opening a new session into the mobile studio.
  useEffect(() => {
    if (small && isNewSession && !redirecting) {
      setRedirecting(true)
      router.replace('/m')
    }
  }, [small, isNewSession, redirecting, router])

  if (!small) return null

  // New session on a phone → we're bouncing to /m; show a brief holding view.
  if (isNewSession) {
    return (
      <div style={{
        position: 'fixed', inset: 0, zIndex: 4000, background: 'var(--bg-base)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        padding: 28, textAlign: 'center', gap: 14,
      }}>
        <MonitorSmartphone size={34} color="#a78bfa" />
        <p style={{ fontSize: 14, color: 'var(--text-secondary)', margin: 0 }}>Opening the mobile studio…</p>
        <Link href="/m" style={{
          marginTop: 4, padding: '10px 24px', borderRadius: 999, background: 'var(--accent, #8b5cf6)',
          color: '#fff', fontSize: 13.5, fontWeight: 800, textDecoration: 'none',
        }}>Tap if it doesn’t open →</Link>
      </div>
    )
  }

  if (dismissed) return null

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
      <h1 style={{ fontSize: 19, fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>Finish this one on a computer</h1>
      <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.6, maxWidth: 340 }}>
        The full studio is built for a laptop. To keep working on <em>this</em> project,
        open it on a computer — or start a fresh beat right here on your phone.
      </p>
      <Link href="/m" style={{
        marginTop: 6, padding: '12px 28px', borderRadius: 999, background: 'var(--accent, #8b5cf6)',
        color: '#fff', fontSize: 14, fontWeight: 800, textDecoration: 'none',
      }}>🎵 Make a beat here →</Link>
      <button onClick={copyLink} style={{
        padding: '10px 24px', borderRadius: 999, background: 'transparent',
        color: 'var(--text-primary)', fontSize: 13, fontWeight: 700, border: '1px solid var(--border)', cursor: 'pointer',
      }}>{copied ? 'Link copied ✓' : 'Copy the link for desktop'}</button>
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
