'use client'

import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Plus } from 'lucide-react'
import { useDaw, extractPeaks, makeAudioClip, makeMidiClip } from '@/lib/daw-state'
import { decodeAiff, encodeWav } from '@/lib/wav-codec'
import type { DawTrack, AudioClip, AutomationLane } from '@/lib/daw-types'
import { isAudioClip, isMidiClip, TRACK_COLORS } from '@/lib/daw-types'
import TrackInputCard from './TrackInputCard'
// AudioInputSource and AUDIO_INPUT_LABELS removed — TrackInputCard handles device labels directly
import { libraryGetAll } from '@/lib/sound-library'
import { libraryFulfill } from '@/lib/default-samples'
import ClipView from './ClipView'
import EffectLaneView, { EFFECT_H } from './EffectLane'
import IsolateModal from './IsolateModal'
import ClipSettingsModal from './ClipSettingsModal'
import dynamic from 'next/dynamic'

const AutomationLaneView = dynamic(() => import('./AutomationLaneView'), { ssr: false })
const PianoRoll = dynamic(() => import('./PianoRoll'), { ssr: false })
const SoundLibrary = dynamic(() => import('../SoundLibrary'), { ssr: false })

export const HDR_W = 200
const AUTO_H = 60

export type SnapMode = 'off' | '1/16' | '1/8' | 'beat' | 'bar'

export function snapBeat(beat: number, mode: SnapMode, beatsPerBar = 4): number {
  if (mode === 'off')  return beat
  if (mode === 'bar')  return Math.round(beat / beatsPerBar) * beatsPerBar
  if (mode === 'beat') return Math.round(beat)
  if (mode === '1/8')  return Math.round(beat * 2) / 2
  if (mode === '1/16') return Math.round(beat * 4) / 4
  return beat
}

function AddAutoButton({ track }: { track: DawTrack }) {
  const { project, dispatch } = useDaw()
  const [open, setOpen]       = useState(false)
  const [dropPos, setDropPos] = useState({ top: 0, left: 0 })
  const btnRef  = useRef<HTMLButtonElement>(null)
  const dropRef = useRef<HTMLDivElement>(null)

  const existing = new Set(project.automationLanes.filter(l => l.trackId === track.id).map(l => l.parameter))
  const opts: { label: string; parameter: string; min: number; max: number; def: number }[] = [
    { label: 'Volume', parameter: 'volume', min: 0, max: 1, def: track.volume },
    { label: 'Pan',    parameter: 'pan',    min: -1, max: 1, def: track.pan },
    ...track.effects.map(e => ({ label: `${e.type.toUpperCase()} Wet`, parameter: `fx:${e.id}:wet`, min: 0, max: 1, def: 0.5 })),
  ].filter(o => !existing.has(o.parameter))

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (dropRef.current?.contains(e.target as Node)) return
      if (btnRef.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  function handleToggle() {
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      setDropPos({ top: r.bottom + 4, left: r.left })
    }
    setOpen(o => !o)
  }

  if (opts.length === 0) return null

  return (
    <>
      <button
        ref={btnRef}
        onClick={handleToggle}
        style={{ display: 'flex', alignItems: 'center', gap: 2, padding: '1px 4px', fontSize: 9, background: 'transparent', border: '1px solid var(--border)', borderRadius: 3, color: 'var(--text-muted)', cursor: 'pointer' }}
        title="Add automation lane"
      ><Plus size={8} /> A</button>
      {open && createPortal(
        <div ref={dropRef} style={{
          position: 'fixed', top: dropPos.top, left: dropPos.left,
          zIndex: 1000, background: '#2a2a2a', border: '1px solid var(--border)',
          borderRadius: 6, padding: '4px 0', minWidth: 130,
          boxShadow: '0 4px 16px rgba(0,0,0,0.6)',
        }}>
          {opts.map(o => (
            <button key={o.parameter} onClick={() => {
              dispatch({ type: 'ADD_AUTOMATION_LANE', lane: { id: crypto.randomUUID(), trackId: track.id, parameter: o.parameter, label: o.label, min: o.min, max: o.max, defaultValue: o.def, points: [], expanded: true } })
              setOpen(false)
            }}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '5px 12px', fontSize: 11, background: 'transparent', border: 'none', color: 'var(--text-primary)', cursor: 'pointer' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
            >{o.label}</button>
          ))}
        </div>,
        document.body
      )}
    </>
  )
}

