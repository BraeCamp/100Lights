'use client'

import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Plus } from 'lucide-react'
import { useDaw, extractPeaks, makeAudioClip, makeMidiClip } from '@/lib/daw-state'
import { CHORD_RECIPES, buildRecipeClip } from '@/lib/practice-recipes'
import { decodeAiff, encodeWav } from '@/lib/wav-codec'
import type { DawTrack, AudioClip, AutomationLane, TakeLane } from '@/lib/daw-types'
import { isAudioClip, isMidiClip, TRACK_COLORS } from '@/lib/daw-types'
import TrackInputCard from './TrackInputCard'
// AudioInputSource and AUDIO_INPUT_LABELS removed — TrackInputCard handles device labels directly
import { libraryGetAll } from '@/lib/sound-library'
import { libraryFulfill } from '@/lib/default-samples'
import ClipView from './ClipView'
import EffectLaneView, { EFFECT_H } from './EffectLane'
import IsolateModal from './IsolateModal'
import ClipSettingsModal from './ClipSettingsModal'
// Lazy: STFT worker + editor UI only load when the spectral editor is opened
const SpectralEditorModal = dynamic(() => import('./SpectralEditorModal'), { ssr: false })
import dynamic from 'next/dynamic'

const AutomationLaneView = dynamic(() => import('./AutomationLaneView'), { ssr: false })
const PianoRoll = dynamic(() => import('./PianoRoll'), { ssr: false })
const SoundLibrary = dynamic(() => import('../SoundLibrary'), { ssr: false })

export const HDR_W = 200
const AUTO_H = 60
const TAKE_H = 32

// ── VU Meter ──────────────────────────────────────────────────────────────────

export function VUMeter({ deviceId, active }: { deviceId: string | null | undefined; active: boolean }) {
  const [level, setLevel] = useState(0)
  const animRef   = useRef<number | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const ctxRef    = useRef<AudioContext | null>(null)

  useEffect(() => {
    if (!active || !deviceId) {
      setLevel(0)
      return
    }
    const capturedDeviceId = deviceId
    let cancelled = false

    async function setup() {
      try {
        const constraints = capturedDeviceId === 'mic'
          ? { audio: true }
          : { audio: { deviceId: { exact: capturedDeviceId } } }
        const stream = await navigator.mediaDevices.getUserMedia(constraints)
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return }
        streamRef.current = stream
        const ctx = new AudioContext()
        ctxRef.current = ctx
        const source   = ctx.createMediaStreamSource(stream)
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 256
        source.connect(analyser)
        const data = new Float32Array(analyser.fftSize)

        function tick() {
          analyser.getFloatTimeDomainData(data)
          let rms = 0
          for (const v of data) rms += v * v
          rms = Math.sqrt(rms / data.length)
          setLevel(Math.min(1, rms * 6))
          animRef.current = requestAnimationFrame(tick)
        }
        animRef.current = requestAnimationFrame(tick)
      } catch { /* permission denied or no device */ }
    }
    setup()

    return () => {
      cancelled = true
      if (animRef.current) cancelAnimationFrame(animRef.current)
      streamRef.current?.getTracks().forEach(t => t.stop())
      streamRef.current = null
      ctxRef.current?.close().catch(() => {})
      ctxRef.current = null
    }
  }, [active, deviceId])

  const pct   = Math.round(level * 100)
  const color = pct > 80 ? '#ef4444' : pct > 60 ? '#f97316' : '#22c55e'

  return (
    <div style={{
      width: 6, height: 40, background: 'var(--border)', borderRadius: 3,
      overflow: 'hidden', flexShrink: 0, position: 'relative',
    }}>
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0,
        height: `${pct}%`,
        background: color,
        transition: 'height 50ms, background 100ms',
        borderRadius: 3,
      }} />
    </div>
  )
}

export type SnapMode = 'off' | '1/16' | '1/8' | 'beat' | 'bar'

export function snapBeat(beat: number, mode: SnapMode, beatsPerBar = 4): number {
  if (mode === 'off')  return beat
  if (mode === 'bar')  return Math.round(beat / beatsPerBar) * beatsPerBar
  if (mode === 'beat') return Math.round(beat)
  if (mode === '1/8')  return Math.round(beat * 2) / 2
  if (mode === '1/16') return Math.round(beat * 4) / 4
  return beat
}

