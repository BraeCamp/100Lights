import type { Caption, ContentType } from '@/lib/types'

export type TransitionType = 'dissolve' | 'dip_black' | 'wipe_right' | 'push'

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
}

export interface Track {
  id: string
  label: string
  type: 'media' | 'video' | 'audio' | 'caption'  // 'video'/'audio' kept for backward compat
  height: number
  locked?: boolean
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
}

export interface VideoAdjustments {
  brightness: number   // 0–200, 100 = normal
  contrast: number     // 0–200, 100 = normal
  saturation: number   // 0–200, 100 = normal
  highlights: number   // -100–100, 0 = normal
}

export const DEFAULT_ADJUSTMENTS: VideoAdjustments = {
  brightness: 100,
  contrast: 100,
  saturation: 100,
  highlights: 0,
}

export const PIXELS_PER_SECOND = 80
export const TRACK_HEIGHT = 44
export const AUDIO_TRACK_HEIGHT = 32
export const CAPTION_TRACK_HEIGHT = 20
export const RULER_HEIGHT = 28
export const TOOLBAR_HEIGHT = 34

export const DEFAULT_TRACKS: Track[] = [
  { id: 'v1', label: 'M1', type: 'media', height: TRACK_HEIGHT },
  { id: 'a1', label: 'M2', type: 'media', height: TRACK_HEIGHT },
]
