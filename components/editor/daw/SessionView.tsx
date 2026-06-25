'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { Plus, Square, Circle, ChevronRight, Music2 } from 'lucide-react'
import { useDaw, extractPeaks, makeAudioClip } from '@/lib/daw-state'
import type { DawTrack, AudioClip, DawClip, LaunchQuantization } from '@/lib/daw-types'
import { isAudioClip } from '@/lib/daw-types'
import { libraryGetAll } from '@/lib/sound-library'
import { libraryFulfill } from '@/lib/default-samples'
import Waveform from './Waveform'

const SLOT_W  = 160
const SLOT_H  = 72
const HDR_W   = 200
const SCENE_W = 110

// ── Mini pan drag ─────────────────────────────────────────────────────────────

function PanDrag({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const dragRef = useRef<{ startX: number; startVal: number } | null>(null)
  const label   = value === 0 ? 'C' : value < 0 ? `L${Math.round(-value * 100)}` : `R${Math.round(value * 100)}`

  function onMouseDown(e: React.MouseEvent) {
    if (e.detail === 2) { onChange(0); return }
    dragRef.current = { startX: e.clientX, startVal: value }
    function onMove(ev: MouseEvent) {
      if (!dragRef.current) return
      const delta = (ev.clientX - dragRef.current.startX) / 80
      onChange(Math.max(-1, Math.min(1, dragRef.current.startVal + delta)))
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
    >
      {label}
    </div>
  )
}

// ── Track header ──────────────────────────────────────────────────────────────

function TrackHeader({ track }: { track: DawTrack }) {
  const { dispatch, engine } = useDaw()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft]     = useState(track.name)

  function commit() {
    dispatch({ type: 'UPDATE_TRACK', trackId: track.id, patch: { name: draft } })
    setEditing(false)
  }

  return (
    <div style={{
      width: HDR_W, height: SLOT_H, flexShrink: 0,
      display: 'flex', flexDirection: 'column', justifyContent: 'center',
      gap: 4, padding: '6px 8px',
      background: 'var(--bg-card)',
      borderRight: '1px solid var(--border)',
      borderBottom: '1px solid var(--border)',
      borderLeft: `3px solid ${track.color}`,
      boxSizing: 'border-box',
    }}>
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
          {track.type === 'audio' ? 'A' : track.type === 'midi' ? 'M' : 'D'}
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
        <button
          onClick={() => dispatch({ type: 'UPDATE_TRACK', trackId: track.id, patch: { mute: !track.mute } })}
          style={{ fontSize: 9, width: 18, height: 16, borderRadius: 2, border: '1px solid var(--border)', background: track.mute ? '#d97706' : 'var(--bg-surface)', color: track.mute ? '#fff' : 'var(--text-muted)', cursor: 'pointer', fontWeight: 700, padding: 0 }}
          title="Mute">M</button>
        <button
          onClick={() => dispatch({ type: 'UPDATE_TRACK', trackId: track.id, patch: { solo: !track.solo } })}
          style={{ fontSize: 9, width: 18, height: 16, borderRadius: 2, border: '1px solid var(--border)', background: track.solo ? '#eab308' : 'var(--bg-surface)', color: track.solo ? '#000' : 'var(--text-muted)', cursor: 'pointer', fontWeight: 700, padding: 0 }}
          title="Solo">S</button>
        <button
          onClick={() => dispatch({ type: 'UPDATE_TRACK', trackId: track.id, patch: { armed: !track.armed } })}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 18, height: 16, borderRadius: 2, border: '1px solid var(--border)', background: track.armed ? 'rgba(239,68,68,0.18)' : 'var(--bg-surface)', color: track.armed ? '#ef4444' : 'var(--text-muted)', cursor: 'pointer', padding: 0 }}
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
    </div>
  )
}

// ── Clip slot ─────────────────────────────────────────────────────────────────

type SlotDisplayState = 'idle' | 'queued' | 'playing'

