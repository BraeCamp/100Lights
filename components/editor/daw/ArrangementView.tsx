'use client'

import { useState, useRef, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { ZoomIn, ZoomOut, Maximize2, Scissors, Blend, ChevronDown, Music, Grid3x3, X, Cloud, HardDrive, Folder, Check, MessageSquare, RectangleHorizontal, MoreHorizontal, Download } from 'lucide-react'
import { useDaw, makeMidiClip, makeAudioClip } from '@/lib/daw-state'
import { highlightHelpTargets } from './HelpButton'
import { isMidiClip, isAudioClip, TRACK_COLORS, clipLockedBy } from '@/lib/daw-types'
import type { ReturnTrack, AudioClip, DawClip, MidiClip } from '@/lib/daw-types'
import { RollSoundPanel } from './RollSettings'
import { DEFAULT_KIT } from '@/lib/drum-presets'
import { getPresets } from '@/lib/midi-presets'

// Module-level clipboards — persist across renders in the same session
interface ClipboardEntry { clips: DawClip[]; originBeat: number; regionSpan?: number | null; buffers: [string, AudioBuffer][] }
let _clipboard: ClipboardEntry | null = null
let _effectClipboard: import('@/lib/daw-types').ClipEffect[] | null = null
let _lastCopied: 'clips' | 'effects' | null = null
import { runSpectralMorph } from '@/lib/spectral-morph'
import TrackRow, { HDR_W, SnapMode, snapBeat } from './TrackRow'
import { useUITierOptional } from '../UITierProvider'
import ProjectSwitcher from '../ProjectSwitcher'
import { tempoSegments, meterSegments, secondsToBeat, beatToSeconds, barLines, nearestBarBeat, clampBpm } from '@/lib/tempo-map'
import { useIsMobile } from '@/lib/use-is-mobile'
import { CommentComposer, CommentThread } from './TimelineComments'
import VersionHistory from './VersionHistory'
import { detectTransients } from './ClipView'
import dynamic from 'next/dynamic'

const AudioExportModal = dynamic(() => import('./AudioExportModal'), { ssr: false })

const SEC_H   = 24
const BAR_H   = 20
const RULER_H = SEC_H + BAR_H
const MIN_BEAT_W = 10
const MAX_BEAT_W = 200
// Zoom-per-wheel sensitivity. Multiplicative (constant %) so it feels the same at
// any zoom level, but scaled by the ACTUAL scroll amount so a trackpad's many tiny
// events don't compound into a 10× jump. A mouse notch (deltaY≈100) ≈ 13% step;
// each event is clamped to ±43% so one flick can't leap across the whole range.
const ZOOM_SENS = 0.0013
// A small empty lead-in before beat 0. Because every coordinate is `beat*beatW -
// scrollLeft`, letting the leftmost scroll sit at -START_GUTTER pushes beat 0 a
// few px in from the edge — and the Math.max(0, …) clamps on ruler/lane clicks
// make that whole gutter land the playhead exactly on 0, so 0 is easy to hit.
const START_GUTTER = 14
const MIN_SCROLL = -START_GUTTER

// ── Ruler ─────────────────────────────────────────────────────────────────────

function Ruler({ beatW, scrollLeft, onSeek, onEditTimeSig, onOpenComment, snap }: {
  beatW: number; scrollLeft: number; snap: SnapMode
  onSeek: (beat: number) => void
  onEditTimeSig: (e: React.MouseEvent, beat: number) => void
  onOpenComment: (commentId: string, x: number, y: number) => void
}) {
  const canvasRef    = useRef<HTMLCanvasElement>(null)
  const loopDragRef  = useRef<{ type: 'start'|'end'|'move'; startX: number; startLoopStart: number; startLoopEnd: number } | null>(null)
  const [loopCursor, setLoopCursor] = useState('grab')
  const [renamingSection, setRenamingSection] = useState<string | null>(null)
  const { project, dispatch } = useDaw()
  const { tempo, timeSignatureNum: sigNum, timeSignatureDen: sigDen, loopStart, loopEnd, loopEnabled, cueMarkers = [], tempoMarkers = [], meterMarkers = [], sections = [], comments = [] } = project
  const pxPerSec = beatW * tempo / 60
  // Tempo + meter maps drive the seconds lane (non-linear once tempo changes) and
  // the bar grid (irregular bar widths once meter changes). Marker-free → uniform.
  const tSegs = useMemo(() => tempoSegments(project), [project.tempo, project.tempoMarkers])
  const mSegs = useMemo(() => meterSegments(project), [project.timeSignatureNum, project.timeSignatureDen, project.meterMarkers])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    const W   = canvas.offsetWidth
    canvas.width  = W * dpr
    canvas.height = RULER_H * dpr
    const ctx = canvas.getContext('2d')!
    ctx.scale(dpr, dpr)

    ctx.fillStyle = '#161616'
    ctx.fillRect(0, 0, W, RULER_H)
    ctx.fillStyle = '#252525'
    ctx.fillRect(0, SEC_H, W, 1)

    // Seconds lane: x is beat-space, so each time-tick sits at the BEAT it maps to
    // through the tempo map (linear only when tempo is constant). Visible time span
    // comes from the visible beat span via the map.
    const visBeat0 = scrollLeft / beatW
    const visBeat1 = (scrollLeft + W) / beatW
    const startTime = beatToSeconds(Math.max(0, visBeat0), tSegs)
    const endTime   = beatToSeconds(Math.max(0, visBeat1), tSegs)
    const xAtTime   = (t: number) => Math.round(secondsToBeat(t, tSegs) * beatW - scrollLeft)
    const INTERVALS = [0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60]
    const secInterval  = INTERVALS.find(iv => iv * pxPerSec >= 70) ?? 60
    const halfInterval = secInterval / 2

    const firstHalfIdx = Math.floor(startTime / halfInterval)
    for (let i = firstHalfIdx; i * halfInterval <= endTime + halfInterval; i++) {
      if (i % 2 === 0) continue
      const x = xAtTime(i * halfInterval)
      if (x < 0 || x > W) continue
      ctx.fillStyle = '#2d2d2d'
      ctx.fillRect(x, SEC_H - 5, 1, 5)
    }

    const firstMajorIdx = Math.floor(startTime / secInterval)
    for (let i = firstMajorIdx; i * secInterval <= endTime + secInterval; i++) {
      const t = i * secInterval
      const x = xAtTime(t)
      if (x < -30 || x > W + 30) continue
      ctx.fillStyle = '#3d3d3d'
      ctx.fillRect(x, 2, 1, SEC_H - 3)
      const mins = Math.floor(t / 60)
      const secs = Math.floor(t % 60)
      ctx.fillStyle = '#ccc'
      ctx.font = '9px monospace'
      ctx.fillText(`${mins}:${String(secs).padStart(2, '0')}`, x + 3, 11)
    }

    // Bar lane: walk the meter map so bar widths follow time-signature changes.
    if (beatW >= 6) {
      const bars = barLines(mSegs, Math.max(0, visBeat0 - 8), visBeat1 + 8)
      const labelEvery = Math.max(1, Math.ceil(36 / (beatW * (mSegs[0]?.num || sigNum))))
      for (const { beat: barBeat, bar, num } of bars) {
        const x = Math.round(barBeat * beatW - scrollLeft)
        if (x >= -1 && x <= W + 1) {
          ctx.fillStyle = '#3a3a3a'
          ctx.fillRect(x, SEC_H + 1, 1, BAR_H - 1)
        }
        if (beatW >= 24) {
          for (let b = 1; b < num; b++) {
            const bx = Math.round(x + b * beatW)
            if (bx < 0 || bx > W) continue
            ctx.fillStyle = '#252525'
            ctx.fillRect(bx, SEC_H + BAR_H - 6, 1, 6)
          }
        }
        if (bar % labelEvery === 0 && x > -2 && x < W) {
          ctx.fillStyle = '#999'
          ctx.font = '9px monospace'
          ctx.fillText(String(bar + 1), x + 3, SEC_H + BAR_H - 4)
        }
      }
    }

    ctx.fillStyle = '#555'
    ctx.font = '8px monospace'
    ctx.textAlign = 'right'
    ctx.fillText(`${sigNum}/${sigDen} ✎`, W - 4, SEC_H + BAR_H - 4)
    ctx.textAlign = 'left'
  })

  const loopL = loopStart * beatW - scrollLeft
  const loopR = loopEnd   * beatW - scrollLeft

  return (
    <div style={{ position: 'relative', height: RULER_H, overflow: 'hidden', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
      <canvas
        ref={canvasRef}
        style={{ position: 'absolute', inset: 0, width: '100%', height: RULER_H, cursor: 'pointer' }}
        onClick={e => {
          // Clicks anywhere on the ruler — bars row included — move the
          // playhead. Time-signature settings live on right-click now.
          const rect = e.currentTarget.getBoundingClientRect()
          onSeek(Math.max(0, (e.clientX - rect.left + scrollLeft) / beatW))
        }}
        onContextMenu={e => {
          e.preventDefault()
          const rect = e.currentTarget.getBoundingClientRect()
          onEditTimeSig(e, Math.max(0, snapBeat((e.clientX - rect.left + scrollLeft) / beatW, snap, sigNum, mSegs)))
        }}
        onDoubleClick={e => {
          const rect  = e.currentTarget.getBoundingClientRect()
          const localY = e.clientY - rect.top
          if (localY >= SEC_H) return
          const beat = Math.max(0, snapBeat((e.clientX - rect.left + scrollLeft) / beatW, snap, sigNum, mSegs))
          const name = `Cue ${cueMarkers.length + 1}`
          dispatch({ type: 'ADD_CUE_MARKER', marker: { id: `cue-${Date.now()}`, beat, name } })
        }}
      />
      {/* Arranger sections — colored bands between consecutive section starts */}
      {sections.map((s, i) => {
        const from = s.beat * beatW - scrollLeft
        const nextBeat = sections[i + 1]?.beat ?? (s.beat + 64)
        const width = Math.max(10, (nextBeat - s.beat) * beatW)
        if (from + width < 0 || from > 9999) return null
        return (
          <div key={s.id} style={{ position: 'absolute', top: 0, left: from, width, height: 8, background: `${s.color}55`, borderLeft: `2px solid ${s.color}`, zIndex: 1, pointerEvents: 'none' }}>
            {renamingSection === s.id ? (
              <input
                autoFocus
                defaultValue={s.name}
                onFocus={e => e.currentTarget.select()}
                onClick={e => e.stopPropagation()}
                onKeyDown={e => {
                  e.stopPropagation()
                  if (e.key === 'Enter') e.currentTarget.blur()
                  if (e.key === 'Escape') { e.currentTarget.value = s.name; e.currentTarget.blur() }
                }}
                onBlur={e => {
                  const name = e.currentTarget.value.trim()
                  if (name && name !== s.name) dispatch({ type: 'ADD_SECTION', section: { ...s, name } })
                  setRenamingSection(null)
                }}
                style={{ position: 'absolute', top: -2, left: 3, width: 90, fontSize: 9, fontWeight: 700, color: s.color, background: 'var(--bg-base)', border: `1px solid ${s.color}`, borderRadius: 2, padding: '0 3px', outline: 'none', pointerEvents: 'auto', zIndex: 5 }}
              />
            ) : (
              <span
                title={`${s.name} — double-click to rename, right-click to remove`}
                onDoubleClick={e => { e.stopPropagation(); setRenamingSection(s.id) }}
                onContextMenu={e => { e.preventDefault(); e.stopPropagation(); dispatch({ type: 'REMOVE_SECTION', sectionId: s.id }) }}
                style={{ position: 'absolute', top: -1, left: 3, fontSize: 7.5, fontWeight: 800, color: s.color, letterSpacing: '0.05em', whiteSpace: 'nowrap', pointerEvents: 'auto', cursor: 'context-menu' }}
              >{s.name.toUpperCase()}</span>
            )}
          </div>
        )
      })}
      {/* Tempo markers */}
      {(tempoMarkers ?? []).map(m => {
        const mx = m.beat * beatW - scrollLeft
        if (mx < -8 || mx > 9999) return null
        return (
          <div key={m.id} style={{ position: 'absolute', top: 0, left: mx, width: 1, height: RULER_H, background: '#fb923c', zIndex: 2, pointerEvents: 'none' }}>
            <div
              title={`Tempo ${m.tempo} BPM from here — right-click to remove`}
              onContextMenu={e => { e.preventDefault(); e.stopPropagation(); dispatch({ type: 'REMOVE_TEMPO_MARKER', markerId: m.id }) }}
              style={{ position: 'absolute', bottom: 0, left: 0, background: '#fb923c', color: '#241203', fontSize: 8, padding: '0 3px', borderRadius: '0 2px 0 0', whiteSpace: 'nowrap', fontWeight: 800, cursor: 'context-menu', pointerEvents: 'auto' }}
            >
              ♩{m.tempo}
            </div>
          </div>
        )
      })}
      {/* Meter (time-signature) markers */}
      {(meterMarkers ?? []).map(m => {
        const mx = m.beat * beatW - scrollLeft
        if (mx < -8 || mx > 9999) return null
        return (
          <div key={m.id} style={{ position: 'absolute', top: 0, left: mx, width: 1, height: RULER_H, background: '#818cf8', zIndex: 2, pointerEvents: 'none' }}>
            <div
              title={`${m.num}/${m.den} from here — right-click to remove`}
              onContextMenu={e => { e.preventDefault(); e.stopPropagation(); dispatch({ type: 'REMOVE_METER_MARKER', markerId: m.id }) }}
              style={{ position: 'absolute', bottom: 0, left: 0, background: '#818cf8', color: '#0f1033', fontSize: 8, padding: '0 3px', borderRadius: '0 2px 0 0', whiteSpace: 'nowrap', fontWeight: 800, cursor: 'context-menu', pointerEvents: 'auto' }}
            >
              {m.num}/{m.den}
            </div>
          </div>
        )
      })}
      {/* Cue markers */}
      {cueMarkers.map(marker => {
        const mx = marker.beat * beatW - scrollLeft
        if (mx < -8 || mx > 9999) return null
        return (
          <div
            key={marker.id}
            style={{ position: 'absolute', top: 0, left: mx, width: 1, height: RULER_H, background: marker.color ?? '#f59e0b', zIndex: 2, pointerEvents: 'none' }}
          >
            <div
              title={`${marker.name || 'Cue'} — double-click to remove`}
              style={{ position: 'absolute', top: 0, left: 0, background: marker.color ?? '#f59e0b', color: '#000', fontSize: 8, padding: '1px 3px', borderRadius: '0 2px 2px 0', whiteSpace: 'nowrap', fontWeight: 700, maxWidth: 60, overflow: 'hidden', textOverflow: 'ellipsis', cursor: 'pointer', pointerEvents: 'auto' }}
              onContextMenu={e => { e.preventDefault(); e.stopPropagation(); dispatch({ type: 'REMOVE_CUE_MARKER', markerId: marker.id }) }}
              onDoubleClick={e => { e.preventDefault(); e.stopPropagation(); dispatch({ type: 'REMOVE_CUE_MARKER', markerId: marker.id }) }}
            >
              {marker.name || '♦'}
            </div>
          </div>
        )
      })}
      {/* Comment pins */}
      {comments.map(c => {
        const cx = c.beat * beatW - scrollLeft
        if (cx < -12 || cx > 9999) return null
        return (
          <button
            key={c.id}
            title={`${c.author}: ${c.text.slice(0, 60)}`}
            onClick={e => { e.stopPropagation(); onOpenComment(c.id, e.clientX, e.clientY) }}
            onMouseDown={e => e.stopPropagation()}
            style={{
              position: 'absolute', top: SEC_H - 1, left: cx - 7, zIndex: 3,
              width: 14, height: 14, borderRadius: '50% 50% 50% 0', transform: 'rotate(-45deg)',
              background: c.resolved ? 'var(--bg-card-hover)' : '#f59e0b', border: '1px solid rgba(0,0,0,0.5)',
              cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <span style={{ transform: 'rotate(45deg)', fontSize: 7, lineHeight: 1, color: c.resolved ? 'var(--text-muted)' : '#1a1206', fontWeight: 800 }}>{(c.replies?.length ?? 0) + 1}</span>
          </button>
        )
      })}
      {loopEnabled && loopR > loopL && (
        <div
          style={{
            position: 'absolute', top: 0, left: loopL, width: Math.max(4, loopR - loopL), height: SEC_H,
            background: 'rgb(var(--accent-rgb) / 0.18)', boxSizing: 'border-box',
            borderLeft: '2px solid rgb(var(--accent-rgb) / 0.7)', borderRight: '2px solid rgb(var(--accent-rgb) / 0.7)',
            cursor: loopCursor,
          }}
          onMouseMove={e => {
            if (loopDragRef.current) return
            const rect = e.currentTarget.getBoundingClientRect()
            const relX = e.clientX - rect.left
            setLoopCursor(relX < 8 || relX > rect.width - 8 ? 'ew-resize' : 'grab')
          }}
          onMouseLeave={() => { if (!loopDragRef.current) setLoopCursor('grab') }}
          onMouseDown={e => {
            e.stopPropagation()
            if (e.button !== 0) return
            const rect = e.currentTarget.getBoundingClientRect()
            const relX = e.clientX - rect.left
            const type = relX < 8 ? 'start' : relX > rect.width - 8 ? 'end' : 'move'
            loopDragRef.current = { type, startX: e.clientX, startLoopStart: loopStart, startLoopEnd: loopEnd }
            setLoopCursor(type === 'move' ? 'grabbing' : 'ew-resize')
            let dragged = false
            function mm(ev: MouseEvent) {
              if (!loopDragRef.current) return
              if (Math.abs(ev.clientX - loopDragRef.current.startX) > 3) dragged = true
              if (!dragged) return
              const { type: t, startX, startLoopStart: s, startLoopEnd: en } = loopDragRef.current
              const db      = (ev.clientX - startX) / beatW
              const useSnap = ev.altKey ? 'off' as SnapMode : snap
              const dur     = en - s
              let ns = s, ne = en
              if (t === 'start') {
                ns = Math.min(snapBeat(Math.max(0, s + db), useSnap, sigNum), en - 0.25)
              } else if (t === 'end') {
                ne = Math.max(snapBeat(en + db, useSnap, sigNum), s + 0.25)
              } else {
                ns = snapBeat(Math.max(0, s + db), useSnap, sigNum)
                ne = ns + dur
              }
              dispatch({ type: 'SET_LOOP', start: ns, end: ne })
            }
            function mu(ev: MouseEvent) {
              loopDragRef.current = null
              setLoopCursor('grab')
              document.removeEventListener('mousemove', mm)
              document.removeEventListener('mouseup', mu)
              // A plain click inside the loop region moves the playhead —
              // the region itself only moves when actually dragged.
              if (!dragged) {
                // ruler-left = overlay-left minus the overlay's offset in it
                const rulerLeft = rect.left - (loopStart * beatW - scrollLeft)
                onSeek(Math.max(0, (ev.clientX - rulerLeft + scrollLeft) / beatW))
              }
            }
            document.addEventListener('mousemove', mm)
            document.addEventListener('mouseup', mu)
          }}
        />
      )}
    </div>
  )
}

// ── Return Track Row ──────────────────────────────────────────────────────────

function ReturnTrackRow({ rt, idx, dispatch }: { rt: ReturnTrack; idx: number; dispatch: (a: import('@/lib/daw-state').DawAction) => void }) {
  const { setSelectedReturnId, selectedReturnId } = useDaw()
  const label = String.fromCharCode(65 + idx) // A, B, C...
  const fxActive = selectedReturnId === rt.id
  return (
    <div style={{ display: 'flex', height: 36, flexShrink: 0 }}>
      {/* Header */}
      <div style={{
        width: HDR_W, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 4, padding: '0 6px',
        background: 'rgba(100,60,150,0.12)',
        borderRight: '1px solid var(--border)', borderBottom: '1px solid var(--border)',
        borderLeft: `3px solid ${rt.color}`,
        boxSizing: 'border-box',
      }}>
        <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--accent-light)', letterSpacing: '0.05em', flexShrink: 0 }}>{label}</span>
        <span style={{ flex: 1, fontSize: 10, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{rt.name}</span>
        <button
          onClick={() => setSelectedReturnId(fxActive ? null : rt.id)}
          title="Show FX chain"
          style={{ fontSize: 8, padding: '1px 4px', borderRadius: 2, flexShrink: 0, cursor: 'pointer', fontWeight: 700,
            border: `1px solid ${fxActive ? 'var(--accent-light)' : 'var(--border)'}`,
            background: fxActive ? 'rgb(var(--accent-rgb) / 0.18)' : 'var(--bg-surface)',
            color: fxActive ? 'var(--accent-light)' : rt.effects.length > 0 ? 'var(--accent-light)' : 'var(--text-muted)',
          }}
        >{rt.effects.length > 0 ? `FX(${rt.effects.length})` : 'FX'}</button>
        <button
          onClick={() => dispatch({ type: 'REMOVE_RETURN_TRACK', trackId: rt.id })}
          title="Remove return track"
          style={{ fontSize: 10, width: 14, height: 14, borderRadius: 2, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', padding: 0, flexShrink: 0, lineHeight: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
        ><X size={11} /></button>
      </div>
      {/* Empty lane — returns have no clip lane in arrangement */}
      <div style={{ flex: 1, height: 36, background: 'rgba(100,60,150,0.05)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', paddingLeft: 10 }}>
        <span style={{ fontSize: 9, color: '#5a4070', letterSpacing: '0.04em' }}>Return Bus — {rt.name}</span>
      </div>
    </div>
  )
}

// ── Arrangement View ──────────────────────────────────────────────────────────

export default function ArrangementView({ onGenerateMusic }: { onGenerateMusic?: () => void } = {}) {
  const { project, dispatch, engine, setPosition, selectedClipId, setSelectedClipId, selectedTrackId, expandedPianoRollClipId, setExpandedPianoRollClipId, expandedStepSeqClipId, setExpandedStepSeqClipId, selectedClipIds, setSelectedClipIds, selectedEffectIds, setSelectedEffectIds, soundPanel, setSoundPanel, onSave, onSaveLocal, isSaving, dawDirty, audioMode, podcastMeta, blinkIds, loopToolArmed, setLoopToolArmed, collabPeers, notifyLocked, isGuest, requireAccount, resumeExport, clearResumeExport } = useDaw()
  const isMobile = useIsMobile()
  // Meter map for bar-snapping: 'bar' snap honors time-signature changes. Falls
  // back to uniform (project.timeSignatureNum) when there are no meter markers.
  const mSegs = useMemo(() => meterSegments(project), [project.timeSignatureNum, project.timeSignatureDen, project.meterMarkers])
  // Mobile track heads can be minimized *horizontally* to a thin strip so the
  // clip timeline (one overlay anchored at `hdrW`) gets the reclaimed width.
  const [narrowHeads, setNarrowHeads] = useState(false)
  const hdrW = isMobile ? (narrowHeads ? 52 : 140) : HDR_W  // narrower track heads on a phone
  // Mobile timeline gestures: 1 finger on the blank lane scrubs the playhead;
  // 2 fingers pan (both axes) + pinch-zoom the timeline; double-tap the blank
  // lane plays. Mirrors the piano roll's touch model.
  const laneGesture = useRef<
    | { mode: 'pan'; locked: 'pan' | 'scroll' | null; startX: number; startY: number; startSL: number; startST: number }
    | { mode: 'gesture'; locked: 'pan' | 'zoom' | null; startDist: number; startBeatW: number; midX: number; midY: number; startSL: number; startST: number }
    | null
  >(null)
  const [mobMore, setMobMore] = useState(false)      // mobile toolbar "More" sheet
  const [mobSnapMenu, setMobSnapMenu] = useState(false)

  // The shared clip Sound panel — follows the current selection (retargets on
  // select) and closes when nothing is selected.
  const soundClips: DawClip[] = selectedClipIds.size > 1
    ? project.arrangementClips.filter(c => selectedClipIds.has(c.id))
    : (selectedClipId ? project.arrangementClips.filter(c => c.id === selectedClipId) : [])
  useEffect(() => {
    if (soundPanel && soundClips.length === 0) setSoundPanel(null)
  }, [soundPanel, soundClips.length, setSoundPanel])

  // Guests build freely but must sign up to save. Every 5 minutes, pulse the
  // Save button — a wordless nudge toward keeping their work. Once they sign up
  // isGuest flips false and this tears down, so a saved user is never nagged.
  const [saveNudge, setSaveNudge] = useState(false)
  useEffect(() => {
    if (!isGuest || !onSave) return
    const id = window.setInterval(() => {
      setSaveNudge(true)
      window.setTimeout(() => setSaveNudge(false), 2600)
    }, 5 * 60 * 1000)
    return () => window.clearInterval(id)
  }, [isGuest, onSave])
  const [beatW, setBeatW]           = useState(40)
  const [scrollLeft, setScrollLeft] = useState(MIN_SCROLL)
  const [snap, setSnap]             = useState<SnapMode>('1/16')
  const [snapMenu, setSnapMenu]     = useState(false)   // desktop snap dropdown
  const snapLabelOf = (m: SnapMode) => (m === 'off' ? 'Off' : m === 'beat' ? 'Beat' : m === 'bar' ? 'Bar' : m)
  // "Everything" tier only: split the timeline with full-height dividers at every
  // tempo change (and section boundary — where a time-signature change is marked).
  const uiTier = useUITierOptional()
  const showTimelineDividers = (uiTier?.atLeast('full') ?? false)
  const [tsPopover, setTsPopover]   = useState<{ x: number; y: number; beat?: number } | null>(null)
  const [openComment, setOpenComment]   = useState<{ id: string; x: number; y: number } | null>(null)
  const [newCommentAt, setNewCommentAt] = useState<{ beat: number; x: number; y: number } | null>(null)
  const [tsDraftBpm, setTsDraftBpm] = useState(120)
  // Raw text the user is typing into the popover's BPM box. Kept separate from the
  // committed numeric `tsDraftBpm` so mid-type states (empty, "6", "12") aren't
  // clamped/rewritten on every keystroke; parsed + clamped only on blur/Enter.
  const [tsDraftBpmText, setTsDraftBpmText] = useState('120')
  // Parse the current BPM text, clamping to 40–300; falls back to the last
  // committed value on empty/invalid input.
  const parseTsBpm = () => {
    const n = parseFloat(tsDraftBpmText)
    return Number.isFinite(n) ? clampBpm(n) : tsDraftBpm
  }
  const commitTsBpm = () => {
    const b = parseTsBpm()
    setTsDraftBpm(b)
    setTsDraftBpmText(String(b))
    return b
  }
  const [tsDraftNum, setTsDraftNum] = useState(project.timeSignatureNum)
  const [tsDraftDen, setTsDraftDen] = useState(project.timeSignatureDen)
  // Group track fold state: set of group track IDs that are folded
  const [showExport, setShowExport] = useState(false)
  const [exportDefaultFormat, setExportDefaultFormat] = useState<'webm' | 'wav'>('webm')
  const [showExportDropdown, setShowExportDropdown] = useState(false)
  const exportDropdownRef = useRef<HTMLDivElement>(null)
  const [showSaveDropdown, setShowSaveDropdown] = useState(false)
  const saveDropdownRef = useRef<HTMLDivElement>(null)
  const [saveDest, setSaveDest] = useState<'cloud' | 'local'>(() => {
    try { return typeof localStorage !== 'undefined' && localStorage.getItem('100lights-save-dest') === 'local' ? 'local' : 'cloud' } catch { return 'cloud' }
  })
  const [showEditorMenu, setShowEditorMenu] = useState(false)
  const editorDropdownRef = useRef<HTMLDivElement>(null)
  const [arrangeTransientDialog, setArrangeTransientDialog] = useState<{
    sensitivity: number; transients: number[]; buf: AudioBuffer; clip: AudioClip
  } | null>(null)
  const [showPublish, setShowPublish] = useState(false)
  const [publishFeedUrl, setPublishFeedUrl] = useState<string | null>(null)
  const [publishLoading, setPublishLoading] = useState(false)
  const [publishError, setPublishError] = useState<string | null>(null)
  const [foldedGroups, setFoldedGroups] = useState<Set<string>>(new Set())
  // Multi-track selection for grouping
  const [selectedTrackIds, setSelectedTrackIds] = useState<Set<string>>(new Set())
  // Ripple editing: moving a clip shifts subsequent clips on the same track
  const [rippleEdit, setRippleEdit] = useState(false)
  // Spectral morph
  const [morphDuration, setMorphDuration] = useState(3)
  const [morphing, setMorphing] = useState(false)
  const [morphError, setMorphError] = useState('')
  const outerRef    = useRef<HTMLDivElement>(null)
  const laneRef     = useRef<HTMLDivElement>(null)
  const playheadRef = useRef<HTMLDivElement>(null)
  const rafRef      = useRef<number | undefined>(undefined)
  const [viewWidth, setViewWidth] = useState(800)
  const [rubberBand, setRubberBand] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null)
  // Beat-span of the last rubber-band selection (grid-snapped). Copy and
  // group-loop use it so "the whole bar" — blank space included — is the unit.
  const [selectionRegion, setSelectionRegion] = useState<{ start: number; end: number } | null>(null)
  const [selectionTracks, setSelectionTracks] = useState<Set<string>>(new Set())
  // Hold S while drag-selecting → splice every clip the box crosses at its edges
  // (Option ignores snapping). A plain S TAP still splices the selected clip at
  // the playhead — that's handled on keyUP so holding S is purely a drag modifier
  // and never auto-repeats a split. `sSpliceUsedRef` flags that a hold-S drag
  // consumed the press, so the keyup doesn't ALSO playhead-splice.
  const sHeldRef = useRef(false)
  const sSpliceUsedRef = useRef(false)
  // Escape clears the AREA selection (region + tracks) too, alongside the clip
  // selection cleared by the editor's global handler.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) { setSelectionRegion(null); setSelectionTracks(new Set()); setSelectedTrackIds(new Set()) }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])
  // Event handlers (ctx-menu copy, resize-start) fire from children whose
  // closures can be a render behind — they read the region through this ref
  const selectionRegionRef = useRef(selectionRegion)
  useEffect(() => {
    selectionRegionRef.current = selectionRegion
  }, [selectionRegion])
  const selectionTracksRef = useRef(selectionTracks)
  useEffect(() => {
    selectionTracksRef.current = selectionTracks
  }, [selectionTracks])

  // Dragging the selection band's edge repeats the whole selected block —
  // every clip on every selected track, from the selection's start to its
  // end — tiled after the selection end. Sample-level repeat, not transport.
  // The original region + copy count come from the child: the live band
  // resize has already mutated selectionRegion by the time this fires.
  const commitSelectionLoop = (region: { start: number; end: number }, blocks: number) => {
    const blockLen = region.end - region.start
    if (blockLen <= 0.01 || blocks <= 0) return
    const tracks = selectionTracksRef.current
    const src = project.arrangementClips.filter(c =>
      tracks.has(c.trackId) && c.startBeat >= region.start - 0.01 && c.startBeat < region.end - 0.01)
    for (let k = 1; k <= blocks; k++) {
      for (const c of src) {
        const copy = JSON.parse(JSON.stringify(c)) as DawClip
        copy.id = crypto.randomUUID()
        copy.startBeat = c.startBeat + k * blockLen
        if (isMidiClip(copy)) copy.notes = copy.notes.map(nt => ({ ...nt, id: crypto.randomUUID() }))
        dispatch({ type: 'ADD_CLIP', clip: copy })
      }
    }
    setSelectionRegion({ start: region.start, end: region.end + blocks * blockLen })
  }
  const [prHint, setPrHint] = useState<string | null>(null)  // transient note under the PIANO ROLL button

  useEffect(() => {
    const ro = new ResizeObserver(entries => setViewWidth(entries[0].contentRect.width - hdrW))
    if (outerRef.current) ro.observe(outerRef.current)
    return () => ro.disconnect()
  }, [hdrW])

  useEffect(() => {
    function frame() {
      const el = playheadRef.current
      if (el) el.style.left = `${engine.displayBeat * beatW - scrollLeft}px`
      rafRef.current = requestAnimationFrame(frame)
    }
    rafRef.current = requestAnimationFrame(frame)
    return () => { if (rafRef.current !== undefined) cancelAnimationFrame(rafRef.current) }
  }, [engine, beatW, scrollLeft])

  const tsPopoverRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!tsPopover) return
    function onDown(e: MouseEvent) {
      if (tsPopoverRef.current && !tsPopoverRef.current.contains(e.target as Node)) setTsPopover(null)
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setTsPopover(null) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [tsPopover])

  useEffect(() => {
    if (!showSaveDropdown) return
    function onDown(e: MouseEvent) { if (saveDropdownRef.current && !saveDropdownRef.current.contains(e.target as Node)) setShowSaveDropdown(false) }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setShowSaveDropdown(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [showSaveDropdown])

  useEffect(() => {
    if (!showExportDropdown) return
    function onDown(e: MouseEvent) {
      if (exportDropdownRef.current && !exportDropdownRef.current.contains(e.target as Node)) {
        setShowExportDropdown(false)
      }
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setShowExportDropdown(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [showExportDropdown])

  useEffect(() => {
    if (!showEditorMenu) return
    function onDown(e: MouseEvent) {
      if (editorDropdownRef.current && !editorDropdownRef.current.contains(e.target as Node)) setShowEditorMenu(false)
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setShowEditorMenu(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [showEditorMenu])

  async function handleMorph() {
    const ids = [...selectedClipIds]
    if (ids.length !== 2) return
    const clips = ids.map(id => project.arrangementClips.find(c => c.id === id)).filter(Boolean) as AudioClip[]
    if (clips.length !== 2 || !isAudioClip(clips[0]) || !isAudioClip(clips[1])) return

    setMorphing(true)
    setMorphError('')
    try {
      const [bufA, bufB] = await Promise.all([
        engine.loadClipBuffer(clips[0]),
        engine.loadClipBuffer(clips[1]),
      ])
      if (!bufA || !bufB) throw new Error('Could not load audio for one or both clips')

      const sr = engine.ctx.sampleRate
      const result = await runSpectralMorph(
        bufA.getChannelData(0),
        bufB.getChannelData(0),
        sr,
        morphDuration
      )

      // Build an AudioBuffer from the morph result
      const audioBuf = engine.ctx.createBuffer(1, result.samples.length, result.sampleRate)
      audioBuf.copyToChannel(result.samples as Float32Array<ArrayBuffer>, 0)

      // Sort clips chronologically; place morph starting at the end of clip A
      const sorted  = [...clips].sort((a, b) => a.startBeat - b.startBeat)
      const clipA = sorted[0]
      const durationBeats = morphDuration * (project.tempo / 60)
      const morphStartBeat = clipA.startBeat + clipA.durationBeats
      const newClip = makeAudioClip(clipA.trackId, 'Morph', morphStartBeat, durationBeats)

      // Pre-load into engine cache — loadClipBuffer will find it before trying the URL
      engine.bufferCache.set(newClip.id, audioBuf)
      dispatch({ type: 'ADD_CLIP', clip: newClip })
      setSelectedClipIds(new Set([newClip.id]))
    } catch (err) {
      setMorphError(err instanceof Error ? err.message : 'Morph failed')
      setTimeout(() => setMorphError(''), 5000)
    } finally {
      setMorphing(false)
    }
  }

  async function handleSplitAtTransientsFromToolbar() {
    if (!selectedClipId) return
    const clip = project.arrangementClips.find(c => c.id === selectedClipId)
    if (!clip || !isAudioClip(clip)) return
    const ac = clip as AudioClip
    let buf = engine.bufferCache.get(ac.id)
    if (!buf) buf = (await engine.loadClipBuffer(ac)) ?? undefined
    if (!buf) return
    const sensitivity = 2.0
    const transients = detectTransients(buf, ac.startBeat, project.tempo, sensitivity, ac.trimStart ?? 0)
      .filter(b => b > ac.startBeat + 0.01 && b < ac.startBeat + ac.durationBeats - 0.01)
    setArrangeTransientDialog({ sensitivity, transients, buf, clip: ac })
  }

  function applyArrangeTransientSplit() {
    if (!arrangeTransientDialog) return
    const { transients, buf, clip: ac } = arrangeTransientDialog
    if (transients.length === 0) { setArrangeTransientDialog(null); return }
    const secPerBeat = 60 / project.tempo
    const splitBeats = [ac.startBeat, ...transients, ac.startBeat + ac.durationBeats]
    dispatch({ type: 'REMOVE_CLIP', clipId: ac.id })
    for (let i = 0; i < splitBeats.length - 1; i++) {
      const s = splitBeats[i]
      const e = splitBeats[i + 1]
      const dur = e - s
      const offsetSec = (s - ac.startBeat) * secPerBeat
      const newId = crypto.randomUUID()
      const newClip: AudioClip = {
        ...ac,
        id: newId,
        startBeat: s,
        durationBeats: dur,
        trimStart: Math.max(0, (ac.trimStart ?? 0) + offsetSec),
        trimEnd: Math.max(0, (ac.trimEnd ?? 0) + ((ac.startBeat + ac.durationBeats - e) * secPerBeat)),
        name: splitBeats.length > 2 ? `${ac.name} ${i + 1}` : ac.name,
        waveformPeaks: ac.waveformPeaks,
      }
      engine.bufferCache.set(newId, buf)
      dispatch({ type: 'ADD_CLIP', clip: newClip })
    }
    setArrangeTransientDialog(null)
  }

  // Loop tool: armed by the transport's loop button. The next drag across the
  // ruler or track lanes draws the loop region; Escape disarms.
  const loopDrawRef = useRef<{ startBeat: number } | null>(null)
  useEffect(() => {
    if (!loopToolArmed) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setLoopToolArmed(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [loopToolArmed, setLoopToolArmed])

  function onLoopToolMouseDown(e: React.MouseEvent) {
    if (!loopToolArmed || e.button !== 0) return
    const root = outerRef.current
    if (!root) return
    const rootRect = root.getBoundingClientRect()
    if (e.clientX - rootRect.left < hdrW) return  // headers stay interactive
    e.preventDefault()
    e.stopPropagation()
    const timelineLeft = rootRect.left + hdrW
    const beatAt = (clientX: number) => Math.max(0, snapBeat((clientX - timelineLeft + scrollLeft) / beatW, snap, project.timeSignatureNum, mSegs))
    const startBeat = beatAt(e.clientX)
    loopDrawRef.current = { startBeat }
    const mm = (ev: MouseEvent) => {
      if (!loopDrawRef.current) return
      const b = beatAt(ev.clientX)
      const s = Math.min(loopDrawRef.current.startBeat, b)
      const en = Math.max(loopDrawRef.current.startBeat, b)
      if (en - s >= 0.1) {
        dispatch({ type: 'SET_LOOP', start: s, end: Math.max(en, s + 0.25) })
        dispatch({ type: 'SET_LOOP_ENABLED', enabled: true })
      }
    }
    const mu = () => {
      loopDrawRef.current = null
      setLoopToolArmed(false)
      document.removeEventListener('mousemove', mm)
      document.removeEventListener('mouseup', mu)
    }
    document.addEventListener('mousemove', mm)
    document.addEventListener('mouseup', mu)
  }

  function handleEditTimeSig(e: React.MouseEvent, beat = 0) {
    setTsDraftNum(project.timeSignatureNum)
    setTsDraftDen(project.timeSignatureDen)
    setTsDraftBpm(project.tempo)
    setTsDraftBpmText(String(project.tempo))
    setTsPopover({ x: e.clientX, y: e.clientY, beat })
  }

  // Tempo changes are now consumed directly by the engine's tempo map
  // (lib/tempo-map.ts, fed through DawEngine.updateProject) — beat↔seconds is
  // piecewise, so playback switches BPM sample-accurately at each marker. The old
  // 150ms polling watcher that dispatched a global SET_TEMPO on every marker
  // crossing (which destructively rescaled audio-clip beat-lengths each pass) is
  // gone. The manual BPM box still sets the global tempo (SET_TEMPO / marker edit).

  function handleWheel(e: React.WheelEvent) {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault()
      const factor = Math.min(1.43, Math.max(0.7, Math.exp(-e.deltaY * ZOOM_SENS)))
      setBeatW(w => Math.max(MIN_BEAT_W, Math.min(MAX_BEAT_W, w * factor)))
      return
    }
    // Shift+wheel pans the timeline (mouse wheels have no deltaX of their own)
    if (e.shiftKey) {
      setScrollLeft(s => Math.max(MIN_SCROLL, s + (e.deltaX || e.deltaY)))
      return
    }
    // Axis lock: only a dominantly-horizontal gesture pans the timeline.
    // Vertical scrolling falls through to the lane's native overflowY scroll
    // instead of dragging the view sideways.
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      setScrollLeft(s => Math.max(MIN_SCROLL, s + e.deltaX))
    }
  }

  function fitToWindow() {
    const maxBeat = project.arrangementClips.reduce((m, c) => Math.max(m, c.startBeat + c.durationBeats), 32)
    setBeatW(Math.max(MIN_BEAT_W, viewWidth / maxBeat))
    setScrollLeft(MIN_SCROLL)
  }

  // Give a track a drum kit if it doesn't already have one, so beat hits sound.
  function ensureDrumKit(trackId: string) {
    const track = project.tracks.find(t => t.id === trackId)
    if (track && track.instrument.type !== 'drum') {
      dispatch({ type: 'SET_INSTRUMENT', trackId, instrument: structuredClone(DEFAULT_KIT.instrument) })
    }
  }

  // The editor a clip opens into follows its type: a pattern (drum) clip opens
  // the step sequencer, a melodic clip opens the piano roll. The two are
  // mutually exclusive so only one editor sits under a track. Toggles.
  function openClipEditor(clip: DawClip) {
    if (!isMidiClip(clip)) return
    // Don't let two people open the same clip's editor at once (collab lock).
    const opening = clip.isDrumClip ? expandedStepSeqClipId !== clip.id : expandedPianoRollClipId !== clip.id
    if (opening) { const locker = clipLockedBy(clip.id, collabPeers); if (locker) { notifyLocked?.(locker); return } }
    if (clip.isDrumClip) {
      const already = expandedStepSeqClipId === clip.id
      setExpandedStepSeqClipId(already ? null : clip.id)
      if (!already) { setExpandedPianoRollClipId(null); ensureDrumKit(clip.trackId) }
    } else {
      const already = expandedPianoRollClipId === clip.id
      setExpandedPianoRollClipId(already ? null : clip.id)
      if (!already) setExpandedStepSeqClipId(null)
    }
  }

  // Create a fresh clip of the chosen kind on the selected track and open it.
  function createEditorClip(kind: 'roll' | 'beat') {
    if (!selectedTrackId) {
      setPrHint('Select a track first'); window.setTimeout(() => setPrHint(null), 3500); highlightHelpTargets(['track-head']); return
    }
    if (kind === 'beat') {
      const newClip = makeMidiClip(selectedTrackId, 'Beat', engine.currentBeat, 4, { isDrumClip: true })
      dispatch({ type: 'ADD_CLIP', clip: newClip })
      ensureDrumKit(selectedTrackId)
      setExpandedPianoRollClipId(null)
      setExpandedStepSeqClipId(newClip.id)
      setSelectedClipId(newClip.id); setSelectedClipIds(new Set([newClip.id]))
    } else {
      const newClip = makeMidiClip(selectedTrackId, 'MIDI', engine.currentBeat, 4)
      dispatch({ type: 'ADD_CLIP', clip: newClip })
      setExpandedStepSeqClipId(null)
      setExpandedPianoRollClipId(newClip.id)
      setSelectedClipId(newClip.id); setSelectedClipIds(new Set([newClip.id]))
    }
  }

  // Main editor button: open the selected clip's native editor; with only a
  // track selected, open its existing clip or create a piano roll. The caret
  // (createEditorClip) is how you explicitly make a Beat.
  function openEditor() {
    if (selectedClipId) {
      const clip = project.arrangementClips.find(c => c.id === selectedClipId)
      if (clip && isMidiClip(clip)) { openClipEditor(clip); return }
    }
    if (selectedTrackId) {
      const existing = project.arrangementClips.find(c => isMidiClip(c) && c.trackId === selectedTrackId)
      if (existing) { openClipEditor(existing); return }
      createEditorClip('roll')
      return
    }
    if (expandedPianoRollClipId || expandedStepSeqClipId) { setExpandedPianoRollClipId(null); setExpandedStepSeqClipId(null); return }
    setPrHint('Select a track to open an editor')
    window.setTimeout(() => setPrHint(null), 3500)
    highlightHelpTargets(['track-head'])
  }

  // Selecting an item (clicking a clip) is a different KIND of selection than an
  // area (region + its tracks) or a track selection — only one kind at a time.
  // So a clip click clears the area/track highlight. (The marquee drag is its
  // own area selection and sets the region itself, so it isn't routed here.)
  function clearAreaSelection() {
    setSelectionRegion(null)
    setSelectionTracks(new Set())
    setSelectedTrackIds(new Set())
  }

  function handleSelectTrack(trackId: string, ctrl: boolean) {
    if (ctrl) {
      setSelectedTrackIds(prev => {
        const next = new Set(prev)
        if (next.has(trackId)) next.delete(trackId)
        else next.add(trackId)
        return next
      })
    } else {
      setSelectedTrackIds(new Set([trackId]))
    }
  }

  function handleGroupTracks() {
    // Don't nest existing groups; group the plain tracks in the selection.
    const trackIds = [...selectedTrackIds].filter(id => project.tracks.find(t => t.id === id)?.kind !== 'group')
    if (trackIds.length < 1) return
    dispatch({ type: 'GROUP_TRACKS', trackIds, groupId: crypto.randomUUID() })
    setSelectedTrackIds(new Set())
  }

  function addReturnTrack() {
    const idx = project.returnTracks.length
    const returnTrack: ReturnTrack = {
      id: crypto.randomUUID(),
      name: `Return ${String.fromCharCode(65 + idx)}`,
      color: TRACK_COLORS[(idx + 6) % TRACK_COLORS.length],
      volume: 0.8,
      pan: 0,
      mute: false,
      effects: [],
    }
    dispatch({ type: 'ADD_RETURN_TRACK', track: returnTrack })
  }

  // Bounding beat-span of a set of clips — the selection region's extent.
  function spanOfClips(ids: Set<string>): { start: number; end: number } | null {
    const cs = project.arrangementClips.filter(c => ids.has(c.id))
    if (cs.length === 0) return null
    return { start: Math.min(...cs.map(c => c.startBeat)), end: Math.max(...cs.map(c => c.startBeat + c.durationBeats)) }
  }

  // Split a clip (audio or MIDI) at one or more interior beats, in one pass.
  // Mirrors the clip splice (TrackRow.onSplice) + multi-point transient split.
  function spliceClipAtBeats(clip: DawClip, cuts: number[]) {
    const end = clip.startBeat + clip.durationBeats
    const inner = [...new Set(cuts)].filter(c => c > clip.startBeat + 0.03 && c < end - 0.03).sort((a, b) => a - b)
    if (inner.length === 0) return false
    const bounds = [clip.startBeat, ...inner, end]
    if (isAudioClip(clip) && clip.bufferDuration) {
      const bufDur = clip.bufferDuration
      const trimStart = clip.trimStart ?? 0
      const nativeDur = bufDur - trimStart - (clip.trimEnd ?? 0)
      const buf = engine.bufferCache.get(clip.id)
      dispatch({ type: 'REMOVE_CLIP', clipId: clip.id })
      for (let i = 0; i < bounds.length - 1; i++) {
        const a = bounds[i], b = bounds[i + 1]
        const offA = a - clip.startBeat, offB = b - clip.startBeat
        const secA = clip.warpEnabled ? trimStart + (offA / clip.durationBeats) * nativeDur : trimStart + engine.beatsToSeconds(offA)
        const secB = clip.warpEnabled ? trimStart + (offB / clip.durationBeats) * nativeDur : trimStart + engine.beatsToSeconds(offB)
        const id = crypto.randomUUID()
        if (buf) engine.bufferCache.set(id, buf)
        dispatch({ type: 'ADD_CLIP', clip: { ...clip, id, startBeat: a, durationBeats: b - a, trimStart: secA, trimEnd: Math.max(0, bufDur - secB) } })
      }
      return true
    }
    if (isMidiClip(clip)) {
      let notes = clip.notes
      if (clip.loopEnabled && clip.loopLengthBeats) {   // materialize the audible repeats before cutting
        const L = clip.loopLengthBeats
        notes = []
        for (let k = 0; k * L < clip.durationBeats; k++) for (const n of clip.notes) {
          const st = k * L + n.startBeat
          if (st >= clip.durationBeats) continue
          notes.push({ ...n, startBeat: st, durationBeats: Math.min(n.durationBeats, clip.durationBeats - st) })
        }
      }
      dispatch({ type: 'REMOVE_CLIP', clipId: clip.id })
      for (let i = 0; i < bounds.length - 1; i++) {
        const oa = bounds[i] - clip.startBeat, ob = bounds[i + 1] - clip.startBeat
        const segNotes = notes.filter(n => n.startBeat >= oa - 1e-6 && n.startBeat < ob - 1e-6)
          .map(n => ({ ...n, id: crypto.randomUUID(), startBeat: n.startBeat - oa, durationBeats: Math.min(n.durationBeats, ob - n.startBeat) }))
        // Loop unit = this segment's own length, so a later loop repeats the
        // cut segment rather than snapping back to the un-split (bar-rounded) size.
        dispatch({ type: 'ADD_CLIP', clip: { ...clip, id: crypto.randomUUID(), startBeat: bounds[i], durationBeats: bounds[i + 1] - bounds[i], notes: segNotes, loopEnabled: false, loopLengthBeats: bounds[i + 1] - bounds[i] } })
      }
      return true
    }
    return false
  }

  function onLaneMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    if (e.button !== 0) return
    const preSelected = new Set(selectedClipIds)   // for Cmd/Shift-additive selection
    const laneEl = laneRef.current
    if (!laneEl) return
    const laneRect = laneEl.getBoundingClientRect()
    // Ignore clicks in the track header column
    if (e.clientX < laneRect.left + hdrW) return

    const sx = e.clientX
    const sy = e.clientY
    // The band snaps to the grid horizontally, so a drag-select IS a musical
    // region ("this bar"), not a pixel rectangle
    const toBeat = (clientX: number) => Math.max(0, (clientX - laneRect.left - hdrW + scrollLeft) / beatW)
    const toX    = (beat: number) => laneRect.left + hdrW + beat * beatW - scrollLeft
    const snapX  = (clientX: number) => toX(snapBeat(toBeat(clientX), snap, project.timeSignatureNum, mSegs))
    setRubberBand({ x1: snapX(sx), y1: sy, x2: snapX(sx), y2: sy })

    function onMove(ev: MouseEvent) {
      setRubberBand({ x1: snapX(sx), y1: sy, x2: snapX(ev.clientX), y2: ev.clientY })
    }

    function onUp(ev: MouseEvent) {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      setRubberBand(null)

      const dx = Math.abs(ev.clientX - sx)
      const dy = Math.abs(ev.clientY - sy)
      if (dx < 5 && dy < 5) {
        // A plain click on empty background deselects everything
        setSelectionRegion(null)
        setSelectionTracks(new Set())
        setSelectedClipIds(new Set())
        setSelectedClipId(null)
        setSelectedEffectIds(new Set())
        return
      }

      // Hold S while dragging → SPLICE every clip the box crosses at its two
      // edges (nearest snap point; Option/alt splices at the exact raw beat).
      if (sHeldRef.current && laneEl) {
        sSpliceUsedRef.current = true
        const sig = project.timeSignatureNum
        const rawA = Math.min(toBeat(sx), toBeat(ev.clientX))
        const rawB = Math.max(toBeat(sx), toBeat(ev.clientX))
        const edgeA = ev.altKey ? rawA : snapBeat(rawA, snap, sig)
        const edgeB = ev.altKey ? rawB : snapBeat(rawB, snap, sig)
        const top = Math.min(sy, ev.clientY), bot = Math.max(sy, ev.clientY)
        for (const el of Array.from(laneEl.querySelectorAll('[data-track-id]'))) {
          const trackId = (el as HTMLElement).dataset.trackId!
          const tr = el.getBoundingClientRect()
          if (tr.bottom < top || tr.top > bot) continue
          for (const clip of project.arrangementClips) {
            if (clip.trackId !== trackId) continue
            if (clip.startBeat + clip.durationBeats <= edgeA || clip.startBeat >= edgeB) continue
            spliceClipAtBeats(clip, [edgeA, edgeB])
          }
        }
        return
      }

      const regionStart = Math.min(snapBeat(toBeat(sx), snap, project.timeSignatureNum, mSegs), snapBeat(toBeat(ev.clientX), snap, project.timeSignatureNum, mSegs))
      const regionEnd   = Math.max(snapBeat(toBeat(sx), snap, project.timeSignatureNum, mSegs), snapBeat(toBeat(ev.clientX), snap, project.timeSignatureNum, mSegs))
      const selL = toX(regionStart)
      const selR = toX(regionEnd)
      const selT = Math.min(sy, ev.clientY)
      const selB = Math.max(sy, ev.clientY)

      const newIds = new Set<string>()
      if (!laneEl) return
      const trackEls = laneEl.querySelectorAll('[data-track-id]')
      for (const el of Array.from(trackEls)) {
        const trackId = (el as HTMLElement).dataset.trackId!
        const tr = el.getBoundingClientRect()
        if (tr.bottom < selT || tr.top > selB) continue
        for (const clip of project.arrangementClips) {
          if (clip.trackId !== trackId) continue
          if (clip.startBeat + clip.durationBeats <= regionStart || clip.startBeat >= regionEnd) continue
          newIds.add(clip.id)
        }
      }
      // FX-lane effects live in per-track sub-lanes — intersect their DOM rects.
      // Skip rects hidden under the header column (lanes clip overflow, rects don't).
      const newEffIds = new Set<string>()
      for (const el of Array.from(laneEl.querySelectorAll('[data-effect-id]'))) {
        const r = el.getBoundingClientRect()
        if (r.right < laneRect.left + hdrW) continue
        if (r.right < selL || r.left > selR || r.bottom < selT || r.top > selB) continue
        newEffIds.add((el as HTMLElement).dataset.effectId!)
      }

      // The drag is a time-range selection on the track(s) it covers — it
      // works over empty space, and expands to the full extent of any sample
      // it overlaps (both ends), so a partial band still selects whole clips.
      let region: { start: number; end: number } | null

      if (ev.metaKey || ev.ctrlKey || ev.shiftKey) {
        const finalIds = new Set([...preSelected, ...newIds])
        setSelectedClipIds(finalIds)
        setSelectedEffectIds(prev => new Set([...prev, ...newEffIds]))
        const span = spanOfClips(finalIds)
        region = span
          ? { start: Math.min(regionStart, span.start), end: Math.max(regionEnd, span.end) }
          : { start: regionStart, end: regionEnd }
      } else {
        // Replace the selection with whatever the band caught (may be nothing —
        // a pure empty-track time range is a valid selection)
        setSelectedClipIds(newIds)
        setSelectedClipId(newIds.size === 1 ? [...newIds][0] : null)
        setSelectedEffectIds(newEffIds)
        const span = spanOfClips(newIds)
        region = span
          ? { start: Math.min(regionStart, span.start), end: Math.max(regionEnd, span.end) }
          : { start: regionStart, end: regionEnd }
      }

      // Remember which track rows the band covered, so the highlight only paints
      // the selected tracks (not adjacent ones)
      const coveredTracks = new Set<string>()
      for (const el of Array.from(trackEls)) {
        const r = el.getBoundingClientRect()
        if (r.bottom >= selT && r.top <= selB) coveredTracks.add((el as HTMLElement).dataset.trackId!)
      }
      // Selected clips always count as covered (region expanded to them)
      for (const c of project.arrangementClips) if (newIds.has(c.id)) coveredTracks.add(c.trackId)
      setSelectionTracks(coveredTracks)
      setSelectionRegion(region)
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  // ── Copy / Paste ─────────────────────────────────────────────────────────────

  function handleCopyClips(ids: Set<string>) {
    const clipsToCopy = project.arrangementClips.filter(c => ids.has(c.id))
    if (clipsToCopy.length === 0) return
    // A rubber-band region copies the whole SPACE — leading/trailing silence
    // included — so pasted bars land exactly a bar apart
    const sel = selectionRegionRef.current
    const region = sel && clipsToCopy.every(c =>
      c.startBeat >= sel.start - 0.001 && c.startBeat < sel.end + 0.001)
      ? sel : null
    const originBeat = region ? region.start : Math.min(...clipsToCopy.map(c => c.startBeat))
    const regionSpan = region ? region.end - region.start : null
    const buffers: [string, AudioBuffer][] = []
    for (const c of clipsToCopy) {
      const buf = engine.bufferCache.get(c.id)
      if (buf) buffers.push([c.id, buf])
    }
    _clipboard = { clips: clipsToCopy, originBeat, regionSpan, buffers }
    _lastCopied = 'clips'
  }

  function handlePasteClips() {
    if (!_clipboard) return
    const { clips, originBeat, regionSpan, buffers } = _clipboard
    const pasteAt = engine.currentBeat
    let delta = pasteAt - originBeat
    // Pasting with the playhead still at the source (the common copy→paste
    // without moving) would overlay identical clips invisibly — place the
    // copies right after the copied span instead. A region copy uses the
    // region's span, so a copied bar repeats on the next bar.
    if (Math.abs(delta) < 1e-6) {
      const span = regionSpan ?? (Math.max(...clips.map(c => c.startBeat + c.durationBeats)) - originBeat)
      delta = span
    }
    const bufMap = new Map(buffers)
    const newIds = new Set<string>()
    for (const clip of clips) {
      const startBeat = Math.max(0, clip.startBeat + delta)
      // Never create an exact invisible duplicate of an existing clip
      if (project.arrangementClips.some(c =>
        c.trackId === clip.trackId && Math.abs(c.startBeat - startBeat) < 1e-6 &&
        Math.abs(c.durationBeats - clip.durationBeats) < 1e-6 && c.name === clip.name)) continue
      const newId = crypto.randomUUID()
      const newClip: DawClip = { ...clip, id: newId, startBeat }
      if (isAudioClip(clip)) {
        const buf = bufMap.get(clip.id)
        if (buf) engine.bufferCache.set(newId, buf)
      }
      dispatch({ type: 'ADD_CLIP', clip: newClip })
      newIds.add(newId)
    }
    setSelectedClipIds(newIds)
    if (newIds.size === 1) setSelectedClipId([...newIds][0])
  }

  function handleCopyEffects(ids: Set<string>) {
    const toCopy = (project.clipEffects ?? []).filter(e => ids.has(e.id))
    if (toCopy.length === 0) return
    _effectClipboard = toCopy
    _lastCopied = 'effects'
  }

  function handlePasteEffects() {
    if (!_effectClipboard || _effectClipboard.length === 0) return
    const pasteAt = engine.currentBeat
    const originBeat = Math.min(..._effectClipboard.map(e => e.startBeat))
    const delta = pasteAt - originBeat
    const newIds = new Set<string>()
    for (const eff of _effectClipboard) {
      const newEff = { ...eff, id: crypto.randomUUID(), startBeat: Math.max(0, eff.startBeat + delta) }
      dispatch({ type: 'ADD_CLIP_EFFECT', effect: newEff })
      newIds.add(newEff.id)
    }
    setSelectedEffectIds(newIds)
    setSelectedClipIds(new Set())
    setSelectedClipId(null)
  }

  // ── Keyboard shortcuts ────────────────────────────────────────────────────────
  // Refs for values used in the keyboard handler that change frequently — avoids
  // re-registering the document listener on every snap/ripple change.
  const snapRef = useRef(snap); snapRef.current = snap
  const rippleEditRef = useRef(rippleEdit); rippleEditRef.current = rippleEdit
  const fitToWindowRef = useRef(fitToWindow); fitToWindowRef.current = fitToWindow

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return

      const meta = e.metaKey || e.ctrlKey

      // ← → : nudge selected clips (capture phase blocks AudioEditor's seek when clips are selected)
      if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
        const ids = selectedClipIds.size > 0 ? [...selectedClipIds] : selectedClipId ? [selectedClipId] : []
        if (ids.length === 0) return  // no clips selected → let AudioEditor move playhead
        e.preventDefault()
        e.stopPropagation()  // prevent AudioEditor's bubble-phase seek handler
        const dir = e.code === 'ArrowLeft' ? -1 : 1
        const curSnap = snapRef.current
        const sigNum = project.timeSignatureNum
        const delta = e.shiftKey ? dir                               // Shift = 1 beat
          : curSnap === 'bar'  ? dir * sigNum
          : curSnap === '1/8'  ? dir * 0.5
          : curSnap === '1/16' ? dir * 0.25
          : dir                                                       // off / beat = 1 beat
        for (const clipId of ids) {
          const clip = project.arrangementClips.find(c => c.id === clipId)
          if (!clip) continue
          dispatch({ type: 'MOVE_CLIP', clipId, startBeat: Math.max(0, clip.startBeat + delta), trackId: clip.trackId })
        }
        return
      }

      // ↑ ↓ : move selected clips to prev / next track lane
      if (e.code === 'ArrowUp' || e.code === 'ArrowDown') {
        const ids = selectedClipIds.size > 0 ? [...selectedClipIds] : selectedClipId ? [selectedClipId] : []
        if (ids.length === 0) return
        e.preventDefault()
        const refClip = project.arrangementClips.find(c => c.id === ids[0])
        if (!refClip) return
        const trackIdx = project.tracks.findIndex(t => t.id === refClip.trackId)
        const targetIdx = trackIdx + (e.code === 'ArrowUp' ? -1 : 1)
        if (targetIdx < 0 || targetIdx >= project.tracks.length) return
        const targetTrackId = project.tracks[targetIdx].id
        for (const clipId of ids) {
          const clip = project.arrangementClips.find(c => c.id === clipId)
          if (!clip) continue
          dispatch({ type: 'MOVE_CLIP', clipId, startBeat: clip.startBeat, trackId: targetTrackId })
        }
        return
      }

      if (meta && e.key === 'c') {
        e.preventDefault()
        if (selectedEffectIds.size > 0) {
          handleCopyEffects(selectedEffectIds)
        } else {
          const ids = selectedClipIds.size > 0 ? selectedClipIds : selectedClipId ? new Set([selectedClipId]) : new Set<string>()
          handleCopyClips(ids)
        }
        return
      }

      if (meta && e.key === 'v') {
        e.preventDefault()
        if (_lastCopied === 'effects') {
          handlePasteEffects()
        } else {
          handlePasteClips()
        }
        return
      }

      // Cmd+D = duplicate selected clips immediately after their current position
      if (meta && e.key === 'd') {
        e.preventDefault()
        const ids = selectedClipIds.size > 0 ? selectedClipIds : selectedClipId ? new Set([selectedClipId]) : new Set<string>()
        const clipsToDup = project.arrangementClips.filter(c => ids.has(c.id))
        if (clipsToDup.length === 0) return
        const minStart = Math.min(...clipsToDup.map(c => c.startBeat))
        const maxEnd   = Math.max(...clipsToDup.map(c => c.startBeat + c.durationBeats))
        const span = maxEnd - minStart
        const newIds = new Set<string>()
        for (const clip of clipsToDup) {
          const newId = crypto.randomUUID()
          const newClip: DawClip = { ...clip, id: newId, startBeat: clip.startBeat + span }
          if (isAudioClip(clip)) {
            const buf = engine.bufferCache.get(clip.id)
            if (buf) engine.bufferCache.set(newId, buf)
          }
          dispatch({ type: 'ADD_CLIP', clip: newClip })
          newIds.add(newId)
        }
        setSelectedClipIds(newIds)
        if (newIds.size === 1) setSelectedClipId([...newIds][0])
        return
      }

      // Cmd+A = select all clips
      if (meta && e.key === 'a') {
        e.preventDefault()
        setSelectedClipIds(new Set(project.arrangementClips.map(c => c.id)))
        return
      }

      if (e.key === 'Escape') {
        setSelectedClipIds(new Set())
        setSelectedClipId(null)
        setSelectedEffectIds(new Set())
        return
      }

      if (e.key === 'Home') {
        e.preventDefault()
        engine.seek(0)
        setPosition(0)
        return
      }

      // S: HOLDING S is a splice modifier for the marquee drag (see the lane
      // drag). A plain S TAP splices the selected clip at the playhead — but on
      // keyUP, so holding S never auto-repeats a split. Just track the hold here.
      if (!meta && e.key === 's') {
        e.preventDefault()
        if (!e.repeat) { sHeldRef.current = true; sSpliceUsedRef.current = false }
        return
      }

      // L = toggle loop
      if (!meta && e.key === 'l') {
        e.preventDefault()
        dispatch({ type: 'SET_LOOP_ENABLED', enabled: !project.loopEnabled })
        return
      }

      // P = set loop region to span selected clips and enable loop
      if (!meta && e.key === 'p') {
        e.preventDefault()
        const ids = selectedClipIds.size > 0 ? selectedClipIds : selectedClipId ? new Set([selectedClipId]) : new Set<string>()
        const clips = project.arrangementClips.filter(c => ids.has(c.id))
        if (clips.length === 0) return
        dispatch({ type: 'SET_LOOP', start: Math.min(...clips.map(c => c.startBeat)), end: Math.max(...clips.map(c => c.startBeat + c.durationBeats)) })
        dispatch({ type: 'SET_LOOP_ENABLED', enabled: true })
        return
      }

      // G = toggle ripple edit
      if (!meta && e.key === 'g') {
        e.preventDefault()
        rippleEditRef.current  // read; actual toggle via setter
        setRippleEdit(r => !r)
        return
      }

      // F = fit arrangement to window
      if (!meta && e.key === 'f') {
        e.preventDefault()
        fitToWindowRef.current()
        return
      }

      // 1–5 = snap mode (Off / 1/16 / 1/8 / Beat / Bar)
      if (!meta && ['1', '2', '3', '4', '5'].includes(e.key)) {
        const modes: SnapMode[] = ['off', '1/16', '1/8', 'beat', 'bar']
        setSnap(modes[parseInt(e.key) - 1])
        return
      }

      // Delete / Backspace for selected effects (clips handled in AudioEditor)
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedEffectIds.size > 0) {
        e.preventDefault()
        for (const id of selectedEffectIds) dispatch({ type: 'REMOVE_CLIP_EFFECT', effectId: id })
        setSelectedEffectIds(new Set())
        return
      }
    }
    // S TAP (on keyup, not keydown, so HOLDING S can't auto-repeat): splice the
    // selected clip at the playhead — unless a hold-S drag already spliced.
    function onKeyUp(e: KeyboardEvent) {
      if (e.key !== 's') return
      const wasSplice = sSpliceUsedRef.current
      sHeldRef.current = false
      sSpliceUsedRef.current = false
      if (wasSplice) return
      const clipId = selectedClipId ?? (selectedClipIds.size === 1 ? [...selectedClipIds][0] : null)
      if (!clipId) return
      const clip = project.arrangementClips.find(c => c.id === clipId)
      if (clip) spliceClipAtBeats(clip, [engine.currentBeat])
    }
    document.addEventListener('keydown', onKey, true)  // capture: fires before AudioEditor's handlers
    document.addEventListener('keyup', onKeyUp, true)
    return () => { document.removeEventListener('keydown', onKey, true); document.removeEventListener('keyup', onKeyUp, true) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedClipId, selectedClipIds, selectedEffectIds, project.arrangementClips, project.clipEffects, project.tracks, project.loopEnabled, project.timeSignatureNum, engine, dispatch, setSelectedClipIds, setSelectedClipId, setSelectedEffectIds, setPosition, setSnap, setRippleEdit])

  // Visible tracks: hide children of a collapsed (folded) group.
  const collapsedGroupIds = new Set(project.tracks.filter(t => t.kind === 'group' && t.collapsed).map(t => t.id))
  const visibleTracks = project.tracks.filter(track => !(track.groupId && collapsedGroupIds.has(track.groupId)))

  // Move a dragged track head relative to a target head (reorder / regroup).
  function handleTrackDrop(draggedId: string, targetId: string, pos: 'before' | 'after') {
    if (draggedId === targetId) return
    const dragged = project.tracks.find(t => t.id === draggedId)
    const target  = project.tracks.find(t => t.id === targetId)
    if (!dragged || !target) return
    // Don't drop a group into its own child.
    if (dragged.kind === 'group' && target.groupId === dragged.id) return

    let groupId: string | null
    let beforeId: string | null
    if (target.kind === 'group') {
      if (pos === 'before') { groupId = null; beforeId = target.id }               // above the group
      else {                                                                        // into the group (top)
        groupId = dragged.kind === 'group' ? null : target.id
        const firstChild = project.tracks.find(t => t.groupId === target.id)
        beforeId = firstChild?.id ?? null
      }
    } else {
      groupId = dragged.kind === 'group' ? null : (target.groupId ?? null)
      if (pos === 'before') beforeId = target.id
      else {
        const idx = project.tracks.findIndex(t => t.id === target.id)
        beforeId = project.tracks[idx + 1]?.id ?? null
      }
    }
    dispatch({ type: 'MOVE_TRACK', trackId: draggedId, beforeId, groupId })
  }

  return (
    <div
      ref={outerRef}
      onMouseDownCapture={loopToolArmed ? onLoopToolMouseDown : undefined}
      style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: 'var(--bg-base)', backgroundImage: 'var(--workshop-pattern, none)', backgroundSize: 'var(--workshop-pattern-size, auto)', overflow: 'hidden', position: 'relative', cursor: loopToolArmed ? 'crosshair' : undefined }}
    >
      {loopToolArmed && (
        <div style={{
          position: 'absolute', bottom: 10, left: '50%', transform: 'translateX(-50%)', zIndex: 30, pointerEvents: 'none',
          display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 999,
          background: 'rgba(16,20,30,0.95)', border: '1px solid rgb(var(--accent-rgb) / 0.5)',
        }}>
          <span style={{ fontSize: 10.5, color: '#9cc4f0', fontWeight: 600 }}>Drag along the track or timeline to set the loop duration, or double-click Loop to loop the whole project · Esc to cancel</span>
        </div>
      )}

      {/* Toolbar — mobile gets a consolidated version; the rest sits behind "More". */}
      {isMobile ? (
        <MobileToolbar
          snap={snap} setSnap={setSnap} snapMenu={mobSnapMenu} setSnapMenu={setMobSnapMenu}
          onZoomIn={() => setBeatW(w => Math.min(MAX_BEAT_W, w * 1.3))}
          onZoomOut={() => setBeatW(w => Math.max(MIN_BEAT_W, w * 0.77))}
          onFit={fitToWindow}
          wfZoom={project.waveformZoom} onWf={(d: number) => dispatch({ type: 'SET_WAVEFORM_ZOOM', zoom: Math.max(1, Math.min(8, project.waveformZoom + d)) })}
          ripple={rippleEdit} onRipple={() => setRippleEdit(r => !r)}
          editorActive={!!(expandedPianoRollClipId || expandedStepSeqClipId)} onEditor={openEditor}
          onExport={() => { if (isGuest && requireAccount) { requireAccount('export'); return } setShowExport(true) }}
          onSave={onSave} onSaveLocal={onSaveLocal} isSaving={isSaving}
          more={mobMore} setMore={setMobMore}
        />
      ) : (
      <div style={{ height: 30, display: 'flex', alignItems: 'center', gap: 4, padding: '0 8px', background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <button onClick={() => setBeatW(w => Math.min(MAX_BEAT_W, w * 1.3))} style={toolBtn} title="Zoom in" data-help-id="zoom-in"><ZoomIn size={13} /></button>
        <button onClick={() => setBeatW(w => Math.max(MIN_BEAT_W, w * 0.77))} style={toolBtn} title="Zoom out" data-help-id="zoom-out"><ZoomOut size={13} /></button>
        <button onClick={fitToWindow} style={toolBtn} title="Fit to window" data-help-id="fit-window"><Maximize2 size={13} /></button>
        <div style={{ width: 1, height: 16, background: 'var(--border)' }} />
        <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>SNAP</span>
        <div style={{ position: 'relative' }} data-help-id="snap">
          <button onClick={() => setSnapMenu(v => !v)} title="Grid snap"
            style={{ ...toolBtn, background: 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid var(--border)', fontSize: 9, padding: '2px 7px', display: 'flex', alignItems: 'center', gap: 4, minWidth: 40 }}>
            {snapLabelOf(snap)} <ChevronDown size={10} style={{ opacity: 0.7 }} />
          </button>
          {snapMenu && (
            <>
              <div onClick={() => setSnapMenu(false)} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
              <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: 3, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 6, padding: 3, zIndex: 41, minWidth: 70, boxShadow: '0 4px 14px rgba(0,0,0,0.35)' }}>
                {(['off', '1/16', '1/8', 'beat', 'bar'] as SnapMode[]).map(m => (
                  <button key={m} onClick={() => { setSnap(m); setSnapMenu(false) }}
                    style={{ ...toolBtn, display: 'block', width: '100%', textAlign: 'left', background: snap === m ? 'var(--bg-surface)' : 'transparent', color: snap === m ? 'var(--text-primary)' : 'var(--text-muted)', border: 'none', fontSize: 10, padding: '4px 8px' }}>
                    {snapLabelOf(m)}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        <span style={{ fontSize: 8, color: 'var(--text-muted)', marginLeft: 2 }} title="Hold ⌥ Option while dragging to bypass snap">⌥=free</span>
        <div style={{ width: 1, height: 16, background: 'var(--border)', marginLeft: 4 }} />
        {/* Waveform zoom control */}
        <span data-ui-el="wf-zoom" style={{ fontSize: 9, color: 'var(--text-muted)' }} title="Waveform vertical zoom">WF</span>
        <button
          onClick={() => dispatch({ type: 'SET_WAVEFORM_ZOOM', zoom: Math.max(1, project.waveformZoom - 1) })}
          style={{ ...toolBtn, fontSize: 11, fontWeight: 700 }}
          title="Decrease waveform zoom"
          data-help-id="wf-zoom"
        >−</button>
        <span data-ui-el="wf-zoom" style={{ fontSize: 9, color: 'var(--text-muted)', minWidth: 10, textAlign: 'center', fontFamily: 'monospace' }}>{project.waveformZoom}</span>
        <button
          onClick={() => dispatch({ type: 'SET_WAVEFORM_ZOOM', zoom: Math.min(8, project.waveformZoom + 1) })}
          style={{ ...toolBtn, fontSize: 11, fontWeight: 700 }}
          title="Increase waveform zoom"
          data-help-id="wf-zoom"
        >+</button>
        <div style={{ width: 1, height: 16, background: 'var(--border)', marginLeft: 4 }} />
        {/* Ripple edit toggle */}
        <button
          onClick={() => setRippleEdit(r => !r)}
          title={rippleEdit ? 'Ripple Edit: ON — moving a clip shifts all clips to its right' : 'Ripple Edit: OFF — click to enable'}
          data-help-id="ripple"
          style={{
            ...toolBtn, width: 'auto', padding: '2px 8px', fontSize: 9, fontWeight: 700,
            border: `1px solid ${rippleEdit ? '#f59e0b' : 'var(--border)'}`,
            background: rippleEdit ? 'rgba(245,158,11,0.18)' : 'transparent',
            color: rippleEdit ? '#f59e0b' : 'var(--text-muted)',
            letterSpacing: '0.04em',
          }}
        >RIPPLE</button>
        {/* Split at Transients toolbar button */}
        {(() => {
          const selClip = selectedClipId ? project.arrangementClips.find(c => c.id === selectedClipId) : null
          const canSplit = !!(selClip && isAudioClip(selClip))
          return (
            <button
              onClick={() => { if (canSplit) void handleSplitAtTransientsFromToolbar() }}
              disabled={!canSplit}
              title={canSplit ? 'Split at Transients' : 'Select an audio clip to split at transients'}
              data-help-id="split-transients"
              style={{
                ...toolBtn,
                opacity: canSplit ? 1 : 0.4,
                cursor: canSplit ? 'pointer' : 'not-allowed',
              }}
            >
              <Scissors size={13} />
            </button>
          )
        })()}

        {/* Spectral Morph — visible when exactly 2 audio clips are selected */}
        {(() => {
          const ids = [...selectedClipIds]
          const twoAudio = ids.length === 2 &&
            ids.every(id => {
              const c = project.arrangementClips.find(x => x.id === id)
              return c && isAudioClip(c)
            })
          if (!twoAudio) return null
          return (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <div style={{ width: 1, height: 16, background: 'var(--border)' }} />
              <button
                onClick={() => void handleMorph()}
                disabled={morphing}
                title="Spectral Morph — blend two selected audio clips into a new clip"
                data-help-id="morph"
                style={{
                  ...toolBtn, width: 'auto', padding: '2px 8px',
                  fontSize: 9, fontWeight: 700, letterSpacing: '0.04em',
                  background: morphing ? 'rgb(var(--accent-rgb) / 0.18)' : 'rgb(var(--accent-rgb) / 0.08)',
                  border: '1px solid rgb(var(--accent-rgb) / 0.5)',
                  color: 'var(--accent-light)',
                  cursor: morphing ? 'wait' : 'pointer',
                  gap: 5, display: 'flex', alignItems: 'center',
                }}
              >
                <Blend size={11} />
                {morphing ? 'MORPHING…' : 'MORPH'}
              </button>
              <input
                type="number" min={0.5} max={30} step={0.5}
                value={morphDuration}
                onChange={e => setMorphDuration(Math.max(0.5, parseFloat(e.target.value) || 3))}
                title="Morph duration in seconds"
                style={{
                  width: 40, background: 'var(--bg-base)', border: '1px solid var(--border)',
                  borderRadius: 3, color: 'var(--text-primary)', fontSize: 10,
                  fontFamily: 'monospace', padding: '1px 4px', textAlign: 'center',
                }}
              />
              <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>s</span>
              {morphError && <span style={{ fontSize: 9, color: '#ef4444', maxWidth: 120 }}>{morphError}</span>}
            </div>
          )
        })()}

        <div style={{ flex: 1 }} />
        {audioMode !== 'podcast' && (() => {
          // One editor button, routed by clip type. Label reflects the selected
          // clip (piano roll vs beat); the caret creates a new one of either kind.
          const selClip = selectedClipId ? project.arrangementClips.find(c => c.id === selectedClipId) : null
          const selMidi = selClip && isMidiClip(selClip) ? selClip : null
          const label = selMidi ? (selMidi.isDrumClip ? 'BEAT' : 'PIANO ROLL') : 'EDITOR'
          const active = !!(expandedPianoRollClipId || expandedStepSeqClipId)
          const menuItem: React.CSSProperties = { display: 'block', width: '100%', textAlign: 'left', padding: '6px 10px', fontSize: 10, background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', whiteSpace: 'nowrap' }
          return (
          <div ref={editorDropdownRef} style={{ position: 'relative', display: 'flex' }}>
            <button onClick={openEditor} title="Open the editor for the selected clip — piano roll for melodic clips, step sequencer for beats" data-help-id="editor" style={{
              ...toolBtn, width: 'auto', padding: '2px 8px', fontSize: 9, fontWeight: 700,
              borderStyle: 'solid', borderWidth: '1px 0 1px 1px', borderColor: active ? 'var(--accent)' : 'var(--border)',
              background: active ? 'rgb(var(--accent-rgb) / 0.18)' : 'transparent',
              color: active ? 'var(--accent-light)' : 'var(--text-muted)',
              letterSpacing: '0.04em', borderRadius: '3px 0 0 3px',
            }}>{label}</button>
            <button onClick={() => setShowEditorMenu(m => !m)} title="Create a new piano roll or beat" style={{
              ...toolBtn, width: 14, padding: 0, fontSize: 9,
              border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
              background: showEditorMenu ? 'var(--bg-card)' : active ? 'rgb(var(--accent-rgb) / 0.18)' : 'transparent',
              color: active ? 'var(--accent-light)' : 'var(--text-muted)', borderRadius: '0 3px 3px 0',
            }}><ChevronDown size={11} /></button>
            {showEditorMenu && (
              <div className="menu-pop" style={{ position: 'absolute', top: '100%', right: 0, marginTop: 2, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 4, zIndex: 1000, minWidth: 150, overflow: 'hidden', boxShadow: '0 4px 12px rgba(0,0,0,0.5)' }}>
                <button style={{ ...menuItem, display: 'flex', alignItems: 'center', gap: 8 }} onClick={() => { setShowEditorMenu(false); createEditorClip('roll') }}><Music size={13} /> New Piano Roll</button>
                <button style={{ ...menuItem, borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }} onClick={() => { setShowEditorMenu(false); createEditorClip('beat') }}><Grid3x3 size={13} /> New Beat</button>
              </div>
            )}
            {prHint && (
              <div style={{
                position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 300,
                whiteSpace: 'nowrap', fontSize: 10, padding: '4px 9px', borderRadius: 5,
                background: 'var(--bg-card)', border: '1px solid rgba(250,204,21,0.45)', color: '#facc15',
                boxShadow: '0 6px 18px rgba(0,0,0,0.5)', pointerEvents: 'none',
              }}>{prHint}</div>
            )}
          </div>
          )
        })()}
        {/* Export split button */}
        <div ref={exportDropdownRef} style={{ position: 'relative', display: 'flex', marginLeft: 4 }}>
          <button
            onClick={() => { if (isGuest && requireAccount) { requireAccount('export'); return } setShowExport(true) }}
            title={isGuest ? 'Sign up to export your mix' : 'Export project audio'}
            data-help-id="export"
            style={{
              ...toolBtn, width: 'auto', padding: '2px 8px', fontSize: 9, fontWeight: 700,
              borderStyle: 'solid', borderWidth: '1px 0 1px 1px', borderColor: 'var(--border)', background: 'transparent',
              color: 'var(--text-muted)', letterSpacing: '0.04em',
              borderRadius: '3px 0 0 3px',
            }}
          >EXPORT</button>
          <button
            onClick={() => setShowExportDropdown(d => !d)}
            title="Choose export format"
            style={{
              ...toolBtn, width: 14, padding: 0, fontSize: 9,
              border: '1px solid var(--border)',
              background: showExportDropdown ? 'var(--bg-card)' : 'transparent',
              color: 'var(--text-muted)', borderRadius: '0 3px 3px 0',
            }}
          ><ChevronDown size={11} /></button>
          {showExportDropdown && (
            <div className="menu-pop" style={{
              position: 'absolute', top: '100%', right: 0, marginTop: 2,
              background: 'var(--bg-card)', border: '1px solid var(--border)',
              borderRadius: 4, zIndex: 1000, minWidth: 130, overflow: 'hidden',
              boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
            }}>
              {(['webm', 'wav'] as const).map((f, fi) => (
                <button
                  key={f}
                  onClick={() => { setExportDefaultFormat(f); setShowExportDropdown(false); setShowExport(true) }}
                  style={{
                    display: 'block', width: '100%', padding: '6px 10px',
                    textAlign: 'left', background: 'transparent', border: 'none',
                    borderBottom: fi === 0 ? '1px solid var(--border)' : 'none',
                    color: 'var(--text-secondary)', fontSize: 11, cursor: 'pointer',
                  }}
                >
                  {f === 'wav' ? 'WAV (lossless)' : 'WebM/Opus'}
                </button>
              ))}
            </div>
          )}
        </div>
        {audioMode === 'podcast' && (
          <>
            <button
              onClick={() => {
                const beat = engine.currentBeat
                const name = `Chapter ${(project.cueMarkers ?? []).length + 1}`
                dispatch({ type: 'ADD_CUE_MARKER', marker: { id: `cue-${Date.now()}`, beat, name } })
              }}
              title="Add chapter marker at playhead position (or double-click ruler)"
              data-help-id="chapter"
              style={{
                ...toolBtn, width: 'auto', padding: '2px 10px', fontSize: 9, fontWeight: 700,
                border: '1px solid #f59e0b', background: 'rgba(245,158,11,0.1)',
                color: '#f59e0b', letterSpacing: '0.04em', marginLeft: 4,
              }}
            >+ CHAPTER</button>
            <button
              onClick={() => { setShowPublish(true); setPublishFeedUrl(null); setPublishError(null) }}
              title="Publish podcast RSS feed"
              data-help-id="publish"
              style={{
                ...toolBtn, width: 'auto', padding: '2px 10px', fontSize: 9, fontWeight: 700,
                border: '1px solid var(--border)', background: 'transparent',
                color: 'var(--text-muted)', letterSpacing: '0.04em', marginLeft: 4,
              }}
            >PUBLISH</button>
          </>
        )}
        {!isGuest && <ProjectSwitcher currentId={project.id} label="Projects" dirty={dawDirty} />}
        {onSave && (
          <div ref={saveDropdownRef} style={{ position: 'relative', display: 'flex', marginLeft: 4 }}>
            <button
              onClick={() => { if (saveDest === 'local' && onSaveLocal) void onSaveLocal(); else void onSave?.() }}
              disabled={isSaving}
              title={saveDest === 'local' ? 'Save a .cfproj to your computer (⌘S)' : isGuest ? 'Sign up to save to your account (⌘S)' : 'Save to your account (⌘S)'}
              data-help-id="save"
              style={{
                ...toolBtn, width: 'auto', padding: '2px 8px', fontSize: 9, fontWeight: 700,
                borderStyle: 'solid', borderWidth: '1px 0 1px 1px', borderColor: saveNudge ? 'var(--accent)' : 'var(--border)',
                background: isSaving ? 'rgba(34,197,94,0.15)' : saveNudge ? 'rgb(var(--accent-rgb) / 0.15)' : 'transparent',
                color: isSaving ? '#4ade80' : saveNudge ? 'var(--accent-light)' : 'var(--text-muted)',
                letterSpacing: '0.04em', borderRadius: '3px 0 0 3px',
                animation: saveNudge ? 'saveNudge 1.3s ease-in-out 2' : undefined,
              }}
            >{isSaving ? 'SAVING…' : saveDest === 'local' ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>SAVE <HardDrive size={11} /></span> : 'SAVE'}</button>
            <button
              onClick={() => setShowSaveDropdown(d => !d)}
              title="Where to save"
              style={{
                ...toolBtn, width: 14, padding: 0, fontSize: 9,
                border: `1px solid ${saveNudge ? 'var(--accent)' : 'var(--border)'}`,
                background: showSaveDropdown ? 'var(--bg-card)' : 'transparent',
                color: 'var(--text-muted)', borderRadius: '0 3px 3px 0',
              }}
            ><ChevronDown size={11} /></button>
            {showSaveDropdown && (
              <div className="menu-pop" style={{ position: 'absolute', top: '100%', right: 0, marginTop: 2, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 4, zIndex: 1000, minWidth: 214, overflow: 'hidden', boxShadow: '0 4px 12px rgba(0,0,0,0.5)' }}>
                <div style={{ padding: '7px 11px 4px', fontSize: 8.5, letterSpacing: '0.08em', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Where to save</div>
                <button onClick={() => { setSaveDest('cloud'); try { localStorage.setItem('100lights-save-dest', 'cloud') } catch { /* private mode */ } setShowSaveDropdown(false); void onSave?.() }}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 11px', textAlign: 'left', background: saveDest === 'cloud' ? 'rgb(var(--accent-rgb) / 0.12)' : 'transparent', border: 'none', color: saveDest === 'cloud' ? 'var(--accent-light)' : 'var(--text-secondary)', fontSize: 11.5, cursor: 'pointer' }}>
                  <Cloud size={14} style={{ flexShrink: 0 }} /> <span style={{ flex: 1 }}>Cloud — your account</span>{saveDest === 'cloud' && <Check size={13} />}
                </button>
                {onSaveLocal && (
                  <button onClick={() => { setSaveDest('local'); try { localStorage.setItem('100lights-save-dest', 'local') } catch { /* private mode */ } setShowSaveDropdown(false); void onSaveLocal() }}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 11px', textAlign: 'left', background: saveDest === 'local' ? 'rgb(var(--accent-rgb) / 0.12)' : 'transparent', border: 'none', color: saveDest === 'local' ? 'var(--accent-light)' : 'var(--text-secondary)', fontSize: 11.5, cursor: 'pointer' }}>
                    <HardDrive size={14} style={{ flexShrink: 0 }} /> <span style={{ flex: 1 }}>This computer — a .cfproj file</span>{saveDest === 'local' && <Check size={13} />}
                  </button>
                )}
                <button onClick={async () => { setShowSaveDropdown(false); try { const { pickWritableFolder } = await import('@/lib/local-folder'); await pickWritableFolder() } catch { /* cancelled */ } }}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 11px', textAlign: 'left', background: 'transparent', border: 'none', borderTop: '1px solid var(--border)', color: 'var(--text-muted)', fontSize: 11, cursor: 'pointer' }}>
                  <Folder size={14} style={{ flexShrink: 0 }} /> Set a local folder…
                </button>
                <div style={{ padding: '6px 11px 8px', fontSize: 9.5, color: 'var(--text-muted)', lineHeight: 1.4, borderTop: '1px solid var(--border)' }}>
                  Local saves don&rsquo;t count against your project limit.
                </div>
              </div>
            )}
          </div>
        )}
        <VersionHistory />
      </div>
      )}

      {/* Ruler row */}
      <div style={{ display: 'flex', flexShrink: 0 }} onWheel={handleWheel}>
        <div style={{ width: hdrW, height: RULER_H, flexShrink: 0, background: 'var(--bg-surface)', borderRight: '1px solid var(--border)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
          {isMobile && (
            <button onClick={() => setNarrowHeads(v => !v)} title={narrowHeads ? 'Expand track heads' : 'Minimize track heads'} aria-label={narrowHeads ? 'Expand track heads' : 'Minimize track heads'}
              style={{ width: 30, height: 26, borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-secondary)', fontSize: 13, cursor: 'pointer', marginRight: 4, flexShrink: 0 }}>
              {narrowHeads ? '⟩' : '⟨'}
            </button>
          )}
        </div>
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <Ruler beatW={beatW} scrollLeft={scrollLeft} snap={snap} onSeek={b => { engine.seek(b); setPosition(b) }} onEditTimeSig={handleEditTimeSig} onOpenComment={(id, x, y) => setOpenComment({ id, x, y })} />
        </div>
      </div>

      {/* Track rows */}
      <div
        ref={laneRef}
        // pan-y lets the browser scroll the track list vertically with one
        // finger (needed on short/landscape screens); horizontal + pinch are
        // handled below, so they aren't swallowed by the browser.
        style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', position: 'relative', touchAction: isMobile ? 'pan-y' : undefined }}
        onWheel={handleWheel}
        onMouseDown={isMobile ? undefined : onLaneMouseDown}
        // Mobile: double-tap the blank lane toggles play; 1 finger drags to
        // SCROLL — horizontal pans the timeline, vertical scrolls the tracks;
        // 2 fingers pinch-zoom. The playhead is moved from the scrub bar in the
        // transport (so scrolling never nudges it by accident).
        onDoubleClick={isMobile ? (e => {
          if (e.target !== e.currentTarget) return
          if (engine.isPlaying) engine.stop(); else void engine.play()
        }) : undefined}
        onTouchStart={isMobile ? (e => {
          const lane = laneRef.current; if (!lane) return
          if (e.touches.length >= 2) {
            const a = e.touches[0], b = e.touches[1]
            laneGesture.current = {
              mode: 'gesture', locked: null,
              startDist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1,
              startBeatW: beatW,
              midX: (a.clientX + b.clientX) / 2, midY: (a.clientY + b.clientY) / 2,
              startSL: scrollLeft, startST: lane.scrollTop,
            }
            return
          }
          if (e.target !== e.currentTarget) { laneGesture.current = null; return }
          const t = e.touches[0]
          laneGesture.current = { mode: 'pan', locked: null, startX: t.clientX, startY: t.clientY, startSL: scrollLeft, startST: lane.scrollTop }
        }) : undefined}
        onTouchMove={isMobile ? (e => {
          const g = laneGesture.current; const lane = laneRef.current
          if (!g || !lane) return
          if (g.mode === 'gesture' && e.touches.length >= 2) {
            const a = e.touches[0], b = e.touches[1]
            const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1
            const midX = (a.clientX + b.clientX) / 2, midY = (a.clientY + b.clientY) / 2
            // Lock into pan OR zoom on first meaningful motion so scrolling
            // (fingers together) never triggers incidental zoom → no jitter.
            if (g.locked === null) {
              const dDist = Math.abs(dist - g.startDist)
              const dMid = Math.hypot(midX - g.midX, midY - g.midY)
              if (dDist < 10 && dMid < 10) return // deadzone — wait for intent
              g.locked = dDist > dMid ? 'zoom' : 'pan'
            }
            if (g.locked === 'zoom') {
              setBeatW(Math.max(MIN_BEAT_W, Math.min(MAX_BEAT_W, g.startBeatW * (dist / g.startDist))))
            } else {
              setScrollLeft(Math.max(MIN_SCROLL, g.startSL - (midX - g.midX)))
              lane.scrollTop = Math.max(0, g.startST - (midY - g.midY))
            }
          } else if (g.mode === 'pan' && e.touches.length === 1) {
            const t = e.touches[0]
            // Lock direction on first motion: a vertical drag is a native track
            // scroll (leave it to the browser via touch-action: pan-y); a
            // horizontal drag pans the timeline. The playhead is NOT touched
            // here — it's moved from the transport scrub bar instead.
            if (g.locked === null) {
              const dx = Math.abs(t.clientX - g.startX), dy = Math.abs(t.clientY - g.startY)
              if (dx < 8 && dy < 8) return
              g.locked = dx > dy ? 'pan' : 'scroll'
            }
            if (g.locked !== 'pan') return
            setScrollLeft(Math.max(MIN_SCROLL, g.startSL - (t.clientX - g.startX)))
          }
        }) : undefined}
        onTouchEnd={isMobile ? (e => { if (e.touches.length === 0) laneGesture.current = null }) : undefined}
      >
        {/* "Everything" tier: full-height timeline dividers at every tempo change
             (orange), time-signature change (indigo) and section boundary (section
             colour) — any change of BPM or meter splits the timeline. */}
        {showTimelineDividers && (
          <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 2 }}>
            {[
              ...(project.tempoMarkers ?? []).map(m => ({ beat: m.beat, color: '#fb923c', key: 'tm' + m.id })),
              ...(project.meterMarkers ?? []).map(m => ({ beat: m.beat, color: '#818cf8', key: 'mm' + m.id })),
              ...(project.sections ?? []).map(s => ({ beat: s.beat, color: s.color || 'var(--text-muted)', key: 'sec' + s.id })),
            ].map(d => {
              const x = hdrW + d.beat * beatW - scrollLeft
              if (x < hdrW - 1) return null
              return <div key={d.key} style={{ position: 'absolute', top: 0, bottom: 0, left: x, width: 1, background: d.color, opacity: 0.4 }} />
            })}
          </div>
        )}

        {/* Music empty-state hint: point brand-new users at the library */}
        {audioMode !== 'podcast' && project.arrangementClips.length === 0 && project.tracks.length > 0 && (
          <div style={{
            position: 'absolute', left: hdrW, right: 0, top: 0, bottom: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            pointerEvents: 'none', zIndex: 1,
          }}>
            <span style={{
              fontSize: 12, color: 'var(--text-muted)',
              textAlign: 'center', lineHeight: 1.9,
              background: 'rgba(0,0,0,0.4)', padding: '12px 20px', borderRadius: 8,
            }}>
              <b style={{ color: 'var(--text-secondary)' }}>Drag a sound in from the library</b> on the left (press <b>B</b> to show it)<br/>
              <span style={{ fontSize: 10.5, opacity: 0.8 }}>
                …or right-click this lane for a piano roll or a library sound · record with ● · try a Recipe from the library’s Recipes tab
              </span>
            </span>
          </div>
        )}

        {/* Podcast empty-state hint */}
        {audioMode === 'podcast' && project.arrangementClips.length === 0 && project.tracks.length > 0 && (
          <div style={{
            position: 'absolute', left: hdrW, right: 0, top: 0, bottom: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            pointerEvents: 'none', zIndex: 1,
          }}>
            <span style={{
              fontSize: 12, color: 'var(--text-muted)',
              textAlign: 'center', lineHeight: 1.8,
              background: 'rgba(0,0,0,0.4)', padding: '10px 18px', borderRadius: 6,
            }}>
              Arm a track (click the ● button), then press Record to capture audio<br/>
              <span style={{ fontSize: 10, opacity: 0.7 }}>Add chapter markers with the + CHAPTER button or by double-clicking the ruler</span>
            </span>
          </div>
        )}

        {visibleTracks.map(track => (
          <TrackRow
            key={track.id}
            track={track}
            beatW={beatW}
            scrollLeft={scrollLeft}
            viewWidth={viewWidth}
            headWidth={hdrW}
            compactHead={isMobile && narrowHeads}
            snap={snap}
            onScrollBy={delta => setScrollLeft(s => Math.max(MIN_SCROLL, s + delta))}
            waveformZoom={project.waveformZoom}
            selectedTrackIds={selectedTrackIds}
            onSelectTrack={ctrl => handleSelectTrack(track.id, ctrl)}
            onItemSelect={clearAreaSelection}
            foldedGroups={foldedGroups}
            onToggleFold={() => setFoldedGroups(prev => {
              const next = new Set(prev)
              if (next.has(track.id)) next.delete(track.id)
              else next.add(track.id)
              return next
            })}
            onGroupTracks={handleGroupTracks}
            onReorderDrop={handleTrackDrop}
            rippleEdit={rippleEdit}
            onCopyClips={handleCopyClips}
            getSelectionRegion={() => selectionRegionRef.current}
            selectionRegion={selectionRegion}
            isSelectionTrack={selectionTracks.has(track.id)}
            onSelectionResize={(end) => setSelectionRegion(r => (r ? { start: r.start, end } : r))}
            onSelectionLoopCommit={commitSelectionLoop}
            onPasteClips={handlePasteClips}
            onCopyEffects={handleCopyEffects}
            onPasteEffects={handlePasteEffects}
          />
        ))}

        {/* Return track rows — non-editable, appear above add buttons */}
        {project.returnTracks.length > 0 && (
          <>
            <div style={{ display: 'flex', height: 20, alignItems: 'center', background: 'rgba(100,60,150,0.08)', borderBottom: '1px solid var(--border)' }}>
              <div style={{ width: hdrW, flexShrink: 0, paddingLeft: 8, borderRight: '1px solid var(--border)' }}>
                <span style={{ fontSize: 8, fontWeight: 700, color: '#7c5fa8', letterSpacing: '0.07em', textTransform: 'uppercase' }}>Returns</span>
              </div>
              <div style={{ flex: 1 }} />
            </div>
            {project.returnTracks.map((rt, idx) => (
              <ReturnTrackRow key={rt.id} rt={rt} idx={idx} dispatch={dispatch} />
            ))}
          </>
        )}

        {/* Add track buttons — hidden on mobile (the bottom-nav "Track" covers it) */}
        <div style={{ display: isMobile ? 'none' : 'flex', height: 36 }}>
          <div style={{ width: hdrW, flexShrink: 0, display: 'flex', gap: 4, padding: 8, borderRight: '1px solid var(--border)' }}>
            <button onClick={() => dispatch({ type: 'ADD_TRACK' })}
              data-help-id="add-track"
              style={{ flex: 1, padding: '3px 0', fontSize: 9, borderRadius: 3, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-muted)', cursor: 'pointer', animation: blinkIds.has('add-track') ? 'dawBlink 0.45s ease-in-out 3' : undefined }}>
              +Track
            </button>
            <button
              onClick={addReturnTrack}
              title="Add return track"
              data-help-id="add-return"
              style={{ padding: '3px 6px', fontSize: 9, borderRadius: 3, border: '1px solid #7c5fa8', background: 'rgba(100,60,150,0.12)', color: 'var(--accent-light)', cursor: 'pointer', flexShrink: 0 }}
            >+Ret</button>
            {onGenerateMusic && (
              <button
                onClick={onGenerateMusic}
                title="Generate music with AI"
                data-help-id="generate-music"
                style={{ padding: '3px 6px', fontSize: 9, borderRadius: 3, border: '1px solid var(--accent)', background: 'rgb(var(--accent-rgb) / 0.14)', color: 'var(--accent-light)', cursor: 'pointer', flexShrink: 0 }}
              >✨ AI</button>
            )}
          </div>
        </div>
      </div>

      {/* Rubber-band selection rect */}
      {rubberBand && (
        <div style={{
          position: 'fixed',
          left: Math.min(rubberBand.x1, rubberBand.x2),
          top:  Math.min(rubberBand.y1, rubberBand.y2),
          width:  Math.abs(rubberBand.x2 - rubberBand.x1),
          height: Math.abs(rubberBand.y2 - rubberBand.y1),
          border: '1px solid rgb(var(--accent-rgb) / 0.7)',
          background: 'rgb(var(--accent-rgb) / 0.08)',
          pointerEvents: 'none',
          zIndex: 200,
        }} />
      )}

      {/* Global playhead overlay — clipped to track content area so it stays behind the header */}
      <div style={{ position: 'absolute', left: hdrW, right: 0, top: 30 + RULER_H, bottom: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 10 }}>
        <div ref={playheadRef} style={{ position: 'absolute', top: 0, bottom: 0, width: 2, background: '#ff5a5a', boxShadow: '0 0 6px rgba(255,80,80,0.9), 0 0 1px rgba(255,255,255,0.6)', zIndex: 5, pointerEvents: 'none' }} />
        {/* Collaborators' playheads — where each of them is listening right now */}
        {collabPeers.filter(pr => pr.playheadBeat != null).map(pr => {
          const gx = (pr.playheadBeat as number) * beatW - scrollLeft
          if (gx < -4 || gx > viewWidth + 4) return null
          return (
            <div key={pr.connectionId} style={{ position: 'absolute', top: 0, bottom: 0, left: gx, width: 1.5, background: pr.color, opacity: 0.65, zIndex: 4, pointerEvents: 'none' }}>
              <span style={{ position: 'absolute', top: 2, left: 3, fontSize: 7.5, fontWeight: 800, color: pr.color, background: 'rgba(10,10,16,0.85)', padding: '0 4px', borderRadius: 3, whiteSpace: 'nowrap' }}>
                ▶ {pr.name.split(' ')[0]}
              </span>
            </div>
          )
        })}
      </div>

      {/* Time signature popover */}
      {newCommentAt && (
        <CommentComposer beat={newCommentAt.beat} anchor={{ x: newCommentAt.x, y: newCommentAt.y }} onClose={() => setNewCommentAt(null)} />
      )}
      {openComment && (
        <CommentThread commentId={openComment.id} anchor={{ x: openComment.x, y: openComment.y }} onClose={() => setOpenComment(null)} />
      )}
      {tsPopover && createPortal(
        <div ref={tsPopoverRef} style={{
          position: 'fixed', top: tsPopover.y - 110, left: tsPopover.x,
          background: 'var(--bg-card)', border: '1px solid var(--border)',
          borderRadius: 6, padding: '10px 12px', zIndex: 1000,
          boxShadow: '0 4px 16px rgba(0,0,0,0.7)', display: 'flex',
          flexDirection: 'column', gap: 8, minWidth: 140,
        }}>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.06em' }}>TIME SIGNATURE</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="number" min={1} max={16} value={tsDraftNum}
              onChange={e => setTsDraftNum(Math.max(1, parseInt(e.target.value) || 4))}
              onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') { dispatch({ type: 'SET_TIME_SIG', num: tsDraftNum, den: tsDraftDen }); setTsPopover(null) } }}
              style={{ width: 40, background: 'var(--bg-base)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 14, fontFamily: 'monospace', borderRadius: 3, padding: '3px 5px', outline: 'none', textAlign: 'center' }}
            />
            <span style={{ color: 'var(--text-muted)', fontSize: 16 }}>/</span>
            <select value={tsDraftDen} onChange={e => setTsDraftDen(parseInt(e.target.value))}
              style={{ width: 48, background: 'var(--bg-base)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 14, fontFamily: 'monospace', borderRadius: 3, padding: '3px 4px', outline: 'none', cursor: 'pointer' }}>
              {[2, 4, 8, 16].map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.06em', marginTop: 2 }}>TEMPO</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="text" inputMode="decimal" value={tsDraftBpmText}
              onChange={e => setTsDraftBpmText(e.target.value)}
              onFocus={e => e.currentTarget.select()}
              onBlur={commitTsBpm}
              onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') { const bpm = commitTsBpm(); dispatch({ type: 'SET_TIME_SIG', num: tsDraftNum, den: tsDraftDen }); dispatch({ type: 'SET_TEMPO', tempo: bpm }); setTsPopover(null) } }}
              style={{ width: 62, background: 'var(--bg-base)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 14, fontFamily: 'monospace', borderRadius: 3, padding: '3px 5px', outline: 'none', textAlign: 'center' }}
            />
            <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>BPM</span>
          </div>
          <button
            onClick={() => {
              setNewCommentAt({ beat: tsPopover?.beat ?? 0, x: tsPopover?.x ?? 200, y: tsPopover?.y ?? 200 })
              setTsPopover(null)
            }}
            title="Pin feedback to this spot — collaborators see it on the timeline"
            style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.4)', color: '#f59e0b', fontSize: 10.5, borderRadius: 3, padding: '5px 0', cursor: 'pointer', fontWeight: 700 }}>
            <MessageSquare size={13} /> Comment here
          </button>
          <button
            onClick={() => {
              const palette = ['#60a5fa', '#34d399', '#f472b6', '#facc15', 'var(--accent-light)', '#fb923c']
              const n = (project.sections ?? []).length
              dispatch({ type: 'ADD_SECTION', section: { id: crypto.randomUUID(), beat: tsPopover?.beat ?? 0, name: `Section ${n + 1}`, color: palette[n % palette.length] } })
              setTsPopover(null)
            }}
            title="Marks an arrangement section (verse, chorus…) from this bar to the next section"
            style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, background: 'rgba(96,165,250,0.1)', border: '1px solid rgba(96,165,250,0.4)', color: '#60a5fa', fontSize: 10.5, borderRadius: 3, padding: '5px 0', cursor: 'pointer', fontWeight: 700 }}>
            <RectangleHorizontal size={13} /> Section starts here
          </button>
          <button
            onClick={() => {
              dispatch({ type: 'ADD_TEMPO_MARKER', marker: { id: crypto.randomUUID(), beat: tsPopover?.beat ?? 0, tempo: commitTsBpm() } })
              setTsPopover(null)
            }}
            title="Playback switches to this BPM when the playhead reaches this bar"
            style={{ background: 'rgba(251,146,60,0.12)', border: '1px solid rgba(251,146,60,0.45)', color: '#fb923c', fontSize: 10.5, borderRadius: 3, padding: '5px 0', cursor: 'pointer', fontWeight: 700 }}>
            ♩ Tempo change here → {parseTsBpm()} BPM
          </button>
          <button
            onClick={() => {
              // Meter changes land on a bar boundary so the grid stays clean.
              const at = nearestBarBeat(tsPopover?.beat ?? 0, mSegs)
              dispatch({ type: 'ADD_METER_MARKER', marker: { id: crypto.randomUUID(), beat: at, num: tsDraftNum, den: tsDraftDen } })
              setTsPopover(null)
            }}
            title="The bar grid and snapping switch to this time signature from this bar on"
            style={{ background: 'rgba(129,140,248,0.12)', border: '1px solid rgba(129,140,248,0.45)', color: '#818cf8', fontSize: 10.5, borderRadius: 3, padding: '5px 0', cursor: 'pointer', fontWeight: 700 }}>
            𝄞 Time-sig change here → {tsDraftNum}/{tsDraftDen}
          </button>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => { const bpm = commitTsBpm(); dispatch({ type: 'SET_TIME_SIG', num: tsDraftNum, den: tsDraftDen }); dispatch({ type: 'SET_TEMPO', tempo: bpm }); setTsPopover(null) }}
              style={{ flex: 1, background: 'var(--accent)', border: 'none', color: 'var(--accent-contrast)', fontSize: 11, borderRadius: 3, padding: '5px 0', cursor: 'pointer', fontWeight: 600 }}>
              Apply
            </button>
            <button onClick={() => setTsPopover(null)}
              style={{ flex: 1, background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)', fontSize: 11, borderRadius: 3, padding: '5px 0', cursor: 'pointer' }}>
              Cancel
            </button>
          </div>
        </div>,
        document.body
      )}
      {(showExport || resumeExport) && <AudioExportModal onClose={() => { setShowExport(false); setExportDefaultFormat('webm'); clearResumeExport?.() }} audioMode={audioMode} podcastMeta={podcastMeta} defaultFormat={exportDefaultFormat} />}
      {/* Split at Transients dialog (toolbar-triggered) */}
      {arrangeTransientDialog && typeof document !== 'undefined' && createPortal(
        <div
className="electron-nodrag"
style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.65)' }}
          onClick={e => { if (e.target === e.currentTarget) setArrangeTransientDialog(null) }}
        >
          <div style={{
            background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8,
            padding: '20px 22px', width: 340, maxWidth: '90vw',
            boxShadow: '0 12px 40px rgba(0,0,0,0.7)',
          }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 10 }}>Split at Transients</div>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 14, lineHeight: 1.5 }}>
              {arrangeTransientDialog.transients.length === 0
                ? 'No transients detected at this sensitivity.'
                : `Detected ${arrangeTransientDialog.transients.length} split point${arrangeTransientDialog.transients.length !== 1 ? 's' : ''}. Proceed?`}
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18 }}>
              <span style={{ fontSize: 10, color: 'var(--text-muted)', flexShrink: 0 }}>Sensitivity</span>
              <input
                type="range" min={0.5} max={5.0} step={0.1}
                value={arrangeTransientDialog.sensitivity}
                onChange={e => {
                  const sens = parseFloat(e.target.value)
                  const { buf, clip: ac } = arrangeTransientDialog
                  const newTransients = detectTransients(buf, ac.startBeat, project.tempo, sens, ac.trimStart ?? 0)
                    .filter(b => b > ac.startBeat + 0.01 && b < ac.startBeat + ac.durationBeats - 0.01)
                  setArrangeTransientDialog(d => d ? { ...d, sensitivity: sens, transients: newTransients } : null)
                }}
                className="cf-slider"
                style={{ flex: 1, accentColor: 'var(--accent)' }}
              />
              <span style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'monospace', minWidth: 28, textAlign: 'right' }}>
                {arrangeTransientDialog.sensitivity.toFixed(1)}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                disabled={arrangeTransientDialog.transients.length === 0}
                onClick={applyArrangeTransientSplit}
                style={{
                  flex: 1, padding: '7px 0', borderRadius: 4, border: 'none',
                  background: arrangeTransientDialog.transients.length === 0 ? 'var(--bg-card-hover)' : 'var(--accent)',
                  color: arrangeTransientDialog.transients.length === 0 ? 'var(--text-muted)' : '#fff',
                  fontSize: 12, fontWeight: 600,
                  cursor: arrangeTransientDialog.transients.length === 0 ? 'not-allowed' : 'pointer',
                }}
              >
                Proceed ({arrangeTransientDialog.transients.length} cuts)
              </button>
              <button
                onClick={() => setArrangeTransientDialog(null)}
                style={{ padding: '7px 14px', borderRadius: 4, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer' }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
      {showPublish && createPortal(
        <div
className="electron-nodrag"
style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.6)' }}
          onClick={e => { if (e.target === e.currentTarget) setShowPublish(false) }}
        >
          <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 24, width: 380, maxWidth: '90vw' }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 16 }}>Publish Podcast</div>
            {!publishFeedUrl ? (
              <>
                <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16, lineHeight: 1.5 }}>
                  Generate an RSS feed for your podcast episode. Submit the URL to Spotify, Apple Podcasts, or any podcast platform.
                </p>
                {publishError && (
                  <p style={{ fontSize: 11, color: '#f87171', marginBottom: 12 }}>{publishError}</p>
                )}
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    disabled={publishLoading}
                    onClick={async () => {
                      setPublishLoading(true)
                      setPublishError(null)
                      try {
                        const res = await fetch(`/api/podcast/${project.id}/publish`, { method: 'POST' })
                        const json = await res.json()
                        if (!res.ok) throw new Error(json.error ?? 'Failed to publish')
                        setPublishFeedUrl(json.feedUrl)
                      } catch (err: unknown) {
                        setPublishError(err instanceof Error ? err.message : 'Something went wrong')
                      } finally {
                        setPublishLoading(false)
                      }
                    }}
                    style={{ flex: 1, padding: '7px 0', borderRadius: 4, border: 'none', background: 'var(--accent)', color: 'var(--accent-contrast)', fontSize: 12, fontWeight: 600, cursor: publishLoading ? 'not-allowed' : 'pointer', opacity: publishLoading ? 0.6 : 1 }}
                  >{publishLoading ? 'Generating…' : 'Generate RSS Feed'}</button>
                  <button
                    onClick={() => setShowPublish(false)}
                    style={{ padding: '7px 14px', borderRadius: 4, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer' }}
                  >Cancel</button>
                </div>
              </>
            ) : (
              <>
                <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>Your RSS feed is ready:</p>
                <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
                  <input
                    readOnly
                    value={publishFeedUrl}
                    style={{ flex: 1, fontSize: 11, padding: '5px 8px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg-base)', color: 'var(--text-primary)', fontFamily: 'monospace' }}
                    onFocus={e => e.currentTarget.select()}
                  />
                  <button
                    onClick={() => navigator.clipboard.writeText(publishFeedUrl)}
                    style={{ padding: '5px 10px', borderRadius: 4, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', fontSize: 11, cursor: 'pointer' }}
                  >Copy</button>
                </div>
                <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 16, lineHeight: 1.5 }}>
                  Submit this URL to Spotify, Apple Podcasts, or any podcast platform.
                </p>
                <button
                  onClick={() => setShowPublish(false)}
                  style={{ width: '100%', padding: '7px 0', borderRadius: 4, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer' }}
                >Done</button>
              </>
            )}
          </div>
        </div>,
        document.body
      )}

      {/* Shared clip Sound panel — follows the selection, retargets on select */}
      {soundPanel && soundClips.length > 0 && (() => {
        const rep = soundClips[0]
        const track = project.tracks.find(t => t.id === rep.trackId)
        const presetLabel = isMidiClip(rep)
          ? ((rep as MidiClip).presetId
              ? getPresets().find(p => p.id === (rep as MidiClip).presetId)?.name ?? '?'
              : track && track.instrument.type !== 'none' ? `${track.instrument.type} (track)` : 'None')
          : ''
        return (
          <RollSoundPanel
            clip={rep}
            clips={soundClips}
            dispatch={dispatch}
            anchor={soundPanel}
            onClose={() => setSoundPanel(null)}
            presetLabel={presetLabel}
            retargetOnClipClick
          />
        )
      })()}
    </div>
  )
}

const toolBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  width: 26, height: 22, borderRadius: 3, border: '1px solid transparent',
  background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer',
}

// ── Mobile arrangement toolbar — Zoom / Snap-menu / Editor inline, the rest in
// a "More" sheet, all touch-sized. Desktop keeps the full inline toolbar above.
function snapLabel(m: SnapMode) { return m === 'off' ? 'Off' : m === 'beat' ? 'Beat' : m === 'bar' ? 'Bar' : m }

function MobileToolbar(p: {
  snap: SnapMode; setSnap: (m: SnapMode) => void; snapMenu: boolean; setSnapMenu: (v: boolean) => void
  onZoomIn: () => void; onZoomOut: () => void; onFit: () => void
  wfZoom: number; onWf: (d: number) => void
  ripple: boolean; onRipple: () => void
  editorActive: boolean; onEditor: () => void
  onExport: () => void; onSave?: () => void | Promise<void>; onSaveLocal?: () => void | Promise<void>; isSaving: boolean
  more: boolean; setMore: (v: boolean) => void
}) {
  const mTool: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'center', width: 42, height: 40, borderRadius: 9, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)', cursor: 'pointer', flexShrink: 0, fontSize: 16 }
  const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '11px 12px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: 13.5, fontWeight: 600, cursor: 'pointer', textAlign: 'left' }
  const round: React.CSSProperties = { width: 34, height: 34, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: 18, fontWeight: 700, cursor: 'pointer' }
  return (
    <div style={{ height: 46, display: 'flex', alignItems: 'center', gap: 6, padding: '0 8px', background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
      <button onClick={p.onZoomOut} style={mTool} aria-label="Zoom out"><ZoomOut size={16} /></button>
      <button onClick={p.onZoomIn} style={mTool} aria-label="Zoom in"><ZoomIn size={16} /></button>
      <div style={{ position: 'relative' }}>
        <button onClick={() => p.setSnapMenu(!p.snapMenu)} style={{ ...mTool, width: 'auto', padding: '0 12px', gap: 5, fontSize: 12.5, fontWeight: 700 }}>Snap: {snapLabel(p.snap)} <ChevronDown size={14} /></button>
        {p.snapMenu && (
          <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: 4, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, zIndex: 1000, overflow: 'hidden', minWidth: 130, boxShadow: '0 6px 18px rgba(0,0,0,0.5)' }}>
            {(['off', '1/16', '1/8', 'beat', 'bar'] as SnapMode[]).map(m => (
              <button key={m} onClick={() => { p.setSnap(m); p.setSnapMenu(false) }} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '11px 14px', fontSize: 13, background: p.snap === m ? 'rgb(var(--accent-rgb) / 0.14)' : 'transparent', border: 'none', color: p.snap === m ? 'var(--accent-light)' : 'var(--text-secondary)', cursor: 'pointer' }}>{snapLabel(m)}</button>
            ))}
          </div>
        )}
      </div>
      <button onClick={p.onEditor} style={{ ...mTool, width: 'auto', padding: '0 14px', fontSize: 12.5, fontWeight: 800, background: p.editorActive ? 'rgb(var(--accent-rgb) / 0.18)' : 'var(--bg-card)', color: p.editorActive ? 'var(--accent-light)' : 'var(--text-secondary)', border: `1px solid ${p.editorActive ? 'var(--accent)' : 'var(--border)'}` }}>Editor</button>
      <div style={{ flex: 1 }} />
      <button onClick={() => p.setMore(true)} style={mTool} aria-label="More tools"><MoreHorizontal size={18} /></button>
      {p.more && (
        <div onClick={() => p.setMore(false)} style={{ position: 'fixed', inset: 0, zIndex: 190, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-end' }}>
          <div onClick={e => e.stopPropagation()} style={{ width: '100%', background: 'var(--bg-surface)', borderTop: '1px solid var(--border)', borderRadius: '18px 18px 0 0', padding: '16px 16px calc(18px + env(safe-area-inset-bottom))' }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 14 }}><strong style={{ fontSize: 14, flex: 1 }}>Tools</strong><button onClick={() => p.setMore(false)} aria-label="Close" style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 20, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><X size={18} /></button></div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <button onClick={() => { p.onFit(); p.setMore(false) }} style={row}><Maximize2 size={16} /> Fit to window</button>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 2px' }}>
                <span style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>Waveform zoom</span>
                <button onClick={() => p.onWf(-1)} style={round}>−</button>
                <span style={{ minWidth: 22, textAlign: 'center', fontFamily: 'monospace', fontSize: 14 }}>{p.wfZoom}</span>
                <button onClick={() => p.onWf(1)} style={round}>+</button>
              </div>
              <button onClick={p.onRipple} style={{ ...row, borderColor: p.ripple ? '#f59e0b' : 'var(--border)', color: p.ripple ? '#f59e0b' : 'var(--text-primary)' }}>{p.ripple && <Check size={16} />}Ripple edit</button>
              <button onClick={() => { p.onExport(); p.setMore(false) }} style={row}><Download size={16} /> Export</button>
              {p.onSave && <button onClick={() => { void p.onSave!(); p.setMore(false) }} style={{ ...row, justifyContent: 'center', background: 'var(--accent)', color: '#fff', border: 'none', fontWeight: 800 }}>{p.isSaving ? 'Saving…' : 'Save project'}</button>}
              {p.onSaveLocal && <button onClick={() => { void p.onSaveLocal!(); p.setMore(false) }} style={row}><HardDrive size={16} /> Save to my computer (.cfproj)</button>}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
