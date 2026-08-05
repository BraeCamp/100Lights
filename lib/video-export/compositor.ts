/**
 * Timeline compositor — draws one output frame that matches the editor PREVIEW
 * (components/editor/VideoPlayer.tsx) exactly, so what you export is what you saw.
 *
 * The preview is a single-clip monitor: at any time T it shows the first
 * enabled clip under the playhead (respecting mute/solo/track order) with a CSS
 * `filter` grade, a CSS `transform` (crop/flip/Ken-Burns), fade + opacity, a
 * vignette overlay, and title/caption text. This module replays that same math
 * onto a 2D canvas — `ctx.filter` accepts the identical CSS filter functions, so
 * the colour grade is reproduced verbatim rather than re-approximated.
 *
 * NOT reproduced (because the preview itself does not render them): multi-track
 * compositing, transitions, and LUTs (LUTs are applied only to an invisible
 * offscreen buffer today). Those would need preview support first.
 */

import type { TimelineItem, Track, VideoAdjustments } from '@/lib/editor-types'
import type { Caption } from '@/lib/types'

export interface CompositorState {
  items:       TimelineItem[]
  tracks:      Track[]
  adjustments: VideoAdjustments   // global grade (matches the editor's single adjustments state)
  captions:    Caption[]
  width:       number
  height:      number
}

/** Resolves the playing <video> element for a clip URL (owned by the capture layer). */
export interface MediaResolver {
  get(url: string): HTMLVideoElement | undefined
}

// ── Ported verbatim from VideoPlayer.buildFilter (do not "improve" — parity) ──
export function buildFilter(adj?: VideoAdjustments): string {
  if (!adj) return 'none'
  const parts: string[] = []
  if (adj.brightness !== 100)  parts.push(`brightness(${adj.brightness / 100})`)
  if (adj.contrast !== 100)    parts.push(`contrast(${adj.contrast / 100})`)
  if (adj.saturation !== 100)  parts.push(`saturate(${adj.saturation / 100})`)
  const shadows = adj.shadows ?? 0
  if (shadows !== 0)           parts.push(`brightness(${1 + shadows / 400})`)
  const midtones = adj.midtones ?? 0
  if (midtones !== 0)          parts.push(`contrast(${1 + midtones / 200})`)
  if (adj.highlights !== 0)    parts.push(`brightness(${1 + adj.highlights / 300})`)
  const lift = adj.lift ?? 0
  const gamma = adj.gamma ?? 100
  const gain = adj.gain ?? 100
  if (lift !== 0)              parts.push(`brightness(${1 + lift / 400})`)
  if (gamma !== 100)           parts.push(`brightness(${0.5 + gamma / 200})`)
  if (gain !== 100)            parts.push(`brightness(${gain / 100})`)
  return parts.length ? parts.join(' ') : 'none'
}

// ── Ported from VideoEditor.viewerClip ────────────────────────────────────────
export function pickViewerClip(items: TimelineItem[], tracks: Track[], t: number): TimelineItem | null {
  const isMedia = (tr: Track) => tr.type === 'media' || tr.type === 'video' || tr.type === 'audio'
  const hasSolo = tracks.some(tr => isMedia(tr) && tr.solo)
  const mediaTracks = tracks.filter(tr => isMedia(tr) && !tr.muted && (!hasSolo || tr.solo))
  for (const track of mediaTracks) {
    const hit = items.find(i =>
      i.trackId === track.id &&
      i.enabled !== false &&
      t >= i.startTime &&
      t < i.startTime + (i.outPoint - i.inPoint),
    )
    if (hit) return hit
  }
  return null
}

interface ClipTransform {
  opacity: number; flipH: boolean; flipV: boolean
  cropZoom: number; cropX: number; cropY: number; fadeOpacity: number
}

