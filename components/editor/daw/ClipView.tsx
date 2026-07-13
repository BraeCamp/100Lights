'use client'

import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import type { DawTrack, DawClip, AudioClip } from '@/lib/daw-types'
import { isAudioClip, isMidiClip } from '@/lib/daw-types'
import { useDaw } from '@/lib/daw-state'
import Waveform from './Waveform'

// ── Helpers ───────────────────────────────────────────────────────────────────

function gainToDb(gain: number): string {
  if (gain <= 0) return '-inf dB'
  const db = 20 * Math.log10(gain)
  return `${db >= 0 ? '+' : ''}${db.toFixed(1)} dB`
}

export function detectTransients(
  audioBuffer: AudioBuffer,
  startBeat: number,
  tempo: number,
  sensitivity: number,
  trimStart = 0,
): number[] {
  const sr = audioBuffer.sampleRate
  const data = audioBuffer.getChannelData(0)
  const windowSize = 512
  const hopSize = 256
  const transientBeats: number[] = []

  let prevEnergy = 0
  for (let i = 0; i < data.length - windowSize; i += hopSize) {
    let energy = 0
    for (let j = 0; j < windowSize; j++) {
      energy += data[i + j] * data[i + j]
    }
    energy /= windowSize

    const flux = Math.max(0, energy - prevEnergy)
    if (flux > prevEnergy * sensitivity && energy > 0.001) {
      const bufferTimeSec = i / sr
      const clipTimeSec = bufferTimeSec - trimStart
      if (clipTimeSec > 0) {
        const beat = startBeat + (clipTimeSec * tempo) / 60
        transientBeats.push(beat)
      }
    }
    prevEnergy = energy
  }

  // Merge transients closer than 1/16th note
  const minGap = (60 / tempo) / 4
  const merged: number[] = []
  for (const b of transientBeats) {
    if (merged.length === 0 || b - merged[merged.length - 1] > minGap) {
      merged.push(b)
    }
  }
  return merged
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ClipView({ clip, track, beatW, selected, multiSelected, loopNativeBeats, isCropping, collabHolder, onSelect, onShiftSelect, onDoubleClick, onSettings, onMove, onResize, onCrop, onCropChange, onCropSnap, onIsolate, onSplice, onDelete, onDragStart, onDeleteAll, onReplaceSample, onSpectral, onScrollBy, waveformZoom, onFadeChange, onCopy, onPaste }: {
  clip: DawClip; track: DawTrack; beatW: number; selected: boolean; multiSelected: boolean
  loopNativeBeats?: number
  isCropping?: boolean
  /** A collaborator holding this clip (selected, or editing = piano roll open) */
  collabHolder?: { name: string; color: string; editing: boolean }
  onSelect(): void; onShiftSelect(): void; onDoubleClick(): void; onSettings?(): void
  onMove(startBeat: number, trackId: string, altKey: boolean): void
  onResize(durationBeats: number, altKey: boolean): void
  onCrop(): void
  onCropChange?(trimStart: number, trimEnd: number): void
  onCropSnap?(beat: number): number
  onIsolate(beat: number): void; onSplice?(): void; onDelete(): void
  onDragStart?(): void
  onDeleteAll?(): void
  onReplaceSample?(): void
  onSpectral?(): void
  onScrollBy?(delta: number): void
  waveformZoom?: number
  onFadeChange?(fadeIn: number, fadeOut: number): void
  onCopy?(): void
  onPaste?(): void
}) {
  const { engine, project, dispatch } = useDaw()
  const clipDivRef = useRef<HTMLDivElement>(null)
  const menuRef    = useRef<HTMLDivElement>(null)
  const dragRef    = useRef<{ startX: number; startBeat: number } | null>(null)
  const resizeRef  = useRef<{ startX: number; startDur: number } | null>(null)
  const gainDragRef = useRef<{ startY: number; startGain: number; clipH: number } | null>(null)
  const [ctxPos, setCtxPos] = useState<{ x: number; y: number; beat: number } | null>(null)
  const [hovered, setHovered] = useState(false)
  const [gainDragInfo, setGainDragInfo] = useState<{ gain: number; mouseX: number; mouseY: number } | null>(null)
  const [transientDialog, setTransientDialog] = useState<{
    sensitivity: number
    transients: number[]
    buf: AudioBuffer
  } | null>(null)

  useEffect(() => {
    if (!ctxPos) return
    function handler(e: MouseEvent) {
      if (menuRef.current?.contains(e.target as Node)) return
      setCtxPos(null)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [ctxPos])

  const left  = clip.startBeat * beatW
  const width = Math.max(8, clip.durationBeats * beatW)
  const color = track.color

  // Trim overlay positions (fraction of clip width) — audio clips only
  const audioClip = isAudioClip(clip) ? clip : null
  const bufDur  = audioClip?.bufferDuration ?? null
  const trimS   = audioClip?.trimStart ?? 0
  const trimE   = audioClip?.trimEnd   ?? 0
  const inFrac  = bufDur && bufDur > 0 ? trimS / bufDur : 0
  const outFrac = bufDur && bufDur > 0 ? (bufDur - trimE) / bufDur : 1
  const inPx    = inFrac * width
  const outPx   = outFrac * width

  // Fade pixel widths — audio clips only
  const secPerBeat = 60 / project.tempo
  const fadeInPx  = audioClip && audioClip.fadeIn  > 0 ? Math.min(width, (audioClip.fadeIn  / secPerBeat) * beatW) : 0
  const fadeOutPx = audioClip && audioClip.fadeOut > 0 ? Math.min(width, (audioClip.fadeOut / secPerBeat) * beatW) : 0

  // ── Gain handle ──────────────────────────────────────────────────────────────

  const currentGain = audioClip?.gain ?? 1
  // Fraction from top: gain=2 → 0 (top), gain=1 → 0.5 (center), gain=0 → 1 (bottom)
  const gainFrac = Math.max(0, Math.min(1, 1 - currentGain / 2))
  const gainBarVisible = isAudioClip(clip) && (hovered || gainDragInfo !== null)

  function onMouseDownGainHandle(e: React.MouseEvent) {
    if (!audioClip) return
    e.stopPropagation()
    e.preventDefault()
    const clipH = clipDivRef.current?.getBoundingClientRect().height ?? 56
    gainDragRef.current = { startY: e.clientY, startGain: audioClip.gain, clipH }
    setGainDragInfo({ gain: audioClip.gain, mouseX: e.clientX, mouseY: e.clientY })

    function mm(ev: MouseEvent) {
      if (!gainDragRef.current) return
      const dy = ev.clientY - gainDragRef.current.startY
      // Up = increase gain; full clip height = +2.0 gain range
      const gainDelta = -dy / gainDragRef.current.clipH * 2.0
      const newGain = Math.max(0, Math.min(2.0, gainDragRef.current.startGain + gainDelta))
      setGainDragInfo({ gain: newGain, mouseX: ev.clientX, mouseY: ev.clientY })
      dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch: { gain: newGain } })
    }
    function mu() {
      gainDragRef.current = null
      setGainDragInfo(null)
      document.removeEventListener('mousemove', mm)
      document.removeEventListener('mouseup', mu)
    }
    document.addEventListener('mousemove', mm)
    document.addEventListener('mouseup', mu)
  }

  // ── Transient split ──────────────────────────────────────────────────────────

  async function handleSplitAtTransients() {
    if (!isAudioClip(clip)) return
    let buf = engine.bufferCache.get(clip.id)
    if (!buf) buf = await engine.loadClipBuffer(clip as AudioClip) ?? undefined
    if (!buf) return
    const sensitivity = 2.0
    const ac = clip as AudioClip
    const transients = detectTransients(buf, ac.startBeat, project.tempo, sensitivity, ac.trimStart ?? 0)
      .filter(b => b > ac.startBeat + 0.01 && b < ac.startBeat + ac.durationBeats - 0.01)
    setTransientDialog({ sensitivity, transients, buf })
  }

  function applyTransientSplit() {
    if (!transientDialog || !isAudioClip(clip)) return
    const { transients, buf } = transientDialog
    if (transients.length === 0) { setTransientDialog(null); return }
    const ac = clip as AudioClip
    const secPerBeat2 = 60 / project.tempo
    const splitBeats = [ac.startBeat, ...transients, ac.startBeat + ac.durationBeats]

    dispatch({ type: 'REMOVE_CLIP', clipId: clip.id })
    for (let i = 0; i < splitBeats.length - 1; i++) {
      const s = splitBeats[i]
      const e = splitBeats[i + 1]
      const dur = e - s
      const offsetSec = (s - ac.startBeat) * secPerBeat2
      const newId = crypto.randomUUID()
      const newClip: AudioClip = {
        ...ac,
        id: newId,
        startBeat: s,
        durationBeats: dur,
        trimStart: Math.max(0, (ac.trimStart ?? 0) + offsetSec),
        trimEnd: Math.max(0, (ac.trimEnd ?? 0) + ((ac.startBeat + ac.durationBeats - e) * secPerBeat2)),
        name: splitBeats.length > 2 ? `${ac.name} ${i + 1}` : ac.name,
        waveformPeaks: ac.waveformPeaks,  // kept but may be inaccurate; will reload
      }
      engine.bufferCache.set(newId, buf)
      dispatch({ type: 'ADD_CLIP', clip: newClip })
    }
    setTransientDialog(null)
  }

  // ── Body drag ────────────────────────────────────────────────────────────────

  function onMouseDownBody(e: React.MouseEvent) {
    if (e.button !== 0) return
    e.stopPropagation()
    if (isCropping) return  // don't drag while cropping
    const wasMultiSelected = multiSelected && !e.altKey
    if (e.altKey) { onShiftSelect() } else if (!wasMultiSelected) { onSelect() }
    onDragStart?.()
    dragRef.current = { startX: e.clientX, startBeat: clip.startBeat }
    let dragged = false
    let lastMX = e.clientX
    let lastTrackId = track.id
    let edgeRaf = 0

    function tickEdge() {
      if (!dragRef.current) return
      const ZONE = 80
      const MAX_PX = 14
      let delta = 0
      if (lastMX < ZONE) delta = -Math.round(MAX_PX * (1 - lastMX / ZONE))
      else if (lastMX > window.innerWidth - ZONE) delta = Math.round(MAX_PX * (1 - (window.innerWidth - lastMX) / ZONE))
      if (delta !== 0 && onScrollBy) {
        onScrollBy(delta)
        dragRef.current.startX -= delta
        onMove(Math.max(0, dragRef.current.startBeat + (lastMX - dragRef.current.startX) / beatW), lastTrackId, false)
      }
      edgeRaf = requestAnimationFrame(tickEdge)
    }
    edgeRaf = requestAnimationFrame(tickEdge)

    function mm(ev: MouseEvent) {
      if (!dragRef.current) return
      dragged = true
      lastMX = ev.clientX
      const div = clipDivRef.current
      if (div) div.style.pointerEvents = 'none'
      const el = document.elementFromPoint(ev.clientX, ev.clientY)
      if (div) div.style.pointerEvents = ''
      lastTrackId = el?.closest('[data-track-id]')?.getAttribute('data-track-id') ?? track.id
      onMove(Math.max(0, dragRef.current.startBeat + (ev.clientX - dragRef.current.startX) / beatW), lastTrackId, ev.altKey)
    }
    function mu() {
      cancelAnimationFrame(edgeRaf)
      dragRef.current = null
      document.removeEventListener('mousemove', mm)
      document.removeEventListener('mouseup', mu)
      if (!dragged && wasMultiSelected) onSelect()  // click without drag → collapse to single
    }
    document.addEventListener('mousemove', mm); document.addEventListener('mouseup', mu)
  }

  function onMouseDownResize(e: React.MouseEvent) {
    e.stopPropagation()
    resizeRef.current = { startX: e.clientX, startDur: clip.durationBeats }
    function mm(ev: MouseEvent) {
      if (!resizeRef.current) return
      onResize(Math.max(0.125, resizeRef.current.startDur + (ev.clientX - resizeRef.current.startX) / beatW), ev.altKey)
    }
    function mu() { resizeRef.current = null; document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', mu) }
    document.addEventListener('mousemove', mm); document.addEventListener('mouseup', mu)
  }

  // Crop handle drag — shared for IN (left) and OUT (right)
  function onMouseDownCropHandle(e: React.MouseEvent, side: 'in' | 'out') {
    if (!bufDur || !onCropChange) return
    e.stopPropagation()
    const startX      = e.clientX
    const startInSec  = isAudioClip(clip) ? clip.trimStart : 0
    const startOutSec = isAudioClip(clip) ? clip.trimEnd   : 0

    function mm(ev: MouseEvent) {
      if (!isAudioClip(clip) || !bufDur || !onCropChange) return
      const dx = ev.clientX - startX
      const dFrac = dx / width

      if (side === 'in') {
        const rawSec = startInSec + dFrac * bufDur
        let newTrimStart = rawSec
        if (onCropSnap && clip.durationBeats > 0) {
          const arrangBeat = clip.startBeat + (rawSec / bufDur) * clip.durationBeats
          const snapped    = onCropSnap(arrangBeat)
          newTrimStart     = ((snapped - clip.startBeat) / clip.durationBeats) * bufDur
        }
        newTrimStart = Math.max(0, Math.min(bufDur - clip.trimEnd - 0.001, newTrimStart))
        onCropChange(newTrimStart, clip.trimEnd)
      } else {
        const outSec    = bufDur - startOutSec
        const rawOutSec = outSec + dFrac * bufDur
        let newTrimEnd  = bufDur - rawOutSec
        if (onCropSnap && clip.durationBeats > 0) {
          const arrangBeat = clip.startBeat + (rawOutSec / bufDur) * clip.durationBeats
          const snapped    = onCropSnap(arrangBeat)
          const snappedOut = ((snapped - clip.startBeat) / clip.durationBeats) * bufDur
          newTrimEnd       = bufDur - snappedOut
        }
        newTrimEnd = Math.max(0, Math.min(bufDur - clip.trimStart - 0.001, newTrimEnd))
        onCropChange(clip.trimStart, newTrimEnd)
      }
    }
    function mu() { document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', mu) }
    document.addEventListener('mousemove', mm); document.addEventListener('mouseup', mu)
  }

  // Fade handle drag — fade-in (drag right = more fade)
  function onMouseDownFadeIn(e: React.MouseEvent) {
    if (!audioClip || !onFadeChange) return
    e.stopPropagation()
    const startX = e.clientX
    const startFade = audioClip.fadeIn
    const maxFadeSec = engine.beatsToSeconds(clip.durationBeats)
    const currentFadeOut = audioClip.fadeOut

    function mm(ev: MouseEvent) {
      const dx = ev.clientX - startX
      const dSec = (dx / beatW) * secPerBeat
      const newFadeIn = Math.max(0, Math.min(maxFadeSec, startFade + dSec))
      onFadeChange!(newFadeIn, currentFadeOut)
    }
    function mu() { document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', mu) }
    document.addEventListener('mousemove', mm); document.addEventListener('mouseup', mu)
  }

  // Fade-out handle drag — drag left = more fade
  function onMouseDownFadeOut(e: React.MouseEvent) {
    if (!audioClip || !onFadeChange) return
    e.stopPropagation()
    const startX = e.clientX
    const startFade = audioClip.fadeOut
    const maxFadeSec = engine.beatsToSeconds(clip.durationBeats)
    const currentFadeIn = audioClip.fadeIn

    function mm(ev: MouseEvent) {
      const dx = ev.clientX - startX
      const dSec = (-dx / beatW) * secPerBeat
      const newFadeOut = Math.max(0, Math.min(maxFadeSec, startFade + dSec))
      onFadeChange!(currentFadeIn, newFadeOut)
    }
    function mu() { document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', mu) }
    document.addEventListener('mousemove', mm); document.addEventListener('mouseup', mu)
  }

  const isMulti = multiSelected && !!onDeleteAll
  const menuItems = [
    { label: isMulti ? 'Copy Selected' : 'Copy', fn: () => onCopy?.() },
    ...(onPaste ? [{ label: 'Paste', fn: () => onPaste() }] : []),
    isMulti
      ? { label: 'Delete Selected', fn: () => onDeleteAll!() }
      : { label: 'Delete', fn: onDelete },
    { label: 'Splice at Playhead', fn: () => onSplice?.() },
    ...(isAudioClip(clip) ? [
      { label: 'Clip Settings', fn: () => onSettings?.() },
      { label: isCropping ? 'Exit Crop' : 'Crop', fn: onCrop },
      { label: 'Isolate on Playhead', fn: () => onIsolate(ctxPos?.beat ?? clip.startBeat) },
      { label: isMulti ? 'Replace Sample (All Selected)' : 'Replace Sample', fn: () => onReplaceSample?.() },
      { label: 'Spectral Editor', fn: () => onSpectral?.() },
      { label: 'Split at Transients', fn: () => { setCtxPos(null); void handleSplitAtTransients() } },
    ] : [
      { label: 'Open Piano Roll', fn: onDoubleClick },
    ]),
  ]

  return (
    <>
      <div
        ref={clipDivRef}
        style={{ position: 'absolute', left, width, top: 4, bottom: 4, background: `${color}40`, border: `1px solid ${isCropping ? '#f59e0b' : selected || multiSelected ? '#fff' : color}`, borderRadius: 3, overflow: 'hidden', cursor: isCropping ? 'default' : 'grab', userSelect: 'none', boxSizing: 'border-box', outline: undefined, boxShadow: collabHolder ? `0 0 0 2px ${collabHolder.color}${collabHolder.editing ? '' : '99'}` : undefined }}
        onMouseDown={onMouseDownBody}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onDoubleClick={e => { e.stopPropagation(); isAudioClip(clip) ? onSettings?.() : onDoubleClick() }}
        onContextMenu={e => {
          e.preventDefault(); e.stopPropagation()
          const rect = clipDivRef.current?.getBoundingClientRect()
          const beat = rect ? clip.startBeat + (e.clientX - rect.left) / beatW : clip.startBeat
          setCtxPos({ x: e.clientX, y: e.clientY, beat })
        }}
      >
        {/* Collaborator holding this clip */}
        {collabHolder && (
          <div style={{
            position: 'absolute', top: 2, right: 2, zIndex: 6, pointerEvents: 'none',
            fontSize: 8, fontWeight: 700, lineHeight: 1, padding: '2px 4px', borderRadius: 3,
            background: collabHolder.color, color: '#fff', maxWidth: '60%',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {collabHolder.editing ? '✎ ' : ''}{collabHolder.name}
          </div>
        )}
        {/* Waveform / MIDI notes */}
        {isAudioClip(clip) && clip.waveformPeaks && clip.waveformPeaks.length > 0 && (() => {
          const loopPx = loopNativeBeats ? Math.max(4, loopNativeBeats * beatW) : null
          return (
            <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', opacity: 0.7 }}>
              {loopPx ? (
                Array.from({ length: Math.ceil(width / loopPx) + 1 }, (_, i) => (
                  <div key={i} style={{ position: 'absolute', left: i * loopPx, top: 0, bottom: 0, width: loopPx }}>
                    {i > 0 && (
                      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 1, background: 'rgba(255,255,255,0.3)', zIndex: 1 }} />
                    )}
                    <Waveform peaks={clip.waveformPeaks!} color={color} width={loopPx} height={56} verticalZoom={waveformZoom} />
                  </div>
                ))
              ) : bufDur && bufDur > 0 ? (() => {
                // Render at the waveform's natural pixel width so shortening the clip
                // clips the waveform on the right rather than compressing it.
                const naturalWidth = (bufDur / secPerBeat) * beatW
                const offsetPx = (trimS / secPerBeat) * beatW
                return (
                  <div style={{ position: 'absolute', top: 0, left: -offsetPx, width: naturalWidth, bottom: 0 }}>
                    <Waveform peaks={clip.waveformPeaks!} color={color} width={naturalWidth} height={56} verticalZoom={waveformZoom} />
                  </div>
                )
              })() : (
                <Waveform peaks={clip.waveformPeaks} color={color} width={width} height={56} verticalZoom={waveformZoom} />
              )}
            </div>
          )
        })()}
        {isMidiClip(clip) && clip.notes.length > 0 && (() => {
          // Looped clips tile the pattern with a boundary line per repetition,
          // mirroring the looped-waveform rendering above.
          const loopPx = loopNativeBeats ? Math.max(4, loopNativeBeats * beatW) : null
          const tileW = loopPx ?? width
          const patternBeats = loopNativeBeats ?? clip.durationBeats
          const tiles = loopPx ? Math.ceil(width / loopPx) : 1
          return (
            <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
              {Array.from({ length: tiles }, (_, i) => (
                <div key={i} style={{ position: 'absolute', left: i * tileW, top: 0, bottom: 0, width: tileW }}>
                  {i > 0 && (
                    <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 1, background: 'rgba(255,255,255,0.3)', zIndex: 1 }} />
                  )}
                  {clip.notes.map(n => {
                    const nx = (n.startBeat / patternBeats) * tileW
                    const nw = Math.max(2, (n.durationBeats / patternBeats) * tileW)
                    const ny = ((127 - n.pitch) / 127) * 52
                    return <div key={n.id} style={{ position: 'absolute', left: nx, top: ny + 2, width: nw, height: 2, background: color, borderRadius: 1 }} />
                  })}
                </div>
              ))}
            </div>
          )
        })()}

        {/* Fade-in gradient overlay */}
        {fadeInPx > 0 && (
          <div style={{
            position: 'absolute', top: 0, left: 0, bottom: 0,
            width: fadeInPx,
            background: 'linear-gradient(to right, rgba(0,0,0,0.55), transparent)',
            pointerEvents: 'none',
            zIndex: 3,
          }} />
        )}
        {/* Fade-out gradient overlay */}
        {fadeOutPx > 0 && (
          <div style={{
            position: 'absolute', top: 0, right: 0, bottom: 0,
            width: fadeOutPx,
            background: 'linear-gradient(to left, rgba(0,0,0,0.55), transparent)',
            pointerEvents: 'none',
            zIndex: 3,
          }} />
        )}

        {/* Gain handle — audio clips only; visible on hover or while dragging */}
        {isAudioClip(clip) && gainBarVisible && (
          <>
            {/* Horizontal line */}
            <div
              onMouseDown={onMouseDownGainHandle}
              title={gainToDb(currentGain)}
              style={{
                position: 'absolute',
                top: `${gainFrac * 100}%`,
                left: 0,
                right: 0,
                height: 3,
                transform: 'translateY(-50%)',
                cursor: 'ns-resize',
                zIndex: 6,
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <div style={{
                position: 'absolute',
                inset: '1px 0',
                background: gainDragInfo !== null ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.45)',
                transition: 'background 0.1s',
              }} />
            </div>
            {/* Circle handle */}
            <div
              onMouseDown={onMouseDownGainHandle}
              style={{
                position: 'absolute',
                top: `${gainFrac * 100}%`,
                left: '50%',
                transform: 'translate(-50%, -50%)',
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: gainDragInfo !== null ? '#fff' : 'rgba(255,255,255,0.7)',
                border: '1px solid rgba(0,0,0,0.4)',
                cursor: 'ns-resize',
                zIndex: 7,
                pointerEvents: 'auto',
              }}
            />
          </>
        )}

        {/* Trimmed region overlays — only visible in crop mode */}
        {isCropping && bufDur && inFrac > 0.001 && (
          <div style={{ position: 'absolute', left: 0, width: inPx, top: 0, bottom: 0, background: 'rgba(0,0,0,0.55)', zIndex: 4, pointerEvents: 'none' }} />
        )}
        {isCropping && bufDur && outFrac < 0.999 && (
          <div style={{ position: 'absolute', left: outPx, right: 0, top: 0, bottom: 0, background: 'rgba(0,0,0,0.55)', zIndex: 4, pointerEvents: 'none' }} />
        )}

        {/* Crop handles — visible in crop mode */}
        {isCropping && bufDur && (
          <>
            {/* IN handle */}
            <div
              onMouseDown={e => onMouseDownCropHandle(e, 'in')}
              style={{ position: 'absolute', left: Math.max(0, inPx - 2), top: 0, bottom: 0, width: 5, background: '#f59e0b', cursor: 'ew-resize', zIndex: 6 }}
            >
              <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 10, background: '#f59e0b', borderRadius: '0 0 3px 3px' }} />
            </div>
            {/* OUT handle */}
            <div
              onMouseDown={e => onMouseDownCropHandle(e, 'out')}
              style={{ position: 'absolute', left: Math.min(width - 5, outPx - 3), top: 0, bottom: 0, width: 5, background: '#f59e0b', cursor: 'ew-resize', zIndex: 6 }}
            >
              <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 10, background: '#f59e0b', borderRadius: '0 0 3px 3px' }} />
            </div>
          </>
        )}

        {/* Fade-in handle — top-left corner triangle, always visible on audio clips */}
        {isAudioClip(clip) && (
          <div
            onMouseDown={onMouseDownFadeIn}
            title={`Fade In: ${audioClip?.fadeIn?.toFixed(2) ?? 0}s — drag right to increase`}
            style={{
              position: 'absolute', top: 0, left: 0,
              width: 10, height: 10,
              background: 'rgba(255,255,255,0.45)',
              clipPath: 'polygon(0 0, 100% 0, 0 100%)',
              cursor: 'ew-resize',
              zIndex: 8,
            }}
          />
        )}
        {/* Fade-out handle — top-right corner triangle, always visible on audio clips */}
        {isAudioClip(clip) && (
          <div
            onMouseDown={onMouseDownFadeOut}
            title={`Fade Out: ${audioClip?.fadeOut?.toFixed(2) ?? 0}s — drag left to increase`}
            style={{
              position: 'absolute', top: 0, right: 0,
              width: 10, height: 10,
              background: 'rgba(255,255,255,0.45)',
              clipPath: 'polygon(0 0, 100% 0, 100% 100%)',
              cursor: 'ew-resize',
              zIndex: 8,
            }}
          />
        )}

        {/* Clip label */}
        <div style={{ position: 'absolute', top: 2, left: 12, right: 12, fontSize: 9, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', pointerEvents: 'none', zIndex: 5 }}>
          {clip.name}
          {isAudioClip(clip) && clip.loopEnabled && <span style={{ marginLeft: 4, opacity: 0.7 }}>↻</span>}
          {isAudioClip(clip) && clip.boomerang && <span style={{ marginLeft: 4, opacity: 0.7 }}>⇄</span>}
        </div>

        {/* Quick actions — visible on the selected clip so the context-menu tools are discoverable */}
        {selected && !isCropping && width > 110 && (
          <div
            onMouseDown={e => e.stopPropagation()}
            onDoubleClick={e => e.stopPropagation()}
            onContextMenu={e => e.stopPropagation()}
            style={{
              position: 'absolute', top: 1, right: 8, zIndex: 9,
              display: 'flex', gap: 1, alignItems: 'center',
              background: 'rgba(0,0,0,0.6)', borderRadius: 3, padding: '0 2px',
            }}
          >
            {(isAudioClip(clip)
              ? [
                  { glyph: '⚙', label: 'Clip Settings', fn: () => onSettings?.() },
                  { glyph: '⌗', label: 'Crop', fn: () => onCrop() },
                  { glyph: '◎', label: 'Isolate on Playhead', fn: () => onIsolate(clip.startBeat) },
                  { glyph: '⇄', label: 'Replace Sample', fn: () => onReplaceSample?.() },
                  { glyph: '▦', label: 'Spectral Editor', fn: () => onSpectral?.() },
                ]
              : [
                  { glyph: '🎹', label: 'Open Piano Roll', fn: () => onDoubleClick() },
                ]
            ).map(a => (
              <button
                key={a.label}
                title={a.label}
                data-help-id={a.label === 'Spectral Editor' ? 'spectral' : undefined}
                onClick={e => { e.stopPropagation(); a.fn() }}
                style={{
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  color: '#ddd', fontSize: 10, lineHeight: 1, padding: '2px 3px',
                }}
                onMouseEnter={e => { e.currentTarget.style.color = '#fff' }}
                onMouseLeave={e => { e.currentTarget.style.color = '#ddd' }}
              >{a.glyph}</button>
            ))}
          </div>
        )}

        <div onMouseDown={onMouseDownResize} style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 6, cursor: 'ew-resize', zIndex: 7 }} />
      </div>

      {/* Gain drag tooltip — fixed positioning escapes overflow:hidden */}
      {gainDragInfo !== null && (
        <div style={{
          position: 'fixed',
          left: gainDragInfo.mouseX + 14,
          top: gainDragInfo.mouseY - 18,
          zIndex: 9999,
          background: 'rgba(0,0,0,0.85)',
          color: '#fff',
          fontSize: 10,
          padding: '2px 7px',
          borderRadius: 3,
          pointerEvents: 'none',
          fontFamily: 'monospace',
          whiteSpace: 'nowrap',
          letterSpacing: '0.04em',
        }}>
          {gainToDb(gainDragInfo.gain)}
        </div>
      )}

      {ctxPos && (
        <div ref={menuRef} style={{ position: 'fixed', zIndex: 1000, left: ctxPos.x, top: ctxPos.y, background: '#2a2a2a', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 0', minWidth: 160, boxShadow: '0 4px 20px rgba(0,0,0,0.5)' }}>
          {menuItems.map(it => (
            <button key={it.label} onClick={() => { it.fn(); setCtxPos(null) }}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '5px 12px', fontSize: 11, cursor: 'pointer', background: 'transparent', border: 'none', color: 'var(--text-primary)' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
            >{it.label}</button>
          ))}
        </div>
      )}

      {/* Split at transients dialog */}
      {transientDialog && typeof document !== 'undefined' && createPortal(
        <div
className="electron-nodrag"
style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.65)' }}
          onClick={e => { if (e.target === e.currentTarget) setTransientDialog(null) }}
        >
          <div style={{
            background: '#1e1e1e', border: '1px solid var(--border)', borderRadius: 8,
            padding: '20px 22px', width: 340, maxWidth: '90vw',
            boxShadow: '0 12px 40px rgba(0,0,0,0.7)',
          }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 10 }}>Split at Transients</div>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 14, lineHeight: 1.5 }}>
              {transientDialog.transients.length === 0
                ? 'No transients detected at this sensitivity.'
                : `Detected ${transientDialog.transients.length} split point${transientDialog.transients.length !== 1 ? 's' : ''}. Proceed?`}
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18 }}>
              <span style={{ fontSize: 10, color: 'var(--text-muted)', flexShrink: 0 }}>Sensitivity</span>
              <input
                type="range" min={0.5} max={5.0} step={0.1}
                value={transientDialog.sensitivity}
                onChange={e => {
                  const sens = parseFloat(e.target.value)
                  const ac = clip as AudioClip
                  const newTransients = detectTransients(transientDialog.buf, ac.startBeat, project.tempo, sens, ac.trimStart ?? 0)
                    .filter(b => b > ac.startBeat + 0.01 && b < ac.startBeat + ac.durationBeats - 0.01)
                  setTransientDialog(d => d ? { ...d, sensitivity: sens, transients: newTransients } : null)
                }}
                className="cf-slider"
                style={{ flex: 1, accentColor: 'var(--accent)' }}
              />
              <span style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'monospace', minWidth: 28, textAlign: 'right' }}>
                {transientDialog.sensitivity.toFixed(1)}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                disabled={transientDialog.transients.length === 0}
                onClick={applyTransientSplit}
                style={{
                  flex: 1, padding: '7px 0', borderRadius: 4, border: 'none',
                  background: transientDialog.transients.length === 0 ? '#333' : 'var(--accent)',
                  color: transientDialog.transients.length === 0 ? '#555' : '#fff',
                  fontSize: 12, fontWeight: 600,
                  cursor: transientDialog.transients.length === 0 ? 'not-allowed' : 'pointer',
                }}
              >
                Proceed ({transientDialog.transients.length} cuts)
              </button>
              <button
                onClick={() => setTransientDialog(null)}
                style={{ padding: '7px 14px', borderRadius: 4, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer' }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
