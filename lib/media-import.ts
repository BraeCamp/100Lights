// Shared media-import vocabulary so every import surface (the studio toolbar,
// the Media Pool panel, drag-and-drop) accepts the SAME set of files and detects
// their kind the SAME way.
//
// Why detect by extension, not just MIME: many containers (.mkv, .mov, .avi,
// .m4v, …) come through the OS with an EMPTY or generic `file.type`, so a
// `startsWith('video/')` check alone would reject them or misfile them as audio.

export type MediaKind = 'video' | 'audio' | 'image' | 'lut'

// Extensions we accept (lowercase, no dot). Broad on purpose — the browser only
// *decodes* a subset (mp4/h264, webm, mov/h264…), but importing should never be
// the thing that blocks a file; unsupported codecs simply won't preview.
export const VIDEO_EXTS = [
  'mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi', 'wmv', 'flv',
  'mpg', 'mpeg', 'm2v', 'ogv', 'ts', 'mts', 'm2ts', '3gp', '3g2',
]
export const AUDIO_EXTS = [
  'mp3', 'wav', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'weba',
  'flac', 'aif', 'aiff', 'wma', 'caf',
]
export const IMAGE_EXTS = [
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'bmp', 'heic', 'heif', 'svg',
]
export const LUT_EXTS = ['cube']

// `accept` attribute for a file <input> — MIME wildcards for the common case
// plus every explicit extension so the OS picker never greys these out.
export const MEDIA_ACCEPT = [
  'video/*', 'audio/*', 'image/*',
  ...VIDEO_EXTS.map(e => `.${e}`),
  ...AUDIO_EXTS.map(e => `.${e}`),
  ...IMAGE_EXTS.map(e => `.${e}`),
  ...LUT_EXTS.map(e => `.${e}`),
].join(',')

export const extOf = (name: string): string => {
  const i = name.lastIndexOf('.')
  return i >= 0 ? name.slice(i + 1).toLowerCase() : ''
}

/** What kind of media is this file? MIME first, then fall back to extension
 *  (empty/odd MIME is common for .mkv/.mov/.avi). null = not an accepted type. */
export function detectMediaKind(file: File): MediaKind | null {
  const ext = extOf(file.name)
  if (LUT_EXTS.includes(ext)) return 'lut'
  const type = (file.type || '').toLowerCase()
  if (type.startsWith('video/')) return 'video'
  if (type.startsWith('audio/')) return 'audio'
  if (type.startsWith('image/')) return 'image'
  if (VIDEO_EXTS.includes(ext)) return 'video'
  if (AUDIO_EXTS.includes(ext)) return 'audio'
  if (IMAGE_EXTS.includes(ext)) return 'image'
  return null
}

export const MAX_MEDIA_BYTES = 500 * 1024 * 1024

/** '' if the file is importable, otherwise a human-readable reason. */
export function validateMediaFile(file: File): string {
  if (!detectMediaKind(file))
    return `Unsupported file "${file.name.split('.').pop() || file.type}". Import a video, audio, or .cube LUT file.`
  if (file.size > MAX_MEDIA_BYTES)
    return `File is too large (${(file.size / 1024 / 1024).toFixed(0)} MB). Maximum size is 500 MB.`
  return ''
}
