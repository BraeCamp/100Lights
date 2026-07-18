'use client'

import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { ZoomIn, ZoomOut, Maximize2, Scissors, Blend } from 'lucide-react'
import { useDaw, makeMidiClip, makeAudioClip } from '@/lib/daw-state'
import { highlightHelpTargets } from './HelpButton'
import { isMidiClip, isAudioClip, TRACK_COLORS } from '@/lib/daw-types'
import type { ReturnTrack, AudioClip, DawClip } from '@/lib/daw-types'

// Module-level clipboards — persist across renders in the same session
interface ClipboardEntry { clips: DawClip[]; originBeat: number; regionSpan?: number | null; buffers: [string, AudioBuffer][] }
let _clipboard: ClipboardEntry | null = null
let _effectClipboard: import('@/lib/daw-types').ClipEffect[] | null = null
let _lastCopied: 'clips' | 'effects' | null = null
import { runSpectralMorph } from '@/lib/spectral-morph'
import TrackRow, { HDR_W, SnapMode, snapBeat } from './TrackRow'
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
  const { tempo, timeSignatureNum: sigNum, timeSignatureDen: sigDen, loopStart, loopEnd, loopEnabled, cueMarkers = [], tempoMarkers = [], sections = [], comments = [] } = project
  const pxPerSec = beatW * tempo / 60

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

    const INTERVALS = [0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60]
    const secInterval  = INTERVALS.find(iv => iv * pxPerSec >= 70) ?? 60
    const halfInterval = secInterval / 2
    const startTime    = scrollLeft / pxPerSec
    const endTime      = startTime + W / pxPerSec

    const firstHalfIdx = Math.floor(startTime / halfInterval)
    for (let i = firstHalfIdx; i * halfInterval <= endTime + halfInterval; i++) {
      if (i % 2 === 0) continue
      const x = Math.round(i * halfInterval * pxPerSec - scrollLeft)
      if (x < 0 || x > W) continue
      ctx.fillStyle = '#2d2d2d'
      ctx.fillRect(x, SEC_H - 5, 1, 5)
    }

    const firstMajorIdx = Math.floor(startTime / secInterval)
    for (let i = firstMajorIdx; i * secInterval <= endTime + secInterval; i++) {
      const t = i * secInterval
      const x = Math.round(t * pxPerSec - scrollLeft)
      if (x < -30 || x > W + 30) continue
      ctx.fillStyle = '#3d3d3d'
      ctx.fillRect(x, 2, 1, SEC_H - 3)
      const mins = Math.floor(t / 60)
      const secs = Math.floor(t % 60)
      ctx.fillStyle = '#ccc'
      ctx.font = '9px monospace'
      ctx.fillText(`${mins}:${String(secs).padStart(2, '0')}`, x + 3, 11)
    }

    const pxPerBar  = beatW * sigNum
    if (pxPerBar >= 6) {
      const firstBar   = Math.floor(scrollLeft / pxPerBar)
      const labelEvery = Math.max(1, Math.ceil(36 / pxPerBar))
      for (let bar = firstBar; bar * pxPerBar <= scrollLeft + W + pxPerBar; bar++) {
        const x = Math.round(bar * pxPerBar - scrollLeft)
        if (x >= -1 && x <= W + 1) {
          ctx.fillStyle = '#3a3a3a'
          ctx.fillRect(x, SEC_H + 1, 1, BAR_H - 1)
        }
        if (pxPerBar >= 24) {
          for (let b = 1; b < sigNum; b++) {
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
          onEditTimeSig(e, Math.max(0, snapBeat((e.clientX - rect.left + scrollLeft) / beatW, snap, sigNum)))
        }}
        onDoubleClick={e => {
          const rect  = e.currentTarget.getBoundingClientRect()
          const localY = e.clientY - rect.top
          if (localY >= SEC_H) return
          const beat = Math.max(0, snapBeat((e.clientX - rect.left + scrollLeft) / beatW, snap, sigNum))
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
                style={{ position: 'absolute', top: -2, left: 3, width: 90, fontSize: 9, fontWeight: 700, color: s.color, background: '#111', border: `1px solid ${s.color}`, borderRadius: 2, padding: '0 3px', outline: 'none', pointerEvents: 'auto', zIndex: 5 }}
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
              title={`${marker.name || 'Cue'} — right-click to remove`}
              style={{ position: 'absolute', top: 0, left: 0, background: marker.color ?? '#f59e0b', color: '#000', fontSize: 8, padding: '1px 3px', borderRadius: '0 2px 2px 0', whiteSpace: 'nowrap', fontWeight: 700, maxWidth: 60, overflow: 'hidden', textOverflow: 'ellipsis', cursor: 'context-menu', pointerEvents: 'auto' }}
              onContextMenu={e => { e.preventDefault(); e.stopPropagation(); dispatch({ type: 'REMOVE_CUE_MARKER', markerId: marker.id }) }}
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
              background: c.resolved ? '#3a3f4a' : '#f59e0b', border: '1px solid rgba(0,0,0,0.5)',
              cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <span style={{ transform: 'rotate(45deg)', fontSize: 7, lineHeight: 1, color: c.resolved ? '#888' : '#1a1206', fontWeight: 800 }}>{(c.replies?.length ?? 0) + 1}</span>
          </button>
        )
      })}
      {loopEnabled && loopR > loopL && (
        <div
          style={{
            position: 'absolute', top: 0, left: loopL, width: Math.max(4, loopR - loopL), height: SEC_H,
            background: 'rgba(61,143,239,0.18)', boxSizing: 'border-box',
            borderLeft: '2px solid rgba(61,143,239,0.7)', borderRight: '2px solid rgba(61,143,239,0.7)',
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
        <span style={{ fontSize: 9, fontWeight: 700, color: '#a78bfa', letterSpacing: '0.05em', flexShrink: 0 }}>{label}</span>
        <span style={{ flex: 1, fontSize: 10, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{rt.name}</span>
        <button
          onClick={() => setSelectedReturnId(fxActive ? null : rt.id)}
          title="Show FX chain"
          style={{ fontSize: 8, padding: '1px 4px', borderRadius: 2, flexShrink: 0, cursor: 'pointer', fontWeight: 700,
            border: `1px solid ${fxActive ? '#a78bfa' : 'var(--border)'}`,
            background: fxActive ? 'rgba(167,139,250,0.18)' : 'var(--bg-surface)',
            color: fxActive ? '#a78bfa' : rt.effects.length > 0 ? '#a78bfa' : 'var(--text-muted)',
          }}
        >{rt.effects.length > 0 ? `FX(${rt.effects.length})` : 'FX'}</button>
        <button
          onClick={() => dispatch({ type: 'REMOVE_RETURN_TRACK', trackId: rt.id })}
          title="Remove return track"
          style={{ fontSize: 10, width: 14, height: 14, borderRadius: 2, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', padding: 0, flexShrink: 0, lineHeight: 1 }}
        >×</button>
      </div>
      {/* Empty lane — returns have no clip lane in arrangement */}
      <div style={{ flex: 1, height: 36, background: 'rgba(100,60,150,0.05)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', paddingLeft: 10 }}>
        <span style={{ fontSize: 9, color: '#5a4070', letterSpacing: '0.04em' }}>Return Bus — {rt.name}</span>
      </div>
    </div>
  )
}

// ── Arrangement View ──────────────────────────────────────────────────────────

export default function ArrangementView() {
  const { project, dispatch, engine, setPosition, selectedClipId, setSelectedClipId, selectedTrackId, expandedPianoRollClipId, setExpandedPianoRollClipId, selectedClipIds, setSelectedClipIds, selectedEffectIds, setSelectedEffectIds, onSave, isSaving, audioMode, podcastMeta, blinkIds, loopToolArmed, setLoopToolArmed, collabPeers, isGuest, requireAccount, resumeExport, clearResumeExport } = useDaw()
  const [beatW, setBeatW]           = useState(40)
  const [scrollLeft, setScrollLeft] = useState(0)
  const [snap, setSnap]             = useState<SnapMode>('1/16')
  const [tsPopover, setTsPopover]   = useState<{ x: number; y: number; beat?: number } | null>(null)
  const [openComment, setOpenComment]   = useState<{ id: string; x: number; y: number } | null>(null)
  const [newCommentAt, setNewCommentAt] = useState<{ beat: number; x: number; y: number } | null>(null)
  const [tsDraftBpm, setTsDraftBpm] = useState(120)
  const [tsDraftNum, setTsDraftNum] = useState(project.timeSignatureNum)
  const [tsDraftDen, setTsDraftDen] = useState(project.timeSignatureDen)
  // Group track fold state: set of group track IDs that are folded
  const [showExport, setShowExport] = useState(false)
  const [exportDefaultFormat, setExportDefaultFormat] = useState<'webm' | 'wav'>('webm')
  const [showExportDropdown, setShowExportDropdown] = useState(false)
  const exportDropdownRef = useRef<HTMLDivElement>(null)
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
    const ro = new ResizeObserver(entries => setViewWidth(entries[0].contentRect.width - HDR_W))
    if (outerRef.current) ro.observe(outerRef.current)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    function frame() {
      const el = playheadRef.current
      if (el) el.style.left = `${engine.currentBeat * beatW - scrollLeft}px`
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
    if (e.clientX - rootRect.left < HDR_W) return  // headers stay interactive
    e.preventDefault()
    e.stopPropagation()
    const timelineLeft = rootRect.left + HDR_W
    const beatAt = (clientX: number) => Math.max(0, snapBeat((clientX - timelineLeft + scrollLeft) / beatW, snap, project.timeSignatureNum))
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
    setTsPopover({ x: e.clientX, y: e.clientY, beat })
  }

  // Tempo markers: the current tempo follows the playhead — the last marker
  // at or before the position wins. Runs on a light interval so seeks and
  // playback both pick up changes.
  useEffect(() => {
    const markers = project.tempoMarkers ?? []
    if (markers.length === 0) return
    const iv = setInterval(() => {
      const beat = engine.currentBeat
      const active = [...markers].filter(m => m.beat <= beat + 0.001).sort((a, b) => b.beat - a.beat)[0]
      const want = active?.tempo ?? markers[0].tempo
      if (Math.abs(want - project.tempo) > 0.01) dispatch({ type: 'SET_TEMPO', tempo: want })
    }, 150)
    return () => clearInterval(iv)
  }, [project.tempoMarkers, project.tempo, engine, dispatch])

  function handleWheel(e: React.WheelEvent) {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault()
      setBeatW(w => Math.max(MIN_BEAT_W, Math.min(MAX_BEAT_W, w * (e.deltaY < 0 ? 1.15 : 0.87))))
      return
    }
    // Shift+wheel pans the timeline (mouse wheels have no deltaX of their own)
    if (e.shiftKey) {
      setScrollLeft(s => Math.max(0, s + (e.deltaX || e.deltaY)))
      return
    }
    // Axis lock: only a dominantly-horizontal gesture pans the timeline.
    // Vertical scrolling falls through to the lane's native overflowY scroll
    // instead of dragging the view sideways.
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      setScrollLeft(s => Math.max(0, s + e.deltaX))
    }
  }

  function fitToWindow() {
    const maxBeat = project.arrangementClips.reduce((m, c) => Math.max(m, c.startBeat + c.durationBeats), 32)
    setBeatW(Math.max(MIN_BEAT_W, viewWidth / maxBeat))
    setScrollLeft(0)
  }

  function openPianoRoll() {
    // If a MIDI clip is selected, toggle its inline piano roll
    if (selectedClipId) {
      const clip = project.arrangementClips.find(c => c.id === selectedClipId)
      if (clip && isMidiClip(clip)) {
        setExpandedPianoRollClipId(expandedPianoRollClipId === clip.id ? null : clip.id)
        return
      }
    }
    // Find any MIDI clip on selected track
    if (selectedTrackId) {
      const track = project.tracks.find(t => t.id === selectedTrackId)
      if (track && track.instrument.type !== 'drum') {
        const existing = project.arrangementClips.find(c => isMidiClip(c) && c.trackId === selectedTrackId)
        if (existing) {
          setExpandedPianoRollClipId(expandedPianoRollClipId === existing.id ? null : existing.id)
          return
        }
        // Create a new MIDI clip and immediately expand its piano roll
        const newClip = makeMidiClip(selectedTrackId, 'MIDI', engine.currentBeat, 4)
        dispatch({ type: 'ADD_CLIP', clip: newClip })
        setExpandedPianoRollClipId(newClip.id)
        return
      }
    }
    // Toggle off if already open
    if (expandedPianoRollClipId) { setExpandedPianoRollClipId(null); return }
    // Nothing usable selected — say so and glow the track headers
    setPrHint('Select a track to add piano roll')
    window.setTimeout(() => setPrHint(null), 3500)
    highlightHelpTargets(['track-head'])
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
    if (selectedTrackIds.size < 2) return
    const groupTrackId = crypto.randomUUID()
    const orderedIds = project.tracks.map(t => t.id)
    const selectedArr = [...selectedTrackIds]
    const firstIdx = orderedIds.findIndex(id => selectedArr.includes(id))
    if (firstIdx < 0) return

    // Add the group track (will appear at end initially)
    dispatch({ type: 'ADD_TRACK', id: groupTrackId, name: 'Group' })
    // Reorder: insert group track before the first selected track
    const newOrder = [
      ...orderedIds.slice(0, firstIdx),
      groupTrackId,
      ...orderedIds.slice(firstIdx),
    ]
    dispatch({ type: 'REORDER_TRACKS', ids: newOrder })
    // Set groupId on all selected tracks
    for (const trackId of selectedTrackIds) {
      dispatch({ type: 'UPDATE_TRACK', trackId, patch: { groupId: groupTrackId } })
    }
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

  function onLaneMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    if (e.button !== 0) return
    const preSelected = new Set(selectedClipIds)   // for Alt-additive selection
    const laneEl = laneRef.current
    if (!laneEl) return
    const laneRect = laneEl.getBoundingClientRect()
    // Ignore clicks in the track header column
    if (e.clientX < laneRect.left + HDR_W) return

    const sx = e.clientX
    const sy = e.clientY
    // The band snaps to the grid horizontally, so a drag-select IS a musical
    // region ("this bar"), not a pixel rectangle
    const toBeat = (clientX: number) => Math.max(0, (clientX - laneRect.left - HDR_W + scrollLeft) / beatW)
    const toX    = (beat: number) => laneRect.left + HDR_W + beat * beatW - scrollLeft
    const snapX  = (clientX: number) => toX(snapBeat(toBeat(clientX), snap, project.timeSignatureNum))
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

      const regionStart = Math.min(snapBeat(toBeat(sx), snap, project.timeSignatureNum), snapBeat(toBeat(ev.clientX), snap, project.timeSignatureNum))
      const regionEnd   = Math.max(snapBeat(toBeat(sx), snap, project.timeSignatureNum), snapBeat(toBeat(ev.clientX), snap, project.timeSignatureNum))
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
        if (r.right < laneRect.left + HDR_W) continue
        if (r.right < selL || r.left > selR || r.bottom < selT || r.top > selB) continue
        newEffIds.add((el as HTMLElement).dataset.effectId!)
      }

      // The drag is a time-range selection on the track(s) it covers — it
      // works over empty space, and expands to the full extent of any sample
      // it overlaps (both ends), so a partial band still selects whole clips.
      let region: { start: number; end: number } | null

      if (ev.altKey) {
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

      // S = splice selected clip at playhead
      if (!meta && e.key === 's') {
        e.preventDefault()
        const clipId = selectedClipId ?? (selectedClipIds.size === 1 ? [...selectedClipIds][0] : null)
        if (!clipId) return
        const clip = project.arrangementClips.find(c => c.id === clipId)
        if (!clip || !isAudioClip(clip) || !clip.bufferDuration) return
        const playhead = engine.currentBeat
        if (playhead <= clip.startBeat || playhead >= clip.startBeat + clip.durationBeats) return
        const beatOffset = playhead - clip.startBeat
        const bufDur = clip.bufferDuration
        const nativeDur = bufDur - clip.trimStart - clip.trimEnd
        const frac = beatOffset / clip.durationBeats
        const splitSec = clip.warpEnabled
          ? (clip.trimStart ?? 0) + frac * nativeDur
          : (clip.trimStart ?? 0) + engine.beatsToSeconds(beatOffset)
        const leftClip  = { ...clip, id: crypto.randomUUID(), durationBeats: beatOffset, trimEnd: Math.max(0, bufDur - splitSec) }
        const rightClip = { ...clip, id: crypto.randomUUID(), startBeat: playhead, durationBeats: clip.durationBeats - beatOffset, trimStart: splitSec }
        dispatch({ type: 'REMOVE_CLIP', clipId: clip.id })
        dispatch({ type: 'ADD_CLIP', clip: leftClip })
        dispatch({ type: 'ADD_CLIP', clip: rightClip })
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
    document.addEventListener('keydown', onKey, true)  // capture: fires before AudioEditor's handlers
    return () => document.removeEventListener('keydown', onKey, true)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedClipId, selectedClipIds, selectedEffectIds, project.arrangementClips, project.clipEffects, project.tracks, project.loopEnabled, project.timeSignatureNum, engine, dispatch, setSelectedClipIds, setSelectedClipId, setSelectedEffectIds, setPosition, setSnap, setRippleEdit])

  // Visible tracks: filter out children of folded group parents
  const visibleTracks = project.tracks.filter(track => {
    if (!track.groupId) return true
    return !foldedGroups.has(track.groupId)
  })

  return (
    <div
      ref={outerRef}
      onMouseDownCapture={loopToolArmed ? onLoopToolMouseDown : undefined}
      style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-base)', overflow: 'hidden', position: 'relative', cursor: loopToolArmed ? 'crosshair' : undefined }}
    >
      {loopToolArmed && (
        <div style={{
          position: 'absolute', bottom: 10, left: '50%', transform: 'translateX(-50%)', zIndex: 30, pointerEvents: 'none',
          display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 999,
          background: 'rgba(16,20,30,0.95)', border: '1px solid rgba(61,143,239,0.5)',
        }}>
          <span style={{ fontSize: 10.5, color: '#9cc4f0', fontWeight: 600 }}>Drag along the track or timeline to set the loop duration, or double-click Loop to loop the whole project · Esc to cancel</span>
        </div>
      )}

      {/* Toolbar */}
      <div style={{ height: 30, display: 'flex', alignItems: 'center', gap: 4, padding: '0 8px', background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <button onClick={() => setBeatW(w => Math.min(MAX_BEAT_W, w * 1.3))} style={toolBtn} title="Zoom in" data-help-id="zoom-in"><ZoomIn size={13} /></button>
        <button onClick={() => setBeatW(w => Math.max(MIN_BEAT_W, w * 0.77))} style={toolBtn} title="Zoom out" data-help-id="zoom-out"><ZoomOut size={13} /></button>
        <button onClick={fitToWindow} style={toolBtn} title="Fit to window" data-help-id="fit-window"><Maximize2 size={13} /></button>
        <div style={{ width: 1, height: 16, background: 'var(--border)' }} />
        <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>SNAP</span>
        {(['off', '1/16', '1/8', 'beat', 'bar'] as SnapMode[]).map(m => (
          <button key={m} onClick={() => setSnap(m)} data-help-id="snap"
            style={{ ...toolBtn, background: snap === m ? 'var(--bg-card)' : 'transparent', color: snap === m ? 'var(--text-primary)' : 'var(--text-muted)', border: snap === m ? '1px solid var(--border)' : '1px solid transparent', fontSize: 9, padding: '2px 6px' }}>
            {m === 'off' ? 'Off' : m === 'beat' ? 'Beat' : m === 'bar' ? 'Bar' : m}
          </button>
        ))}
        <span style={{ fontSize: 8, color: 'var(--text-muted)', marginLeft: 2 }} title="Hold ⌥ Option while dragging to bypass snap">⌥=free</span>
        <div style={{ width: 1, height: 16, background: 'var(--border)', marginLeft: 4 }} />
        {/* Waveform zoom control */}
        <span style={{ fontSize: 9, color: 'var(--text-muted)' }} title="Waveform vertical zoom">WF</span>
        <button
          onClick={() => dispatch({ type: 'SET_WAVEFORM_ZOOM', zoom: Math.max(1, project.waveformZoom - 1) })}
          style={{ ...toolBtn, fontSize: 11, fontWeight: 700 }}
          title="Decrease waveform zoom"
          data-help-id="wf-zoom"
        >−</button>
        <span style={{ fontSize: 9, color: 'var(--text-muted)', minWidth: 10, textAlign: 'center', fontFamily: 'monospace' }}>{project.waveformZoom}</span>
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
                  background: morphing ? 'rgba(139,92,246,0.18)' : 'rgba(139,92,246,0.08)',
                  border: '1px solid rgba(139,92,246,0.5)',
                  color: morphing ? '#c4b5fd' : '#a78bfa',
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
                  width: 40, background: '#111', border: '1px solid var(--border)',
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
        {audioMode !== 'podcast' && (
          <div style={{ position: 'relative', display: 'flex' }}>
            <button onClick={openPianoRoll} title="Open Piano Roll (open/create MIDI clip for selected track)" data-help-id="piano-roll" style={{
              ...toolBtn, width: 'auto', padding: '2px 8px', fontSize: 9, fontWeight: 700,
              border: `1px solid ${expandedPianoRollClipId ? '#7c3aed' : 'var(--border)'}`,
              background: expandedPianoRollClipId ? 'rgba(124,58,237,0.18)' : 'transparent',
              color: expandedPianoRollClipId ? '#a78bfa' : 'var(--text-muted)',
              letterSpacing: '0.04em',
            }}>PIANO ROLL</button>
            {prHint && (
              <div style={{
                position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 300,
                whiteSpace: 'nowrap', fontSize: 10, padding: '4px 9px', borderRadius: 5,
                background: '#1e1e1e', border: '1px solid rgba(250,204,21,0.45)', color: '#facc15',
                boxShadow: '0 6px 18px rgba(0,0,0,0.5)', pointerEvents: 'none',
              }}>{prHint}</div>
            )}
          </div>
        )}
        {/* Export split button */}
        <div ref={exportDropdownRef} style={{ position: 'relative', display: 'flex', marginLeft: 4 }}>
          <button
            onClick={() => { if (isGuest && requireAccount) { requireAccount('export'); return } setShowExport(true) }}
            title={isGuest ? 'Sign up to export your mix' : 'Export project audio'}
            data-help-id="export"
            style={{
              ...toolBtn, width: 'auto', padding: '2px 8px', fontSize: 9, fontWeight: 700,
              border: '1px solid var(--border)', background: 'transparent',
              color: 'var(--text-muted)', letterSpacing: '0.04em',
              borderRadius: '3px 0 0 3px', borderRight: 'none',
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
          >▾</button>
          {showExportDropdown && (
            <div style={{
              position: 'absolute', top: '100%', right: 0, marginTop: 2,
              background: '#1e1e1e', border: '1px solid var(--border)',
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
        {onSave && (
          <button onClick={onSave} disabled={isSaving} title="Save project (⌘S)" data-help-id="save" style={{
            ...toolBtn, width: 'auto', padding: '2px 10px', fontSize: 9, fontWeight: 700,
            border: '1px solid var(--border)',
            background: isSaving ? 'rgba(34,197,94,0.15)' : 'transparent',
            color: isSaving ? '#4ade80' : 'var(--text-muted)',
            letterSpacing: '0.04em', marginLeft: 4,
          }}>{isSaving ? 'SAVING…' : 'SAVE'}</button>
        )}
        <VersionHistory />
      </div>

      {/* Ruler row */}
      <div style={{ display: 'flex', flexShrink: 0 }} onWheel={handleWheel}>
        <div style={{ width: HDR_W, height: RULER_H, flexShrink: 0, background: 'var(--bg-surface)', borderRight: '1px solid var(--border)', borderBottom: '1px solid var(--border)' }} />
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <Ruler beatW={beatW} scrollLeft={scrollLeft} snap={snap} onSeek={b => { engine.seek(b); setPosition(b) }} onEditTimeSig={handleEditTimeSig} onOpenComment={(id, x, y) => setOpenComment({ id, x, y })} />
        </div>
      </div>

      {/* Track rows */}
      <div
        ref={laneRef}
        style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', position: 'relative' }}
        onWheel={handleWheel}
        onMouseDown={onLaneMouseDown}
      >
        {/* Music empty-state hint: point brand-new users at the library */}
        {audioMode !== 'podcast' && project.arrangementClips.length === 0 && project.tracks.length > 0 && (
          <div style={{
            position: 'absolute', left: HDR_W, right: 0, top: 0, bottom: 0,
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
            position: 'absolute', left: HDR_W, right: 0, top: 0, bottom: 0,
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
            snap={snap}
            onScrollBy={delta => setScrollLeft(s => Math.max(0, s + delta))}
            waveformZoom={project.waveformZoom}
            selectedTrackIds={selectedTrackIds}
            onSelectTrack={ctrl => handleSelectTrack(track.id, ctrl)}
            foldedGroups={foldedGroups}
            onToggleFold={() => setFoldedGroups(prev => {
              const next = new Set(prev)
              if (next.has(track.id)) next.delete(track.id)
              else next.add(track.id)
              return next
            })}
            onGroupTracks={handleGroupTracks}
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
              <div style={{ width: HDR_W, flexShrink: 0, paddingLeft: 8, borderRight: '1px solid var(--border)' }}>
                <span style={{ fontSize: 8, fontWeight: 700, color: '#7c5fa8', letterSpacing: '0.07em', textTransform: 'uppercase' }}>Returns</span>
              </div>
              <div style={{ flex: 1 }} />
            </div>
            {project.returnTracks.map((rt, idx) => (
              <ReturnTrackRow key={rt.id} rt={rt} idx={idx} dispatch={dispatch} />
            ))}
          </>
        )}

        {/* Add track buttons */}
        <div style={{ display: 'flex', height: 36 }}>
          <div style={{ width: HDR_W, flexShrink: 0, display: 'flex', gap: 4, padding: 8, borderRight: '1px solid var(--border)' }}>
            <button onClick={() => dispatch({ type: 'ADD_TRACK' })}
              data-help-id="add-track"
              style={{ flex: 1, padding: '3px 0', fontSize: 9, borderRadius: 3, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-muted)', cursor: 'pointer', animation: blinkIds.has('add-track') ? 'dawBlink 0.45s ease-in-out 3' : undefined }}>
              +Track
            </button>
            <button
              onClick={addReturnTrack}
              title="Add return track"
              data-help-id="add-return"
              style={{ padding: '3px 6px', fontSize: 9, borderRadius: 3, border: '1px solid #7c5fa8', background: 'rgba(100,60,150,0.12)', color: '#a78bfa', cursor: 'pointer', flexShrink: 0 }}
            >+Ret</button>
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
          border: '1px solid rgba(61,143,239,0.7)',
          background: 'rgba(61,143,239,0.08)',
          pointerEvents: 'none',
          zIndex: 200,
        }} />
      )}

      {/* Global playhead overlay — clipped to track content area so it stays behind the header */}
      <div style={{ position: 'absolute', left: HDR_W, right: 0, top: 30 + RULER_H, bottom: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 10 }}>
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
          background: '#1e1e1e', border: '1px solid var(--border)',
          borderRadius: 6, padding: '10px 12px', zIndex: 1000,
          boxShadow: '0 4px 16px rgba(0,0,0,0.7)', display: 'flex',
          flexDirection: 'column', gap: 8, minWidth: 140,
        }}>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.06em' }}>TIME SIGNATURE</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="number" min={1} max={16} value={tsDraftNum}
              onChange={e => setTsDraftNum(Math.max(1, parseInt(e.target.value) || 4))}
              onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') { dispatch({ type: 'SET_TIME_SIG', num: tsDraftNum, den: tsDraftDen }); setTsPopover(null) } }}
              style={{ width: 40, background: '#111', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 14, fontFamily: 'monospace', borderRadius: 3, padding: '3px 5px', outline: 'none', textAlign: 'center' }}
            />
            <span style={{ color: 'var(--text-muted)', fontSize: 16 }}>/</span>
            <select value={tsDraftDen} onChange={e => setTsDraftDen(parseInt(e.target.value))}
              style={{ width: 48, background: '#111', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 14, fontFamily: 'monospace', borderRadius: 3, padding: '3px 4px', outline: 'none', cursor: 'pointer' }}>
              {[2, 4, 8, 16].map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.06em', marginTop: 2 }}>TEMPO</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="number" min={20} max={300} value={tsDraftBpm}
              onChange={e => setTsDraftBpm(Math.max(20, Math.min(300, parseFloat(e.target.value) || 120)))}
              onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') { dispatch({ type: 'SET_TIME_SIG', num: tsDraftNum, den: tsDraftDen }); dispatch({ type: 'SET_TEMPO', tempo: tsDraftBpm }); setTsPopover(null) } }}
              style={{ width: 62, background: '#111', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 14, fontFamily: 'monospace', borderRadius: 3, padding: '3px 5px', outline: 'none', textAlign: 'center' }}
            />
            <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>BPM</span>
          </div>
          <button
            onClick={() => {
              setNewCommentAt({ beat: tsPopover?.beat ?? 0, x: tsPopover?.x ?? 200, y: tsPopover?.y ?? 200 })
              setTsPopover(null)
            }}
            title="Pin feedback to this spot — collaborators see it on the timeline"
            style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.4)', color: '#f59e0b', fontSize: 10.5, borderRadius: 3, padding: '5px 0', cursor: 'pointer', fontWeight: 700 }}>
            💬 Comment here
          </button>
          <button
            onClick={() => {
              const palette = ['#60a5fa', '#34d399', '#f472b6', '#facc15', '#a78bfa', '#fb923c']
              const n = (project.sections ?? []).length
              dispatch({ type: 'ADD_SECTION', section: { id: crypto.randomUUID(), beat: tsPopover?.beat ?? 0, name: `Section ${n + 1}`, color: palette[n % palette.length] } })
              setTsPopover(null)
            }}
            title="Marks an arrangement section (verse, chorus…) from this bar to the next section"
            style={{ background: 'rgba(96,165,250,0.1)', border: '1px solid rgba(96,165,250,0.4)', color: '#60a5fa', fontSize: 10.5, borderRadius: 3, padding: '5px 0', cursor: 'pointer', fontWeight: 700 }}>
            ▭ Section starts here
          </button>
          <button
            onClick={() => {
              dispatch({ type: 'ADD_TEMPO_MARKER', marker: { id: crypto.randomUUID(), beat: tsPopover?.beat ?? 0, tempo: tsDraftBpm } })
              setTsPopover(null)
            }}
            title="Playback switches to this BPM when the playhead reaches this bar"
            style={{ background: 'rgba(251,146,60,0.12)', border: '1px solid rgba(251,146,60,0.45)', color: '#fb923c', fontSize: 10.5, borderRadius: 3, padding: '5px 0', cursor: 'pointer', fontWeight: 700 }}>
            ♩ Tempo change here → {tsDraftBpm} BPM
          </button>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => { dispatch({ type: 'SET_TIME_SIG', num: tsDraftNum, den: tsDraftDen }); dispatch({ type: 'SET_TEMPO', tempo: tsDraftBpm }); setTsPopover(null) }}
              style={{ flex: 1, background: 'var(--accent)', border: 'none', color: '#fff', fontSize: 11, borderRadius: 3, padding: '5px 0', cursor: 'pointer', fontWeight: 600 }}>
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
            background: '#1e1e1e', border: '1px solid var(--border)', borderRadius: 8,
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
                  background: arrangeTransientDialog.transients.length === 0 ? '#333' : 'var(--accent)',
                  color: arrangeTransientDialog.transients.length === 0 ? '#555' : '#fff',
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
                    style={{ flex: 1, padding: '7px 0', borderRadius: 4, border: 'none', background: 'var(--accent)', color: '#fff', fontSize: 12, fontWeight: 600, cursor: publishLoading ? 'not-allowed' : 'pointer', opacity: publishLoading ? 0.6 : 1 }}
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
    </div>
  )
}

const toolBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  width: 26, height: 22, borderRadius: 3, border: '1px solid transparent',
  background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer',
}
