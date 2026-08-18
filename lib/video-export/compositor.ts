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
 * compositing and LUTs (LUTs are applied only to an invisible offscreen buffer
 * today). Those would need preview support first.
 *
 * Transitions ARE rendered (dissolve / dip-to-black / wipe / push): during the
 * first `transitionDuration` seconds of a clip with `transitionIn`, the frame
 * blends from the PREVIOUS clip's frozen last frame — same freeze-frame model
 * the preview uses, so the two stay in parity.
 */

import type { CaptionStyle, TimelineItem, Track, TransitionType, VideoAdjustments } from '@/lib/editor-types'
import { effectCss, activeEffectCss, activeOverlays, type OverlayId } from '@/lib/video-effects'
import { activeSpotlight } from '@/lib/video-multicam'

// ── Overlay layer (grain / vignette / scanlines / glitch) — drawn on top of the graded frame ──────
let _noiseTile: HTMLCanvasElement | null = null
function noiseTile(): HTMLCanvasElement | null {
  if (_noiseTile) return _noiseTile
  if (typeof document === 'undefined') return null
  const N = 128, c = document.createElement('canvas'); c.width = N; c.height = N
  const cx = c.getContext('2d'); if (!cx) return null
  const img = cx.createImageData(N, N)
  for (let i = 0; i < img.data.length; i += 4) { const v = (Math.random() * 255) | 0; img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = v; img.data[i + 3] = 255 }
  cx.putImageData(img, 0, 0); _noiseTile = c; return c
}

function drawOverlays(ctx: CanvasRenderingContext2D, W: number, H: number, overlays: OverlayId[], t: number): void {
  if (!overlays.length) return
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.filter = 'none'
  for (const ov of overlays) {
    if (ov === 'vignette') {
      const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.34, W / 2, H / 2, Math.max(W, H) * 0.72)
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.55)')
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H)
    } else if (ov === 'scanlines') {
      ctx.globalAlpha = 0.16; ctx.fillStyle = '#000'
      for (let y = 0; y < H; y += 3) ctx.fillRect(0, y, W, 1)
      ctx.globalAlpha = 1
    } else if (ov === 'grain' || ov === 'vhs') {
      const tile = noiseTile()
      if (tile) {
        const pat = ctx.createPattern(tile, 'repeat')
        if (pat) { ctx.globalCompositeOperation = 'overlay'; ctx.globalAlpha = 0.10; ctx.fillStyle = pat; const ox = (Math.random() * tile.width) | 0, oy = (Math.random() * tile.height) | 0; ctx.save(); ctx.translate(-ox, -oy); ctx.fillRect(ox, oy, W + tile.width, H + tile.height); ctx.restore(); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1 }
      }
    } else if (ov === 'glitch') {
      const seed = Math.sin(t * 12.9898) * 43758.5453; const fire = (seed - Math.floor(seed)) > 0.55
      if (fire) { for (let k = 0; k < 3; k++) { const sy = (Math.random() * H) | 0, sh = (2 + Math.random() * 9) | 0, dx = ((Math.random() * 22) - 11) | 0; try { ctx.globalAlpha = 0.85; ctx.drawImage(ctx.canvas, 0, sy, W, sh, dx, sy, W, sh) } catch { /* tainted */ } } ctx.globalAlpha = 1 }
    }
  }
  ctx.restore()
}
import { DEFAULT_CAPTION_STYLE } from '@/lib/editor-types'
import type { Caption } from '@/lib/types'
import { captionWords } from '@/lib/captions'
import type { LutData } from '@/lib/lut-parser'
import { getLutGL } from './lut-gl'
import { createMusicViz, DEFAULT_MUSIC_VIZ_FORMAT, type MusicVizRenderer } from '@/lib/music-viz'
import { followPan } from '@/lib/focus-utils'
import { manifestEnabled, pushManifestFrame } from './manifest'
import { fontStack, titleAnim, titleFontPx, revealLines, titleWordStates, readableText, beatPulse } from '@/lib/text-styles'

// A persistent corner watermark drawn on top of every frame (branding). Not a timeline clip — it
// survives all timeline edits and always stays in its corner. Set via window.__video.setWatermark.
export interface Watermark {
  text:       string
  position?:  'br' | 'bl' | 'tr' | 'tl'   // corner, default 'br'
  opacity?:   number   // 0..1, default 0.62
  sizePct?:   number   // font size as % of frame height, default 2.6
  color?:     string   // default '#ffffff'
  font?:      string   // FONT_LIBRARY id
  weight?:    number   // default 700
}

