'use client'

// The condensed mobile studio shell. Phase 1 ships the Beat tab; Melody, Sounds,
// and Mix are the next surfaces. Fixed full-screen with a bottom tab bar so it
// feels like an app (and wraps cleanly into a native shell via Capacitor).

import { useState } from 'react'
import Link from 'next/link'
import MobileBeatMaker from './MobileBeatMaker'

const TABS = [
  { id: 'beat', label: 'Beat', icon: '▦', ready: true },
  { id: 'melody', label: 'Melody', icon: '♪', ready: false },
  { id: 'sounds', label: 'Sounds', icon: '≋', ready: false },
  { id: 'mix', label: 'Mix', icon: '⇅', ready: false },
]

export default function MobileStudio() {
  const [tab, setTab] = useState('beat')
  const active = TABS.find(t => t.id === tab)

  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', background: 'var(--bg-base)' }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '11px 16px calc(11px)', borderBottom: '1px solid var(--border)', flexShrink: 0, paddingTop: 'calc(11px + env(safe-area-inset-top))' }}>
        <span style={{ width: 20, height: 20, borderRadius: 6, background: 'var(--accent)', flexShrink: 0 }} />
        <strong style={{ fontSize: 14, color: 'var(--text-primary)' }}>100Lights</strong>
        <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>· {active?.label}</span>
        <Link href="/" style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-muted)', textDecoration: 'none' }}>Full studio ↗</Link>
      </header>

      <main style={{ flex: 1, minHeight: 0 }}>
        {tab === 'beat' ? <MobileBeatMaker /> : (
          <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 13, padding: 24, textAlign: 'center' }}>
            {active?.label} is coming next.
          </div>
        )}
      </main>

      <nav style={{ display: 'flex', borderTop: '1px solid var(--border)', flexShrink: 0, background: 'var(--bg-surface)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => t.ready && setTab(t.id)} disabled={!t.ready} style={{
            flex: 1, padding: '9px 0 11px', background: 'none', border: 'none', cursor: t.ready ? 'pointer' : 'default',
            color: tab === t.id ? 'var(--accent-light)' : 'var(--text-muted)', opacity: t.ready ? 1 : 0.55,
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, fontSize: 10.5, fontWeight: 700,
          }}>
            <span style={{ fontSize: 16 }}>{t.icon}</span>
            {t.label}{!t.ready && <span style={{ fontSize: 8, fontWeight: 600 }}>soon</span>}
          </button>
        ))}
      </nav>
    </div>
  )
}