// Snap beat to nearest clip start/end edge across all tracks (within threshold beats).
// excludeIds: clip IDs being dragged (skip to avoid self-snap).
function snapToClipEdges(beat: number, excludeIds: Set<string>, thresholdBeats: number, clips: import('@/lib/daw-types').DawClip[]): number {
  let nearest = beat
  let nearestDist = thresholdBeats
  for (const c of clips) {
    if (excludeIds.has(c.id)) continue
    const dStart = Math.abs(beat - c.startBeat)
    const dEnd   = Math.abs(beat - (c.startBeat + c.durationBeats))
    if (dStart < nearestDist) { nearest = c.startBeat; nearestDist = dStart }
    if (dEnd   < nearestDist) { nearest = c.startBeat + c.durationBeats; nearestDist = dEnd }
  }
  return nearest
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
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
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
        data-help-id="automation"
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

export default function TrackRow({ track, beatW, scrollLeft, viewWidth, snap, onScrollBy, waveformZoom, selectedTrackIds, onSelectTrack, foldedGroups, onToggleFold, onGroupTracks, rippleEdit, onCopyClips, onPasteClips, onCopyEffects, onPasteEffects }: {
  track: DawTrack; beatW: number; scrollLeft: number; viewWidth: number; snap: SnapMode
  onScrollBy?: (delta: number) => void
  waveformZoom?: number
  selectedTrackIds?: Set<string>
  onSelectTrack?: (ctrl: boolean) => void
  foldedGroups?: Set<string>
  onToggleFold?: () => void
  onGroupTracks?: () => void
  rippleEdit?: boolean
  onCopyClips?: (ids: Set<string>) => void
  onPasteClips?: () => void
  onCopyEffects?: (ids: Set<string>) => void
  onPasteEffects?: () => void
}) {
  const { project, dispatch, engine, setEditTarget, setSelectedClipId, selectedClipId, setSelectedTrackId, selectedTrackId, selectedClipIds, setSelectedClipIds, selectedEffectIds, setSelectedEffectIds, setShowPads, expandedPianoRollClipId, setExpandedPianoRollClipId, recording, audioMode, blinkIds, collabPeers } = useDaw()
  const clips     = project.arrangementClips.filter(c => c.trackId === track.id)
  const autoLanes = project.automationLanes.filter(l => l.trackId === track.id)
  const takeLanes = project.takeLanes.filter(l => l.trackId === track.id)
  const dragHRef  = useRef<{ startY: number; startH: number } | null>(null)
  const [editing,    setEditing]    = useState(false)
  const [draft,      setDraft]      = useState(track.name)
  const cancelRenameRef = useRef(false)
  const [croppingClipId, setCroppingClipId] = useState<string | null>(null)
  const [rollTall, setRollTall] = useState(false)  // expanded piano roll fills most of the viewport
  // Originals captured when an edge-resize starts on a stretchNotes clip
  const stretchOriginRef = useRef<{ clipId: string; durationBeats: number; notes: import('@/lib/daw-types').MidiNote[] } | null>(null)
  const [settingsTarget, setSettingsTarget] = useState<AudioClip | null>(null)
  const [spectralTarget, setSpectralTarget] = useState<AudioClip | null>(null)
  const [showFx,         setShowFx]         = useState(false)
  const [isolateTgt,     setIsolateTgt]     = useState<number | null>(null)
  const [showInputCard,  setShowInputCard]  = useState(false)
  const [trackCtxMenu,   setTrackCtxMenu]  = useState<{ x: number; y: number } | null>(null)
  const [laneCtxMenu,    setLaneCtxMenu]   = useState<{ x: number; y: number; beat: number } | null>(null)
  const frozen = track.frozen ?? false
  const [takesExpanded,  setTakesExpanded]  = useState(false)
  const [takeLaneCtx,    setTakeLaneCtx]   = useState<{ x: number; y: number; lane: TakeLane; clip: AudioClip } | null>(null)
  const inputBtnRef        = useRef<HTMLButtonElement>(null)
  const multiDragOrigins   = useRef<Record<string, number>>({})
  const rippleOriginsRef   = useRef<Record<string, number>>({})
  const [showLibraryPicker, setShowLibraryPicker] = useState(false)

  // Keep a ref to project for stable closures in event listeners
  const projectRef = useRef(project)
  useEffect(() => { projectRef.current = project }, [project])

  // Check if this track is a group parent
  const isGroupParent = project.tracks.some(t => t.groupId === track.id)
  const isFolded = foldedGroups?.has(track.id) ?? false
  const isMultiSelected = selectedTrackIds?.has(track.id) ?? false
  const isIndented = !!track.groupId

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

  // Close lane context menu on outside click / Escape
  useEffect(() => {
    if (!laneCtxMenu) return
    function onDown(e: MouseEvent) {
      const menu = document.getElementById(`lcm-${track.id}`)
      if (menu && !menu.contains(e.target as Node)) setLaneCtxMenu(null)
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setLaneCtxMenu(null) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [laneCtxMenu, track.id])

  // Close take lane context menu on outside click
  useEffect(() => {
    if (!takeLaneCtx) return
    function onDown() { setTakeLaneCtx(null) }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [takeLaneCtx])


  function openDigitalMidi() {
    setSelectedTrackId(track.id)
    setShowPads(true)
  }

  function newMidiClip() {
    const newClip = makeMidiClip(track.id, 'MIDI Clip', engine.currentBeat, 4, { isDrumClip: track.instrument.type === 'drum' })
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
    const recipeId = e.dataTransfer.getData('application/x-recipe-id')
    if (recipeId) {
      const recipe = CHORD_RECIPES.find(r => r.id === recipeId)
      if (!recipe) return
      const clip = buildRecipeClip(recipe, track.id, snapBeat(beatX, snap, project.timeSignatureNum))
      dispatch({ type: 'ADD_CLIP', clip })
      setSelectedClipId(clip.id)
      setExpandedPianoRollClipId(clip.id)
      return
    }
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
    if (frozen) return
    const rect  = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const beatX = (e.clientX - rect.left + scrollLeft) / beatW
    if (track.instrument.type === 'none') {
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
      const clip = makeMidiClip(track.id, 'MIDI Clip', snapBeat(beatX, snap, project.timeSignatureNum), 4, { isDrumClip: track.instrument.type === 'drum' })
      dispatch({ type: 'ADD_CLIP', clip })
      setExpandedPianoRollClipId(clip.id)
    }
  }

  function promoteTakeClip(lane: TakeLane, takeClip: AudioClip) {
    // Remove overlapping clips on main track
    const overlapping = project.arrangementClips.filter(c =>
      c.trackId === track.id &&
      c.startBeat < takeClip.startBeat + takeClip.durationBeats &&
      c.startBeat + c.durationBeats > takeClip.startBeat
    )
    for (const c of overlapping) dispatch({ type: 'REMOVE_CLIP', clipId: c.id })
    // Add take clip to main arrangement
    dispatch({ type: 'ADD_CLIP', clip: { ...takeClip, id: crypto.randomUUID(), trackId: track.id } })
    // Remove clip from take lane (or remove lane if empty)
    const newClips = lane.clips.filter(c => c.id !== takeClip.id)
    if (newClips.length === 0) {
      dispatch({ type: 'REMOVE_TAKE_LANE', laneId: lane.id })
    } else {
      dispatch({ type: 'UPDATE_TAKE_LANE', laneId: lane.id, patch: { clips: newClips } })
    }
  }

  const isSelected = selectedTrackId === track.id
  const leftPad = isIndented ? 24 : 8  // 16px extra indent for grouped tracks

  return (
    <div style={{ boxShadow: isSelected ? `inset 2px 0 0 var(--accent)` : 'none' }}>
      {/* Main track row */}
      <div style={{ display: 'flex', height: track.height, flexShrink: 0 }}>
        {/* Header */}
        <div
          onClick={e => {
            if (!(e.target as HTMLElement).closest('button,input,select')) {
              setSelectedTrackId(track.id)
              onSelectTrack?.(e.ctrlKey || e.metaKey)
            }
          }}
          onContextMenu={e => { e.preventDefault(); e.stopPropagation(); setTrackCtxMenu({ x: e.clientX, y: e.clientY }) }}
          data-help-id="track-head"
          style={{
            width: HDR_W, height: track.height, flexShrink: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 4, padding: `4px ${isIndented ? 8 : 8}px`,
            paddingLeft: leftPad,
            background: isSelected ? 'rgba(61,143,239,0.10)' : isMultiSelected ? 'rgba(61,143,239,0.06)' : 'var(--bg-card)',
            borderRight: '1px solid var(--border)', borderBottom: '1px solid var(--border)',
            borderLeft: isIndented ? `3px solid ${track.color}88` : `3px solid ${track.color}`,
            boxSizing: 'border-box', overflow: 'hidden', cursor: 'pointer', transition: 'background 0.1s',
          }}
        >
          {/* Name row — identity + transport controls */}
          <div style={{ display: 'flex', alignItems: 'center', minWidth: 0, gap: 2 }}>
            {/* Group fold toggle */}
            {isGroupParent && (
              <button
                onClick={e => { e.stopPropagation(); onToggleFold?.() }}
                title={isFolded ? 'Expand group' : 'Fold group'}
                style={{ fontSize: 8, width: 12, height: 12, flexShrink: 0, background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 0, lineHeight: 1 }}
              >
                {isFolded ? '▶' : '▼'}
              </button>
            )}
            {frozen && <span title="Frozen" style={{ fontSize: 10, flexShrink: 0 }}>❄</span>}
            {collabPeers.filter(pr => pr.selectedTrackId === track.id).slice(0, 3).map(pr => (
              <span key={pr.connectionId} title={`${pr.name} is on this track`} style={{
                width: 7, height: 7, borderRadius: '50%', background: pr.color,
                flexShrink: 0, display: 'inline-block', border: '1px solid rgba(0,0,0,0.4)',
              }} />
            ))}
            {editing ? (
              <input autoFocus value={draft} onChange={e => setDraft(e.target.value)}
                onBlur={() => { if (!cancelRenameRef.current) dispatch({ type: 'UPDATE_TRACK', trackId: track.id, patch: { name: draft } }); cancelRenameRef.current = false; setEditing(false) }}
                onKeyDown={e => { if (e.key === 'Enter') { dispatch({ type: 'UPDATE_TRACK', trackId: track.id, patch: { name: draft } }); setEditing(false) } else if (e.key === 'Escape') { cancelRenameRef.current = true; setEditing(false) } e.stopPropagation() }}
                style={{ flex: 1, fontSize: 11, background: '#111', border: '1px solid var(--accent)', color: 'var(--text-primary)', borderRadius: 3, padding: '1px 4px', outline: 'none', minWidth: 0 }}
              />
            ) : (
              <span onDoubleClick={() => { setEditing(true); setDraft(track.name) }} style={{ flex: 1, fontSize: 11, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', userSelect: 'none', cursor: 'default' }}>
                {track.name}
              </span>
            )}
            {/* Voice chain badge — podcast mode only */}
            {audioMode === 'podcast' && track.effects.length > 0 && (
              <span title="Voice chain active" style={{
                fontSize: 8, padding: '1px 3px', borderRadius: 2, flexShrink: 0,
                background: 'rgba(249,115,22,0.15)', color: '#f97316',
                border: '1px solid rgba(249,115,22,0.3)',
                letterSpacing: '0.05em', fontWeight: 700,
              }}>VC</span>
            )}
            {/* VU Meter — podcast mode, audio tracks, only active when armed */}
            {audioMode === 'podcast' && track.type === 'audio' && (
              <VUMeter deviceId={track.inputSource} active={track.armed} />
            )}
            {/* M / S / ● — transport controls sit at the right of the name row */}
            <button onClick={e => { e.stopPropagation(); dispatch({ type: 'UPDATE_TRACK', trackId: track.id, patch: { mute: !track.mute } }) }}
              data-help-id="mute"
              style={{ fontSize: 8, width: 16, height: 14, borderRadius: 2, border: '1px solid var(--border)', background: track.mute ? '#d97706' : 'var(--bg-surface)', color: track.mute ? '#fff' : 'var(--text-muted)', cursor: 'pointer', fontWeight: 700, padding: 0, flexShrink: 0 }}>M</button>
            <button onClick={e => { e.stopPropagation(); dispatch({ type: 'UPDATE_TRACK', trackId: track.id, patch: { solo: !track.solo } }) }}
              data-help-id="solo"
              style={{ fontSize: 8, width: 16, height: 14, borderRadius: 2, border: '1px solid var(--border)', background: track.solo ? '#eab308' : 'var(--bg-surface)', color: track.solo ? '#000' : 'var(--text-muted)', cursor: 'pointer', fontWeight: 700, padding: 0, flexShrink: 0 }}>S</button>
            {track.instrument.type !== 'drum' && (
              <button
                title={track.armed ? (recording ? 'Recording…' : 'Disarm track') : 'Arm for recording'}
                data-help-id="arm"
                onClick={e => { e.stopPropagation(); dispatch({ type: 'UPDATE_TRACK', trackId: track.id, patch: { armed: !track.armed } }) }}
                style={{ fontSize: 8, width: 16, height: 14, borderRadius: 2, border: `1px solid ${recording && track.armed ? '#ff3b3b' : track.armed ? '#ef4444' : 'var(--border)'}`, background: recording && track.armed ? '#ff3b3b' : track.armed ? 'rgba(239,68,68,0.2)' : 'var(--bg-surface)', color: recording && track.armed ? '#fff' : track.armed ? '#ef4444' : 'var(--text-muted)', cursor: 'pointer', fontWeight: 700, padding: 0, flexShrink: 0, animation: blinkIds.has(`arm:${track.id}`) ? 'dawBlink 0.45s ease-in-out 3' : undefined }}>
                ●
              </button>
            )}
          </div>
          {/* Tools row — routing + utilities */}
          <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
            {track.instrument.type !== 'drum' && (<>
              {/* Input source — opens settings card */}
              <button
                ref={inputBtnRef}
                title={audioMode === 'podcast' ? 'Select microphone input' : 'Audio input settings'}
                data-help-id="track-input"
                onClick={e => { e.stopPropagation(); setShowInputCard(v => !v) }}
                style={{
                  fontSize: 7, height: 14, borderRadius: 2, padding: '0 3px',
                  border: `1px solid ${track.inputSource ? 'var(--accent)' : 'var(--border)'}`,
                  background: track.inputSource ? 'rgba(61,143,239,0.15)' : 'var(--bg-surface)',
                  color: track.inputSource ? 'var(--accent-light)' : 'var(--text-muted)',
                  cursor: 'pointer', fontWeight: 700, whiteSpace: 'nowrap', flexShrink: 0,
                  animation: blinkIds.has(`input:${track.id}`) ? 'dawBlink 0.45s ease-in-out 3' : undefined,
                }}>
                {!track.inputSource ? (audioMode === 'podcast' ? 'MIC' : '·IN') : track.inputSource === 'system' ? 'SYS' : 'MIC'}
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
              data-help-id="fx-lane"
              onClick={e => { e.stopPropagation(); setShowFx(v => !v) }}
              style={{ fontSize: 8, width: 22, height: 14, borderRadius: 2, border: `1px solid ${showFx ? 'var(--accent)' : 'var(--border)'}`, background: showFx ? 'var(--accent)' : 'var(--bg-surface)', color: showFx ? '#fff' : 'var(--text-muted)', cursor: 'pointer', fontWeight: 700, padding: 0, flexShrink: 0 }}
            >FX</button>
            {takeLanes.length > 0 && (
              <button
                title={takesExpanded ? 'Hide takes' : 'Show takes'}
                onClick={e => { e.stopPropagation(); setTakesExpanded(v => !v) }}
                style={{ fontSize: 8, width: 22, height: 14, borderRadius: 2, border: `1px solid ${takesExpanded ? '#f59e0b' : 'var(--border)'}`, background: takesExpanded ? 'rgba(245,158,11,0.2)' : 'var(--bg-surface)', color: takesExpanded ? '#f59e0b' : 'var(--text-muted)', cursor: 'pointer', fontWeight: 700, padding: 0, flexShrink: 0 }}
              >T{takeLanes.length}</button>
            )}
            <button
              title="Track settings (right-click for more)"
              data-help-id="track-settings"
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
              top:  Math.min(trackCtxMenu.y, window.innerHeight - 380),
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
              <div style={{ fontSize: 9, color: '#555', marginTop: 1, textTransform: 'uppercase', letterSpacing: '0.07em' }}>{track.instrument.type === 'drum' ? 'drum' : track.instrument.type === 'none' ? 'audio' : 'midi'} track</div>
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

            {/* Freeze / Bounce */}
            <div style={{ borderTop: '1px solid #222', margin: '3px 0' }} />
            <button onClick={() => { dispatch({ type: 'SET_TRACK_FROZEN', trackId: track.id, frozen: !frozen }); setTrackCtxMenu(null) }}
              style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', padding: '6px 14px', fontSize: 11, color: frozen ? '#60a5fa' : '#ccc', background: 'transparent', border: 'none', cursor: 'pointer' }}
              onMouseEnter={e => { (e.target as HTMLElement).style.background = 'rgba(255,255,255,0.06)' }}
              onMouseLeave={e => { (e.target as HTMLElement).style.background = 'transparent' }}
            >
              <span>❄</span>
              <span>{frozen ? 'Unfreeze Track' : 'Freeze Track'}</span>
            </button>

            {/* Group selected tracks — show only when multiple tracks selected and this track is one of them */}
            {selectedTrackIds && selectedTrackIds.size > 1 && selectedTrackIds.has(track.id) && onGroupTracks && (
              <>
                <div style={{ borderTop: '1px solid #222', margin: '3px 0' }} />
                <button onClick={() => { onGroupTracks(); setTrackCtxMenu(null) }}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', padding: '6px 14px', fontSize: 11, color: '#60a5fa', background: 'transparent', border: 'none', cursor: 'pointer' }}
                  onMouseEnter={e => { (e.target as HTMLElement).style.background = 'rgba(96,165,250,0.10)' }}
                  onMouseLeave={e => { (e.target as HTMLElement).style.background = 'transparent' }}
                >
                  <span>⊞</span>
                  <span>Group Selected Tracks ({selectedTrackIds.size})</span>
                </button>
              </>
            )}

            {/* MIDI section */}
            {track.instrument.type !== 'drum' && (<>
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
          onContextMenu={e => {
            // Clips stop propagation for their own menu — this fires on empty lane
            e.preventDefault()
            const rect = e.currentTarget.getBoundingClientRect()
            const beat = Math.max(0, snapBeat((e.clientX - rect.left + scrollLeft) / beatW, snap, project.timeSignatureNum))
            setLaneCtxMenu({ x: e.clientX, y: e.clientY, beat })
          }}
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
                  collabHolder={(() => {
                    const editor = collabPeers.find(pr => pr.editingClipId === clip.id)
                    if (editor) return { name: editor.name, color: editor.color, editing: true }
                    const sel = collabPeers.find(pr => pr.selectedClipId === clip.id)
                    return sel ? { name: sel.name, color: sel.color, editing: false } : undefined
                  })()}
                  track={track} beatW={beatW}
                  selected={isClipSelected}
                  multiSelected={isMultiSelected}
                  waveformZoom={waveformZoom}
                  onFadeChange={isAudioClip(clip) ? (fadeIn, fadeOut) => {
                    dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch: { fadeIn, fadeOut } })
                  } : undefined}
                  onSelect={() => {
                    setSelectedClipId(clip.id); setSelectedClipIds(new Set([clip.id])); setSelectedEffectIds(new Set())
                    // An open piano roll follows the selection to the newly selected MIDI clip
                    if (expandedPianoRollClipId && expandedPianoRollClipId !== clip.id && isMidiClip(clip)) {
                      setExpandedPianoRollClipId(clip.id)
                    }
                  }}
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
                    // Capture original positions of all clips for ripple editing
                    if (rippleEdit) {
                      const rOrigins: Record<string, number> = {}
                      for (const c of project.arrangementClips) rOrigins[c.id] = c.startBeat
                      rippleOriginsRef.current = rOrigins
                    }
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
                  onSpectral={() => { if (isAudioClip(clip)) setSpectralTarget(clip) }}
                  onMove={(sb, tid, alt) => {
                    if (frozen) return
                    const CLIP_SNAP_PX = 8
                    const clipThreshold = CLIP_SNAP_PX / beatW
                    if (selectedClipIds.has(clip.id) && selectedClipIds.size > 1) {
                      const origin = multiDragOrigins.current[clip.id] ?? clip.startBeat
                      const delta  = sb - origin
                      let snappedNew = alt ? Math.max(0, origin + delta) : snapBeat(Math.max(0, origin + delta), snap, project.timeSignatureNum)
                      if (!alt) snappedNew = snapToClipEdges(snappedNew, selectedClipIds, clipThreshold, project.arrangementClips)
                      const snappedDelta = snappedNew - origin
                      for (const c of project.arrangementClips) {
                        if (!selectedClipIds.has(c.id)) continue
                        const cOrigin = multiDragOrigins.current[c.id] ?? c.startBeat
                        dispatch({ type: 'MOVE_CLIP', clipId: c.id, startBeat: Math.max(0, cOrigin + snappedDelta), trackId: c.trackId })
                      }
                    } else {
                      let snappedSb = alt ? sb : snapBeat(sb, snap, project.timeSignatureNum)
                      if (!alt) snappedSb = snapToClipEdges(snappedSb, new Set([clip.id]), clipThreshold, project.arrangementClips)
                      dispatch({ type: 'MOVE_CLIP', clipId: clip.id, startBeat: Math.max(0, snappedSb), trackId: tid })
                      // Ripple: shift all clips on same track that originally started after this clip
                      if (rippleEdit && tid === track.id) {
                        const originalBeat = rippleOriginsRef.current[clip.id] ?? clip.startBeat
                        const delta = snappedSb - originalBeat
                        if (delta !== 0) {
                          for (const c of project.arrangementClips) {
                            if (c.id === clip.id || c.trackId !== track.id) continue
                            const cOriginal = rippleOriginsRef.current[c.id]
                            if (cOriginal === undefined || cOriginal <= originalBeat) continue
                            dispatch({ type: 'MOVE_CLIP', clipId: c.id, startBeat: Math.max(0, cOriginal + delta) })
                          }
                        }
                      }
                    }
                  }}
                  onResizeStart={() => {
                    if (isMidiClip(clip) && clip.stretchNotes) {
                      stretchOriginRef.current = { clipId: clip.id, durationBeats: clip.durationBeats, notes: clip.notes }
                    }
                  }}
                  onResize={(db, alt) => {
                    if (frozen) return
                    const endBeat = clip.startBeat + db
                    let snappedEnd = alt ? endBeat : snapBeat(endBeat, snap, project.timeSignatureNum)
                    if (!alt) snappedEnd = snapToClipEdges(snappedEnd, new Set([clip.id]), 8 / beatW, project.arrangementClips)
                    const newDurBeats = Math.max(0.125, snappedEnd - clip.startBeat)
                    // Stretch clips (recipes): scale the whole note pattern to the
                    // new length — from the originals captured at resize start, so
                    // repeated drag events don't compound rounding.
                    const so = stretchOriginRef.current
                    if (isMidiClip(clip) && clip.stretchNotes && so?.clipId === clip.id) {
                      const ratio = newDurBeats / so.durationBeats
                      dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch: {
                        durationBeats: newDurBeats,
                        notes: so.notes.map(n => ({ ...n, startBeat: n.startBeat * ratio, durationBeats: n.durationBeats * ratio })),
                      } })
                      return
                    }
                    const patch: Record<string, unknown> = { durationBeats: newDurBeats }
                    if (isAudioClip(clip) && clip.bufferDuration) {
                      const nativeSec = clip.bufferDuration - clip.trimStart - clip.trimEnd
                      const newDurSec = engine.beatsToSeconds(newDurBeats)
                      // Only enable loop when dragging past native duration. NEVER change trimEnd/trimStart.
                      if (newDurSec > nativeSec + 0.001) patch.loopEnabled = true
                    } else if (isMidiClip(clip) && clip.notes.length > 0) {
                      // Dragging past the note pattern loops it — pattern length is the
                      // content end rounded up to a whole bar (stable across drags).
                      const barBeats = project.timeSignatureNum || 4
                      const contentEnd = Math.max(...clip.notes.map(n => n.startBeat + n.durationBeats))
                      const patternBeats = clip.loopLengthBeats
                        ?? Math.max(barBeats, Math.ceil(contentEnd / barBeats) * barBeats)
                      if (newDurBeats > patternBeats + 0.001) {
                        patch.loopEnabled = true
                        patch.loopLengthBeats = patternBeats
                      }
                    }
                    dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch })
                  }}
                  loopNativeBeats={isAudioClip(clip) && clip.loopEnabled && clip.bufferDuration
                    ? engine.secondsToBeats(clip.bufferDuration - clip.trimStart - clip.trimEnd)
                    : isMidiClip(clip) && clip.loopEnabled && clip.loopLengthBeats
                    ? clip.loopLengthBeats
                    : undefined}
                  onCrop={() => setCroppingClipId(prev => prev === clip.id ? null : clip.id)}
                  onCropChange={(ts, te) => dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch: { trimStart: ts, trimEnd: te } })}
                  onCropSnap={(b) => snapBeat(b, snap, project.timeSignatureNum)}
                  onIsolate={beat => setIsolateTgt(beat)}
                  onSplice={() => {
                    if (frozen) return
                    const playhead = engine.currentBeat
                    if (playhead <= clip.startBeat || playhead >= clip.startBeat + clip.durationBeats) return
                    const beatOffset = playhead - clip.startBeat
                    if (isAudioClip(clip) && clip.bufferDuration) {
                      const bufDur    = clip.bufferDuration
                      const nativeDur = bufDur - clip.trimStart - clip.trimEnd
                      const frac      = beatOffset / clip.durationBeats
                      // Warped clips stretch audio to fill durationBeats — use frac of nativeDur.
                      // Unwarped clips play at native speed — use actual elapsed seconds.
                      const splitSec  = clip.warpEnabled
                        ? (clip.trimStart ?? 0) + frac * nativeDur
                        : (clip.trimStart ?? 0) + engine.beatsToSeconds(beatOffset)
                      const leftClip  = { ...clip, id: crypto.randomUUID(), durationBeats: beatOffset, trimEnd: Math.max(0, bufDur - splitSec) }
                      const rightClip = { ...clip, id: crypto.randomUUID(), startBeat: playhead, durationBeats: clip.durationBeats - beatOffset, trimStart: splitSec }
                      dispatch({ type: 'REMOVE_CLIP', clipId: clip.id })
                      dispatch({ type: 'ADD_CLIP', clip: leftClip })
                      dispatch({ type: 'ADD_CLIP', clip: rightClip })
                    } else if (!isAudioClip(clip)) {
                      // Looped clips: materialize the repeats first so both
                      // halves keep the audible pattern instead of splitting
                      // the raw (single) pattern.
                      let notes = clip.notes
                      if (clip.loopEnabled && clip.loopLengthBeats) {
                        const L = clip.loopLengthBeats
                        notes = []
                        for (let k = 0; k * L < clip.durationBeats; k++) {
                          for (const n of clip.notes) {
                            const start = k * L + n.startBeat
                            if (start >= clip.durationBeats) continue
                            notes.push({ ...n, id: crypto.randomUUID(), startBeat: start, durationBeats: Math.min(n.durationBeats, clip.durationBeats - start) })
                          }
                        }
                      }
                      // MIDI: notes before splice go left (truncated if they span), notes at/after go right
                      const leftNotes  = notes.filter(n => n.startBeat < beatOffset).map(n => ({ ...n, durationBeats: Math.min(n.durationBeats, beatOffset - n.startBeat) }))
                      const rightNotes = notes.filter(n => n.startBeat >= beatOffset).map(n => ({ ...n, id: crypto.randomUUID(), startBeat: n.startBeat - beatOffset }))
                      dispatch({ type: 'REMOVE_CLIP', clipId: clip.id })
                      dispatch({ type: 'ADD_CLIP', clip: { ...clip, id: crypto.randomUUID(), durationBeats: beatOffset, notes: leftNotes, loopEnabled: false, loopLengthBeats: undefined } })
                      dispatch({ type: 'ADD_CLIP', clip: { ...clip, id: crypto.randomUUID(), startBeat: playhead, durationBeats: clip.durationBeats - beatOffset, notes: rightNotes, loopEnabled: false, loopLengthBeats: undefined } })
                    }
                  }}
                  onDelete={() => dispatch({ type: 'REMOVE_CLIP', clipId: clip.id })}
                  onCopy={() => onCopyClips?.(selectedClipIds.has(clip.id) ? selectedClipIds : new Set([clip.id]))}
                  onPaste={onPasteClips}
                  onScrollBy={onScrollBy}
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
          {/* Frozen overlay — blocks clip interactions */}
          {frozen && (
            <div style={{
              position: 'absolute', inset: 0,
              background: 'rgba(100,150,220,0.06)',
              backdropFilter: 'none',
              cursor: 'not-allowed',
              zIndex: 20,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <span style={{ fontSize: 16, opacity: 0.3 }}>❄</span>
            </div>
          )}
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

      {/* Take lane rows — shown when takes exist and expanded */}
      {takesExpanded && takeLanes.map(lane => (
        <div key={lane.id} style={{ display: 'flex', height: TAKE_H, flexShrink: 0 }}>
          {/* Take lane header */}
          <div style={{
            width: HDR_W, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 4, padding: '0 8px',
            background: '#181818',
            borderRight: '1px solid var(--border)', borderBottom: '1px solid var(--border)',
            borderLeft: `3px solid ${track.color}55`,
            boxSizing: 'border-box',
          }}>
            <span style={{ fontSize: 9, color: '#a78bfa', fontWeight: 600, letterSpacing: '0.03em' }}>TAKE</span>
            <span style={{ flex: 1, fontSize: 9, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{lane.name}</span>
            <button
              onClick={() => dispatch({ type: 'REMOVE_TAKE_LANE', laneId: lane.id })}
              title="Delete take"
              style={{ width: 14, height: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: '1px solid var(--border)', borderRadius: 2, color: 'var(--text-muted)', cursor: 'pointer', fontSize: 9, padding: 0, flexShrink: 0 }}
            >×</button>
          </div>
          {/* Take lane clip area */}
          <div style={{ flex: 1, height: TAKE_H, position: 'relative', background: 'rgba(120,80,160,0.06)', borderBottom: '1px solid var(--border)', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', top: 0, bottom: 0, left: -scrollLeft, width: (viewEndBeat + 10) * beatW }}>
              {lane.clips.map(takeClip => {
                const clipLeft  = takeClip.startBeat * beatW
                const clipWidth = Math.max(4, takeClip.durationBeats * beatW)
                return (
                  <div
                    key={takeClip.id}
                    title={`${lane.name}: ${takeClip.name} — right-click for options`}
                    style={{
                      position: 'absolute', left: clipLeft, width: clipWidth,
                      top: 4, bottom: 4,
                      background: `${track.color}60`,
                      border: `1px solid ${track.color}`,
                      borderRadius: 2,
                      cursor: 'pointer',
                      overflow: 'hidden',
                    }}
                    onContextMenu={e => {
                      e.preventDefault()
                      e.stopPropagation()
                      setTakeLaneCtx({ x: e.clientX, y: e.clientY, lane, clip: takeClip })
                    }}
                  >
                    <div style={{ position: 'absolute', top: 1, left: 3, right: 3, fontSize: 8, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', pointerEvents: 'none' }}>
                      {takeClip.name}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      ))}

      {/* Take lane context menu */}
      {takeLaneCtx && createPortal(
        <div
          style={{
            position: 'fixed',
            top: Math.min(takeLaneCtx.y, window.innerHeight - 120),
            left: Math.min(takeLaneCtx.x, window.innerWidth - 180),
            zIndex: 9999, minWidth: 160,
            background: '#161616', border: '1px solid #2e2e2e',
            borderRadius: 8, boxShadow: '0 10px 28px rgba(0,0,0,0.75)',
            padding: '4px 0',
          }}
          onMouseDown={e => e.stopPropagation()}
        >
          <div style={{ padding: '5px 12px 7px', borderBottom: '1px solid #222' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#ccc' }}>{takeLaneCtx.lane.name}</div>
            <div style={{ fontSize: 9, color: '#555', marginTop: 1 }}>{takeLaneCtx.clip.name}</div>
          </div>
          <button
            onClick={() => { promoteTakeClip(takeLaneCtx.lane, takeLaneCtx.clip); setTakeLaneCtx(null) }}
            style={{ display: 'block', width: '100%', textAlign: 'left', padding: '6px 14px', fontSize: 11, color: '#4ade80', background: 'transparent', border: 'none', cursor: 'pointer' }}
            onMouseEnter={e => { (e.target as HTMLElement).style.background = 'rgba(74,222,128,0.10)' }}
            onMouseLeave={e => { (e.target as HTMLElement).style.background = 'transparent' }}
          >Promote to Main</button>
          <button
            onClick={() => { dispatch({ type: 'REMOVE_TAKE_LANE', laneId: takeLaneCtx.lane.id }); setTakeLaneCtx(null) }}
            style={{ display: 'block', width: '100%', textAlign: 'left', padding: '6px 14px', fontSize: 11, color: '#f87171', background: 'transparent', border: 'none', cursor: 'pointer' }}
            onMouseEnter={e => { (e.target as HTMLElement).style.background = 'rgba(239,68,68,0.10)' }}
            onMouseLeave={e => { (e.target as HTMLElement).style.background = 'transparent' }}
          >Delete Take</button>
        </div>,
        document.body
      )}

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
            onCopyEffects={onCopyEffects}
            onPasteEffects={onPasteEffects}
          />
        </div>
      )}

      {/* Lane context menu (empty-lane right-click) */}
      {laneCtxMenu && (
        <div id={`lcm-${track.id}`} style={{ position: 'fixed', zIndex: 1000, left: laneCtxMenu.x, top: laneCtxMenu.y, background: '#2a2a2a', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 0', minWidth: 170, boxShadow: '0 4px 20px rgba(0,0,0,0.5)' }}>
          <button
            onClick={() => {
              const clip = makeMidiClip(track.id, 'MIDI Clip', laneCtxMenu.beat, 4, { isDrumClip: track.instrument.type === 'drum' })
              dispatch({ type: 'ADD_CLIP', clip })
              setSelectedTrackId(track.id)
              setSelectedClipId(clip.id)
              setExpandedPianoRollClipId(clip.id)
              setLaneCtxMenu(null)
            }}
            style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', padding: '6px 12px', fontSize: 11, cursor: 'pointer', background: 'transparent', border: 'none', color: 'var(--text-primary)' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
          >
            <span style={{ color: '#a78bfa' }}>♩</span>
            <span>Piano Roll here</span>
            <span style={{ marginLeft: 'auto', fontSize: 9, color: 'var(--text-muted)' }}>bar {Math.floor(laneCtxMenu.beat / project.timeSignatureNum) + 1}</span>
          </button>
        </div>
      )}

      {/* Inline Piano Roll — shown when a MIDI clip on this track is expanded */}
      {(() => {
        const expandedClip = clips.find(c => isMidiClip(c) && c.id === expandedPianoRollClipId)
        if (!expandedClip) return null
        return (
          // position+zIndex+opaque bg: the arrangement playhead overlay
          // (ArrangementView, zIndex 10) must not draw through the roll —
          // the roll has its own playhead, so it sits above the overlay.
          <div style={{ display: 'flex', flexShrink: 0, alignItems: 'stretch', position: 'relative', zIndex: 20, background: 'var(--bg-surface)' }}>
            <div style={{ width: HDR_W, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6, padding: '0 8px', background: 'rgba(0,0,0,0.3)', borderRight: '1px solid var(--border)', borderBottom: '1px solid var(--border)', borderLeft: `3px solid ${track.color}`, boxSizing: 'border-box' }}>
              <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: 1, textTransform: 'uppercase' }}>ROLL</span>
              <span style={{ fontSize: 9, color: 'var(--text-muted)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{expandedClip.name}</span>
              {(() => {
                const peer = collabPeers.find(pr => pr.editingClipId === expandedClip.id)
                return peer ? (
                  <span title={`${peer.name} also has this clip open`} style={{
                    fontSize: 8, fontWeight: 700, padding: '1px 5px', borderRadius: 3, flexShrink: 0,
                    background: peer.color, color: '#fff', whiteSpace: 'nowrap',
                  }}>✎ {peer.name}</span>
                ) : null
              })()}
              <button onClick={() => setRollTall(v => !v)} style={{ background: 'transparent', border: 'none', color: rollTall ? 'var(--accent-light)' : 'var(--text-muted)', cursor: 'pointer', fontSize: 11, padding: '0 2px' }} title={rollTall ? 'Collapse piano roll' : 'Expand piano roll to fill the view'}>{rollTall ? '⤡' : '⤢'}</button>
              <button onClick={() => setExpandedPianoRollClipId(null)} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 11, padding: '0 2px' }} title="Close piano roll">✕</button>
            </div>
            <div style={{ flex: 1, height: rollTall ? 'max(400px, calc(100vh - 300px))' : 240, overflow: 'hidden' }}>
              <PianoRoll clipId={expandedClip.id} />
            </div>
          </div>
        )
      })()}

      {showLibraryPicker && createPortal(
        <div
className="electron-nodrag"
style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
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

      {spectralTarget && (
        <SpectralEditorModal clip={spectralTarget} onClose={() => setSpectralTarget(null)} />
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