export interface CompositorState {
  items:        TimelineItem[]
  tracks:       Track[]
  adjustments:  VideoAdjustments   // global grade (matches the editor's single adjustments state)
  captions:     Caption[]
  captionStyle?: CaptionStyle
  luts?:        Map<string, LutData>   // parsed .cube LUTs keyed by MediaItem id (clip.lutId)
  width:        number
  height:       number
  watermark?:   Watermark | null      // persistent branding overlay, drawn last
}

/** Resolves the playing <video> element for a clip (owned by the capture layer). */
export interface MediaResolver {
  get(clip: TimelineItem): HTMLVideoElement | HTMLImageElement | undefined
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
// effect + spotlight items are directives, not visual layers.
const isVisualLayer = (i: TimelineItem) => i.contentType !== 'effect' && i.contentType !== 'spotlight'

export function pickViewerClip(items: TimelineItem[], tracks: Track[], t: number): TimelineItem | null {
  const isMedia = (tr: Track) => tr.type === 'media' || tr.type === 'video' || tr.type === 'audio'
  const hasSolo = tracks.some(tr => isMedia(tr) && tr.solo)
  const mediaTracks = tracks.filter(tr => isMedia(tr) && !tr.muted && (!hasSolo || tr.solo))
  const findOn = (trackId: string) => items.find(i =>
    i.trackId === trackId && i.enabled !== false && isVisualLayer(i) &&
    t >= i.startTime && i.startTime + (i.outPoint - i.inPoint) > t)
  // Multicam: while a spotlight is active, the selected camera is the viewer clip.
  const spot = activeSpotlight(items, t)
  if (spot) { const h = findOn(spot); if (h) return h }
  for (const track of mediaTracks) { const h = findOn(track.id); if (h) return h }
  return null
}

/**
 * All non-title clips visible at `t`, BOTTOM → TOP. Track order is stacking order:
 * tracks[0] is the top layer. One clip per track — the layer stack. Title clips are NOT here: they're
 * overlays (several can overlap on one track and all must show), so they're collected by activeTitleClips
 * and drawn on top separately.
 */
export function pickVisibleClips(items: TimelineItem[], tracks: Track[], t: number): TimelineItem[] {
  const isMedia = (tr: Track) => tr.type === 'media' || tr.type === 'video' || tr.type === 'audio'
  const hasSolo = tracks.some(tr => isMedia(tr) && tr.solo)
  const mediaTracks = tracks.filter(tr => isMedia(tr) && !tr.muted && (!hasSolo || tr.solo))
  const spot = activeSpotlight(items, t)
  const stack: TimelineItem[] = []
  for (let i = mediaTracks.length - 1; i >= 0; i--) {   // bottom first
    const track = mediaTracks[i]
    const hit = items.find(it =>
      it.trackId === track.id &&
      it.enabled !== false &&
      isVisualLayer(it) &&
      it.contentType !== 'title' &&
      t >= it.startTime &&
      it.startTime + (it.outPoint - it.inPoint) > t,
    )
    if (!hit) continue
    // Multicam: only the spotlighted camera's VIDEO shows; musicviz overlays still layer on top.
    if (spot && hit.trackId !== spot && hit.contentType !== 'musicviz') continue
    stack.push(hit)
  }
  return stack
}

/**
 * Every title clip visible at `t`, in draw order (bottom → top = earlier-starting → later-starting), so
 * MULTIPLE overlapping title clips on one track all render (a stacked kinetic paragraph, or annotations
 * layered on the same clip). Respects track mute/solo. These are drawn on top of the video stack.
 */
export function activeTitleClips(items: TimelineItem[], tracks: Track[], t: number): TimelineItem[] {
  const isMedia = (tr: Track) => tr.type === 'media' || tr.type === 'video' || tr.type === 'audio'
  const hasSolo = tracks.some(tr => isMedia(tr) && tr.solo)
  const ok = new Set(tracks.filter(tr => isMedia(tr) && !tr.muted && (!hasSolo || tr.solo)).map(tr => tr.id))
  return items
    .filter(it => it.contentType === 'title' && it.enabled !== false && ok.has(it.trackId)
      && t >= it.startTime && it.startTime + (it.outPoint - it.inPoint) > t)
    .sort((a, b) => a.startTime - b.startTime || a.trackId.localeCompare(b.trackId))
}

interface ClipTransform {
  opacity: number; flipH: boolean; flipV: boolean
  cropZoom: number; cropX: number; cropY: number; fadeOpacity: number
}

// Beat/drop "hype" punch: a decaying zoom bump at each hype beat (small) or drop (big). Returns the
// zoom MULTIPLIER bump (0 = none) — caller does cropZoom *= (1 + bump). `local` = seconds since the
// clip start; `beats`/`drops` are local-second punch times (assigned per clip by the hype pass).
export function hypePulseZoom(local: number, beats?: number[], drops?: number[]): number {
  let m = 0
  if (beats) for (const tb of beats) { const dt = local - tb; if (dt >= 0 && dt < 0.5) { const v = 0.06 * Math.exp(-9 * dt); if (v > m) m = v } }
  if (drops) for (const td of drops) { const dt = local - td; if (dt >= 0 && dt < 0.9) { const v = 0.15 * Math.exp(-6 * dt); if (v > m) m = v } }
  return m
}

// White-flash alpha (0..~0.32) that pops on each drop and decays fast (~0.16s). Drawn additively over
// the frame on drops, paired with the punch-zoom. `local` = seconds since clip start.
export function hypeFlashAlpha(local: number, drops?: number[]): number {
  if (!drops) return 0
  let a = 0
  for (const td of drops) { const dt = local - td; if (dt >= 0 && dt < 0.16) { const v = 0.32 * (1 - dt / 0.16); if (v > a) a = v } }
  return a
}

// ── Ported from VideoEditor.clipTransform (fade envelope + Ken Burns) ──────────
export function computeClipTransform(clip: TimelineItem, t: number, items?: TimelineItem[]): ClipTransform {
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
  // Follow-focus override: pan cropX/cropY to keep the linked dot centered.
  // Uses the (static) cropZoom for headroom — Ken-Burns zoom animation isn't
  // reflected in the pan amount (v1 limitation).
  if (clip.followFocusClipId && items) {
    const fp = followPan(clip, items, t)
    if (fp) { cropX = fp.cropX; cropY = fp.cropY }
  }
  // Beat/drop hype punch — a short decaying zoom bump on each beat/drop.
  if (clip.hypeBeats?.length || clip.hypeDrops?.length) {
    cropZoom *= 1 + hypePulseZoom(local, clip.hypeBeats, clip.hypeDrops)
  }
  return {
    opacity: clip.opacity ?? 100,
    flipH: clip.flipH ?? false,
    flipV: clip.flipV ?? false,
    cropZoom, cropX, cropY, fadeOpacity,
  }
}

/** objectFit rect of a `srcW×srcH` image inside `W×H` (contain letterboxes, cover fills). */
function fitRect(srcW: number, srcH: number, W: number, H: number, mode: 'contain' | 'cover') {
  if (!srcW || !srcH) return { x: 0, y: 0, w: W, h: H }
  const scale = mode === 'cover' ? Math.max(W / srcW, H / srcH) : Math.min(W / srcW, H / srcH)
  const w = srcW * scale, h = srcH * scale
  return { x: (W - w) / 2, y: (H - h) / 2, w, h }
}

// ── Transition-in ─────────────────────────────────────────────────────────────

export interface ActiveTransition {
  type: TransitionType
  p: number                    // 0–1 progress through the transition
  prev: TimelineItem | null    // clip whose frozen last frame we blend from (null = from black)
}

/**
 * The transition state for `clip` at timeline time `t`, or null when outside
 * the transition window. `prev` is the clip that occupied the SAME TRACK just
 * before this one started (with layer stacking, a transition is a within-track
 * event — other tracks stay visible as their own layers); it's null (blend
 * from black) when there was none or it can't be drawn (title/audio/no url).
 */
export function transitionAt(
  items: TimelineItem[],
  tracks: Track[],
  clip: TimelineItem,
  t: number,
): ActiveTransition | null {
  const type = clip.transitionIn
  if (!type) return null
  const clipDur = clip.outPoint - clip.inPoint
  const dur = Math.max(0.05, Math.min(clip.transitionDuration ?? 0.5, clipDur))
  const local = t - clip.startTime
  if (local < 0 || local >= dur) return null
  const tPrev = clip.startTime - 0.001
  let prev = items.find(i =>
    i.trackId === clip.trackId &&
    i.id !== clip.id &&
    i.enabled !== false &&
    tPrev >= i.startTime &&
    i.startTime + (i.outPoint - i.inPoint) > tPrev,
  ) ?? null
  if (prev && (
    prev.contentType === 'title' ||
    prev.contentType === 'audio' ||
    !prev.url
  )) prev = null
  return { type, p: Math.max(0, Math.min(1, local / dur)), prev }
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

  // Self-describing render tap (GATED — off for normal users). Records the ground truth of this frame
  // so an automated editor can verify cut/zoom/overlay TIMING without watching playback. One boolean
  // check when disabled; recomputes via the same pure resolvers the draw below uses.
  if (manifestEnabled()) {
    const viewer = pickViewerClip(state.items, state.tracks, t)
    const tr = viewer ? computeClipTransform(viewer, t, state.items) : null
    const trans = viewer ? transitionAt(state.items, state.tracks, viewer, t) : null
    pushManifestFrame({
      t: +t.toFixed(4),
      viewer: viewer?.id ?? null,
      visible: pickVisibleClips(state.items, state.tracks, t).map(c => c.id),
      zoom: tr ? +tr.cropZoom.toFixed(2) : 100,
      x: tr ? +tr.cropX.toFixed(1) : 0,
      y: tr ? +tr.cropY.toFixed(1) : 0,
      opacity: tr ? +tr.fadeOpacity.toFixed(3) : 1,
      titles: activeTitleClips(state.items, state.tracks, t).map(c => ({ id: c.id, text: (c.titleText ?? '').slice(0, 80), anim: c.titleAnimation ?? 'none' })),
      transition: trans ? { type: trans.type, p: +trans.p.toFixed(3) } : null,
    })
  }

  // Background — the preview monitor is solid black (#000).
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalAlpha = 1
  ctx.filter = 'none'
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, W, H)

