'use client'

import { uploadRecordingBlob } from '@/lib/record-upload'
import Knob from './Knob'
import { useRegisterCommands } from '@/lib/commands'
import { useState, useRef, useEffect, useCallback } from 'react'
import { Plus, Square, Circle, ChevronRight, X } from 'lucide-react'
import { useDaw, extractPeaks, makeAudioClip } from '@/lib/daw-state'
import type { DawTrack, DawClip, MidiClip, LaunchQuantization, CrossfaderSide, Scene } from '@/lib/daw-types'
import { isAudioClip, isMidiClip } from '@/lib/daw-types'
import { sessionCaptureToClips } from '@/lib/daw-session'
import { LAUNCH_MODES, LAUNCH_MODE_LABEL, LAUNCH_MODE_HELP, modeOf } from '@/lib/launch'
import { FOLLOW_ACTIONS, FOLLOW_LABEL, DEFAULT_FOLLOW, followOf, isIdle, describeFollow, type FollowSettings, type FollowAction } from '@/lib/follow-actions'
import { moveSpot, clipAt, captureScene, type Spot, type GridMove } from '@/lib/session-keys'
import { resolveKey } from '@/lib/keymap'
import { apHeader, apTitle, apControl, apSelect, apDivider, apReadout } from './apollo-chrome'
import { libraryGetAll } from '@/lib/sound-library'
import { libraryFulfill } from '@/lib/default-samples'
import Waveform from './Waveform'

const SLOT_W  = 160
const SLOT_H  = 72
const HDR_W   = 200
const SCENE_W = 110

const CLIP_COLORS = [
  '#3b82f6', '#22c55e', '#f97316', '#a855f7',
  '#ec4899', '#14b8a6', '#eab308', '#ef4444',
]

type SlotDisplayState = 'idle' | 'queued' | 'playing'
type SlotRecording = { trackId: string; sceneIndex: number; bars: number } | null

// ── Context menu helpers ───────────────────────────────────────────────────────

function CtxItem({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      style={{ display: 'block', width: '100%', textAlign: 'left', padding: '5px 12px', fontSize: 11, cursor: 'pointer', background: 'transparent', border: 'none', color: danger ? '#ef4444' : 'var(--text-primary)' }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)' }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
    >{label}</button>
  )
}

function CtxSep() {
  return <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
}

// ── Mini pan drag ─────────────────────────────────────────────────────────────

