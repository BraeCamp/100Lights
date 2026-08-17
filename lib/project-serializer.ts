/**
 * 100Lights project file serialization (.cfproj format).
 *
 * Media files (video/audio) are referenced by name only — blob URLs are
 * ephemeral and cannot be stored. When a project is reopened, clips whose
 * media can't be found are marked "offline" until the user re-links them,
 * the same way DaVinci Resolve handles moved or missing media.
 */

import { BundleImportError, importFireflyBundle, isZipFile } from './firefly-bundle'
import { MEDIA_ACCEPT, VIDEO_EXTS, AUDIO_EXTS, detectMediaKind } from './media-import'
import { loadFolder, verifyWritePermission, writeToFolder } from './local-folder'
import type { DawProject } from './daw-types'
import type { Caption, ContentType, Output, ChapterMarker } from '@/lib/types'
import type { TimelineItem, Track, VideoAdjustments, ModuleKey, ProjectAspect, BeatGrid, CaptionStyle, TempoSeg, SceneTrack } from '@/lib/editor-types'

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
  reverse?: boolean
  freeze?: boolean
  opacity?: number
  flipH?: boolean
  flipV?: boolean
  fadeIn?: number
  fadeOut?: number
  cropZoom?: number
  cropX?: number
  cropY?: number
  fitMode?: 'contain' | 'cover'
  flags?: import('@/lib/editor-types').ClipFlag[]
  enabled?: boolean
  // Motion & compositing
  speedPoints?: Array<{ t: number; speed: number }>
  motionBlurEnabled?: boolean
  blendMode?: string
  kenBurns?: TimelineItem['kenBurns']
  // Title clip
  titleText?: string
  titleFontSize?: number
  titleColor?: string
  titleBg?: string
  titlePosition?: 'upper' | 'center' | 'lower-third'
  titleAnimation?: import('@/lib/text-styles').TitleAnimation
  titleAnimAmount?: number
  titleOpacity?: number
  titleOffsetY?: number
  titleActiveColor?: string
  titleActiveBox?: boolean
  titlePulseBpm?: number
  titleGradient?: { from: string; to: string }
  titleFont?: string
  titleWeight?: number
  titleLetterSpacing?: number
  titleUppercase?: boolean
  titleShadow?: boolean
  titleGlow?: string
  titleOutline?: number
  titleOutlineColor?: string
  attachedTo?: string
  // Music-visual overlay
  mvFormat?: string
  mvAccent?: string
  mvBg?: [string, string] | null
  mvMatchTheme?: boolean
  mvResolution?: number
  // Audio & color
  eq?: { low: number; mid: number; high: number }
  vocalClarity?: number
  grade?: { brightness: number; contrast: number; saturation: number }
  look?: string
  spotlightTrackId?: string
  lutId?: string
  // DAW-mix link
  dawMixLinked?: boolean
  dawMixStamp?: string
  dawMixTracks?: string[]
  dawMixLocked?: boolean
  dawMixSyncMode?: 'live' | 'save'
  dawMixSourceProjectId?: string
  // Draw Focus
  focusX?: number
  focusY?: number
  focusRadius?: number
  focusKeyframes?: Array<{ time: number; x: number; y: number }>
  followFocusClipId?: string
  crop?: { l: number; t: number; r: number; b: number }
  beatMap?: TempoSeg[]
  sceneTrack?: SceneTrack
  hypeBeats?: number[]
  hypeDrops?: number[]
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

export interface PodcastMeta {
  showName: string
  episodeTitle: string
  episodeNumber: number | null
  season: number | null
  description: string
  host?: string         // podcast host name(s)
  guests: string
  artwork?: string      // base64 data URL for cover image
  tags?: string         // comma-separated RSS category tags
  websiteUrl?: string   // podcast website URL
  episodeType?: 'full' | 'trailer' | 'bonus'
  explicit?: boolean
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
  /** Project frame shape (preview stage + export dims). Absent = 16:9 (pre-aspect files). */
  aspect?: ProjectAspect
  /** Musical grid (BPM + downbeat offset) for beat snapping / cut-on-beat. */
  beatGrid?: BeatGrid | null
  /** Burned-in caption look. Absent = default style (pre-style files). */
  captionStyle?: CaptionStyle
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
  // Audio sub-mode
  audioMode?: 'music' | 'podcast'
  podcastMeta?: PodcastMeta
  /** Full DAW arrangement (tracks, clips, notes, mixer). Blob audio URLs stripped; clips resolve audio via r2Key. */
  dawProject?: DawProject
}

