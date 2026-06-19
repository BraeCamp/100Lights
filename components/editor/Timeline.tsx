'use client'

import { useRef, useState, useEffect } from 'react'
import { ZoomIn, ZoomOut, Maximize2, Plus, Magnet, Scissors, MousePointer2, ChevronDown } from 'lucide-react'
import type { Caption } from '@/lib/types'
import type { TimelineItem, Track, TransitionType, MediaItem } from '@/lib/editor-types'
import { PIXELS_PER_SECOND, RULER_HEIGHT, TOOLBAR_HEIGHT } from '@/lib/editor-types'
import type { EditorTool } from './VideoEditor'
import type { ContextMenuItem } from './ContextMenu'

interface Props {
  items: TimelineItem[]
  captions: Caption[]
  tracks: Track[]
  duration: number
  currentTime: number
  selectedId: string | null
  zoomLevel: number
  height: number
  activeTool: EditorTool
  snapEnabled: boolean
  inPoint: number | null
  outPoint: number | null
  isPlaying: boolean
  onSeek: (t: number) => void
  onSelectItem: (id: string | null) => void
  onMoveItem: (id: string, newStart: number, newTrackId: string, commit: boolean) => void
  onTrimItem: (id: string, edge: 'in' | 'out', newIn: number, newOut: number, newStart: number, commit: boolean) => void
  onSplitItem: (id: string, atTime: number) => void
  onZoomChange: (z: number) => void
  onDeleteItem: (id: string) => void
  onRippleDelete: (id: string) => void
  onDropMedia: (mediaId: string, trackId: string, startTime: number) => void
  onCreateFocusClip?: (trackId: string, startTime: number, duration: number) => void
  onAddTrack: (type?: string) => void
  onSnapToggle: () => void
  onContextMenu: (e: React.MouseEvent, items: ContextMenuItem[]) => void
  // Expanded clip operations
  hasCopied: boolean
  onDuplicateItem: (id: string) => void
  onRenameItem: (id: string) => void
  onToggleEnabled: (id: string) => void
  onChangeColor: (id: string, color: string) => void
  onCopyItem: (id: string) => void
  onPasteItem: (trackId: string, atTime: number) => void
  onDeleteTrack: (trackId: string) => void
  onTrackMuteToggle?: (trackId: string) => void
  onTrackSoloToggle?: (trackId: string) => void
  onTrackVolumeChange?: (trackId: string, volume: number) => void
  selectedIds?: Set<string>
  onMultiSelect?: (ids: Set<string>) => void
  mediaItems?: MediaItem[]
  playbackRate?: number
  syncAnchorRef?: React.MutableRefObject<{ time: number; wall: number }>
}

const LABEL_WIDTH = 64
const SNAP_PX = 8
const ZOOM_MIN = 0.01
const ZOOM_MAX = 10

// Log-scale helpers for the continuous zoom slider (slider value is 0–1)
function sliderToZoom(v: number): number {
  return ZOOM_MIN * Math.pow(ZOOM_MAX / ZOOM_MIN, v)
}
function zoomToSlider(z: number): number {
  return Math.log(z / ZOOM_MIN) / Math.log(ZOOM_MAX / ZOOM_MIN)
}

// Ruler tick intervals in seconds — pick smallest one that keeps ticks ≥60px apart
const TICK_INTERVALS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600]
const MIN_TICK_PX = 60

const TRANSITION_COLORS: Record<TransitionType, string> = {
  dissolve: '#6366f1', dip_black: '#374151', wipe_right: '#0891b2', push: '#0d9488',
}
const TRANSITION_LABELS: Record<TransitionType, string> = {
  dissolve: 'DIS', dip_black: 'DIP', wipe_right: 'WPE', push: 'PSH',
}

function snapFn(t: number, candidates: number[], pps: number, enabled: boolean): number {
  if (!enabled) return t
  const range = SNAP_PX / pps
  let best = t, bestDist = range
  for (const c of candidates) {
    const d = Math.abs(t - c)
    if (d < bestDist) { bestDist = d; best = c }
  }
  return best
}

function trackAtY(clientY: number, el: HTMLDivElement, tracks: Track[]): string | null {
  const rect = el.getBoundingClientRect()
  const y = clientY - rect.top + el.scrollTop - RULER_HEIGHT
  let offset = 0
  for (const track of tracks) {
    if (y >= offset && y < offset + track.height) return track.id
    offset += track.height
  }
  return null
}

const CLIP_COLORS_MENU = ['#2563eb', '#7c3aed', '#059669', '#d97706', '#dc2626', '#0891b2', '#9333ea', '#db2777', '#65a30d']

function WaveformBar({ peaks, color, clipWidth }: { peaks: number[]; color: string; clipWidth: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const H = 22, W = Math.max(1, Math.floor(clipWidth))
    canvas.width = W; canvas.height = H
    ctx.clearRect(0, 0, W, H)
    const step = W / peaks.length
    ctx.fillStyle = `${color}aa`
    for (let i = 0; i < peaks.length; i++) {
      const h = Math.max(1, peaks[i] * (H - 2))
      ctx.fillRect(i * step, (H - h) / 2, Math.max(1, step - 0.5), h)
    }
  }, [peaks, color, clipWidth])
  return <canvas ref={ref} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', borderRadius: 3, pointerEvents: 'none' }} />
}

