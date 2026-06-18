/**
 * 100Lights project file serialization (.cfproj format).
 *
 * Media files (video/audio) are referenced by name only — blob URLs are
 * ephemeral and cannot be stored. When a project is reopened, clips whose
 * media can't be found are marked "offline" until the user re-links them,
 * the same way DaVinci Resolve handles moved or missing media.
 */

import type { Caption, ContentType, Output, ChapterMarker } from '@/lib/types'
import type { TimelineItem, Track, VideoAdjustments, ModuleKey } from '@/lib/editor-types'

export const CF_VERSION = 1
export const CF_EXT     = '.cfproj'
export const CF_MIME    = 'application/json'

// ── Serialized types (no runtime-only fields) ────────────────

export interface SerializedMedia {
  id: string
  name: string
  contentType: ContentType
  duration: number
  r2Key?: string
}

export interface SerializedClip {
  id: string
  label: string
  startTime: number
  inPoint: number
  outPoint: number
  color: string
  trackId: string
  mediaRefId: string | null   // links to SerializedMedia.id; null = caption-only clip
  captions: Caption[]
  transitionIn?: string
  transitionDuration?: number
  contentType?: ContentType
  speed?: number
  opacity?: number
  flipH?: boolean
  flipV?: boolean
  fadeIn?: number
  fadeOut?: number
  cropZoom?: number
  cropX?: number
  cropY?: number
  flags?: import('@/lib/editor-types').ClipFlag[]
}

export interface SerializedOutput {
  id: string
  type: string
  title: string
  content: string
  wordCount?: number
  createdAt: string           // ISO string (Output.createdAt is a Date)
  captions?: Caption[]
}

export interface SerializedAudioMedia {
  id: string
  name: string
  duration: number
  contentType: string   // 'audio/mpeg', 'audio/wav', etc.
  r2Key: string         // R2 object key — survives page refreshes
  savedAt: string       // ISO — when this track was last saved in the audio module
}

export interface CfProjFile {
  _type: '100lights-project'
  version: typeof CF_VERSION
  id: string
  name: string
  savedAt: string             // ISO string
  userId?: string             // Clerk user ID — set server-side on save
  // Editor state
  tracks: Track[]
  clips: SerializedClip[]
  adjustments: VideoAdjustments
  zoomLevel: number
  // Content
  captions: Caption[]
  outputs: SerializedOutput[]
  chapters?: ChapterMarker[]
  // Media pool (metadata only — no blob URLs)
  media: SerializedMedia[]
  // Audio module's own media library — persisted separately from video media
  audioMedia?: SerializedAudioMedia[]
  // Per-module last-save timestamps — used to detect stale cross-module data
  moduleSavedAt?: Partial<Record<ModuleKey, string>>
  // Which modules are loaded in this project (undefined = all, for backward compat)
  modules?: ModuleKey[]
}

// ── Serialize ────────────────────────────────────────────────

export interface EditorSnapshot {
  id: string
  name: string
  tracks: Track[]
  timelineItems: TimelineItem[]
  adjustments: VideoAdjustments
  zoomLevel: number
  captions: Caption[]
  outputs: Output[]
  chapters?: ChapterMarker[]
  mediaItems: Array<{ id: string; name: string; contentType: ContentType; duration?: number; url?: string; r2Key?: string }>
}

export function serialize(snap: EditorSnapshot): CfProjFile {
  return {
    _type: '100lights-project',
    version: CF_VERSION,
    id: snap.id,
    name: snap.name,
    savedAt: new Date().toISOString(),
    tracks: snap.tracks,
    clips: snap.timelineItems.map((item): SerializedClip => ({
      id:               item.id,
      label:            item.label,
      startTime:        item.startTime,
      inPoint:          item.inPoint,
      outPoint:         item.outPoint,
      color:            item.color,
      trackId:          item.trackId,
      mediaRefId:       item.url ? (snap.mediaItems.find(m => m.url === item.url)?.id ?? null) : null,
      captions:         item.captions,
      transitionIn:     item.transitionIn,
      transitionDuration: item.transitionDuration,
      contentType:      item.contentType,
      speed:            item.speed,
      opacity:          item.opacity,
      flipH:            item.flipH,
      flipV:            item.flipV,
      fadeIn:           item.fadeIn,
      fadeOut:          item.fadeOut,
      cropZoom:         item.cropZoom,
      cropX:            item.cropX,
      cropY:            item.cropY,
      flags:            item.flags,
    })),
    adjustments: snap.adjustments,
    zoomLevel: snap.zoomLevel,
    captions: snap.captions,
    chapters: snap.chapters ?? [],
    outputs: snap.outputs.map((o): SerializedOutput => ({
      id:        o.id,
      type:      o.type,
      title:     o.title,
      content:   o.content,
      wordCount: o.wordCount,
      createdAt: o.createdAt instanceof Date ? o.createdAt.toISOString() : String(o.createdAt),
      captions:  o.captions,
    })),
    media: snap.mediaItems.map((m): SerializedMedia => ({
      id:          m.id,
      name:        m.name,
      contentType: m.contentType,
      duration:    m.duration ?? 0,
      r2Key:       m.r2Key,
    })),
  }
}

