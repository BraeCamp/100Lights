'use client'

import { useState, useRef, useEffect, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import { Plus, Headphones } from 'lucide-react'
import { useDaw, extractPeaks, makeAudioClip, makeMidiClip } from '@/lib/daw-state'
import { uploadRecordingBlob } from '@/lib/record-upload'
import { getAllChordRecipes, buildRecipeClip } from '@/lib/practice-recipes'
import { decodeAiff, encodeWav } from '@/lib/wav-codec'
import type { DawTrack, AudioClip, DawClip, AutomationLane, TakeLane } from '@/lib/daw-types'
import { isAudioClip, isMidiClip, TRACK_COLORS, COLLAPSED_TRACK_HEIGHT, GROUP_TRACK_HEIGHT } from '@/lib/daw-types'
import { useWorkshopThemeOptional } from '../WorkshopThemeProvider'
import { clampToViewport } from './menu-clamp'
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
const PolyCodePanel = dynamic(() => import('./PolyCodePanel'), { ssr: false })

// Live take preview: while recording, armed tracks show the take growing
// behind the playhead with its waveform drawn as it lands.
function RecordingGhost({ beatW, height }: { beatW: number; height: number }) {
  const { engine } = useDaw()
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    let raf = 0
    const tick = () => {
      const el = wrapRef.current, canvas = canvasRef.current
      if (el && canvas && engine.isRecording) {
        const start = engine.recordingStartBeat
        const w = Math.max(2, (engine.currentBeat - start) * beatW)
        el.style.left = `${start * beatW}px`
        el.style.width = `${w}px`
        const ctx = canvas.getContext('2d')
        if (ctx) {
          const W = Math.min(1600, Math.max(10, Math.floor(w)))
          if (canvas.width !== W) canvas.width = W
          const H = canvas.height
          ctx.clearRect(0, 0, W, H)
          ctx.fillStyle = 'rgba(248,113,113,0.8)'
          const peaks = engine.recordingPeaks
          const n = peaks.length
          for (let x = 0; x < W; x++) {
            const p = n ? peaks[Math.min(n - 1, Math.floor((x / W) * n))] : 0
            const h = Math.max(1, p * (H - 4))
            ctx.fillRect(x, (H - h) / 2, 1, h)
          }
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [engine, beatW])
  return (
    <div ref={wrapRef} style={{ position: 'absolute', top: 4, bottom: 4, left: 0, width: 2, background: 'rgba(220,38,38,0.08)', border: '1px dashed rgba(239,68,68,0.55)', borderRadius: 3, pointerEvents: 'none', overflow: 'hidden', zIndex: 3, boxSizing: 'border-box' }}>
      <canvas ref={canvasRef} width={10} height={Math.max(8, height - 8)} style={{ width: '100%', height: '100%', display: 'block' }} />
      <span style={{ position: 'absolute', top: 1, left: 4, fontSize: 8, fontWeight: 700, color: '#f87171', letterSpacing: '0.06em' }}>● REC</span>
    </div>
  )
}

// Hold E or L while grabbing a clip edge to force Expand or Loop for that
// drag, regardless of the clip's dragging type.
const _heldKeys = new Set<string>()
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', e => { _heldKeys.add(e.key.toLowerCase()) })
  window.addEventListener('keyup', e => { _heldKeys.delete(e.key.toLowerCase()) })
  window.addEventListener('blur', () => _heldKeys.clear())
}
function heldDragMode(): 'expand' | 'loop' | null {
  if (_heldKeys.has('e')) return 'expand'
  if (_heldKeys.has('l')) return 'loop'
  return null
}

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
          zIndex: 1000, background: 'var(--bg-card-hover)', border: '1px solid var(--border)',
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
    <div style={{ width: HDR_W, height: AUTO_H, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 4, padding: '0 8px', background: 'var(--bg-surface)', borderRight: '1px solid var(--border)', borderBottom: '1px solid var(--border)', borderLeft: `3px solid ${track.color}55`, boxSizing: 'border-box' }}>
      <div style={{ flex: 1, fontSize: 10, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {lane.label}
      </div>
      <button onClick={() => dispatch({ type: 'CLEAR_AUTOMATION_LANE', laneId: lane.id })} title="Clear" style={{ width: 16, height: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: '1px solid var(--border)', borderRadius: 2, color: 'var(--text-muted)', cursor: 'pointer', fontSize: 9, padding: 0, flexShrink: 0 }}>⌫</button>
      <button onClick={() => dispatch({ type: 'REMOVE_AUTOMATION_LANE', laneId: lane.id })} title="Remove lane" style={{ width: 16, height: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: '1px solid var(--border)', borderRadius: 2, color: 'var(--text-muted)', cursor: 'pointer', fontSize: 11, padding: 0, flexShrink: 0 }}>×</button>
    </div>
  )
}

export default function TrackRow({ track, beatW, scrollLeft, viewWidth, snap, onScrollBy, waveformZoom, selectedTrackIds, onSelectTrack, foldedGroups, onToggleFold, onGroupTracks, onReorderDrop, rippleEdit, onCopyClips, onPasteClips, onCopyEffects, onPasteEffects, getSelectionRegion, selectionRegion, isSelectionTrack, onSelectionResize, onSelectionLoopCommit }: {
  track: DawTrack; beatW: number; scrollLeft: number; viewWidth: number; snap: SnapMode
  onScrollBy?: (delta: number) => void
  waveformZoom?: number
  selectedTrackIds?: Set<string>
  onSelectTrack?: (ctrl: boolean) => void
  foldedGroups?: Set<string>
  onToggleFold?: () => void
  onGroupTracks?: () => void
  /** Drop a dragged track head relative to this one (reorder / regroup). */
  onReorderDrop?: (draggedId: string, targetId: string, pos: 'before' | 'after') => void
  rippleEdit?: boolean
  onCopyClips?: (ids: Set<string>) => void
  onPasteClips?: () => void
  onCopyEffects?: (ids: Set<string>) => void
  onPasteEffects?: () => void
  /** Beat-span of the rubber-band selection — group loop/expand treat it as the unit, blank space included. Getter so it's read at event time, not render time. */
  getSelectionRegion?: () => { start: number; end: number } | null
  selectionRegion?: { start: number; end: number } | null
  isSelectionTrack?: boolean
  onSelectionResize?: (end: number) => void
  onSelectionLoopCommit?: (region: { start: number; end: number }, blocks: number) => void
}) {
  const { project, dispatch, engine, setEditTarget, setSelectedClipId, selectedClipId, setSelectedTrackId, selectedTrackId, selectedClipIds, setSelectedClipIds, selectedEffectIds, setSelectedEffectIds, setShowPads, expandedPianoRollClipId, setExpandedPianoRollClipId, recording, audioMode, blinkIds, collabPeers } = useDaw()
  const clips     = project.arrangementClips.filter(c => c.trackId === track.id)
  const workshopTheme = useWorkshopThemeOptional()
  const trackColors = workshopTheme?.theme.trackPalette ?? TRACK_COLORS
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
  // Drag-scoped override from held E/L keys, sampled when the drag starts
  const dragForceRef = useRef<'expand' | 'loop' | null>(null)
  // Multi-select edge-resize: the whole selection moves as one block.
  // 'expand' scales every member by the drag ratio (relations preserved);
  // 'loop' tiles copies of the entire selection so the group repeats
  // start-to-end instead of each clip looping at its own edge.
  // "My mix": local-only gain for this track (engine-side, never synced)
  const [myMixOpen, setMyMixOpen] = useState<{ x: number; y: number } | null>(null)
  const [myMixGain, setMyMixGain] = useState(() => engine.getLocalTrackGain(track.id))
  const myMixBtnRef = useRef<HTMLButtonElement>(null)
  const myMixPopRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!myMixOpen) return
    const onDown = (e: PointerEvent) => {
      if (myMixPopRef.current?.contains(e.target as Node)) return
      if (myMixBtnRef.current?.contains(e.target as Node)) return
      setMyMixOpen(null)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMyMixOpen(null) }
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [myMixOpen])

  const groupResizeRef = useRef<{
    clipId: string
    grabbedDur: number
    mode: 'expand' | 'loop'
    groupStart: number
    groupEnd: number
    members: DawClip[]
    lastDb?: number
  } | null>(null)
  const [settingsTarget, setSettingsTarget] = useState<AudioClip | null>(null)
  const [spectralTarget, setSpectralTarget] = useState<AudioClip | null>(null)
  const [showFx,         setShowFx]         = useState(false)
  const [isolateTgt,     setIsolateTgt]     = useState<number | null>(null)
  const [showInputCard,  setShowInputCard]  = useState(false)
  const [trackCtxMenu,   setTrackCtxMenu]  = useState<{ x: number; y: number } | null>(null)
  const [laneCtxMenu,    setLaneCtxMenu]   = useState<{ x: number; y: number; beat: number } | null>(null)
  const laneMenuRef = useRef<HTMLDivElement>(null)
  // Open upward/leftward at screen edges
  useLayoutEffect(() => {
    if (laneCtxMenu) clampToViewport(laneMenuRef.current, { x: laneCtxMenu.x, y: laneCtxMenu.y })
  }, [laneCtxMenu])
  // Double-click "create" popup (Upload / Record / Browse / Synthesize)
  const [createMenu, setCreateMenu] = useState<{ x: number; y: number; beat: number } | null>(null)
  const createMenuRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (createMenu) clampToViewport(createMenuRef.current, { x: createMenu.x, y: createMenu.y })
  }, [createMenu])
  const [showSynth, setShowSynth] = useState(false)
  const frozen = track.frozen ?? false
  const [takesExpanded,  setTakesExpanded]  = useState(false)
  const [takeLaneCtx,    setTakeLaneCtx]   = useState<{ x: number; y: number; lane: TakeLane; clip: AudioClip } | null>(null)
  const inputBtnRef        = useRef<HTMLButtonElement>(null)
  const multiDragOrigins   = useRef<Record<string, number>>({})
  const multiDragTrackOrigins = useRef<Record<string, string>>({})
  const rippleOriginsRef   = useRef<Record<string, number>>({})
  const [showLibraryPicker, setShowLibraryPicker] = useState(false)
  const [pickerInsertBeat, setPickerInsertBeat] = useState<number | null>(null)  // null = replace selected clip's sample

  useEffect(() => {
    if (!showLibraryPicker) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { setShowLibraryPicker(false); setPickerInsertBeat(null) }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [showLibraryPicker])

  // Keep a ref to project for stable closures in event listeners
  const projectRef = useRef(project)
  useEffect(() => { projectRef.current = project }, [project])

  // Group / collapse state
  const isGroup = track.kind === 'group'
  const collapsed = track.collapsed ?? false          // group: children folded; track: thin row
  const isFolded = isGroup && collapsed
  const isMultiSelected = selectedTrackIds?.has(track.id) ?? false
  const isIndented = !!track.groupId
  void foldedGroups

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

    // Lane-menu flow: drop the picked sound as a NEW clip at the clicked beat
    if (pickerInsertBeat !== null) {
      const at = pickerInsertBeat
      setPickerInsertBeat(null)
      const clip = makeAudioClip(track.id, entry.name, at, 8, { audioUrl, libraryId: entry.id })
      dispatch({ type: 'ADD_CLIP', clip })
      const buf = await engine.loadClipBuffer(clip)
      if (buf) {
        dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch: { waveformPeaks: extractPeaks(buf), durationBeats: engine.secondsToBeats(buf.duration), bufferDuration: buf.duration } })
      }
      return
    }
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
      dispatch({ type: 'UPDATE_CLIP', clipId: c.id, patch: { audioUrl, libraryId: fulfilled.id, waveformPeaks: peaks, bufferDuration: undefined } })
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

  // Drag the right edge of the selection band to repeat the whole selected
  // block — every clip on every selected track, from the selection's start to
  // its end — tiled after the end. Snaps to whole copies of the block. The
  // actual tiling is committed by the parent across all selected tracks.
  function onSelectionEdgeDown(e: React.MouseEvent) {
    e.stopPropagation()
    e.preventDefault()
    if (!selectionRegion) return
    const region = { start: selectionRegion.start, end: selectionRegion.end }
    const blockLen = region.end - region.start
    if (blockLen <= 0.01) return
    const layer = (e.currentTarget as HTMLElement).closest('[data-content-layer]') as HTMLElement | null
    if (!layer) return
    const layerLeft = layer.getBoundingClientRect().left
    let blocks = 0
    const onMove = (ev: MouseEvent) => {
      const raw = Math.max(region.end, (ev.clientX - layerLeft) / beatW)
      blocks = Math.max(0, Math.round((raw - region.end) / blockLen))
      onSelectionResize?.(region.end + blocks * blockLen)
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      if (blocks > 0) onSelectionLoopCommit?.(region, blocks)
      else onSelectionResize?.(region.end)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  async function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    const rect  = e.currentTarget.getBoundingClientRect()
    const beatX = (e.clientX - rect.left + scrollLeft) / beatW
    // .mid files dropped from the desktop become MIDI clips
    const midFile = [...(e.dataTransfer.files ?? [])].find(f => /\.midi?$/i.test(f.name))
    if (midFile) {
      try {
        const { parseMidiFile } = await import('@/lib/midi-file')
        const parsed = parseMidiFile(await midFile.arrayBuffer())
        if (parsed.notes.length === 0) return
        const bar = project.timeSignatureNum || 4
        const contentEnd = Math.max(...parsed.notes.map(n => n.startBeat + n.durationBeats))
        const clip = makeMidiClip(track.id, parsed.name || midFile.name.replace(/\.midi?$/i, ''), snapBeat(beatX, snap, bar), Math.max(bar, Math.ceil(contentEnd / bar) * bar), { isDrumClip: false })
        clip.notes = parsed.notes.map(n => ({ ...n, id: crypto.randomUUID() }))
        dispatch({ type: 'ADD_CLIP', clip })
        setSelectedClipId(clip.id)
        setExpandedPianoRollClipId(clip.id)
      } catch (err) {
        console.warn('MIDI import failed:', err)
      }
      return
    }
    const recipeId = e.dataTransfer.getData('application/x-recipe-id')
    if (recipeId) {
      const recipe = getAllChordRecipes().find(r => r.id === recipeId)
      if (!recipe) return
      const clip = buildRecipeClip(recipe, track.id, snapBeat(beatX, snap, project.timeSignatureNum))
      dispatch({ type: 'ADD_CLIP', clip })
      setSelectedClipId(clip.id)
      setExpandedPianoRollClipId(clip.id)
      return
    }
    // A generated item dragged out of the Code panel becomes a MIDI clip here.
    const polyData = e.dataTransfer.getData('application/x-poly-generated')
    if (polyData) {
      try {
        const gen = JSON.parse(polyData) as { name?: string; params?: unknown; notes?: import('@/lib/daw-types').MidiNote[]; durationBeats?: number; rollFx?: Record<string, number> }
        const bar = project.timeSignatureNum || 4
        const clip = makeMidiClip(track.id, gen.name || 'Sound', snapBeat(beatX, snap, bar), gen.durationBeats || bar, { isDrumClip: false, ...(gen.rollFx ? { rollFx: gen.rollFx } : {}) })
        clip.notes = (gen.notes ?? []).map(n => ({ ...n, id: crypto.randomUUID() }))
        // Give an empty track the generated sound; leave existing instruments alone.
        if (track.instrument.type === 'none' && gen.params) {
          dispatch({ type: 'SET_INSTRUMENT', trackId: track.id, instrument: { type: 'poly', params: gen.params as import('@/lib/daw-types').PolyInstrumentParams } })
        }
        dispatch({ type: 'ADD_CLIP', clip })
        setSelectedClipId(clip.id)
        setExpandedPianoRollClipId(clip.id)
      } catch (err) {
        console.warn('poly item drop failed:', err)
      }
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
      const clip = makeAudioClip(track.id, entry.name, snapBeat(beatX, snap, project.timeSignatureNum), 8, { audioUrl: url, libraryId: entry.id })
      dispatch({ type: 'ADD_CLIP', clip })
      const buf = await engine.loadClipBuffer(clip)
      if (buf) {
        const peaks = extractPeaks(buf)
        dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch: { waveformPeaks: peaks, durationBeats: engine.secondsToBeats(buf.duration), bufferDuration: buf.duration } })
      }
    }
  }

  // Double-click an empty lane → a "create" popup (Upload / Record / Browse /
  // Synthesize) at the cursor.
  function handleDoubleClick(e: React.MouseEvent) {
    if (frozen) return
    const rect  = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const beatX = (e.clientX - rect.left + scrollLeft) / beatW
    setCreateMenu({ x: e.clientX, y: e.clientY, beat: snapBeat(beatX, snap, project.timeSignatureNum) })
  }

  async function importFileAtBeat(beat: number) {
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
          ab = wavBuf
          blobUrl = URL.createObjectURL(new Blob([wavBuf], { type: 'audio/wav' }))
        } catch {
          console.error('Could not decode AIFF file:', file.name)
          return
        }
      } else {
        blobUrl = URL.createObjectURL(file)
      }
      const clip = makeAudioClip(track.id, file.name.replace(/\.[^.]+$/, ''), beat, 8, { audioUrl: blobUrl })
      dispatch({ type: 'ADD_CLIP', clip })
      // Imported files have no library entry — upload so the clip survives reloads
      void uploadRecordingBlob(new Blob([ab], { type: 'audio/wav' }), clip.id).then(key => {
        if (key) dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch: { r2Key: key } })
      })
      const buf = await engine.loadBufferFromArrayBuffer(clip.id, ab)
      const peaks = extractPeaks(buf)
      dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch: { waveformPeaks: peaks, durationBeats: engine.secondsToBeats(buf.duration), bufferDuration: buf.duration } })
    }
    input.click()
  }

  async function recordIntoTrack() {
    try {
      const source = track.inputSource ?? 'mic'
      dispatch({ type: 'UPDATE_TRACK', trackId: track.id, patch: { armed: true, inputSource: source } })
      await engine.startMicInput(track.id, source)
      engine.play()
      await engine.startRecording()
    } catch (err) {
      console.error('Could not start recording:', err)
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
  // Effective row height: groups + collapsed tracks are thin.
  const rowH = isGroup ? GROUP_TRACK_HEIGHT : (collapsed ? COLLAPSED_TRACK_HEIGHT : track.height)
  const childCount = isGroup ? project.tracks.filter(t => t.groupId === track.id).length : 0

  // ── Drag-to-reorder (native HTML5 drag on the track head) ────────────────
  const [dropPos, setDropPos] = useState<'before' | 'after' | null>(null)
  const headDrag = onReorderDrop ? {
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      // Let interactive controls (name, sliders, buttons) work normally.
      if ((e.target as HTMLElement).closest('input,button,select')) { e.preventDefault(); return }
      e.dataTransfer.setData('application/x-daw-track', track.id)
      e.dataTransfer.effectAllowed = 'move'
    },
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes('application/x-daw-track')) return
      e.preventDefault(); e.dataTransfer.dropEffect = 'move'
      const r = e.currentTarget.getBoundingClientRect()
      setDropPos(e.clientY < r.top + r.height / 2 ? 'before' : 'after')
    },
    onDragLeave: () => setDropPos(null),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault()
      const id = e.dataTransfer.getData('application/x-daw-track')
      const r = e.currentTarget.getBoundingClientRect()
      const pos: 'before' | 'after' = e.clientY < r.top + r.height / 2 ? 'before' : 'after'
      setDropPos(null)
      if (id && id !== track.id) onReorderDrop!(id, track.id, pos)
    },
  } : {}
  const dropLine = dropPos && (
    <div style={{ position: 'absolute', left: 0, right: 0, [dropPos === 'before' ? 'top' : 'bottom']: -1, height: 2, background: 'var(--accent)', zIndex: 5, pointerEvents: 'none' }} />
  )

  // ── Group header row (a folder/bus — no clip lane of its own) ─────────────
  if (isGroup) {
    return (
      <div style={{ position: 'relative', boxShadow: isSelected ? 'inset 2px 0 0 var(--accent)' : 'none' }}>
        {dropLine}
        <div style={{ display: 'flex', height: GROUP_TRACK_HEIGHT, flexShrink: 0 }}>
          {/* Group head */}
          <div
            {...headDrag}
            onClick={e => { if (!(e.target as HTMLElement).closest('button,input,select')) { setSelectedTrackId(track.id); onSelectTrack?.(e.ctrlKey || e.metaKey) } }}
            onContextMenu={e => { e.preventDefault(); e.stopPropagation(); setTrackCtxMenu({ x: e.clientX, y: e.clientY }) }}
            data-help-id="track-head" data-track-id={track.id} data-testid="group-head"
            style={{
              width: HDR_W, height: GROUP_TRACK_HEIGHT, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 3, padding: '0 8px',
              background: isSelected ? 'rgb(var(--accent-rgb) / 0.12)' : `${track.color}22`,
              borderRight: '1px solid var(--border)', borderBottom: '1px solid var(--border)',
              borderLeft: `4px solid ${track.color}`, boxSizing: 'border-box', overflow: 'hidden', cursor: 'grab',
            }}
          >
            <button onClick={e => { e.stopPropagation(); dispatch({ type: 'UPDATE_TRACK', trackId: track.id, patch: { collapsed: !collapsed } }) }}
              title={isFolded ? 'Expand group' : 'Fold group'}
              style={{ fontSize: 9, width: 14, flexShrink: 0, background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: 0 }}>
              {isFolded ? '▸' : '▾'}
            </button>
            <span style={{ fontSize: 8, color: 'var(--text-muted)', flexShrink: 0 }}>▤</span>
            {editing ? (
              <input autoFocus value={draft} onChange={e => setDraft(e.target.value)}
                onBlur={() => { if (!cancelRenameRef.current) dispatch({ type: 'UPDATE_TRACK', trackId: track.id, patch: { name: draft } }); cancelRenameRef.current = false; setEditing(false) }}
                onKeyDown={e => { if (e.key === 'Enter') { dispatch({ type: 'UPDATE_TRACK', trackId: track.id, patch: { name: draft } }); setEditing(false) } else if (e.key === 'Escape') { cancelRenameRef.current = true; setEditing(false) } e.stopPropagation() }}
                style={{ flex: 1, fontSize: 11, background: 'var(--bg-base)', border: '1px solid var(--accent)', color: 'var(--text-primary)', borderRadius: 3, padding: '1px 4px', outline: 'none', minWidth: 0 }} />
            ) : (
              <span onDoubleClick={() => { setEditing(true); setDraft(track.name) }} style={{ flex: 1, fontSize: 11, fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', userSelect: 'none' }}>
                {track.name}
              </span>
            )}
            <span style={{ fontSize: 8, color: 'var(--text-muted)', flexShrink: 0 }}>{childCount}</span>
            <button onClick={e => { e.stopPropagation(); dispatch({ type: 'UPDATE_TRACK', trackId: track.id, patch: { mute: !track.mute } }) }}
              style={{ fontSize: 8, width: 15, height: 14, borderRadius: 2, border: '1px solid var(--border)', background: track.mute ? '#d97706' : 'var(--bg-surface)', color: track.mute ? '#fff' : 'var(--text-muted)', cursor: 'pointer', fontWeight: 700, padding: 0, flexShrink: 0 }}>M</button>
            <button onClick={e => { e.stopPropagation(); dispatch({ type: 'UPDATE_TRACK', trackId: track.id, patch: { solo: !track.solo } }) }}
              style={{ fontSize: 8, width: 15, height: 14, borderRadius: 2, border: '1px solid var(--border)', background: track.solo ? '#eab308' : 'var(--bg-surface)', color: track.solo ? '#000' : 'var(--text-muted)', cursor: 'pointer', fontWeight: 700, padding: 0, flexShrink: 0 }}>S</button>
            <button onClick={e => { e.stopPropagation(); setSelectedTrackId(track.id); setShowFx(v => !v) }}
              title="Group effects — opens the device chain in the Devices tab"
              style={{ fontSize: 8, width: 20, height: 14, borderRadius: 2, border: `1px solid ${track.effects.length ? 'var(--accent)' : 'var(--border)'}`, background: track.effects.length ? 'rgb(var(--accent-rgb) / 0.2)' : 'var(--bg-surface)', color: track.effects.length ? 'var(--accent-light)' : 'var(--text-muted)', cursor: 'pointer', fontWeight: 700, padding: 0, flexShrink: 0 }}>FX</button>
          </div>
          {/* Group lane — a thin summary bar (no clips) */}
          <div style={{ flex: 1, height: GROUP_TRACK_HEIGHT, borderBottom: '1px solid var(--border)', background: `linear-gradient(90deg, ${track.color}18, transparent 40%)`, display: 'flex', alignItems: 'center', paddingLeft: 10 }}>
            <input type="range" min={0} max={1} step={0.01} value={track.volume}
              onChange={e => { const v = parseFloat(e.target.value); dispatch({ type: 'UPDATE_TRACK', trackId: track.id, patch: { volume: v } }); engine.setTrackVolume(track.id, v) }}
              onClick={e => e.stopPropagation()} draggable={false}
              className="cf-slider" style={{ width: 120, accentColor: track.color }} />
            <span style={{ fontSize: 9, color: 'var(--text-muted)', marginLeft: 10 }}>{isFolded ? 'folded' : `${childCount} track${childCount === 1 ? '' : 's'}`}</span>
          </div>
        </div>
        {trackCtxMenu && createPortal(
          <div id={`tcm-${track.id}`} style={{
            position: 'fixed', top: Math.min(trackCtxMenu.y, window.innerHeight - 260), left: Math.min(trackCtxMenu.x, window.innerWidth - 200),
            zIndex: 9999, minWidth: 180, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, boxShadow: '0 10px 28px rgba(0,0,0,0.75)', padding: '4px 0', userSelect: 'none',
          }}>
            <div style={{ padding: '5px 12px 7px', borderBottom: '1px solid var(--border)' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-primary)' }}>{track.name}</div>
              <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 1, textTransform: 'uppercase', letterSpacing: '0.07em' }}>group · {childCount} tracks</div>
            </div>
            {[
              { label: 'Rename', action: () => { setEditing(true); setDraft(track.name) } },
              { label: isFolded ? 'Expand group' : 'Fold group', action: () => dispatch({ type: 'UPDATE_TRACK', trackId: track.id, patch: { collapsed: !collapsed } }) },
              { label: track.mute ? 'Unmute' : 'Mute', action: () => dispatch({ type: 'UPDATE_TRACK', trackId: track.id, patch: { mute: !track.mute } }) },
              { label: track.solo ? 'Unsolo' : 'Solo', action: () => dispatch({ type: 'UPDATE_TRACK', trackId: track.id, patch: { solo: !track.solo } }) },
              { label: 'Ungroup (delete group, keep tracks)', action: () => dispatch({ type: 'REMOVE_TRACK', trackId: track.id }), danger: true },
            ].map(({ label, action, danger }) => (
              <button key={label} onClick={() => { action(); setTrackCtxMenu(null) }}
                style={{ display: 'block', width: '100%', textAlign: 'left', padding: '6px 14px', fontSize: 11, color: danger ? '#f87171' : '#ccc', background: 'transparent', border: 'none', cursor: 'pointer' }}
                onMouseEnter={e => { (e.target as HTMLElement).style.background = danger ? 'rgba(239,68,68,0.10)' : 'rgba(255,255,255,0.06)' }}
                onMouseLeave={e => { (e.target as HTMLElement).style.background = 'transparent' }}
              >{label}</button>
            ))}
            <div style={{ borderTop: '1px solid var(--border)', margin: '3px 0', padding: '6px 12px' }}>
              <div style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 5, letterSpacing: '0.07em', textTransform: 'uppercase' }}>Color</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {trackColors.map(c => (
                  <button key={c} title={c} onClick={() => { dispatch({ type: 'UPDATE_TRACK', trackId: track.id, patch: { color: c } }); setTrackCtxMenu(null) }}
                    style={{ width: 16, height: 16, borderRadius: '50%', background: c, border: track.color === c ? '2px solid #fff' : '2px solid transparent', cursor: 'pointer', padding: 0, boxSizing: 'border-box' }} />
                ))}
              </div>
            </div>
          </div>,
          document.body,
        )}
      </div>
    )
  }

  return (
    <div style={{ position: 'relative', boxShadow: isSelected ? `inset 2px 0 0 var(--accent)` : 'none' }}>
      {dropLine}
      {/* Main track row */}
      <div style={{ display: 'flex', height: rowH, flexShrink: 0 }}>
        {/* Header */}
        <div
          {...headDrag}
          onClick={e => {
            if (!(e.target as HTMLElement).closest('button,input,select')) {
              setSelectedTrackId(track.id)
              onSelectTrack?.(e.ctrlKey || e.metaKey)
            }
          }}
          onContextMenu={e => { e.preventDefault(); e.stopPropagation(); setTrackCtxMenu({ x: e.clientX, y: e.clientY }) }}
          data-help-id="track-head"
          data-track-id={track.id}
          style={{
            width: HDR_W, height: rowH, flexShrink: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: collapsed ? 0 : 4, padding: `${collapsed ? 2 : 4}px 8px`,
            paddingLeft: leftPad,
            background: isSelected ? 'rgb(var(--accent-rgb) / 0.10)' : isMultiSelected ? 'rgb(var(--accent-rgb) / 0.06)' : 'var(--bg-card)',
            borderRight: '1px solid var(--border)', borderBottom: '1px solid var(--border)',
            borderLeft: isIndented ? `3px solid ${track.color}88` : `3px solid ${track.color}`,
            boxSizing: 'border-box', overflow: 'hidden', cursor: 'pointer', transition: 'background 0.1s',
          }}
        >
          {/* Name row — identity + transport controls */}
          <div style={{ display: 'flex', alignItems: 'center', minWidth: 0, gap: 2 }}>
            {/* Collapse toggle — thins this track's row */}
            <button
              onClick={e => { e.stopPropagation(); dispatch({ type: 'UPDATE_TRACK', trackId: track.id, patch: { collapsed: !collapsed } }) }}
              title={collapsed ? 'Expand track' : 'Collapse track'}
              style={{ fontSize: 8, width: 12, height: 12, flexShrink: 0, background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 0, lineHeight: 1 }}
            >
              {collapsed ? '▸' : '▾'}
            </button>
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
                style={{ flex: 1, fontSize: 11, background: 'var(--bg-base)', border: '1px solid var(--accent)', color: 'var(--text-primary)', borderRadius: 3, padding: '1px 4px', outline: 'none', minWidth: 0 }}
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
          {/* Tools row — routing + utilities (hidden when the track is collapsed) */}
          <div style={{ display: collapsed ? 'none' : 'flex', gap: 2, alignItems: 'center' }}>
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
                  background: track.inputSource ? 'rgb(var(--accent-rgb) / 0.15)' : 'var(--bg-surface)',
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
            {collabPeers.length > 0 && (
              <button
                ref={myMixBtnRef}
                title="My mix — adjust this track just for you (collaborators keep their own balance)"
                onClick={e => {
                  e.stopPropagation()
                  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
                  setMyMixOpen(v => v ? null : { x: r.left - 60, y: r.bottom + 6 })
                }}
                style={{ width: 18, height: 14, borderRadius: 2, border: `1px solid ${Math.abs(myMixGain - 1) > 0.01 ? '#34d399' : 'var(--border)'}`, background: myMixOpen ? 'rgba(52,211,153,0.2)' : 'var(--bg-surface)', color: Math.abs(myMixGain - 1) > 0.01 ? '#34d399' : 'var(--text-muted)', cursor: 'pointer', padding: 0, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              ><Headphones size={9} /></button>
            )}
            {myMixOpen && createPortal(
              <div
                ref={myMixPopRef}
                onClick={e => e.stopPropagation()}
                onMouseDown={e => e.stopPropagation()}
                style={{
                  position: 'fixed', zIndex: 1500,
                  left: myMixOpen.x,
                  top: myMixOpen.y,
                  background: 'var(--bg-surface)', border: '1px solid rgba(52,211,153,0.4)', borderRadius: 8,
                  padding: '8px 10px', boxShadow: '0 8px 24px rgba(0,0,0,0.6)', width: 180,
                  display: 'flex', flexDirection: 'column', gap: 5,
                }}
              >
                <span style={{ fontSize: 9, fontWeight: 800, color: '#34d399', letterSpacing: '0.06em' }}>MY MIX · {Math.round(myMixGain * 100)}%</span>
                <input
                  type="range" min={0} max={2} step={0.01} value={myMixGain}
                  onChange={e => { const v = parseFloat(e.target.value); setMyMixGain(v); engine.setLocalTrackGain(track.id, v) }}
                  className="cf-slider" style={{ accentColor: '#34d399' }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 8.5, color: 'var(--text-muted)', lineHeight: 1.4 }}>Only you hear this change</span>
                  <button onClick={() => { setMyMixGain(1); engine.setLocalTrackGain(track.id, 1) }} style={{ fontSize: 8.5, fontWeight: 700, padding: '2px 7px', borderRadius: 99, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer' }}>Reset</button>
                </div>
              </div>,
              document.body,
            )}
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
              background: 'var(--bg-surface)', border: '1px solid var(--border)',
              borderRadius: 8, boxShadow: '0 10px 28px rgba(0,0,0,0.75)',
              padding: '4px 0', userSelect: 'none',
            }}
          >
            {/* Track name header */}
            <div style={{ padding: '5px 12px 7px', borderBottom: '1px solid var(--border)' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{track.name}</div>
              <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 1, textTransform: 'uppercase', letterSpacing: '0.07em' }}>{track.instrument.type === 'drum' ? 'drum' : track.instrument.type === 'none' ? 'audio' : 'midi'} track</div>
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
            <div style={{ borderTop: '1px solid var(--border)', margin: '3px 0' }} />
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
                <div style={{ borderTop: '1px solid var(--border)', margin: '3px 0' }} />
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
              <div style={{ borderTop: '1px solid var(--border)', margin: '3px 0' }} />
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
            <div style={{ borderTop: '1px solid var(--border)', margin: '3px 0' }} />
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
            <div style={{ borderTop: '1px solid var(--border)', margin: '3px 0', padding: '6px 12px' }}>
              <div style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 5, letterSpacing: '0.07em', textTransform: 'uppercase' }}>Color</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {trackColors.map(c => (
                  <button key={c} title={c}
                    onClick={() => { dispatch({ type: 'UPDATE_TRACK', trackId: track.id, patch: { color: c } }); setTrackCtxMenu(null) }}
                    style={{ width: 16, height: 16, borderRadius: '50%', background: c, border: track.color === c ? '2px solid #fff' : '2px solid transparent', cursor: 'pointer', padding: 0, boxSizing: 'border-box' }}
                  />
                ))}
              </div>
            </div>

            {/* Height presets */}
            <div style={{ borderTop: '1px solid var(--border)', margin: '0', padding: '6px 12px 8px' }}>
              <div style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 5, letterSpacing: '0.07em', textTransform: 'uppercase' }}>Height</div>
              <div style={{ display: 'flex', gap: 4 }}>
                {[['Compact', 40], ['Normal', 64], ['Tall', 120]] .map(([label, h]) => (
                  <button key={label}
                    onClick={() => { dispatch({ type: 'UPDATE_TRACK', trackId: track.id, patch: { height: h as number } }); setTrackCtxMenu(null) }}
                    style={{ flex: 1, fontSize: 9, padding: '3px 0', borderRadius: 4, cursor: 'pointer', border: `1px solid ${track.height === h ? 'var(--accent)' : '#2a2a2a'}`, background: track.height === h ? 'rgb(var(--accent-rgb) / 0.12)' : 'transparent', color: track.height === h ? 'var(--accent)' : '#666' }}
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
          data-help-id="track-lane"
          data-track-id={track.id}
          data-track-type={track.type}
          style={{ flex: 1, height: rowH, position: 'relative', background: isSelected ? 'rgb(var(--accent-rgb) / 0.04)' : 'var(--bg-surface)', borderBottom: '1px solid var(--border)', overflow: 'hidden', transition: 'background 0.1s' }}
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
          <div data-content-layer style={{ position: 'absolute', top: 0, bottom: 0, left: -scrollLeft, width: (viewEndBeat + 10) * beatW }}>
            {isSelectionTrack && selectionRegion && selectionRegion.end > selectionRegion.start && (
              <div style={{
                position: 'absolute', top: 0, bottom: 0,
                left: selectionRegion.start * beatW,
                width: (selectionRegion.end - selectionRegion.start) * beatW,
                background: 'rgba(255,255,255,0.14)',
                border: '1px solid rgba(255,255,255,0.92)', borderRadius: 3,
                pointerEvents: 'none', zIndex: 1, boxSizing: 'border-box',
              }}>
                <div
                  onMouseDown={onSelectionEdgeDown}
                  title="Drag to repeat the selection across all selected tracks"
                  style={{
                    position: 'absolute', top: 0, bottom: 0, right: -5, width: 11,
                    cursor: 'ew-resize', pointerEvents: 'auto', zIndex: 3,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  <div style={{ width: 3, height: '46%', minHeight: 10, borderRadius: 2, background: '#fff' }} />
                </div>
              </div>
            )}
            {recording && track.armed && !!track.inputSource && (
              <RecordingGhost beatW={beatW} height={rowH} />
            )}
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
                    const trackOrigins: Record<string, string> = {}
                    for (const c of project.arrangementClips) {
                      if (selectedClipIds.has(c.id)) { origins[c.id] = c.startBeat; trackOrigins[c.id] = c.trackId }
                    }
                    multiDragOrigins.current = origins
                    multiDragTrackOrigins.current = trackOrigins
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
                      // Vertical: shift every selected clip by the same number of
                      // track rows as the grabbed clip, clamped to real tracks
                      const rows = project.tracks.filter(t => t.type === 'audio').map(t => t.id)
                      const grabbedFrom = multiDragTrackOrigins.current[clip.id] ?? track.id
                      const idxTo = rows.indexOf(tid), idxFrom = rows.indexOf(grabbedFrom)
                      const rowDelta = idxTo === -1 || idxFrom === -1 ? 0 : idxTo - idxFrom
                      for (const c of project.arrangementClips) {
                        if (!selectedClipIds.has(c.id)) continue
                        const cOrigin = multiDragOrigins.current[c.id] ?? c.startBeat
                        const cFrom = multiDragTrackOrigins.current[c.id] ?? c.trackId
                        const cIdx = rows.indexOf(cFrom)
                        const target = rowDelta !== 0 && cIdx !== -1
                          ? rows[Math.max(0, Math.min(rows.length - 1, cIdx + rowDelta))]
                          : cFrom
                        dispatch({ type: 'MOVE_CLIP', clipId: c.id, startBeat: Math.max(0, cOrigin + snappedDelta), trackId: target })
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
                    dragForceRef.current = heldDragMode()
                    const wantExpand = dragForceRef.current
                      ? dragForceRef.current === 'expand'
                      : isMidiClip(clip) && !!clip.stretchNotes
                    if (isMidiClip(clip)) {
                      // Forced expand on a looping clip: bake the repeats into
                      // the originals so the stretch keeps the audible pattern.
                      let notes = clip.notes
                      if (wantExpand && clip.loopEnabled && clip.loopLengthBeats) {
                        const L = clip.loopLengthBeats
                        const out: typeof notes = []
                        for (let k = 0; k * L < clip.durationBeats; k++) {
                          for (const nt of clip.notes) {
                            const start = k * L + nt.startBeat
                            if (start >= clip.durationBeats) continue
                            out.push({ ...nt, id: crypto.randomUUID(), startBeat: start, durationBeats: Math.min(nt.durationBeats, clip.durationBeats - start) })
                          }
                        }
                        notes = out
                      }
                      stretchOriginRef.current = { clipId: clip.id, durationBeats: clip.durationBeats, notes }
                    }
                    groupResizeRef.current = null
                    if (selectedClipIds.size > 1 && selectedClipIds.has(clip.id)) {
                      const members = project.arrangementClips
                        .filter(c => selectedClipIds.has(c.id))
                        .map(c => JSON.parse(JSON.stringify(c)) as DawClip)
                      if (members.length > 1) {
                        // A rubber-band region defines the loop unit — the
                        // selected bar(s) tile as drawn, blank space included,
                        // instead of snapping to the clips' content bounds
                        // The group span is the selected clips' full extent
                        // (first start → last end). A rubber-band region may
                        // widen it (blank space included) but must NEVER make
                        // it smaller than the clips, or the resize would shrink
                        // them. So clamp to the members' bounds.
                        const membersStart = Math.min(...members.map(c => c.startBeat))
                        const membersEnd   = Math.max(...members.map(c => c.startBeat + c.durationBeats))
                        const sel = getSelectionRegion?.() ?? null
                        groupResizeRef.current = {
                          clipId: clip.id,
                          grabbedDur: clip.durationBeats,
                          mode: dragForceRef.current ?? ((isMidiClip(clip) ? !!clip.stretchNotes : !!clip.warpEnabled) ? 'expand' : 'loop'),
                          groupStart: sel ? Math.min(sel.start, membersStart) : membersStart,
                          groupEnd:   sel ? Math.max(sel.end, membersEnd) : membersEnd,
                          members,
                        }
                      }
                    }
                  }}
                  onResize={(db, alt) => {
                    if (frozen) return
                    const grp = groupResizeRef.current
                    if (grp && grp.clipId === clip.id) {
                      if (grp.mode === 'loop') {
                        // preview only — tiles are placed on mouse-up
                        grp.lastDb = Math.max(0.125, db)
                        dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch: { durationBeats: grp.lastDb } })
                        return
                      }
                      // expand: scale the whole block by the drag ratio.
                      // Content stretches with the window — MIDI patterns
                      // scale their notes, audio members warp — so nothing
                      // is left with a silent tail.
                      const ratio = Math.max(0.05, db / grp.grabbedDur)
                      for (const m of grp.members) {
                        const newStart = grp.groupStart + (m.startBeat - grp.groupStart) * ratio
                        const newDur = Math.max(0.125, m.durationBeats * ratio)
                        dispatch({ type: 'MOVE_CLIP', clipId: m.id, startBeat: newStart })
                        if (isMidiClip(m)) {
                          const patch: Record<string, unknown> = {
                            durationBeats: newDur,
                            notes: m.notes.map(n => ({ ...n, startBeat: n.startBeat * ratio, durationBeats: n.durationBeats * ratio })),
                          }
                          if (m.loopEnabled && m.loopLengthBeats) patch.loopLengthBeats = m.loopLengthBeats * ratio
                          dispatch({ type: 'UPDATE_CLIP', clipId: m.id, patch })
                        } else {
                          dispatch({ type: 'UPDATE_CLIP', clipId: m.id, patch: { durationBeats: newDur, warpEnabled: true } })
                        }
                      }
                      return
                    }
                    const endBeat = clip.startBeat + db
                    let snappedEnd = alt ? endBeat : snapBeat(endBeat, snap, project.timeSignatureNum)
                    if (!alt) snappedEnd = snapToClipEdges(snappedEnd, new Set([clip.id]), 8 / beatW, project.arrangementClips)
                    const newDurBeats = Math.max(0.125, snappedEnd - clip.startBeat)
                    // The drag's mode: held E/L wins, then the clip's own type
                    const forced = dragForceRef.current
                    const wantExpand = forced ? forced === 'expand'
                      : isMidiClip(clip) ? !!clip.stretchNotes : !!clip.warpEnabled
                    // Expand: scale the whole note pattern to the new length —
                    // from the originals captured at resize start, so repeated
                    // drag events don't compound rounding.
                    const so = stretchOriginRef.current
                    if (isMidiClip(clip) && wantExpand && so?.clipId === clip.id) {
                      const ratio = newDurBeats / so.durationBeats
                      dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch: {
                        durationBeats: newDurBeats,
                        notes: so.notes.map(n => ({ ...n, startBeat: n.startBeat * ratio, durationBeats: n.durationBeats * ratio })),
                        ...(forced === 'expand' ? { stretchNotes: true, loopEnabled: false, loopLengthBeats: undefined } : {}),
                      } })
                      return
                    }
                    const patch: Record<string, unknown> = { durationBeats: newDurBeats }
                    if (isAudioClip(clip) && clip.bufferDuration) {
                      if (wantExpand) {
                        patch.warpEnabled = true
                        patch.loopEnabled = false
                      } else {
                        const nativeSec = clip.bufferDuration - clip.trimStart - clip.trimEnd
                        const newDurSec = engine.beatsToSeconds(newDurBeats)
                        // Only enable loop when dragging past native duration. NEVER change trimEnd/trimStart.
                        if (newDurSec > nativeSec + 0.001) patch.loopEnabled = true
                        if (forced === 'loop') patch.warpEnabled = false
                      }
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
                  onResizeEnd={() => {
                    const grp = groupResizeRef.current
                    groupResizeRef.current = null
                    if (!grp || grp.clipId !== clip.id || grp.mode !== 'loop' || frozen) return
                    const span = grp.groupEnd - grp.groupStart
                    if (span <= 0.001) return
                    // project in this closure is from mousedown-time — track the
                    // drag's final duration in the ref instead. Extension is
                    // measured from the GROUP/region end, so trailing blank
                    // space in a region counts toward the loop unit.
                    const extension = clip.startBeat + (grp.lastDb ?? grp.grabbedDur) - grp.groupEnd
                    // back to the original length — the extension chose the tile count
                    dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch: { durationBeats: grp.grabbedDur } })
                    if (extension < 0.05) return
                    const n = Math.min(24, Math.floor(extension / span))
                    const makeCopy = (m: DawClip, offset: number) => {
                      const copy = JSON.parse(JSON.stringify(m)) as DawClip
                      copy.id = crypto.randomUUID()
                      copy.startBeat = m.startBeat + offset
                      if (isMidiClip(copy)) copy.notes = copy.notes.map(nt => ({ ...nt, id: crypto.randomUUID() }))
                      return copy
                    }
                    for (let k = 1; k <= n; k++) {
                      for (const m of grp.members) dispatch({ type: 'ADD_CLIP', clip: makeCopy(m, k * span) })
                    }
                    // Partial last tile: any drag shorter than a full span still
                    // loops — members are cropped where the drag stopped, so the
                    // loop cuts exactly like a loop region would
                    const remainder = extension - n * span
                    if (remainder > 0.05 && n < 24) {
                      for (const m of grp.members) {
                        const offsetInSpan = m.startBeat - grp.groupStart
                        if (offsetInSpan >= remainder) continue
                        const copy = makeCopy(m, (n + 1) * span)
                        copy.durationBeats = Math.min(copy.durationBeats, remainder - offsetInSpan)
                        dispatch({ type: 'ADD_CLIP', clip: copy })
                      }
                    }
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
                    width: 18, height: 18, borderRadius: 9, background: 'var(--accent)',
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
      {!collapsed && takesExpanded && takeLanes.map(lane => (
        <div key={lane.id} style={{ display: 'flex', height: TAKE_H, flexShrink: 0 }}>
          {/* Take lane header */}
          <div style={{
            width: HDR_W, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 4, padding: '0 8px',
            background: 'var(--bg-surface)',
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
            background: 'var(--bg-surface)', border: '1px solid var(--border)',
            borderRadius: 8, boxShadow: '0 10px 28px rgba(0,0,0,0.75)',
            padding: '4px 0',
          }}
          onMouseDown={e => e.stopPropagation()}
        >
          <div style={{ padding: '5px 12px 7px', borderBottom: '1px solid var(--border)' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-primary)' }}>{takeLaneCtx.lane.name}</div>
            <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 1 }}>{takeLaneCtx.clip.name}</div>
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
      {!collapsed && autoLanes.map(lane => (
        <div key={lane.id} style={{ display: 'flex', height: AUTO_H, flexShrink: 0 }}>
          <AutoLaneHeader lane={lane} track={track} />
          <div style={{ flex: 1, height: AUTO_H, overflow: 'hidden', borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)' }}>
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
      {!collapsed && showFx && (
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
        <div id={`lcm-${track.id}`} ref={laneMenuRef} style={{ position: 'fixed', zIndex: 1000, left: laneCtxMenu.x, top: laneCtxMenu.y, background: 'var(--bg-card-hover)', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 0', minWidth: 170, boxShadow: '0 4px 20px rgba(0,0,0,0.5)' }}>
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
          <button
            onClick={() => {
              setPickerInsertBeat(snapBeat(laneCtxMenu.beat, snap, project.timeSignatureNum))
              setShowLibraryPicker(true)
              setLaneCtxMenu(null)
            }}
            style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', padding: '6px 12px', fontSize: 11, cursor: 'pointer', background: 'transparent', border: 'none', color: 'var(--text-primary)' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
          >
            <span>♫ Sound from library here</span>
          </button>
        </div>
      )}

      {createMenu && createPortal(
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 1999 }} onMouseDown={() => setCreateMenu(null)} />
          <div ref={createMenuRef} style={{ position: 'fixed', zIndex: 2000, left: createMenu.x, top: createMenu.y, background: 'var(--bg-card-hover)', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 0', minWidth: 190, boxShadow: '0 4px 20px rgba(0,0,0,0.5)' }}>
            {([
              ['⬆', 'Upload audio', () => importFileAtBeat(createMenu.beat)],
              ['●', 'Record from mic', () => recordIntoTrack()],
              ['♫', 'Browse library', () => { setPickerInsertBeat(snapBeat(createMenu.beat, snap, project.timeSignatureNum)); setShowLibraryPicker(true) }],
              ['⌁', 'Synthesize (code)', () => setShowSynth(true)],
            ] as [string, string, () => void][]).map(([icon, label, action]) => (
              <button key={label}
                onClick={() => { action(); setCreateMenu(null) }}
                style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', padding: '7px 14px', fontSize: 11, cursor: 'pointer', background: 'transparent', border: 'none', color: 'var(--text-primary)' }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)' }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}>
                <span style={{ color: '#a78bfa', width: 14, textAlign: 'center' }}>{icon}</span>
                <span>{label}</span>
              </button>
            ))}
          </div>
        </>,
        document.body
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
          onMouseDown={e => { if (e.target === e.currentTarget) { setShowLibraryPicker(false); setPickerInsertBeat(null) } }}>
          <div style={{ width: 480, height: 620, background: 'var(--bg-card)', borderRadius: 10, border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 16px 48px rgba(0,0,0,0.8)' }}>
            <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{pickerInsertBeat !== null ? 'Add a Sound' : 'Replace Sample'}</span>
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

      {showSynth && createPortal(
        <div className="electron-nodrag" style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onMouseDown={e => { if (e.target === e.currentTarget) setShowSynth(false) }}>
          <div style={{ width: 480, height: 560, background: 'var(--bg-card)', borderRadius: 10, border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 16px 48px rgba(0,0,0,0.8)' }}>
            <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Synthesize with code</span>
              <button onClick={() => setShowSynth(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 16, lineHeight: 1 }}>✕</button>
            </div>
            <div style={{ flex: 1, overflow: 'hidden' }}>
              <PolyCodePanel onDone={() => setShowSynth(false)} />
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