function ClipSlot({ track, sceneIndex, clip }: {
  track: DawTrack
  sceneIndex: number
  clip: DawClip | null
}) {
  const { dispatch, engine } = useDaw()
  const [displayState, setDisplayState] = useState<SlotDisplayState>('idle')
  const [progress, setProgress]         = useState(0)
  const [dragOver, setDragOver]         = useState(false)
  const [ctxMenu, setCtxMenu]           = useState<{ x: number; y: number } | null>(null)
  const [renaming, setRenaming]         = useState(false)
  const [renameDraft, setRenameDraft]   = useState('')
  const rafRef = useRef<number | undefined>(undefined)

  const audioClip = clip && isAudioClip(clip) ? clip : null

  // Sync display state from engine events
  useEffect(() => {
    if (!clip) { setDisplayState('idle'); return }

    function onSessionState(e: Event) {
      const detail = (e as CustomEvent).detail as { trackId: string; clipId: string; state: SlotDisplayState }
      if (detail.trackId === track.id && detail.clipId === clip!.id) {
        setDisplayState(detail.state)
        if (detail.state !== 'playing') setProgress(0)
      }
    }

    engine.addEventListener('session-state', onSessionState)
    // Sync initial state
    setDisplayState(engine.getSessionState(track.id, clip.id))
    return () => engine.removeEventListener('session-state', onSessionState)
  }, [engine, track.id, clip])

  // Progress animation while playing
  useEffect(() => {
    if (displayState !== 'playing') {
      if (rafRef.current !== undefined) cancelAnimationFrame(rafRef.current)
      return
    }

    function tick() {
      const p = engine.getSessionProgress(track.id)
      setProgress(p)
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => { if (rafRef.current !== undefined) cancelAnimationFrame(rafRef.current) }
  }, [displayState, engine, track.id])

  // Blink animation for queued state
  const [blink, setBlink] = useState(true)
  useEffect(() => {
    if (displayState !== 'queued') return
    const interval = setInterval(() => setBlink(v => !v), 500)
    return () => clearInterval(interval)
  }, [displayState])

  async function handleTrigger() {
    if (!audioClip) return
    await engine.queueSession(track.id, audioClip)
  }

  async function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
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
      const newClip = makeAudioClip(track.id, entry.name, 0, 8, { audioUrl: url, loopEnabled: true })
      dispatch({ type: 'SET_SESSION_SLOT', trackId: track.id, sceneIndex, clip: newClip })
      const buf = await engine.loadClipBuffer(newClip)
      if (buf) {
        const peaks = extractPeaks(buf)
        const updated: AudioClip = { ...newClip, waveformPeaks: peaks, durationBeats: engine.secondsToBeats(buf.duration) }
        dispatch({ type: 'SET_SESSION_SLOT', trackId: track.id, sceneIndex, clip: updated })
      }
      return
    }

    if (files.length > 0) {
      const file = files[0]
      if (!file.type.startsWith('audio/')) return
      const url  = URL.createObjectURL(file)
      const newClip = makeAudioClip(track.id, file.name.replace(/\.[^.]+$/, ''), 0, 8, { audioUrl: url, loopEnabled: true })
      dispatch({ type: 'SET_SESSION_SLOT', trackId: track.id, sceneIndex, clip: newClip })
      const ab  = await file.arrayBuffer()
      const buf = await engine.loadBufferFromArrayBuffer(newClip.id, ab)
      const peaks = extractPeaks(buf)
      const updated: AudioClip = { ...newClip, waveformPeaks: peaks, durationBeats: engine.secondsToBeats(buf.duration) }
      dispatch({ type: 'SET_SESSION_SLOT', trackId: track.id, sceneIndex, clip: updated })
    }
  }

  async function handleEmptyClick() {
    if (track.type !== 'audio') return
    const input = document.createElement('input')
    input.type  = 'file'
    input.accept = 'audio/*'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      const url  = URL.createObjectURL(file)
      const newClip = makeAudioClip(track.id, file.name.replace(/\.[^.]+$/, ''), 0, 8, { audioUrl: url, loopEnabled: true })
      dispatch({ type: 'SET_SESSION_SLOT', trackId: track.id, sceneIndex, clip: newClip })
      const ab  = await file.arrayBuffer()
      const buf = await engine.loadBufferFromArrayBuffer(newClip.id, ab)
      const peaks = extractPeaks(buf)
      const updated: AudioClip = { ...newClip, waveformPeaks: peaks, durationBeats: engine.secondsToBeats(buf.duration) }
      dispatch({ type: 'SET_SESSION_SLOT', trackId: track.id, sceneIndex, clip: updated })
    }
    input.click()
  }

  const isEmpty = clip === null

  const borderColor = displayState === 'playing'
    ? '#22c55e'
    : displayState === 'queued'
      ? (blink ? '#f97316' : 'var(--border)')
      : dragOver
        ? 'var(--accent)'
        : 'var(--border)'

  const borderWidth = (displayState === 'playing' || displayState === 'queued' || dragOver) ? '2px' : '1px'

  const triggerBg = displayState === 'playing'
    ? '#22c55e'
    : displayState === 'queued'
      ? '#f97316'
      : `${track.color}cc`

  function renderCtxMenu() {
    if (!ctxMenu || !clip) return null
    const items: { label: string; action: () => void }[] = [
      { label: 'Delete', action: () => { dispatch({ type: 'SET_SESSION_SLOT', trackId: track.id, sceneIndex, clip: null }); setCtxMenu(null) } },
      {
        label: audioClip?.loopEnabled ? 'Disable Loop' : 'Enable Loop',
        action: () => {
          if (!audioClip) return
          dispatch({ type: 'SET_SESSION_SLOT', trackId: track.id, sceneIndex, clip: { ...audioClip, loopEnabled: !audioClip.loopEnabled } })
          setCtxMenu(null)
        },
      },
      { label: 'Rename', action: () => { setRenameDraft(clip.name); setRenaming(true); setCtxMenu(null) } },
      {
        label: 'Send to Arrangement',
        action: () => { dispatch({ type: 'ADD_CLIP', clip: { ...clip, startBeat: 0 } }); setCtxMenu(null) },
      },
    ]

    return (
      <div
        style={{ position: 'fixed', zIndex: 1000, left: ctxMenu.x, top: ctxMenu.y, background: '#2a2a2a', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 0', minWidth: 140, boxShadow: '0 4px 20px rgba(0,0,0,0.5)' }}
        onMouseLeave={() => setCtxMenu(null)}
      >
        {items.map(it => (
          <button
            key={it.label}
            onClick={it.action}
            style={{ display: 'block', width: '100%', textAlign: 'left', padding: '5px 12px', fontSize: 11, cursor: 'pointer', background: 'transparent', border: 'none', color: 'var(--text-primary)' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
          >{it.label}</button>
        ))}
      </div>
    )
  }

  return (
    <>
      <div
        style={{
          width: SLOT_W, height: SLOT_H, flexShrink: 0,
          background: isEmpty ? 'var(--bg-surface)' : `${track.color}28`,
          border: `${borderWidth} solid ${borderColor}`,
          borderRadius: 3, position: 'relative', overflow: 'hidden',
          cursor: isEmpty && track.type === 'audio' ? 'pointer' : 'default',
          boxSizing: 'border-box',
        }}
        onClick={isEmpty ? handleEmptyClick : undefined}
        onContextMenu={clip ? e => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY }) } : undefined}
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
      >
        {/* Progress fill */}
        {displayState === 'playing' && (
          <div style={{
            position: 'absolute', inset: 0, pointerEvents: 'none',
            background: `linear-gradient(to right, rgba(34,197,94,0.15) ${progress * 100}%, transparent ${progress * 100}%)`,
          }} />
        )}

        {isEmpty ? (
          <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', opacity: 0.3 }}>
            {track.type === 'audio' ? <Plus size={14} /> : <Music2 size={14} />}
          </div>
        ) : (
          <>
            {audioClip?.waveformPeaks && audioClip.waveformPeaks.length > 0 && (
              <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', opacity: 0.6 }}>
                <Waveform peaks={audioClip.waveformPeaks} color={track.color} width={SLOT_W} height={SLOT_H} />
              </div>
            )}

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
              <div style={{ position: 'absolute', top: 4, left: 28, right: 4, fontSize: 10, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', userSelect: 'none', zIndex: 1 }}>
                {clip.name}
              </div>
            )}

            {audioClip?.loopEnabled && (
              <div style={{ position: 'absolute', bottom: 3, right: 4, fontSize: 8, color: track.color, opacity: 0.8 }}>⟳</div>
            )}

            {/* Trigger button */}
            {audioClip && (
              <button
                onClick={e => { e.stopPropagation(); handleTrigger() }}
                style={{
                  position: 'absolute', left: 4, top: '50%', transform: 'translateY(-50%)',
                  width: 20, height: 20, borderRadius: 3, border: 'none',
                  background: triggerBg, color: '#fff', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2,
                }}
                title={displayState === 'playing' ? 'Stop' : displayState === 'queued' ? 'Queued...' : 'Launch (quantized)'}
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

// ── Session View ──────────────────────────────────────────────────────────────

export default function SessionView() {
  const { project, dispatch, engine } = useDaw()
  const [quantize, setQuantize] = useState<LaunchQuantization>('bar')

  useEffect(() => {
    engine.launchQuantization = quantize
  }, [quantize, engine])

  async function launchScene(sceneIndex: number) {
    for (const track of project.tracks) {
      const clip = project.sessionGrid[track.id]?.[sceneIndex]
      if (clip && isAudioClip(clip)) {
        await engine.queueSession(track.id, clip)
      }
    }
  }

  const quantOptions: { val: LaunchQuantization; label: string }[] = [
    { val: 'none',  label: 'None' },
    { val: 'beat',  label: '1 Beat' },
    { val: 'bar',   label: '1 Bar' },
    { val: '2bar',  label: '2 Bars' },
    { val: '4bar',  label: '4 Bars' },
  ]

  return (
    <div style={{ display: 'flex', flex: 1, overflow: 'auto', background: 'var(--bg-base)', userSelect: 'none' }}>

      {/* Track headers column */}
      <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
        {/* Quantize selector */}
        <div style={{ width: HDR_W, height: 28, background: 'var(--bg-surface)', borderRight: '1px solid var(--border)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', padding: '0 6px', gap: 4 }}>
          <span style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: '0.06em', flexShrink: 0 }}>Q:</span>
          <select
            value={quantize}
            onChange={e => setQuantize(e.target.value as LaunchQuantization)}
            onClick={e => e.stopPropagation()}
            style={{ flex: 1, fontSize: 9, background: 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 3, padding: '1px 2px', outline: 'none', cursor: 'pointer' }}
          >
            {quantOptions.map(o => <option key={o.val} value={o.val}>{o.label}</option>)}
          </select>
        </div>

        {project.tracks.map(t => <TrackHeader key={t.id} track={t} />)}

        <div style={{ display: 'flex', gap: 4, padding: '8px', width: HDR_W, borderRight: '1px solid var(--border)' }}>
          {(['audio', 'midi', 'drum'] as const).map(type => (
            <button
              key={type}
              onClick={() => dispatch({ type: 'ADD_TRACK', trackType: type })}
              style={{ flex: 1, padding: '4px 0', fontSize: 9, borderRadius: 3, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-muted)', cursor: 'pointer', letterSpacing: '0.04em' }}
              title={`Add ${type} track`}
            >
              +{type[0].toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* Clip grid */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <div style={{ display: 'flex', height: 28, background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          {project.scenes.map((scene) => (
            <div
              key={scene.id}
              style={{ width: SLOT_W, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRight: '1px solid var(--border)', fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.06em', userSelect: 'none' }}
            >
              {scene.name}
            </div>
          ))}
          <button
            onClick={() => dispatch({ type: 'ADD_SCENE' })}
            style={{ flexShrink: 0, width: 28, background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 16 }}
            title="Add scene"
          >+</button>
        </div>

        {project.tracks.map(track => (
          <div key={track.id} style={{ display: 'flex', height: SLOT_H, flexShrink: 0 }}>
            {project.scenes.map((scene, si) => (
              <ClipSlot
                key={`${track.id}-${si}`}
                track={track}
                sceneIndex={si}
                clip={project.sessionGrid[track.id]?.[si] ?? null}
              />
            ))}
          </div>
        ))}
      </div>

      {/* Scene launch column */}
      <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ height: 28, background: 'var(--bg-surface)', borderLeft: '1px solid var(--border)', borderBottom: '1px solid var(--border)', width: SCENE_W }} />
        {project.scenes.map((scene, i) => (
          <button
            key={scene.id}
            onClick={() => launchScene(i)}
            style={{ width: SCENE_W, height: SLOT_H, flexShrink: 0, background: 'var(--bg-card)', border: 'none', borderLeft: '1px solid var(--border)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, color: 'var(--text-muted)', cursor: 'pointer', fontSize: 11 }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.04)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-card)' }}
          >
            <ChevronRight size={12} />
            {scene.name}
          </button>
        ))}
        <button
          onClick={() => dispatch({ type: 'ADD_SCENE' })}
          style={{ width: SCENE_W, height: 36, background: 'transparent', border: 'none', borderLeft: '1px solid var(--border)', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}
        >
          <Plus size={11} /> Scene
        </button>
      </div>
    </div>
  )
}