  // Layer stack: every visible clip across tracks, bottom → top. A title clip
  // on an upper track renders as text OVER the video layers below it.
  const stack = pickVisibleClips(state.items, state.tracks, t)
  if (!stack.length) return

  for (const clip of stack) {
    if (clip.contentType === 'musicviz') {
      drawMusicViz(ctx, clip, t, W, H)
      continue
    }
    if (clip.contentType === 'audio' || !clip.url) continue   // audio layers draw nothing

    const trans = transitionAt(state.items, state.tracks, clip, t)
    if (!trans) {
      drawVideoClip(ctx, state, media, clip, t)
    } else {
      const { type, p, prev } = trans
      // The outgoing clip is drawn as its frozen last frame — the capture layer
      // pauses its element at the cut, so evaluating at just-before-the-cut
      // gives the matching transform/fade state.
      const tPrev = clip.startTime - 0.001
      switch (type) {
        case 'dissolve':
          if (prev) drawVideoClip(ctx, state, media, prev, tPrev)
          drawVideoClip(ctx, state, media, clip, t, { alphaMul: p })
          break
        case 'dip_black':
          // Fade up from black (background is already black).
          drawVideoClip(ctx, state, media, clip, t, { alphaMul: p })
          break
        case 'wipe_right':
          if (prev) drawVideoClip(ctx, state, media, prev, tPrev)
          ctx.save()
          ctx.beginPath()
          ctx.rect(0, 0, p * W, H)
          ctx.clip()
          drawVideoClip(ctx, state, media, clip, t)
          ctx.restore()
          break
        case 'push':
          if (prev) drawVideoClip(ctx, state, media, prev, tPrev, { offsetX: -p * W })
          drawVideoClip(ctx, state, media, clip, t, { offsetX: (1 - p) * W })
          break
      }
    }
  }