// ── Ported from VideoEditor.clipTransform (fade envelope + Ken Burns) ──────────
export function computeClipTransform(clip: TimelineItem, t: number): ClipTransform {
  const clipDur = clip.outPoint - clip.inPoint
  const local   = t - clip.startTime
  let fadeOpacity = 1
  if (clip.fadeIn && clip.fadeIn > 0 && local < clip.fadeIn) {
    fadeOpacity = Math.min(1, local / clip.fadeIn)
  }
  if (clip.fadeOut && clip.fadeOut > 0 && local > clipDur - clip.fadeOut) {
    fadeOpacity = Math.min(fadeOpacity, Math.min(1, (clipDur - local) / clip.fadeOut))
  }
  let cropZoom = clip.cropZoom ?? 100
  let cropX    = clip.cropX ?? 0
  let cropY    = clip.cropY ?? 0
  if (clip.kenBurns && clipDur > 0) {
    const f = Math.max(0, Math.min(1, local / clipDur))
    const s = f * f * (3 - 2 * f)  // smooth-step
    const kb = clip.kenBurns
    cropZoom = kb.fromZoom + (kb.toZoom - kb.fromZoom) * s
    cropX    = kb.fromX    + (kb.toX    - kb.fromX)    * s
    cropY    = kb.fromY    + (kb.toY    - kb.fromY)    * s
  }
  return {
    opacity: clip.opacity ?? 100,
    flipH: clip.flipH ?? false,
    flipV: clip.flipV ?? false,
    cropZoom, cropX, cropY, fadeOpacity,
  }
}

/** objectFit:contain rect of a `srcW×srcH` image inside `W×H`. */
function containRect(srcW: number, srcH: number, W: number, H: number) {
  if (!srcW || !srcH) return { x: 0, y: 0, w: W, h: H }
  const scale = Math.min(W / srcW, H / srcH)
  const w = srcW * scale, h = srcH * scale
  return { x: (W - w) / 2, y: (H - h) / 2, w, h }
}

/**
 * Draw the composited frame for timeline time `t` into `ctx` (sized W×H).
 * `media.get(url)` must return a <video> already seeked/playing to the right time.
 */
export function drawFrame(
  ctx: CanvasRenderingContext2D,
  state: CompositorState,
  media: MediaResolver,
  t: number,
): void {
  const { width: W, height: H, adjustments } = state

  // Background — the preview monitor is solid black (#000).
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalAlpha = 1
  ctx.filter = 'none'
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, W, H)

  const clip = pickViewerClip(state.items, state.tracks, t)
  if (!clip) return

  if (clip.contentType === 'title') {
    drawTitle(ctx, clip, t, W, H)
    return
  }

  // Video (audio-only clips render as black here; captions still draw below).
  if (clip.contentType !== 'audio' && clip.url) {
    const v = media.get(clip.url)
    if (v && v.videoWidth > 0) {
      const tf = computeClipTransform(clip, t)
      const rect = containRect(v.videoWidth, v.videoHeight, W, H)

      ctx.save()
      // Match CSS transform-origin:center and the buildClipStyle list order
      // (scale → translate(%) → flipX → flipV), which composes to the same matrix.
      ctx.translate(W / 2, H / 2)
      if (tf.cropZoom !== 100) ctx.scale(tf.cropZoom / 100, tf.cropZoom / 100)
      if (tf.cropX !== 0 || tf.cropY !== 0) ctx.translate((tf.cropX / 100) * W, (tf.cropY / 100) * H)
      if (tf.flipH) ctx.scale(-1, 1)
      if (tf.flipV) ctx.scale(1, -1)
      ctx.translate(-W / 2, -H / 2)

      // Colour grade + motion blur, exactly as the preview builds them.
      let filter = buildFilter(adjustments)
      if (clip.motionBlurEnabled) {
        const speed = clip.speed ?? 1
        const px = Math.min(6, Math.max(0, Math.abs(speed - 1) * 2.5))
        if (px > 0.1) filter = filter === 'none' ? `blur(${px.toFixed(1)}px)` : `${filter} blur(${px.toFixed(1)}px)`
      }
      ctx.filter = filter
      ctx.globalAlpha = (tf.opacity / 100) * tf.fadeOpacity
      if (clip.blendMode) ctx.globalCompositeOperation = clip.blendMode as GlobalCompositeOperation
      ctx.drawImage(v, rect.x, rect.y, rect.w, rect.h)
      ctx.restore()
    }
  }

  // Vignette overlay (separate radial gradient in the preview, above the video).
  const vignette = adjustments.vignette ?? 0
  if (vignette > 0) {
    ctx.save()
    ctx.filter = 'none'
    ctx.globalCompositeOperation = 'source-over'
    const inner = Math.max(20, 80 - vignette) / 100
    const outerAlpha = Math.min(0.95, vignette / 80)
    const cx = W / 2, cy = H / 2
    const r = Math.hypot(W, H) / 2
    const g = ctx.createRadialGradient(cx, cy, r * inner, cx, cy, r)
    g.addColorStop(0, 'rgba(0,0,0,0)')
    g.addColorStop(1, `rgba(0,0,0,${outerAlpha})`)
    ctx.fillStyle = g
    ctx.fillRect(0, 0, W, H)
    ctx.restore()
  }

  // Captions (video-mode overlay). Matches VideoPlayer's bottom caption box.
  const cap = state.captions.find(c => t >= c.start && t <= c.end)
  if (cap) drawCaption(ctx, cap.text, cap.speaker, W, H)
}

