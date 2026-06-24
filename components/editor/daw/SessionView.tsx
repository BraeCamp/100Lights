'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { Plus, Play, Square, Circle, ChevronRight, Music2 } from 'lucide-react'
import { useDaw, extractPeaks, makeAudioClip } from '@/lib/daw-state'
import type { DawTrack, AudioClip, DawClip } from '@/lib/daw-types'
import { isAudioClip } from '@/lib/daw-types'
import { libraryGetAll } from '@/lib/sound-library'
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
  const anySolo = useDaw().project.tracks.some(t => t.solo)

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
        {/* Mute */}
        <button
          onClick={() => dispatch({ type: 'UPDATE_TRACK', trackId: track.id, patch: { mute: !track.mute } })}
          style={{ fontSize: 9, width: 18, height: 16, borderRadius: 2, border: '1px solid var(--border)', background: track.mute ? '#d97706' : 'var(--bg-surface)', color: track.mute ? '#fff' : 'var(--text-muted)', cursor: 'pointer', fontWeight: 700, padding: 0 }}
          title="Mute">M</button>
        {/* Solo */}
        <button
          onClick={() => dispatch({ type: 'UPDATE_TRACK', trackId: track.id, patch: { solo: !track.solo } })}
          style={{ fontSize: 9, width: 18, height: 16, borderRadius: 2, border: '1px solid var(--border)', background: track.solo ? '#eab308' : 'var(--bg-surface)', color: track.solo ? '#000' : 'var(--text-muted)', cursor: 'pointer', fontWeight: 700, padding: 0 }}
          title="Solo">S</button>
        {/* Arm */}
        <button
          onClick={() => dispatch({ type: 'UPDATE_TRACK', trackId: track.id, patch: { armed: !track.armed } })}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 18, height: 16, borderRadius: 2, border: '1px solid var(--border)', background: track.armed ? 'rgba(239,68,68,0.18)' : 'var(--bg-surface)', color: track.armed ? '#ef4444' : 'var(--text-muted)', cursor: 'pointer', padding: 0 }}
          title="Arm">
          <Circle size={7} fill={track.armed ? '#ef4444' : 'transparent'} />
        </button>
        {/* Volume */}
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

type SlotState = 'idle' | 'playing' | 'stopping'

