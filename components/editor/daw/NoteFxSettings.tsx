'use client'

// Per-note sound override. With one or more notes selected, this opens a panel
// that edits MidiNote.fx for every selected note — the most specific layer of
// the cascade (it overrides the clip's Sound panel and the preset's own sound).

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { SlidersHorizontal } from 'lucide-react'
import type { MidiClip, RollFx } from '@/lib/daw-types'
import type { DawAction } from '@/lib/daw-state'
import { fxHasAudibleField } from '@/lib/roll-fx'
import FxControls from './FxControls'
import { clampToViewport } from './menu-clamp'

const ACCENT = 'var(--accent-light)'

export function NoteFxSettings({ clip, dispatch, selectedNoteIds }: {
  clip: MidiClip
  dispatch: (a: DawAction) => void
  selectedNoteIds: Set<string>
}) {
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  const ids = [...selectedNoteIds]
  const notes = clip.notes.filter(n => selectedNoteIds.has(n.id))
  const anySet = notes.some(n => fxHasAudibleField(n.fx))
  const disabled = ids.length === 0

  // Basis = the first selected note's fx (what the sliders start from).
  const basis = notes[0]?.fx

  function apply(fx: RollFx | undefined) {
    for (const id of ids) {
      dispatch({ type: 'UPDATE_MIDI_NOTE', clipId: clip.id, noteId: id, patch: { fx } })
    }
  }

  return (
    <>
      <button
        ref={btnRef}
        disabled={disabled}
        onClick={() => {
          if (anchor) { setAnchor(null); return }
          const r = btnRef.current!.getBoundingClientRect()
          setAnchor({ x: r.right - 300, y: r.bottom + 6 })
        }}
        title={disabled ? 'Select one or more notes to shape them individually' : `Sound for ${ids.length} selected note${ids.length > 1 ? 's' : ''}`}
        style={{
          display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 600,
          padding: '2px 7px', borderRadius: 4, cursor: disabled ? 'default' : 'pointer', whiteSpace: 'nowrap',
          border: anySet && !disabled ? `1px solid var(--accent-light)` : '1px solid #333',
          background: anySet && !disabled ? 'rgba(124,58,237,0.12)' : '#222',
          color: disabled ? '#555' : anySet ? ACCENT : '#aaa', flexShrink: 0, opacity: disabled ? 0.55 : 1,
        }}
      >
        <SlidersHorizontal size={10} /> Note FX{ids.length ? ` (${ids.length})` : ''}{anySet ? ' •' : ''}
      </button>

      {anchor && !disabled && (
        <NoteFxPanel
          key={ids.join(',')}
          basis={basis} count={ids.length}
          onApply={apply} onClose={() => setAnchor(null)}
          anchor={anchor} ignoreOutside={btnRef}
        />
      )}
    </>
  )
}

function NoteFxPanel({ basis, count, onApply, onClose, anchor, ignoreOutside }: {
  basis: RollFx | undefined
  count: number
  onApply: (fx: RollFx | undefined) => void
  onClose: () => void
  anchor: { x: number; y: number }
  ignoreOutside: React.RefObject<HTMLElement | null>
}) {
  const panelRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => { clampToViewport(panelRef.current, anchor); panelRef.current?.focus() }, [anchor])
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (panelRef.current?.contains(e.target as Node)) return
      if (ignoreOutside.current?.contains(e.target as Node)) return
      onClose()
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey, true)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey, true) }
  }, [onClose, ignoreOutside])

  if (typeof document === 'undefined') return null
  return createPortal(
    <div ref={panelRef} tabIndex={-1} onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }} style={{
      position: 'fixed', top: anchor.y, left: anchor.x, width: 300, zIndex: 9999, outline: 'none',
      maxHeight: '78vh', overflowY: 'auto',
      background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8,
      padding: '6px 0 10px', boxShadow: '0 10px 28px rgba(0,0,0,0.75)',
    }}>
      <div style={{ position: 'sticky', top: 0, background: 'var(--bg-surface)', padding: '4px 12px 6px', fontSize: 9, color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '0.08em', borderBottom: '1px solid var(--border)', zIndex: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>NOTE SOUND — {count} selected</span>
        <button onClick={() => onApply(undefined)} title="Clear per-note overrides" style={{ fontSize: 8.5, fontWeight: 600, color: 'var(--text-secondary)', background: 'none', border: '1px solid var(--border)', borderRadius: 4, padding: '1px 6px', cursor: 'pointer' }}>Clear</button>
      </div>
      <FxControls value={basis} onCommit={onApply} exclude={['time']} />
      <div style={{ padding: '8px 12px 0', fontSize: 8.5, color: 'var(--text-muted)', lineHeight: 1.4 }}>
        Overrides the clip’s Sound panel and the preset for these notes only.
      </div>
    </div>,
    document.body,
  )
}
