import type { Caption, ContentType } from '@/lib/types'

export type TransitionType = 'dissolve' | 'dip_black' | 'wipe_right' | 'push'

// ── Project aspect ratio ──────────────────────────────────────
// The frame shape of the whole project: the preview stage, the compositor and
// the export canvas all derive their dimensions from this (not a guide overlay).

export type ProjectAspect = '16:9' | '9:16' | '1:1' | '4:5' | '2.35:1'

export const PROJECT_ASPECTS: ProjectAspect[] = ['16:9', '9:16', '1:1', '4:5', '2.35:1']

export const DEFAULT_ASPECT: ProjectAspect = '16:9'

/** Width/height ratio for a project aspect. */
export function aspectRatioOf(aspect: ProjectAspect | undefined): number {
  switch (aspect) {
    case '9:16':   return 9 / 16
    case '1:1':    return 1
    case '4:5':    return 4 / 5
    case '2.35:1': return 2.35
    default:       return 16 / 9
  }
}

// ── Beat grid ─────────────────────────────────────────────────
// Musical grid over the video timeline: the ruler draws beats/bars, snapping
// includes beat positions, and cut-on-beat tools quantize to it. Constant BPM
// (v1) — DAW projects with mid-song tempo changes flatten to their base tempo.

export interface BeatGrid {
  bpm: number          // beats per minute (> 0)
  offset: number       // seconds where beat 0 / bar 1 falls
  beatsPerBar?: number // default 4
}

/** Seconds per beat. */
export function beatDur(grid: BeatGrid): number {
  return 60 / Math.max(1, grid.bpm)
}

/** Nearest beat time (seconds) to `t`, clamped to ≥ 0. */
export function nearestBeat(grid: BeatGrid, t: number): number {
  const spb = beatDur(grid)
  return Math.max(0, grid.offset + Math.round((t - grid.offset) / spb) * spb)
}

// ── Caption style ─────────────────────────────────────────────
// Project-wide look for burned-in captions. `size` scales the base size the
// renderer derives from frame height, so the same style reads correctly at
// every aspect/resolution. Karaoke highlights the active word (needs word
// timings on the caption — older transcripts without them render statically).

export interface CaptionStyle {
  size: number                          // 0.5–2, multiplier on the base size
  color: string                         // text color
  bg: string                            // box color, or 'none' for outline-only text
  position: 'bottom' | 'center' | 'top'
  karaoke: boolean
  highlightColor: string                // active-word color when karaoke is on
}

export const DEFAULT_CAPTION_STYLE: CaptionStyle = {
  size: 1,
  color: '#ffffff',
  bg: 'rgba(0,0,0,0.75)',
  position: 'bottom',
  karaoke: false,
  highlightColor: '#a78bfa',
}

export interface ClipFlag {
  id: string
  color: string
  label?: string
}

export interface TimelineItem {
  id: string
  label: string
  startTime: number    // position in the edit timeline (seconds)
  inPoint: number      // where in the source clip this starts
  outPoint: number     // where in the source clip this ends
  captions: Caption[]
  color: string
  trackId: string      // which track this lives on
  url?: string         // object URL of the source media
  contentType?: ContentType
  transitionIn?: TransitionType
  transitionDuration?: number
  enabled?: boolean    // false = clip is muted/skipped in playback
  speed?: number       // playback rate multiplier (default 1)
  // Clip visual properties
  opacity?: number     // 0–100, default 100
  flipH?: boolean
  flipV?: boolean
  fadeIn?: number      // seconds
  fadeOut?: number     // seconds
  cropZoom?: number    // 100–400, default 100 (percent scale)
  cropX?: number       // -50 to 50, default 0 (percent pan)
  cropY?: number       // -50 to 50, default 0
  fitMode?: 'contain' | 'cover'  // how the source fills the project frame (default contain)
  flags?: ClipFlag[]   // colored clip markers
  // Smoothness
  speedPoints?: Array<{ t: number; speed: number }>  // velocity curve: t=0–1 fraction of clip, speed=multiplier
  motionBlurEnabled?: boolean
  // Compositing
  blendMode?: string           // CSS mix-blend-mode value, e.g. 'multiply', 'screen', 'overlay'
  // Ken Burns animated pan/zoom
  kenBurns?: {
    fromZoom: number   // starting cropZoom (100–400)
    fromX: number      // starting cropX (-50 to 50)
    fromY: number      // starting cropY (-50 to 50)
    toZoom: number
    toX: number
    toY: number
  }
  // Title clip (contentType === 'title')
  titleText?: string
  titleFontSize?: number       // px, default 48
  titleColor?: string          // hex, default '#ffffff'
  titleBg?: string             // hex or 'transparent', default 'transparent'
  titlePosition?: 'upper' | 'center' | 'lower-third'  // default 'center'
  titleAnimation?: 'none' | 'fade' | 'slide-up'       // default 'none'
  // Per-clip audio EQ (gain in dB: -12 to +12, 0 = flat)
  eq?: { low: number; mid: number; high: number }
  // Per-clip color grade — composes ON TOP of the project-wide adjustments,
  // so one shot can be matched against its neighbours (100 = neutral).
  grade?: { brightness: number; contrast: number; saturation: number }
  // LUT reference (id of a MediaItem with contentType === 'lut')
  lutId?: string
  // Live DAW-mix link: this clip carries the project's bounced DAW arrangement
  // and is re-rendered (media swapped in place) whenever the audio changes.
  dawMixLinked?: boolean
  dawMixStamp?: string       // ISO stamp of the audio state this bounce rendered
  /** DAW track ids this link renders (a stem). Absent/empty = the full mix. */
  dawMixTracks?: string[]
  /** Locked: keep the current render — stop following audio changes until unlocked. */
  dawMixLocked?: boolean
  /** How this linked mix follows its audio:
   *  'live' — re-bounce on every edit (own-project default);
   *  'save' — re-bounce only on save / reopen / manual re-sync (cross-project default).
   *  Absent = the default for its kind. */
  dawMixSyncMode?: 'live' | 'save'
  /** Cross-project link: the SOURCE project whose mix this clip renders. Absent =
   *  this project's own DAW. Set when you link another project's audio in; the
   *  editor joins that project's room so the clip re-syncs on the source's edits. */
  dawMixSourceProjectId?: string
  // Draw Focus overlay fields (only for clips on drawfocus tracks)
  focusX?: number      // 0–1 horizontal position (default 0.5) — static fallback when no keyframes
  focusY?: number      // 0–1 vertical position (default 0.5)
  focusRadius?: number // radius as fraction of container height (default 0.2)
  focusKeyframes?: Array<{ time: number; x: number; y: number }>  // time = seconds since clip startTime
}