function ClipSlot({ track, sceneIndex, clip }: {
  track: DawTrack
  sceneIndex: number
  clip: DawClip | null
}) {
  const { dispatch, engine } = useDaw()
  const [slotState, setSlotState]       = useState<SlotState>('idle')
  const [progress, setProgress]         = useState(0)
  const [dragOver, setDragOver]         = useState(false)
  const [ctxMenu, setCtxMenu]           = useState<{ x: number; y: number } | null>(null)
  const [renaming, setRenaming]         = useState(false)
  const [renameDraft, setRenameDraft]   = useState('')
  const sourceRef = useRef<AudioBufferSourceNode | null>(null)
  const rafRef    = useRef<number | undefined>(undefined)
  const startRef  = useRef(0)
  const durRef    = useRef(0)

  const audioClip = clip && isAudioClip(clip) ? clip : null

  function stopSlot() {
    try { sourceRef.current?.stop() } catch { /* already stopped */ }
    sourceRef.current = null
    if (rafRef.current !== undefined) cancelAnimationFrame(rafRef.current)
    setSlotState('idle')
    setProgress(0)
  }

  async function playSlot() {
    if (slotState === 'playing') { stopSlot(); return }
    if (!audioClip) return
    const src = await engine.playClipOnce(audioClip, track.id)
    if (!src) return
    sourceRef.current = src
    startRef.current  = engine.ctx.currentTime
    const buf = engine.bufferCache.get(audioClip.id)
    durRef.current = buf ? buf.duration - audioClip.trimStart - audioClip.trimEnd : 2
    setSlotState('playing')

    function tick() {
      const elapsed = engine.ctx.currentTime - startRef.current
      const frac    = Math.min(1, elapsed / durRef.current)
      setProgress(frac)
      if (frac < 1) rafRef.current = requestAnimationFrame(tick)
      else { setSlotState('idle'); setProgress(0) }
    }
    rafRef.current = requestAnimationFrame(tick)

    src.onended = () => {
      setSlotState('idle')
      setProgress(0)
    }
  }

  async function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const libId = e.dataTransfer.getData('application/x-library-entry-id')
    const files  = e.dataTransfer.files

    if (libId) {
      const entries = await libraryGetAll()
      const entry   = entries.find(en => en.id === libId)
      if (!entry) return
      const url = URL.createObjectURL(entry.audioBlob)
      const clip = makeAudioClip(track.id, entry.name, 0, 8, { audioUrl: url, loopEnabled: true })
      dispatch({ type: 'SET_SESSION_SLOT', trackId: track.id, sceneIndex, clip })
      const buf = await engine.loadClipBuffer(clip)
      if (buf) {
        const peaks = extractPeaks(buf)
        const updated: AudioClip = { ...clip, waveformPeaks: peaks, durationBeats: engine.secondsToBeats(buf.duration) }
        dispatch({ type: 'SET_SESSION_SLOT', trackId: track.id, sceneIndex, clip: updated })
      }
      return
    }

    if (files.length > 0) {
      const file = files[0]
      if (!file.type.startsWith('audio/')) return
      const url  = URL.createObjectURL(file)
      const clip = makeAudioClip(track.id, file.name.replace(/\.[^.]+$/, ''), 0, 8, { audioUrl: url, loopEnabled: true })
      dispatch({ type: 'SET_SESSION_SLOT', trackId: track.id, sceneIndex, clip })
      const ab  = await file.arrayBuffer()
      const buf = await engine.loadBufferFromArrayBuffer(clip.id, ab)
      const peaks = extractPeaks(buf)
      const updated: AudioClip = { ...clip, waveformPeaks: peaks, durationBeats: engine.secondsToBeats(buf.duration) }
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
      const clip = makeAudioClip(track.id, file.name.replace(/\.[^.]+$/, ''), 0, 8, { audioUrl: url, loopEnabled: true })
      dispatch({ type: 'SET_SESSION_SLOT', trackId: track.id, sceneIndex, clip })
      const ab  = await file.arrayBuffer()
      const buf = await engine.loadBufferFromArrayBuffer(clip.id, ab)
      const peaks = extractPeaks(buf)
      const updated: AudioClip = { ...clip, waveformPeaks: peaks, durationBeats: engine.secondsToBeats(buf.duration) }
      dispatch({ type: 'SET_SESSION_SLOT', trackId: track.id, sceneIndex, clip: updated })
    }
    input.click()
  }

  const progressRing = slotState === 'playing' ? (
    <div style={{
      position: 'absolute', inset: 0, pointerEvents: 'none',
      background: `linear-gradient(to right, rgba(34,197,94,0.18) ${progress * 100}%, transparent ${progress * 100}%)`,
      borderRadius: 3,
    }} />
  ) : null

  // Context menu items
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
      {
        label: 'Rename',
        action: () => { setRenameDraft(clip.name); setRenaming(true); setCtxMenu(null) },
      },
      {
        label: 'Send to Arrangement',
        action: () => {
          dispatch({ type: 'ADD_CLIP', clip: { ...clip, startBeat: 0 } })
          setCtxMenu(null)
        },
      },
    ]

    return (
      <div
        style={{
          position: 'fixed', zIndex: 1000, left: ctxMenu.x, top: ctxMenu.y,
          background: '#2a2a2a', border: '1px solid var(--border)', borderRadius: 6,
          padding: '4px 0', minWidth: 140, boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
        }}
        onMouseLeave={() => setCtxMenu(null)}
      >
        {items.map(it => (
          <button
            key={it.label}
            onClick={it.action}
            style={{
              display: 'block', width: '100%', textAlign: 'left',
              padding: '5px 12px', fontSize: 11, cursor: 'pointer',
              background: 'transparent', border: 'none',
              color: 'var(--text-secondary)',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-card-hover)'; (e.currentTarget as HTMLElement).style.color = 'var(--text-primary)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'var(--text-secondary)' }}
          >
            {it.label}
          </button>
        ))}
      </div>
    )
  }

  const isEmpty = clip === null
  const bgColor = isEmpty ? 'var(--bg-surface)' : `${track.color}28`
  const border  = slotState === 'playing'
    ? '2px solid #22c55e'
    : dragOver
      ? '2px solid var(--accent)'
      : '1px solid var(--border)'

  return (
    <>
      <div
        style={{
          width: SLOT_W, height: SLOT_H, flexShrink: 0,
          background: bgColor, border, borderRadius: 3,
          position: 'relative', overflow: 'hidden',
          cursor: isEmpty ? (track.type === 'audio' ? 'pointer' : 'default') : 'default',
          boxSizing: 'border-box',
          transition: 'background 0.1s',
        }}
        onClick={isEmpty ? handleEmptyClick : undefined}
        onContextMenu={clip ? e => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY }) } : undefined}
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
      >
        {progressRing}

        {isEmpty ? (
          <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', opacity: 0.3 }}>
            {track.type === 'audio' ? <Plus size={14} /> : <Music2 size={14} />}
          </div>
        ) : (
          <>
            {/* Waveform */}
            {audioClip?.waveformPeaks && audioClip.waveformPeaks.length > 0 && (
              <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', opacity: 0.6 }}>
                <Waveform peaks={audioClip.waveformPeaks} color={track.color} width={SLOT_W} height={SLOT_H} />
              </div>
            )}

            {/* Clip name */}
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

            {/* Play/stop button */}
            <button
              onClick={e => { e.stopPropagation(); playSlot() }}
              style={{
                position: 'absolute', left: 4, top: '50%', transform: 'translateY(-50%)',
                width: 20, height: 20, borderRadius: 3, border: 'none',
                background: slotState === 'playing' ? '#22c55e' : `${track.color}cc`,
                color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                zIndex: 2,
              }}
            >
              {slotState === 'playing'
                ? <Square size={8} fill="currentColor" />
                : <Play size={9} fill="currentColor" />
              }
            </button>
          </>
        )}
      </div>
      {renderCtxMenu()}
    </>
  )
}

