'use client'

// Voice Corrections — the takes users (and the owner) corrected in the VoiceMidi
// app. Each card shows the diff, the detector settings (tracker / key / bpm /
// instrument), a play button for the take audio, and a compact detected-vs-
// corrected strip. The owner writes a "what to fix in detection/rendering"
// comment + a review status; the AI reads those comments + the data via the
// Export JSON. Reads/writes go through /api/admin/voice-corrections (isAdmin).

import { useCallback, useEffect, useState } from 'react'
import { RefreshCw, Trash2, Play, Download, Save } from 'lucide-react'

interface Note { startSec: number; midi: number; durSec: number; velocity: number }
interface Diff { pitchChanged?: number; added?: number; removed?: number; timingChanged?: number }
interface Settings {
  sensitivity?: number; tracker?: string; key?: string | null; scale?: string | null
  bpm?: number; division?: number; timingOffsetMs?: number; gridAligned?: boolean; instrument?: string | null
}
interface Correction {
  id: string; ts: number; appVersion: string
  detected: Note[]; corrected: Note[]; diff: Diff
  r2Key: string | null; audioSr: number | null; audioDur: number | null
  settings: Settings; comment: string; status: string
  createdAt?: string; audioUrl: string | null
}

const STATUSES = ['new', 'reviewed', 'fixed'] as const
const STATUS_COLOR: Record<string, string> = { new: '#f59e0b', reviewed: '#38bdf8', fixed: '#34d399' }

function describeDiff(d: Diff): string {
  const p: string[] = []
  if (d.pitchChanged)  p.push(`${d.pitchChanged} pitch`)
  if (d.timingChanged) p.push(`${d.timingChanged} timing`)
  if (d.added)         p.push(`${d.added} added`)
  if (d.removed)       p.push(`${d.removed} removed`)
  return p.length ? p.join(' · ') : 'no changes (confirmed)'
}

// Compact detected-vs-corrected mini piano-roll strip: detected notes muted, the
// user's corrected notes in accent — enough to eyeball the fix without the editor.
function MiniStrip({ detected, corrected }: { detected: Note[]; corrected: Note[] }) {
  const all = [...detected, ...corrected]
  if (all.length === 0) return null
  const W = 320, H = 54, pad = 2
  const t0 = Math.min(...all.map(n => n.startSec))
  const t1 = Math.max(...all.map(n => n.startSec + Math.max(0.02, n.durSec)))
  const midis = all.map(n => n.midi)
  const mLo = Math.min(...midis) - 1, mHi = Math.max(...midis) + 1
  const span = Math.max(0.001, t1 - t0), mSpan = Math.max(1, mHi - mLo)
  const x = (t: number) => pad + ((t - t0) / span) * (W - pad * 2)
  const y = (m: number) => H - pad - ((m - mLo) / mSpan) * (H - pad * 2)
  const rowH = Math.max(2, (H - pad * 2) / mSpan)
  const rect = (n: Note, fill: string, op: number, key: string) => {
    const x0 = x(n.startSec), x1 = x(n.startSec + Math.max(0.02, n.durSec))
    return <rect key={key} x={x0} y={y(n.midi) - rowH / 2} width={Math.max(1.5, x1 - x0)} height={rowH} rx={1} fill={fill} opacity={op} />
  }
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" style={{ display: 'block', background: 'var(--bg-base)', borderRadius: 6 }} aria-hidden="true">
      {detected.map((n, i) => rect(n, 'var(--text-muted)', 0.45, `d${i}`))}
      {corrected.map((n, i) => rect(n, 'var(--accent-light)', 0.95, `c${i}`))}
    </svg>
  )
}

const chip: React.CSSProperties = { fontSize: 9.5, padding: '1px 7px', borderRadius: 99, background: 'var(--bg-base)', color: 'var(--text-muted)' }