  // Title overlays — every active title clip, on top of the video stack (all overlapping ones render).
  for (const clip of activeTitleClips(state.items, state.tracks, t)) drawTitle(ctx, clip, t, W, H)

  // Persistent branding watermark — drawn last so it sits above everything.
  if (state.watermark?.text) drawWatermark(ctx, state.watermark, W, H)

  // Hype flash — a quick additive white pop on drops (paired with the punch-zoom), from the visible
  // clips' hypeDrops. Drawn over the video, under the vignette/captions.
  let flash = 0
  for (const clip of stack) { if (clip.hypeDrops?.length) { const a = hypeFlashAlpha(t - clip.startTime, clip.hypeDrops); if (a > flash) flash = a } }
  if (flash > 0) {
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.filter = 'none'
    ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = `rgba(255,255,255,${flash})`; ctx.fillRect(0, 0, W, H)
    ctx.restore()
  }

  // Effect overlays (grain / vignette / scanlines / glitch) — from the visible clips' looks + effect items.
  drawOverlays(ctx, W, H, activeOverlays(state.items, t, stack.map(c => c.look)), t)

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

  // Captions (video-mode overlay). Matches VideoPlayer's caption box.
  const cap = state.captions.find(c => t >= c.start && t <= c.end)
  if (cap) drawCaption(ctx, cap, state.captionStyle ?? DEFAULT_CAPTION_STYLE, t, W, H)
}

