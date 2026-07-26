'use client'

import { useEffect, useState } from 'react'
import { RefreshCw, Wand2, ExternalLink, Check } from 'lucide-react'

interface Clip { id: string; projectId: string | null }

// The 27 demo clips (lib/demo-audio CLIP_IDS) → editable multi-track studio
// projects. Generating one builds a DawProject with the parts on separate
// tracks and saves it as a project you own; open it to edit, then export a WAV
// and upload it as the clip's override to make it live.
export default function ArticleProjectsPanel() {
  const [clips, setClips] = useState<Clip[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [working, setWorking] = useState<string | null>(null)

  async function load() {
    setBusy(true); setErr(null)
    try {
      const r = await fetch('/api/admin/articles/audio/project', { cache: 'no-store' })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`)
      setClips(d.clips)
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed') } finally { setBusy(false) }
  }
  useEffect(() => { void load() }, [])

  async function generate(id: string) {
    setWorking(id)
    try {
      const r = await fetch('/api/admin/articles/audio/project', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clipId: id }) })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`)
      setClips(cs => cs.map(c => c.id === id ? { ...c, projectId: d.projectId } : c))
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed') } finally { setWorking(null) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={() => void load()} disabled={busy}
          style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, padding: '5px 12px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-secondary)', cursor: 'pointer', opacity: busy ? 0.6 : 1 }}>
          <RefreshCw size={12} /> {busy ? 'Loading…' : 'Refresh'}
        </button>
        <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{clips.filter(c => c.projectId).length}/{clips.length} generated</span>
        {err && <span style={{ fontSize: 12, color: '#f87171' }}>{err}</span>}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(240px,1fr))', gap: 8 }}>
        {clips.map(c => (
          <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--bg-surface)' }}>
            <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontFamily: 'monospace', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.id}</span>
            {c.projectId && <a href={`/projects/${c.projectId}`} target="_blank" rel="noopener noreferrer" title="Open in studio" style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, color: 'var(--accent-light)', textDecoration: 'none', flexShrink: 0 }}>open <ExternalLink size={11} /></a>}
            <button onClick={() => void generate(c.id)} disabled={working === c.id}
              title={c.projectId ? 'Regenerate (replaces the project)' : 'Generate a multi-track project'}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0, fontSize: 11, fontWeight: 700, padding: '4px 9px', borderRadius: 6, border: 'none', cursor: 'pointer',
                background: c.projectId ? 'var(--bg-base)' : 'var(--accent)', color: c.projectId ? 'var(--text-secondary)' : '#fff', opacity: working === c.id ? 0.5 : 1 }}>
              {working === c.id ? '…' : c.projectId ? <><Check size={11} /> Regen</> : <><Wand2 size={11} /> Generate</>}
            </button>
          </div>
        ))}
      </div>

      <p style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>Generate builds a multi-track DawProject (drums / bass / pad / lead on separate tracks) and saves it as a project you own — open it to edit the parts. To make an edit live for the article, export a WAV from the studio and upload it as this clip&rsquo;s override. The mix-bus effects (compression, EQ, reverb…) are deliberately left off — that&rsquo;s what each article teaches.</p>
    </div>
  )
}
