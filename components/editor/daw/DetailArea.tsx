'use client'

// The detail area: the bottom of the screen, two panes tall.
//
// Live's screen ends in a detail area — the Clip View (what the selected clip
// IS: its name, where it sits, how long it is, whether it loops) sitting
// above the Device View (what the selected track does to its sound). Beacon
// had only the device half, and the clip's own settings were scattered over
// a context menu, a modal and the inspector. This is the container both live
// in: each pane shows or hides on its own (⌘⌥3, ⌘⌥4, the toggles at the
// bottom right), each keeps its own dragged height, Shift+Tab flips keyboard
// focus between them, and ⌘⌥E stretches the whole area for close work.
//
// The clip pane here is the frame and the essentials; Batch 2 (the note
// editor) and Batch 3 (the audio clip editor) render into it.

import { useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { X, Keyboard, PanelBottom, Music2, Maximize2, Minimize2 } from 'lucide-react'
import { useDaw, formatBeat } from '@/lib/daw-state'
import { isMidiClip, isAudioClip } from '@/lib/daw-types'
import { useResizable, ResizeHandle } from './useResizable'
import { useDetail, toggleDetail } from '@/lib/detail-area'
import { keysFor } from '@/lib/keymap'

const DeviceChain = dynamic(() => import('./DeviceChain'), { ssr: false })
const ReturnDeviceChain = dynamic(() => import('./DeviceChain').then(m => ({ default: m.ReturnDeviceChain })), { ssr: false })
const InstrumentPicker = dynamic(() => import('./InstrumentPicker'), { ssr: false })

const tabBtn = (on: boolean): React.CSSProperties => ({
  background: on ? 'var(--bg-card)' : 'transparent',
  border: on ? '1px solid var(--border)' : '1px solid transparent',
  borderRadius: 4, color: on ? 'var(--text-primary)' : 'var(--text-muted)',
  cursor: 'pointer', fontSize: 11, padding: '2px 10px', textTransform: 'capitalize',
})

export default function DetailArea() {
  const {
    project, dispatch,
    selectedTrackId, setSelectedTrackId, selectedReturnId, setSelectedReturnId,
    selectedClipId, setSelectedClipId,
    showPads, setShowPads,
    expandedPianoRollClipId, setExpandedPianoRollClipId,
  } = useDaw()
  const detail = useDetail()
  const [bottomTab, setBottomTab] = useState<'devices' | 'instrument'>('devices')
  useEffect(() => { setBottomTab('devices') }, [selectedTrackId])

  const clipResize = useResizable({ key: 'detail-clip', initial: 96, min: 64, max: 320, axis: 'y', invert: true })
  const deviceResize = useResizable({ key: 'bottom-panel', initial: 220, min: 120, max: 560, axis: 'y', invert: true })

  const clipRef = useRef<HTMLDivElement>(null)
  const deviceRef = useRef<HTMLDivElement>(null)

  // Shift+Tab flips focus between the two panes (lib/keymap.ts 'detail.flip'
  // arrives as an event from the studio's key handler).
  useEffect(() => {
    function onFlip() {
      const inClip = clipRef.current?.contains(document.activeElement)
      const target = (inClip ? deviceRef.current : clipRef.current) ?? deviceRef.current ?? clipRef.current
      const focusable = target?.querySelector<HTMLElement>('button, input, select, [tabindex="0"], [role="slider"]')
      ;(focusable ?? target)?.focus?.({ preventScroll: true })
    }
    window.addEventListener('100lights:detail-flip', onFlip)
    return () => window.removeEventListener('100lights:detail-flip', onFlip)
  }, [])

  const hasTrack = selectedTrackId !== null || selectedReturnId !== null
  const clip = selectedClipId ? project.arrangementClips.find(c => c.id === selectedClipId) ?? null : null
  const showClip = detail.clip && (!!clip || hasTrack)
  const showDevice = detail.device && hasTrack
  if (!showClip && !showDevice) return null

  const full = detail.full
  const clipH = full ? Math.max(clipResize.size, 160) : clipResize.size
  const deviceH = full ? '48vh' : deviceResize.size

  return (
    <div data-help-id="detail-area" data-detail-full={full || undefined}
      style={{ flexShrink: 0, borderTop: '1px solid var(--border)', background: 'var(--bg-base)', position: 'relative', display: 'flex', flexDirection: 'column' }}>
      {/* ── Clip pane ── */}
      {showClip && (
        <div ref={clipRef} data-help-id="detail-clip" data-detail-pane="clip" tabIndex={-1}
          style={{ position: 'relative', borderBottom: showDevice ? '1px solid var(--border)' : undefined, outline: 'none' }}>
          <ResizeHandle axis="y" edge="top" onPointerDown={clipResize.handleProps.onPointerDown} />
          <div style={{ height: clipH, overflow: 'auto' }}>
            <ClipPane clip={clip} />
          </div>
        </div>
      )}

      {/* ── Device pane ── */}
      {showDevice && (
        <div ref={deviceRef} data-help-id="detail-device" data-detail-pane="device" tabIndex={-1} style={{ position: 'relative', outline: 'none' }}>
          {!showClip && <ResizeHandle axis="y" edge="top" onPointerDown={deviceResize.handleProps.onPointerDown} />}
          {showClip && <ResizeHandle axis="y" edge="top" onPointerDown={deviceResize.handleProps.onPointerDown} />}
          {/* Tab bar */}
          <div style={{ height: 28, display: 'flex', alignItems: 'center', gap: 1, padding: '0 8px', background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)' }}>
            {selectedTrackId && (['devices', 'instrument'] as const).map(tab => (
              <button key={tab} onClick={() => setBottomTab(tab)} data-help-id={`bottom-${tab}`} aria-pressed={bottomTab === tab} style={tabBtn(bottomTab === tab)}>
                {tab === 'devices' ? 'Devices' : 'Instrument'}
              </button>
            ))}
            {(() => {
              if (selectedTrackId) {
                const t = project.tracks.find(tr => tr.id === selectedTrackId)
                return t ? <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 8, borderLeft: `2px solid ${t.color}`, paddingLeft: 6 }}>{t.name}</span> : null
              }
              if (selectedReturnId) {
                const rt = project.returnTracks.find(r => r.id === selectedReturnId)
                return rt ? <span style={{ fontSize: 10, color: 'var(--accent-light)', marginLeft: 8, borderLeft: `2px solid ${rt.color}`, paddingLeft: 6 }}>{rt.name} — FX</span> : null
              }
              return null
            })()}
            {/* Pad Input toggle — whenever the track has an instrument */}
            {selectedTrackId && (() => {
              const t = project.tracks.find(tr => tr.id === selectedTrackId)
              return t && (t.type !== 'audio' || t.instrument.type !== 'none') ? (
                <button onClick={() => setShowPads(v => !v)} title="Open pad / keyboard input" data-help-id="pads" aria-pressed={showPads}
                  style={{ marginLeft: 8, background: showPads ? 'var(--accent)' : 'transparent', border: showPads ? '1px solid var(--accent)' : '1px solid var(--border)', borderRadius: 4, color: showPads ? 'var(--accent-contrast)' : 'var(--text-muted)', cursor: 'pointer', fontSize: 11, padding: '2px 8px' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Keyboard size={12} /> Pads</span>
                </button>
              ) : null
            })()}
            <button onClick={() => { setSelectedTrackId(null); setSelectedReturnId(null) }}
              style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: '0 4px' }}
              title="Close panel" aria-label="Close the device pane"><X size={16} /></button>
          </div>
          <div style={{ height: deviceH, overflowY: 'auto', overflowX: 'auto' }}>
            {selectedTrackId && bottomTab === 'devices'    && <DeviceChain trackId={selectedTrackId} />}
            {selectedTrackId && bottomTab === 'instrument' && <InstrumentPicker trackId={selectedTrackId} />}
            {selectedReturnId && <ReturnDeviceChain returnId={selectedReturnId} />}
          </div>
        </div>
      )}

      {/* ── View toggles, bottom right — Live's selectors ── */}
      <div data-help-id="detail-toggles" style={{ position: 'absolute', right: 6, bottom: 6, display: 'flex', gap: 3, zIndex: 5 }}>
        <PaneToggle on={detail.clip} title={`Clip pane (${keysFor('detail.clip') ?? '⌘⌥3'})`} label="clip pane" onClick={() => toggleDetail('clip')}><Music2 size={12} /></PaneToggle>
        <PaneToggle on={detail.device} title={`Device pane (${keysFor('detail.device') ?? '⌘⌥4'})`} label="device pane" onClick={() => toggleDetail('device')}><PanelBottom size={12} /></PaneToggle>
        <PaneToggle on={detail.full} title={`${full ? 'Normal' : 'Full'} size (${keysFor('detail.full') ?? '⌘⌥E'})`} label="full size" onClick={() => toggleDetail('full')}>{full ? <Minimize2 size={12} /> : <Maximize2 size={12} />}</PaneToggle>
      </div>
    </div>
  )

  // The clip pane: what the selected clip is, and the few things about it a
  // person changes most — its name, whether it plays, whether it loops.
  function ClipPane({ clip }: { clip: (typeof project.arrangementClips)[number] | null }) {
    if (!clip) {
      return (
        <div style={{ padding: '10px 12px', fontSize: 11, color: 'var(--text-muted)' }}>
          Select a clip to see it here — its name, where it sits, and whether it loops.
        </div>
      )
    }
    const track = project.tracks.find(t => t.id === clip.trackId)
    const num = project.timeSignatureNum ?? 4
    const midi = isMidiClip(clip)
    const audio = isAudioClip(clip)
    const loop = midi ? clip.loopEnabled === true : audio ? clip.loopEnabled : false
    const active = clip.active !== false
    const inRoll = expandedPianoRollClipId === clip.id
    const field: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 2, minWidth: 64 }
    const lab: React.CSSProperties = { fontSize: 8, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)' }
    const val: React.CSSProperties = { fontSize: 11, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }
    const btn = (on: boolean): React.CSSProperties => ({
      fontSize: 10, padding: '2px 8px', borderRadius: 4, cursor: 'pointer',
      border: on ? '1px solid var(--accent)' : '1px solid var(--border)',
      background: on ? 'rgb(var(--accent-rgb) / 0.18)' : 'var(--bg-card)',
      color: on ? 'var(--accent)' : 'var(--text-secondary)',
    })
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '8px 12px', flexWrap: 'wrap' }}>
        <div style={{ ...field, minWidth: 140 }}>
          <span style={lab}>{midi ? 'MIDI clip' : 'Audio clip'}{track ? ` · ${track.name}` : ''}</span>
          <input
            value={clip.name}
            aria-label="Clip name"
            data-help-id="clip-name"
            onChange={e => dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch: { name: e.target.value } })}
            style={{ fontSize: 12, fontWeight: 600, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderLeft: `3px solid ${track?.color ?? 'var(--accent)'}`, borderRadius: 4, color: 'var(--text-primary)', padding: '2px 6px', width: 160 }}
          />
        </div>
        <div style={field}><span style={lab}>Start</span><span style={val}>{formatBeat(clip.startBeat, num)}</span></div>
        <div style={field}><span style={lab}>Length</span><span style={val}>{(clip.durationBeats / num).toFixed(2)} bars</span></div>
        {midi && <div style={field}><span style={lab}>Notes</span><span style={val}>{clip.notes.length}</span></div>}
        {audio && <div style={field}><span style={lab}>Gain</span><span style={val}>{clip.gain > 0.0001 ? `${(20 * Math.log10(clip.gain)).toFixed(1)} dB` : '-inf'}</span></div>}
        <div style={{ display: 'flex', gap: 6, marginLeft: 'auto', alignItems: 'center' }}>
          <button style={btn(loop)} aria-pressed={loop} data-help-id="clip-loop"
            title={midi ? 'Repeat the notes across the clip' : 'Loop the audio across the clip'}
            onClick={() => dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch: midi ? { loopEnabled: !loop, loopLengthBeats: !loop ? Math.max(1, clip.loopLengthBeats ?? Math.min(clip.durationBeats, num)) : undefined } : { loopEnabled: !loop } })}>
            Loop
          </button>
          <button style={btn(active)} aria-pressed={active} data-help-id="clip-active" title={`${active ? 'Deactivate' : 'Activate'} — kept in place, dimmed, silent (${keysFor('clip.activate') ?? '0'})`}
            onClick={() => dispatch({ type: 'SET_CLIPS_ACTIVE', clipIds: [clip.id], active: !active })}>
            {active ? 'On' : 'Off'}
          </button>
          {midi && (
            <button style={btn(inRoll)} aria-pressed={inRoll} data-help-id="clip-open-roll" title="Open this clip in the piano roll"
              onClick={() => { setExpandedPianoRollClipId(inRoll ? null : clip.id); setSelectedClipId(clip.id) }}>
              Piano roll
            </button>
          )}
        </div>
      </div>
    )
  }
}

function PaneToggle({ on, title, label, onClick, children }: { on: boolean; title: string; label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} title={title} aria-label={title} aria-pressed={on} data-help-id={`detail-toggle-${label.split(' ')[0]}`}
      style={{
        width: 22, height: 18, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 3, cursor: 'pointer',
        border: '1px solid var(--border)', background: on ? 'rgb(var(--accent-rgb) / 0.18)' : 'var(--bg-surface)', color: on ? 'var(--accent)' : 'var(--text-muted)',
      }}>{children}</button>
  )
}
