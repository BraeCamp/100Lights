'use client'

// The overview strip above the arrangement — Live's Arrangement Overview.
//
// A minimap of the whole song: every clip as a sliver in its track's colour,
// and a box over the part that is on screen. Drag the box to scroll, drag
// either edge to zoom, click anywhere else to jump there, double-click to
// fit the song to the window. The arithmetic lives in
// lib/arrangement-overview.ts; this file draws and listens.
//
// FollowPlayhead, below, is the "Follow" behaviour: while the transport
// plays, the view keeps the playhead on screen — by the page ('page') or by
// gliding ('scroll') — and pauses the moment you scroll or drag, so an edit
// is never yanked out from under the pointer. It re-arms when playback
// starts again.

import { useEffect, useRef, useState } from 'react'
import { useDaw, useDawPlayhead } from '@/lib/daw-state'
import { overviewFrame, zoomBox, scrollForBoxX, scrollToCentreOn, beatWForBox, hitZone, followScroll, type FollowMode } from '@/lib/arrangement-overview'

export const OVERVIEW_H = 26

export default function ArrangementOverview({ beatW, scrollLeft, viewWidth, hdrW, minScroll, minBeatW, maxBeatW, onScroll, onZoom, onFit }: {
  beatW: number
  scrollLeft: number
  viewWidth: number
  hdrW: number
  minScroll: number
  minBeatW: number
  maxBeatW: number
  onScroll: (scrollLeft: number) => void
  onZoom: (beatW: number, scrollLeft: number) => void
  onFit: () => void
}) {
  const { project } = useDaw()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const playhead = useDawPlayhead()
  const [hover, setHover] = useState<'left' | 'right' | 'inside' | 'outside' | null>(null)

  const width = Math.max(40, Math.floor(viewWidth))
  const bpb = project.timeSignatureNum ?? 4
  const lastEnd = project.arrangementClips.reduce((m, c) => Math.max(m, c.startBeat + c.durationBeats), 0)
  const frame = overviewFrame(lastEnd, width, bpb)
  const box = zoomBox(frame, scrollLeft, viewWidth, beatW)

  // Draw: track slivers, bar ticks, the box, the playhead.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = width * dpr; canvas.height = OVERVIEW_H * dpr
    canvas.style.width = `${width}px`; canvas.style.height = `${OVERVIEW_H}px`
    const ctx = canvas.getContext('2d')!
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, width, OVERVIEW_H)
    const tracks = project.tracks.filter(t => t.kind !== 'group')
    const rowH = tracks.length ? Math.max(1.5, Math.min(4, (OVERVIEW_H - 6) / tracks.length)) : 0
    const rowIndex = new Map(tracks.map((t, i) => [t.id, i]))
    // Bar ticks, every 4 bars, faint.
    ctx.fillStyle = 'rgba(255,255,255,0.08)'
    for (let b = 0; b <= frame.songBeats; b += bpb * 4) ctx.fillRect(Math.round(b * frame.pxPerBeat), 0, 1, OVERVIEW_H)
    for (const c of project.arrangementClips) {
      const row = rowIndex.get(c.trackId)
      if (row == null) continue
      const track = tracks[row]
      ctx.fillStyle = c.active === false ? 'rgba(120,120,120,0.45)' : track.color
      ctx.globalAlpha = c.active === false ? 0.5 : 0.85
      ctx.fillRect(c.startBeat * frame.pxPerBeat, 3 + row * rowH, Math.max(1, c.durationBeats * frame.pxPerBeat - 0.5), Math.max(1, rowH - 0.5))
    }
    ctx.globalAlpha = 1
    // The box: a light wash inside, bright edges.
    ctx.fillStyle = 'rgba(255,255,255,0.10)'
    ctx.fillRect(box.x, 0, box.w, OVERVIEW_H)
    ctx.strokeStyle = 'rgba(255,255,255,0.55)'
    ctx.lineWidth = 1
    ctx.strokeRect(box.x + 0.5, 0.5, box.w - 1, OVERVIEW_H - 1)
    // The playhead.
    const px = playhead * frame.pxPerBeat
    if (px >= 0 && px <= width) {
      ctx.fillStyle = 'rgba(255,220,50,0.9)'
      ctx.fillRect(Math.round(px), 0, 1, OVERVIEW_H)
    }
  }, [project.arrangementClips, project.tracks, width, frame.songBeats, frame.pxPerBeat, box.x, box.w, playhead, bpb])

  const dragRef = useRef<{ zone: 'left' | 'right' | 'inside'; startX: number; box: { x: number; w: number }; scroll: number; beatW: number } | null>(null)
  const localX = (e: React.PointerEvent) => e.clientX - e.currentTarget.getBoundingClientRect().left

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    const x = localX(e)
    const zone = hitZone(x, box)
    if (zone === 'outside') { onScroll(scrollToCentreOn(frame, x, viewWidth, beatW, minScroll)); return }
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* tests */ }
    dragRef.current = { zone, startX: x, box: { ...box }, scroll: scrollLeft, beatW }
  }
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const x = localX(e)
    const d = dragRef.current
    if (!d) { setHover(hitZone(x, box)); return }
    const dx = x - d.startX
    if (d.zone === 'inside') { onScroll(scrollForBoxX(frame, d.box.x + dx, d.beatW, minScroll)); return }
    // An edge drag changes the box width — the zoom — keeping the other edge still.
    const left = d.zone === 'left' ? d.box.x + dx : d.box.x
    const right = d.zone === 'right' ? d.box.x + d.box.w + dx : d.box.x + d.box.w
    const w = Math.max(6, right - left)
    const nextBeatW = beatWForBox(frame, w, viewWidth, minBeatW, maxBeatW)
    onZoom(nextBeatW, scrollForBoxX(frame, Math.min(left, right - 6), nextBeatW, minScroll))
  }
  const onPointerUp = () => { dragRef.current = null }

  const cursor = hover === 'left' || hover === 'right' ? 'ew-resize' : hover === 'inside' ? 'grab' : 'pointer'
  return (
    <div data-help-id="overview" style={{ display: 'flex', flexShrink: 0, background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)' }}>
      <div style={{ width: hdrW, flexShrink: 0, borderRight: '1px solid var(--border)', display: 'flex', alignItems: 'center', padding: '0 8px', fontSize: 8, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Overview</div>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label="Song overview — drag the box to scroll, its edges to zoom, double-click to fit"
        title="Drag the box to scroll · drag an edge to zoom · click to jump · double-click to fit"
        data-overview-box-x={Math.round(box.x)}
        data-overview-box-w={Math.round(box.w)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => setHover(null)}
        onDoubleClick={onFit}
        style={{ display: 'block', cursor, touchAction: 'none' }}
      />
    </div>
  )
}

/**
 * Keeps the playhead on screen while playing, in the chosen mode, and pauses
 * on an edit (the parent bumps `pauseNonce` whenever the person scrolls or
 * drags). Renders nothing.
 */
export function FollowPlayhead({ mode, beatW, scrollLeft, viewWidth, minScroll, pauseNonce, onScroll }: {
  mode: FollowMode
  beatW: number
  scrollLeft: number
  viewWidth: number
  minScroll: number
  pauseNonce: number
  onScroll: (scrollLeft: number) => void
}) {
  const { engine } = useDaw()
  const beat = useDawPlayhead()
  const pausedRef = useRef(false)
  const lastNonce = useRef(pauseNonce)
  // An edit pauses following until the transport starts again.
  if (pauseNonce !== lastNonce.current) { lastNonce.current = pauseNonce; pausedRef.current = true }
  useEffect(() => {
    const onTransport = (e: Event) => { if ((e as CustomEvent<{ playing: boolean }>).detail.playing) pausedRef.current = false }
    engine.addEventListener('transport', onTransport)
    return () => engine.removeEventListener('transport', onTransport)
  }, [engine])
  useEffect(() => {
    if (mode === 'off' || pausedRef.current || !engine.isPlaying) return
    const next = followScroll(mode, beat, scrollLeft, viewWidth, beatW, minScroll)
    if (next != null && Math.abs(next - scrollLeft) > 0.5) onScroll(next)
  }, [beat, mode, beatW, viewWidth, minScroll, scrollLeft, onScroll, engine])
  return null
}
