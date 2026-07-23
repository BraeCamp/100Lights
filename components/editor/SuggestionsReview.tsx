'use client'

// Owner-facing review of "suggest changes" proposals. Shows a floating button
// with a pending count; the panel lists each suggestion with a light summary of
// what it changes, and Accept (writes the proposed project + reloads) or Reject.

import { useCallback, useEffect, useState } from 'react'
import type { DawProject } from '@/lib/daw-types'
import type { CfProjFile } from '@/lib/project-serializer'

interface Suggestion {
  id: string
  authorName: string
  note: string
  data: CfProjFile
  createdAt: string
}

function summarize(base: DawProject | undefined, suggested: DawProject | undefined) {
  const clips = (p?: DawProject) => p?.arrangementClips?.length ?? 0
  const notes = (p?: DawProject) => (p?.arrangementClips ?? []).reduce((n, c) => n + ((c as { notes?: unknown[] }).notes?.length ?? 0), 0)
  const tracks = (p?: DawProject) => p?.tracks?.length ?? 0
  const parts: string[] = []
  const push = (d: number, unit: string) => { if (d !== 0) parts.push(`${d > 0 ? '+' : ''}${d} ${unit}${Math.abs(d) === 1 ? '' : 's'}`) }
  push(tracks(suggested) - tracks(base), 'track')
  push(clips(suggested) - clips(base), 'clip')
  push(notes(suggested) - notes(base), 'note')
  return parts.length ? parts.join(' · ') : 'edits to existing content'
}

export default function SuggestionsReview({ projectId, currentDaw }: { projectId: string; currentDaw?: DawProject }) {
  const [items, setItems] = useState<Suggestion[] | null>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/projects/${projectId}/suggestions`)
      if (!r.ok) { setItems([]); return }   // 404 = not owner / none
      const d = await r.json()
      setItems(d.suggestions ?? [])
    } catch { setItems([]) }
  }, [projectId])

  useEffect(() => { void load() }, [load])

  async function resolve(id: string, status: 'accepted' | 'rejected') {
    setBusy(id); setErr('')
    try {
      if (status === 'accepted') {
        const item = items?.find(s => s.id === id)
        if (!item) return
        // Write the proposed project as the owner, then mark accepted + reload.
        const save = await fetch('/api/projects', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(item.data),
        })
        if (!save.ok) { setErr('Could not apply the suggestion'); setBusy(null); return }
      }
      await fetch(`/api/projects/${projectId}/suggestions`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, status }),
      })
      if (status === 'accepted') { window.location.reload(); return }
      setItems(prev => (prev ?? []).filter(s => s.id !== id))
    } catch { setErr('Something went wrong') } finally { setBusy(null) }
  }

  if (!items || items.length === 0) return null

  return (
    <>
      <button onClick={() => setOpen(o => !o)}
        title={`${items.length} suggested change${items.length === 1 ? '' : 's'} to review`}
        style={{
          position: 'fixed', bottom: 22, right: 22, zIndex: 1100, display: 'flex', alignItems: 'center', gap: 7,
          padding: '9px 15px', borderRadius: 999, cursor: 'pointer', border: 'none',
          background: '#7c3aed', color: '#fff', fontSize: 12.5, fontWeight: 700, boxShadow: '0 8px 26px rgba(124,58,237,0.5)',
        }}>
        ✎ {items.length} suggestion{items.length === 1 ? '' : 's'}
      </button>

      {open && (
        <div style={{
          position: 'fixed', bottom: 66, right: 22, zIndex: 1100, width: 340, maxHeight: '70vh', overflowY: 'auto',
          background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12, boxShadow: '0 14px 44px rgba(0,0,0,0.6)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '11px 14px', borderBottom: '1px solid var(--border)' }}>
            <span style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--text-primary)' }}>Suggested changes</span>
            <span style={{ flex: 1 }} />
            <button onClick={() => setOpen(false)} style={{ border: 'none', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 14 }}>✕</button>
          </div>
          {err && <p style={{ fontSize: 11, color: '#ef4444', margin: '8px 14px 0' }}>{err}</p>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 12 }}>
            {items.map(s => (
              <div key={s.id} style={{ padding: '11px 12px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--bg-card)' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>{s.authorName}</div>
                {s.note && <p style={{ fontSize: 11.5, color: 'var(--text-secondary)', margin: '4px 0 6px', lineHeight: 1.5 }}>{s.note}</p>}
                <p style={{ fontSize: 10.5, color: 'var(--text-muted)', margin: '2px 0 9px' }}>Changes: {summarize(currentDaw, s.data.dawProject)}</p>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => void resolve(s.id, 'accepted')} disabled={busy === s.id}
                    style={{ flex: 1, fontSize: 11, fontWeight: 700, padding: '6px 0', borderRadius: 7, cursor: 'pointer', border: 'none', background: '#166534', color: '#fff', opacity: busy === s.id ? 0.6 : 1 }}>
                    {busy === s.id ? 'Applying…' : 'Accept'}
                  </button>
                  <button onClick={() => void resolve(s.id, 'rejected')} disabled={busy === s.id}
                    style={{ flex: 1, fontSize: 11, fontWeight: 700, padding: '6px 0', borderRadius: 7, cursor: 'pointer', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)' }}>
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
          <p style={{ fontSize: 10, color: 'var(--text-muted)', margin: 0, padding: '0 14px 12px', lineHeight: 1.5 }}>
            Accepting replaces the project with the proposed version and reloads. Reject dismisses it.
          </p>
        </div>
      )}
    </>
  )
}