// ── Serialize ────────────────────────────────────────────────

export interface EditorSnapshot {
  id: string
  name: string
  tracks: Track[]
  timelineItems: TimelineItem[]
  adjustments: VideoAdjustments
  aspect?: ProjectAspect
  beatGrid?: BeatGrid | null
  captionStyle?: CaptionStyle
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
      reverse:          item.reverse,
      freeze:           item.freeze,
      opacity:          item.opacity,
      flipH:            item.flipH,
      flipV:            item.flipV,
      fadeIn:           item.fadeIn,
      fadeOut:          item.fadeOut,
      cropZoom:         item.cropZoom,
      cropX:            item.cropX,
      cropY:            item.cropY,
      fitMode:          item.fitMode,
      flags:            item.flags,
      enabled:          item.enabled,
      speedPoints:      item.speedPoints,
      motionBlurEnabled: item.motionBlurEnabled,
      blendMode:        item.blendMode,
      kenBurns:         item.kenBurns,
      titleText:        item.titleText,
      titleFontSize:    item.titleFontSize,
      titleColor:       item.titleColor,
      titleBg:          item.titleBg,
      titlePosition:    item.titlePosition,
      titleAnimation:   item.titleAnimation,
      titleAnimAmount:  item.titleAnimAmount,
      titleOpacity:     item.titleOpacity,
      titleOffsetY:     item.titleOffsetY,
      titleActiveColor: item.titleActiveColor,
      titleActiveBox:   item.titleActiveBox,
      titlePulseBpm:    item.titlePulseBpm,
      titleGradient:    item.titleGradient,
      titleFont:        item.titleFont,
      titleWeight:      item.titleWeight,
      titleLetterSpacing: item.titleLetterSpacing,
      titleUppercase:   item.titleUppercase,
      titleShadow:      item.titleShadow,
      titleGlow:        item.titleGlow,
      titleOutline:     item.titleOutline,
      titleOutlineColor: item.titleOutlineColor,
      attachedTo:       item.attachedTo,
      mvFormat:         item.mvFormat,
      mvAccent:         item.mvAccent,
      mvBg:             item.mvBg,
      mvMatchTheme:     item.mvMatchTheme,
      mvResolution:     item.mvResolution,
      eq:               item.eq,
      vocalClarity:     item.vocalClarity,
      grade:            item.grade,
      look:             item.look,
      spotlightTrackId: item.spotlightTrackId,
      lutId:            item.lutId,
      dawMixLinked:     item.dawMixLinked,
      dawMixStamp:      item.dawMixStamp,
      dawMixTracks:     item.dawMixTracks,
      dawMixLocked:     item.dawMixLocked,
      dawMixSyncMode:   item.dawMixSyncMode,
      dawMixSourceProjectId: item.dawMixSourceProjectId,
      focusX:           item.focusX,
      focusY:           item.focusY,
      focusRadius:      item.focusRadius,
      focusKeyframes:   item.focusKeyframes,
      followFocusClipId: item.followFocusClipId,
      crop:             item.crop,
      beatMap:          item.beatMap,
      sceneTrack:       item.sceneTrack,
      hypeBeats:        item.hypeBeats,
      hypeDrops:        item.hypeDrops,
    })),
    adjustments: snap.adjustments,
    aspect: snap.aspect,
    beatGrid: snap.beatGrid ?? null,
    captionStyle: snap.captionStyle,
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
  aspect: ProjectAspect
  beatGrid: BeatGrid | null
  captionStyle?: CaptionStyle
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
    reverse:          clip.reverse,
    freeze:           clip.freeze,
    opacity:          clip.opacity,
    flipH:            clip.flipH,
    flipV:            clip.flipV,
    fadeIn:           clip.fadeIn,
    fadeOut:          clip.fadeOut,
    cropZoom:         clip.cropZoom,
    cropX:            clip.cropX,
    cropY:            clip.cropY,
    fitMode:          clip.fitMode,
    flags:            clip.flags,
    enabled:          clip.enabled,
    speedPoints:      clip.speedPoints,
    motionBlurEnabled: clip.motionBlurEnabled,
    blendMode:        clip.blendMode,
    kenBurns:         clip.kenBurns,
    titleText:        clip.titleText,
    titleFontSize:    clip.titleFontSize,
    titleColor:       clip.titleColor,
    titleBg:          clip.titleBg,
    titlePosition:    clip.titlePosition,
    titleAnimation:   clip.titleAnimation,
    titleAnimAmount:  clip.titleAnimAmount,
    titleOpacity:     clip.titleOpacity,
    titleOffsetY:     clip.titleOffsetY,
    titleActiveColor: clip.titleActiveColor,
    titleActiveBox:   clip.titleActiveBox,
    titlePulseBpm:    clip.titlePulseBpm,
    titleGradient:    clip.titleGradient,
    titleFont:        clip.titleFont,
    titleWeight:      clip.titleWeight,
    titleLetterSpacing: clip.titleLetterSpacing,
    titleUppercase:   clip.titleUppercase,
    titleShadow:      clip.titleShadow,
    titleGlow:        clip.titleGlow,
    titleOutline:     clip.titleOutline,
    titleOutlineColor: clip.titleOutlineColor,
    attachedTo:       clip.attachedTo,
    mvFormat:         clip.mvFormat,
    mvAccent:         clip.mvAccent,
    mvBg:             clip.mvBg,
    mvMatchTheme:     clip.mvMatchTheme,
    mvResolution:     clip.mvResolution,
    eq:               clip.eq,
    vocalClarity:     clip.vocalClarity,
    grade:            clip.grade,
    look:             clip.look,
    spotlightTrackId: clip.spotlightTrackId,
    lutId:            clip.lutId,
    dawMixLinked:     clip.dawMixLinked,
    dawMixStamp:      clip.dawMixStamp,
    dawMixTracks:     clip.dawMixTracks,
    dawMixLocked:     clip.dawMixLocked,
    dawMixSyncMode:   clip.dawMixSyncMode,
    dawMixSourceProjectId: clip.dawMixSourceProjectId,
    focusX:           clip.focusX,
    focusY:           clip.focusY,
    focusRadius:      clip.focusRadius,
    focusKeyframes:   clip.focusKeyframes,
    followFocusClipId: clip.followFocusClipId,
    crop:             clip.crop,
    beatMap:          clip.beatMap,
    sceneTrack:       clip.sceneTrack,
    hypeBeats:        clip.hypeBeats,
    hypeDrops:        clip.hypeDrops,
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
    aspect:        file.aspect ?? '16:9',
    beatGrid:      file.beatGrid ?? null,
    captionStyle:  file.captionStyle,
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
  accept: {
    [CF_MIME]: [CF_EXT],
    // Firefly (mobile) exports a .zip bundle when the sketch has recordings.
    'application/zip': ['.zip'],
  },
}]

