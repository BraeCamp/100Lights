'use client'

import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { ArrowLeft, Download, Film, Palette, Music, Package, MousePointer2, Scissors, Undo2, Redo2, Save, Cloud, HardDrive, ChevronDown, CheckCircle2, FilePlus } from 'lucide-react'
import Link from 'next/link'
import VideoPlayer from '@/components/editor/VideoPlayer'
import Timeline from '@/components/editor/Timeline'
import MediaLibrary from '@/components/editor/MediaLibrary'
import ExportModal from '@/components/editor/ExportModal'
import Inspector from '@/components/editor/Inspector'
import ContextMenu from '@/components/editor/ContextMenu'
import { saveProject } from '@/lib/project-store'
import {
  serialize, saveProjectToFile, openProjectFromFile, deserialize,
  type CfProjFile, type EditorSnapshot,
} from '@/lib/project-serializer'
import { writeAutosave, readAutosave, clearAutosave } from '@/lib/autosave'
import {
  DEFAULT_ADJUSTMENTS, DEFAULT_TRACKS,
  RULER_HEIGHT, TRACK_HEIGHT, TOOLBAR_HEIGHT, PIXELS_PER_SECOND,
} from '@/lib/editor-types'
import type { Caption, Clip, Output, ContentType } from '@/lib/types'
import type { TimelineItem, MediaItem, VideoAdjustments, Track, TransitionType } from '@/lib/editor-types'
import type { ContextMenuItem } from './ContextMenu'
import { useUpgradeModal } from '@/components/UpgradeModal'
import posthog from 'posthog-js'

const CLIP_COLORS = ['#2563eb', '#7c3aed', '#059669', '#d97706', '#dc2626', '#0891b2', '#9333ea']

/** Grabs the first video frame as a base64 JPEG thumbnail. Resolves undefined on failure. */
function generateVideoThumbnail(url: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    const video = Object.assign(document.createElement('video'), {
      src: url, muted: true, preload: 'metadata', crossOrigin: 'anonymous',
    })
    const cleanup = () => { video.src = ''; video.load() }
    const timer = setTimeout(() => { cleanup(); resolve(undefined) }, 4000)
    video.addEventListener('seeked', () => {
      clearTimeout(timer)
      try {
        const canvas = Object.assign(document.createElement('canvas'), { width: 80, height: 45 })
        canvas.getContext('2d')?.drawImage(video, 0, 0, 80, 45)
        resolve(canvas.toDataURL('image/jpeg', 0.75))
      } catch { resolve(undefined) }
      cleanup()
    }, { once: true })
    video.addEventListener('error', () => { clearTimeout(timer); cleanup(); resolve(undefined) }, { once: true })
    video.addEventListener('loadedmetadata', () => { video.currentTime = 0 }, { once: true })
  })
}
const MIN_LEFT = 140; const MAX_LEFT = 420
const MIN_RIGHT = 160; const MAX_RIGHT = 400
const MIN_TL = 120;  const MAX_TL = 480
const FRAME_DURATION = 1 / 24  // 24fps

type EditorPage = 'edit' | 'color' | 'audio' | 'deliver'
export type EditorTool = 'select' | 'blade'

interface Props {
  projectId?: string
  projectName: string
  videoUrl: string | null
  captions: Caption[]
  clips: Clip[]
  outputs: Output[]
  contentType?: ContentType | null
  allowImport?: boolean
}

function buildTimeline(clips: Clip[]): TimelineItem[] {
  let cursor = 0
  return clips.map((clip, i) => {
    const item: TimelineItem = {
      id: clip.id, label: clip.title,
      startTime: cursor, inPoint: clip.start, outPoint: clip.end,
      captions: clip.captions, color: CLIP_COLORS[i % CLIP_COLORS.length],
      trackId: 'v1',
    }
    cursor += (clip.end - clip.start) + 0.25
    return item
  })
}

type TranscribeStatus = 'idle' | 'transcribing' | 'done' | 'error'

// ── Resize handles ────────────────────────────────────────────
function VResizeHandle({ onDelta }: { onDelta: (dx: number) => void }) {
  const handle = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    let last = e.clientX
    const onMove = (ev: PointerEvent) => { onDelta(ev.clientX - last); last = ev.clientX }
    const onUp = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp) }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }, [onDelta])
  return (
    <div onPointerDown={handle}
      style={{ width: 4, cursor: 'col-resize', flexShrink: 0, background: 'transparent', borderLeft: '1px solid var(--border)', position: 'relative', zIndex: 1 }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'var(--accent)' }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'transparent' }}
    />
  )
}

function HResizeHandle({ onDelta }: { onDelta: (dy: number) => void }) {
  const handle = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    let last = e.clientY
    const onMove = (ev: PointerEvent) => { onDelta(ev.clientY - last); last = ev.clientY }
    const onUp = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp) }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }, [onDelta])
  return (
    <div onPointerDown={handle}
      style={{ height: 4, cursor: 'row-resize', flexShrink: 0, background: 'transparent', borderTop: '1px solid var(--border)' }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'var(--accent)' }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'transparent' }}
    />
  )
}