// ── Single video clip draw (transform + grade + blend) ────────────────────────
function drawVideoClip(
  ctx: CanvasRenderingContext2D,
  state: CompositorState,
  media: MediaResolver,
  clip: TimelineItem,
  t: number,
  opts?: { alphaMul?: number; offsetX?: number },
): void {
  if (!clip.url) return
  const v = media.get(clip)
  if (!v) return
  // Works for <video> (videoWidth/Height) and still <img> layers (naturalWidth/Height).
  const vw = (v as HTMLVideoElement).videoWidth || (v as HTMLImageElement).naturalWidth || (v as HTMLImageElement).width
  const vh = (v as HTMLVideoElement).videoHeight || (v as HTMLImageElement).naturalHeight || (v as HTMLImageElement).height
  if (!vw || !vh) return
  const { width: W, height: H, adjustments } = state

  const tf = computeClipTransform(clip, t, state.items)
  const rect = fitRect(vw, vh, W, H, clip.fitMode ?? 'contain')

  // LUT: route the frame through the GPU applier first; the graded canvas
  // stands in for the raw element. Skipped silently without WebGL2. Images skip LUT.
  let source: CanvasImageSource = v
  const lut = clip.lutId ? state.luts?.get(clip.lutId) : undefined
  if (lut && (v as HTMLVideoElement).videoWidth) {
    const graded = getLutGL()?.apply(v as HTMLVideoElement, lut, vw, vh)
    if (graded) source = graded
  }

  ctx.save()
  if (opts?.offsetX) ctx.translate(opts.offsetX, 0)
  // Match CSS transform-origin:center and the buildClipStyle list order
  // (scale → translate(%) → flipX → flipV), which composes to the same matrix.
  ctx.translate(W / 2, H / 2)
  if (tf.cropZoom !== 100) ctx.scale(tf.cropZoom / 100, tf.cropZoom / 100)
  if (tf.cropX !== 0 || tf.cropY !== 0) ctx.translate((tf.cropX / 100) * W, (tf.cropY / 100) * H)
  if (tf.flipH) ctx.scale(-1, 1)
  if (tf.flipV) ctx.scale(1, -1)
  ctx.translate(-W / 2, -H / 2)

  // Per-clip inset crop — clip the transformed ctx to the un-cropped region of
  // the W×H element box. This is the SAME box/space the preview's CSS clip-path
  // insets (local element box, BEFORE its transform, then transforms with it), so
  // preview and export clip identically. Cropped edges reveal the black/layers
  // below because we simply don't paint them.
  const cr = clip.crop
  if (cr && (cr.l || cr.t || cr.r || cr.b)) {
    const cl = Math.max(0, Math.min(0.45, cr.l || 0))
    const ct = Math.max(0, Math.min(0.45, cr.t || 0))
    const crr = Math.max(0, Math.min(0.45, cr.r || 0))
    const cb = Math.max(0, Math.min(0.45, cr.b || 0))
    ctx.beginPath()
    ctx.rect(cl * W, ct * H, (1 - cl - crr) * W, (1 - ct - cb) * H)
    ctx.clip()
  }

  // Colour grade + motion blur, exactly as the preview builds them.
  let filter = buildFilter(adjustments)
  const clipGrade = buildClipGradeFilter(clip)
  if (clipGrade) filter = filter === 'none' ? clipGrade : `${filter} ${clipGrade}`
  // Timeline EFFECT items active at t grade the whole frame for their span.
  const fxLook = activeEffectCss(state.items, t)
  if (fxLook) filter = filter === 'none' ? fxLook : `${filter} ${fxLook}`
  if (clip.motionBlurEnabled) {
    const speed = clip.speed ?? 1
    const px = Math.min(6, Math.max(0, Math.abs(speed - 1) * 2.5))
    if (px > 0.1) filter = filter === 'none' ? `blur(${px.toFixed(1)}px)` : `${filter} blur(${px.toFixed(1)}px)`
  }
  ctx.filter = filter
  ctx.globalAlpha = (tf.opacity / 100) * tf.fadeOpacity * (opts?.alphaMul ?? 1)
  if (clip.blendMode) ctx.globalCompositeOperation = clip.blendMode as GlobalCompositeOperation
  ctx.drawImage(source, rect.x, rect.y, rect.w, rect.h)
  ctx.restore()
}

/** Per-clip grade — CSS filter chain composed AFTER the global grade (parity with the preview). */
export function buildClipGradeFilter(clip: TimelineItem): string {
  const parts: string[] = []
  const g = clip.grade
  if (g) {
    if (g.brightness !== 100) parts.push(`brightness(${g.brightness / 100})`)
    if (g.contrast !== 100)   parts.push(`contrast(${g.contrast / 100})`)
    if (g.saturation !== 100) parts.push(`saturate(${g.saturation / 100})`)
  }
  // Named effect/look (lib/video-effects) — a CSS filter chain, on top of the manual grade.
  const look = effectCss(clip.look)
  if (look) parts.push(look)
  return parts.join(' ')
}

