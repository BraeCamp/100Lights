'use client'

// Test Recipes — candidate DAW recipes mined from public-domain sheet music. Each is a chord
// progression / bass line / motif extracted as editable MIDI (the sheet itself isn't kept). Review the
// preview, then Integrate (ships it into the Sound Library recipe catalog for everyone) or Delete.
// Admin-only: the API gates on the owner email, so only Brae sees this.

import { useCallback, useEffect, useState } from 'react'
import { RefreshCw, Trash2, CheckCircle2, Undo2, Music } from 'lucide-react'

interface Note { pitch: number; startBeat: number; durationBeats: number; velocity?: number }
interface Spec { trackName: string; isDrumClip: boolean; durationBeats: number; notes: Note[]; usePreset: boolean }
interface Recipe {
  id: string; status: 'candidate' | 'integrated'; title: string; tagline: string
  annotation: string[]; genre?: string; spec: Spec; source?: string; createdAt?: string
}

// Compact piano-roll preview of a recipe's notes — enough to eyeball the progression/motif.
function RollStrip({ spec }: { spec: Spec }) {
  const notes = spec?.notes ?? []
  if (!notes.length) return null
  const W = 360, H = 60, pad = 2
  const dur = Math.max(spec.durationBeats || 1, ...notes.map(n => n.startBeat + Math.max(0.1, n.durationBeats)))
  const midis = notes.map(n => n.pitch)
  const mLo = Math.min(...midis) - 1, mHi = Math.max(...midis) + 1
  const mSpan = Math.max(1, mHi - mLo)
  const x = (b: number) => pad + (b / dur) * (W - pad * 2)
  const y = (m: number) => H - pad - ((m - mLo) / mSpan) * (H - pad * 2)
  const rowH = Math.max(2, (H - pad * 2) / mSpan)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" style={{ display: 'block', background: 'var(--bg-base)', borderRadius: 6 }} aria-hidden="true">
      {notes.map((n, i) => {
        const x0 = x(n.startBeat), x1 = x(n.startBeat + Math.max(0.1, n.durationBeats))
        return <rect key={i} x={x0} y={y(n.pitch) - rowH / 2} width={Math.max(1.5, x1 - x0)} height={rowH} rx={1} fill="var(--accent-light)" opacity={0.9} />
      })}
    </svg>
  )
}

export default function TestRecipesPanel() {
  const [recipes, setRecipes] = useState<Recipe[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const res = await fetch('/api/admin/recipes')
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Error ${res.status}`)
      setRecipes((await res.json()).recipes ?? [])
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const act = useCallback(async (action: string, id: string) => {
    setBusy(id); setError('')
    try {
      const res = await fetch('/api/admin/recipes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, id }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Error ${res.status}`)
      setRecipes((await res.json()).recipes ?? [])
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed') }
    finally { setBusy(null) }
  }, [])

  const candidates = recipes.filter(r => r.status === 'candidate')
  const integrated = recipes.filter(r => r.status === 'integrated')

  const card = (r: Recipe) => (
    <div key={r.id} className="p-4 rounded-xl border" style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}>
      <div className="flex items-start justify-between gap-3 mb-1.5">
        <div style={{ minWidth: 0 }}>
          <div className="flex items-center gap-2">
            <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{r.title}</span>
            {r.genre && <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 99, background: 'var(--bg-base)', color: 'var(--text-muted)' }}>{r.genre}</span>}
          </div>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{r.tagline}</p>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {r.status === 'candidate' ? (
            <button onClick={() => act('integrate', r.id)} disabled={busy === r.id}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold"
              style={{ background: 'rgba(52,211,153,0.15)', color: '#34d399', opacity: busy === r.id ? 0.5 : 1 }}>
              <CheckCircle2 size={13} /> Integrate
            </button>
          ) : (
            <button onClick={() => act('unintegrate', r.id)} disabled={busy === r.id}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold"
              style={{ background: 'var(--bg-base)', color: 'var(--text-muted)', opacity: busy === r.id ? 0.5 : 1 }}>
              <Undo2 size={13} /> Unintegrate
            </button>
          )}
          <button onClick={() => act('delete', r.id)} disabled={busy === r.id} title="Delete"
            className="flex items-center px-2 py-1.5 rounded-lg text-xs"
            style={{ background: 'rgba(248,113,113,0.12)', color: '#f87171', opacity: busy === r.id ? 0.5 : 1 }}>
            <Trash2 size={13} />
          </button>
        </div>
      </div>
      <RollStrip spec={r.spec} />
      {r.annotation?.length > 0 && (
        <ul className="mt-2 space-y-0.5">
          {r.annotation.slice(0, 3).map((a, i) => <li key={i} className="text-xs" style={{ color: 'var(--text-muted)' }}>• {a}</li>)}
        </ul>
      )}
      {r.source && <p className="text-xs mt-1.5" style={{ color: 'var(--text-muted)', opacity: 0.7 }}>source: {r.source}</p>}
    </div>
  )

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          Candidate recipes mined from public-domain sheet music. <strong style={{ color: 'var(--text-primary)' }}>Integrate</strong> ships one into the Sound Library recipe catalog for every user; <strong style={{ color: 'var(--text-primary)' }}>Delete</strong> discards it.
        </p>
        <button onClick={load} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium flex-shrink-0"
          style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {error && <p className="text-xs mb-3" style={{ color: '#f87171' }}>{error}</p>}

      {loading && recipes.length === 0 ? (
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Loading…</p>
      ) : recipes.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-10 text-center">
          <Music size={22} style={{ color: 'var(--text-muted)', opacity: 0.5 }} />
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>No recipes yet. Seed candidates with <code>node scripts/seed-recipes.mjs</code>.</p>
        </div>
      ) : (
        <div className="space-y-6">
          <section>
            <p className="text-xs font-semibold mb-2" style={{ color: 'var(--text-muted)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
              Candidates ({candidates.length})
            </p>
            {candidates.length === 0 ? <p className="text-xs" style={{ color: 'var(--text-muted)' }}>None pending — all reviewed.</p>
              : <div className="grid gap-3 lg:grid-cols-2">{candidates.map(card)}</div>}
          </section>
          <section>
            <p className="text-xs font-semibold mb-2" style={{ color: 'var(--text-muted)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
              Integrated — live for users ({integrated.length})
            </p>
            {integrated.length === 0 ? <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Nothing integrated yet.</p>
              : <div className="grid gap-3 lg:grid-cols-2">{integrated.map(card)}</div>}
          </section>
        </div>
      )}
    </div>
  )
}