// ── Session View ──────────────────────────────────────────────────────────────

export default function SessionView() {
  const { project, dispatch } = useDaw()

  function launchScene(sceneIndex: number) {
    // Play all clips in this scene row
    for (const track of project.tracks) {
      const clip = project.sessionGrid[track.id]?.[sceneIndex]
      if (clip && isAudioClip(clip)) {
        // Trigger playback — handled by each ClipSlot, this is just for future scheduling
      }
    }
  }

  return (
    <div style={{
      display: 'flex',
      flex: 1,
      overflow: 'auto',
      background: 'var(--bg-base)',
      userSelect: 'none',
    }}>
      {/* Track headers column */}
      <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
        {/* Header for the track col */}
        <div style={{ width: HDR_W, height: 28, background: 'var(--bg-surface)', borderRight: '1px solid var(--border)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', padding: '0 8px' }}>
          <span style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.08em' }}>TRACKS</span>
        </div>
        {project.tracks.map(t => <TrackHeader key={t.id} track={t} />)}

        {/* Add track buttons */}
        <div style={{ display: 'flex', gap: 4, padding: '8px', width: HDR_W, borderRight: '1px solid var(--border)' }}>
          {(['audio', 'midi', 'drum'] as const).map(type => (
            <button
              key={type}
              onClick={() => dispatch({ type: 'ADD_TRACK', trackType: type })}
              style={{
                flex: 1, padding: '4px 0', fontSize: 9, borderRadius: 3,
                border: '1px solid var(--border)', background: 'var(--bg-card)',
                color: 'var(--text-muted)', cursor: 'pointer', letterSpacing: '0.04em',
              }}
              title={`Add ${type} track`}
            >
              +{type[0].toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* Clip grid */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* Scene header row */}
        <div style={{ display: 'flex', height: 28, background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          {project.scenes.map((scene, i) => (
            <div
              key={scene.id}
              style={{
                width: SLOT_W, flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                borderRight: '1px solid var(--border)',
                fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.06em',
                userSelect: 'none',
              }}
            >
              {scene.name}
            </div>
          ))}
          {/* Add scene */}
          <button
            onClick={() => dispatch({ type: 'ADD_SCENE' })}
            style={{ flexShrink: 0, width: 28, background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 16 }}
            title="Add scene"
          >+</button>
        </div>

        {/* Track rows */}
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
            style={{
              width: SCENE_W, height: SLOT_H, flexShrink: 0,
              background: 'var(--bg-card)',
              border: 'none',
              borderLeft: '1px solid var(--border)',
              borderBottom: '1px solid var(--border)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
              color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 11,
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-card-hover)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-card)' }}
          >
            <ChevronRight size={12} />
            {scene.name}
          </button>
        ))}
        {/* Add scene button */}
        <button
          onClick={() => dispatch({ type: 'ADD_SCENE' })}
          style={{
            width: SCENE_W, height: 36, background: 'transparent', border: 'none',
            borderLeft: '1px solid var(--border)', color: 'var(--text-muted)',
            cursor: 'pointer', fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
          }}
        >
          <Plus size={11} /> Scene
        </button>
      </div>
    </div>
  )
}
