'use client'

// Piano-roll clip sound settings: a ⚙ panel controlling effects that touch
// ONLY this clip's notes. Sustain (a release ramp past each note's end) is
// the headliner — it's what makes sampled instruments stop sounding gated —
// plus reverb, distortion, and a lowpass filter, and the clip's sound preset.

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Settings2 } from 'lucide-react'
import type { MidiClip, RollFx } from '@/lib/daw-types'
import type { DawAction } from '@/lib/daw-state'
import { fxHasAudibleField } from '@/lib/roll-fx'
import FxControls, { cleanFx } from './FxControls'
import { clampToViewport } from './menu-clamp'

const CYAN = 'var(--accent-light)'

export function RollSettings({ clip, dispatch, presetLabel, onChangeSound, onPreviewSound, canPreview }: {
  clip: MidiClip
  dispatch: (a: DawAction) => void
  presetLabel: string
  onChangeSound: () => void
  onPreviewSound: () => void
  canPreview: boolean
}) {
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  const rfx = clip.rollFx
  const active = (rfx?.sustain ?? 0) > 0 || fxHasAudibleField(rfx)

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => {
          if (anchor) { setAnchor(null); return }
          const r = btnRef.current!.getBoundingClientRect()
          setAnchor({ x: r.right - 292, y: r.bottom + 6 })
        }}
        title="Clip sound settings — sustain and effects for this piano roll only"
        style={{
          display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 600,
          padding: '2px 7px', borderRadius: 4, cursor: 'pointer', whiteSpace: 'nowrap',
          border: active ? `1px solid ${CYAN}66` : '1px solid #333',
          background: active ? 'rgba(124,58,237,0.12)' : '#222',
          color: active ? CYAN : '#aaa', flexShrink: 0,
        }}
      >
        <Settings2 size={10} /> Sound{active ? ' •' : ''}
      </button>

      {anchor && (
        <RollSoundPanel
          clip={clip} dispatch={dispatch} anchor={anchor}
          onClose={() => setAnchor(null)}
          presetLabel={presetLabel}
          onChangeSound={() => { setAnchor(null); onChangeSound() }}
          onPreviewSound={onPreviewSound}
          canPreview={canPreview}
          ignoreOutside={btnRef}
        />
      )}
    </>
  )
}

/** The sound-settings panel itself — also opened from the clip context menu,
 *  so sustain/reverb/distortion/filter are reachable without the roll. */
export function RollSoundPanel({ clip, dispatch, anchor, onClose, presetLabel, onChangeSound, onPreviewSound, canPreview, ignoreOutside }: {
  clip: MidiClip
  dispatch: (a: DawAction) => void
  anchor: { x: number; y: number }
  onClose: () => void
  presetLabel: string
  onChangeSound?: () => void
  onPreviewSound?: () => void
  canPreview?: boolean
  ignoreOutside?: React.RefObject<HTMLElement | null>
}) {
  const panelRef = useRef<HTMLDivElement>(null)

  const rfx = clip.rollFx
  const [sustain, setSustain] = useState(rfx?.sustain ?? 0)

  // Different clip opened → mirror its stored settings
  useEffect(() => {
    const t = setTimeout(() => {  // async boundary — no sync setState in the effect
      setSustain(clip.rollFx?.sustain ?? 0)
    }, 0)
    return () => clearTimeout(t)
  }, [clip.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    clampToViewport(panelRef.current, anchor)
    // focus the panel so Escape works regardless of what else listens on document
    panelRef.current?.focus()
  }, [anchor])

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (panelRef.current?.contains(e.target as Node)) return
      if (ignoreOutside?.current?.contains(e.target as Node)) return
      onClose()
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', onDown)
    // capture phase — the editor has its own Escape handling that would
    // otherwise consume the key before this panel sees it
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [onClose, ignoreOutside])

  // Commit a new FX bag (from FxControls) while preserving the separate sustain.
  function commitFx(fxBag: RollFx | undefined) {
    const next: RollFx = { ...(fxBag ?? {}) }
    if (sustain > 0) next.sustain = Math.round(sustain * 100) / 100
    else delete next.sustain
    dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch: { rollFx: Object.keys(next).length ? next : undefined } })
  }
  function commitSustain(s: number) {
    const next: RollFx = { ...(clip.rollFx ?? {}) }
    if (s > 0) next.sustain = Math.round(s * 100) / 100
    else delete next.sustain
    dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch: { rollFx: Object.keys(next).length ? next : undefined } })
  }

  const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, padding: '4px 12px' }
  const label: React.CSSProperties = { fontSize: 10, color: 'var(--text-secondary)', width: 70, flexShrink: 0 }
  const value: React.CSSProperties = { fontSize: 9.5, color: 'var(--text-primary)', width: 48, textAlign: 'right', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }

  if (typeof document === 'undefined') return null
  return createPortal(
    <div ref={panelRef} tabIndex={-1} onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }} style={{
      position: 'fixed', top: anchor.y, left: anchor.x, width: 300, zIndex: 9999, outline: 'none',
      maxHeight: '78vh', overflowY: 'auto',
      background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8,
      padding: '6px 0 10px', boxShadow: '0 10px 28px rgba(0,0,0,0.75)',
    }}>
      <div style={{ position: 'sticky', top: 0, background: 'var(--bg-surface)', padding: '4px 12px 6px', fontSize: 9, color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '0.08em', borderBottom: '1px solid var(--border)', zIndex: 1 }}>
        CLIP SOUND — this clip only
      </div>

      {/* Sound / preset */}
      <div style={{ ...row, paddingTop: 9 }}>
        <span style={label}>Sound</span>
        <span style={{ flex: 1, fontSize: 10, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{presetLabel}</span>
        {canPreview && onPreviewSound && (
          <button onClick={onPreviewSound} title="Listen — plays middle C"
            style={{ border: 'none', background: 'transparent', color: CYAN, cursor: 'pointer', fontSize: 10, padding: '2px 4px', flexShrink: 0 }}>▶</button>
        )}
        {onChangeSound && (
          <button onClick={onChangeSound}
            style={{ fontSize: 9.5, fontWeight: 600, padding: '2px 8px', borderRadius: 4, cursor: 'pointer', border: '1px solid var(--border-light)', background: 'var(--bg-card)', color: 'var(--text-secondary)', flexShrink: 0 }}>
            Change…
          </button>
        )}
      </div>

      {/* Sustain — kept as its own control (not graphable, applies to the envelope) */}
      <div style={row}>
        <span style={label}>Sustain</span>
        <input type="range" min={0} max={4} step={0.05} value={sustain} style={{ flex: 1, accentColor: CYAN, minWidth: 0 }}
          onChange={e => setSustain(Number(e.target.value))}
          onPointerUp={() => commitSustain(sustain)} onKeyUp={() => commitSustain(sustain)} />
        <span style={value}>{sustain > 0 ? `${sustain.toFixed(2)}s` : 'Off'}</span>
      </div>
      <div style={{ padding: '0 12px 4px', fontSize: 8.5, color: 'var(--text-muted)', lineHeight: 1.4 }}>
        Ring past each note’s end, like a pedal.
      </div>

      {/* Everything else, shared with the preset & per-note editors */}
      <FxControls value={clip.rollFx} onCommit={commitFx} />

      <div style={{ padding: '8px 12px 0', fontSize: 8.5, color: 'var(--text-muted)', lineHeight: 1.4 }}>
        Applies to this clip’s notes only — live and on export. To bake a sound into a reusable, shareable preset, use the sound menu’s <strong>New preset</strong>.
      </div>
    </div>,
    document.body,
  )
}