// Open-file picker also accepts raw media (→ opens a new video project). Kept
// separate from PICKER_TYPES so the SAVE picker never offers media types.
const OPEN_PICKER_TYPES: Array<{ description: string; accept: Record<string, string[]> }> = [
  ...PICKER_TYPES,
  { description: 'Video or audio', accept: { 'video/*': VIDEO_EXTS.map(e => `.${e}`), 'audio/*': AUDIO_EXTS.map(e => `.${e}`) } },
]

/** File-input `accept` covering a bare project, a Firefly bundle, and raw media. */
const ACCEPT_ATTR = `${CF_EXT},.zip,${MEDIA_ACCEPT}`

// A picked file is media (→ opens a new video project) rather than a project file.
const isMediaFile = (f: File): boolean => {
  const k = detectMediaKind(f)
  return k === 'video' || k === 'audio'
}

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
 * Save a project to the user's own computer — the free-tier alternative to cloud
 * save (no project-count limit, since it never touches our database). Prefers a
 * folder the user has granted (building a local library the Projects page lists);
 * otherwise a Save-As dialog; otherwise a plain download. Works in both the
 * browser and the desktop app (both use Chromium's File System Access API).
 */
export async function saveProjectLocally(project: CfProjFile): Promise<'folder' | 'file' | 'download' | 'cancelled'> {
  const json = JSON.stringify(project, null, 2)
  const safe = (project.name || 'project').replace(/[^a-z0-9 _.-]/gi, '_').trim() || 'project'
  const filename = `${safe}${CF_EXT}`

  // 1) A granted folder → write into it (builds a local library).
  try {
    const dir = await loadFolder()
    if (dir && await verifyWritePermission(dir)) {
      await writeToFolder(dir, filename, json)
      return 'folder'
    }
  } catch { /* fall through to a picker */ }

  // 2) Save-As dialog (File System Access API — browser + desktop).
  if (window.showSaveFilePicker) {
    try {
      const fh = await window.showSaveFilePicker({ suggestedName: filename, types: PICKER_TYPES })
      const writable = await fh.createWritable()
      await writable.write(json)
      await writable.close()
      return 'file'
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return 'cancelled'
      throw err
    }
  }

  // 3) Plain download.
  triggerDownload(json, filename)
  return 'download'
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
      return (await readProjectFile(await fh.getFile())).project
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return null
      throw err
    }
  }

  // Fallback: hidden file input
  return new Promise((resolve, reject) => {
    const input = Object.assign(document.createElement('input'), {
      type: 'file',
      accept: ACCEPT_ATTR,
    })
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return resolve(null)
      try { resolve((await readProjectFile(file)).project) } catch (e) { reject(e) }
    }
    input.click()
  })
}

