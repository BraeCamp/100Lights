// ─────────────────────────────────────────────────────────────────────────────
// Self-describing render manifest — a GATED, agent-only "what happened when".
//
// The compositor already knows the ground truth of every frame it draws: which
// clip is on screen, its exact zoom/pan/opacity, which titles are up, and any
// transition. An automated editor (which cannot WATCH playback or HEAR audio)
// can read this manifest to verify an edit's TIMING and SYNC precisely —
// where the cuts land, the shape of a zoom curve (push vs snap, eased vs
// linear), when overlays enter/exit — instead of guessing from stills.
//
// It is OFF by default. Normal user exports pay only a single boolean check
// per frame (drawFrame → `if (manifestEnabled())`), so speed is unaffected.
// An agent turns it on via `window.__renderManifest.start()` (dev-only), runs
// the export, then reads `window.__renderManifest.get()`.
// ─────────────────────────────────────────────────────────────────────────────

export interface ManifestFrame {
  t: number                 // timeline seconds
  frame: number             // 0-based index in this recording
  viewer: string | null     // the main on-screen clip id — a CHANGE here is a CUT
  visible: string[]         // all visible clip ids (layer stack)
  zoom: number              // cropZoom, 100 = none (the zoom/pan curve lives in these)
  x: number                 // cropX pan
  y: number                 // cropY pan
  opacity: number           // fadeOpacity 0–1
  titles: { id: string; text: string; anim: string }[]  // active title overlays
  transition: { type: string; p: number } | null        // active transition + progress
}

let _on = false
let _frames: ManifestFrame[] = []
let _n = 0
let _meta: Record<string, unknown> = {}

export function manifestEnabled(): boolean { return _on }

/** Begin recording. `meta` (fps/width/height/label) is echoed back in getManifest(). */
export function startManifest(meta: Record<string, unknown> = {}): void {
  _on = true; _frames = []; _n = 0; _meta = { ...meta }
}

export function stopManifest(): void { _on = false }

export function pushManifestFrame(f: Omit<ManifestFrame, 'frame'>): void {
  if (_on) _frames.push({ ...f, frame: _n++ })
}

export function getManifest(): { meta: Record<string, unknown>; frameCount: number; frames: ManifestFrame[] } {
  return { meta: _meta, frameCount: _frames.length, frames: _frames }
}

// Dev-only agent surface. Absent in production, so there is no exposure and the
// hot path (drawFrame) is untouched for real users beyond one boolean read.
if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  (window as unknown as { __renderManifest?: unknown }).__renderManifest = {
    start: startManifest, stop: stopManifest, get: getManifest, enabled: manifestEnabled,
  }
}