// ── Title clip ────────────────────────────────────────────────────────────────
function drawTitle(ctx: CanvasRenderingContext2D, clip: TimelineItem, t: number, W: number, H: number) {
  const text = clip.titleText ?? ''
  if (!text) return
  const clipDur = clip.outPoint - clip.inPoint
  const local = clipDur > 0 ? (t - clip.startTime) / clipDur : 0
  const fontSize = clip.titleFontSize ?? 48
  const color    = clip.titleColor ?? '#ffffff'
  const bg       = clip.titleBg ?? 'transparent'
  const pos      = clip.titlePosition ?? 'center'
  const anim     = clip.titleAnimation ?? 'none'

  // Animation opacity + slide, ported from the preview.
  const opacity =
    anim === 'fade'     ? Math.min(1, local * 4) * Math.min(1, (1 - local) * 4) :
    anim === 'slide-up' ? Math.min(1, local * 6) : 1
  const slideY = anim === 'slide-up' ? Math.max(0, (1 - local * 4) * 24) : 0

  let y = pos === 'upper' ? H * 0.10 + fontSize
        : pos === 'lower-third' ? H * 0.88
        : H / 2
  y += slideY

  ctx.save()
  ctx.globalAlpha = Math.max(0, opacity)
  ctx.filter = 'none'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `700 ${fontSize}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`
  try { (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = '-0.01em' } catch { /* older browsers */ }

  if (bg !== 'transparent') {
    const m = ctx.measureText(text)
    const padX = 12, padY = 4
    const boxW = m.width + padX * 2
    const boxH = fontSize * 1.2 + padY * 2
    ctx.fillStyle = bg
    roundRect(ctx, W / 2 - boxW / 2, y - boxH / 2, boxW, boxH, 4)
    ctx.fill()
  } else {
    ctx.shadowColor = 'rgba(0,0,0,0.8)'
    ctx.shadowBlur = 4
    ctx.shadowOffsetY = 1
  }
  ctx.fillStyle = color
  ctx.fillText(text, W / 2, y)
  ctx.restore()
}

// ── Caption box ───────────────────────────────────────────────────────────────
function drawCaption(ctx: CanvasRenderingContext2D, text: string, speaker: string | undefined, W: number, H: number) {
  const fontSize = Math.round(H * 0.028)
  ctx.save()
  ctx.filter = 'none'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `500 ${fontSize}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`
  const label = speaker ? `${speaker}  ${text}` : text
  const m = ctx.measureText(label)
  const padX = 16, padY = 8
  const boxW = Math.min(W * 0.8, m.width + padX * 2)
  const boxH = fontSize + padY * 2
  const cx = W / 2
  const y = H - H * 0.08 - boxH / 2
  ctx.fillStyle = 'rgba(0,0,0,0.75)'
  roundRect(ctx, cx - boxW / 2, y - boxH / 2, boxW, boxH, 4)
  ctx.fill()
  ctx.fillStyle = '#fff'
  ctx.shadowColor = 'rgba(0,0,0,0.8)'
  ctx.shadowBlur = 2
  ctx.shadowOffsetY = 1
  ctx.fillText(label, cx, y)
  ctx.restore()
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}
