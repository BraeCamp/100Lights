'use client'

// The status bar along the bottom of the studio — Live's Info View on the
// left, Status Bar on the right.
//
// Info View: whatever the pointer is over explains itself here, in a line —
// the help panel's text for anything with a data-help-id (the same words
// Inspect mode shows), a control's own title otherwise, and for a clip or a
// track the note its owner wrote on it (Edit Info Text…, from its context
// menu). Status: what is selected — start, end and length in bars.beats and
// in clock time — or the playhead when nothing is. ⌘⌥I shows and hides the
// bar (lib/display-settings.ts infoView).

import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { useDaw, useDawPlayhead } from '@/lib/daw-state'
import { helpInfoFor } from './HelpButton'
import { useDisplaySettings, setDisplay } from '@/lib/display-settings'
import { summarizeSelection, formatPosition, formatClock } from '@/lib/status-bar'
import { tempoSegments, beatToSeconds } from '@/lib/tempo-map'
import { keysFor } from '@/lib/keymap'

interface Info { name: string; text: string; kind: 'help' | 'own' | 'title' }
type EditTarget = { kind: 'clip' | 'track'; id: string }

export default function StatusBar() {
  const { project, dispatch, selectedClipId, selectedClipIds, selectedTrackId } = useDaw()
  const display = useDisplaySettings()
  const playhead = useDawPlayhead()
  const [info, setInfo] = useState<Info | null>(null)
  const [editing, setEditing] = useState<EditTarget | null>(null)
  const [draft, setDraft] = useState('')
  const projectRef = useRef(project)
  projectRef.current = project

  // Whatever the pointer is over explains itself.
  useEffect(() => {
    if (!display.infoView) return
    let raf = 0
    const onOver = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      if (!target || typeof target.closest !== 'function') return
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const p = projectRef.current
        const clipEl = target.closest<HTMLElement>('[data-clip-id]')
        if (clipEl) {
          const c = p.arrangementClips.find(x => x.id === clipEl.dataset.clipId)
          if (c?.infoText) { setInfo({ name: c.name, text: c.infoText, kind: 'own' }); return }
        }
        const trackEl = target.closest<HTMLElement>('[data-track-id]')
        if (trackEl && !clipEl) {
          const t = p.tracks.find(x => x.id === trackEl.dataset.trackId)
          if (t?.infoText) { setInfo({ name: t.name, text: t.infoText, kind: 'own' }); return }
        }
        const helpEl = target.closest<HTMLElement>('[data-help-id]')
        if (helpEl) {
          const found = helpInfoFor(helpEl.dataset.helpId ?? '')
          if (found) { setInfo({ name: found.name, text: found.description, kind: 'help' }); return }
        }
        const titled = target.closest<HTMLElement>('[title], [aria-label]')
        if (titled) {
          const t = titled.getAttribute('title') || titled.getAttribute('aria-label') || ''
          if (t) { setInfo({ name: '', text: t, kind: 'title' }); return }
        }
        if (clipEl) {
          const c = p.arrangementClips.find(x => x.id === clipEl.dataset.clipId)
          if (c) { setInfo({ name: c.name, text: `${c.kind === 'midi' ? 'MIDI' : 'Audio'} clip — double-click to edit, right-click for more. Edit Info Text… writes a note that shows here.`, kind: 'title' }); return }
        }
      })
    }
    document.addEventListener('mouseover', onOver, true)
    return () => { document.removeEventListener('mouseover', onOver, true); cancelAnimationFrame(raf) }
  }, [display.infoView])

  // "Edit Info Text…" from a clip's or a track's context menu.
  useEffect(() => {
    const onEdit = (e: Event) => {
      const d = (e as CustomEvent<EditTarget>).detail
      if (!d?.id) return
      const p = projectRef.current
      const cur = d.kind === 'clip' ? p.arrangementClips.find(c => c.id === d.id)?.infoText : p.tracks.find(t => t.id === d.id)?.infoText
      setDraft(cur ?? '')
      setEditing(d)
      setDisplay({ infoView: true })
    }
    window.addEventListener('100lights:edit-info', onEdit)
    return () => window.removeEventListener('100lights:edit-info', onEdit)
  }, [])

  if (!display.infoView) return null

  const commit = () => {
    if (!editing) return
    const text = draft.trim() || undefined
    if (editing.kind === 'clip') dispatch({ type: 'UPDATE_CLIP', clipId: editing.id, patch: { infoText: text } })
    else dispatch({ type: 'UPDATE_TRACK', trackId: editing.id, patch: { infoText: text } })
    setEditing(null)
  }
  const editingName = editing ? (editing.kind === 'clip' ? project.arrangementClips.find(c => c.id === editing.id)?.name : project.tracks.find(t => t.id === editing.id)?.name) ?? '' : ''

  // The selection, or the playhead.
  const ids = selectedClipIds.size ? [...selectedClipIds] : selectedClipId ? [selectedClipId] : []
  const clips = project.arrangementClips.filter(c => ids.includes(c.id))
  const sel = summarizeSelection(clips, project)
  const bpb = project.timeSignatureNum ?? 4
  const track = selectedTrackId ? project.tracks.find(t => t.id === selectedTrackId) : null
  const segs = tempoSegments(project)

  return (
    <div data-help-id="status-bar" role="status" aria-live="polite"
      style={{ flexShrink: 0, height: 22, display: 'flex', alignItems: 'center', gap: 12, padding: '0 10px', background: 'var(--bg-surface)', borderTop: '1px solid var(--border)', fontSize: 10.5, color: 'var(--text-secondary)', overflow: 'hidden' }}>
      {/* Info View */}
      <div data-help-id="info-view" style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden', whiteSpace: 'nowrap' }}>
        {editing ? (
          <>
            <span style={{ fontWeight: 700, color: 'var(--text-primary)', flexShrink: 0 }}>Info text for {editingName}:</span>
            <input autoFocus value={draft} onChange={e => setDraft(e.target.value)} aria-label={`Info text for ${editingName}`} data-help-id="info-text-input"
              onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') commit(); else if (e.key === 'Escape') setEditing(null) }}
              onBlur={commit}
              placeholder="A note that shows here whenever the pointer is over it"
              style={{ flex: 1, minWidth: 0, fontSize: 10.5, background: 'var(--bg-base)', border: '1px solid var(--accent)', borderRadius: 3, color: 'var(--text-primary)', padding: '1px 6px', outline: 'none' }} />
          </>
        ) : info ? (
          <>
            {info.name && <span style={{ fontWeight: 700, color: info.kind === 'own' ? 'var(--accent)' : 'var(--text-primary)', flexShrink: 0 }}>{info.name}</span>}
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }} title={info.text}>{info.text}</span>
          </>
        ) : (
          <span style={{ color: 'var(--text-muted)' }}>Point at anything to read what it does. Right-click a clip or track → Edit Info Text… to write your own note.</span>
        )}
      </div>
      {/* Status */}
      <div data-help-id="selection-status" style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10, fontVariantNumeric: 'tabular-nums', color: 'var(--text-muted)' }}>
        {sel ? (
          <>
            <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{sel.count === 1 ? clips[0].name : `${sel.count} clips`}</span>
            <span title="Start → end, in bars.beats.sixteenths">{sel.position} → {sel.end}</span>
            <span title="Length">{sel.length}</span>
            <span title="Start → end, in clock time">{sel.startClock} → {sel.endClock}</span>
            <span title="Length in time">({sel.lengthClock})</span>
          </>
        ) : track ? (
          <>
            <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{track.name}</span>
            <span>{project.arrangementClips.filter(c => c.trackId === track.id).length} clips · {track.effects.length} devices</span>
          </>
        ) : (
          <>
            <span title="Playhead">{formatPosition(playhead, bpb)}</span>
            <span>{formatClock(beatToSeconds(playhead, segs))}</span>
          </>
        )}
        <button onClick={() => setDisplay({ infoView: false })} title={`Hide the status bar (${keysFor('view.info') ?? '⌘⌥I'})`} aria-label="Hide the status bar"
          style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'inline-flex', padding: 0 }}><X size={11} /></button>
      </div>
    </div>
  )
}
