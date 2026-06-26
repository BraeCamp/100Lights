'use client'

import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Plus } from 'lucide-react'
import { useDaw, extractPeaks, makeAudioClip, makeMidiClip } from '@/lib/daw-state'
import { decodeAiff, encodeWav } from '@/lib/wav-codec'
import type { DawTrack, AudioClip, AutomationLane } from '@/lib/daw-types'
import { isAudioClip } from '@/lib/daw-types'
import type { AudioInputSource } from '@/lib/audio-capture'
import { AUDIO_INPUT_LABELS } from '@/lib/audio-capture'
import { libraryGetAll } from '@/lib/sound-library'
import { libraryFulfill } from '@/lib/default-samples'
import ClipView from './ClipView'
import EffectLaneView, { EFFECT_H } from './EffectLane'
import IsolateModal from './IsolateModal'
import ClipSettingsModal from './ClipSettingsModal'
import dynamic from 'next/dynamic'

const AutomationLaneView = dynamic(() => import('./AutomationLaneView'), { ssr: false })

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
  const { project, dispatch, engine, setEditTarget, setSelectedClipId, selectedClipId, setSelectedTrackId, selectedTrackId, selectedClipIds, setSelectedClipIds } = useDaw()
  const clips     = project.arrangementClips.filter(c => c.trackId === track.id)
  const autoLanes = project.automationLanes.filter(l => l.trackId === track.id)
  const dragHRef  = useRef<{ startY: number; startH: number } | null>(null)
  const [editing,    setEditing]    = useState(false)
  const [draft,      setDraft]      = useState(track.name)
  const [croppingClipId, setCroppingClipId] = useState<string | null>(null)
  const [settingsTarget, setSettingsTarget] = useState<AudioClip | null>(null)
  const [showFx,         setShowFx]         = useState(false)
  const [isolateTgt,     setIsolateTgt]     = useState<number | null>(null)

  // Escape exits crop mode
  useEffect(() => {
    if (!croppingClipId) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setCroppingClipId(null) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [croppingClipId])

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
      const clip = makeMidiClip(track.id, 'MIDI Clip', snapBeat(beatX, snap, project.timeSignatureNum), 4)
      dispatch({ type: 'ADD_CLIP', clip })
      setEditTarget({ type: 'midi-clip', clipId: clip.id })
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
          style={{ width: HDR_W, height: track.height, flexShrink: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 4, padding: '4px 8px', background: isSelected ? 'rgba(61,143,239,0.10)' : 'var(--bg-card)', borderRight: '1px solid var(--border)', borderBottom: '1px solid var(--border)', borderLeft: `3px solid ${track.color}`, boxSizing: 'border-box', overflow: 'hidden', cursor: 'pointer', transition: 'background 0.1s' }}
        >
          {editing ? (
            <input autoFocus value={draft} onChange={e => setDraft(e.target.value)}
              onBlur={() => { dispatch({ type: 'UPDATE_TRACK', trackId: track.id, patch: { name: draft } }); setEditing(false) }}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') { dispatch({ type: 'UPDATE_TRACK', trackId: track.id, patch: { name: draft } }); setEditing(false) } e.stopPropagation() }}
              style={{ fontSize: 11, background: '#111', border: '1px solid var(--accent)', color: 'var(--text-primary)', borderRadius: 3, padding: '1px 4px', outline: 'none' }}
            />
          ) : (
            <span onDoubleClick={() => { setEditing(true); setDraft(track.name) }} style={{ fontSize: 11, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', userSelect: 'none', cursor: 'default' }}>
              {track.name}
            </span>
          )}
          <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
            <button onClick={() => dispatch({ type: 'UPDATE_TRACK', trackId: track.id, patch: { mute: !track.mute } })}
              style={{ fontSize: 8, width: 16, height: 14, borderRadius: 2, border: '1px solid var(--border)', background: track.mute ? '#d97706' : 'var(--bg-surface)', color: track.mute ? '#fff' : 'var(--text-muted)', cursor: 'pointer', fontWeight: 700, padding: 0 }}>M</button>
            <button onClick={() => dispatch({ type: 'UPDATE_TRACK', trackId: track.id, patch: { solo: !track.solo } })}
              style={{ fontSize: 8, width: 16, height: 14, borderRadius: 2, border: '1px solid var(--border)', background: track.solo ? '#eab308' : 'var(--bg-surface)', color: track.solo ? '#000' : 'var(--text-muted)', cursor: 'pointer', fontWeight: 700, padding: 0 }}>S</button>
            {track.type === 'audio' && (<>
              {/* Arm button */}
              <button
                title={track.armed ? 'Disarm track' : 'Arm for recording'}
                onClick={e => { e.stopPropagation(); dispatch({ type: 'UPDATE_TRACK', trackId: track.id, patch: { armed: !track.armed } }) }}
                style={{ fontSize: 8, width: 16, height: 14, borderRadius: 2, border: `1px solid ${track.armed ? '#ef4444' : 'var(--border)'}`, background: track.armed ? 'rgba(239,68,68,0.2)' : 'var(--bg-surface)', color: track.armed ? '#ef4444' : 'var(--text-muted)', cursor: 'pointer', fontWeight: 700, padding: 0 }}>
                ●
              </button>
              {/* Input source cycler */}
              <button
                title={track.inputSource ? `Input: ${AUDIO_INPUT_LABELS[track.inputSource as AudioInputSource]} — click to change` : 'Set input source'}
                onClick={e => {
                  e.stopPropagation()
                  const next: (string | null)[] = [null, 'mic', 'system']
                  const cur = next.indexOf(track.inputSource ?? null)
                  dispatch({ type: 'UPDATE_TRACK', trackId: track.id, patch: { inputSource: next[(cur + 1) % next.length] } })
                }}
                style={{
                  fontSize: 7, height: 14, borderRadius: 2, padding: '0 3px',
                  border: `1px solid ${track.inputSource ? 'var(--accent)' : 'var(--border)'}`,
                  background: track.inputSource ? 'rgba(61,143,239,0.15)' : 'var(--bg-surface)',
                  color: track.inputSource ? 'var(--accent-light)' : 'var(--text-muted)',
                  cursor: 'pointer', fontWeight: 700, whiteSpace: 'nowrap',
                }}>
                {track.inputSource === 'mic' ? 'MIC' : track.inputSource === 'system' ? 'SYS' : '·IN'}
              </button>
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
              title="Open device panel"
              onClick={e => { e.stopPropagation(); setSelectedTrackId(track.id) }}
              style={{ fontSize: 9, width: 16, height: 14, borderRadius: 2, border: '1px solid var(--border)', background: 'var(--bg-surface)', color: 'var(--text-muted)', cursor: 'pointer', fontWeight: 700, padding: 0, flexShrink: 0 }}
            >⚙</button>
          </div>
        </div>

        {/* Lane */}
        <div
          data-testid="track-lane"
          data-track-id={track.id}
          data-track-type={track.type}
          style={{ flex: 1, height: track.height, position: 'relative', background: isSelected ? 'rgba(61,143,239,0.04)' : 'var(--bg-surface)', borderBottom: '1px solid var(--border)', overflow: 'hidden', transition: 'background 0.1s' }}
          onMouseDown={() => { setSelectedClipIds(new Set()); setSelectedClipId(null); setCroppingClipId(null) }}
          onDoubleClick={handleDoubleClick}
          onDragOver={e => e.preventDefault()}
          onDrop={handleDrop}
        >
          {Array.from({ length: Math.ceil(viewWidth / beatW / 4) + 1 }, (_, i) => {
            const x = i * 4 * beatW - scrollLeft
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
                  isCropping={croppingClipId === clip.id}
                  onDoubleClick={() => setEditTarget({ type: 'midi-clip', clipId: clip.id })}
                  onSettings={() => { if (isAudioClip(clip)) setSettingsTarget(clip) }}
                  onMove={(sb, tid, alt) => dispatch({ type: 'MOVE_CLIP', clipId: clip.id, startBeat: snapBeat(sb, alt ? 'off' : snap, project.timeSignatureNum), trackId: tid })}
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
