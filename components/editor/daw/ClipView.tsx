'use client'

import { useState, useRef } from 'react'
import type { DawTrack, DawClip } from '@/lib/daw-types'
import { isAudioClip, isMidiClip } from '@/lib/daw-types'
import Waveform from './Waveform'

export default function ClipView({ clip, track, beatW, selected, multiSelected, onSelect, onShiftSelect, onDoubleClick, onMove, onResize, onCrop, onIsolate, onDelete }: {
  clip: DawClip; track: DawTrack; beatW: number; selected: boolean; multiSelected: boolean
  onSelect(): void; onShiftSelect(): void; onDoubleClick(): void
  onMove(startBeat: number, trackId: string, altKey: boolean): void
  onResize(durationBeats: number, altKey: boolean): void
  onCrop(): void; onIsolate(beat: number): void; onDelete(): void
}) {
  const clipDivRef = useRef<HTMLDivElement>(null)
  const dragRef    = useRef<{ startX: number; startBeat: number } | null>(null)
  const resizeRef  = useRef<{ startX: number; startDur: number } | null>(null)
  const [ctxPos, setCtxPos] = useState<{ x: number; y: number; beat: number } | null>(null)

  const left  = clip.startBeat * beatW
  const width = Math.max(8, clip.durationBeats * beatW)
  const color = track.color

  function onMouseDownBody(e: React.MouseEvent) {
    if (e.button !== 0) return
    e.stopPropagation()
    if (e.shiftKey) { onShiftSelect() } else { onSelect() }
    dragRef.current = { startX: e.clientX, startBeat: clip.startBeat }
    function mm(ev: MouseEvent) {
      if (!dragRef.current) return
      const div = clipDivRef.current
      if (div) div.style.pointerEvents = 'none'
      const el = document.elementFromPoint(ev.clientX, ev.clientY)
      if (div) div.style.pointerEvents = ''
      const targetTrackId = el?.closest('[data-track-id]')?.getAttribute('data-track-id') ?? track.id
      onMove(Math.max(0, dragRef.current.startBeat + (ev.clientX - dragRef.current.startX) / beatW), targetTrackId, ev.altKey)
    }
    function mu() { dragRef.current = null; document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', mu) }
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

  const menuItems = [
    { label: 'Delete', fn: onDelete },
    ...(isAudioClip(clip) ? [
      { label: 'Crop', fn: onCrop },
      { label: 'Isolate on Playhead', fn: () => onIsolate(ctxPos?.beat ?? clip.startBeat) },
    ] : []),
    { label: 'Open Piano Roll', fn: onDoubleClick },
  ]

  return (
    <>
      <div
        ref={clipDivRef}
        style={{ position: 'absolute', left, width, top: 4, bottom: 4, background: `${color}40`, border: `1px solid ${selected ? '#fff' : multiSelected ? `${color}cc` : color}`, borderRadius: 3, overflow: 'hidden', cursor: 'grab', userSelect: 'none', boxSizing: 'border-box', outline: multiSelected && !selected ? `1px solid #fff6` : undefined }}
        onMouseDown={onMouseDownBody}
        onDoubleClick={onDoubleClick}
        onContextMenu={e => {
          e.preventDefault(); e.stopPropagation()
          const rect = clipDivRef.current?.getBoundingClientRect()
          const beat = rect ? clip.startBeat + (e.clientX - rect.left) / beatW : clip.startBeat
          setCtxPos({ x: e.clientX, y: e.clientY, beat })
        }}
      >
        {isAudioClip(clip) && clip.waveformPeaks && clip.waveformPeaks.length > 0 && (
          <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', opacity: 0.7 }}>
            <Waveform peaks={clip.waveformPeaks} color={color} width={width} height={56} />
          </div>
        )}
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
        <div style={{ position: 'absolute', top: 2, left: 4, right: 8, fontSize: 9, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', pointerEvents: 'none' }}>
          {clip.name}
          {isAudioClip(clip) && clip.loopEnabled && <span style={{ marginLeft: 4, opacity: 0.7 }}>↻</span>}
        </div>
        <div onMouseDown={onMouseDownResize} style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 6, cursor: 'ew-resize' }} />
      </div>

      {ctxPos && (
        <div style={{ position: 'fixed', zIndex: 1000, left: ctxPos.x, top: ctxPos.y, background: '#2a2a2a', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 0', minWidth: 140, boxShadow: '0 4px 20px rgba(0,0,0,0.5)' }} onMouseLeave={() => setCtxPos(null)}>
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