export interface Track {
  id: string
  label: string
  type: 'media' | 'video' | 'audio' | 'caption' | 'drawfocus'
  height: number
  locked?: boolean
  volume?: number   // 0–1 (default 1)
  muted?: boolean
  solo?: boolean
}

export interface MediaItem {
  id: string
  name: string
  contentType: ContentType
  duration?: number
  url?: string
  file?: File
  thumbnail?: string   // base64 JPEG data URL; video only
  r2Key?: string       // R2 object key; set after successful upload
  uploadStatus?: 'uploading' | 'uploaded' | 'error'
  peaks?: number[]     // audio waveform peak data (0–1 per band, 80 samples)
}

export interface VideoAdjustments {
  brightness: number   // 0–200, 100 = normal
  contrast: number     // 0–200, 100 = normal
  saturation: number   // 0–200, 100 = normal
  highlights: number   // -100–100, 0 = normal  (tone curve: highlights handle)
  // Extended color controls
  vignette: number     // 0–100, 0 = none
  shadows: number      // -50–50, 0 = neutral  (tone curve: shadows handle)
  midtones: number     // -50–50, 0 = neutral  (tone curve: midtones handle)
  // Color wheel (master channel, CSS-approximated lift/gamma/gain)
  lift: number         // -50–50, 0 = neutral (black point)
  gamma: number        // 50–150, 100 = neutral (midpoint)
  gain: number         // 50–150, 100 = neutral (white point)
}

export const DEFAULT_ADJUSTMENTS: VideoAdjustments = {
  brightness: 100,
  contrast:   100,
  saturation: 100,
  highlights: 0,
  vignette:   0,
  shadows:    0,
  midtones:   0,
  lift:       0,
  gamma:      100,
  gain:       100,
}

export const PIXELS_PER_SECOND = 80
export const TRACK_HEIGHT = 44
export const AUDIO_TRACK_HEIGHT = 32
export const CAPTION_TRACK_HEIGHT = 20
export const RULER_HEIGHT = 28
export const TOOLBAR_HEIGHT = 34

export const DEFAULT_TRACKS: Track[] = [
  { id: 'v1', label: 'M1', type: 'media', height: TRACK_HEIGHT },
]

// ── Modular project system ────────────────────────────────────

export type ModuleKey = 'video' | 'audio' | 'image'

export interface ModuleDef {
  key: ModuleKey
  label: string
  tagline: string
  features: string[]
  color: string
}

export const MODULE_DEFS: ModuleDef[] = [
  {
    key: 'video',
    label: 'Video',
    tagline: 'Timeline, color grading, effects',
    features: ['Multi-track timeline', 'Color grading & LUTs', 'Transitions & effects', 'Export & render'],
    color: '#8b5cf6',
  },
  {
    key: 'audio',
    label: 'Audio',
    tagline: 'Full DAW — sequences, mixing, effects',
    features: ['Arrangement & Session view', 'Mixer with sends & returns', '10 DSP effects chain', 'Sample library (2178 sounds)'],
    color: '#3b82f6',
  },
  {
    key: 'image',
    label: 'Image',
    tagline: 'Canvas, layers, text, brand kits',
    features: ['Layer-based canvas', 'Text & shapes', 'Brand kit (colors, fonts)', 'Export to PNG/JPG/WebP'],
    color: '#ec4899',
  },
]

export const ALL_MODULE_KEYS: ModuleKey[] = MODULE_DEFS.map(m => m.key)

/** Launched modules: modules outside this list are hidden everywhere, even
 *  if the platform_config row enables them. Widen when a module relaunches. */
export const LAUNCH_MODULES: ModuleKey[] = ['audio', 'video']

// ── Audio module track (shared between AudioEditor and ProjectEditor) ─────────

export interface AudioTrackInit {
  id: string
  name: string
  url: string           // blob URL (ephemeral) or signed R2 URL (loaded from cloud)
  duration: number
  contentType?: string  // 'audio/mpeg', 'audio/wav', etc.
  r2Key?: string        // set after upload completes
  uploadStatus?: 'uploading' | 'uploaded' | 'error'
  savedAt?: string      // ISO timestamp of last save
  stemType?: 'drums' | 'bass' | 'vocals' | 'other'  // set for Demucs-separated stems
}
