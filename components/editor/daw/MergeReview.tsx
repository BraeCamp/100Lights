'use client'

// Phase D — offline-sync conflict review. When reconnecting produced conflicts
// (the same clip/track edited on both sides), this panel shows each one as
// "Yours vs Theirs" and lets you pick per item, mirroring the Suggest-Changes
// review UI for consistency. Reads the conflicts + resolver off the DAW context.

import { useState } from 'react'
import { useDaw } from '@/lib/daw-state'
import type { MergeConflict } from '@/lib/project-merge'

function summarize(kind: MergeConflict['kind'], item: unknown): string {
  if (item == null) return 'deleted'
  const o = item as Record<string, unknown>
  if (kind === 'clip') {
    const notes = Array.isArray(o.notes) ? o.notes.length : 0
    const bar = Math.floor(((o.startBeat as number) ?? 0) / 4) + 1
    return `${notes} note${notes === 1 ? '' : 's'} · starts bar ${bar} · ${o.durationBeats ?? '?'} beats`
  }
  if (kind === 'track') {
    const inst = (o.instrument as { type?: string } | undefined)?.type
    return `vol ${Math.round(((o.volume as number) ?? 0) * 100)}%${inst ? ` · ${inst}` : ''}`
  }
  if (kind === 'field') return String(item)
  return 'changed'
}

const KIND_NOUN: Record<MergeConflict['kind'], string> = {
  clip: 'Clip', track: 'Track', effect: 'Effect', return: 'Return', automation: 'Automation', scene: 'Scene', field: 'Setting',
}

export default function MergeReview() {
  const { mergeConflicts, resolveMerge } = useDaw()
  const [choices, setChoices] = useState<Record<string, 'mine' | 'theirs'>>({})

  if (!mergeConflicts || mergeConflicts.length === 0 || !resolveMerge) return null

  const pick = (id: string) => choices[id] ?? 'theirs'   // theirs is the default
  const setAll = (side: 'mine' | 'theirs') => setChoices(Object.fromEntries(mergeConflicts.map(c => [c.id, side])))

  const sideCard = (c: MergeConflict, side: 'mine' | 'theirs') => {
    const chosen = pick(c.id) === side
    return (
      <button
        onClick={() => setChoices(prev => ({ ...prev, [c.id]: side }))}
        style={{
          flex: 1, textAlign: 'left', padding: '8px 10px', borderRadius: 8, cursor: 'pointer',
          border: `1px solid ${chosen ? (side === 'mine' ? '#7c3aed' : '#166534') : 'var(--border)'}`,
          background: chosen ? (side === 'mine' ? 'rgba(124,58,237,0.16)' : 'rgba(22,101,52,0.16)') : 'var(--bg-base)',
        }}>
        <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: '0.05em', color: chosen ? (side === 'mine' ? '#a78bfa' : '#4ade80') : 'var(--text-muted)', marginBottom: 3 }}>
          {side === 'mine' ? 'YOURS' : 'THEIRS'}{chosen ? ' ✓' : ''}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-primary)' }}>{summarize(c.kind, side === 'mine' ? c.mine : c.theirs)}</div>
      </button>
    )
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 3200, background: 'rgba(0,0,0,0.62)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ width: 460, maxWidth: 'calc(100vw - 32px)', maxHeight: '84vh', display: 'flex', flexDirection: 'column', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12, boxShadow: '0 16px 50px rgba(0,0,0,0.65)', overflow: 'hidden' }}>
        <div style={{ padding: '13px 16px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontSize: 13.5, fontWeight: 800, color: 'var(--text-primary)' }}>Resolve {mergeConflicts.length} conflict{mergeConflicts.length === 1 ? '' : 's'}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>
            These were edited both by you (offline) and on the shared version. Pick which to keep for each.
          </div>
        </div>

        <div style={{ display: 'flex', gap: 6, padding: '8px 16px', borderBottom: '1px solid var(--border)' }}>
          <button onClick={() => setAll('mine')} style={{ fontSize: 10.5, fontWeight: 700, padding: '4px 10px', borderRadius: 999, cursor: 'pointer', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)' }}>Keep all yours</button>
          <button onClick={() => setAll('theirs')} style={{ fontSize: 10.5, fontWeight: 700, padding: '4px 10px', borderRadius: 999, cursor: 'pointer', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)' }}>Keep all theirs</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {mergeConflicts.map(c => (
            <div key={c.id}>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 5 }}>
                {KIND_NOUN[c.kind]} · <span style={{ color: 'var(--text-secondary)' }}>{c.label}</span>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {sideCard(c, 'mine')}
                {sideCard(c, 'theirs')}
              </div>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 8, padding: '12px 16px', borderTop: '1px solid var(--border)' }}>
          <span style={{ flex: 1, fontSize: 10.5, color: 'var(--text-muted)', alignSelf: 'center' }}>Unpicked items keep the shared version.</span>
          <button onClick={() => resolveMerge(choices)}
            style={{ fontSize: 12, fontWeight: 800, padding: '7px 16px', borderRadius: 8, cursor: 'pointer', border: 'none', background: 'var(--accent)', color: '#fff' }}>
            Apply
          </button>
        </div>
      </div>
    </div>
  )
}