export default function Timeline({
  items, captions, tracks, duration, currentTime, isPlaying, selectedId, zoomLevel, height,
  activeTool, snapEnabled, inPoint, outPoint, hasCopied,
  onSeek, onSelectItem, onMoveItem, onTrimItem, onSplitItem, onZoomChange,
  onDeleteItem, onRippleDelete, onDropMedia, onAddTrack, onSnapToggle, onContextMenu,
  onDuplicateItem, onRenameItem, onToggleEnabled, onChangeColor, onCopyItem, onPasteItem, onDeleteTrack,
  onTrackMuteToggle, onTrackSoloToggle, onTrackVolumeChange, selectedIds, onMultiSelect, mediaItems,
  playbackRate = 1,
  syncAnchorRef: syncAnchorRefProp,
  onCreateFocusClip,
}: Props) {
  const trackAreaRef   = useRef<HTMLDivElement>(null)
  const [dropIndicator, setDropIndicator] = useState<{ trackId: string; x: number } | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [creatingFocus, setCreatingFocus] = useState<{ trackId: string; x0: number; x1: number } | null>(null)
  // null = not scrubbing; number = current scrub speed multiplier (1 = normal)
  const [scrubSpeed, setScrubSpeed] = useState<number | null>(null)
  const [showAddMenu, setShowAddMenu] = useState(false)

  // Playhead DOM refs — updated via RAF, bypassing React re-renders for 60fps motion.
  const phLineRef = useRef<HTMLDivElement>(null)   // vertical line over tracks
  const phHeadRef = useRef<HTMLDivElement>(null)   // triangle indicator
  const phRulerRef = useRef<HTMLDivElement>(null)  // line in ruler strip

  const pps          = PIXELS_PER_SECOND * zoomLevel
  const totalWidth   = Math.max(duration * pps + 200, 800)
  const tracksHeight = tracks.reduce((s, t) => s + t.height, 0)
  const timeToX      = (t: number) => t * pps

  // Stable refs so the RAF tick always reads the latest values without restarting.
  const ppsRef        = useRef(pps)
  const syncRef       = useRef({ time: currentTime, wall: performance.now() })
  const isPlayingRef  = useRef(isPlaying)
  const playbackRateRef = useRef(playbackRate)
  useEffect(() => { ppsRef.current = pps }, [pps])
  useEffect(() => { isPlayingRef.current = isPlaying }, [isPlaying])
  useEffect(() => { playbackRateRef.current = playbackRate }, [playbackRate])

  // (close-outside is handled by the backdrop div rendered when showAddMenu is true)

  // Sync anchor whenever the parent delivers a new currentTime (video timeupdate / seek).
  useEffect(() => {
    syncRef.current = { time: currentTime, wall: performance.now() }
  }, [currentTime])

  // RAF loop — interpolates playhead position at display refresh rate.
  useEffect(() => {
    let rafId: number

    function applyX(x: number) {
      if (phLineRef.current)  phLineRef.current.style.transform  = `translateX(${x}px)`
      if (phHeadRef.current)  phHeadRef.current.style.transform  = `translateX(${x - 5}px)`
      if (phRulerRef.current) phRulerRef.current.style.transform = `translateX(${x}px)`
    }

    function tick() {
      // Prefer the direct anchor (wall time captured at the exact timeupdate event)
      // over the effect-based syncRef (which is set ~1 frame later via React).
      const direct = syncAnchorRefProp?.current
      const effect = syncRef.current
      const { time, wall } = (direct && direct.wall >= effect.wall) ? direct : effect
      const elapsed = isPlayingRef.current ? (performance.now() - wall) / 1000 : 0
      applyX((time + elapsed * playbackRateRef.current) * ppsRef.current)
      rafId = requestAnimationFrame(tick)
    }

    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, []) // runs once; reads all live values through refs
  const xToTime      = (x: number) => Math.max(0, x / pps)

  // ── Ruler scrub ─────────────────────────────────────────────
  function handleRulerPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    const el = trackAreaRef.current
    if (!el) return

    const startClientY = e.clientY
    // Accumulated time starts at the clicked position
    let accTime = xToTime(e.clientX - el.getBoundingClientRect().left - LABEL_WIDTH + el.scrollLeft)
    let lastClientX = e.clientX
    onSeek(accTime)
    setScrubSpeed(1)

    const onMove = (ev: PointerEvent) => {
      // Vertical offset from initial click sets the speed multiplier.
      // Moving UP from start = faster; moving DOWN = slower.
      // Each call only accumulates the NEW horizontal delta since the last event,
      // so changing speed never retroactively shifts the playhead position.
      const deltaY = ev.clientY - startClientY
      const factor = Math.pow(4, -deltaY / 100)
      const dX = ev.clientX - lastClientX
      lastClientX = ev.clientX
      accTime = Math.max(0, accTime + (dX * factor) / pps)
      setScrubSpeed(factor)
      onSeek(accTime)
    }
    const onUp = () => {
      setScrubSpeed(null)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  // ── Clip drag (select tool only) ─────────────────────────────
  function startDrag(
    e: React.PointerEvent,
    type: 'move' | 'trim-in' | 'trim-out',
    item: TimelineItem,
  ) {
    if (activeTool === 'blade') return  // blade mode — handled at track row level

    e.stopPropagation()
    e.preventDefault()

    const capturedPps  = pps
    const startClientX = e.clientX
    const origStart    = item.startTime
    const origIn       = item.inPoint
    const origOut      = item.outPoint
    const origTrackId  = item.trackId
    const itemDuration = origOut - origIn
    // Ripple trim: Shift+trim-out shifts all downstream clips on same track
    const ripple = e.shiftKey && (type === 'trim-out' || type === 'trim-in')

    setDraggingId(item.id)
    onSelectItem(item.id)

    const snapCandidates = [
      0, currentTime,
      ...(inPoint  !== null ? [inPoint]  : []),
      ...(outPoint !== null ? [outPoint] : []),
      ...items.filter(i => i.id !== item.id).flatMap(i => [i.startTime, i.startTime + (i.outPoint - i.inPoint)]),
    ]

    // Loop snap points for trim-out: snap to k*sourceDuration boundaries
    const srcDuration = mediaItems?.find(m => m.url === item.url)?.duration
    const loopSnapPts: number[] = (type === 'trim-out' && srcDuration)
      ? Array.from({ length: 50 }, (_, k) => (k + 1) * srcDuration)
      : []

    // Last computed position — committed to history once on pointerup.
    let lastMove: { start: number; trackId: string } | null = null
    let lastTrim: { edge: 'in' | 'out'; newIn: number; newOut: number; newStart: number } | null = null

    function onMove(ev: PointerEvent) {
      const dt = (ev.clientX - startClientX) / capturedPps

      if (type === 'move') {
        let rawStart = origStart + dt
        rawStart = snapFn(Math.max(0, rawStart), snapCandidates, capturedPps, snapEnabled)
        const rawEnd = rawStart + itemDuration
        const snappedEnd = snapFn(rawEnd, snapCandidates, capturedPps, snapEnabled)
        if (snappedEnd !== rawEnd) rawStart = snappedEnd - itemDuration
        const newStart = Math.max(0, rawStart)

        let newTrackId = origTrackId
        const el = trackAreaRef.current
        if (el) {
          const hoveredId = trackAtY(ev.clientY, el, tracks)
          if (hoveredId) {
            const hovered = tracks.find(t => t.id === hoveredId)
            const source  = tracks.find(t => t.id === origTrackId)
            if (hovered && source && !hovered.locked && hovered.type === source.type) {
              newTrackId = hoveredId
            }
          }
        }
        lastMove = { start: newStart, trackId: newTrackId }
        onMoveItem(item.id, newStart, newTrackId, false)   // preview only — no history

      } else if (type === 'trim-in') {
        const rawIn  = origIn + dt
        const newIn  = snapFn(Math.max(0, Math.min(rawIn, origOut - 0.1)), snapCandidates, capturedPps, snapEnabled)
        const newStart = origStart + (newIn - origIn)
        lastTrim = { edge: 'in', newIn, newOut: origOut, newStart: Math.max(0, newStart) }
        onTrimItem(item.id, 'in', newIn, origOut, Math.max(0, newStart), false)   // preview only

      } else {
        const rawOut = origOut + dt
        const newOut = snapFn(Math.max(origIn + 0.1, rawOut), [...snapCandidates, ...loopSnapPts], capturedPps, snapEnabled)
        lastTrim = { edge: 'out', newIn: origIn, newOut, newStart: origStart }
        onTrimItem(item.id, 'out', origIn, newOut, origStart, false)   // preview only
        // Ripple: shift all clips that start at or after origEnd on the same track
        if (ripple) {
          const delta = newOut - origOut
          const origEnd = origStart + (origOut - origIn)
          items
            .filter(i => i.id !== item.id && i.trackId === origTrackId && i.startTime >= origEnd - 0.01)
            .forEach(i => onMoveItem(i.id, Math.max(0, i.startTime + delta), i.trackId, false))
        }
      }
    }

    function onUp() {
      setDraggingId(null)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      // Commit the final position as a single history entry.
      if (lastMove) {
        onMoveItem(item.id, lastMove.start, lastMove.trackId, true)
      } else if (lastTrim) {
        onTrimItem(item.id, lastTrim.edge, lastTrim.newIn, lastTrim.newOut, lastTrim.newStart, true)
        // Commit ripple shifts for downstream clips
        if (ripple && lastTrim.edge === 'out') {
          const delta = lastTrim.newOut - origOut
          const origEnd = origStart + (origOut - origIn)
          items
            .filter(i => i.id !== item.id && i.trackId === origTrackId && i.startTime >= origEnd - 0.01)
            .forEach(i => onMoveItem(i.id, Math.max(0, i.startTime + delta), i.trackId, true))
        }
      }
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  // ── Blade click: get timeline X from a track-row pointer event ──
  function bladeClickTime(e: React.PointerEvent<HTMLDivElement>): number {
    const el = trackAreaRef.current
    if (!el) return 0
    const rect = el.getBoundingClientRect()
    return xToTime(e.clientX - rect.left - LABEL_WIDTH + el.scrollLeft)
  }

  // ── Zoom helpers ─────────────────────────────────────────────
  function zoomIn()  { onZoomChange(Math.min(ZOOM_MAX, zoomLevel * 1.5)) }
  function zoomOut() { onZoomChange(Math.max(ZOOM_MIN, zoomLevel / 1.5)) }
  function fitAll()  {
    const el = trackAreaRef.current
    if (!el || duration === 0) return
    const fit = (el.clientWidth - LABEL_WIDTH) / (duration * PIXELS_PER_SECOND)
    onZoomChange(Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, fit)))
  }

  // Ruler ticks — pick the smallest interval that keeps ticks at least MIN_TICK_PX apart
  const tickInt = TICK_INTERVALS.find(i => pps * i >= MIN_TICK_PX) ?? TICK_INTERVALS[TICK_INTERVALS.length - 1]
  const ticks: number[] = []
  for (let t = 0; t <= duration + tickInt; t += tickInt) ticks.push(t)

  function getClipMenu(item: TimelineItem): ContextMenuItem[] {
    const isDisabled = item.enabled === false
    return [
      { id: 'sel',       label: 'Select',             onClick: () => onSelectItem(item.id) },
      { id: 'ren',       label: 'Rename…',            onClick: () => onRenameItem(item.id) },
      { id: 's0',        separator: true, label: '' },
      { id: 'copy',      label: 'Copy',               shortcut: '⌘C', onClick: () => onCopyItem(item.id) },
      { id: 'dup',       label: 'Duplicate',          shortcut: '⌘D', onClick: () => onDuplicateItem(item.id) },
      { id: 's1',        separator: true, label: '' },
      { id: 'split',     label: 'Split at Playhead',  shortcut: '⌘B', onClick: () => onSplitItem(item.id, currentTime) },
      { id: 's2',        separator: true, label: '' },
      { id: 'color',     label: 'Color',              colors: CLIP_COLORS_MENU, onColor: (c) => onChangeColor(item.id, c) },
      { id: 'enable',    label: isDisabled ? 'Enable Clip' : 'Disable Clip', onClick: () => onToggleEnabled(item.id) },
      { id: 's3',        separator: true, label: '' },
      { id: 'del',       label: 'Lift (leave gap)',   shortcut: '⌫',  onClick: () => onDeleteItem(item.id) },
      { id: 'ripple',    label: 'Ripple Delete',      shortcut: '⇧⌫', danger: true, onClick: () => onRippleDelete(item.id) },
    ]
  }

  function getAreaMenu(trackId?: string): ContextMenuItem[] {
    const trackHasClips = trackId ? items.some(i => i.trackId === trackId) : false
    const canDeleteTrack = trackId
      && !items.some(i => i.trackId === trackId)
      && tracks.filter(t => t.type !== 'caption').length > 1
    return [
      { id: 'paste',    label: 'Paste',          shortcut: '⌘V', disabled: !hasCopied, onClick: () => trackId && onPasteItem(trackId, currentTime) },
      { id: 's0',       separator: true, label: '' },
      { id: 'addM',  label: 'Add Media Track',     shortcut: '⌘⌥T', onClick: () => onAddTrack() },
      { id: 'addDF', label: 'Add Draw Focus Track',                  onClick: () => onAddTrack('drawfocus') },
      { id: 'delTrack', label: 'Delete Track',    disabled: !canDeleteTrack, onClick: () => trackId && onDeleteTrack(trackId) },
      { id: 's1',       separator: true, label: '' },
      { id: 'fit',      label: 'Fit Timeline',    shortcut: '⇧Z', onClick: fitAll },
      { id: 'zi',       label: 'Zoom In',         shortcut: '⌘+', onClick: zoomIn },
      { id: 'zo',       label: 'Zoom Out',        shortcut: '⌘−', onClick: zoomOut },
      { id: 's2',       separator: true, label: '' },
      { id: 'snap',     label: snapEnabled ? 'Disable Snap (S)' : 'Enable Snap (S)', onClick: onSnapToggle },
    ]
  }

  const zoomFrac = Math.max(0, Math.min(1, zoomToSlider(zoomLevel)))

  const bladeCursor = activeTool === 'blade'

  return (
    <div
      className="flex flex-col select-none shrink-0"
      style={{ height, background: 'var(--bg-surface)', borderTop: '1px solid var(--border)' }}
    >
      {/* ── Toolbar ───────────────────────────────────────────── */}
      <div
        className="flex items-center gap-2 px-3 shrink-0"
        style={{ height: TOOLBAR_HEIGHT, borderBottom: '1px solid var(--border)', background: 'var(--bg-base)' }}
      >
        {/* Zoom controls */}
        <button onClick={zoomOut} className="p-1 rounded" style={{ color: 'var(--text-muted)' }} title="Zoom out (⌘-)"><ZoomOut size={13} /></button>
        <div className="text-xs font-mono px-1.5 rounded" style={{ background: 'var(--bg-card)', color: 'var(--text-secondary)', minWidth: 40, textAlign: 'center' }}>
          {zoomLevel < 0.1 ? `${(zoomLevel * 100).toFixed(1)}%` : `${Math.round(zoomLevel * 100)}%`}
        </div>
        <button onClick={zoomIn} className="p-1 rounded" style={{ color: 'var(--text-muted)' }} title="Zoom in (⌘+)"><ZoomIn size={13} /></button>
        <input
          type="range" className="w-20 cf-slider" min={0} max={1} step={0.001}
          value={zoomFrac}
          onChange={(e) => onZoomChange(sliderToZoom(Number(e.target.value)))}
          style={{ background: `linear-gradient(to right, var(--accent) ${zoomFrac * 100}%, var(--border-light) ${zoomFrac * 100}%)` }}
        />
        <button onClick={fitAll} className="p-1 rounded" style={{ color: 'var(--text-muted)' }} title="Fit all (⇧Z)"><Maximize2 size={12} /></button>

        <div className="w-px h-4 mx-1" style={{ background: 'var(--border)' }} />

        {/* Snap toggle */}
        <button
          onClick={onSnapToggle}
          className="p-1.5 rounded"
          title={`Snap ${snapEnabled ? 'on' : 'off'} (S)`}
          style={{ color: snapEnabled ? 'var(--accent-light)' : 'var(--text-muted)', background: snapEnabled ? 'var(--accent-subtle)' : 'transparent' }}
        >
          <Magnet size={12} />
        </button>

        {/* Tool indicator */}
        <div className="flex items-center gap-1 px-1.5 py-0.5 rounded" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
          {activeTool === 'select'
            ? <><MousePointer2 size={10} color="var(--text-muted)" /><span className="text-xs" style={{ color: 'var(--text-muted)', fontSize: 9 }}>SELECT</span></>
            : <><Scissors     size={10} color="#e11d48"            /><span className="text-xs" style={{ color: '#e11d48', fontSize: 9 }}>BLADE</span></>
          }
        </div>

        <div className="w-px h-4 mx-1" style={{ background: 'var(--border)' }} />

        {/* Add track */}
        <div style={{ position: 'relative' }}>
          <button
            onMouseDown={e => e.stopPropagation()}
            onClick={() => setShowAddMenu(v => !v)}
            className="flex items-center gap-1 px-2 py-1 rounded text-xs"
            style={{ color: 'var(--text-muted)' }}
            title="Add track"
          >
            <Plus size={11} /> Add <ChevronDown size={9} />
          </button>
          {showAddMenu && (<>
            {/* Backdrop — catches outside clicks without a document listener */}
            <div
              style={{ position: 'fixed', inset: 0, zIndex: 99 }}
              onClick={() => setShowAddMenu(false)}
            />
            <div style={{
              position: 'absolute', top: '100%', left: 0, zIndex: 100,
              background: 'var(--bg-surface)', border: '1px solid var(--border)',
              borderRadius: 6, minWidth: 164, boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
              overflow: 'hidden', marginTop: 2,
            }}>
              {[
                { label: 'Media Track', type: undefined as string | undefined },
                { label: 'Draw Focus Track', type: 'drawfocus' as string | undefined },
              ].map(({ label, type }) => (
                <button
                  key={label}
                  onClick={() => { onAddTrack(type); setShowAddMenu(false) }}
                  style={{
                    display: 'block', width: '100%', padding: '7px 12px',
                    textAlign: 'left', fontSize: 11, color: 'var(--text-secondary)',
                    background: 'none', border: 'none', cursor: 'pointer',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-card)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >{label}</button>
              ))}
            </div>
          </>)}
        </div>

        <div className="flex-1" />
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
          {items.length} clip{items.length !== 1 ? 's' : ''} · {captions.length} cap
        </span>
      </div>

      {/* ── Scroll area ─────────────────────────────────────────── */}
      <div
        ref={trackAreaRef}
        className="flex-1 overflow-x-auto overflow-y-auto"
        style={{ background: '#111' }}
      >
        <div style={{ width: totalWidth + LABEL_WIDTH, minWidth: '100%' }}>

          {/* Ruler */}
          <div
            className="flex"
            style={{ height: RULER_HEIGHT, background: '#0d0d0d', borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, zIndex: 10 }}
          >
            <div style={{ width: LABEL_WIDTH, flexShrink: 0, borderRight: '1px solid var(--border)', display: 'flex', alignItems: 'flex-end', paddingBottom: 2, paddingLeft: 8, color: 'var(--text-muted)', fontSize: 9, fontWeight: 600 }}>
              TC
            </div>
            <div
              className="flex-1 relative"
              style={{ cursor: scrubSpeed !== null && scrubSpeed !== 1 ? (scrubSpeed < 1 ? 'zoom-in' : 'zoom-out') : 'crosshair' }}
              onPointerDown={handleRulerPointerDown}
            >
              {ticks.map((t) => (
                <div key={t} style={{ position: 'absolute', bottom: 0, left: timeToX(t) }}>
                  <span style={{ display: 'block', color: 'var(--text-muted)', fontSize: 9, lineHeight: 1, marginBottom: 2 }}>{formatRuler(t)}</span>
                  <div style={{ width: 1, height: 5, background: 'var(--border-light)' }} />
                </div>
              ))}

              {/* In/Out range highlight */}
              {inPoint !== null && outPoint !== null && inPoint < outPoint && (
                <div style={{
                  position: 'absolute', top: 0, bottom: 0,
                  left: timeToX(inPoint), width: timeToX(outPoint - inPoint),
                  background: 'rgba(61,143,239,0.18)',
                  borderLeft: '2px solid rgba(61,143,239,0.7)',
                  borderRight: '2px solid rgba(61,143,239,0.7)',
                  pointerEvents: 'none',
                }} />
              )}
              {inPoint !== null && (
                <div style={{ position: 'absolute', top: 0, bottom: 0, left: timeToX(inPoint), width: 2, background: 'rgba(61,143,239,0.9)', pointerEvents: 'none' }}>
                  <span style={{ position: 'absolute', top: 2, left: 3, fontSize: 8, color: 'rgba(61,143,239,0.9)', fontWeight: 700, whiteSpace: 'nowrap' }}>IN</span>
                </div>
              )}
              {outPoint !== null && (
                <div style={{ position: 'absolute', top: 0, bottom: 0, left: timeToX(outPoint), width: 2, background: 'rgba(61,143,239,0.9)', pointerEvents: 'none' }}>
                  <span style={{ position: 'absolute', top: 2, right: 3, fontSize: 8, color: 'rgba(61,143,239,0.9)', fontWeight: 700, whiteSpace: 'nowrap' }}>OUT</span>
                </div>
              )}

              <div ref={phRulerRef} style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: 1, background: 'rgba(255,255,255,0.85)', pointerEvents: 'none', willChange: 'transform', transform: `translateX(${timeToX(currentTime)}px)` }} />

              {/* Scrub speed badge — shown while dragging the ruler vertically */}
              {scrubSpeed !== null && scrubSpeed !== 1 && (
                <div style={{
                  position: 'absolute', top: 4, right: 8,
                  fontSize: 9, fontWeight: 700, letterSpacing: '0.04em',
                  background: 'rgba(0,0,0,0.65)', color: scrubSpeed < 1 ? '#60a5fa' : '#f97316',
                  padding: '1px 5px', borderRadius: 3, pointerEvents: 'none',
                }}>
                  {scrubSpeed < 1
                    ? `${(1 / scrubSpeed).toFixed(1)}× fine`
                    : `${scrubSpeed.toFixed(1)}× fast`}
                </div>
              )}
            </div>
          </div>

          {/* Track rows */}
          <div
            style={{ position: 'relative' }}
            onContextMenu={(e) => { e.preventDefault(); onContextMenu(e, getAreaMenu()) }}
          >
            {/* Sticky track labels — caption tracks are legacy and hidden */}
            <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: LABEL_WIDTH, background: '#111', borderRight: '1px solid var(--border)', zIndex: 5 }}>
              {tracks.filter(t => t.type !== 'caption').map((track) => (
                <div
                  key={track.id}
                  style={{ height: track.height, borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, padding: '2px 0' }}
                  onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onContextMenu(e, getAreaMenu(track.id)) }}
                >
                  <span style={{ color: track.type === 'drawfocus' ? '#a78bfa' : (track.muted ? '#444' : 'var(--text-muted)'), fontSize: 9, fontWeight: 700 }}>{track.type === 'drawfocus' ? `⊙ ${track.label}` : track.label}</span>
                  <div style={{ display: 'flex', gap: 2 }}>
                    <button
                      onClick={(e) => { e.stopPropagation(); onTrackMuteToggle?.(track.id) }}
                      style={{
                        fontSize: 7, padding: '1px 3px', borderRadius: 2, cursor: 'pointer', lineHeight: 1.3, fontWeight: 700,
                        background: track.muted ? '#f97316' : 'rgba(255,255,255,0.05)',
                        color: track.muted ? '#fff' : '#555',
                        border: `1px solid ${track.muted ? '#f97316' : '#2a2a2a'}`,
                      }}
                      title="Mute track"
                    >M</button>
                    <button
                      onClick={(e) => { e.stopPropagation(); onTrackSoloToggle?.(track.id) }}
                      style={{
                        fontSize: 7, padding: '1px 3px', borderRadius: 2, cursor: 'pointer', lineHeight: 1.3, fontWeight: 700,
                        background: track.solo ? '#8b5cf6' : 'rgba(255,255,255,0.05)',
                        color: track.solo ? '#fff' : '#555',
                        border: `1px solid ${track.solo ? '#8b5cf6' : '#2a2a2a'}`,
                      }}
                      title="Solo track"
                    >S</button>
                  </div>
                  <input
                    type="range" min={0} max={1} step={0.01}
                    value={track.volume ?? 1}
                    onChange={(e) => { e.stopPropagation(); onTrackVolumeChange?.(track.id, Number(e.target.value)) }}
                    onClick={(e) => e.stopPropagation()}
                    className="cf-slider"
                    style={{
                      width: 50, height: 3, cursor: 'pointer',
                      background: `linear-gradient(to right, var(--accent) ${(track.volume ?? 1) * 100}%, #2a2a2a ${(track.volume ?? 1) * 100}%)`,
                      opacity: track.muted ? 0.3 : 1,
                    }}
                    title={`Volume: ${Math.round((track.volume ?? 1) * 100)}%`}
                  />
                </div>
              ))}
            </div>

            {/* Clip canvas */}
            <div style={{ marginLeft: LABEL_WIDTH, position: 'relative', width: totalWidth }}>
              {items.length === 0 && (
                <div style={{
                  position: 'absolute', inset: 0, zIndex: 2,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  pointerEvents: 'none',
                }}>
                  <p style={{ fontSize: 12, color: 'var(--text-muted)', userSelect: 'none' }}>
                    Drag media from the pool · double-click a file to add it here
                  </p>
                </div>
              )}
              {tracks.filter(t => t.type !== 'caption').map((track, trackIdx) => {
                const isCap        = false  // caption type tracks are filtered out above
                const isAudio      = track.type === 'audio'
                const isFirstMedia = trackIdx === 0
                const trackItems   = items.filter(i => i.trackId === track.id)

                return (
                  <div
                    key={track.id}
                    style={{
                      position: 'relative',
                      height: track.height,
                      borderBottom: '1px solid var(--border)',
                      background: dropIndicator?.trackId === track.id
                        ? 'rgba(61,143,239,0.07)'
                        : track.type === 'drawfocus'
                        ? 'rgba(167,139,250,0.04)'
                        : 'rgba(255,255,255,0.018)',
                      cursor: bladeCursor && !track.locked ? 'crosshair' : 'default',
                      transition: 'background 0.1s',
                    }}
                    onPointerDown={(e) => {
                      // Draw Focus: drag on empty area to create a new focus range
                      if (track.type === 'drawfocus' && !bladeCursor) {
                        const rect = e.currentTarget.getBoundingClientRect()
                        const scrollLeft = trackAreaRef.current?.scrollLeft ?? 0
                        const x0 = e.clientX - rect.left + scrollLeft
                        const tHit = xToTime(x0)
                        const hitClip = trackItems.find(i => tHit >= i.startTime && tHit < i.startTime + (i.outPoint - i.inPoint))
                        if (!hitClip) {
                          e.stopPropagation()
                          let x1 = x0
                          setCreatingFocus({ trackId: track.id, x0, x1 })
                          const onMove = (ev: PointerEvent) => {
                            x1 = ev.clientX - rect.left + (trackAreaRef.current?.scrollLeft ?? 0)
                            setCreatingFocus({ trackId: track.id, x0, x1 })
                          }
                          const onUp = () => {
                            document.removeEventListener('pointermove', onMove)
                            document.removeEventListener('pointerup', onUp)
                            const s = xToTime(Math.min(x0, x1))
                            const d = xToTime(Math.max(x0, x1)) - s
                            if (d > 0.1) onCreateFocusClip?.(track.id, s, d)
                            setCreatingFocus(null)
                          }
                          document.addEventListener('pointermove', onMove)
                          document.addEventListener('pointerup', onUp)
                          return
                        }
                      }
                      // Blade click on empty track area
                      if (!bladeCursor || track.locked) return
                      e.stopPropagation()
                      const clickTime = bladeClickTime(e)
                      const target = trackItems.find(i =>
                        clickTime >= i.startTime && clickTime < i.startTime + (i.outPoint - i.inPoint)
                      )
                      if (target) onSplitItem(target.id, clickTime)
                    }}
                    onDragOver={(e) => {
                      if (track.locked || track.type === 'drawfocus') return
                      e.preventDefault(); e.dataTransfer.dropEffect = 'copy'
                      const rect = e.currentTarget.getBoundingClientRect()
                      setDropIndicator({ trackId: track.id, x: e.clientX - rect.left + (trackAreaRef.current?.scrollLeft ?? 0) })
                    }}
                    onDragLeave={() => setDropIndicator(null)}
                    onDrop={(e) => {
                      e.preventDefault(); setDropIndicator(null)
                      if (track.type === 'drawfocus') return
                      const mediaId = e.dataTransfer.getData('mediaId')
                      if (!mediaId) return
                      const rect = e.currentTarget.getBoundingClientRect()
                      onDropMedia(mediaId, track.id, xToTime(e.clientX - rect.left + (trackAreaRef.current?.scrollLeft ?? 0)))
                    }}
                    onClick={(e) => { if (e.target === e.currentTarget && !bladeCursor) onSelectItem(null) }}
                    onContextMenu={(e) => { if (e.target === e.currentTarget) { e.preventDefault(); e.stopPropagation(); onContextMenu(e, getAreaMenu(track.id)) } }}
                  >
                    {/* Caption strip — shown at the bottom of the first media track */}
                    {isFirstMedia && captions.length > 0 && captions.map((c, idx) => {
                      const active = currentTime >= c.start && currentTime <= c.end
                      return (
                        <div key={idx} title={c.text} style={{
                          position: 'absolute',
                          left: timeToX(c.start),
                          width: Math.max(timeToX(c.end - c.start) - 1, 2),
                          bottom: 0, height: 7,
                          background: active ? 'rgba(139,92,246,0.95)' : 'rgba(139,92,246,0.4)',
                          borderLeft: `1px solid rgba(139,92,246,${active ? 1 : 0.6})`,
                          borderRadius: '0 0 2px 2px',
                          transition: 'background 0.1s',
                          pointerEvents: 'none',
                        }} />
                      )
                    })}

                    {/* Clip blocks */}
                    {trackItems.map((item) => {
                      const left       = timeToX(item.startTime)
                      const width      = Math.max(timeToX(item.outPoint - item.inPoint), 8)
                      const selected   = item.id === selectedId || (selectedIds?.has(item.id) ?? false)
                      const dragging   = item.id === draggingId
                      const disabled   = item.enabled === false
                      const transW     = item.transitionIn ? Math.max(timeToX(item.transitionDuration ?? 0.5), 12) : 0
                      const mediaItem  = mediaItems?.find(m => m.url === item.url)
                      const clipOpacity = dragging ? 0.75 : disabled ? 0.45 : ((item.opacity ?? 100) / 100)
                      const fadeInW    = item.fadeIn  ? Math.min(timeToX(item.fadeIn),  width - 4) : 0
                      const fadeOutW   = item.fadeOut ? Math.min(timeToX(item.fadeOut), width - 4) : 0

                      // Draw Focus track: render as a thin focus strip, not a media block
                      if (track.type === 'drawfocus') {
                        return (
                          <div
                            key={item.id}
                            style={{
                              position: 'absolute', left, width,
                              top: '50%', transform: 'translateY(-50%)',
                              height: 12, borderRadius: 6,
                              background: selected ? '#a78bfa' : 'rgba(167,139,250,0.5)',
                              cursor: bladeCursor ? 'crosshair' : (dragging ? 'grabbing' : 'grab'),
                              opacity: dragging ? 0.65 : 1,
                              boxShadow: selected ? '0 0 0 1.5px #c4b5fd, 0 0 10px rgba(167,139,250,0.3)' : 'none',
                              userSelect: 'none', overflow: 'visible',
                              transition: dragging ? 'none' : 'box-shadow 0.1s',
                            }}
                            onPointerDown={(e) => {
                              if (bladeCursor) { e.stopPropagation(); onSplitItem(item.id, bladeClickTime(e)); return }
                              if (e.shiftKey && onMultiSelect) {
                                e.stopPropagation()
                                const next = new Set(selectedIds ?? (selectedId ? [selectedId] : []))
                                next.has(item.id) ? next.delete(item.id) : next.add(item.id)
                                onMultiSelect(next)
                                return
                              }
                              startDrag(e, 'move', item)
                            }}
                            onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onSelectItem(item.id); onContextMenu(e, getClipMenu(item)) }}
                          >
                            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', overflow: 'hidden' }}>
                              <span style={{ fontSize: 8, color: 'rgba(255,255,255,0.9)' }}>⊙</span>
                            </div>
                            <div
                              style={{ position: 'absolute', left: 0, top: -5, bottom: -5, width: 8, cursor: 'w-resize', zIndex: 3 }}
                              onPointerDown={(e) => { e.stopPropagation(); if (!bladeCursor) startDrag(e, 'trim-in', item) }}
                            >
                              <div style={{ position: 'absolute', left: 2, top: '50%', transform: 'translateY(-50%)', width: 3, height: 18, background: 'rgba(255,255,255,0.65)', borderRadius: 2 }} />
                            </div>
                            <div
                              style={{ position: 'absolute', right: 0, top: -5, bottom: -5, width: 8, cursor: 'e-resize', zIndex: 3 }}
                              onPointerDown={(e) => { e.stopPropagation(); if (!bladeCursor) startDrag(e, 'trim-out', item) }}
                            >
                              <div style={{ position: 'absolute', right: 2, top: '50%', transform: 'translateY(-50%)', width: 3, height: 18, background: 'rgba(255,255,255,0.65)', borderRadius: 2 }} />
                            </div>
                          </div>
                        )
                      }

                      return (
                        <div key={item.id}>
                          {/* Transition badge */}
                          {item.transitionIn && (
                            <div style={{
                              position: 'absolute', left: left - transW / 2, top: 4,
                              width: transW, height: track.height - 8,
                              background: TRANSITION_COLORS[item.transitionIn],
                              borderRadius: 3, opacity: 0.85, zIndex: 5, pointerEvents: 'none',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                            }}>
                              <span style={{ color: '#fff', fontSize: 7, fontWeight: 700 }}>{TRANSITION_LABELS[item.transitionIn]}</span>
                            </div>
                          )}

                          {/* Clip body */}
                          <div
                            style={{
                              position: 'absolute', left, width,
                              top: 5, height: track.height - 10,
                              background: disabled ? 'rgba(80,80,80,0.25)' : (selected ? item.color : `${item.color}cc`),
                              border: `1.5px solid ${disabled ? '#444' : (selected ? item.color : `${item.color}55`)}`,
                              borderRadius: 4,
                              cursor: bladeCursor ? 'crosshair' : (dragging ? 'grabbing' : 'grab'),
                              opacity: clipOpacity,
                              overflow: 'hidden',
                              boxShadow: selected ? `0 0 0 1.5px ${item.color}, 0 2px 8px rgba(0,0,0,0.4)` : '0 1px 3px rgba(0,0,0,0.3)',
                              userSelect: 'none',
                              transition: dragging ? 'none' : 'box-shadow 0.1s',
                            }}
                            onPointerDown={(e) => {
                              if (bladeCursor) {
                                e.stopPropagation()
                                const clickTime = bladeClickTime(e)
                                onSplitItem(item.id, clickTime)
                                return
                              }
                              if (e.shiftKey && onMultiSelect) {
                                e.stopPropagation()
                                const next = new Set(selectedIds ?? (selectedId ? [selectedId] : []))
                                if (next.has(item.id)) next.delete(item.id)
                                else next.add(item.id)
                                onMultiSelect(next)
                                return
                              }
                              startDrag(e, 'move', item)
                            }}
                            onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onSelectItem(item.id); onContextMenu(e, getClipMenu(item)) }}
                          >
                            {isAudio ? (
                              <>
                                {mediaItem?.peaks ? (
                                  <WaveformBar peaks={mediaItem.peaks} color={item.color} clipWidth={width} />
                                ) : (
                                  <div style={{ display: 'flex', alignItems: 'center', width: '100%', height: '100%', padding: '0 2px', gap: 1, overflow: 'hidden' }}>
                                    {Array.from({ length: Math.floor(width / 3) }).map((_, i) => (
                                      <div key={i} style={{ width: 1, flexShrink: 0, height: `${25 + Math.abs(Math.sin(i * 0.7 + item.startTime)) * 60}%`, background: `${item.color}99`, borderRadius: 1 }} />
                                    ))}
                                  </div>
                                )}
                                {/* Loop boundary markers for audio clips */}
                                {(() => {
                                  const sd = mediaItem?.duration
                                  if (!sd) return null
                                  const clipDur = item.outPoint - item.inPoint
                                  if (clipDur <= sd) return null
                                  const markers: React.ReactNode[] = []
                                  for (let k = 1; k * sd - item.inPoint < clipDur; k++) {
                                    const offsetPx = timeToX(k * sd - item.inPoint)
                                    if (offsetPx <= 0 || offsetPx >= width) continue
                                    markers.push(
                                      <div key={k} style={{
                                        position: 'absolute', left: offsetPx, top: 0, bottom: 0, width: 1,
                                        backgroundImage: 'repeating-linear-gradient(to bottom, rgba(255,255,255,0.55) 0px, rgba(255,255,255,0.55) 3px, transparent 3px, transparent 6px)',
                                        pointerEvents: 'none', zIndex: 4,
                                      }} />
                                    )
                                  }
                                  return markers
                                })()}
                              </>
                            ) : (
                              <>
                                {/* Trim-in handle */}
                                <div
                                  style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 7, cursor: bladeCursor ? 'crosshair' : 'w-resize', background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2 }}
                                  onPointerDown={(e) => {
                                    e.stopPropagation()
                                    if (bladeCursor) { onSplitItem(item.id, bladeClickTime(e)); return }
                                    startDrag(e, 'trim-in', item)
                                  }}
                                >
                                  <div style={{ width: 1.5, height: 12, background: 'rgba(255,255,255,0.6)', borderRadius: 1 }} />
                                </div>
                                {/* Label */}
                                <div style={{ position: 'absolute', left: 8, right: 8, top: 0, bottom: 0, display: 'flex', alignItems: 'center', pointerEvents: 'none', overflow: 'hidden' }}>
                                  <span style={{ color: '#fff', fontSize: 10, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textShadow: '0 1px 2px rgba(0,0,0,0.6)' }}>
                                    {item.label}
                                  </span>
                                </div>
                                {/* Trim-out handle */}
                                <div
                                  style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 7, cursor: bladeCursor ? 'crosshair' : 'e-resize', background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2 }}
                                  onPointerDown={(e) => {
                                    e.stopPropagation()
                                    if (bladeCursor) { onSplitItem(item.id, bladeClickTime(e)); return }
                                    startDrag(e, 'trim-out', item)
                                  }}
                                >
                                  <div style={{ width: 1.5, height: 12, background: 'rgba(255,255,255,0.6)', borderRadius: 1 }} />
                                </div>
                                {/* Flag dots */}
                                {item.flags && item.flags.length > 0 && (
                                  <div style={{ position: 'absolute', top: 3, right: 10, display: 'flex', gap: 2, pointerEvents: 'none', zIndex: 4 }}>
                                    {item.flags.map(f => (
                                      <div key={f.id} style={{ width: 5, height: 5, borderRadius: '50%', background: f.color, flexShrink: 0, boxShadow: '0 0 2px rgba(0,0,0,0.6)' }} />
                                    ))}
                                  </div>
                                )}
                                {/* Fade in overlay */}
                                {fadeInW > 0 && (
                                  <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: fadeInW, background: 'linear-gradient(to right, rgba(0,0,0,0.55), transparent)', pointerEvents: 'none', zIndex: 3 }} />
                                )}
                                {/* Fade out overlay */}
                                {fadeOutW > 0 && (
                                  <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: fadeOutW, background: 'linear-gradient(to left, rgba(0,0,0,0.55), transparent)', pointerEvents: 'none', zIndex: 3 }} />
                                )}
                                {/* Loop boundary markers — dotted vertical lines every sourceDuration */}
                                {(() => {
                                  const sd = mediaItem?.duration
                                  if (!sd) return null
                                  const clipDur = item.outPoint - item.inPoint
                                  if (clipDur <= sd) return null
                                  const markers: React.ReactNode[] = []
                                  for (let k = 1; k * sd - item.inPoint < clipDur; k++) {
                                    const offsetPx = timeToX(k * sd - item.inPoint)
                                    if (offsetPx <= 0 || offsetPx >= width) continue
                                    markers.push(
                                      <div key={k} style={{
                                        position: 'absolute', left: offsetPx, top: 0, bottom: 0, width: 1,
                                        backgroundImage: 'repeating-linear-gradient(to bottom, rgba(255,255,255,0.55) 0px, rgba(255,255,255,0.55) 3px, transparent 3px, transparent 6px)',
                                        pointerEvents: 'none', zIndex: 4,
                                      }} />
                                    )
                                  }
                                  return markers
                                })()}
                              </>
                            )}
                          </div>
                        </div>
                      )
                    })}

                    {/* Focus range creation preview */}
                    {creatingFocus?.trackId === track.id && (
                      <div style={{
                        position: 'absolute',
                        left: Math.min(creatingFocus.x0, creatingFocus.x1),
                        width: Math.max(4, Math.abs(creatingFocus.x1 - creatingFocus.x0)),
                        top: '50%', transform: 'translateY(-50%)',
                        height: 12, borderRadius: 6,
                        background: 'rgba(167,139,250,0.2)',
                        border: '1px dashed rgba(167,139,250,0.7)',
                        pointerEvents: 'none',
                      }} />
                    )}

                    {/* Drop cursor */}
                    {dropIndicator?.trackId === track.id && (
                      <div style={{ position: 'absolute', left: dropIndicator.x, top: 2, width: 2, height: track.height - 4, background: 'var(--accent)', borderRadius: 1, pointerEvents: 'none', zIndex: 20, boxShadow: '0 0 6px var(--accent)' }} />
                    )}
                  </div>
                )
              })}

              {/* Playhead */}
              <div ref={phLineRef} style={{ position: 'absolute', top: 0, left: 0, height: tracksHeight, width: 1, background: 'rgba(255,255,255,0.8)', pointerEvents: 'none', zIndex: 15, willChange: 'transform', transform: `translateX(${timeToX(currentTime)}px)` }} />
              <div ref={phHeadRef} style={{ position: 'absolute', left: 0, top: -1, width: 0, height: 0, borderLeft: '5px solid transparent', borderRight: '5px solid transparent', borderTop: '7px solid rgba(255,255,255,0.8)', pointerEvents: 'none', zIndex: 16, willChange: 'transform', transform: `translateX(${timeToX(currentTime) - 5}px)` }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function formatRuler(s: number): string {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
  return `${m}:${String(sec).padStart(2, '0')}`
}
