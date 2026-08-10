// Cheap-AI backgrounds for the song-video engine — the visual side of the "$0 default, AI optional"
// principle. The DEFAULT is fully PROCEDURAL: audio-reactive gradients / aurora / particles derived
// from the song's accent colour + live energy → no AI, no cost, and it never repeats identically
// (driven by the audio). A POOLED AI image (generated once per genre/mood and reused across songs)
// can be dropped in as o.bgImage for the premium look — so the common case pays nothing for imagery
// and AI is spent once, not per song. Pure functions are node-testable; drawBackground uses a canvas
// 2D context (browser / offscreen).

export const BG_STYLES = ['aurora', 'nebula', 'waves']

// ── palette derivation (PURE — testable) ─────────────────────────────────────────────────────────
export function hexToRgb(h) {
  h = String(h || '#7c5cff').replace('#', '')
  if (h.length === 3) h = h.split('').map(c => c + c).join('')
  const n = parseInt(h, 16) || 0
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
// Rotate an rgb toward its neighbours by `deg` (cheap hue variation without full HSL round-trips).
function rot([r, g, b], deg) {
  const t = ((deg % 360) + 360) % 360 / 360
  return [r * (1 - t) + g * t, g * (1 - t) + b * t, b * (1 - t) + r * t]
}
/** A small analogous/complementary palette from one accent hex — the recipe both the procedural
 *  backgrounds and (later) an AI prompt can key off. */
export function bgPalette(accent) {
  const base = hexToRgb(accent)
  return { base, warm: rot(base, 40).map(Math.round), cool: rot(base, 200).map(Math.round), accent: rot(base, 90).map(Math.round) }
}

const rgba = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`
const avg = a => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s / (a.length || 1) }
const bass = a => { let s = 0, n = Math.max(1, a.length >> 3); for (let i = 0; i < n; i++) s += a[i]; return s / n / 255 }

// ── drawBackground (browser canvas) ──────────────────────────────────────────────────────────────
// f (frame) is optional; when it carries f.freq (an AnalyserNode's byte spectrum) the background
// reacts to the audio. t = seconds.
export function drawBackground(ctx, style, opts = {}, W, H, t = 0, f = null) {
  const pal = bgPalette(opts.accent)
  const energy = f && f.freq ? avg(f.freq) / 255 : 0.4
  const low = f && f.freq ? bass(f.freq) : 0.4
  ctx.save()
  if (style === 'nebula') nebula(ctx, pal, W, H, t, energy, low)
  else if (style === 'waves') waves(ctx, pal, W, H, t, energy, low)
  else aurora(ctx, pal, W, H, t, energy, low)
  ctx.restore()
}

function aurora(ctx, pal, W, H, t, e, low) {
  ctx.globalCompositeOperation = 'lighter'
  const blobs = [[pal.base, 0.30, 0.13], [pal.warm, 0.24, 0.17], [pal.cool, 0.20, 0.11]]
  const mx = Math.max(W, H)
  blobs.forEach(([col, sz, spd], i) => {
    const x = W * (0.3 + 0.42 * Math.sin(t * spd + i * 2.1))
    const y = H * (0.35 + 0.32 * Math.cos(t * (spd + 0.03) + i * 1.7))
    const r = mx * (sz + 0.08 * e) * (1 + 0.18 * Math.sin(t * 0.6 + i) + 0.25 * low)
    const g = ctx.createRadialGradient(x, y, 0, x, y, r)
    g.addColorStop(0, rgba(col, 0.42 + 0.32 * e)); g.addColorStop(1, rgba(col, 0))
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill()
  })
}

function nebula(ctx, pal, W, H, t, e, low) {
  ctx.globalCompositeOperation = 'lighter'
  const N = 90
  for (let i = 0; i < N; i++) {
    const seed = i * 12.9898
    const px = ((Math.sin(seed) * 43758.5453) % 1 + 1) % 1
    const py = ((Math.sin(seed * 1.7) * 24634.6345) % 1 + 1) % 1
    const drift = t * (0.01 + 0.02 * (px))
    const x = ((px + drift) % 1) * W
    const y = py * H + Math.sin(t * 0.3 + i) * 6
    const r = (1.2 + 2.6 * py) * (1 + 1.5 * e)
    const col = i % 3 === 0 ? pal.accent : i % 3 === 1 ? pal.warm : pal.cool
    ctx.fillStyle = rgba(col, 0.35 + 0.4 * e)
    ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill()
  }
}

function waves(ctx, pal, W, H, t, e, low) {
  ctx.globalCompositeOperation = 'lighter'
  const bands = [[pal.cool, 0.62, 0.6], [pal.base, 0.74, 0.9], [pal.warm, 0.86, 1.2]]
  bands.forEach(([col, yBase, spd], bi) => {
    ctx.beginPath(); ctx.moveTo(0, H)
    for (let x = 0; x <= W; x += 8) {
      const p = x / W
      const y = H * yBase + Math.sin(p * 6.28 * (1.5 + bi) + t * spd) * (18 + 60 * e + 40 * low) * (0.6 + 0.4 * bi)
      ctx.lineTo(x, y)
    }
    ctx.lineTo(W, H); ctx.closePath()
    const g = ctx.createLinearGradient(0, H * yBase - 80, 0, H)
    g.addColorStop(0, rgba(col, 0.28 + 0.25 * e)); g.addColorStop(1, rgba(col, 0.02))
    ctx.fillStyle = g; ctx.fill()
  })
}

/** Cover-fit an image (a pooled AI background) to WxH. */
export function drawCover(ctx, img, W, H) {
  const iw = img.width || img.videoWidth, ih = img.height || img.videoHeight
  if (!iw || !ih) return
  const ir = iw / ih, cr = W / H
  let dw, dh
  if (ir > cr) { dh = H; dw = H * ir } else { dw = W; dh = W / ir }
  ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh)
}

// ── Cheap AI VIDEO: a handful of cached AI stills → continuous motion ($0 per frame) ──────────────
// Ken-Burns pan/zoom each keyframe (so even a held image moves) and crossfade between them. N images
// (2–5, from the pooled AI backgrounds) become a moving "generated video" — AI cost = N stills, not
// hundreds of frames. Optional audio reactivity (a subtle zoom pulse on energy).
function kenBurns(ctx, img, W, H, t, seed, energy, alpha) {
  const zoom = 1.03 + 0.05 * (0.5 + 0.5 * Math.sin(t * 0.08 + seed * 1.3)) + 0.03 * energy
  const dir = seed % 4
  const panX = Math.cos(t * 0.05 + seed) * W * 0.035 * (dir < 2 ? 1 : -1)
  const panY = Math.sin(t * 0.045 + seed * 0.7) * H * 0.035 * (dir % 2 ? 1 : -1)
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.translate(W / 2 + panX, H / 2 + panY); ctx.scale(zoom, zoom); ctx.translate(-W / 2, -H / 2)
  drawCover(ctx, img, W, H)
  ctx.restore()
}

/** Which keyframe(s) are on screen at time t, and the crossfade weight — PURE, so the timing is
 *  node-testable. Returns { i, next, blend } where blend∈[0,1] is how much `next` shows over `i`. */
export function keyframeAt(t, n, holdSec = 4, xfadeSec = 1.5) {
  if (n <= 1) return { i: 0, next: 0, blend: 0 }
  const hold = Math.max(0.5, holdSec)
  const xf = Math.min(hold * 0.5, xfadeSec)
  const phase = t / hold
  const i = ((Math.floor(phase) % n) + n) % n
  const local = t - Math.floor(phase) * hold
  const blend = local > hold - xf ? (local - (hold - xf)) / xf : 0
  return { i, next: (i + 1) % n, blend: Math.max(0, Math.min(1, blend)) }
}

export function drawKeyframes(ctx, images, W, H, t, opts = {}, f = null) {
  const n = images.length
  if (!n) return
  const energy = f && f.freq ? avg(f.freq) / 255 : 0.3
  const { i, next, blend } = keyframeAt(t, n, opts.holdSec, opts.xfadeSec)
  kenBurns(ctx, images[i], W, H, t, i, energy, 1)
  if (blend > 0 && next !== i) kenBurns(ctx, images[next], W, H, t, next, energy, blend)
}