function AutoLaneHeader({ lane, track }: { lane: AutomationLane; track: DawTrack }) {
  const { dispatch } = useDaw()
  return (
    <div style={{ width: HDR_W, height: AUTO_H, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 4, padding: '0 8px', background: '#181818', borderRight: '1px solid var(--border)', borderBottom: '1px solid var(--border)', borderLeft: `3px solid ${track.color}55`, boxSizing: 'border-box' }}>
      <div style={{ flex: 1, fontSize: 10, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {lane.label}
      </div>
      <button onClick={() => dispatch({ type: 'CLEAR_AUTOMATION_LANE', laneId: lane.id })} title="Clear" style={{ width: 16, height: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: '1px solid var(--border)', borderRadius: 2, color: 'var(--text-muted)', cursor: 'pointer', fontSize: 9, padding: 0, flexShrink: 0 }}>⌫</button>
      <button onClick={() => dispatch({ type: 'REMOVE_AUTOMATION_LANE', laneId: lane.id })} title="Remove lane" style={{ width: 16, height: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: '1px solid var(--border)', borderRadius: 2, color: 'var(--text-muted)', cursor: 'pointer', fontSize: 11, padding: 0, flexShrink: 0 }}>×</button>
    </div>
  )
}

export default function TrackRow({ track, beatW, scrollLeft, viewWidth, snap }: {
  track: DawTrack; beatW: number; scrollLeft: number; viewWidth: number; snap: SnapMode
}) {
  const { project, dispatch, engine, setEditTarget, setSelectedClipId, selectedClipId, setSelectedTrackId, selectedTrackId, selectedClipIds, setSelectedClipIds, setShowPads, expandedPianoRollClipId, setExpandedPianoRollClipId } = useDaw()
  const clips     = project.arrangementClips.filter(c => c.trackId === track.id)
  const autoLanes = project.automationLanes.filter(l => l.trackId === track.id)
  const dragHRef  = useRef<{ startY: number; startH: number } | null>(null)
  const [editing,    setEditing]    = useState(false)
  const [draft,      setDraft]      = useState(track.name)
  const [croppingClipId, setCroppingClipId] = useState<string | null>(null)
  const [settingsTarget, setSettingsTarget] = useState<AudioClip | null>(null)
  const [showFx,         setShowFx]         = useState(false)
  const [isolateTgt,     setIsolateTgt]     = useState<number | null>(null)
  const [showInputCard,  setShowInputCard]  = useState(false)
  const [trackCtxMenu,   setTrackCtxMenu]  = useState<{ x: number; y: number } | null>(null)
  const inputBtnRef        = useRef<HTMLButtonElement>(null)
  const multiDragOrigins   = useRef<Record<string, number>>({})
  const [showLibraryPicker, setShowLibraryPicker] = useState(false)

  // Escape exits crop mode
  useEffect(() => {
    if (!croppingClipId) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setCroppingClipId(null) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [croppingClipId])

  // Close track context menu on outside click / Escape
  useEffect(() => {
    if (!trackCtxMenu) return
    function onDown(e: MouseEvent) {
      const menu = document.getElementById(`tcm-${track.id}`)
      if (menu && !menu.contains(e.target as Node)) setTrackCtxMenu(null)
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setTrackCtxMenu(null) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [trackCtxMenu, track.id])

  function openDigitalMidi() {
    setSelectedTrackId(track.id)
    setShowPads(true)
  }

  function newMidiClip() {
    const newClip = makeMidiClip(track.id, 'MIDI Clip', engine.currentBeat, 4, { isDrumClip: track.type === 'drum' })
    dispatch({ type: 'ADD_CLIP', clip: newClip })
  }

  async function handlePickFromLibrary(entry: import('@/lib/sound-library').LibraryEntry) {
    setShowLibraryPicker(false)
    const fulfilled = entry.audioBlob ? entry : await libraryFulfill(entry.id)
    if (!fulfilled?.audioBlob) return
    const audioUrl = URL.createObjectURL(fulfilled.audioBlob)
    let peaks: number[] | undefined
    try {
      const ab = await fulfilled.audioBlob.arrayBuffer()
      const decoded = await engine.ctx.decodeAudioData(ab)
      peaks = extractPeaks(decoded, 200)
    } catch { /* leave peaks undefined */ }
    const targets = selectedClipIds.size > 0
      ? project.arrangementClips.filter(c => selectedClipIds.has(c.id) && isAudioClip(c))
      : clips.filter(c => selectedClipId === c.id && isAudioClip(c))
    for (const c of targets) {
      dispatch({ type: 'UPDATE_CLIP', clipId: c.id, patch: { audioUrl, waveformPeaks: peaks, bufferDuration: undefined } })
    }
  }

  // Auto-load waveform peaks for any audio clips that don't have them yet
  useEffect(() => {
    for (const clip of clips) {
      if (!isAudioClip(clip) || clip.waveformPeaks?.length) continue
      engine.loadClipBuffer(clip).then(buf => {
        if (!buf) return
        const peaks = extractPeaks(buf)
        dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch: { waveformPeaks: peaks, bufferDuration: buf.duration } })
      }).catch(() => {})
    }
  }, [clips]) // eslint-disable-line

  const viewStartBeat = scrollLeft / beatW
  const viewEndBeat   = (scrollLeft + viewWidth) / beatW
  const visibleClips  = clips.filter(c => c.startBeat + c.durationBeats >= viewStartBeat && c.startBeat <= viewEndBeat)

  async function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    const rect  = e.currentTarget.getBoundingClientRect()
    const beatX = (e.clientX - rect.left + scrollLeft) / beatW
    const libId = e.dataTransfer.getData('application/x-library-entry-id')
    if (libId) {
      const entries = await libraryGetAll()
      let entry = entries.find(en => en.id === libId)
      if (!entry) return
      if (!entry.audioBlob) {
        const fulfilled = await libraryFulfill(entry.id)
        if (!fulfilled?.audioBlob) return
        entry = fulfilled
      }
      const url  = URL.createObjectURL(entry.audioBlob!)
      const clip = makeAudioClip(track.id, entry.name, snapBeat(beatX, snap, project.timeSignatureNum), 8, { audioUrl: url })
      dispatch({ type: 'ADD_CLIP', clip })
      const buf = await engine.loadClipBuffer(clip)
      if (buf) {
        const peaks = extractPeaks(buf)
        dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch: { waveformPeaks: peaks, durationBeats: engine.secondsToBeats(buf.duration), bufferDuration: buf.duration } })
      }
    }
  }

  async function handleDoubleClick(e: React.MouseEvent) {
    const rect  = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const beatX = (e.clientX - rect.left + scrollLeft) / beatW
    if (track.type === 'audio') {
      const input = document.createElement('input'); input.type = 'file'; input.accept = 'audio/*'
      input.onchange = async () => {
        const file = input.files?.[0]; if (!file) return
        const ext  = file.name.split('.').pop()?.toLowerCase() ?? ''
        let ab = await file.arrayBuffer()
        let blobUrl: string

        if (ext === 'aif' || ext === 'aiff') {
          try {
            const { channels, sampleRate } = decodeAiff(ab)
            const wavBuf = encodeWav(channels, sampleRate)
            const wavBlob = new Blob([wavBuf], { type: 'audio/wav' })
            ab = wavBuf
            blobUrl = URL.createObjectURL(wavBlob)
          } catch {
            console.error('Could not decode AIFF file:', file.name)
            return
          }
        } else {
          blobUrl = URL.createObjectURL(file)
        }

        const clip = makeAudioClip(track.id, file.name.replace(/\.[^.]+$/, ''), snapBeat(beatX, snap, project.timeSignatureNum), 8, { audioUrl: blobUrl })
        dispatch({ type: 'ADD_CLIP', clip })
        const buf = await engine.loadBufferFromArrayBuffer(clip.id, ab)
        const peaks = extractPeaks(buf)
        dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch: { waveformPeaks: peaks, durationBeats: engine.secondsToBeats(buf.duration), bufferDuration: buf.duration } })
      }
      input.click()
    } else {
      const clip = makeMidiClip(track.id, 'MIDI Clip', snapBeat(beatX, snap, project.timeSignatureNum), 4, { isDrumClip: track.type === 'drum' })
      dispatch({ type: 'ADD_CLIP', clip })
      setExpandedPianoRollClipId(clip.id)
    }
  }

  const isSelected = selectedTrackId === track.id

  return (
    <div style={{ boxShadow: isSelected ? `inset 2px 0 0 var(--accent)` : 'none' }}>
      {/* Main track row */}
      <div style={{ display: 'flex', height: track.height, flexShrink: 0 }}>
        {/* Header */}
        <div
          onClick={e => { if (!(e.target as HTMLElement).closest('button,input,select')) setSelectedTrackId(track.id) }}
          onContextMenu={e => { e.preventDefault(); e.stopPropagation(); setTrackCtxMenu({ x: e.clientX, y: e.clientY }) }}
          style={{ width: HDR_W, height: track.height, flexShrink: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 4, padding: '4px 8px', background: isSelected ? 'rgba(61,143,239,0.10)' : 'var(--bg-card)', borderRight: '1px solid var(--border)', borderBottom: '1px solid var(--border)', borderLeft: `3px solid ${track.color}`, boxSizing: 'border-box', overflow: 'hidden', cursor: 'pointer', transition: 'background 0.1s' }}
        >
          {/* Name row */}
          <div style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
            {editing ? (
              <input autoFocus value={draft} onChange={e => setDraft(e.target.value)}
                onBlur={() => { dispatch({ type: 'UPDATE_TRACK', trackId: track.id, patch: { name: draft } }); setEditing(false) }}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') { dispatch({ type: 'UPDATE_TRACK', trackId: track.id, patch: { name: draft } }); setEditing(false) } e.stopPropagation() }}
                style={{ flex: 1, fontSize: 11, background: '#111', border: '1px solid var(--accent)', color: 'var(--text-primary)', borderRadius: 3, padding: '1px 4px', outline: 'none', minWidth: 0 }}
              />
            ) : (
              <span onDoubleClick={() => { setEditing(true); setDraft(track.name) }} style={{ flex: 1, fontSize: 11, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', userSelect: 'none', cursor: 'default' }}>
                {track.name}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
            <button onClick={() => dispatch({ type: 'UPDATE_TRACK', trackId: track.id, patch: { mute: !track.mute } })}
              style={{ fontSize: 8, width: 16, height: 14, borderRadius: 2, border: '1px solid var(--border)', background: track.mute ? '#d97706' : 'var(--bg-surface)', color: track.mute ? '#fff' : 'var(--text-muted)', cursor: 'pointer', fontWeight: 700, padding: 0 }}>M</button>
            <button onClick={() => dispatch({ type: 'UPDATE_TRACK', trackId: track.id, patch: { solo: !track.solo } })}
              style={{ fontSize: 8, width: 16, height: 14, borderRadius: 2, border: '1px solid var(--border)', background: track.solo ? '#eab308' : 'var(--bg-surface)', color: track.solo ? '#000' : 'var(--text-muted)', cursor: 'pointer', fontWeight: 700, padding: 0 }}>S</button>
            {track.type !== 'drum' && (<>
              {/* Arm button */}
              <button
                title={track.armed ? 'Disarm track' : 'Arm for recording'}
                onClick={e => { e.stopPropagation(); dispatch({ type: 'UPDATE_TRACK', trackId: track.id, patch: { armed: !track.armed } }) }}
                style={{ fontSize: 8, width: 16, height: 14, borderRadius: 2, border: `1px solid ${track.armed ? '#ef4444' : 'var(--border)'}`, background: track.armed ? 'rgba(239,68,68,0.2)' : 'var(--bg-surface)', color: track.armed ? '#ef4444' : 'var(--text-muted)', cursor: 'pointer', fontWeight: 700, padding: 0 }}>
                ●
              </button>
              {/* Input source — opens settings card */}
              <button
                ref={inputBtnRef}
                title="Audio input settings"
                onClick={e => { e.stopPropagation(); setShowInputCard(v => !v) }}
                style={{
                  fontSize: 7, height: 14, borderRadius: 2, padding: '0 3px',
                  border: `1px solid ${track.inputSource ? 'var(--accent)' : 'var(--border)'}`,
                  background: track.inputSource ? 'rgba(61,143,239,0.15)' : 'var(--bg-surface)',
                  color: track.inputSource ? 'var(--accent-light)' : 'var(--text-muted)',
                  cursor: 'pointer', fontWeight: 700, whiteSpace: 'nowrap',
                }}>
                {!track.inputSource ? '·IN' : track.inputSource === 'system' ? 'SYS' : 'MIC'}
              </button>
              {showInputCard && inputBtnRef.current && (
                <TrackInputCard
                  track={track}
                  anchorEl={inputBtnRef.current}
                  onClose={() => setShowInputCard(false)}
                />
              )}
            </>)}
            <input type="range" min={0} max={1} step={0.01} value={track.volume}
              onChange={e => { const v = parseFloat(e.target.value); dispatch({ type: 'UPDATE_TRACK', trackId: track.id, patch: { volume: v } }); engine.setTrackVolume(track.id, v) }}
              onClick={e => e.stopPropagation()}
              className="cf-slider" style={{ flex: 1, accentColor: track.color, minWidth: 0 }} />
            <AddAutoButton track={track} />
            <button
              title="Toggle effects lane"
              onClick={e => { e.stopPropagation(); setShowFx(v => !v) }}
              style={{ fontSize: 8, width: 22, height: 14, borderRadius: 2, border: `1px solid ${showFx ? 'var(--accent)' : 'var(--border)'}`, background: showFx ? 'var(--accent)' : 'var(--bg-surface)', color: showFx ? '#fff' : 'var(--text-muted)', cursor: 'pointer', fontWeight: 700, padding: 0, flexShrink: 0 }}
            >FX</button>
            <button
              title="Track settings (right-click for more)"
              onClick={e => { e.stopPropagation(); setSelectedTrackId(track.id) }}
              style={{ fontSize: 9, width: 16, height: 14, borderRadius: 2, border: '1px solid var(--border)', background: 'var(--bg-surface)', color: 'var(--text-muted)', cursor: 'pointer', fontWeight: 700, padding: 0, flexShrink: 0 }}
            >⚙</button>
          </div>
        </div>

        {/* Track header context menu */}
        {trackCtxMenu && createPortal(
          <div
            id={`tcm-${track.id}`}
            style={{
              position: 'fixed',
              top:  Math.min(trackCtxMenu.y, window.innerHeight - 320),
              left: Math.min(trackCtxMenu.x, window.innerWidth  - 200),
              zIndex: 9999, minWidth: 188,
              background: '#161616', border: '1px solid #2e2e2e',
              borderRadius: 8, boxShadow: '0 10px 28px rgba(0,0,0,0.75)',
              padding: '4px 0', userSelect: 'none',
            }}
          >
            {/* Track name header */}
            <div style={{ padding: '5px 12px 7px', borderBottom: '1px solid #222' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#ccc', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{track.name}</div>
              <div style={{ fontSize: 9, color: '#555', marginTop: 1, textTransform: 'uppercase', letterSpacing: '0.07em' }}>{track.type} track</div>
            </div>

            {/* Actions */}
            {[
              { label: 'Rename',    action: () => { setEditing(true); setDraft(track.name) } },
              { label: 'Duplicate', action: () => dispatch({ type: 'DUPLICATE_TRACK', trackId: track.id }) },
              { label: 'Delete',    action: () => dispatch({ type: 'REMOVE_TRACK',    trackId: track.id }), danger: true },
            ].map(({ label, action, danger }) => (
              <button key={label} onClick={() => { action(); setTrackCtxMenu(null) }}
                style={{ display: 'block', width: '100%', textAlign: 'left', padding: '6px 14px', fontSize: 11, color: danger ? '#f87171' : '#ccc', background: 'transparent', border: 'none', cursor: 'pointer' }}
                onMouseEnter={e => { (e.target as HTMLElement).style.background = danger ? 'rgba(239,68,68,0.10)' : 'rgba(255,255,255,0.06)' }}
                onMouseLeave={e => { (e.target as HTMLElement).style.background = 'transparent' }}
              >{label}</button>
            ))}

            {/* MIDI section */}
            {track.type !== 'drum' && (<>
              <div style={{ borderTop: '1px solid #222', margin: '3px 0' }} />
              <button onClick={() => { newMidiClip(); setTrackCtxMenu(null) }}
                style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', padding: '6px 14px', fontSize: 11, color: '#a78bfa', background: 'transparent', border: 'none', cursor: 'pointer' }}
                onMouseEnter={e => { (e.target as HTMLElement).style.background = 'rgba(167,139,250,0.10)' }}
                onMouseLeave={e => { (e.target as HTMLElement).style.background = 'transparent' }}
              >
                <span>♩</span>
                <span>New MIDI Clip</span>
              </button>
              <button onClick={() => { openDigitalMidi(); setTrackCtxMenu(null) }}
                style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', padding: '6px 14px', fontSize: 11, color: '#a78bfa', background: 'transparent', border: 'none', cursor: 'pointer' }}
                onMouseEnter={e => { (e.target as HTMLElement).style.background = 'rgba(167,139,250,0.10)' }}
                onMouseLeave={e => { (e.target as HTMLElement).style.background = 'transparent' }}
              >
                <span>🎹</span>
                <span>Open Digital MIDI</span>
              </button>
              {(() => {
                const midiClip = clips.find(c => isMidiClip(c))
                if (!midiClip) return null
                const isExpanded = expandedPianoRollClipId === midiClip.id
                return (
                  <button onClick={() => { setExpandedPianoRollClipId(isExpanded ? null : midiClip.id); setTrackCtxMenu(null) }}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', padding: '6px 14px', fontSize: 11, color: '#a78bfa', background: 'transparent', border: 'none', cursor: 'pointer' }}
                    onMouseEnter={e => { (e.target as HTMLElement).style.background = 'rgba(167,139,250,0.10)' }}
                    onMouseLeave={e => { (e.target as HTMLElement).style.background = 'transparent' }}
                  >
                    <span>▦</span>
                    <span>{isExpanded ? 'Close Piano Roll' : 'Open Piano Roll'}</span>
                  </button>
                )
              })()}
            </>)}

            {/* Mute / Solo */}
            <div style={{ borderTop: '1px solid #222', margin: '3px 0' }} />
            {[
              { label: track.mute ? 'Unmute'   : 'Mute',  action: () => dispatch({ type: 'UPDATE_TRACK', trackId: track.id, patch: { mute: !track.mute } }), active: track.mute },
              { label: track.solo ? 'Unsolo'   : 'Solo',  action: () => dispatch({ type: 'UPDATE_TRACK', trackId: track.id, patch: { solo: !track.solo } }), active: track.solo },
            ].map(({ label, action, active }) => (
              <button key={label} onClick={() => { action(); setTrackCtxMenu(null) }}
                style={{ display: 'block', width: '100%', textAlign: 'left', padding: '6px 14px', fontSize: 11, color: active ? '#facc15' : '#ccc', background: 'transparent', border: 'none', cursor: 'pointer' }}
                onMouseEnter={e => { (e.target as HTMLElement).style.background = 'rgba(255,255,255,0.06)' }}
                onMouseLeave={e => { (e.target as HTMLElement).style.background = 'transparent' }}
              >{label}</button>
            ))}

            {/* Color picker */}
            <div style={{ borderTop: '1px solid #222', margin: '3px 0', padding: '6px 12px' }}>
              <div style={{ fontSize: 9, color: '#555', marginBottom: 5, letterSpacing: '0.07em', textTransform: 'uppercase' }}>Color</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {TRACK_COLORS.map(c => (
                  <button key={c} title={c}
                    onClick={() => { dispatch({ type: 'UPDATE_TRACK', trackId: track.id, patch: { color: c } }); setTrackCtxMenu(null) }}
                    style={{ width: 16, height: 16, borderRadius: '50%', background: c, border: track.color === c ? '2px solid #fff' : '2px solid transparent', cursor: 'pointer', padding: 0, boxSizing: 'border-box' }}
                  />
                ))}
              </div>
            </div>

            {/* Height presets */}
            <div style={{ borderTop: '1px solid #222', margin: '0', padding: '6px 12px 8px' }}>
              <div style={{ fontSize: 9, color: '#555', marginBottom: 5, letterSpacing: '0.07em', textTransform: 'uppercase' }}>Height</div>
              <div style={{ display: 'flex', gap: 4 }}>
                {[['Compact', 40], ['Normal', 64], ['Tall', 120]] .map(([label, h]) => (
                  <button key={label}
                    onClick={() => { dispatch({ type: 'UPDATE_TRACK', trackId: track.id, patch: { height: h as number } }); setTrackCtxMenu(null) }}
                    style={{ flex: 1, fontSize: 9, padding: '3px 0', borderRadius: 4, cursor: 'pointer', border: `1px solid ${track.height === h ? 'var(--accent)' : '#2a2a2a'}`, background: track.height === h ? 'rgba(61,143,239,0.12)' : 'transparent', color: track.height === h ? 'var(--accent)' : '#666' }}
                  >{label}</button>
                ))}
              </div>
            </div>
          </div>,
          document.body
        )}

        {/* Lane */}
        <div
          data-testid="track-lane"
          data-track-id={track.id}
          data-track-type={track.type}
          style={{ flex: 1, height: track.height, position: 'relative', background: isSelected ? 'rgba(61,143,239,0.04)' : 'var(--bg-surface)', borderBottom: '1px solid var(--border)', overflow: 'hidden', transition: 'background 0.1s' }}
          onMouseDown={e => { if (!e.altKey) { setSelectedClipIds(new Set()); setSelectedClipId(null) }; setCroppingClipId(null) }}
          onDoubleClick={handleDoubleClick}
          onDragOver={e => e.preventDefault()}
          onDrop={handleDrop}
        >
          {Array.from({ length: Math.ceil(viewWidth / beatW / project.timeSignatureNum) + 1 }, (_, i) => {
            const x = i * project.timeSignatureNum * beatW - scrollLeft
            return x >= 0 && x <= viewWidth + 4 ? (
              <div key={i} style={{ position: 'absolute', left: x, top: 0, bottom: 0, width: 1, background: 'rgba(255,255,255,0.04)', pointerEvents: 'none' }} />
            ) : null
          })}
          <div style={{ position: 'absolute', top: 0, bottom: 0, left: -scrollLeft, width: (viewEndBeat + 10) * beatW }}>
            {visibleClips.map(clip => {
              const isClipSelected      = selectedClipId === clip.id
              const isMultiSelected = selectedClipIds.has(clip.id)
              return (
                <ClipView
                  key={clip.id}
                  clip={clip}
                  track={track} beatW={beatW}
                  selected={isClipSelected}
                  multiSelected={isMultiSelected}
                  onSelect={() => { setSelectedClipId(clip.id); setSelectedClipIds(new Set([clip.id])) }}
                  onShiftSelect={() => {
                    setSelectedClipIds(prev => {
                      const next = new Set(prev)
                      if (next.has(clip.id)) { next.delete(clip.id) } else { next.add(clip.id) }
                      return next
                    })
                    setSelectedClipId(clip.id)
                  }}
                  onDragStart={() => {
                    const origins: Record<string, number> = {}
                    for (const c of project.arrangementClips) {
                      if (selectedClipIds.has(c.id)) origins[c.id] = c.startBeat
                    }
                    multiDragOrigins.current = origins
                  }}
                  isCropping={croppingClipId === clip.id}
                  onDoubleClick={() => setExpandedPianoRollClipId(expandedPianoRollClipId === clip.id ? null : clip.id)}
                  onSettings={() => { if (isAudioClip(clip)) setSettingsTarget(clip) }}
                  onDeleteAll={() => {
                    const toDelete = selectedClipIds.size > 0 ? [...selectedClipIds] : [clip.id]
                    for (const id of toDelete) dispatch({ type: 'REMOVE_CLIP', clipId: id })
                    setSelectedClipIds(new Set())
                    setSelectedClipId(null)
                  }}
                  onReplaceSample={() => setShowLibraryPicker(true)}
                  onMove={(sb, tid, alt) => {
                    if (selectedClipIds.has(clip.id) && selectedClipIds.size > 1) {
                      const origin = multiDragOrigins.current[clip.id] ?? clip.startBeat
                      const delta  = sb - origin
                      const snappedNew = snapBeat(Math.max(0, origin + delta), alt ? 'off' : snap, project.timeSignatureNum)
                      const snappedDelta = snappedNew - origin
                      for (const c of project.arrangementClips) {
                        if (!selectedClipIds.has(c.id)) continue
                        const cOrigin = multiDragOrigins.current[c.id] ?? c.startBeat
                        dispatch({ type: 'MOVE_CLIP', clipId: c.id, startBeat: Math.max(0, cOrigin + snappedDelta), trackId: c.trackId })
                      }
                    } else {
                      dispatch({ type: 'MOVE_CLIP', clipId: clip.id, startBeat: snapBeat(sb, alt ? 'off' : snap, project.timeSignatureNum), trackId: tid })
                    }
                  }}
                  onResize={(db, alt) => {
                    const endBeat     = clip.startBeat + db
                    const snappedEnd  = alt ? endBeat : snapBeat(endBeat, snap, project.timeSignatureNum)
                    const newDurBeats = Math.max(0.125, snappedEnd - clip.startBeat)
                    const patch: Record<string, unknown> = { durationBeats: newDurBeats }
                    if (isAudioClip(clip) && clip.bufferDuration) {
                      const nativeSec = clip.bufferDuration - clip.trimStart - clip.trimEnd
                      const newDurSec = engine.beatsToSeconds(newDurBeats)
                      // Only enable loop when dragging past native duration. NEVER change trimEnd/trimStart.
                      if (newDurSec > nativeSec + 0.001) patch.loopEnabled = true
                    }
                    dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch })
                  }}
                  loopNativeBeats={isAudioClip(clip) && clip.loopEnabled && clip.bufferDuration
                    ? engine.secondsToBeats(clip.bufferDuration - clip.trimStart - clip.trimEnd)
                    : undefined}
                  onCrop={() => setCroppingClipId(prev => prev === clip.id ? null : clip.id)}
                  onCropChange={(ts, te) => dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch: { trimStart: ts, trimEnd: te } })}
                  onCropSnap={(b) => snapBeat(b, snap, project.timeSignatureNum)}
                  onIsolate={beat => setIsolateTgt(beat)}
                  onSplice={() => {
                    const playhead = engine.currentBeat
                    if (playhead <= clip.startBeat || playhead >= clip.startBeat + clip.durationBeats) return
                    const beatOffset = playhead - clip.startBeat
                    if (isAudioClip(clip) && clip.bufferDuration) {
                      const bufDur    = clip.bufferDuration
                      const nativeDur = bufDur - clip.trimStart - clip.trimEnd
                      const frac      = beatOffset / clip.durationBeats
                      const splitSec  = clip.trimStart + frac * nativeDur
                      const leftClip  = { ...clip, id: crypto.randomUUID(), durationBeats: beatOffset, trimEnd: Math.max(0, bufDur - splitSec) }
                      const rightClip = { ...clip, id: crypto.randomUUID(), startBeat: playhead, durationBeats: clip.durationBeats - beatOffset, trimStart: splitSec }
                      dispatch({ type: 'REMOVE_CLIP', clipId: clip.id })
                      dispatch({ type: 'ADD_CLIP', clip: leftClip })
                      dispatch({ type: 'ADD_CLIP', clip: rightClip })
                    } else if (!isAudioClip(clip)) {
                      // MIDI: notes before splice go left (truncated if they span), notes at/after go right
                      const leftNotes  = clip.notes.filter(n => n.startBeat < beatOffset).map(n => ({ ...n, durationBeats: Math.min(n.durationBeats, beatOffset - n.startBeat) }))
                      const rightNotes = clip.notes.filter(n => n.startBeat >= beatOffset).map(n => ({ ...n, id: crypto.randomUUID(), startBeat: n.startBeat - beatOffset }))
                      dispatch({ type: 'REMOVE_CLIP', clipId: clip.id })
                      dispatch({ type: 'ADD_CLIP', clip: { ...clip, id: crypto.randomUUID(), durationBeats: beatOffset, notes: leftNotes } })
                      dispatch({ type: 'ADD_CLIP', clip: { ...clip, id: crypto.randomUUID(), startBeat: playhead, durationBeats: clip.durationBeats - beatOffset, notes: rightNotes } })
                    }
                  }}
                  onDelete={() => dispatch({ type: 'REMOVE_CLIP', clipId: clip.id })}
                />
              )
            })}
            {/* Repeat handle */}
            {(() => {
              const sel = clips.filter(c => selectedClipIds.has(c.id))
              if (sel.length === 0) return null
              const rightmost = sel.reduce((a, b) => (a.startBeat + a.durationBeats >= b.startBeat + b.durationBeats ? a : b))
              const handleX   = (rightmost.startBeat + rightmost.durationBeats) * beatW + 2
              return (
                <div
                  title="Repeat selection"
                  style={{
                    position: 'absolute', left: handleX, top: '50%', transform: 'translateY(-50%)',
                    width: 18, height: 18, borderRadius: 9, background: '#3d8fef',
                    color: '#fff', fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: 'pointer', zIndex: 10, userSelect: 'none', boxShadow: '0 1px 4px rgba(0,0,0,0.5)',
                  }}
                  onClick={e => {
                    e.stopPropagation()
                    const allSelected = project.arrangementClips.filter(c => selectedClipIds.has(c.id))
                    if (allSelected.length === 0) return
                    const selStart = Math.min(...allSelected.map(c => c.startBeat))
                    const selEnd   = Math.max(...allSelected.map(c => c.startBeat + c.durationBeats))
                    const span     = selEnd - selStart
                    if (span <= 0) return
                    const newIds = new Set<string>()
                    for (const c of allSelected) {
                      const newClip = { ...c, id: crypto.randomUUID(), startBeat: c.startBeat + span }
                      dispatch({ type: 'ADD_CLIP', clip: newClip })
                      newIds.add(newClip.id)
                    }
                    setSelectedClipIds(newIds)
                  }}
                >»</div>
              )
            })()}
          </div>
          {/* Height resize handle */}
          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 4, cursor: 'ns-resize', zIndex: 2 }}
            onMouseDown={e => {
              e.stopPropagation()
              dragHRef.current = { startY: e.clientY, startH: track.height }
              function mm(ev: MouseEvent) { if (!dragHRef.current) return; dispatch({ type: 'UPDATE_TRACK', trackId: track.id, patch: { height: Math.max(32, dragHRef.current.startH + ev.clientY - dragHRef.current.startY) } }) }
              function mu() { dragHRef.current = null; document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', mu) }
              document.addEventListener('mousemove', mm); document.addEventListener('mouseup', mu)
            }}
          />
        </div>
      </div>

      {/* Automation lane rows */}
      {autoLanes.map(lane => (
        <div key={lane.id} style={{ display: 'flex', height: AUTO_H, flexShrink: 0 }}>
          <AutoLaneHeader lane={lane} track={track} />
          <div style={{ flex: 1, height: AUTO_H, overflow: 'hidden', borderBottom: '1px solid var(--border)', background: '#1a1a1a' }}>
            <AutomationLaneView
              lane={lane}
              beatWidth={beatW}
              viewStartBeat={scrollLeft / beatW}
              height={AUTO_H}
            />
          </div>
        </div>
      ))}

      {/* Effects lane */}
      {showFx && (
        <div style={{ display: 'flex', flexShrink: 0, alignItems: 'stretch' }}>
          <div style={{ width: HDR_W, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6, padding: '0 8px', background: 'rgba(0,0,0,0.3)', borderRight: '1px solid var(--border)', borderBottom: '1px solid var(--border)', borderLeft: `3px solid ${track.color}`, boxSizing: 'border-box' }}>
            <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: 1, textTransform: 'uppercase' }}>FX</span>
            <span style={{ fontSize: 9, color: 'var(--text-muted)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {(project.clipEffects ?? []).filter(e => e.trackId === track.id).length === 0
                ? 'right-click lane to add'
                : (project.clipEffects ?? []).filter(e => e.trackId === track.id).map(e => e.type).join(', ')}
            </span>
          </div>
          <EffectLaneView
            trackId={track.id}
            beatW={beatW}
            scrollLeft={scrollLeft}
            viewWidth={viewWidth}
          />
        </div>
      )}

      {/* Inline Piano Roll — shown when a MIDI clip on this track is expanded */}
      {(() => {
        const expandedClip = clips.find(c => isMidiClip(c) && c.id === expandedPianoRollClipId)
        if (!expandedClip) return null
        return (
          <div style={{ display: 'flex', flexShrink: 0, alignItems: 'stretch' }}>
            <div style={{ width: HDR_W, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6, padding: '0 8px', background: 'rgba(0,0,0,0.3)', borderRight: '1px solid var(--border)', borderBottom: '1px solid var(--border)', borderLeft: `3px solid ${track.color}`, boxSizing: 'border-box' }}>
              <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: 1, textTransform: 'uppercase' }}>ROLL</span>
              <span style={{ fontSize: 9, color: 'var(--text-muted)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{expandedClip.name}</span>
              <button onClick={() => setExpandedPianoRollClipId(null)} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 11, padding: '0 2px' }} title="Close piano roll">✕</button>
            </div>
            <div style={{ flex: 1, height: 240, overflow: 'hidden' }}>
              <PianoRoll clipId={expandedClip.id} />
            </div>
          </div>
        )
      })()}

      {showLibraryPicker && createPortal(
        <div style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onMouseDown={e => { if (e.target === e.currentTarget) setShowLibraryPicker(false) }}>
          <div style={{ width: 480, height: 620, background: '#1e1e1e', borderRadius: 10, border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 16px 48px rgba(0,0,0,0.8)' }}>
            <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Replace Sample</span>
              <button onClick={() => setShowLibraryPicker(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 16, lineHeight: 1 }}>✕</button>
            </div>
            <div style={{ flex: 1, overflow: 'hidden' }}>
              <SoundLibrary embedded onPick={handlePickFromLibrary} />
            </div>
          </div>
        </div>,
        document.body
      )}

      {settingsTarget && (
        <ClipSettingsModal
          clip={project.arrangementClips.find(c => c.id === settingsTarget.id && c.kind === 'audio') as AudioClip ?? settingsTarget}
          onClose={() => setSettingsTarget(null)}
        />
      )}
      {isolateTgt !== null && (
        <IsolateModal
          trackId={track.id}
          initialBeat={isolateTgt}
          onClose={() => setIsolateTgt(null)}
        />
      )}
    </div>
  )
}
