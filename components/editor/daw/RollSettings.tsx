'use client'

// Piano-roll clip sound settings: a ⚙ panel controlling effects that touch
// ONLY this clip's notes. Sustain (a release ramp past each note's end) is
// the headliner — it's what makes sampled instruments stop sounding gated —
// plus reverb, distortion, and a lowpass filter, and the clip's sound preset.

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Settings2 } from 'lucide-react'
import type { MidiClip } from '@/lib/daw-types'
import type { DawAction } from '@/lib/daw-state'
import { clampToViewport } from './menu-clamp'

const CYAN = '#a78bfa'

// Filter slider is log-mapped 200Hz…18kHz; the top of the range means "off"
const FILTER_OFF_V = 1
function vToHz(v: number): number | undefined {
  if (v >= 0.995) return undefined
  return Math.round(200 * Math.pow(90, v))
}
function hzToV(hz: number | undefined): number {
  if (hz === undefined || hz >= 17500) return FILTER_OFF_V
  return Math.log(hz / 200) / Math.log(90)
}

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
  const active = (rfx?.sustain ?? 0) > 0 || (rfx?.reverbWet ?? 0) > 0 || (rfx?.distortion ?? 0) > 0 || rfx?.filterHz !== undefined

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
  const [reverb, setReverb]   = useState(rfx?.reverbWet ?? 0)
  const [dist, setDist]       = useState(rfx?.distortion ?? 0)
  const [filterV, setFilterV] = useState(hzToV(rfx?.filterHz))

  // Different clip opened → mirror its stored settings
  useEffect(() => {
    const t = setTimeout(() => {  // async boundary — no sync setState in the effect
      setSustain(clip.rollFx?.sustain ?? 0)
      setReverb(clip.rollFx?.reverbWet ?? 0)
      setDist(clip.rollFx?.distortion ?? 0)
      setFilterV(hzToV(clip.rollFx?.filterHz))
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

  function commit() {
    const clean: NonNullable<MidiClip['rollFx']> = {}
    if (sustain > 0) clean.sustain = Math.round(sustain * 100) / 100
    if (reverb > 0)  clean.reverbWet = Math.round(reverb * 100) / 100
    if (dist > 0)    clean.distortion = Math.round(dist * 100) / 100
    const hz = vToHz(filterV)
    if (hz !== undefined) clean.filterHz = hz
    dispatch({
      type: 'UPDATE_CLIP', clipId: clip.id,
      patch: { rollFx: Object.keys(clean).length ? clean : undefined },
    })
  }

  const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, padding: '5px 12px' }
  const label: React.CSSProperties = { fontSize: 10, color: '#999', width: 62, flexShrink: 0 }
  const value: React.CSSProperties = { fontSize: 9.5, color: '#ccc', width: 46, textAlign: 'right', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }
  const slider: React.CSSProperties = { flex: 1, accentColor: CYAN, minWidth: 0 }

  const hz = vToHz(filterV)

  if (typeof document === 'undefined') return null
  return createPortal(
    <div ref={panelRef} tabIndex={-1} onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }} style={{
      position: 'fixed', top: anchor.y, left: anchor.x, width: 292, zIndex: 9999, outline: 'none',
      background: '#161616', border: '1px solid #2e2e2e', borderRadius: 8,
      padding: '6px 0 10px', boxShadow: '0 10px 28px rgba(0,0,0,0.75)',
    }}>
      <div style={{ padding: '4px 12px 6px', fontSize: 9, color: '#666', fontWeight: 700, letterSpacing: '0.08em', borderBottom: '1px solid #1e1e1e' }}>
        CLIP SOUND SETTINGS — this clip only
      </div>

      {/* Sound / preset */}
      <div style={{ ...row, paddingTop: 9 }}>
        <span style={label}>Sound</span>
        <span style={{ flex: 1, fontSize: 10, color: '#ccc', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{presetLabel}</span>
        {canPreview && onPreviewSound && (
          <button onClick={onPreviewSound} title="Listen — plays middle C"
            style={{ border: 'none', background: 'transparent', color: CYAN, cursor: 'pointer', fontSize: 10, padding: '2px 4px', flexShrink: 0 }}>▶</button>
        )}
        {onChangeSound && (
          <button onClick={onChangeSound}
            style={{ fontSize: 9.5, fontWeight: 600, padding: '2px 8px', borderRadius: 4, cursor: 'pointer', border: '1px solid #333', background: '#222', color: '#aaa', flexShrink: 0 }}>
            Change…
          </button>
        )}
      </div>
      <div style={{ padding: '0 12px 6px', fontSize: 8.5, color: '#555', lineHeight: 1.4 }}>
        The sound menu previews every preset with ▶ and shows note ranges.
      </div>

      {/* Sustain */}
      <div style={row}>
        <span style={label}>Sustain</span>
        <input type="range" min={0} max={4} step={0.05} value={sustain} style={slider}
          onChange={e => setSustain(Number(e.target.value))}
          onPointerUp={commit} onKeyUp={commit} />
        <span style={value}>{sustain > 0 ? `${sustain.toFixed(2)}s` : 'Off'}</span>
      </div>
      <div style={{ padding: '0 12px 6px', fontSize: 8.5, color: '#555', lineHeight: 1.4 }}>
        Lets each note ring out past its end instead of cutting — like a pedal.
      </div>

      {/* Reverb */}
      <div style={row}>
        <span style={label}>Reverb</span>
        <input type="range" min={0} max={1} step={0.02} value={reverb} style={slider}
          onChange={e => setReverb(Number(e.target.value))}
          onPointerUp={commit} onKeyUp={commit} />
        <span style={value}>{reverb > 0 ? `${Math.round(reverb * 100)}%` : 'Off'}</span>
      </div>

      {/* Distortion */}
      <div style={row}>
        <span style={label}>Distortion</span>
        <input type="range" min={0} max={1} step={0.02} value={dist} style={slider}
          onChange={e => setDist(Number(e.target.value))}
          onPointerUp={commit} onKeyUp={commit} />
        <span style={value}>{dist > 0 ? `${Math.round(dist * 100)}%` : 'Off'}</span>
      </div>

      {/* Lowpass filter */}
      <div style={row}>
        <span style={label}>Filter</span>
        <input type="range" min={0} max={1} step={0.005} value={filterV} style={slider}
          onChange={e => setFilterV(Number(e.target.value))}
          onPointerUp={commit} onKeyUp={commit} />
        <span style={value}>{hz === undefined ? 'Off' : hz >= 1000 ? `${(hz / 1000).toFixed(1)}k` : `${hz}Hz`}</span>
      </div>
      <div style={{ padding: '0 12px 0', fontSize: 8.5, color: '#555', lineHeight: 1.4 }}>
        Effects apply to this clip’s notes only — playing live and on export.
      </div>
    </div>,
    document.body,
  )
}