// ── Deserialize ──────────────────────────────────────────────

export interface DeserializedProject {
  id: string
  name: string
  savedAt: string
  tracks: Track[]
  timelineItems: TimelineItem[]   // url = undefined means "offline"
  adjustments: VideoAdjustments
  zoomLevel: number
  captions: Caption[]
  outputs: Output[]
  chapters: ChapterMarker[]
  offlineMedia: SerializedMedia[] // media that needs re-linking
}

export function deserialize(file: CfProjFile): DeserializedProject {
  const timelineItems: TimelineItem[] = file.clips.map((clip): TimelineItem => ({
    id:               clip.id,
    label:            clip.label,
    startTime:        clip.startTime,
    inPoint:          clip.inPoint,
    outPoint:         clip.outPoint,
    color:            clip.color,
    trackId:          clip.trackId,
    captions:         clip.captions,
    transitionIn:     clip.transitionIn as TimelineItem['transitionIn'],
    transitionDuration: clip.transitionDuration,
    contentType:      clip.contentType,
    speed:            clip.speed,
    opacity:          clip.opacity,
    flipH:            clip.flipH,
    flipV:            clip.flipV,
    fadeIn:           clip.fadeIn,
    fadeOut:          clip.fadeOut,
    cropZoom:         clip.cropZoom,
    cropX:            clip.cropX,
    cropY:            clip.cropY,
    flags:            clip.flags,
    // url is intentionally absent — media is offline until re-linked
  }))

  const outputs: Output[] = file.outputs.map((o): Output => ({
    id:        o.id,
    type:      o.type as Output['type'],
    title:     o.title,
    content:   o.content,
    wordCount: o.wordCount,
    createdAt: new Date(o.createdAt),
    captions:  o.captions,
  }))

  return {
    id:            file.id,
    name:          file.name,
    savedAt:       file.savedAt,
    tracks:        file.tracks,
    timelineItems,
    adjustments:   file.adjustments,
    zoomLevel:     file.zoomLevel,
    captions:      file.captions,
    outputs,
    chapters:      file.chapters ?? [],
    offlineMedia:  file.media,
  }
}

// ── File System Access API helpers ────────────────────────────

declare global {
  interface Window {
    showSaveFilePicker?: (opts?: ShowSaveFilePickerOptions) => Promise<FileSystemFileHandle>
    showOpenFilePicker?: (opts?: OpenFilePickerOptions) => Promise<FileSystemFileHandle[]>
  }
}
interface ShowSaveFilePickerOptions {
  suggestedName?: string
  types?: Array<{ description?: string; accept: Record<string, string[]> }>
}
interface OpenFilePickerOptions {
  multiple?: boolean
  types?: Array<{ description?: string; accept: Record<string, string[]> }>
}

const PICKER_TYPES = [{
  description: '100Lights Project',
  accept: { [CF_MIME]: [CF_EXT] },
}]

/**
 * Save to the user's computer.
 * - If `handle` is provided (previously saved file), overwrites it silently.
 * - Otherwise opens a native "Save As" dialog.
 * - Falls back to blob download on browsers without FSAPI (Firefox, older Safari).
 * Returns the new handle (undefined on fallback).
 */
export async function saveProjectToFile(
  project: CfProjFile,
  handle?: FileSystemFileHandle,
): Promise<FileSystemFileHandle | undefined> {
  const json = JSON.stringify(project, null, 2)

  if (window.showSaveFilePicker) {
    try {
      const fh = handle ?? await window.showSaveFilePicker({
        suggestedName: `${project.name}${CF_EXT}`,
        types: PICKER_TYPES,
      })
      const writable = await fh.createWritable()
      await writable.write(json)
      await writable.close()
      return fh
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return undefined
      throw err
    }
  }

  // Fallback: trigger a download
  triggerDownload(json, `${project.name}${CF_EXT}`)
  return undefined
}

/**
 * Open a .cfproj from the user's computer.
 * Uses FSAPI picker when available, otherwise a hidden <input type="file">.
 * Returns null if the user cancels.
 */
export async function openProjectFromFile(): Promise<CfProjFile | null> {
  if (window.showOpenFilePicker) {
    try {
      const [fh] = await window.showOpenFilePicker({ types: PICKER_TYPES })
      const file = await fh.getFile()
      return JSON.parse(await file.text()) as CfProjFile
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return null
      throw err
    }
  }

  // Fallback: hidden file input
  return new Promise((resolve) => {
    const input = Object.assign(document.createElement('input'), {
      type: 'file',
      accept: CF_EXT,
    })
    input.onchange = async () => {
      const file = input.files?.[0]
      resolve(file ? JSON.parse(await file.text()) as CfProjFile : null)
    }
    input.click()
  })
}

function triggerDownload(content: string, filename: string) {
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([content], { type: CF_MIME })),
    download: filename,
  })
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(a.href)
}