// ── Title clip ────────────────────────────────────────────────────────────────
// ── Music-visual overlay ──────────────────────────────────────────────────────
// Renders the clip's audio-reactive visual onto an offscreen canvas (via the same
// lib/music-viz renderer the preview uses) and composites it over the frame with
// the clip's opacity / blend mode, so it overlays the video rather than replacing
// it. NOTE: export currently drives the visual by time only (idle motion) — full
// audio-reactive export (an offline FFT of the mix per frame) is the next step;
// the preview already reacts live.
const mvRenderers = new Map<string, { key: string; viz: MusicVizRenderer }>()
let mvCanvas: HTMLCanvasElement | null = null
let mvCtx: CanvasRenderingContext2D | null = null
function drawMusicViz(ctx: CanvasRenderingContext2D, clip: TimelineItem, t: number, W: number, H: number) {
  if (typeof document === 'undefined') return
  const format = clip.mvFormat || DEFAULT_MUSIC_VIZ_FORMAT
  const accent = ((clip.mvMatchTheme ? getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() : '') || clip.mvAccent || '#a78bfa')
  const bg = clip.mvBg ?? null
  const key = `${format}|${accent}|${bg ? bg.join(',') : 'none'}`
  let entry = mvRenderers.get(clip.id)
  if (!entry || entry.key !== key) { entry = { key, viz: createMusicViz({ format, accent, bg }) }; mvRenderers.set(clip.id, entry) }
  if (!mvCanvas || mvCanvas.width !== W || mvCanvas.height !== H) {
    mvCanvas = document.createElement('canvas'); mvCanvas.width = W; mvCanvas.height = H
    mvCtx = mvCanvas.getContext('2d')
  }
  if (!mvCtx) return
  entry.viz.draw(mvCtx, W, H, Math.max(0, t - clip.startTime), null)
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.filter = 'none'
  ctx.globalAlpha = Math.max(0, Math.min(1, (clip.opacity ?? 100) / 100))
  if (clip.blendMode) ctx.globalCompositeOperation = clip.blendMode as GlobalCompositeOperation
  ctx.drawImage(mvCanvas, 0, 0)
  ctx.restore()
}