export default function AppCorrectionsPanel() {
  const [items, setItems] = useState<Correction[] | null>(null)
  const [msg, setMsg] = useState('')
  const [drafts, setDrafts] = useState<Record<string, string>>({})   // per-id comment edits
  const [playing, setPlaying] = useState<Record<string, string>>({}) // per-id presigned URLs

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/voice-corrections')
      if (r.status === 401) { setItems([]); setMsg('Not authorized (admin cookie required).'); return }
      const d = await r.json()
      const list: Correction[] = d.items ?? []
      setItems(list)
      setDrafts(Object.fromEntries(list.map(c => [c.id, c.comment ?? ''])))
    } catch { setItems([]) }
  }, [])
  useEffect(() => { void load() }, [load])

  async function patch(id: string, body: { comment?: string; status?: string }, ok: string) {
    const r = await fetch('/api/admin/voice-corrections', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, ...body }),
    }).catch(() => null)
    if (!r?.ok) { setMsg('Update failed'); return }
    setMsg(ok)
    setItems(prev => prev?.map(c => c.id === id ? { ...c, ...body } : c) ?? prev)
  }

  async function remove(c: Correction) {
    if (!confirm(`Delete this correction?${c.r2Key ? ' This deletes its take audio too.' : ''}`)) return
    const r = await fetch(`/api/admin/voice-corrections?id=${encodeURIComponent(c.id)}`, { method: 'DELETE' }).catch(() => null)
    if (!r?.ok) { setMsg('Delete failed'); return }
    setMsg('Deleted ✓'); await load()
  }

  async function play(c: Correction) {
    if (playing[c.id] || !c.audioUrl) return
    try {
      const r = await fetch(c.audioUrl)
      const d = await r.json().catch(() => ({}))
      if (!r.ok || !d.url) throw new Error(d.error || 'No audio')
      setPlaying(p => ({ ...p, [c.id]: d.url }))
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Playback failed') }
  }

  const when = (c: Correction) => {
    const t = c.createdAt ? new Date(c.createdAt) : new Date(c.ts)
    return t.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{items?.length ?? '…'} correction{items?.length === 1 ? '' : 's'}</span>
        <button onClick={() => void load()} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10.5, padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer' }}>
          <RefreshCw size={11} /> Refresh
        </button>
        {msg && <span style={{ fontSize: 10.5, color: msg.includes('✓') ? '#34d399' : '#f59e0b' }}>{msg}</span>}
        <a href="/api/admin/voice-corrections?export=1" target="_blank" rel="noopener noreferrer" style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10.5, padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--accent-light)', textDecoration: 'none', marginLeft: 'auto' }}>
          <Download size={11} /> Export all (JSON)
        </a>
      </div>

      {/* ── List ───────────────────────────────────────────────────────────── */}
      {items?.map(c => (
        <div key={c.id} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px', background: 'var(--bg-card)', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {/* Meta row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 9.5, padding: '1px 7px', borderRadius: 99, background: `color-mix(in srgb, ${STATUS_COLOR[c.status] ?? 'var(--text-muted)'} 18%, transparent)`, color: STATUS_COLOR[c.status] ?? 'var(--text-muted)', fontWeight: 700 }}>{c.status}</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>{describeDiff(c.diff)}</span>
            <span style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>{when(c)}</span>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
              {c.audioUrl && !playing[c.id] && (
                <button onClick={() => void play(c)} title="Play take audio" style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', padding: 2 }}><Play size={14} /></button>
              )}
              <button onClick={() => void remove(c)} title="Delete" style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', display: 'flex', padding: 2 }}><Trash2 size={13} /></button>
            </div>
          </div>

          {/* Settings chips */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <span style={chip}>tracker: {c.settings?.tracker ?? '—'}</span>
            <span style={chip}>bpm: {c.settings?.bpm ?? '—'}</span>
            {c.settings?.key != null && <span style={chip}>key: {c.settings.key}</span>}
            {c.settings?.instrument && <span style={{ ...chip, color: 'var(--accent-light)' }}>♪ {c.settings.instrument}</span>}
            <span style={chip}>{c.detected.length}→{c.corrected.length} notes</span>
            {c.audioDur ? <span style={chip}>{c.audioDur.toFixed(1)}s</span> : null}
          </div>

          {/* Detected vs corrected mini strip */}
          <MiniStrip detected={c.detected} corrected={c.corrected} />
          {playing[c.id] && <audio controls autoPlay preload="none" src={playing[c.id]} style={{ width: '100%', height: 30, display: 'block' }} />}

          {/* Owner comment + status */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <textarea
              value={drafts[c.id] ?? ''}
              onChange={e => setDrafts(d => ({ ...d, [c.id]: e.target.value }))}
              rows={2}
              placeholder="What's wrong here — detection (missed/spurious/octave) or rendering (instrument/timing)? The AI tunes to this."
              style={{ fontSize: 12, padding: '6px 8px', borderRadius: 6, background: 'var(--bg-base)', border: '1px solid var(--border)', color: 'var(--text-primary)', outline: 'none', width: '100%', boxSizing: 'border-box', resize: 'vertical', lineHeight: 1.5 }}
            />
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <button onClick={() => void patch(c.id, { comment: drafts[c.id] ?? '' }, 'Comment saved ✓')} disabled={(drafts[c.id] ?? '') === (c.comment ?? '')}
                style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 12px', borderRadius: 6, border: 'none', background: '#d97706', color: '#fff', cursor: (drafts[c.id] ?? '') === (c.comment ?? '') ? 'default' : 'pointer', opacity: (drafts[c.id] ?? '') === (c.comment ?? '') ? 0.5 : 1, fontSize: 11, fontWeight: 700 }}>
                <Save size={13} /> Save comment
              </button>
              <span style={{ fontSize: 10.5, color: 'var(--text-muted)', marginLeft: 4 }}>Status:</span>
              {STATUSES.map(s => (
                <button key={s} onClick={() => void patch(c.id, { status: s }, 'Status updated ✓')}
                  style={{ fontSize: 10.5, fontWeight: 700, padding: '3px 9px', borderRadius: 99, cursor: 'pointer',
                    border: `1px solid ${c.status === s ? (STATUS_COLOR[s]) : 'var(--border)'}`,
                    background: c.status === s ? `color-mix(in srgb, ${STATUS_COLOR[s]} 16%, transparent)` : 'transparent',
                    color: c.status === s ? STATUS_COLOR[s] : 'var(--text-muted)' }}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        </div>
      ))}
      {items?.length === 0 && <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>No corrections yet — they arrive when a user taps “Send to admin” in the voice app.</p>}
    </div>
  )
}
