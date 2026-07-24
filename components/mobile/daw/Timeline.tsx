'use client'

// Arrangement/Song view — the horizontal timeline. Tracks are rows; clips are
// blocks placed by beat. Tap a clip to edit it, tap an empty lane to drop a new
// 1-bar clip there, drag a clip to move it. A playhead tracks the transport.

import { useRef } from 'react'
import type { MobileDaw } from './engine-hook'
import { makeMidiClip } from '@/lib/daw-state'
import { isMidiClip, type DawClip, type DawTrack } from '@/lib/daw-types'

const PX = 20                 // pixels per beat
const ROW_H = 54
const HEAD_W = 92
const RULER_H = 22

export function Timeline({ daw, onEditClip }: { daw: MobileDaw; onEditClip: (clipId: string) => void }) {
  const { project, dispatch } = daw
  const tracks = project.tracks.filter(t => t.kind !== 'group')
  const clipEnd = Math.max(16, ...project.arrangementClips.map(c => c.startBeat + c.durationBeats), (daw.position || 0) + 4)
  const bars = Math.ceil(clipEnd / 4) + 1
  const totalBeats = bars * 4
  const width = totalBeats * PX

  const addClipAt = (track: DawTrack, beat: number) => {
    const startBeat = Math.max(0, Math.floor(beat / 4) * 4)
    const isDrum = track.instrument?.type === 'drum'
    const clip = makeMidiClip(track.id, isDrum ? 'Beat' : 'Notes', startBeat, 4, { isDrumClip: isDrum })
    dispatch({ type: 'ADD_CLIP', clip })
    onEditClip(clip.id)
  }

  return (
    <div style={{ height: '100%', overflowY: 'auto' }}>
      <div style={{ display: 'flex', minHeight: '100%' }}>
        {/* Track headers (fixed left) */}
        <div style={{ width: HEAD_W, flexShrink: 0, borderRight: '1px solid var(--border)' }}>
          <div style={{ height: RULER_H, borderBottom: '1px solid var(--border)' }} />
          {tracks.map(t => (
            <div key={t.id} style={{ height: ROW_H, display: 'flex', alignItems: 'center', gap: 6, padding: '0 8px', borderBottom: '1px solid var(--border)' }}>
              <button onClick={() => dispatch({ type: 'UPDATE_TRACK', trackId: t.id, patch: { mute: !t.mute } })} aria-label={`${t.name} mute`} style={{ width: 7, height: 30, borderRadius: 3, border: 'none', padding: 0, cursor: 'pointer', background: t.mute ? 'var(--border)' : t.color, flexShrink: 0 }} />
              <span style={{ fontSize: 11.5, fontWeight: 700, color: t.mute ? 'var(--text-muted)' : 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span>
            </div>
          ))}
        </div>

        {/* Lanes (horizontal scroll) */}
        <div style={{ flex: 1, overflowX: 'auto' }}>
          <div style={{ width, position: 'relative' }}>
            {/* Bar ruler */}
            <div style={{ height: RULER_H, position: 'relative', borderBottom: '1px solid var(--border)' }}>
              {Array.from({ length: bars }, (_, b) => (
                <span key={b} style={{ position: 'absolute', left: b * 4 * PX + 3, top: 4, fontSize: 9, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>{b + 1}</span>
              ))}
            </div>

            {/* Track lanes */}
            {tracks.map(t => (
              <Lane key={t.id} track={t} clips={project.arrangementClips.filter(c => c.trackId === t.id)} onEditClip={onEditClip} onAdd={beat => addClipAt(t, beat)} onMove={(clipId, startBeat) => dispatch({ type: 'MOVE_CLIP', clipId, startBeat })} />
            ))}

            {/* Bar grid lines overlay */}
            <div aria-hidden style={{ position: 'absolute', top: RULER_H, left: 0, right: 0, bottom: 0, pointerEvents: 'none' }}>
              {Array.from({ length: bars + 1 }, (_, b) => (
                <div key={b} style={{ position: 'absolute', left: b * 4 * PX, top: 0, bottom: 0, width: 1, background: 'var(--border)', opacity: 0.5 }} />
              ))}
            </div>

            {/* Playhead */}
            <div aria-hidden style={{ position: 'absolute', top: RULER_H, left: daw.position * PX, width: 2, height: tracks.length * ROW_H, background: '#fff', boxShadow: '0 0 4px rgba(255,255,255,0.6)', pointerEvents: 'none' }} />
          </div>
        </div>
      </div>
    </div>
  )
}

function Lane({ track, clips, onEditClip, onAdd, onMove }: {
  track: DawTrack
  clips: DawClip[]
  onEditClip: (clipId: string) => void
  onAdd: (beat: number) => void
  onMove: (clipId: string, startBeat: number) => void
}) {
  const laneRef = useRef<HTMLDivElement | null>(null)
  const drag = useRef<{ id: string; startX: number; origBeat: number; moved: boolean } | null>(null)

  const onLaneClick = (e: React.MouseEvent) => {
    if (drag.current?.moved) return
    const r = laneRef.current?.getBoundingClientRect()
    if (!r) return
    onAdd((e.clientX - r.left) / PX)
  }

  return (
    <div ref={laneRef} onClick={onLaneClick} style={{ height: ROW_H, position: 'relative', borderBottom: '1px solid var(--border)' }}>
      {clips.map(c => {
        const notes = isMidiClip(c) ? c.notes : []
        const lo = notes.length ? Math.min(...notes.map(n => n.pitch)) : 0
        const hi = notes.length ? Math.max(...notes.map(n => n.pitch)) : 1
        const span = Math.max(1, hi - lo)
        return (
          <div
            key={c.id}
            onClick={e => { e.stopPropagation(); if (!drag.current?.moved) onEditClip(c.id) }}
            onPointerDown={e => { drag.current = { id: c.id, startX: e.clientX, origBeat: c.startBeat, moved: false }; (e.target as HTMLElement).setPointerCapture?.(e.pointerId) }}
            onPointerMove={e => {
              const d = drag.current
              if (!d || d.id !== c.id) return
              const dx = e.clientX - d.startX
              if (Math.abs(dx) > 4) d.moved = true
              if (d.moved) onMove(c.id, Math.max(0, Math.round((d.origBeat + dx / PX) * 4) / 4))
            }}
            onPointerUp={() => { window.setTimeout(() => { drag.current = null }, 0) }}
            style={{
              position: 'absolute', left: c.startBeat * PX, top: 5, width: Math.max(12, c.durationBeats * PX - 2), height: ROW_H - 12,
              borderRadius: 6, background: `${track.color}30`, border: `1px solid ${track.color}`, cursor: 'grab',
              overflow: 'hidden', touchAction: 'pan-y',
            }}
          >
            <div style={{ fontSize: 8.5, fontWeight: 700, color: track.color, padding: '2px 5px', whiteSpace: 'nowrap' }}>{c.name}</div>
            {/* note dots preview */}
            <div style={{ position: 'absolute', inset: '14px 3px 3px 3px' }}>
              {notes.slice(0, 64).map(n => (
                <span key={n.id} style={{ position: 'absolute', left: `${(n.startBeat / c.durationBeats) * 100}%`, top: `${(1 - (n.pitch - lo) / span) * 100}%`, width: 3, height: 3, borderRadius: 1, background: track.color }} />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
