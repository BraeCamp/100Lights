'use client'
// One home for Lightning Bug admin: Broadcasts (control-plane dashboard), Radio (station editor), and
// Backgrounds (Pexels library). Tab is in the URL (?tab=) so links + refresh keep their place.
import { useEffect, useState } from 'react'
import { Radio, ListMusic, Film } from 'lucide-react'
import PexelsAdmin from './PexelsAdmin'
import RadioAdmin from './radio/RadioAdmin'
import BroadcastsDashboard from './BroadcastsDashboard'

type Tab = 'broadcasts' | 'radio' | 'backgrounds'
const TABS: { id: Tab; label: string; icon: typeof Radio }[] = [
  { id: 'broadcasts', label: 'Broadcasts', icon: Radio },
  { id: 'radio', label: 'Radio (stations)', icon: ListMusic },
  { id: 'backgrounds', label: 'Backgrounds', icon: Film },
]

export default function AdminShell() {
  const [tab, setTab] = useState<Tab>('broadcasts')
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('tab') as Tab | null
    if (t && TABS.some(x => x.id === t)) setTab(t)
  }, [])
  const go = (t: Tab) => { setTab(t); const u = new URL(window.location.href); u.searchParams.set('tab', t); history.replaceState(null, '', u.toString()) }

  return (
    <main style={{ maxWidth: 1000, margin: '0 auto', padding: '24px 18px 60px' }}>
      <h1 style={{ fontSize: 24, fontWeight: 850, color: 'var(--text-primary)', margin: '0 0 12px', display: 'flex', alignItems: 'center', gap: 8 }}><Radio size={22} /> Lightning Bug — Broadcast admin</h1>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', borderBottom: '1px solid var(--border)', marginBottom: 20 }}>
        {TABS.map(t => {
          const on = tab === t.id
          return (
            <button key={t.id} type="button" onClick={() => go(t.id)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 14px', fontSize: 13, fontWeight: 800, cursor: 'pointer', border: 'none', background: 'none', color: on ? 'var(--text-primary)' : 'var(--text-muted)', borderBottom: on ? '2px solid var(--accent)' : '2px solid transparent', marginBottom: -1 }}>
              <t.icon size={15} /> {t.label}
            </button>
          )
        })}
      </div>
      {/* Keep components mounted-per-tab; each fetches its own data. */}
      {tab === 'broadcasts' && <BroadcastsDashboard />}
      {tab === 'radio' && <RadioAdmin />}
      {tab === 'backgrounds' && <PexelsAdmin />}
    </main>
  )
}