// Preload the (self-hosted) fonts any title clip uses, so the export canvas draws the real glyphs instead
// of a fallback. Best-effort: never throws, times out at 2.5s. The preview loads them via CSS already.
export async function ensureTitleFonts(items: TimelineItem[]): Promise<void> {
  if (typeof document === 'undefined' || !('fonts' in document)) return
  const fams = new Set<string>()
  for (const it of items) {
    if (it.contentType !== 'title' || !it.titleFont) continue
    const first = fontStack(it.titleFont).split(',')[0].trim().replace(/^["']|["']$/g, '')
    if (first) fams.add(first)
  }
  if (!fams.size) return
  const fonts = (document as Document & { fonts: { load(f: string): Promise<unknown>; ready: Promise<unknown> } }).fonts
  try {
    await Promise.race([
      Promise.all([...fams].map(f => fonts.load(`800 64px "${f}"`).catch(() => {}))),
      new Promise(r => setTimeout(r, 2500)),
    ])
  } catch { /* fall back to system faces */ }
}

// Corner branding watermark — a small, semi-transparent line pinned to a corner with a soft shadow
// for legibility over any footage. Frame-relative sizing so preview and export match.
function drawWatermark(ctx: CanvasRenderingContext2D, wm: Watermark, W: number, H: number) {
  const text = wm.text
  if (!text) return
  const pos = wm.position ?? 'br'
  const fontSize = Math.max(10, Math.round(H * ((wm.sizePct ?? 2.6) / 100)))
  const pad = Math.round(H * 0.032)
  const top = pos[0] === 't'
  const left = pos[1] === 'l'
  ctx.save()
  ctx.globalAlpha = Math.max(0, Math.min(1, wm.opacity ?? 0.62))
  ctx.font = `${wm.weight ?? 700} ${fontSize}px ${fontStack(wm.font)}`
  ctx.textAlign = left ? 'left' : 'right'
  ctx.textBaseline = top ? 'top' : 'alphabetic'
  ctx.shadowColor = 'rgba(0,0,0,0.55)'
  ctx.shadowBlur = fontSize * 0.28
  ctx.fillStyle = wm.color ?? '#ffffff'
  ctx.fillText(text, left ? pad : W - pad, top ? pad : H - pad)
  ctx.restore()
}

function drawTitle(ctx: CanvasRenderingContext2D, clip: TimelineItem, t: number, W: number, H: number) {
  let text = clip.titleText ?? ''
  if (!text) return
  if (clip.titleUppercase) text = text.toUpperCase()
  const lines = text.split('\n')
  const clipDur = clip.outPoint - clip.inPoint
  const local = clipDur > 0 ? (t - clip.startTime) / clipDur : 0
  const fontSize = titleFontPx(clip.titleFontSize, H)   // frame-relative, so preview and export match
  const color    = clip.titleColor ?? '#ffffff'
  const bg       = clip.titleBg ?? 'transparent'
  const pos      = clip.titlePosition ?? 'center'
  const anim     = clip.titleAnimation ?? 'none'
  const weight   = clip.titleWeight ?? 700
  const lh       = fontSize * 1.18

  const a = titleAnim(anim, local, clipDur, clip.titleAnimAmount ?? 1)
  const slideY = a.dy * fontSize
  const shown = revealLines(lines, a.reveal)   // typewriter: partial text (layout still uses full lines)

  const blockH = lines.length * lh
  const offY = (clip.titleOffsetY ?? 0) * (H / 1080)   // frame-relative vertical nudge (stacking)
  const cy = (pos === 'upper' ? H * 0.10 + blockH / 2 : pos === 'lower-third' ? H * 0.86 - blockH / 2 + lh / 2 : H / 2) + slideY + offY
  const y0 = cy - blockH / 2 + lh / 2

  const scaleF = a.scale * (1 + beatPulse(t, clip.titlePulseBpm) * 0.14)   // beat-synced pulse on top of the entrance scale
  const align = clip.titleAlign ?? 'center'
  const offX = (clip.titleOffsetX ?? 0) * (H / 1080)
  const ax = align === 'left' ? W * 0.06 : align === 'right' ? W * 0.94 : W / 2   // horizontal anchor
  // Left edge of a line's box given its measured width, per alignment.
  const boxLeft = (w: number) => align === 'left' ? ax : align === 'right' ? ax - w : ax - w / 2
  ctx.save()
  ctx.globalAlpha = Math.max(0, a.opacity * ((clip.titleOpacity ?? 100) / 100))
  ctx.filter = a.blur > 0.01 ? `blur(${(a.blur * fontSize).toFixed(1)}px)` : 'none'
  if (a.dx || offX) ctx.translate(a.dx * fontSize + offX, 0)   // shake + horizontal nudge
  if (scaleF !== 1) { ctx.translate(ax, cy); ctx.scale(scaleF, scaleF); ctx.translate(-ax, -cy) }
  ctx.textAlign = align
  ctx.textBaseline = 'middle'
  ctx.font = `${weight} ${fontSize}px ${fontStack(clip.titleFont)}`
  try { (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${clip.titleLetterSpacing ?? -0.01}em` } catch { /* older browsers */ }

  // Wipe reveal — clip to the left `wipe` fraction of the text block (uncovers left→right).
  if (a.wipe < 0.999) {
    const maxW = Math.max(1, ...lines.map(l => ctx.measureText(l).width))
    ctx.beginPath()
    ctx.rect(boxLeft(maxW) - fontSize * 0.1, cy - blockH / 2 - fontSize * 0.2, maxW * a.wipe + fontSize * 0.1, blockH + fontSize * 0.4)
    ctx.clip()
  }

  // Word-by-word / word-highlight: lay out and animate each word individually (the block animation is flat).
  const wordStates = titleWordStates(anim, lines, local, clipDur, clip.titleAnimAmount ?? 1)
  if (wordStates) {
    const activeColor = clip.titleActiveColor || '#fde047'
    const box = !!clip.titleActiveBox
    const spaceW = ctx.measureText(' ').width
    ctx.textAlign = 'left'
    wordStates.forEach((words, li) => {
      const ly = y0 + li * lh
      const widths = words.map(w => ctx.measureText(w.text).width)
      const totalW = widths.reduce((s, w) => s + w, 0) + spaceW * Math.max(0, words.length - 1)
      let x = W / 2 - totalW / 2
      words.forEach((w, i) => {
        const cxw = x + widths[i] / 2
        ctx.save()
        ctx.globalAlpha = Math.max(0, w.opacity * ((clip.titleOpacity ?? 100) / 100))
        if (w.scale !== 1) { ctx.translate(cxw, ly); ctx.scale(w.scale, w.scale); ctx.translate(-cxw, -ly) }
        if (w.active && box) {
          // Solid rounded box behind the active word (Hormozi look), text in a readable contrast color.
          ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0
          const padX = fontSize * 0.18
          roundRect(ctx, x - padX, ly - lh * 0.44, widths[i] + padX * 2, lh * 0.86, fontSize * 0.14)
          ctx.fillStyle = activeColor; ctx.fill()
          ctx.fillStyle = readableText(activeColor)
        } else {
          ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = fontSize * 0.1; ctx.shadowOffsetY = fontSize * 0.04
          ctx.fillStyle = w.active ? activeColor : color
        }
        ctx.fillText(w.text, x, ly)
        ctx.restore()
        x += widths[i] + spaceW
      })
    })
    ctx.restore()
    return
  }

  // Gradient text fill (vertical across the block) — else the solid color.
  let paint: string | CanvasGradient = color
  if (clip.titleGradient) {
    const gr = ctx.createLinearGradient(0, cy - blockH / 2, 0, cy + blockH / 2)
    gr.addColorStop(0, clip.titleGradient.from); gr.addColorStop(1, clip.titleGradient.to)
    paint = gr
  }

  // Highlight box behind the text (per line), if requested.
  if (bg !== 'transparent') {
    ctx.fillStyle = bg
    shown.forEach((ln, i) => {
      if (!ln) return
      const m = ctx.measureText(ln), padX = fontSize * 0.28, padY = fontSize * 0.14
      roundRect(ctx, boxLeft(m.width) - padX, y0 + i * lh - lh / 2 + padY * 0.4, m.width + padX * 2, lh - padY * 0.2, fontSize * 0.14)
      ctx.fill()
    })
  }

  shown.forEach((ln, i) => {
    if (!ln) return
    const ly = y0 + i * lh
    // Outline (stroke around the glyphs).
    if (clip.titleOutline && clip.titleOutline > 0) {
      ctx.lineJoin = 'round'; ctx.miterLimit = 2
      ctx.strokeStyle = clip.titleOutlineColor || '#000'; ctx.lineWidth = clip.titleOutline * (H / 1080) * 2
      ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0
      ctx.strokeText(ln, ax, ly)
    }
    // Glow (draw the fill twice with a colored shadow), then the soft drop shadow.
    if (clip.titleGlow) {
      ctx.shadowColor = clip.titleGlow; ctx.shadowBlur = fontSize * 0.5; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0
      ctx.fillStyle = paint; ctx.fillText(ln, ax, ly); ctx.fillText(ln, ax, ly)
    }
    if ((clip.titleShadow ?? bg === 'transparent')) { ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = fontSize * 0.1; ctx.shadowOffsetY = fontSize * 0.04 }
    else { ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0 }
    ctx.fillStyle = paint
    ctx.fillText(ln, ax, ly)
  })
  ctx.restore()
}

// ── Caption box ───────────────────────────────────────────────────────────────
// Styled + optional karaoke: when the style asks for karaoke and the caption
// carries word timings, each word is drawn separately with the active word in
// the highlight colour (past words full colour, future words dimmed).
function drawCaption(
  ctx: CanvasRenderingContext2D,
  cap: Caption,
  style: CaptionStyle,
  t: number,
  W: number,
  H: number,
) {
  const fontSize = Math.round(H * 0.028 * (style.size || 1))
  ctx.save()
  ctx.filter = 'none'
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `500 ${fontSize}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`

  const kWords = style.karaoke ? captionWords(cap) : []
  const karaoke = kWords.length > 0
  const label = karaoke ? kWords.map(w => w.w).join(' ')
             : cap.speaker ? `${cap.speaker}  ${cap.text}` : cap.text
  const m = ctx.measureText(label)
  const padX = 16, padY = 8
  const boxW = Math.min(W * 0.9, m.width + padX * 2)
  const boxH = fontSize + padY * 2
  const cx = W / 2
  const y = style.position === 'top'    ? H * 0.08 + boxH / 2
          : style.position === 'center' ? H / 2
          : H - H * 0.08 - boxH / 2

  if (style.bg !== 'none') {
    ctx.fillStyle = style.bg
    roundRect(ctx, cx - boxW / 2, y - boxH / 2, boxW, boxH, 4)
    ctx.fill()
  }
  ctx.shadowColor = 'rgba(0,0,0,0.8)'
  ctx.shadowBlur = style.bg === 'none' ? 4 : 2
  ctx.shadowOffsetY = 1

  if (!karaoke) {
    ctx.fillStyle = style.color
    ctx.fillText(label, cx, y)
    ctx.restore()
    return
  }

  // Karaoke: lay the words out centred, then paint each with its own colour.
  const words = kWords
  const spaceW = ctx.measureText(' ').width
  const widths = words.map(w => ctx.measureText(w.w).width)
  const totalW = widths.reduce((s, w) => s + w, 0) + spaceW * (words.length - 1)
  let x = cx - totalW / 2
  ctx.textAlign = 'left'
  for (let i = 0; i < words.length; i++) {
    const w = words[i]
    const active = t >= w.s && t <= w.e
    const past = t > w.e
    ctx.globalAlpha = active || past ? 1 : 0.55
    ctx.fillStyle = active ? style.highlightColor : style.color
    ctx.fillText(w.w, x, y)
    x += widths[i] + spaceW
  }
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