function PanDrag({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const dragRef = useRef<{ startX: number; startVal: number } | null>(null)
  const label   = value === 0 ? 'C' : value < 0 ? `L${Math.round(-value * 100)}` : `R${Math.round(value * 100)}`

  function onMouseDown(e: React.MouseEvent) {
    if (e.detail === 2) { onChange(0); return }
    dragRef.current = { startX: e.clientX, startVal: value }
    function onMove(ev: MouseEvent) {
      if (!dragRef.current) return
      onChange(Math.max(-1, Math.min(1, dragRef.current.startVal + (ev.clientX - dragRef.current.startX) / 80)))
    }
    function onUp() {
      dragRef.current = null
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  return (
    <div
      onMouseDown={onMouseDown}
      title={`Pan: ${label} — double-click to center`}
      style={{ fontSize: 9, color: 'var(--text-muted)', cursor: 'ew-resize', userSelect: 'none', padding: '1px 3px', borderRadius: 2, border: '1px solid var(--border)', minWidth: 22, textAlign: 'center' }}
    >{label}</div>
  )
}

// ── Track header ──────────────────────────────────────────────────────────────

function TrackHeader({ track }: { track: DawTrack }) {
  const { dispatch, engine, project } = useDaw()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft]     = useState(track.name)

  const crossfaderValue = project.crossfaderValue ?? 0.5
  const cfSide = track.crossfader ?? 'none'

  // Visual dimming from crossfader position
  let cfOpacity = 1
  if (cfSide === 'A') cfOpacity = 1 - Math.max(0, (crossfaderValue - 0.5) * 2)
  else if (cfSide === 'B') cfOpacity = 1 - Math.max(0, (0.5 - crossfaderValue) * 2)

  function commit() {
    dispatch({ type: 'UPDATE_TRACK', trackId: track.id, patch: { name: draft } })
    setEditing(false)
  }

  return (
    <div style={{
      width: HDR_W, height: SLOT_H, flexShrink: 0,
      display: 'flex', flexDirection: 'column', justifyContent: 'center',
      gap: 3, padding: '5px 8px',
      background: 'var(--bg-card)',
      borderRight: '1px solid var(--border)',
      borderBottom: '1px solid var(--border)',
      borderLeft: `3px solid ${track.color}`,
      boxSizing: 'border-box',
      opacity: cfOpacity < 0.95 ? Math.max(0.25, cfOpacity) : 1,
      transition: 'opacity 0.12s',
    }}>
      {/* Row 1: name */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        {editing ? (
          <input
            autoFocus value={draft}
            onChange={e => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') commit(); e.stopPropagation() }}
            style={{ flex: 1, fontSize: 11, background: 'var(--bg-base)', border: '1px solid var(--accent)', color: 'var(--text-primary)', borderRadius: 3, padding: '1px 4px', outline: 'none' }}
          />
        ) : (
          <span
            onDoubleClick={() => { setEditing(true); setDraft(track.name) }}
            style={{ flex: 1, fontSize: 11, color: 'var(--text-primary)', cursor: 'default', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', userSelect: 'none' }}
          >{track.name}</span>
        )}
        <span style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'monospace', flexShrink: 0 }}>
          {track.instrument.type === 'drum' ? 'DR' : track.instrument.type === 'none' ? 'AU' : 'MI'}
        </span>
      </div>

      {/* Row 2: M/S/arm + volume + pan */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
        <button
          onClick={() => dispatch({ type: 'UPDATE_TRACK', trackId: track.id, patch: { mute: !track.mute } })}
          style={{ fontSize: 9, width: 18, height: 15, borderRadius: 2, border: '1px solid var(--border)', background: track.mute ? '#d97706' : 'var(--bg-surface)', color: track.mute ? '#fff' : 'var(--text-muted)', cursor: 'pointer', fontWeight: 700, padding: 0 }}
          title="Mute">M</button>
        <button
          onClick={() => dispatch({ type: 'UPDATE_TRACK', trackId: track.id, patch: { solo: !track.solo } })}
          style={{ fontSize: 9, width: 18, height: 15, borderRadius: 2, border: '1px solid var(--border)', background: track.solo ? '#eab308' : 'var(--bg-surface)', color: track.solo ? '#000' : 'var(--text-muted)', cursor: 'pointer', fontWeight: 700, padding: 0 }}
          title="Solo">S</button>
        <button
          onClick={() => dispatch({ type: 'UPDATE_TRACK', trackId: track.id, patch: { armed: !track.armed } })}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 18, height: 15, borderRadius: 2, border: '1px solid var(--border)', background: track.armed ? 'rgba(239,68,68,0.18)' : 'var(--bg-surface)', color: track.armed ? '#ef4444' : 'var(--text-muted)', cursor: 'pointer', padding: 0 }}
          title="Arm">
          <Circle size={7} fill={track.armed ? '#ef4444' : 'transparent'} />
        </button>
        <Knob
          value={track.volume} min={0} max={1} defaultValue={0.8} size={22} color={track.color}
          onChange={v => { dispatch({ type: 'UPDATE_TRACK', trackId: track.id, patch: { volume: v } }); engine.setTrackVolume(track.id, v) }}
          format={v => `${Math.round(v * 100)}%`}
        />
        <div style={{ flex: 1 }} />
        <PanDrag value={track.pan} onChange={v => { dispatch({ type: 'UPDATE_TRACK', trackId: track.id, patch: { pan: v } }); engine.setTrackPan(track.id, v) }} />
      </div>

      {/* Row 3: crossfader A/none/B + FX */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        <span style={{ fontSize: 8, color: 'var(--text-muted)', marginRight: 1 }}>CF:</span>
        {(['A', 'none', 'B'] as CrossfaderSide[]).map(side => (
          <button
            key={side}
            onClick={() => dispatch({ type: 'UPDATE_TRACK', trackId: track.id, patch: { crossfader: side } })}
            style={{
              fontSize: 8, height: 13, padding: '0 5px', borderRadius: 2,
              border: '1px solid var(--border)',
              background: cfSide === side
                ? (side === 'A' ? '#3b82f6' : side === 'B' ? '#f97316' : 'rgba(255,255,255,0.12)')
                : 'var(--bg-surface)',
              color: cfSide === side ? '#fff' : 'var(--text-muted)',
              cursor: 'pointer',
            }}
          >{side}</button>
        ))}
        <FxButton trackId={track.id} />
      </div>
    </div>
  )
}

function FxButton({ trackId }: { trackId: string }) {
  const { selectedTrackId, setSelectedTrackId, project } = useDaw()
  const active = selectedTrackId === trackId
  const track = project.tracks.find(t => t.id === trackId)
  const count = track?.effects.length ?? 0
  return (
    <button
      onClick={() => setSelectedTrackId(active ? null : trackId)}
      title="Show FX chain"
      style={{
        marginLeft: 2, fontSize: 8, padding: '1px 4px', borderRadius: 2, cursor: 'pointer', fontWeight: 700,
        border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
        background: active ? 'rgb(var(--accent-rgb) / 0.18)' : 'var(--bg-surface)',
        color: active ? 'var(--accent)' : count > 0 ? 'var(--accent)' : 'var(--text-muted)',
      }}
    >{count > 0 ? `FX(${count})` : 'FX'}</button>
  )
}

// ── Clip slot ─────────────────────────────────────────────────────────────────

interface ClipSlotProps {
  track: DawTrack
  sceneIndex: number
  clip: DawClip | null
  slotRecording: SlotRecording
  setSlotRecording: (r: SlotRecording) => void
  onDragStart: (e: React.DragEvent, trackId: string, sceneIndex: number) => void
  onDrop: (e: React.DragEvent, destTrackId: string, destSceneIndex: number) => void
  // (follow actions moved to the engine — lib/follow-actions.ts)
  /** Where the keyboard is pointing (lib/session-keys.ts). */
  highlighted?: boolean
  /** The slot last pressed or right-clicked — what the ⌘K launch commands act on. */
  onTouch: (trackId: string, sceneIndex: number) => void
}

function ClipSlot({ track, sceneIndex, clip, slotRecording, setSlotRecording, onDragStart, onDrop, onTouch, highlighted }: ClipSlotProps) {
  const { dispatch, engine, project } = useDaw()
  const [displayState, setDisplayState] = useState<SlotDisplayState>('idle')
  const [progress, setProgress]         = useState(0)
  const [dragOver, setDragOver]         = useState(false)
  const [ctxMenu, setCtxMenu]           = useState<{ x: number; y: number } | null>(null)
  const [renaming, setRenaming]         = useState(false)
  const [renameDraft, setRenameDraft]   = useState('')
  const [hovered, setHovered]           = useState(false)
  const [trackHasPlaying, setTrackHasPlaying] = useState(false)
  const rafRef    = useRef<number | undefined>(undefined)
  const prevState = useRef<SlotDisplayState>('idle')
  const [micError, setMicError] = useState('')
  const [micPerm, setMicPerm] = useState<'unknown' | 'granted' | 'denied'>('unknown')

  // Check mic permission state when track becomes armed so the slot can explain failures
  useEffect(() => {
    if (!track.armed) return
    const perm = navigator.permissions as Permissions & { query?: (d: { name: string }) => Promise<PermissionStatus> }
    perm?.query?.({ name: 'microphone' })
      .then(s => {
        setMicPerm(s.state === 'denied' ? 'denied' : s.state === 'granted' ? 'granted' : 'unknown')
        s.onchange = () => setMicPerm(s.state === 'denied' ? 'denied' : s.state === 'granted' ? 'granted' : 'unknown')
      })
      .catch(() => {})
  }, [track.armed])

  const audioClip = clip && isAudioClip(clip) ? clip : null
  const midiClip  = clip && isMidiClip(clip)  ? clip : null
  const clipColor = clip?.color ?? track.color
  const isRecordingHere = slotRecording?.trackId === track.id && slotRecording?.sceneIndex === sceneIndex

  // ── Session state sync + follow action trigger ──────────────────────────────
  useEffect(() => {
    if (!clip) { setDisplayState('idle'); prevState.current = 'idle'; return }

    function onState(e: Event) {
      const d = (e as CustomEvent).detail as { trackId: string; clipId: string; state: SlotDisplayState }
      if (d.trackId !== track.id || d.clipId !== clip!.id) return
      const prev = prevState.current
      prevState.current = d.state
      setDisplayState(d.state)
      if (d.state !== 'playing') setProgress(0)
      // ⚠️ FOLLOW ACTIONS ARE THE ENGINE'S NOW (lib/follow-actions.ts). They
      // used to fire here, on a clip going from playing to idle — which for a
      // LOOPING clip never happens, so they silently did nothing on the normal
      // case. They also stopped working the moment you left this view.
      void prev
    }

    engine.addEventListener('session-state', onState)
    const init = engine.getSessionState(track.id, clip.id)
    setDisplayState(init)
    prevState.current = init
    return () => engine.removeEventListener('session-state', onState)
  }, [engine, track.id, clip, sceneIndex])

  // ── Track whether any clip on this track is playing (empty-slot stop hint) ──
  useEffect(() => {
    function onState(e: Event) {
      const d = (e as CustomEvent).detail as { trackId: string; clipId: string; state: SlotDisplayState }
      if (d.trackId !== track.id) return
      const trackClips = project.sessionGrid[track.id] ?? []
      const hasAny = trackClips.some(c => {
        if (!c) return false
        const s = c.id === d.clipId ? d.state : engine.getSessionState(track.id, c.id)
        return s === 'playing' || s === 'queued'
      })
      setTrackHasPlaying(hasAny)
    }
    engine.addEventListener('session-state', onState)
    return () => engine.removeEventListener('session-state', onState)
  }, [engine, track.id, project.sessionGrid])

  // ── Progress RAF while playing ──────────────────────────────────────────────
  useEffect(() => {
    if (displayState !== 'playing') {
      if (rafRef.current !== undefined) cancelAnimationFrame(rafRef.current)
      return
    }
    function tick() {
      setProgress(engine.getSessionProgress(track.id))
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => { if (rafRef.current !== undefined) cancelAnimationFrame(rafRef.current) }
  }, [displayState, engine, track.id])

  // Save recorded blob to this session slot when recording completes
  useEffect(() => {
    if (!isRecordingHere) return
    function onDone(e: Event) {
      const { blob, durationBeats } = (e as CustomEvent<{ blob: Blob; startBeat: number; durationBeats: number }>).detail
      if (blob && blob.size > 0) {
        const audioUrl = URL.createObjectURL(blob)
        const clip = makeAudioClip(track.id, 'Recording', 0, durationBeats, { audioUrl })
        dispatch({ type: 'SET_SESSION_SLOT', trackId: track.id, sceneIndex, clip })
        void uploadRecordingBlob(blob, clip.id).then(key => {
          if (key) dispatch({ type: 'SET_SESSION_SLOT', trackId: track.id, sceneIndex, clip: { ...clip, r2Key: key } })
        })
      }
      setSlotRecording(null)
    }
    engine.addEventListener('recording-complete', onDone)
    return () => engine.removeEventListener('recording-complete', onDone)
  }, [engine, isRecordingHere, track.id, sceneIndex, dispatch, setSlotRecording])

  // ── Blink for queued state ──────────────────────────────────────────────────
  const [blink, setBlink] = useState(true)
  useEffect(() => {
    if (displayState !== 'queued') return
    const iv = setInterval(() => setBlink(v => !v), 500)
    return () => clearInterval(iv)
  }, [displayState])

  // ── Handlers ───────────────────────────────────────────────────────────────

  // A press and a release, not a click: Gate plays only while the button is
  // held and Repeat retriggers until it is let go (lib/launch.ts). Trigger and
  // Toggle ignore the release, so every slot can use the same two handlers.
  async function handleTrigger(velocity?: number) {
    onTouch(track.id, sceneIndex)
    if (audioClip) {
      await engine.queueSession(track.id, audioClip, audioClip.launchQuantization, velocity != null ? { velocity } : undefined)
    } else if (midiClip) {
      await engine.queueSessionMidi(track.id, midiClip, midiClip.launchQuantization)
    }
  }
  function handleRelease() {
    if (clip) engine.releaseSession(track.id, clip.id)
  }

  async function handleFileDrop(e: React.DragEvent) {
    const libId = e.dataTransfer.getData('application/x-library-entry-id')
    const files  = e.dataTransfer.files

    if (libId) {
      const entries = await libraryGetAll()
      let entry = entries.find(en => en.id === libId)
      if (!entry) return
      if (!entry.audioBlob) {
        const fulfilled = await libraryFulfill(entry.id)
        if (!fulfilled?.audioBlob) return
        entry = fulfilled
      }
      const url = URL.createObjectURL(entry.audioBlob!)
      const nc  = makeAudioClip(track.id, entry.name, 0, 8, { audioUrl: url, loopEnabled: true })
      dispatch({ type: 'SET_SESSION_SLOT', trackId: track.id, sceneIndex, clip: nc })
      const buf = await engine.loadClipBuffer(nc)
      if (buf) {
        const peaks = extractPeaks(buf)
        dispatch({ type: 'SET_SESSION_SLOT', trackId: track.id, sceneIndex, clip: { ...nc, waveformPeaks: peaks, durationBeats: engine.secondsToBeats(buf.duration) } })
      }
      return
    }

    if (files.length > 0) {
      const file = files[0]
      if (!file.type.startsWith('audio/')) return
      const url = URL.createObjectURL(file)
      const nc  = makeAudioClip(track.id, file.name.replace(/\.[^.]+$/, ''), 0, 8, { audioUrl: url, loopEnabled: true })
      dispatch({ type: 'SET_SESSION_SLOT', trackId: track.id, sceneIndex, clip: nc })
      const ab  = await file.arrayBuffer()
      const buf = await engine.loadBufferFromArrayBuffer(nc.id, ab)
      const peaks = extractPeaks(buf)
      dispatch({ type: 'SET_SESSION_SLOT', trackId: track.id, sceneIndex, clip: { ...nc, waveformPeaks: peaks, durationBeats: engine.secondsToBeats(buf.duration) } })
    }
  }

  async function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const clipData = e.dataTransfer.getData('application/x-session-clip')
    if (clipData) { onDrop(e, track.id, sceneIndex); return }
    await handleFileDrop(e)
  }

  async function handleAddAudio() {
    const input = document.createElement('input')
    input.type   = 'file'
    input.accept = 'audio/*'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      const url = URL.createObjectURL(file)
      const nc  = makeAudioClip(track.id, file.name.replace(/\.[^.]+$/, ''), 0, 8, { audioUrl: url, loopEnabled: true })
      dispatch({ type: 'SET_SESSION_SLOT', trackId: track.id, sceneIndex, clip: nc })
      const ab  = await file.arrayBuffer()
      const buf = await engine.loadBufferFromArrayBuffer(nc.id, ab)
      const peaks = extractPeaks(buf)
      dispatch({ type: 'SET_SESSION_SLOT', trackId: track.id, sceneIndex, clip: { ...nc, waveformPeaks: peaks, durationBeats: engine.secondsToBeats(buf.duration) } })
    }
    input.click()
  }

  function handleEmptyClick() {
    if (trackHasPlaying) engine.stopSessionTrack(track.id)
  }

  async function handleStartRecord(bars: number) {
    setSlotRecording({ trackId: track.id, sceneIndex, bars })
    try {
      if (track.armed) {
        await engine.startMicInput(track.id, track.inputSource ?? 'mic')
      }
      await engine.startRecording()
      setMicError('')
    } catch (err) {
      const msg = err instanceof DOMException && err.name === 'NotAllowedError'
        ? 'Mic permission denied'
        : err instanceof Error ? err.message : 'Mic access failed'
      setMicError(msg)
      setTimeout(() => setMicError(''), 4000)
      setSlotRecording(null)
    }
  }

  // Don't clear slotRecording here — let the recording-complete handler do it
  // so the clip listener is still registered when the blob arrives.
  // Exception: if the engine never started (startRecording failed), clear immediately.
  function handleStopRecord() {
    if (engine.isRecording) {
      void engine.stopRecording()
    } else {
      setSlotRecording(null)
    }
  }

  // ── Derived display values ─────────────────────────────────────────────────

  const isEmpty = clip === null

  const borderColor = isRecordingHere
    ? '#ef4444'
    : displayState === 'playing'
      ? '#22c55e'
      : displayState === 'queued'
        ? (blink ? '#f97316' : 'var(--border)')
        : dragOver ? 'var(--accent)' : 'var(--border)'

  const borderWidth = (displayState === 'playing' || displayState === 'queued' || isRecordingHere || dragOver) ? '2px' : '1px'

  const triggerBg = displayState === 'playing' ? '#22c55e'
    : displayState === 'queued' ? '#f97316'
    : `${clipColor}cc`

  // ── Context menu ────────────────────────────────────────────────────────────

  function renderCtxMenu() {
    if (!ctxMenu || !clip) return null


    const quantOptions: { val: LaunchQuantization | undefined; label: string }[] = [
      { val: undefined, label: 'Use Global' },
      { val: 'none',    label: 'None (instant)' },
      { val: 'beat',    label: '1 Beat' },
      { val: 'bar',     label: '1 Bar' },
      { val: '2bar',    label: '2 Bars' },
      { val: '4bar',    label: '4 Bars' },
    ]

    const currentLQ  = clip.launchQuantization
    // The follow settings as they stand, and one way to change a piece of them
    // (lib/follow-actions.ts). The old single `followAction` is read through
    // followOf, so a project saved before this keeps its behaviour.
    const follow: FollowSettings = followOf(clip) ?? { ...DEFAULT_FOLLOW }
    const setFollow = (patch: Partial<FollowSettings>) =>
      dispatch({ type: 'SET_SESSION_SLOT', trackId: track.id, sceneIndex, clip: { ...clip, follow: { ...follow, ...patch }, followAction: undefined, followActionTime: undefined } })

    return (
      <div
        style={{ position: 'fixed', zIndex: 1000, left: ctxMenu.x, top: ctxMenu.y, background: 'var(--bg-card-hover)', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 0', minWidth: 188, boxShadow: '0 4px 20px rgba(0,0,0,0.5)', maxHeight: '82vh', overflowY: 'auto' }}
        onMouseLeave={() => setCtxMenu(null)}
      >
        <CtxItem label="Rename" onClick={() => { setRenameDraft(clip.name); setRenaming(true); setCtxMenu(null) }} />
        {audioClip && (
          <CtxItem
            label={audioClip.loopEnabled ? 'Disable Loop' : 'Enable Loop'}
            onClick={() => { dispatch({ type: 'SET_SESSION_SLOT', trackId: track.id, sceneIndex, clip: { ...audioClip, loopEnabled: !audioClip.loopEnabled } }); setCtxMenu(null) }}
          />
        )}
        <CtxItem label="Send to Arrangement" onClick={() => { dispatch({ type: 'ADD_CLIP', clip: { ...clip, startBeat: engine.currentBeat } }); setCtxMenu(null) }} />
        <CtxItem label="Delete" onClick={() => { dispatch({ type: 'SET_SESSION_SLOT', trackId: track.id, sceneIndex, clip: null }); setCtxMenu(null) }} danger />

        <CtxSep />

        {/* Clip color */}
        <div style={{ padding: '4px 12px' }}>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>Color</div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
            {CLIP_COLORS.map(color => (
              <button
                key={color}
                onClick={() => { dispatch({ type: 'SET_SESSION_SLOT', trackId: track.id, sceneIndex, clip: { ...clip, color } }); setCtxMenu(null) }}
                style={{ width: 16, height: 16, borderRadius: 2, background: color, border: clip.color === color ? '2px solid #fff' : '1px solid rgba(255,255,255,0.2)', cursor: 'pointer', padding: 0 }}
              />
            ))}
            {clip.color && (
              <button
                onClick={() => { dispatch({ type: 'SET_SESSION_SLOT', trackId: track.id, sceneIndex, clip: { ...clip, color: undefined } }); setCtxMenu(null) }}
                style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', background: 'transparent', border: '1px solid var(--border)', borderRadius: 2, cursor: 'pointer', padding: '0 3px', height: 16 }}
                title="Reset to track color"
              ><X size={9} /></button>
            )}
          </div>
        </div>

        <CtxSep />

        {/* Launch quantization */}
        <div style={{ padding: '4px 12px' }}>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>Launch Quantization</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {quantOptions.map(opt => (
              <button
                key={String(opt.val)}
                onClick={() => { dispatch({ type: 'SET_SESSION_SLOT', trackId: track.id, sceneIndex, clip: { ...clip, launchQuantization: opt.val } }); setCtxMenu(null) }}
                style={{ textAlign: 'left', padding: '3px 6px', fontSize: 10, cursor: 'pointer', background: currentLQ === opt.val ? 'rgba(255,255,255,0.1)' : 'transparent', border: 'none', color: 'var(--text-primary)', borderRadius: 2 }}
              >{opt.label}</button>
            ))}
          </div>
        </div>

        <CtxSep />

        {/* Launch mode, legato and velocity (lib/launch.ts) */}
        <div style={{ padding: '4px 12px' }} data-help-id="launch-mode">
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>Launch Mode</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {LAUNCH_MODES.map(m => (
              <button
                key={m}
                data-help-id={`launch-mode-${m}`}
                title={LAUNCH_MODE_HELP[m]}
                onClick={() => { dispatch({ type: 'SET_SESSION_SLOT', trackId: track.id, sceneIndex, clip: { ...clip, launchMode: m } }); setCtxMenu(null) }}
                style={{ textAlign: 'left', padding: '3px 6px', fontSize: 10, cursor: 'pointer', background: modeOf(clip.launchMode) === m ? 'rgba(255,255,255,0.1)' : 'transparent', border: 'none', color: 'var(--text-primary)', borderRadius: 3 }}
              >{LAUNCH_MODE_LABEL[m]}</button>
            ))}
          </div>
          <button
            data-help-id="launch-legato"
            title="Legato — a clip launched over a playing one picks up where that one had got to, instead of starting from its own beginning."
            onClick={() => { dispatch({ type: 'SET_SESSION_SLOT', trackId: track.id, sceneIndex, clip: { ...clip, legatoLaunch: !clip.legatoLaunch } }); setCtxMenu(null) }}
            style={{ textAlign: 'left', marginTop: 4, padding: '3px 6px', fontSize: 10, cursor: 'pointer', background: clip.legatoLaunch ? 'rgba(255,255,255,0.1)' : 'transparent', border: 'none', color: 'var(--text-primary)', borderRadius: 3, width: '100%' }}
          >Legato {clip.legatoLaunch ? '✓' : ''}</button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Velocity</span>
            <input
              data-help-id="launch-velocity"
              type="range" min={0} max={100} step={5} value={Math.round((clip.velocityAmount ?? 0) * 100)}
              aria-label="Velocity Amount"
              title="Velocity Amount — how much the velocity of the press reaches the clip's level. 0% ignores it, which is what a mouse click means."
              onChange={e => dispatch({ type: 'SET_SESSION_SLOT', trackId: track.id, sceneIndex, clip: { ...clip, velocityAmount: Number(e.target.value) / 100 } })}
              style={{ flex: 1, accentColor: 'var(--accent)' }}
            />
            <span style={{ fontSize: 10, color: 'var(--text-muted)', minWidth: 26, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{Math.round((clip.velocityAmount ?? 0) * 100)}%</span>
          </div>
        </div>

        <CtxSep />

        {/* Follow action */}
        {/* Follow actions (lib/follow-actions.ts): two, with a chance between them */}
        <div style={{ padding: '4px 12px' }} data-help-id="follow-actions">
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>Follow Action</div>
          {([['a', 'Then'], ['b', 'Or']] as const).map(([slot, label]) => (
            <div key={slot} style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 3 }}>
              <span style={{ fontSize: 9, color: 'var(--text-muted)', width: 22 }}>{label}</span>
              <select
                data-help-id={`follow-${slot}`}
                aria-label={`Follow action ${slot.toUpperCase()}`}
                value={(slot === 'a' ? follow.a : follow.b) ?? 'none'}
                onChange={e => setFollow({ [slot]: e.target.value as FollowAction, ...(slot === 'b' && follow.chanceB == null ? { chanceB: 1 } : {}) })}
                onClick={e => e.stopPropagation()}
                style={{ flex: 1, fontSize: 10, background: 'var(--bg-base)', border: '1px solid var(--border)', color: 'var(--text-primary)', borderRadius: 3, padding: '1px 4px' }}
              >
                {FOLLOW_ACTIONS.map(a => <option key={a} value={a}>{FOLLOW_LABEL[a]}</option>)}
              </select>
            </div>
          ))}
          {follow.b && follow.b !== 'none' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 3 }}>
              <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>Chance</span>
              <input
                data-help-id="follow-chance" type="range" min={0} max={100} step={5}
                aria-label="Chance of the first action"
                value={Math.round(((follow.chanceA ?? 1) / Math.max(1e-6, (follow.chanceA ?? 1) + (follow.chanceB ?? 1))) * 100)}
                onChange={e => { const pct = Number(e.target.value) / 100; setFollow({ chanceA: Math.round(pct * 100), chanceB: Math.round((1 - pct) * 100) }) }}
                onClick={e => e.stopPropagation()}
                style={{ flex: 1, accentColor: 'var(--accent)' }}
              />
              <span style={{ fontSize: 9, color: 'var(--text-muted)', minWidth: 26, textAlign: 'right' }}>
                {Math.round(((follow.chanceA ?? 1) / Math.max(1e-6, (follow.chanceA ?? 1) + (follow.chanceB ?? 1))) * 100)}%
              </span>
            </div>
          )}
          {follow.a === 'jump' || follow.b === 'jump' ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 3 }}>
              <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>Jump to</span>
              <select data-help-id="follow-jump" aria-label="Jump to scene" value={follow.jumpTo ?? 0}
                onChange={e => setFollow({ jumpTo: Number(e.target.value) })} onClick={e => e.stopPropagation()}
                style={{ flex: 1, fontSize: 10, background: 'var(--bg-base)', border: '1px solid var(--border)', color: 'var(--text-primary)', borderRadius: 3, padding: '1px 4px' }}>
                {(project.scenes ?? []).map((s, i) => <option key={s.id} value={i}>{s.name || `Scene ${i + 1}`}</option>)}
              </select>
            </div>
          ) : null}
          {!isIdle(follow) && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4 }}>
              <button data-help-id="follow-linked" onClick={() => setFollow({ linked: follow.linked === false })}
                style={{ fontSize: 9, padding: '2px 5px', borderRadius: 3, cursor: 'pointer', border: '1px solid var(--border)', color: 'var(--text-primary)',
                  background: follow.linked !== false ? 'rgba(255,255,255,0.1)' : 'transparent' }}
                title="Linked — it fires after the clip's own length. Unlink to set your own.">
                {follow.linked !== false ? 'Linked' : 'After'}
              </button>
              {follow.linked === false && (
                <input data-help-id="follow-time" type="number" min={0.25} max={256} step={0.25}
                  aria-label="Follow action time in beats"
                  value={follow.time ?? clip.durationBeats}
                  onChange={e => setFollow({ time: Number(e.target.value) || clip.durationBeats })}
                  onClick={e => e.stopPropagation()}
                  style={{ width: 52, fontSize: 10, background: 'var(--bg-base)', border: '1px solid var(--border)', color: 'var(--text-primary)', borderRadius: 3, padding: '1px 4px' }} />
              )}
              <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>{follow.linked === false ? 'beats' : `${+clip.durationBeats.toFixed(2)} beats`}</span>
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <>
      <div
        style={{
          width: SLOT_W, height: SLOT_H, flexShrink: 0,
          background: isRecordingHere ? 'rgba(239,68,68,0.08)' : isEmpty ? 'var(--bg-surface)' : `${clipColor}28`,
          border: `${borderWidth} solid ${borderColor}`,
          // The keyboard highlight (lib/session-keys.ts): where Enter would fire.
          boxShadow: highlighted ? 'inset 0 0 0 2px var(--accent)' : undefined,
          borderRadius: 3, position: 'relative', overflow: 'hidden',
          cursor: 'default', boxSizing: 'border-box',
          // A deactivated clip (Live's Clip Activator) is parked: dimmed, and
          // the engine refuses to launch it.
          opacity: clip?.active === false ? 0.35 : undefined,
          filter: clip?.active === false ? 'grayscale(1)' : undefined,
        }}
        data-clip-inactive={clip?.active === false || undefined}
        data-highlighted={highlighted || undefined}
        onClick={isEmpty ? handleEmptyClick : undefined}
        onContextMenu={clip ? e => { e.preventDefault(); onTouch(track.id, sceneIndex); setCtxMenu({ x: e.clientX, y: e.clientY }) } : undefined}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        draggable={!isEmpty}
        onDragStart={!isEmpty ? e => onDragStart(e, track.id, sceneIndex) : undefined}
      >
        {/* Progress fill */}
        {displayState === 'playing' && (
          <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', background: `linear-gradient(to right, rgba(34,197,94,0.15) ${progress * 100}%, transparent ${progress * 100}%)` }} />
        )}

        {isEmpty ? (
          <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 3 }}>
            {isRecordingHere ? (
              <button
                onClick={e => { e.stopPropagation(); handleStopRecord() }}
                style={{ display: 'flex', alignItems: 'center', gap: 3, padding: '3px 8px', fontSize: 9, background: '#ef4444', color: '#fff', border: 'none', borderRadius: 3, cursor: 'pointer' }}
              >
                <Square size={8} fill="currentColor" /> Stop Rec
              </button>
            ) : track.armed ? (
              /* Armed track: show bar-count record buttons */
              <div onClick={e => e.stopPropagation()} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                <div style={{ display: 'flex', gap: 2 }}>
                  {[1, 2, 4, 8].map(bars => (
                    <button
                      key={bars}
                      onClick={e => { e.stopPropagation(); handleStartRecord(bars) }}
                      title={`Record ${bars} bar${bars > 1 ? 's' : ''}`}
                      style={{ fontSize: 8, padding: '2px 5px', borderRadius: 2, border: '1px solid rgba(239,68,68,0.4)', background: 'rgba(239,68,68,0.1)', color: '#ef4444', cursor: 'pointer' }}
                    >{bars}</button>
                  ))}
                </div>
                {micError
                  ? <span style={{ fontSize: 8, color: '#ef4444', textAlign: 'center', maxWidth: 140 }}>{micError}</span>
                  : micPerm === 'denied'
                    ? <span style={{ fontSize: 8, color: '#f97316', textAlign: 'center', maxWidth: 140 }}>Mic blocked — check browser settings</span>
                    : <span style={{ fontSize: 8, color: 'rgba(239,68,68,0.6)' }}>bars</span>
                }
              </div>
            ) : hovered && trackHasPlaying ? (
              /* Track has a playing clip — clicking will stop it */
              <div style={{ color: '#f97316', display: 'flex', alignItems: 'center', gap: 3, pointerEvents: 'none' }}>
                <Square size={10} fill="currentColor" />
                <span style={{ fontSize: 9 }}>Stop</span>
              </div>
            ) : hovered ? (
              /* Hover empty slot — show + Add button */
              <button
                onClick={e => { e.stopPropagation(); handleAddAudio() }}
                style={{ display: 'flex', alignItems: 'center', gap: 3, padding: '3px 7px', fontSize: 10, background: 'var(--bg-card)', color: 'var(--text-muted)', border: '1px solid var(--border)', borderRadius: 3, cursor: 'pointer' }}
              >
                <Plus size={10} /> Add
              </button>
            ) : (
              <div style={{ color: 'var(--text-muted)', opacity: 0.3 }}>
                <Plus size={14} />
              </div>
            )}
          </div>
        ) : (
          <>
            {/* Waveform background */}
            {audioClip?.waveformPeaks && audioClip.waveformPeaks.length > 0 && (
              <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', opacity: 0.6 }}>
                <Waveform peaks={audioClip.waveformPeaks} color={clipColor} width={SLOT_W} height={SLOT_H} />
              </div>
            )}

            {/* Clip name / rename input */}
            {renaming ? (
              <input
                autoFocus value={renameDraft}
                onChange={e => setRenameDraft(e.target.value)}
                onBlur={() => { dispatch({ type: 'SET_SESSION_SLOT', trackId: track.id, sceneIndex, clip: { ...clip, name: renameDraft } }); setRenaming(false) }}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === 'Escape') { dispatch({ type: 'SET_SESSION_SLOT', trackId: track.id, sceneIndex, clip: { ...clip, name: renameDraft } }); setRenaming(false) }
                  e.stopPropagation()
                }}
                onClick={e => e.stopPropagation()}
                style={{ position: 'absolute', top: 4, left: 28, right: 4, fontSize: 10, background: 'var(--bg-base)', border: '1px solid var(--accent)', color: 'var(--text-primary)', borderRadius: 3, padding: '1px 4px', outline: 'none', zIndex: 2 }}
              />
            ) : (
              <div style={{ position: 'absolute', top: 4, left: 28, right: clip.launchQuantization ? 40 : 4, fontSize: 10, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', userSelect: 'none', zIndex: 1 }}>
                {clip.name}
              </div>
            )}

            {/* Per-clip quantization badge */}
            {clip.launchQuantization && (
              <div style={{ position: 'absolute', top: 3, right: 4, fontSize: 7, color: 'var(--text-muted)', background: 'rgba(0,0,0,0.55)', borderRadius: 2, padding: '1px 3px', zIndex: 2 }}>
                {clip.launchQuantization}
              </div>
            )}

            {/* Follow action badge */}
            {clip.followAction && clip.followAction !== 'none' && (
              <div style={{ position: 'absolute', bottom: 3, left: 28, fontSize: 8, color: clipColor, opacity: 0.85, background: 'rgba(0,0,0,0.4)', borderRadius: 2, padding: '0 3px' }}>
                {clip.followAction.substring(0, 2).toUpperCase()}
                {clip.followActionTime && clip.followActionTime !== 1 ? `:${clip.followActionTime}` : ''}
              </div>
            )}

            {/* Loop indicator */}
            {audioClip?.loopEnabled && (
              <div style={{ position: 'absolute', bottom: 3, right: 4, fontSize: 8, color: clipColor, opacity: 0.8 }}>⟳</div>
            )}

            {/* Trigger/launch button */}
            {audioClip && (
              <button
                data-help-id="session-launch"
                data-launch-mode={modeOf(audioClip.launchMode)}
                onPointerDown={e => { e.stopPropagation(); handleTrigger() }}
                onPointerUp={e => { e.stopPropagation(); handleRelease() }}
                onPointerLeave={handleRelease}
                style={{
                  position: 'absolute', left: 4, top: '50%', transform: 'translateY(-50%)',
                  width: 20, height: 20, borderRadius: 3, border: 'none',
                  background: triggerBg, color: '#fff', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2,
                }}
                title={`${LAUNCH_MODE_LABEL[modeOf(audioClip.launchMode)]} — ${LAUNCH_MODE_HELP[modeOf(audioClip.launchMode)]}`}
              >
                {displayState === 'playing'
                  ? <Square size={8} fill="currentColor" />
                  : <svg width={9} height={9} viewBox="0 0 9 9"><polygon points="0,0 9,4.5 0,9" fill="currentColor" /></svg>
                }
              </button>
            )}
          </>
        )}
      </div>
      {renderCtxMenu()}
    </>
  )
}