// ── Color page — full-size color panel ───────────────────────
function ColorPage({
  adjustments, onAdjustmentsChange,
}: { adjustments: VideoAdjustments; onAdjustmentsChange: (a: VideoAdjustments) => void }) {
  const isDefault = adjustments.brightness === 100 && adjustments.contrast === 100 &&
    adjustments.saturation === 100 && adjustments.highlights === 0

  function Slider({ label, value, min, max, unit, onChange }: {
    label: string; value: number; min: number; max: number; unit?: string; onChange: (v: number) => void
  }) {
    const pct = ((value - min) / (max - min)) * 100
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>{label}</span>
          <span className="text-sm font-mono px-2 py-0.5 rounded" style={{ background: 'var(--bg-card)', color: 'var(--text-primary)' }}>{value}{unit ?? ''}</span>
        </div>
        <input type="range" className="cf-slider w-full" min={min} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))}
          style={{ height: 5, background: `linear-gradient(to right, var(--accent) ${pct}%, var(--border-light) ${pct}%)` }} />
      </div>
    )
  }

  return (
    <div className="flex-1 flex items-center justify-center overflow-auto p-8" style={{ background: 'var(--bg-base)' }}>
      <div className="w-full max-w-2xl flex flex-col gap-8">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>Color</h2>
          {!isDefault && (
            <button onClick={() => onAdjustmentsChange({ brightness: 100, contrast: 100, saturation: 100, highlights: 0 })}
              className="text-xs px-3 py-1.5 rounded" style={{ background: 'var(--border)', color: 'var(--text-secondary)' }}>
              Reset All
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 gap-6 p-6 rounded-xl" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
          <Slider label="Brightness" value={adjustments.brightness} min={0}    max={200} onChange={(v) => onAdjustmentsChange({ ...adjustments, brightness: v })} />
          <Slider label="Contrast"   value={adjustments.contrast}   min={0}    max={200} onChange={(v) => onAdjustmentsChange({ ...adjustments, contrast: v })} />
          <Slider label="Saturation" value={adjustments.saturation} min={0}    max={200} onChange={(v) => onAdjustmentsChange({ ...adjustments, saturation: v })} />
          <Slider label="Highlights" value={adjustments.highlights} min={-100} max={100} onChange={(v) => onAdjustmentsChange({ ...adjustments, highlights: v })} />
        </div>
        <p className="text-xs text-center" style={{ color: 'var(--text-muted)' }}>
          Color wheels, curves, scopes, and LUT support — coming soon
        </p>
      </div>
    </div>
  )
}

function PlaceholderPage({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4" style={{ background: 'var(--bg-base)' }}>
      <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>{title}</p>
      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{description}</p>
    </div>
  )
}

export default function VideoEditor({
  projectId, projectName, videoUrl, captions: propCaptions, clips, outputs: propOutputs,
  contentType: propContentType, allowImport,
}: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [currentTime, setCurrentTime] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [zoomLevel, setZoomLevel] = useState(1)
  const [tracks, setTracks] = useState<Track[]>(DEFAULT_TRACKS)
  const [activePage, setActivePage] = useState<EditorPage>('edit')
  const [activeTool, setActiveTool] = useState<EditorTool>('select')
  const [snapEnabled, setSnapEnabled] = useState(true)
  const [inPoint, setInPoint] = useState<number | null>(null)   // I key
  const [outPoint, setOutPoint] = useState<number | null>(null) // O key

  // ── Undo / Redo ───────────────────────────────────────────────
  // History snapshots cover all undoable state: timeline items, tracks,
  // adjustments, and captions. Zoom level and media pool are intentionally
  // excluded (view preference and imports are not undoable operations).

  interface HistorySnapshot {
    timelineItems: TimelineItem[]
    tracks:        Track[]
    adjustments:   VideoAdjustments
    captions:      Caption[]
  }

  const [timelineItems, setTimelineItemsRaw] = useState<TimelineItem[]>(() => buildTimeline(clips))
  const initialSnap: HistorySnapshot = {
    timelineItems: buildTimeline(clips),
    tracks:        DEFAULT_TRACKS,
    adjustments:   DEFAULT_ADJUSTMENTS,
    captions:      propCaptions,
  }
  const historyRef    = useRef<HistorySnapshot[]>([initialSnap])
  const historyIdxRef = useRef(0)

  // canUndo / canRedo as real state so undo/redo buttons re-render correctly.
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)

  // Stable mirrors of all tracked state — lets pushHistory read current
  // values from stable callbacks without stale-closure problems.
  const timelineItemsRef = useRef<TimelineItem[]>(buildTimeline(clips))
  const tracksRef        = useRef<Track[]>(DEFAULT_TRACKS)
  const adjustmentsRef   = useRef<VideoAdjustments>(DEFAULT_ADJUSTMENTS)
  const captionsRef      = useRef<Caption[]>(propCaptions)

  // Push a new snapshot, truncating the redo stack above the current index.
  const pushHistory = useCallback((snap: HistorySnapshot) => {
    historyRef.current = historyRef.current.slice(0, historyIdxRef.current + 1)
    historyRef.current.push(snap)
    if (historyRef.current.length > 100) {
      historyRef.current.shift()
    } else {
      historyIdxRef.current = historyRef.current.length - 1
    }
    setCanUndo(historyIdxRef.current > 0)
    setCanRedo(false)
  }, [])

  // Reset the entire history stack (called on project load / recovery).
  const resetHistory = useCallback((snap: HistorySnapshot) => {
    historyRef.current  = [snap]
    historyIdxRef.current = 0
    setCanUndo(false)
    setCanRedo(false)
  }, [])

  const undo = useCallback(() => {
    if (historyIdxRef.current <= 0) return
    historyIdxRef.current--
    const snap = historyRef.current[historyIdxRef.current]
    setTimelineItemsRaw(snap.timelineItems)
    setTracks(snap.tracks)
    setAdjustments(snap.adjustments)
    setLocalCaptions(snap.captions)
    timelineItemsRef.current = snap.timelineItems
    tracksRef.current        = snap.tracks
    adjustmentsRef.current   = snap.adjustments
    captionsRef.current      = snap.captions
    setCanUndo(historyIdxRef.current > 0)
    setCanRedo(true)
  }, []) // eslint-disable-line

  const redo = useCallback(() => {
    if (historyIdxRef.current >= historyRef.current.length - 1) return
    historyIdxRef.current++
    const snap = historyRef.current[historyIdxRef.current]
    setTimelineItemsRaw(snap.timelineItems)
    setTracks(snap.tracks)
    setAdjustments(snap.adjustments)
    setLocalCaptions(snap.captions)
    timelineItemsRef.current = snap.timelineItems
    tracksRef.current        = snap.tracks
    adjustmentsRef.current   = snap.adjustments
    captionsRef.current      = snap.captions
    setCanUndo(true)
    setCanRedo(historyIdxRef.current < historyRef.current.length - 1)
  }, []) // eslint-disable-line

  // Keep stable mirrors in sync for use inside pushHistory callbacks.
  // IMPORTANT: compute the next value from the ref (not from a React updater `prev`)
  // so that pushHistory is called outside the state updater function. React 19 Strict
  // Mode double-invokes updater functions to surface side effects — calling pushHistory
  // inside an updater would push two history entries per action.
  const setTimelineItems = useCallback((updater: TimelineItem[] | ((prev: TimelineItem[]) => TimelineItem[])) => {
    const next = typeof updater === 'function' ? updater(timelineItemsRef.current) : updater
    timelineItemsRef.current = next
    setTimelineItemsRaw(next)
    pushHistory({
      timelineItems: next,
      tracks:        tracksRef.current,
      adjustments:   adjustmentsRef.current,
      captions:      captionsRef.current,
    })
  }, [pushHistory])

  const setTracksWithHistory = useCallback((updater: Track[] | ((prev: Track[]) => Track[])) => {
    const next = typeof updater === 'function' ? updater(tracksRef.current) : updater
    tracksRef.current = next
    setTracks(next)
    pushHistory({
      timelineItems: timelineItemsRef.current,
      tracks:        next,
      adjustments:   adjustmentsRef.current,
      captions:      captionsRef.current,
    })
  }, [pushHistory])

  // Adjustments come from sliders — debounce the history push so dragging
  // doesn't flood the stack (one entry per gesture, not per pixel).
  const adjHistoryTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingAdjRef       = useRef<VideoAdjustments | null>(null)
  const setAdjustmentsWithHistory = useCallback((adj: VideoAdjustments) => {
    setAdjustments(adj)
    adjustmentsRef.current = adj
    pendingAdjRef.current  = adj
    if (adjHistoryTimerRef.current) clearTimeout(adjHistoryTimerRef.current)
    adjHistoryTimerRef.current = setTimeout(() => {
      if (!pendingAdjRef.current) return
      pushHistory({
        timelineItems: timelineItemsRef.current,
        tracks:        tracksRef.current,
        adjustments:   pendingAdjRef.current,
        captions:      captionsRef.current,
      })
      pendingAdjRef.current = null
    }, 400)
  }, [pushHistory])

  const setCaptionsWithHistory = useCallback((captions: Caption[]) => {
    setLocalCaptions(captions)
    captionsRef.current = captions
    pushHistory({
      timelineItems: timelineItemsRef.current,
      tracks:        tracksRef.current,
      adjustments:   adjustmentsRef.current,
      captions,
    })
  }, [pushHistory])

  // Panel sizes
  const [leftW, setLeftW]     = useState(200)
  const [rightW, setRightW]   = useState(224)
  const [tlHeight, setTlHeight] = useState(() =>
    TOOLBAR_HEIGHT + RULER_HEIGHT + TRACK_HEIGHT * 2 + 4
  )

  // Media library
  const [mediaItems, setMediaItems] = useState<MediaItem[]>([])
  const [selectedMediaId, setSelectedMediaId] = useState<string | null>(null)

  // Color adjustments
  const [adjustments, setAdjustments] = useState<VideoAdjustments>(DEFAULT_ADJUSTMENTS)

  // Context menu
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null)

  // Transcription
  const [importedFile, setImportedFile] = useState<File | null>(null)
  const [localProjectName, setLocalProjectName] = useState(projectName)
  const { showUpgrade } = useUpgradeModal()
  const [transcribeStatus, setTranscribeStatus] = useState<TranscribeStatus>('idle')
  const [transcribeProgress, setTranscribeProgress] = useState(0) // 0–100 upload %, 101 = server processing
  const [transcribeError, setTranscribeError] = useState('')
  const [localCaptions, setLocalCaptions] = useState<Caption[]>(propCaptions)
  const [localOutputs, setLocalOutputs] = useState<Output[]>(propOutputs)
  // Stable project ID — uses the URL param when available so autosaves are
  // recoverable across refreshes for named projects.
  const [savedProjectId] = useState<string>(() => projectId ?? crypto.randomUUID())

  // Project loading state — true while fetching from API on mount
  const [isLoadingProject, setIsLoadingProject] = useState(!!projectId)

  // Save state
  const fileHandleRef      = useRef<FileSystemFileHandle | undefined>(undefined)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [showSaveMenu, setShowSaveMenu] = useState(false)
  const savedStatusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [isDirty, setIsDirty] = useState(false)
  const autoSaveTimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Recovery state — set when a more-recent autosave is found on mount
  const [recovery, setRecovery] = useState<{ cfproj: CfProjFile; at: Date } | null>(null)
  const [showExport, setShowExport] = useState(false)
  const [showShortcuts, setShowShortcuts] = useState(false)

  // AI feature state
  const [silenceTrimStatus, setSilenceTrimStatus] = useState<'idle' | 'working' | 'done' | 'error'>('idle')
  const [silenceThreshold, setSilenceThreshold] = useState(0.5)
  const [smartClipStatus, setSmartClipStatus] = useState<'idle' | 'working' | 'done' | 'error'>('idle')
  const [genContentStatus, setGenContentStatus] = useState<Record<string, 'idle' | 'working' | 'done' | 'error'>>({})


  // Internal clipboard for copy/paste within the editor
  const clipboardRef = useRef<TimelineItem | null>(null)

  const selectedItem = timelineItems.find(i => i.id === selectedId) ?? null

  // Viewer is a pure timeline monitor — shows the enabled clip at the playhead
  const viewerClip = useMemo(() => {
    const mediaTracks = tracks.filter(t => t.type === 'media' || t.type === 'video' || t.type === 'audio')
    for (const track of mediaTracks) {
      const hit = timelineItems.find(i =>
        i.trackId === track.id &&
        i.enabled !== false &&
        currentTime >= i.startTime &&
        currentTime < i.startTime + (i.outPoint - i.inPoint)
      )
      if (hit) return hit
    }
    return null
  }, [timelineItems, tracks, currentTime])

  // Converts timeline time ↔ source clip time:  clipTime = timelineTime − offset
  const clipTimeOffset = viewerClip ? viewerClip.startTime - viewerClip.inPoint : 0
  const clipTimeOffsetRef = useRef(clipTimeOffset)
  useEffect(() => { clipTimeOffsetRef.current = clipTimeOffset }, [clipTimeOffset])

  // On mount: check if a .cfproj was opened from the projects page
  useEffect(() => {
    if (!projectId) return
    // Check localStorage stash first (set when opening a .cfproj from disk)
    const key = `cf_pending_cfproj_${projectId}`
    const stashed = localStorage.getItem(key)
    if (stashed) {
      localStorage.removeItem(key)
      loadCfproj(stashed)
      return
    }
    // Otherwise fetch directly from the API (normal cloud-saved project)
    fetch(`/api/projects/${projectId}`)
      .then(r => r.ok ? r.text() : null)
      .then(text => { if (text) loadCfproj(text) })
      .catch(() => {})
      .finally(() => setIsLoadingProject(false))
  }, []) // eslint-disable-line

  async function loadCfproj(raw: string) {
    setIsLoadingProject(true)
    try {
      const cfproj = JSON.parse(raw) as import('@/lib/project-serializer').CfProjFile
      const loaded = deserialize(cfproj)

      // Resolve any R2 keys to fresh signed URLs
      const urlMap = await resolveR2Keys(cfproj.media)

      // Patch urls into timeline items via mediaRefId in the serialized clips
      const patchedItems = loaded.timelineItems.map(item => {
        const clip = cfproj.clips.find(c => c.id === item.id)
        const signedUrl = clip?.mediaRefId ? urlMap.get(clip.mediaRefId) : undefined
        return signedUrl ? { ...item, url: signedUrl } : item
      })

      // Build media pool from serialized media with resolved URLs
      const resolvedMedia: import('@/lib/editor-types').MediaItem[] = cfproj.media.map(m => ({
        id: m.id, name: m.name, contentType: m.contentType, duration: m.duration,
        url: urlMap.get(m.id), r2Key: m.r2Key, uploadStatus: m.r2Key ? 'uploaded' as const : undefined,
      }))

      const loadedTracks = loaded.tracks.filter(t => t.type !== 'caption')
      setLocalProjectName(loaded.name)
      setTracks(loadedTracks)
      tracksRef.current = loadedTracks
      setTimelineItemsRaw(patchedItems)
      timelineItemsRef.current = patchedItems
      setZoomLevel(loaded.zoomLevel)
      setLocalCaptions(loaded.captions)
      captionsRef.current = loaded.captions
      setLocalOutputs(loaded.outputs)
      setMediaItems(resolvedMedia)
      resetHistory({ timelineItems: patchedItems, tracks: loadedTracks, adjustments: DEFAULT_ADJUSTMENTS, captions: loaded.captions })
    } catch {
      // Silently ignore corrupt/unreadable project
    } finally {
      setIsLoadingProject(false)
    }
  }

  async function resolveR2Keys(media: import('@/lib/project-serializer').SerializedMedia[]): Promise<Map<string, string>> {
    const map = new Map<string, string>()
    await Promise.all(media.map(async (m) => {
      if (!m.r2Key) return
      try {
        const res = await fetch(`/api/media/signed-url?key=${encodeURIComponent(m.r2Key)}`)
        if (res.ok) {
          const { url } = await res.json() as { url: string }
          map.set(m.id, url)
        }
      } catch { }
    }))
    return map
  }

  // ── Recovery check on mount ────────────────────────────────
  // If an autosave from a previous session exists, surface a banner so the
  // user can choose to restore it. Runs after the cfproj-load effect so a
  // freshly-opened project doesn't immediately trigger a false positive.
  useEffect(() => {
    const saved = readAutosave(savedProjectId)
    if (!saved) return
    setRecovery({ cfproj: saved, at: new Date(saved.savedAt) })
  }, []) // eslint-disable-line

  // ── Dirty tracking + auto-save ─────────────────────────────
  // Sets the dirty flag and debounces a localStorage snapshot 5 s after the
  // last change. The snapshot is cleared on any successful manual save.
  const hasMountedRef = useRef(false)
  useEffect(() => {
    if (!hasMountedRef.current) { hasMountedRef.current = true; return }

    setIsDirty(true)

    const snapshot = buildSnapshot()   // captures current state right now
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
    autoSaveTimerRef.current = setTimeout(() => {
      writeAutosave(savedProjectId, serialize(snapshot))
    }, 5000)
  }, [timelineItems, tracks, adjustments, localCaptions, localOutputs, localProjectName]) // eslint-disable-line

  // ── beforeunload guard ─────────────────────────────────────
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (!isDirty) return
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [isDirty])

  const effectiveUrl: string | null = viewerClip?.url ?? null
  const effectiveContentType: ContentType | null = viewerClip?.contentType ?? null
  const effectiveCaptions = localCaptions

  // When a signed URL expires mid-session, refresh it using the media item's r2Key
  async function handleMediaError() {
    if (!viewerClip?.url) return
    const media = mediaItems.find(m => m.url === viewerClip.url)
    if (!media?.r2Key) return
    try {
      const res = await fetch(`/api/media/signed-url?key=${encodeURIComponent(media.r2Key)}`)
      if (!res.ok) return
      const { url: freshUrl } = await res.json() as { url: string }
      // Update both the media pool and any timeline item referencing this URL
      setMediaItems(prev => prev.map(m => m.url === viewerClip.url ? { ...m, url: freshUrl } : m))
      setTimelineItemsRaw(prev => prev.map(i => i.url === viewerClip.url ? { ...i, url: freshUrl } : i))
      timelineItemsRef.current = timelineItemsRef.current.map(i =>
        i.url === viewerClip.url ? { ...i, url: freshUrl } : i
      )
    } catch { }
  }

  const duration = useMemo(() => {
    const lastClipEnd = timelineItems.reduce((m, i) => Math.max(m, i.startTime + (i.outPoint - i.inPoint)), 0)
    return Math.max(lastClipEnd + 60, 600)
  }, [timelineItems])

  // ── Master clock (RAF) ─────────────────────────────────────
  // When there is no active video to drive onTimeUpdate, RAF advances the playhead.
  // When a video IS active, it fires onTimeUpdate itself and RAF is dormant.
  const rafRef      = useRef<number | null>(null)
  const rafPrevRef  = useRef<number | null>(null)
  const effectiveUrlRef = useRef(effectiveUrl)
  useEffect(() => { effectiveUrlRef.current = effectiveUrl }, [effectiveUrl])

  useEffect(() => {
    const cancel = () => {
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
      rafPrevRef.current = null
    }
    if (!isPlaying || effectiveUrl) { cancel(); return }

    // No active video — tick the clock ourselves
    function tick(ts: number) {
      if (rafPrevRef.current !== null) {
        const dt = (ts - rafPrevRef.current) / 1000
        setCurrentTime(t => {
          const next = t + dt
          // Stop at end of last clip
          if (next >= (effectiveUrlRef.current ? Infinity : duration)) return t
          return next
        })
      }
      rafPrevRef.current = ts
      // Stop if a video took over
      if (!effectiveUrlRef.current) {
        rafRef.current = requestAnimationFrame(tick)
      }
    }
    rafRef.current = requestAnimationFrame(tick)
    return cancel
  }, [isPlaying, effectiveUrl, duration]) // eslint-disable-line

  // Pre-play hints: tell VideoPlayer where + when each upcoming clip starts so it
  // can begin the hidden decoder running before the transition point.
  const seekHints = useMemo((): Record<string, { inPoint: number; startTime: number }> => {
    const upcoming = timelineItems
      .filter(i => i.enabled !== false && i.url && i.startTime > currentTime)
      .sort((a, b) => a.startTime - b.startTime)
    const next = upcoming[0]
    return next?.url ? { [next.url]: { inPoint: next.inPoint, startTime: next.startTime } } : {}
  }, [timelineItems, Math.floor(currentTime * 2)]) // eslint-disable-line — 0.5s granularity

  // ── Keyboard shortcuts ──────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return

      const v = videoRef.current

      // Transport — J/K/L (industry standard)
      if (e.code === 'KeyL' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        if (!v) return
        if (!isPlaying) { v.playbackRate = 1; v.play().catch(() => {}); setIsPlaying(true) }
        else { v.playbackRate = Math.min(16, v.playbackRate * 2) }
        return
      }
      if (e.code === 'KeyK') {
        e.preventDefault()
        if (!v) return
        v.pause(); v.playbackRate = 1; setIsPlaying(false)
        return
      }
      if (e.code === 'KeyJ' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        if (!v) { setCurrentTime(t => Math.max(0, t - 5)); return }
        v.pause(); setIsPlaying(false)
        v.currentTime = Math.max(0, v.currentTime - 5)
        setCurrentTime(t => Math.max(0, t - 5))
        return
      }

      // Space = play/pause
      if (e.code === 'Space') {
        e.preventDefault()
        if (!v) return
        if (v.paused) { v.play().catch(() => {}); setIsPlaying(true) }
        else { v.pause(); setIsPlaying(false) }
        return
      }

      // Frame stepping — ←/→ arrows
      if (e.code === 'ArrowLeft' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        const step = e.shiftKey ? 1 : FRAME_DURATION
        setCurrentTime(t => {
          const newT = Math.max(0, t - step)
          if (v) v.currentTime = Math.max(0, newT - clipTimeOffsetRef.current)
          return newT
        })
        return
      }
      if (e.code === 'ArrowRight' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        const step = e.shiftKey ? 1 : FRAME_DURATION
        setCurrentTime(t => {
          const newT = t + step
          if (v) v.currentTime = Math.max(0, newT - clipTimeOffsetRef.current)
          return newT
        })
        return
      }

      // Tool switching
      if (e.code === 'KeyB' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        setActiveTool(t => t === 'blade' ? 'select' : 'blade')
        return
      }
      if (e.code === 'KeyA' || e.code === 'Escape') {
        setActiveTool('select')
        return
      }

      // Cmd/Ctrl+B = split at playhead
      if (e.code === 'KeyB' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        const clipsAtPlayhead = timelineItems.filter(i =>
          currentTime > i.startTime &&
          currentTime < i.startTime + (i.outPoint - i.inPoint)
        )
        clipsAtPlayhead.forEach(clip => handleSplitItem(clip.id, currentTime))
        return
      }

      // Delete / Backspace
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
        e.preventDefault()
        if (e.shiftKey) {
          handleRippleDelete(selectedId)
        } else {
          setTimelineItems(p => p.filter(i => i.id !== selectedId))
          setSelectedId(null)
        }
        return
      }

      // Zoom
      if ((e.metaKey || e.ctrlKey) && (e.key === '=' || e.key === '+')) {
        e.preventDefault(); setZoomLevel(z => Math.min(10, z * 1.5))
      }
      if ((e.metaKey || e.ctrlKey) && e.key === '-') {
        e.preventDefault(); setZoomLevel(z => Math.max(0.01, z / 1.5))
      }

      // Duplicate selected clip (⌘D)
      if ((e.metaKey || e.ctrlKey) && e.code === 'KeyD' && selectedId) {
        e.preventDefault(); handleDuplicateItem(selectedId); return
      }

      // Copy selected clip (⌘C)
      if ((e.metaKey || e.ctrlKey) && e.code === 'KeyC' && selectedId) {
        e.preventDefault(); handleCopyItem(selectedId); return
      }

      // Paste (⌘V)
      if ((e.metaKey || e.ctrlKey) && e.code === 'KeyV' && clipboardRef.current) {
        e.preventDefault()
        const trackId = clipboardRef.current.trackId
        handlePasteItem(trackId, currentTime)
        return
      }

      // Add media track (⌘⌥T)
      if ((e.metaKey || e.ctrlKey) && e.altKey && e.code === 'KeyT') {
        e.preventDefault(); handleAddTrack(); return
      }

      // Snap toggle
      if (e.code === 'KeyS' && !e.metaKey && !e.ctrlKey) {
        setSnapEnabled(s => !s)
        return
      }

      // In/Out range markers (I and O — standard in every NLE)
      if (e.code === 'KeyI' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault(); setInPoint(currentTime); return
      }
      if (e.code === 'KeyO' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault(); setOutPoint(currentTime); return
      }
      // Clear markers
      if (e.code === 'KeyI' && e.altKey) { e.preventDefault(); setInPoint(null); return }
      if (e.code === 'KeyO' && e.altKey) { e.preventDefault(); setOutPoint(null); return }
      if (e.code === 'KeyX' && !e.metaKey && !e.ctrlKey) {
        setInPoint(null); setOutPoint(null); return
      }

      // Home / End — jump to start / end of last clip
      if (e.code === 'Home') {
        e.preventDefault()
        handleSeek(0)
        return
      }
      if (e.code === 'End') {
        e.preventDefault()
        const lastEnd = timelineItems.reduce((m, i) => Math.max(m, i.startTime + (i.outPoint - i.inPoint)), 0)
        handleSeek(Math.max(0, lastEnd))
        return
      }

      // ↑ / ↓ — jump to previous / next edit point (clip boundary)
      if (e.code === 'ArrowUp' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        const points = [...new Set([0, ...timelineItems.flatMap(i => [i.startTime, i.startTime + (i.outPoint - i.inPoint)])])].sort((a, b) => b - a)
        const prev = points.find(p => p < currentTime - 0.02)
        if (prev !== undefined) handleSeek(prev)
        return
      }
      if (e.code === 'ArrowDown' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        const points = [...new Set([...timelineItems.flatMap(i => [i.startTime, i.startTime + (i.outPoint - i.inPoint)])])].sort((a, b) => a - b)
        const next = points.find(p => p > currentTime + 0.02)
        if (next !== undefined) handleSeek(next)
        return
      }

      // , / . — nudge selected clip ±1 frame (Shift: ±10 frames)
      if ((e.key === ',' || e.key === '.') && selectedId && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        const dir    = e.key === ',' ? -1 : 1
        const frames = e.shiftKey ? 10 : 1
        const delta  = dir * frames * FRAME_DURATION
        setTimelineItems(prev =>
          prev.map(i => i.id === selectedId ? { ...i, startTime: Math.max(0, i.startTime + delta) } : i)
        )
        return
      }

      // F — fit all clips into the visible timeline window
      if (e.code === 'KeyF' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        const totalDur = timelineItems.reduce((m, i) => Math.max(m, i.startTime + (i.outPoint - i.inPoint)), 0)
        if (totalDur > 0) {
          const availW = window.innerWidth - leftW - rightW - 60
          setZoomLevel(Math.max(0.01, Math.min(10, availW / (totalDur * PIXELS_PER_SECOND))))
        }
        return
      }

      // Cmd+E — open export
      if ((e.metaKey || e.ctrlKey) && e.code === 'KeyE') {
        e.preventDefault(); setShowExport(true); return
      }

      // ? — open keyboard shortcuts reference
      if (e.key === '?' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault(); setShowShortcuts(s => !s); return
      }

      // Save (Cmd+S / Ctrl+S) — cloud; Cmd+Shift+S — download backup
      if ((e.metaKey || e.ctrlKey) && e.code === 'KeyS' && !e.shiftKey) {
        e.preventDefault(); saveToCloud(); return
      }
      if ((e.metaKey || e.ctrlKey) && e.code === 'KeyS' && e.shiftKey) {
        e.preventDefault(); downloadProjectFile(); return
      }

      // Undo / Redo
      if ((e.metaKey || e.ctrlKey) && e.code === 'KeyZ' && !e.shiftKey) {
        e.preventDefault(); undo(); return
      }
      if ((e.metaKey || e.ctrlKey) && (e.code === 'KeyZ' && e.shiftKey || e.code === 'KeyY')) {
        e.preventDefault(); redo(); return
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedId, isPlaying, currentTime, timelineItems])  // eslint-disable-line

  useEffect(() => {
    if (ctxMenu) {
      const close = () => setCtxMenu(null)
      window.addEventListener('scroll', close, true)
      return () => window.removeEventListener('scroll', close, true)
    }
  }, [ctxMenu])

  // ── Playback / seek ──────────────────────────────────────────
  const handleSeek = useCallback((t: number) => {
    setCurrentTime(t)
    const v = videoRef.current
    if (v) v.currentTime = Math.max(0, t - clipTimeOffsetRef.current)
  }, [])

  // ── Timeline item operations ──────────────────────────────────
  const handleMoveItem = useCallback((id: string, newStart: number, newTrackId: string, commit: boolean) => {
    const apply = (prev: TimelineItem[]) =>
      prev.map(i => i.id === id ? { ...i, startTime: Math.max(0, newStart), trackId: newTrackId } : i)
    if (commit) {
      setTimelineItems(apply)
    } else {
      // Preview-only: update the ref so setTimelineItems sees the right base value on commit
      const next = apply(timelineItemsRef.current)
      timelineItemsRef.current = next
      setTimelineItemsRaw(next)
    }
  }, [setTimelineItems])

  const handleTrimItem = useCallback((id: string, _edge: 'in' | 'out', newIn: number, newOut: number, newStart: number, commit: boolean) => {
    const apply = (prev: TimelineItem[]) =>
      prev.map(i => i.id === id ? { ...i, inPoint: newIn, outPoint: newOut, startTime: Math.max(0, newStart) } : i)
    if (commit) {
      setTimelineItems(apply)
    } else {
      const next = apply(timelineItemsRef.current)
      timelineItemsRef.current = next
      setTimelineItemsRaw(next)
    }
  }, [setTimelineItems])

  function handleTransitionChange(id: string, type: TransitionType | undefined, dur: number) {
    setTimelineItems(prev => prev.map(i => i.id === id ? { ...i, transitionIn: type, transitionDuration: dur } : i))
  }

  // Blade split: split a clip at a given timeline time
  function handleSplitItem(id: string, atTime: number) {
    setTimelineItems(prev => {
      const clip = prev.find(i => i.id === id)
      if (!clip) return prev
      const splitSource = atTime - clip.startTime + clip.inPoint
      if (splitSource <= clip.inPoint + 0.05 || splitSource >= clip.outPoint - 0.05) return prev
      const clipA: TimelineItem = { ...clip, outPoint: splitSource }
      const clipB: TimelineItem = {
        ...clip, id: crypto.randomUUID(),
        startTime: atTime, inPoint: splitSource,
      }
      return prev.map(i => i.id === id ? clipA : i).concat([clipB])
    })
  }

  // Ripple delete: remove clip and shift all later clips on the same track left
  function handleRippleDelete(id: string) {
    setTimelineItems(prev => {
      const clip = prev.find(i => i.id === id)
      if (!clip) return prev
      const dur = clip.outPoint - clip.inPoint
      return prev
        .filter(i => i.id !== id)
        .map(i => i.trackId === clip.trackId && i.startTime > clip.startTime
          ? { ...i, startTime: i.startTime - dur }
          : i
        )
    })
    setSelectedId(null)
  }

  // ── Clip edit operations ─────────────────────────────────────

  function handleDuplicateItem(id: string) {
    setTimelineItems(prev => {
      const clip = prev.find(i => i.id === id)
      if (!clip) return prev
      const dur = clip.outPoint - clip.inPoint
      return [...prev, { ...clip, id: crypto.randomUUID(), startTime: clip.startTime + dur + 0.25 }]
    })
  }

  function handleRenameItem(id: string) {
    const clip = timelineItems.find(i => i.id === id)
    if (!clip) return
    const name = window.prompt('Rename clip', clip.label)
    if (name !== null && name.trim()) {
      setTimelineItems(prev => prev.map(i => i.id === id ? { ...i, label: name.trim() } : i))
    }
  }

  function handleToggleEnabled(id: string) {
    setTimelineItems(prev => prev.map(i => i.id === id ? { ...i, enabled: i.enabled === false ? true : false } : i))
  }

  function handleChangeColor(id: string, color: string) {
    setTimelineItems(prev => prev.map(i => i.id === id ? { ...i, color } : i))
  }

  function handleCopyItem(id: string) {
    const clip = timelineItems.find(i => i.id === id)
    if (clip) clipboardRef.current = clip
  }

  function handlePasteItem(trackId: string, atTime: number) {
    const clip = clipboardRef.current
    if (!clip) return
    const newClip: TimelineItem = { ...clip, id: crypto.randomUUID(), trackId, startTime: atTime }
    setTimelineItems(prev => [...prev, newClip])
    setSelectedId(newClip.id)
  }

  function handleDeleteTrack(trackId: string) {
    const hasClips = timelineItems.some(i => i.trackId === trackId)
    if (hasClips) return
    setTracksWithHistory(prev => prev.filter(t => t.id !== trackId))
  }

  // ── Import / media ───────────────────────────────────────────

  // Read actual duration from a blob/object URL without touching the viewer
  function readDuration(url: string, ct: ContentType): Promise<number> {
    return new Promise((resolve) => {
      const el = document.createElement(ct === 'video' ? 'video' : 'audio')
      el.preload = 'metadata'
      el.onloadedmetadata = () => { resolve(isFinite(el.duration) ? el.duration : 0); el.src = '' }
      el.onerror = () => resolve(0)
      el.src = url
    })
  }

  function handleFileImport(file: File) {
    const ct: ContentType = file.type.startsWith('video/') ? 'video' : 'audio'
    const url = URL.createObjectURL(file)
    const id = crypto.randomUUID()

    setImportedFile(file)
    setLocalProjectName((prev) => prev === 'New Project' ? file.name.replace(/\.[^.]+$/, '') : prev)
    // Add immediately with no duration and uploading status
    setMediaItems(prev => [...prev, { id, name: file.name, contentType: ct, url, file, uploadStatus: 'uploading' }])
    setSelectedMediaId(id)
    setTranscribeStatus('idle')
    setLocalCaptions([])
    setTranscribeError('')

    // Probe duration (fast for local blob URLs) and update the pool entry
    readDuration(url, ct).then((dur) => {
      setMediaItems(prev => prev.map(m => m.id === id ? { ...m, duration: dur } : m))
    })

    // Capture first frame as thumbnail for video files
    if (ct === 'video') {
      generateVideoThumbnail(url).then((thumbnail) => {
        if (thumbnail) setMediaItems(prev => prev.map(m => m.id === id ? { ...m, thumbnail } : m))
      })
    }

    // Upload to R2 in the background — blob URL stays usable for this session
    uploadMediaToR2(file, id)
  }

  async function uploadMediaToR2(file: File, mediaId: string) {
    try {
      const res = await fetch('/api/media/presign-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, contentType: file.type, mediaId, size: file.size }),
      })
      if (res.status === 413) {
        setMediaItems(prev => prev.map(m => m.id === mediaId ? { ...m, uploadStatus: 'error' } : m))
        setTranscribeError('File is too large. Maximum size is 500 MB.')
        return
      }
      if (!res.ok) throw new Error('presign failed')
      const { uploadUrl, key } = await res.json() as { uploadUrl: string; key: string }

      await fetch(uploadUrl, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': file.type },
      })

      setMediaItems(prev => prev.map(m =>
        m.id === mediaId ? { ...m, r2Key: key, uploadStatus: 'uploaded' } : m
      ))
    } catch {
      setMediaItems(prev => prev.map(m =>
        m.id === mediaId ? { ...m, uploadStatus: 'error' } : m
      ))
    }
  }

  async function addMediaToTimeline(media: MediaItem) {
    const firstMedia = tracks.find(t => t.type === 'media' || t.type === 'video' || t.type === 'audio')
    const trackId = firstMedia?.id ?? 'v1'
    const lastEnd = timelineItems
      .filter(i => i.trackId === trackId)
      .reduce((m, i) => Math.max(m, i.startTime + (i.outPoint - i.inPoint)), 0)

    // If duration hasn't been probed yet, wait for it now (blob URL loads instantly)
    const dur = media.duration
      ?? (media.url ? await readDuration(media.url, media.contentType) : 0)

    const newItem: TimelineItem = {
      id: crypto.randomUUID(),
      label: media.name.replace(/\.[^.]+$/, ''),
      startTime: lastEnd + (lastEnd > 0 ? 0.25 : 0),
      inPoint: 0, outPoint: dur,
      captions: [], color: CLIP_COLORS[timelineItems.length % CLIP_COLORS.length],
      trackId, url: media.url, contentType: media.contentType,
    }
    setTimelineItems(prev => [...prev, newItem])
    setSelectedId(newItem.id)
    handleSeek(newItem.startTime)
  }

  async function handleDropMedia(mediaId: string, trackId: string, startTime: number) {
    const media = mediaItems.find(m => m.id === mediaId)
    if (!media) return

    const dur = media.duration
      ?? (media.url ? await readDuration(media.url, media.contentType) : 0)

    const newItem: TimelineItem = {
      id: crypto.randomUUID(),
      label: media.name.replace(/\.[^.]+$/, ''),
      startTime, inPoint: 0, outPoint: dur,
      captions: [], color: CLIP_COLORS[timelineItems.length % CLIP_COLORS.length],
      trackId, url: media.url, contentType: media.contentType,
    }
    setTimelineItems(prev => [...prev, newItem])
    setSelectedId(newItem.id)
    handleSeek(newItem.startTime)
  }

  function handleAddTrack(_type?: string) {
    const mediaTracks = tracks.filter(t => t.type === 'media' || t.type === 'video' || t.type === 'audio')
    const n = mediaTracks.length + 1
    const id = `m${n}`
    setTracksWithHistory(prev => [...prev.filter(t => t.type !== 'caption'), { id, label: `M${n}`, type: 'media', height: TRACK_HEIGHT }])
    setTlHeight(h => Math.min(MAX_TL, h + TRACK_HEIGHT))
  }

  async function handleTranscribe() {
    if (transcribeStatus === 'transcribing') return
    const media = selectedMediaId ? mediaItems.find(m => m.id === selectedMediaId) : null
    if (!media) return

    // The file must have finished uploading to R2 before Deepgram can fetch it
    if (!media.r2Key) {
      if (media.uploadStatus === 'uploading') {
        setTranscribeError('Still uploading — please wait a moment and try again.')
      } else {
        setTranscribeError('Upload failed. Please remove and re-import the file.')
      }
      return
    }

    setTranscribeStatus('transcribing')
    setTranscribeProgress(101) // show server-processing indicator immediately
    setTranscribeError('')

    try {
      const res = await fetch('/api/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ r2Key: media.r2Key, contentType: media.contentType }),
      })

      if (res.status === 429) {
        setTranscribeStatus('error')
        showUpgrade('You\'ve used your free transcriptions for this month. Upgrade to Pro for 30/month.')
        return
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(err.error ?? `Server error ${res.status}`)
      }

      const data = await res.json() as { captions?: Caption[]; duration?: number }
      const newCaptions: Caption[] = data.captions ?? []

      const out: Output = {
        id: `transcript-${Date.now()}`, type: 'transcript', title: 'Full Transcript',
        wordCount: newCaptions.reduce((n, c) => n + c.text.split(' ').length, 0),
        createdAt: new Date(), content: newCaptions.map(c => c.text).join(' '), captions: newCaptions,
      }
      setCaptionsWithHistory(newCaptions)
      setLocalOutputs([out])
      setTranscribeStatus('done')
      posthog.capture('transcription_completed', { word_count: out.wordCount })
      saveProject({
        id: savedProjectId, name: localProjectName,
        contentType: media.contentType,
        createdAt: new Date().toISOString(), duration: data.duration,
        captions: newCaptions, outputs: [out],
      })
    } catch (err) {
      setTranscribeError(err instanceof Error ? err.message : 'Failed')
      setTranscribeStatus('error')
    }
  }

  // Build phrase captions from word-level timestamps (used when utterances are absent)
  function buildCaptionsFromWords(
    words: Array<{ start: number; end: number; word: string }>,
    wordsPerChunk = 8,
  ): Caption[] {
    const out: Caption[] = []
    for (let i = 0; i < words.length; i += wordsPerChunk) {
      const chunk = words.slice(i, i + wordsPerChunk)
      out.push({ start: chunk[0].start, end: chunk[chunk.length - 1].end, text: chunk.map(w => w.word).join(' ') })
    }
    return out
  }

  function openCtx(e: React.MouseEvent, items: ContextMenuItem[]) {
    e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, items })
  }

  // Build snapshot of current editor state for serialization
  function buildSnapshot(): EditorSnapshot {
    return {
      id: savedProjectId,
      name: localProjectName,
      tracks,
      timelineItems,
      adjustments,
      zoomLevel,
      captions: localCaptions,
      outputs: localOutputs,
      mediaItems,
    }
  }

  function flashSaved() {
    setSaveStatus('saved')
    setIsDirty(false)
    clearAutosave(savedProjectId)
    if (savedStatusTimerRef.current) clearTimeout(savedStatusTimerRef.current)
    savedStatusTimerRef.current = setTimeout(() => setSaveStatus('idle'), 3000)
  }

  function handleRestore() {
    if (!recovery) return
    const loaded = deserialize(recovery.cfproj)
    const loadedTracks = loaded.tracks.filter(t => t.type !== 'caption')
    setLocalProjectName(loaded.name)
    setTracks(loadedTracks)
    tracksRef.current = loadedTracks
    setTimelineItemsRaw(loaded.timelineItems)
    timelineItemsRef.current = loaded.timelineItems
    setZoomLevel(loaded.zoomLevel)
    setLocalCaptions(loaded.captions)
    captionsRef.current = loaded.captions
    setLocalOutputs(loaded.outputs)
    resetHistory({ timelineItems: loaded.timelineItems, tracks: loadedTracks, adjustments: DEFAULT_ADJUSTMENTS, captions: loaded.captions })
    setRecovery(null)
    setIsDirty(true)
  }

  function handleDismissRecovery() {
    clearAutosave(savedProjectId)
    setRecovery(null)
  }

  async function saveToCloud() {
    setShowSaveMenu(false)
    // Prompt for a real name if it's still the default
    let nameToUse = localProjectName.trim()
    if (nameToUse === 'New Project') {
      const input = window.prompt('Name this project:', 'My Project')
      if (!input?.trim()) return
      nameToUse = input.trim()
      setLocalProjectName(nameToUse)
    }
    setSaveStatus('saving')
    try {
      const snapshot = buildSnapshot()
      snapshot.name = nameToUse  // use confirmed name even if state hasn't updated yet
      const project: CfProjFile = serialize(snapshot)
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(project),
      })
      if (!res.ok) throw new Error('Cloud save failed')
      posthog.capture('project_saved', { name: nameToUse })
      flashSaved()
    } catch {
      setSaveStatus('error')
    }
  }

  /** Download a portable .cfproj backup file — not the primary save path. */
  async function downloadProjectFile() {
    setShowSaveMenu(false)
    try {
      const project: CfProjFile = serialize(buildSnapshot())
      await saveProjectToFile(project, undefined)
    } catch {
      // User cancelled the picker — not an error
    }
  }

  /** Save a copy of the current project under a new name (new cloud ID). */
  async function saveAsProject() {
    const newName = window.prompt('Save a copy as:', `${localProjectName} Copy`)
    if (!newName?.trim()) return
    setShowSaveMenu(false)
    setSaveStatus('saving')
    try {
      const snap = buildSnapshot()
      const project: CfProjFile = serialize({ ...snap, id: crypto.randomUUID(), name: newName.trim() })
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(project),
      })
      if (!res.ok) throw new Error('Save As failed')
      setSaveStatus('saved')
      if (savedStatusTimerRef.current) clearTimeout(savedStatusTimerRef.current)
      savedStatusTimerRef.current = setTimeout(() => setSaveStatus('idle'), 3000)
    } catch {
      setSaveStatus('error')
    }
  }


  // ── AI handlers ─────────────────────────────────────────────

  async function callAi(prompt: string, system: string): Promise<string> {
    const res = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, system }),
    })
    if (res.status === 429) {
      posthog.capture('upgrade_shown', { trigger: 'ai_limit' })
      showUpgrade('You\'ve used your free AI generations for this month. Upgrade to Pro for 100/month.')
      throw new Error('Monthly AI limit reached — upgrade to continue.')
    }
    if (!res.ok) throw new Error(`AI request failed: ${res.status}`)
    const data = await res.json() as { content: string; error?: string }
    if (data.error) throw new Error(data.error)
    posthog.capture('ai_content_generated')
    return data.content
  }

  async function handleSilenceTrim() {
    if (!localCaptions.length) return
    setSilenceTrimStatus('working')
    try {
      const sorted = [...localCaptions].sort((a, b) => a.start - b.start)
      const gaps: { start: number; end: number }[] = []
      for (let i = 0; i < sorted.length - 1; i++) {
        const gapStart = sorted[i].end
        const gapEnd   = sorted[i + 1].start
        if (gapEnd - gapStart > silenceThreshold) gaps.push({ start: gapStart, end: gapEnd })
      }
      if (!gaps.length) { setSilenceTrimStatus('done'); return }

      const newItems: TimelineItem[] = []
      for (const item of [...timelineItems].sort((a, b) => a.startTime - b.startTime)) {
        const overlapping = gaps
          .filter(g => g.start < item.outPoint && g.end > item.inPoint)
          .sort((a, b) => a.start - b.start)

        if (!overlapping.length) { newItems.push(item); continue }

        // Split clip at silence boundaries, keeping only speech segments
        let srcCursor = item.inPoint
        // tlCursor: placed right after the last newItem on this track
        let tlCursor = newItems.filter(i => i.trackId === item.trackId).reduce(
          (max, i) => Math.max(max, i.startTime + (i.outPoint - i.inPoint)), item.startTime
        )

        for (const gap of overlapping) {
          const segEnd = Math.min(gap.start, item.outPoint)
          if (segEnd > srcCursor) {
            newItems.push({ ...item, id: crypto.randomUUID(), startTime: tlCursor, inPoint: srcCursor, outPoint: segEnd })
            tlCursor += segEnd - srcCursor
          }
          srcCursor = Math.min(gap.end, item.outPoint)
        }
        if (srcCursor < item.outPoint) {
          newItems.push({ ...item, id: crypto.randomUUID(), startTime: tlCursor, inPoint: srcCursor, outPoint: item.outPoint })
        }
      }
      setTimelineItems(newItems)
      setSilenceTrimStatus('done')
    } catch {
      setSilenceTrimStatus('error')
    }
  }

  async function handleSmartClip() {
    if (!localCaptions.length) return
    setSmartClipStatus('working')
    try {
      const transcript = localCaptions.map(c => `[${c.start.toFixed(1)}s] ${c.text}`).join('\n')
      const system = 'You are a video editing assistant. Return ONLY valid JSON — no markdown, no explanation, no code fences.'
      const prompt = `Identify the 3 to 5 most compelling, self-contained highlight moments in this transcript. Each should be 20–120 seconds long.\n\nTranscript:\n${transcript}\n\nReturn a JSON array: [{"title": "string", "start": number, "end": number, "reason": "string"}]`
      const raw = await callAi(prompt, system)
      const moments = JSON.parse(raw) as { title: string; start: number; end: number; reason: string }[]

      // Find a reference clip (first clip with a url) to copy media info from
      const mediaTrack = tracks.find(t => t.type === 'media' || t.type === 'video' || t.type === 'audio')
      if (!mediaTrack) throw new Error('No media track')
      const refClip = timelineItems.find(i => i.url && i.trackId === mediaTrack.id)
      if (!refClip) throw new Error('No media on timeline')

      const videoTrack = mediaTrack

      let cursor = timelineItems.reduce((max, i) => Math.max(max, i.startTime + (i.outPoint - i.inPoint)), 0) + 2
      const newClips: TimelineItem[] = moments.map(m => ({
        id: crypto.randomUUID(),
        label: m.title,
        startTime: cursor,
        inPoint: m.start,
        outPoint: m.end,
        color: CLIP_COLORS[Math.floor(Math.random() * CLIP_COLORS.length)],
        trackId: videoTrack.id,
        url: refClip.url,
        contentType: refClip.contentType,
        captions: localCaptions.filter(c => c.start >= m.start && c.end <= m.end),
      } satisfies TimelineItem)
      ).map(clip => { cursor += clip.outPoint - clip.inPoint + 0.5; return clip })

      setTimelineItems(prev => [...prev, ...newClips])
      setSmartClipStatus('done')
    } catch {
      setSmartClipStatus('error')
    }
  }

  async function handleGenerateContent(type: 'article' | 'blog_post' | 'show_notes') {
    if (!localCaptions.length) return
    setGenContentStatus(prev => ({ ...prev, [type]: 'working' }))
    try {
      const transcript = localCaptions.map(c => c.text).join(' ')
      const prompts: Record<string, { system: string; prompt: string }> = {
        article: {
          system: 'You are a professional content writer. Write in a clear, engaging style.',
          prompt: `Write a comprehensive article based on this transcript. Include an engaging title (as a # heading), introduction, main points with ## subheadings, and conclusion.\n\nTranscript:\n${transcript}`,
        },
        blog_post: {
          system: 'You are an SEO-savvy blog writer. Write in a conversational, engaging style.',
          prompt: `Write an SEO-friendly blog post based on this transcript. Use an engaging hook as the opening, include ## subheadings, bullet points for key takeaways, and a call to action at the end.\n\nTranscript:\n${transcript}`,
        },
        show_notes: {
          system: 'You are a podcast producer writing show notes.',
          prompt: `Write podcast show notes for this transcript. Include: a 2–3 sentence summary, key topics covered (bullet list), 2–3 notable quotes with timestamps, and a brief resources/links section.\n\nTranscript:\n${localCaptions.map(c => `[${c.start.toFixed(0)}s] ${c.text}`).join('\n')}`,
        },
      }
      const { system, prompt } = prompts[type]
      const content = await callAi(prompt, system)

      const typeLabels: Record<string, string> = { article: 'Article', blog_post: 'Blog Post', show_notes: 'Show Notes' }
      const firstLine = content.split('\n').find(l => l.trim())?.replace(/^#+\s*/, '') ?? typeLabels[type]
      const out: Output = {
        id: crypto.randomUUID(),
        type: type as Output['type'],
        title: firstLine,
        content,
        wordCount: content.split(/\s+/).length,
        createdAt: new Date(),
      }
      setLocalOutputs(prev => [out, ...prev])
      setGenContentStatus(prev => ({ ...prev, [type]: 'done' }))
    } catch {
      setGenContentStatus(prev => ({ ...prev, [type]: 'error' }))
    }
  }

  const clampLeft  = (d: number) => setLeftW(w => Math.max(MIN_LEFT, Math.min(MAX_LEFT, w + d)))
  const clampRight = (d: number) => setRightW(w => Math.max(MIN_RIGHT, Math.min(MAX_RIGHT, w - d)))
  const clampTl    = (d: number) => setTlHeight(h => Math.max(MIN_TL, Math.min(MAX_TL, h - d)))

  // ── Page tab config ──────────────────────────────────────────
  const PAGES: { id: EditorPage; label: string; icon: React.ElementType }[] = [
    { id: 'edit',    label: 'Edit',    icon: Film },
    { id: 'color',   label: 'Color',   icon: Palette },
    { id: 'audio',   label: 'Audio',   icon: Music },
    { id: 'deliver', label: 'Deliver', icon: Package },
  ]

  return (
    <div data-editor="true" className="flex flex-col h-full" style={{ background: 'var(--bg-base)' }}>

      {/* ── Header ───────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-4 shrink-0" style={{ height: 40, borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)' }}>
        <Link href="/dashboard" className="flex items-center gap-1.5 text-xs shrink-0" style={{ color: 'var(--text-muted)' }}>
          <ArrowLeft size={12} /> Dashboard
        </Link>
        <div className="w-px h-4 shrink-0" style={{ background: 'var(--border)' }} />
        <span className="text-xs font-semibold truncate flex-1" style={{ color: 'var(--text-primary)' }}>{localProjectName}</span>

        {/* Undo / Redo */}
        <div className="flex items-center gap-0.5">
          <button
            onClick={undo}
            disabled={!canUndo}
            className="p-1.5 rounded" title="Undo (⌘Z)"
            style={{ color: canUndo ? 'var(--text-muted)' : 'var(--border-light)', cursor: canUndo ? 'pointer' : 'default' }}
          >
            <Undo2 size={13} />
          </button>
          <button
            onClick={redo}
            disabled={!canRedo}
            className="p-1.5 rounded" title="Redo (⌘⇧Z)"
            style={{ color: canRedo ? 'var(--text-muted)' : 'var(--border-light)', cursor: canRedo ? 'pointer' : 'default' }}
          >
            <Redo2 size={13} />
          </button>
        </div>
        <div className="w-px h-4 shrink-0" style={{ background: 'var(--border)' }} />

        {/* Tool selector — only relevant on Edit page */}
        {activePage === 'edit' && (
          <div className="flex items-center gap-1 px-1 py-0.5 rounded" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
            <button
              onClick={() => setActiveTool('select')}
              className="flex items-center gap-1 px-2 py-1 rounded text-xs"
              title="Selection tool (A)"
              style={{
                background: activeTool === 'select' ? 'var(--accent)' : 'transparent',
                color: activeTool === 'select' ? '#fff' : 'var(--text-muted)',
              }}
            >
              <MousePointer2 size={11} />
            </button>
            <button
              onClick={() => setActiveTool('blade')}
              className="flex items-center gap-1 px-2 py-1 rounded text-xs"
              title="Blade tool (B) — click to split clips"
              style={{
                background: activeTool === 'blade' ? '#e11d48' : 'transparent',
                color: activeTool === 'blade' ? '#fff' : 'var(--text-muted)',
              }}
            >
              <Scissors size={11} />
            </button>
          </div>
        )}

        {/* Save button — primary action is cloud save */}
        <div className="relative shrink-0">
          <div className="flex" style={{ border: '1px solid var(--border)', borderRadius: 4, overflow: 'hidden' }}>
            <button
              onClick={saveToCloud}
              title="Save project (⌘S)"
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium"
              style={{
                background: saveStatus === 'saved' ? 'var(--accent-subtle)' : 'var(--bg-card)',
                color: saveStatus === 'saved' ? 'var(--accent-light)' : saveStatus === 'error' ? '#ef4444' : 'var(--text-secondary)',
                borderRight: '1px solid var(--border)',
              }}
            >
              {saveStatus === 'saving' ? (
                <><span style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>⟳</span> Saving…</>
              ) : saveStatus === 'saved' ? (
                <><CheckCircle2 size={11} /> Saved</>
              ) : saveStatus === 'error' ? (
                <><Cloud size={11} /> Save failed — retry?</>
              ) : (
                <>
                  <Cloud size={11} />
                  {isDirty && <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#f97316', flexShrink: 0 }} />}
                  Save
                </>
              )}
            </button>
            <button
              onClick={() => setShowSaveMenu(v => !v)}
              className="flex items-center px-1.5 py-1"
              style={{ background: 'var(--bg-card)', color: 'var(--text-muted)' }}
              title="More save options"
            >
              <ChevronDown size={10} />
            </button>
          </div>
          {showSaveMenu && (
            <div
              className="absolute right-0 top-full mt-1 rounded shadow-lg z-50 overflow-hidden"
              style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', minWidth: 200 }}
              onMouseLeave={() => setShowSaveMenu(false)}
            >
              <button
                onClick={saveToCloud}
                className="flex items-center gap-2 w-full px-3 py-2 text-xs text-left"
                style={{ color: 'var(--text-primary)' }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-card-hover)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <Cloud size={12} /> Save <span style={{ color: 'var(--text-muted)', marginLeft: 'auto' }}>⌘S</span>
              </button>
              <button
                onClick={saveAsProject}
                className="flex items-center gap-2 w-full px-3 py-2 text-xs text-left"
                style={{ color: 'var(--text-secondary)' }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-card-hover)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <FilePlus size={12} /> Save As…
              </button>
              <div style={{ height: 1, background: 'var(--border)', margin: '2px 0' }} />
              <button
                onClick={downloadProjectFile}
                className="flex items-center gap-2 w-full px-3 py-2 text-xs text-left"
                style={{ color: 'var(--text-secondary)' }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-card-hover)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <HardDrive size={12} /> Download .cfproj backup <span style={{ color: 'var(--text-muted)', marginLeft: 'auto' }}>⌘⇧S</span>
              </button>
            </div>
          )}
        </div>

        <button
          onClick={() => setShowExport(true)}
          disabled={timelineItems.length === 0}
          className="flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium shrink-0"
          style={{
            background: timelineItems.length === 0 ? 'var(--border)' : 'var(--accent)',
            color: timelineItems.length === 0 ? 'var(--text-muted)' : '#fff',
            cursor: timelineItems.length === 0 ? 'not-allowed' : 'pointer',
          }}
          title={timelineItems.length === 0 ? 'Add clips to the timeline to export' : 'Export (⌘E)'}
        >
          <Download size={11} /> Export
        </button>
      </div>

      {/* ── Recovery banner ──────────────────────────────────── */}
      {recovery && (
        <div
          className="flex items-center justify-between gap-3 px-4 py-2 text-xs shrink-0"
          style={{ background: '#1c1400', borderBottom: '1px solid #3d2e00', color: '#fbbf24' }}
        >
          <span>
            Unsaved changes from{' '}
            <strong>{formatRelativeTime(recovery.at)}</strong> were found — your last session may have ended unexpectedly.
          </span>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handleRestore}
              className="px-2.5 py-1 rounded font-medium"
              style={{ background: '#f97316', color: '#fff' }}
            >
              Restore
            </button>
            <button
              onClick={handleDismissRecovery}
              className="px-2.5 py-1 rounded"
              style={{ background: 'rgba(255,255,255,0.06)', color: '#fbbf24' }}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* ── Page content ─────────────────────────────────────── */}
      {activePage === 'edit' && (
        <>
          {/* Work area — three panels */}
          <div className="flex overflow-hidden min-h-0" style={{ flex: '1 1 0' }}>
            <div className="shrink-0 overflow-hidden" style={{ width: leftW }}>
              <MediaLibrary
                items={mediaItems} selectedId={selectedMediaId}
                onSelect={setSelectedMediaId}
                onImport={handleFileImport}
                onAddToTimeline={addMediaToTimeline}
                onRemove={(id) => setMediaItems(prev => prev.filter(m => m.id !== id))}
                onContextMenu={openCtx}
              />
            </div>
            <VResizeHandle onDelta={clampLeft} />
            <div className="flex-1 overflow-hidden min-w-0">
              <VideoPlayer
                src={effectiveUrl} contentType={effectiveContentType}
                captions={effectiveCaptions} currentTime={currentTime}
                timeOffset={clipTimeOffset} isPlaying={isPlaying}
                adjustments={adjustments}
                clipLabel={viewerClip?.label}
                onTimeUpdate={setCurrentTime}
                onPlay={() => setIsPlaying(true)} onPause={() => setIsPlaying(false)}
                videoRef={videoRef}
                onMediaError={handleMediaError}
                preloadSrcs={mediaItems.map(m => m.url).filter((u): u is string => !!u)}
                seekHints={seekHints}
              />
            </div>
            <VResizeHandle onDelta={clampRight} />
            <div className="shrink-0 overflow-hidden" style={{ width: rightW }}>
              <Inspector
                selectedItem={selectedItem} adjustments={adjustments} outputs={localOutputs}
                onAdjustmentsChange={setAdjustmentsWithHistory}
                onTransitionChange={handleTransitionChange}
                importedFile={importedFile}
                transcribeStatus={transcribeStatus}
                transcribeProgress={transcribeProgress}
                transcribeError={transcribeError}
                onTranscribe={handleTranscribe}
                captions={localCaptions}
                silenceTrimStatus={silenceTrimStatus}
                silenceThreshold={silenceThreshold}
                onSilenceThresholdChange={setSilenceThreshold}
                onSilenceTrim={handleSilenceTrim}
                smartClipStatus={smartClipStatus}
                onSmartClip={handleSmartClip}
                genContentStatus={genContentStatus}
                onGenerateContent={handleGenerateContent}
              />
            </div>
          </div>

          {/* Timeline resize + Timeline */}
          <HResizeHandle onDelta={clampTl} />
          <Timeline
            items={timelineItems} captions={effectiveCaptions} tracks={tracks}
            duration={duration} currentTime={currentTime} isPlaying={isPlaying} selectedId={selectedId}
            zoomLevel={zoomLevel} height={tlHeight}
            activeTool={activeTool} snapEnabled={snapEnabled}
            inPoint={inPoint} outPoint={outPoint}
            hasCopied={!!clipboardRef.current}
            onSeek={handleSeek} onSelectItem={setSelectedId}
            onMoveItem={handleMoveItem} onTrimItem={handleTrimItem}
            onSplitItem={handleSplitItem}
            onZoomChange={setZoomLevel}
            onDeleteItem={(id) => { setTimelineItems(p => p.filter(i => i.id !== id)); setSelectedId(null) }}
            onRippleDelete={handleRippleDelete}
            onDropMedia={handleDropMedia}
            onAddTrack={handleAddTrack}
            onSnapToggle={() => setSnapEnabled(s => !s)}
            onContextMenu={openCtx}
            onDuplicateItem={handleDuplicateItem}
            onRenameItem={handleRenameItem}
            onToggleEnabled={handleToggleEnabled}
            onChangeColor={handleChangeColor}
            onCopyItem={handleCopyItem}
            onPasteItem={handlePasteItem}
            onDeleteTrack={handleDeleteTrack}
          />
        </>
      )}

      {activePage === 'color' && (
        <ColorPage adjustments={adjustments} onAdjustmentsChange={setAdjustmentsWithHistory} />
      )}
      {activePage === 'audio' && (
        <PlaceholderPage title="Audio — Fairlight" description="Per-track volume, EQ, dynamics, and audio meters — coming soon" />
      )}
      {activePage === 'deliver' && (
        <PlaceholderPage title="Deliver" description="Export format, codec, resolution, and render queue — coming soon" />
      )}

      {/* ── Page tabs ────────────────────────────────────────── */}
      <div
        className="flex items-stretch shrink-0"
        style={{ height: 40, borderTop: '1px solid var(--border)', background: '#0e0e0e' }}
      >
        {PAGES.map(({ id, label, icon: Icon }) => {
          const active = activePage === id
          return (
            <button
              key={id}
              onClick={() => setActivePage(id)}
              className="flex flex-col items-center justify-center gap-0.5 flex-1 transition-colors"
              style={{
                color: active ? 'var(--accent-light)' : 'var(--text-muted)',
                background: active ? 'rgba(61,143,239,0.08)' : 'transparent',
                borderTop: `2px solid ${active ? 'var(--accent)' : 'transparent'}`,
                fontSize: 9,
                fontWeight: active ? 600 : 400,
                letterSpacing: '0.05em',
                textTransform: 'uppercase',
              }}
            >
              <Icon size={13} />
              {label}
            </button>
          )
        })}
      </div>

      {ctxMenu && <ContextMenu x={ctxMenu.x} y={ctxMenu.y} items={ctxMenu.items} onClose={() => setCtxMenu(null)} />}

      {/* Project loading overlay */}
      {isLoadingProject && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 200,
          background: 'rgba(10,10,12,0.7)', backdropFilter: 'blur(4px)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12,
        }}>
          <div style={{ width: 28, height: 28, borderRadius: '50%', border: '2.5px solid var(--border)', borderTopColor: 'var(--accent)', animation: 'spin 0.8s linear infinite' }} />
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Opening project…</span>
        </div>
      )}

      {/* Save toast */}
      {(saveStatus === 'saved' || saveStatus === 'error') && (
        <div
          style={{
            position: 'fixed', bottom: 24, right: 24, zIndex: 100,
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '10px 16px', borderRadius: 10,
            background: saveStatus === 'saved' ? '#18251a' : '#250f0f',
            border: `1px solid ${saveStatus === 'saved' ? '#166534' : '#7f1d1d'}`,
            color: saveStatus === 'saved' ? '#4ade80' : '#f87171',
            fontSize: 13, fontWeight: 500,
            boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
            animation: 'slideUp 0.2s ease-out',
          }}
        >
          {saveStatus === 'saved'
            ? <><CheckCircle2 size={14} /> Project saved</>
            : <><Cloud size={14} /> Save failed — check your connection</>
          }
        </div>
      )}

      {showExport && (
        <ExportModal
          projectName={localProjectName}
          timelineItems={timelineItems}
          mediaItems={mediaItems}
          onClose={() => setShowExport(false)}
        />
      )}

      {showShortcuts && (
        <div
          className="fixed inset-0 flex items-center justify-center z-50"
          style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}
          onClick={() => setShowShortcuts(false)}
        >
          <div
            className="rounded-xl shadow-2xl overflow-hidden"
            style={{ width: 560, maxHeight: '85vh', overflow: 'auto', background: 'var(--bg-card)', border: '1px solid var(--border-light)' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
              <span className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>Keyboard Shortcuts</span>
              <button onClick={() => setShowShortcuts(false)} style={{ color: 'var(--text-muted)', fontSize: 18, lineHeight: 1 }}>×</button>
            </div>
            <div className="p-5 grid gap-5" style={{ gridTemplateColumns: '1fr 1fr' }}>
              {[
                { section: 'Transport', rows: [
                  ['Space',        'Play / Pause'],
                  ['J',            'Skip back 5 s'],
                  ['K',            'Pause'],
                  ['L',            'Play / Speed up 2×'],
                  ['←  /  →',      'Step 1 frame'],
                  ['Shift + ← →',  'Step 1 second'],
                  ['↑  /  ↓',      'Prev / next edit point'],
                  ['Home / End',   'Go to start / end'],
                ]},
                { section: 'Timeline', rows: [
                  ['B',            'Blade (cut) tool'],
                  ['A  /  Esc',    'Select tool'],
                  ['⌘B',           'Split clip at playhead'],
                  [', / .',        'Nudge clip ±1 frame'],
                  ['Shift , / .',  'Nudge clip ±10 frames'],
                  ['F',            'Fit all clips in view'],
                  ['S',            'Toggle snap'],
                  ['⌘⌥T',         'Add track'],
                ]},
                { section: 'Clips', rows: [
                  ['Del  /  Bksp', 'Delete selected clip'],
                  ['Shift + Del',  'Ripple delete'],
                  ['⌘D',           'Duplicate clip'],
                  ['⌘C  /  ⌘V',   'Copy / Paste'],
                  ['I  /  O',      'Set in / out point'],
                  ['Alt I / O',    'Clear in / out point'],
                  ['X',            'Clear both markers'],
                ]},
                { section: 'Project', rows: [
                  ['⌘S',           'Save'],
                  ['⌘⇧S',         'Download backup'],
                  ['⌘E',           'Export'],
                  ['⌘Z',           'Undo'],
                  ['⌘⇧Z',         'Redo'],
                  ['⌘+  /  ⌘−',   'Zoom in / out'],
                  ['?',            'This shortcuts panel'],
                ]},
              ].map(({ section, rows }) => (
                <div key={section}>
                  <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>{section}</p>
                  <div className="flex flex-col gap-1">
                    {rows.map(([key, label]) => (
                      <div key={key} className="flex items-center justify-between gap-4">
                        <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{label}</span>
                        <kbd className="text-xs px-1.5 py-0.5 rounded font-mono shrink-0"
                          style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
                          {key}
                        </kbd>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <p className="px-5 pb-4 text-xs text-center" style={{ color: 'var(--text-muted)' }}>
              Ruler: drag left/right to scrub · drag down while scrubbing for finer control
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

function formatRelativeTime(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000)
  if (seconds < 60)  return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hr ago`
  return date.toLocaleDateString()
}
