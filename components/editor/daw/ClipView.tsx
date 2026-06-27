'use client'

import { useState, useRef, useEffect } from 'react'
import type { DawTrack, DawClip } from '@/lib/daw-types'
import { isAudioClip, isMidiClip } from '@/lib/daw-types'
import Waveform from './Waveform'

export default function ClipView({ clip, track, beatW, selected, multiSelected, loopNativeBeats, isCropping, onSelect, onShiftSelect, onDoubleClick, onSettings, onMove, onResize, onCrop, onCropChange, onCropSnap, onIsolate, onSplice, onDelete, onDragStart, onDeleteAll, onReplaceSample, onScrollBy }: {
  clip: DawClip; track: DawTrack; beatW: number; selected: boolean; multiSelected: boolean
  loopNativeBeats?: number
  isCropping?: boolean
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
  onScrollBy?(delta: number): void
}) {
  const clipDivRef = useRef<HTMLDivElement>(null)
  const menuRef    = useRef<HTMLDivElement>(null)
  const dragRef    = useRef<{ startX: number; startBeat: number } | null>(null)
  const resizeRef  = useRef<{ startX: number; startDur: number } | null>(null)
  const [ctxPos, setCtxPos] = useState<{ x: number; y: number; beat: number } | null>(null)

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
      // Fraction of buffer moved
      const dFrac = dx / width

      if (side === 'in') {
        // New IN position in buffer seconds
        const rawSec = startInSec + dFrac * bufDur
        let newTrimStart = rawSec

        // Snap to grid if snapper provided
        if (onCropSnap && clip.durationBeats > 0) {
          const arrangBeat = clip.startBeat + (rawSec / bufDur) * clip.durationBeats
          const snapped    = onCropSnap(arrangBeat)
          newTrimStart     = ((snapped - clip.startBeat) / clip.durationBeats) * bufDur
        }
        newTrimStart = Math.max(0, Math.min(bufDur - clip.trimEnd - 0.001, newTrimStart))
        onCropChange(newTrimStart, clip.trimEnd)
      } else {
        // New OUT position in buffer seconds (from buffer start)
        const outSec    = bufDur - startOutSec
        const rawOutSec = outSec + dFrac * bufDur
        let newTrimEnd  = bufDur - rawOutSec

        // Snap to grid
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

  const isMulti = multiSelected && !!onDeleteAll
  const menuItems = [
    isMulti
      ? { label: 'Delete Selected', fn: () => onDeleteAll!() }
      : { label: 'Delete', fn: onDelete },
    { label: 'Splice at Playhead', fn: () => onSplice?.() },
    ...(isAudioClip(clip) ? [
      { label: 'Clip Settings', fn: () => onSettings?.() },
      { label: isCropping ? 'Exit Crop' : 'Crop', fn: onCrop },
      { label: 'Isolate on Playhead', fn: () => onIsolate(ctxPos?.beat ?? clip.startBeat) },
      { label: isMulti ? 'Replace Sample (All Selected)' : 'Replace Sample', fn: () => onReplaceSample?.() },
    ] : [
      { label: 'Open Piano Roll', fn: onDoubleClick },
    ]),
  ]

  return (
    <>
      <div
        ref={clipDivRef}
        style={{ position: 'absolute', left, width, top: 4, bottom: 4, background: `${color}40`, border: `1px solid ${isCropping ? '#f59e0b' : selected ? '#fff' : multiSelected ? `${color}cc` : color}`, borderRadius: 3, overflow: 'hidden', cursor: isCropping ? 'default' : 'grab', userSelect: 'none', boxSizing: 'border-box', outline: multiSelected && !selected ? `1px solid #fff6` : undefined }}
        onMouseDown={onMouseDownBody}
        onDoubleClick={e => { e.stopPropagation(); isAudioClip(clip) ? onSettings?.() : onDoubleClick() }}
        onContextMenu={e => {
          e.preventDefault(); e.stopPropagation()
          const rect = clipDivRef.current?.getBoundingClientRect()
          const beat = rect ? clip.startBeat + (e.clientX - rect.left) / beatW : clip.startBeat
          setCtxPos({ x: e.clientX, y: e.clientY, beat })
        }}
      >
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
                    <Waveform peaks={clip.waveformPeaks!} color={color} width={loopPx} height={56} />
                  </div>
                ))
              ) : (
                <Waveform peaks={clip.waveformPeaks} color={color} width={width} height={56} />
              )}
            </div>
          )
        })()}
        {isMidiClip(clip) && clip.notes.length > 0 && (
          <div style={{ position: 'absolute', inset: 0 }}>
            {clip.notes.map(n => {
              const nx = (n.startBeat / clip.durationBeats) * width
              const nw = Math.max(2, (n.durationBeats / clip.durationBeats) * width)
              const ny = ((127 - n.pitch) / 127) * 52
              return <div key={n.id} style={{ position: 'absolute', left: nx, top: ny + 2, width: nw, height: 2, background: color, borderRadius: 1 }} />
            })}
          </div>
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

        {/* Clip label */}
        <div style={{ position: 'absolute', top: 2, left: 4, right: 8, fontSize: 9, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', pointerEvents: 'none', zIndex: 5 }}>
          {clip.name}
          {isAudioClip(clip) && clip.loopEnabled && <span style={{ marginLeft: 4, opacity: 0.7 }}>↻</span>}
        </div>

        <div onMouseDown={onMouseDownResize} style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 6, cursor: 'ew-resize', zIndex: 7 }} />
      </div>

      {ctxPos && (
        <div ref={menuRef} style={{ position: 'fixed', zIndex: 1000, left: ctxPos.x, top: ctxPos.y, background: '#2a2a2a', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 0', minWidth: 140, boxShadow: '0 4px 20px rgba(0,0,0,0.5)' }}>
          {menuItems.map(it => (
            <button key={it.label} onClick={() => { it.fn(); setCtxPos(null) }}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '5px 12px', fontSize: 11, cursor: 'pointer', background: 'transparent', border: 'none', color: 'var(--text-primary)' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
            >{it.label}</button>
          ))}
        </div>
      )}
    </>
  )
}