// ── Scene launch button ───────────────────────────────────────────────────────

function SceneLaunchButton({ scene, sceneIndex, onLaunch }: { scene: Scene; sceneIndex: number; onLaunch: () => void }) {
  const { dispatch, project } = useDaw()
  const [ctxMenu, setCtxMenu]           = useState<{ x: number; y: number } | null>(null)
  const [editingTempo, setEditingTempo] = useState(false)
  const [tempoDraft, setTempoDraft]     = useState('')

  function commitTempo() {
    const t = parseFloat(tempoDraft)
    if (!isNaN(t) && t >= 40 && t <= 300) {
      dispatch({ type: 'UPDATE_SCENE', sceneIndex, patch: { tempo: t } })
    }
    setEditingTempo(false)
  }

  return (
    <>
      <div style={{ width: SCENE_W, height: SLOT_H, flexShrink: 0, position: 'relative' }}>
        <button
          onClick={onLaunch}
          onContextMenu={e => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY }) }}
          style={{
            width: '100%', height: '100%',
            background: scene.color ? `${scene.color}22` : 'var(--bg-card)',
            border: 'none', borderLeft: `3px solid ${scene.color ?? 'var(--border)'}`,
            borderBottom: '1px solid var(--border)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            gap: 2, color: 'var(--text-muted)', cursor: 'pointer', padding: '4px 6px',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = scene.color ? `${scene.color}33` : 'rgba(255,255,255,0.04)' }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = scene.color ? `${scene.color}22` : 'var(--bg-card)' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <ChevronRight size={12} />
            <span style={{ fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 68 }}>{scene.name}</span>
          </div>
          {editingTempo ? (
            <input
              autoFocus value={tempoDraft}
              onChange={e => setTempoDraft(e.target.value)}
              onBlur={commitTempo}
              onKeyDown={e => { if (e.key === 'Enter') commitTempo(); if (e.key === 'Escape') setEditingTempo(false); e.stopPropagation() }}
              onClick={e => e.stopPropagation()}
              style={{ width: 52, fontSize: 10, background: 'var(--bg-base)', border: '1px solid var(--accent)', color: 'var(--text-primary)', borderRadius: 3, padding: '1px 4px', outline: 'none', textAlign: 'center' }}
            />
          ) : scene.tempo ? (
            <span style={{ fontSize: 9, color: '#eab308', fontFamily: 'monospace' }}>{scene.tempo} BPM</span>
          ) : null}
          {scene.timeSignatureNum && scene.timeSignatureDen ? (
            <span style={{ fontSize: 8, color: 'var(--text-muted)', opacity: 0.7 }}>{scene.timeSignatureNum}/{scene.timeSignatureDen}</span>
          ) : null}
        </button>
      </div>

      {ctxMenu && (
        <div
          style={{ position: 'fixed', zIndex: 1000, left: ctxMenu.x, top: ctxMenu.y, background: 'var(--bg-card-hover)', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 0', minWidth: 172, boxShadow: '0 4px 20px rgba(0,0,0,0.5)' }}
          onMouseLeave={() => setCtxMenu(null)}
        >
          <CtxItem label="Set Scene Tempo" onClick={() => { setTempoDraft(scene.tempo?.toString() ?? project.tempo.toString()); setEditingTempo(true); setCtxMenu(null) }} />
          {scene.tempo && <CtxItem label="Clear Tempo" onClick={() => { dispatch({ type: 'UPDATE_SCENE', sceneIndex, patch: { tempo: undefined } }); setCtxMenu(null) }} />}

          <CtxSep />

          <div style={{ padding: '4px 12px' }}>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>Time Signature</div>
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <select
                value={scene.timeSignatureNum ?? 4}
                onChange={e => { dispatch({ type: 'UPDATE_SCENE', sceneIndex, patch: { timeSignatureNum: parseInt(e.target.value) } }); setCtxMenu(null) }}
                style={{ fontSize: 10, background: 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 3, padding: '1px 2px', outline: 'none' }}
              >
                {[2, 3, 4, 5, 6, 7, 8, 12].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>/</span>
              <select
                value={scene.timeSignatureDen ?? 4}
                onChange={e => { dispatch({ type: 'UPDATE_SCENE', sceneIndex, patch: { timeSignatureDen: parseInt(e.target.value) } }); setCtxMenu(null) }}
                style={{ fontSize: 10, background: 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 3, padding: '1px 2px', outline: 'none' }}
              >
                {[2, 4, 8, 16].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
          </div>

          <CtxSep />

          <div style={{ padding: '4px 12px' }}>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>Scene Color</div>
            <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', alignItems: 'center' }}>
              {CLIP_COLORS.map(color => (
                <button
                  key={color}
                  onClick={() => { dispatch({ type: 'UPDATE_SCENE', sceneIndex, patch: { color } }); setCtxMenu(null) }}
                  style={{ width: 14, height: 14, borderRadius: 2, background: color, border: scene.color === color ? '2px solid #fff' : '1px solid rgba(255,255,255,0.2)', cursor: 'pointer', padding: 0 }}
                />
              ))}
              {scene.color && (
                <button
                  onClick={() => { dispatch({ type: 'UPDATE_SCENE', sceneIndex, patch: { color: undefined } }); setCtxMenu(null) }}
                  style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', background: 'transparent', border: '1px solid var(--border)', borderRadius: 2, cursor: 'pointer', padding: '0 3px', height: 14 }}
                ><X size={9} /></button>
              )}
            </div>
          </div>

          <CtxSep />
          <CtxItem label="Remove Scene" onClick={() => { dispatch({ type: 'REMOVE_SCENE', sceneIndex }); setCtxMenu(null) }} danger />
        </div>
      )}
    </>
  )
}

// ── Session View ──────────────────────────────────────────────────────────────

export default function SessionView() {
  const { project, dispatch, engine } = useDaw()
  const [quantize, setQuantize]                 = useState<LaunchQuantization>('bar')
  const [overdub, setOverdub]                   = useState(false)
  const [sessionRecording, setSessionRecording] = useState(false)
  const [anyPlaying, setAnyPlaying]             = useState(false)
  const [slotRecording, setSlotRecording]       = useState<SlotRecording>(null)
  const [capturing, setCapturing]               = useState(false)
  const projectRef = useRef(project)
  projectRef.current = project

  useEffect(() => { engine.launchQuantization = quantize }, [quantize, engine])

  // Auto-reset slotRecording when engine fires recording-complete
  useEffect(() => {
    function onDone() { setSlotRecording(null) }
    engine.addEventListener('recording-complete', onDone)
    return () => engine.removeEventListener('recording-complete', onDone)
  }, [engine])

  // Session -> Arrangement capture. The engine logs each launched span against
  // the transport's own beat grid (exact quantized launch beats, MIDI as well
  // as audio, loop-aware), so toggling this just arms/disarms that log and
  // materializes it. The previous hand-rolled version stamped clips at
  // event-dispatch time and silently dropped every MIDI jam.
  const toggleCapture = useCallback(() => {
    if (!capturing) {
      if (!engine.isPlaying) void engine.play()
      engine.startSessionCapture()
      setCapturing(true)
      return
    }
    const log = engine.stopSessionCapture()
    setCapturing(false)
    for (const clip of sessionCaptureToClips(log)) dispatch({ type: 'ADD_CLIP', clip })
  }, [capturing, engine, dispatch])

  // Launch countdown — how many beats until the queued clips fire. Live
  // performers count this out loud ("one two three four"), so it needs to be
  // on screen, not implied by a blinking slot.
  const [countdown, setCountdown] = useState<number | null>(null)
  useEffect(() => {
    const iv = setInterval(() => {
      const info = engine.getSessionLaunchInfo()
      setCountdown(info.beatsRemaining === null ? null : Math.max(0, Math.ceil(info.beatsRemaining)))
    }, 80)
    return () => clearInterval(iv)
  }, [engine])

  // Poll for any playing/queued session clips — drives "Back to Arr" button
  useEffect(() => {
    function check() {
      const proj = projectRef.current
      let found = false
      outer: for (const track of proj.tracks) {
        for (const clip of proj.sessionGrid[track.id] ?? []) {
          if (clip) {
            const s = engine.getSessionState(track.id, clip.id)
            if (s === 'playing' || s === 'queued') { found = true; break outer }
          }
        }
      }
      setAnyPlaying(found)
    }
    const iv = setInterval(check, 400)
    return () => clearInterval(iv)
  }, [engine])

  // ── Playing the grid from the keyboard (lib/session-keys.ts) ─────────────
  //
  // The one input a performance does not have a spare hand for is a mouse.
  // The highlight is a cell; arrows move it, Enter fires it, ⇧↵ fires the whole
  // scene, ⌃↵ stops the track.
  const [spot, setSpot] = useState<Spot>({ track: 0, scene: 0 })
  const gridTracks = project.tracks.filter(t => t.kind !== 'group')
  const onGridKey = (e: React.KeyboardEvent) => {
    const id = resolveKey(e, ['session'])?.id
    if (!id) return
    // ⚠️ Not while somebody is typing a scene name or a tempo into the grid.
    const el = e.target as HTMLElement | null
    if (el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA')) return
    e.preventDefault(); e.stopPropagation()
    const trackIds = gridTracks.map(t => t.id)
    const move = ({ 'session.up': 'up', 'session.down': 'down', 'session.left': 'left', 'session.right': 'right',
      'session.pageUp': 'pageUp', 'session.pageDown': 'pageDown' } as Record<string, GridMove>)[id]
    if (move) { setSpot(s => moveSpot(s, move, trackIds.length, project.scenes.length)); return }
    if (id === 'session.home' || id === 'session.end') { setSpot(s => moveSpot(s, id === 'session.home' ? 'home' : 'end', trackIds.length, project.scenes.length)); return }
    if (id === 'session.launch') {
      const clip = clipAt(project.sessionGrid, trackIds, spot)
      const trackId = trackIds[spot.track]
      if (clip && trackId) void (isAudioClip(clip) ? engine.queueSession(trackId, clip, clip.launchQuantization) : engine.queueSessionMidi(trackId, clip as MidiClip, clip.launchQuantization))
      return
    }
    if (id === 'session.launchScene') { void launchScene(spot.scene); return }
    // Immediate, like Stop All beside it: a key pressed during a performance
    // means now, and a quantized stop reads as nothing having happened.
    if (id === 'session.stopTrack') { const t = trackIds[spot.track]; if (t) { engine.stopSessionTrack(t); engine.stopSessionMidiTrack?.(t) } return }
    if (id === 'session.stopAll') { stopAll(); return }
    if (id === 'session.insertScene') { dispatch({ type: 'INSERT_SCENE', sceneIndex: spot.scene }); return }
    if (id === 'session.captureScene') { captureIntoScene(); return }
  }

  /**
   * Live's Capture and Insert Scene: what is playing right now becomes a new
   * scene below the highlight, so a set found by hand can be kept.
   */
  function captureIntoScene() {
    const playing: Record<string, string | null> = {}
    for (const t of gridTracks) {
      const row = project.sessionGrid[t.id] ?? []
      const found = row.find(c => c && engine.getSessionState(t.id, c.id) === 'playing')
      playing[t.id] = found?.id ?? null
    }
    const clips = captureScene(project.sessionGrid, playing, () => crypto.randomUUID())
    dispatch({ type: 'INSERT_SCENE', sceneIndex: spot.scene + 1, clips })
  }

  async function launchScene(sceneIndex: number) {
    const scene = project.scenes[sceneIndex]
    if (scene.tempo) {
      dispatch({ type: 'SET_TEMPO', tempo: scene.tempo })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(engine as any).setTempo?.(scene.tempo)
    }
    if (scene.timeSignatureNum && scene.timeSignatureDen) {
      dispatch({ type: 'SET_TIME_SIG', num: scene.timeSignatureNum, den: scene.timeSignatureDen })
    }
    // Atomic row launch: every clip in the scene (MIDI included) fires at ONE
    // shared quantize boundary; tracks with an empty slot get a quantized stop.
    await engine.launchScene(project.tracks.map(track => ({
      trackId: track.id,
      clip: project.sessionGrid[track.id]?.[sceneIndex] ?? null,
    })))
  }

  function stopAll() {
    engine.stopAllSessionTracks({ quantized: true })
    setAnyPlaying(false)
    setSessionRecording(false)
  }

  // Session commands are registered here because stopping has to settle local
  // playing/recording state as well as tell the engine — dispatching from a
  // central list would stop the sound and leave the buttons lit.
  // The slot the ⌘K launch commands act on: the one last pressed or
  // right-clicked, since a session slot is not part of the clip selection.
  const [lastSlot, setLastSlot] = useState<{ trackId: string; sceneIndex: number } | null>(null)
  const touchSlot = useCallback((trackId: string, sceneIndex: number) => setLastSlot({ trackId, sceneIndex }), [])
  const touched = lastSlot ? project.sessionGrid[lastSlot.trackId]?.[lastSlot.sceneIndex] ?? null : null
  const patchTouched = (patch: Partial<DawClip>) => {
    if (!lastSlot || !touched) return
    dispatch({ type: 'SET_SESSION_SLOT', trackId: lastSlot.trackId, sceneIndex: lastSlot.sceneIndex, clip: { ...touched, ...patch } as DawClip })
  }

  useRegisterCommands([
    { id: 'session.stopAll', group: 'Session', label: 'Stop all clips',
      keywords: 'stop all clips silence panic halt everything session',
      run: stopAll },
    { id: 'session.addScene', group: 'Session', label: 'Add a scene',
      keywords: 'scene row new add launch section',
      run: () => dispatch({ type: 'ADD_SCENE' }) },
    // Launch settings for the slot last touched (lib/launch.ts). Spelled out
    // rather than mapped: the discoverability check reads these literally.
    { id: 'session.launch.trigger', group: 'Session', label: `Launch mode: Trigger — press starts it from the top${touched ? ` (${touched.name})` : ''}`,
      keywords: 'launch mode trigger press start over session slot clip fire', when: () => !!touched, run: () => patchTouched({ launchMode: 'trigger' }) },
    { id: 'session.launch.gate', group: 'Session', label: `Launch mode: Gate — it plays while you hold${touched ? ` (${touched.name})` : ''}`,
      keywords: 'launch mode gate hold while pressed release stops session slot clip', when: () => !!touched, run: () => patchTouched({ launchMode: 'gate' }) },
    { id: 'session.launch.toggle', group: 'Session', label: `Launch mode: Toggle — press to start, press again to stop${touched ? ` (${touched.name})` : ''}`,
      keywords: 'launch mode toggle press again stop session slot clip', when: () => !!touched, run: () => patchTouched({ launchMode: 'toggle' }) },
    { id: 'session.launch.repeat', group: 'Session', label: `Launch mode: Repeat — it starts again every step while held${touched ? ` (${touched.name})` : ''}`,
      keywords: 'launch mode repeat stutter retrigger held roll session slot clip', when: () => !!touched, run: () => patchTouched({ launchMode: 'repeat' }) },
    // Follow actions for the slot last touched (lib/follow-actions.ts).
    { id: 'session.follow.next', group: 'Session', label: `Follow action: play the next clip when it ends${touched ? ` (${touched.name})` : ''}`,
      keywords: 'follow action next clip when it ends chain session slot', when: () => !!touched, run: () => patchTouched({ follow: { a: 'next', chanceA: 1, chanceB: 0, linked: true }, followAction: undefined }) },
    { id: 'session.follow.other', group: 'Session', label: `Follow action: play any other clip when it ends${touched ? ` (${touched.name})` : ''}`,
      keywords: 'follow action any other clip shuffle random when it ends session slot', when: () => !!touched, run: () => patchTouched({ follow: { a: 'other', chanceA: 1, chanceB: 0, linked: true }, followAction: undefined }) },
    { id: 'session.follow.stop', group: 'Session', label: `Follow action: stop when it ends${touched ? ` (${touched.name})` : ''}`,
      keywords: 'follow action stop when it ends once one shot session slot', when: () => !!touched, run: () => patchTouched({ follow: { a: 'stop', chanceA: 1, chanceB: 0, linked: true }, followAction: undefined }) },
    { id: 'session.follow.off', group: 'Session', label: `Follow action: none — leave it playing${touched ? ` (${touched.name})` : ''}`,
      keywords: 'follow action none off leave playing session slot', when: () => !!touched, run: () => patchTouched({ follow: undefined, followAction: undefined }) },
    { id: 'session.launch.legato', group: 'Session', label: touched?.legatoLaunch ? 'Legato launch off — the next clip starts from its own beginning' : 'Legato launch — a clip picks up where the playing one had got to',
      keywords: 'legato launch position inherit continue swap fill session slot clip', when: () => !!touched, run: () => patchTouched({ legatoLaunch: !touched?.legatoLaunch }) },
  ], [dispatch, stopAll, touched, lastSlot])

  async function handleSessionRecord() {
    if (!project.tracks.some(t => t.armed)) return
    if (sessionRecording) {
      void engine.stopRecording()
      setSessionRecording(false)
    } else {
      try {
        const armedTracks = project.tracks.filter(t => t.armed)
        if (armedTracks.length > 0) {
          await Promise.all(armedTracks.map(t => engine.startMicInput(t.id, t.inputSource ?? 'mic')))
        }
        await engine.startRecording()
        setSessionRecording(true)
      } catch (err) {
        console.error('Session record failed:', err)
      }
    }
  }

  // Clip drag between slots
  function handleClipDragStart(e: React.DragEvent, trackId: string, sceneIndex: number) {
    e.dataTransfer.setData('application/x-session-clip', JSON.stringify({ trackId, sceneIndex }))
    e.dataTransfer.effectAllowed = 'copyMove'
  }

  function handleClipDrop(e: React.DragEvent, destTrackId: string, destSceneIndex: number) {
    const raw = e.dataTransfer.getData('application/x-session-clip')
    if (!raw) return
    const { trackId: srcTrackId, sceneIndex: srcSceneIndex } = JSON.parse(raw) as { trackId: string; sceneIndex: number }
    if (srcTrackId === destTrackId && srcSceneIndex === destSceneIndex) return
    const srcClip = project.sessionGrid[srcTrackId]?.[srcSceneIndex] ?? null
    if (!srcClip) return
    dispatch({ type: 'SET_SESSION_SLOT', trackId: destTrackId, sceneIndex: destSceneIndex, clip: { ...srcClip, trackId: destTrackId } })
    if (!e.altKey) {
      dispatch({ type: 'SET_SESSION_SLOT', trackId: srcTrackId, sceneIndex: srcSceneIndex, clip: null })
    }
  }

  // Follow action executor — needs full project context via ref
  // Follow actions live in the engine now (lib/follow-actions.ts): they have
  // to keep working when nobody is looking at the session view.

  const quantOptions: { val: LaunchQuantization; label: string }[] = [
    { val: 'none',  label: 'None' },
    { val: 'beat',  label: '1 Beat' },
    { val: 'bar',   label: '1 Bar' },
    { val: '2bar',  label: '2 Bars' },
    { val: '4bar',  label: '4 Bars' },
  ]

  const crossfaderValue = project.crossfaderValue ?? 0.5

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', backgroundColor: 'var(--bg-base)', backgroundImage: 'var(--workshop-pattern, none)', backgroundSize: 'var(--workshop-pattern-size, auto)', userSelect: 'none' }}>

      {/* ── Toolbar ─────────────────────────────────────────────────────────── */}
      <div style={{ ...apHeader, justifyContent: 'flex-start', gap: 6, flexShrink: 0 }}>
        <span style={{ ...apTitle, color: 'var(--text-muted)' }}>Quantize</span>
        <select
          value={quantize}
          onChange={e => setQuantize(e.target.value as LaunchQuantization)}
          onClick={e => e.stopPropagation()}
          style={{ ...apSelect, width: 76 }}
        >
          {quantOptions.map(o => <option key={o.val} value={o.val}>{o.label}</option>)}
        </select>

        <div style={apDivider} />

        {/* Session record */}
        <button
          onClick={handleSessionRecord}
          title={project.tracks.some(t => t.armed) ? 'Session Record (all armed tracks)' : 'Arm a track first'}
          style={sessionRecording
            ? { ...apControl, background: 'rgba(239,68,68,0.18)', border: '1px solid #ef4444', color: '#ef4444' }
            : apControl}
        >
          <Circle size={9} fill={sessionRecording ? '#ef4444' : 'transparent'} />
          REC
        </button>

        {/* Capture to Arrangement */}
        <button
          onClick={toggleCapture}
          title="Capture to Arrangement — records what you launch onto the arrangement timeline; click again to stamp it in"
          data-help-id="capture-arrangement"
          style={capturing
            ? { ...apControl, background: 'rgba(34,197,94,0.18)', border: '1px solid #22c55e', color: '#22c55e' }
            : apControl}
        >
          <Circle size={9} fill={capturing ? '#22c55e' : 'transparent'} color={capturing ? '#22c55e' : 'currentColor'} />
          CAPTURE
        </button>

        {/* MIDI overdub */}
        <button
          onClick={() => setOverdub(v => !v)}
          title="MIDI Overdub — layer MIDI input onto playing clips"
          data-help-id="midi-overdub"
          style={overdub
            ? { ...apControl, background: 'rgba(168,85,247,0.18)', border: '1px solid #a855f7', color: '#a855f7' }
            : apControl}
        >OVERDUB</button>

        {/* Launch countdown — beats until the queued clips fire */}
        {countdown !== null && (
          <div
            data-session-countdown={countdown}
            title="Beats until the queued clips launch"
            style={{ ...apReadout, justifyContent: 'center', minWidth: 26, background: 'var(--accent)', border: '1px solid var(--accent)', color: 'var(--accent-contrast)', fontWeight: 800 }}
          >{countdown}</div>
        )}

        {/* Back to arrangement — hands the taken-over tracks back to their
            arrangement clips (Ableton semantics), instead of stopping the
            transport. Stop All remains for silencing the session. */}
        {anyPlaying && (
          <>
            <button
              onClick={() => { engine.stopAllSessionTracks({ quantized: true }); engine.backToArrangement(); setAnyPlaying(false) }}
              title="Back to Arrangement — release the tracks the session took over"
              data-help-id="back-to-arrangement"
              style={{ ...apControl, background: 'rgba(34,197,94,0.14)', border: '1px solid #22c55e', color: '#22c55e' }}
            >
              <ChevronRight size={10} /> Back to Arr
            </button>
            <button
              onClick={stopAll}
              title="Stop all session clips"
              data-help-id="stop-all"
              style={apControl}
            >Stop All</button>
          </>
        )}
      </div>

      {/* ── Scrollable body ─────────────────────────────────────────────────── */}
      <div
        data-help-id="session-grid"
        tabIndex={0}
        onKeyDown={onGridKey}
        style={{ display: 'flex', flex: 1, overflowY: 'auto', overflowX: 'hidden', outline: 'none' }}
      >

        {/* Track headers column */}
        <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
          {/* Spacer — aligned with scene-name header row */}
          <div style={{ width: HDR_W, height: 28, background: 'var(--bg-surface)', borderRight: '1px solid var(--border)', borderBottom: '1px solid var(--border)', flexShrink: 0 }} />

          {/* Groups are buses — no session clips, so they're not columns here */}
          {project.tracks.filter(t => t.kind !== 'group').map(t => <TrackHeader key={t.id} track={t} />)}

          {/* Stop clips label row */}
          <div style={{ width: HDR_W, height: 32, flexShrink: 0, display: 'flex', alignItems: 'center', padding: '0 10px', gap: 5, background: 'var(--bg-surface)', borderRight: '1px solid var(--border)', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)', fontSize: 9, color: 'var(--text-muted)' }}>
            <Square size={9} color="#f97316" />
            Stop clips
          </div>

          {/* Add track buttons */}
          <div style={{ display: 'flex', gap: 4, padding: '8px', width: HDR_W, borderRight: '1px solid var(--border)' }}>
            <button
              onClick={() => dispatch({ type: 'ADD_TRACK' })}
              style={{ flex: 1, padding: '4px 0', fontSize: 9, borderRadius: 3, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-muted)', cursor: 'pointer', letterSpacing: '0.04em' }}
              title="Add track"
            >+Track</button>
          </div>
        </div>

        {/* Clip grid */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflowX: 'auto' }}>
          {/* Scene name header row */}
          <div style={{ display: 'flex', height: 28, background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
            {project.scenes.map(scene => (
              <div
                key={scene.id}
                style={{ width: SLOT_W, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRight: '1px solid var(--border)', fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.06em', userSelect: 'none' }}
              >{scene.name}</div>
            ))}
            <button
              onClick={() => dispatch({ type: 'ADD_SCENE' })}
              style={{ flexShrink: 0, width: 28, background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 16 }}
              title="Add scene"
              data-help-id="add-scene"
            >+</button>
          </div>

          {/* Track rows */}
          {project.tracks.filter(t => t.kind !== 'group').map(track => (
            <div key={track.id} style={{ display: 'flex', height: SLOT_H, flexShrink: 0 }}>
              {project.scenes.map((_scene, si) => (
                <ClipSlot
                  key={`${track.id}-${si}`}
                  track={track}
                  sceneIndex={si}
                  clip={project.sessionGrid[track.id]?.[si] ?? null}
                  slotRecording={slotRecording}
                  setSlotRecording={setSlotRecording}
                  onDragStart={handleClipDragStart}
                  onDrop={handleClipDrop}
                  onTouch={touchSlot}
                  highlighted={gridTracks[spot.track]?.id === track.id && spot.scene === si}
                />
              ))}
            </div>
          ))}

          {/* Stop clips per-track row */}
          <div style={{ display: 'flex', height: 32, flexShrink: 0, borderTop: '1px solid var(--border)' }}>
            {project.tracks.filter(t => t.kind !== 'group').map(track => (
              <button
                key={track.id}
                onClick={() => engine.stopSessionTrack(track.id)}
                title={`Stop ${track.name}`}
                style={{
                  width: SLOT_W, height: 32, flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: 'var(--bg-surface)', border: 'none',
                  borderRight: '1px solid var(--border)', borderBottom: '1px solid var(--border)',
                  color: '#f97316', cursor: 'pointer',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(249,115,22,0.1)' }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-surface)' }}
              >
                <Square size={11} fill="currentColor" />
              </button>
            ))}
          </div>
        </div>

        {/* Scene launch column */}
        <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
          {/* Spacer */}
          <div style={{ height: 28, background: 'var(--bg-surface)', borderLeft: '1px solid var(--border)', borderBottom: '1px solid var(--border)', width: SCENE_W }} />

          {project.scenes.map((scene, i) => (
            <SceneLaunchButton
              key={scene.id}
              scene={scene}
              sceneIndex={i}
              onLaunch={() => launchScene(i)}
            />
          ))}

          {/* Stop all — aligns with the per-track stop row */}
          <button
            onClick={() => { for (const t of project.tracks) engine.stopSessionTrack(t.id) }}
            title="Stop all clips"
            data-help-id="stop-all"
            style={{
              width: SCENE_W, height: 32, flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
              background: 'var(--bg-surface)', border: 'none',
              borderLeft: '1px solid var(--border)', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)',
              color: '#f97316', cursor: 'pointer', fontSize: 10,
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(249,115,22,0.1)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-surface)' }}
          >
            <Square size={11} fill="currentColor" /> All
          </button>

          {/* Add scene */}
          <button
            onClick={() => dispatch({ type: 'ADD_SCENE' })}
            style={{ width: SCENE_W, height: 36, background: 'transparent', border: 'none', borderLeft: '1px solid var(--border)', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}
          >
            <Plus size={11} /> Scene
          </button>
        </div>
      </div>

      {/* ── Crossfader ──────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 16px', borderTop: '1px solid var(--border)', background: 'var(--bg-surface)', flexShrink: 0 }}>
        <span style={{ fontSize: 11, color: '#3b82f6', fontWeight: 700, minWidth: 10 }}>A</span>
        <div style={{ flex: 1, position: 'relative', display: 'flex', alignItems: 'center' }}>
          {/* Center marker tick */}
          <div style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', width: 1, height: 8, background: 'rgba(255,255,255,0.2)', pointerEvents: 'none' }} />
          <Knob
            value={crossfaderValue} min={0} max={1} defaultValue={0.5} size={24} bipolar
            color="var(--text-muted)"
            onChange={v => dispatch({ type: 'SET_CROSSFADER', value: v })}
            format={v => (Math.abs(v - 0.5) < 0.01 ? 'Center' : v < 0.5 ? `A${Math.round((0.5 - v) * 200)}` : `B${Math.round((v - 0.5) * 200)}`)}
            title={
              Math.abs(crossfaderValue - 0.5) < 0.01
                ? 'Center'
                : crossfaderValue < 0.5
                  ? `A +${Math.round((0.5 - crossfaderValue) * 200)}%`
                  : `B +${Math.round((crossfaderValue - 0.5) * 200)}%`
            }
          />
        </div>
        <span style={{ fontSize: 11, color: '#f97316', fontWeight: 700, minWidth: 10 }}>B</span>
        <button
          onClick={() => dispatch({ type: 'SET_CROSSFADER', value: 0.5 })}
          title="Center crossfader"
          style={{ fontSize: 9, padding: '2px 6px', borderRadius: 3, border: '1px solid var(--border)', background: Math.abs(crossfaderValue - 0.5) < 0.01 ? 'rgba(255,255,255,0.08)' : 'var(--bg-card)', color: 'var(--text-muted)', cursor: 'pointer' }}
        >C</button>
      </div>
    </div>
  )
}