/**
 * Read one picked file into a project.
 *
 * A `.cfproj` is plain JSON. A ZIP is a Firefly bundle: it also carries the
 * recordings, which get uploaded to durable storage on the way in — hence the
 * counts, so callers can tell the user when audio only landed for the session.
 * Throws on unreadable input rather than returning null, so failures are
 * visible instead of a file silently vanishing from the import list.
 */
export async function readProjectFile(file: File): Promise<ProjectFileRead> {
  if (await isZipFile(file)) {
    const { project, uploaded, degraded } = await importFireflyBundle(file)
    return { project, uploaded, degraded }
  }
  let project: CfProjFile
  try {
    project = JSON.parse(await file.text()) as CfProjFile
  } catch {
    throw new BundleImportError(`“${file.name}” is not a readable project file.`)
  }
  return { project, uploaded: 0, degraded: 0 }
}

export interface ProjectFileRead {
  project: CfProjFile
  uploaded: number
  degraded: number
}

/**
 * Open one or more .cfproj files from the user's computer.
 * Returns the parsed projects (empty array if the user cancels).
 */
export async function openProjectsFromFile(): Promise<OpenProjectsResult> {
  const read = async (file: File): Promise<ProjectFileRead | Error> => {
    try { return await readProjectFile(file) } catch (e) {
      return e instanceof Error ? e : new Error(`Could not read “${file.name}”.`)
    }
  }
  // Media files open a new video project; the rest are read as project files.
  const process = async (files: File[]): Promise<OpenProjectsResult> => {
    const media = files.filter(isMediaFile)
    const results = await Promise.all(files.filter(f => !isMediaFile(f)).map(read))
    return {
      projects: results.filter((r): r is ProjectFileRead => !(r instanceof Error)).map(r => r.project),
      media,
      uploaded: results.reduce((n, r) => n + (r instanceof Error ? 0 : r.uploaded), 0),
      degraded: results.reduce((n, r) => n + (r instanceof Error ? 0 : r.degraded), 0),
      errors: results.filter((r): r is Error => r instanceof Error).map(e => e.message),
    }
  }
  const empty: OpenProjectsResult = { projects: [], media: [], uploaded: 0, degraded: 0, errors: [] }

  if (window.showOpenFilePicker) {
    try {
      const handles = await window.showOpenFilePicker({ types: OPEN_PICKER_TYPES, multiple: true })
      return process(await Promise.all(handles.map(h => h.getFile())))
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return empty
      throw err
    }
  }
  // Fallback: hidden multi-file input. Must resolve on CANCEL too — otherwise a
  // caller that flips a spinner before awaiting this stays stuck ("Importing…")
  // forever, because `change` never fires when the picker is dismissed.
  return new Promise((resolve) => {
    const input = Object.assign(document.createElement('input'), { type: 'file', accept: ACCEPT_ATTR, multiple: true })
    let settled = false
    const finish = (r: OpenProjectsResult) => {
      if (settled) return
      settled = true
      window.removeEventListener('focus', onFocus)
      resolve(r)
    }
    input.onchange = async () => {
      finish(await process([...(input.files ?? [])]))
    }
    // Modern browsers fire 'cancel' on the input when the dialog is dismissed.
    input.oncancel = () => finish(empty)
    // Older browsers don't — but focus returns to the window when the dialog
    // closes. Give `change` a beat to fire; if nothing was picked, it was a cancel.
    const onFocus = () => {
      window.setTimeout(() => { if (!settled && !(input.files && input.files.length)) finish(empty) }, 400)
    }
    window.addEventListener('focus', onFocus)
    input.click()
  })
}

export interface OpenProjectsResult {
  projects: CfProjFile[]
  /** Raw video/audio files picked (open in a new video project, not a .cfproj). */
  media: File[]
  /** Firefly recordings uploaded to durable storage. */
  uploaded: number
  /** Recordings that are session-only (upload failed or asset missing). */
  degraded: number
  /** Human-readable reasons individual files were skipped. */
  errors: string[]
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
