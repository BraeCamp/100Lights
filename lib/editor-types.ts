import type { Caption, ContentType } from '@/lib/types'

export type TransitionType = 'dissolve' | 'dip_black' | 'wipe_right' | 'push'

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
  // LUT reference (id of a MediaItem with contentType === 'lut')
  lutId?: string
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

export type ModuleKey = 'video' | 'audio' | 'transcript' | 'content' | 'storyboard'

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
    key: 'transcript',
    label: 'Transcript',
    tagline: 'AI captions, speaker detection',
    features: ['AI transcription', 'Speaker detection', 'Inline caption editing', 'Full-text search'],
    color: '#10b981',
  },
  {
    key: 'content',
    label: 'Content',
    tagline: 'Articles, blogs, show notes',
    features: ['AI article generation', 'Blog posts', 'Show notes', 'Social captions'],
    color: '#f59e0b',
  },
  {
    key: 'storyboard',
    label: 'Storyboard',
    tagline: 'Visual planning & scenes',
    features: ['Scene cards', 'Chapter markers', 'Shot list', 'Visual timeline'],
    color: '#ec4899',
  },
]

export const ALL_MODULE_KEYS: ModuleKey[] = MODULE_DEFS.map(m => m.key)

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
