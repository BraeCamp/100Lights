'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { Plus, Square, Circle, ChevronRight } from 'lucide-react'
import { useDaw, extractPeaks, makeAudioClip } from '@/lib/daw-state'
import type { DawTrack, DawClip, LaunchQuantization, FollowAction, CrossfaderSide, Scene } from '@/lib/daw-types'
import { isAudioClip } from '@/lib/daw-types'
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
            style={{ flex: 1, fontSize: 11, background: '#111', border: '1px solid var(--accent)', color: 'var(--text-primary)', borderRadius: 3, padding: '1px 4px', outline: 'none' }}
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
        <input
          type="range" min={0} max={1} step={0.01} value={track.volume}
          onChange={e => { const v = parseFloat(e.target.value); dispatch({ type: 'UPDATE_TRACK', trackId: track.id, patch: { volume: v } }); engine.setTrackVolume(track.id, v) }}
          className="cf-slider"
          style={{ flex: 1, accentColor: track.color, minWidth: 0 }}
          title={`Volume: ${Math.round(track.volume * 100)}%`}
        />
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
        background: active ? 'rgba(61,143,239,0.18)' : 'var(--bg-surface)',
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
  onFollowAction: (trackId: string, action: FollowAction, fromSceneIndex: number) => void
}

function ClipSlot({ track, sceneIndex, clip, slotRecording, setSlotRecording, onDragStart, onDrop, onFollowAction }: ClipSlotProps) {
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

  const audioClip = clip && isAudioClip(clip) ? clip : null
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
      // Follow action fires when clip transitions from playing → idle
      if (prev === 'playing' && d.state === 'idle') {
        const fa = clip!.followAction
        if (fa && fa !== 'none') onFollowAction(track.id, fa, sceneIndex)
      }
    }

    engine.addEventListener('session-state', onState)
    const init = engine.getSessionState(track.id, clip.id)
    setDisplayState(init)
    prevState.current = init
    return () => engine.removeEventListener('session-state', onState)
  }, [engine, track.id, clip, sceneIndex, onFollowAction])

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

  // ── Blink for queued state ──────────────────────────────────────────────────
  const [blink, setBlink] = useState(true)
  useEffect(() => {
    if (displayState !== 'queued') return
    const iv = setInterval(() => setBlink(v => !v), 500)
    return () => clearInterval(iv)
  }, [displayState])

  // ── Handlers ───────────────────────────────────────────────────────────────

  async function handleTrigger() {
    if (!audioClip) return
    await engine.queueSession(track.id, audioClip, audioClip.launchQuantization)
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

  function handleStartRecord(bars: number) {
    setSlotRecording({ trackId: track.id, sceneIndex, bars })
    void engine.startRecording()
  }

  function handleStopRecord() {
    setSlotRecording(null)
    void engine.stopRecording()
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

    const followActions: { val: FollowAction; label: string }[] = [
      { val: 'none',   label: 'None' },
      { val: 'stop',   label: 'Stop' },
      { val: 'again',  label: 'Play Again' },
      { val: 'next',   label: 'Next' },
      { val: 'prev',   label: 'Prev' },
      { val: 'first',  label: 'First' },
      { val: 'last',   label: 'Last' },
      { val: 'random', label: 'Random' },
    ]

    const quantOptions: { val: LaunchQuantization | undefined; label: string }[] = [
      { val: undefined, label: 'Use Global' },
      { val: 'none',    label: 'None (instant)' },
      { val: 'beat',    label: '1 Beat' },
      { val: 'bar',     label: '1 Bar' },
      { val: '2bar',    label: '2 Bars' },
      { val: '4bar',    label: '4 Bars' },
    ]

    const currentFA  = clip.followAction ?? 'none'
    const currentLQ  = clip.launchQuantization
    const currentFAT = clip.followActionTime ?? 1

    return (
      <div
        style={{ position: 'fixed', zIndex: 1000, left: ctxMenu.x, top: ctxMenu.y, background: '#2a2a2a', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 0', minWidth: 188, boxShadow: '0 4px 20px rgba(0,0,0,0.5)', maxHeight: '82vh', overflowY: 'auto' }}
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
                style={{ fontSize: 8, color: 'var(--text-muted)', background: 'transparent', border: '1px solid var(--border)', borderRadius: 2, cursor: 'pointer', padding: '0 3px', height: 16, lineHeight: '14px' }}
                title="Reset to track color"
              >✕</button>
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

        {/* Follow action */}
        <div style={{ padding: '4px 12px' }}>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>Follow Action</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {followActions.map(fa => (
              <button
                key={fa.val}
                onClick={() => { dispatch({ type: 'SET_SESSION_SLOT', trackId: track.id, sceneIndex, clip: { ...clip, followAction: fa.val === 'none' ? undefined : fa.val } }); setCtxMenu(null) }}
                style={{ textAlign: 'left', padding: '3px 6px', fontSize: 10, cursor: 'pointer', background: currentFA === fa.val ? 'rgba(255,255,255,0.1)' : 'transparent', border: 'none', color: 'var(--text-primary)', borderRadius: 2 }}
              >{fa.label}</button>
            ))}
          </div>
          {currentFA !== 'none' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 5 }}>
              <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>Time (bars):</span>
              <input
                type="number" min={1} max={64} step={1} value={currentFAT}
                onChange={e => dispatch({ type: 'SET_SESSION_SLOT', trackId: track.id, sceneIndex, clip: { ...clip, followActionTime: parseInt(e.target.value) || 1 } })}
                onClick={e => e.stopPropagation()}
                style={{ width: 44, fontSize: 10, background: '#111', border: '1px solid var(--border)', color: 'var(--text-primary)', borderRadius: 3, padding: '1px 4px', outline: 'none' }}
              />
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
          borderRadius: 3, position: 'relative', overflow: 'hidden',
          cursor: 'default', boxSizing: 'border-box',
        }}
        onClick={isEmpty ? handleEmptyClick : undefined}
        onContextMenu={clip ? e => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY }) } : undefined}
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
                <span style={{ fontSize: 8, color: 'rgba(239,68,68,0.6)' }}>bars</span>
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
                style={{ position: 'absolute', top: 4, left: 28, right: 4, fontSize: 10, background: '#111', border: '1px solid var(--accent)', color: 'var(--text-primary)', borderRadius: 3, padding: '1px 4px', outline: 'none', zIndex: 2 }}
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
                onClick={e => { e.stopPropagation(); handleTrigger() }}
                style={{
                  position: 'absolute', left: 4, top: '50%', transform: 'translateY(-50%)',
                  width: 20, height: 20, borderRadius: 3, border: 'none',
                  background: triggerBg, color: '#fff', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2,
                }}
                title={displayState === 'playing' ? 'Re-trigger' : displayState === 'queued' ? 'Queued…' : 'Launch'}
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
              style={{ width: 52, fontSize: 10, background: '#111', border: '1px solid var(--accent)', color: 'var(--text-primary)', borderRadius: 3, padding: '1px 4px', outline: 'none', textAlign: 'center' }}
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
          style={{ position: 'fixed', zIndex: 1000, left: ctxMenu.x, top: ctxMenu.y, background: '#2a2a2a', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 0', minWidth: 172, boxShadow: '0 4px 20px rgba(0,0,0,0.5)' }}
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
                  style={{ fontSize: 8, color: 'var(--text-muted)', background: 'transparent', border: '1px solid var(--border)', borderRadius: 2, cursor: 'pointer', padding: '0 3px', height: 14, lineHeight: '12px' }}
                >✕</button>
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
  const projectRef = useRef(project)
  projectRef.current = project

  useEffect(() => { engine.launchQuantization = quantize }, [quantize, engine])

  // Auto-reset slotRecording when engine fires recording-complete
  useEffect(() => {
    function onDone() { setSlotRecording(null) }
    engine.addEventListener('recording-complete', onDone)
    return () => engine.removeEventListener('recording-complete', onDone)
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
    await Promise.all(project.tracks.map(track => {
      const clip = project.sessionGrid[track.id]?.[sceneIndex]
      return clip && isAudioClip(clip) ? engine.queueSession(track.id, clip) : Promise.resolve()
    }))
  }

  function stopAll() {
    for (const t of project.tracks) engine.stopSessionTrack(t.id)
    setAnyPlaying(false)
    setSessionRecording(false)
  }

  function handleSessionRecord() {
    if (!project.tracks.some(t => t.armed)) return
    if (sessionRecording) {
      void engine.stopRecording()
      setSessionRecording(false)
    } else {
      void engine.startRecording()
      setSessionRecording(true)
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
  const handleFollowAction = useCallback(async (trackId: string, action: FollowAction, fromSceneIndex: number) => {
    const proj  = projectRef.current
    const grid  = proj.sessionGrid[trackId] ?? []
    const total = proj.scenes.length

    if (action === 'stop') {
      engine.stopSessionTrack(trackId)
      return
    }
    if (action === 'again') {
      const c = grid[fromSceneIndex]
      if (c && isAudioClip(c)) await engine.queueSession(trackId, c)
      return
    }

    let targetIdx = -1
    if (action === 'next')  targetIdx = fromSceneIndex + 1
    if (action === 'prev')  targetIdx = fromSceneIndex - 1
    if (action === 'first') targetIdx = 0
    if (action === 'last') {
      for (let i = grid.length - 1; i >= 0; i--) { if (grid[i]) { targetIdx = i; break } }
    }
    if (action === 'random') {
      const filled = grid.map((c, i) => (c ? i : -1)).filter(i => i >= 0)
      if (filled.length) targetIdx = filled[Math.floor(Math.random() * filled.length)]
    }

    if (targetIdx >= 0 && targetIdx < total) {
      const c = grid[targetIdx]
      if (c && isAudioClip(c)) await engine.queueSession(trackId, c)
    }
  }, [engine])

  const quantOptions: { val: LaunchQuantization; label: string }[] = [
    { val: 'none',  label: 'None' },
    { val: 'beat',  label: '1 Beat' },
    { val: 'bar',   label: '1 Bar' },
    { val: '2bar',  label: '2 Bars' },
    { val: '4bar',  label: '4 Bars' },
  ]

  const crossfaderValue = project.crossfaderValue ?? 0.5

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', background: 'var(--bg-base)', userSelect: 'none' }}>

      {/* ── Toolbar ─────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)', flexShrink: 0 }}>
        <span style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: '0.06em' }}>Q:</span>
        <select
          value={quantize}
          onChange={e => setQuantize(e.target.value as LaunchQuantization)}
          onClick={e => e.stopPropagation()}
          style={{ fontSize: 9, background: 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 3, padding: '1px 2px', outline: 'none', cursor: 'pointer' }}
        >
          {quantOptions.map(o => <option key={o.val} value={o.val}>{o.label}</option>)}
        </select>

        <div style={{ width: 1, height: 16, background: 'var(--border)' }} />

        {/* Session record */}
        <button
          onClick={handleSessionRecord}
          title={project.tracks.some(t => t.armed) ? 'Session Record (all armed tracks)' : 'Arm a track first'}
          style={{
            display: 'flex', alignItems: 'center', gap: 3, padding: '3px 8px', fontSize: 10,
            borderRadius: 3, border: '1px solid var(--border)', cursor: 'pointer',
            background: sessionRecording ? 'rgba(239,68,68,0.2)' : 'var(--bg-card)',
            color: sessionRecording ? '#ef4444' : 'var(--text-muted)',
          }}
        >
          <Circle size={9} fill={sessionRecording ? '#ef4444' : 'transparent'} />
          REC
        </button>

        {/* MIDI overdub */}
        <button
          onClick={() => setOverdub(v => !v)}
          title="MIDI Overdub — layer MIDI input onto playing clips"
          style={{
            padding: '3px 8px', fontSize: 10, borderRadius: 3, border: '1px solid var(--border)', cursor: 'pointer',
            background: overdub ? 'rgba(168,85,247,0.2)' : 'var(--bg-card)',
            color: overdub ? '#a855f7' : 'var(--text-muted)',
          }}
        >OVERDUB</button>

        {/* Back to arrangement */}
        {anyPlaying && (
          <button
            onClick={stopAll}
            title="Stop all session clips and return to arrangement"
            style={{
              display: 'flex', alignItems: 'center', gap: 3, padding: '3px 8px', fontSize: 10,
              borderRadius: 3, border: '1px solid #22c55e', cursor: 'pointer',
              background: 'rgba(34,197,94,0.14)', color: '#22c55e',
            }}
          >
            <ChevronRight size={10} /> Back to Arr
          </button>
        )}
      </div>

      {/* ── Scrollable body ─────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>

        {/* Track headers column */}
        <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
          {/* Spacer — aligned with scene-name header row */}
          <div style={{ width: HDR_W, height: 28, background: 'var(--bg-surface)', borderRight: '1px solid var(--border)', borderBottom: '1px solid var(--border)', flexShrink: 0 }} />

          {project.tracks.map(t => <TrackHeader key={t.id} track={t} />)}

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
            >+</button>
          </div>

          {/* Track rows */}
          {project.tracks.map(track => (
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
                  onFollowAction={handleFollowAction}
                />
              ))}
            </div>
          ))}

          {/* Stop clips per-track row */}
          <div style={{ display: 'flex', height: 32, flexShrink: 0, borderTop: '1px solid var(--border)' }}>
            {project.tracks.map(track => (
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
          <input
            type="range" min={0} max={1} step={0.005} value={crossfaderValue}
            onChange={e => dispatch({ type: 'SET_CROSSFADER', value: parseFloat(e.target.value) })}
            className="cf-slider"
            style={{ width: '100%', accentColor: 'var(--text-muted)' }}
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
