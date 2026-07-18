'use client'

import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { useElectronChrome } from '@/lib/use-electron-chrome'
import dynamic from 'next/dynamic'
import { ArrowLeft, Download, Film, Palette, Music, Package, MousePointer2, Scissors, Undo2, Redo2, Save, Cloud, HardDrive, ChevronDown, CheckCircle2, FilePlus, AudioLines, PanelsTopBottom, Mic, Share2, Link2, Check as CheckIcon, Plus } from 'lucide-react'
import Link from 'next/link'
import { useRouter, usePathname } from 'next/navigation'
import { useUser } from '@clerk/nextjs'
import VideoPlayer from '@/components/editor/VideoPlayer'
import AudioWaveform from '@/components/editor/AudioWaveform'
import Timeline from '@/components/editor/Timeline'
import MediaLibrary from '@/components/editor/MediaLibrary'
import ContextMenu from '@/components/editor/ContextMenu'
import { saveProject } from '@/lib/project-store'
import type { LutData } from '@/lib/lut-parser'

// Heavy panels — loaded on demand so the initial editor paint is fast
const Inspector     = dynamic(() => import('@/components/editor/Inspector'),     { ssr: false, loading: () => <div style={{ flex: 1, background: 'var(--bg-surface)' }} /> })
const ColorScopes   = dynamic(() => import('@/components/editor/ColorScopes'),   { ssr: false })
const RenderQueue   = dynamic(() => import('@/components/editor/RenderQueue'),   { ssr: false })
const ExportModal   = dynamic(() => import('@/components/editor/ExportModal'),   { ssr: false })
const StoryboardView = dynamic(() => import('@/components/editor/StoryboardView'), { ssr: false })
import {
  serialize, saveProjectToFile, openProjectFromFile, deserialize,
  type CfProjFile, type EditorSnapshot,
} from '@/lib/project-serializer'
import { writeAutosave, readAutosave, clearAutosave } from '@/lib/autosave'
import {
  DEFAULT_ADJUSTMENTS, DEFAULT_TRACKS,
  RULER_HEIGHT, TRACK_HEIGHT, TOOLBAR_HEIGHT, PIXELS_PER_SECOND,
  MODULE_DEFS, ALL_MODULE_KEYS,
  type ModuleKey,
} from '@/lib/editor-types'
import type { Caption, Clip, Output, ContentType, ChapterMarker } from '@/lib/types'
import type { TimelineItem, MediaItem, VideoAdjustments, Track, TransitionType } from '@/lib/editor-types'
import type { ContextMenuItem } from './ContextMenu'
import type { LibraryMediaItem } from '@/app/api/media/library/route'
import { useUpgradeModal } from '@/components/UpgradeModal'
import posthog from 'posthog-js'
import { interpolateFocusKF } from '@/lib/focus-utils'

const CLIP_COLORS = ['#2563eb', '#7c3aed', '#059669', '#d97706', '#dc2626', '#0891b2', '#9333ea']

function ShareButton({ projectId }: { projectId: string }) {
  const [state, setState] = useState<'idle' | 'loading' | 'copied'>('idle')
  const [shareUrl, setShareUrl] = useState<string | null>(null)

  async function handleShare() {
    if (shareUrl) {
      await navigator.clipboard.writeText(window.location.origin + shareUrl)
      setState('copied')
      setTimeout(() => setState('idle'), 2000)
      return
    }
    setState('loading')
    try {
      const res = await fetch(`/api/projects/${projectId}/share`, { method: 'POST' })
      const { url } = await res.json() as { url: string }
      setShareUrl(url)
      await navigator.clipboard.writeText(window.location.origin + url)
      setState('copied')
      setTimeout(() => setState('idle'), 2000)
    } catch {
      setState('idle')
    }
  }

  return (
    <button
      onClick={handleShare}
      disabled={state === 'loading'}
      className="flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium shrink-0"
      style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', color: state === 'copied' ? '#10b981' : 'var(--text-secondary)' }}
      title="Share — copy a read-only link"
    >
      {state === 'copied' ? <><CheckIcon size={11} /> Copied!</> : state === 'loading' ? <>…</> : <><Share2 size={11} /> Share</>}
    </button>
  )
}

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
  modules?: ModuleKey[]
  onModulesChange?: (modules: ModuleKey[]) => void
  onDataSaved?: (data: import('@/lib/project-serializer').CfProjFile) => void
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
    adjustments.saturation === 100 && adjustments.highlights === 0 &&
    (adjustments.vignette ?? 0) === 0 && (adjustments.shadows ?? 0) === 0 &&
    (adjustments.midtones ?? 0) === 0 && (adjustments.lift ?? 0) === 0 &&
    (adjustments.gamma ?? 100) === 100 && (adjustments.gain ?? 100) === 100

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
            <button onClick={() => onAdjustmentsChange({ ...DEFAULT_ADJUSTMENTS })}
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

function FairlightPage({
  tracks, timelineItems, currentTime, selectedId,
  onVolumeChange, onMuteToggle, onSoloToggle, onClipChange,
}: {
  tracks: Track[]
  timelineItems: TimelineItem[]
  currentTime: number
  selectedId: string | null
  onVolumeChange: (trackId: string, v: number) => void
  onMuteToggle: (trackId: string) => void
  onSoloToggle: (trackId: string) => void
  onClipChange: (id: string, patch: Partial<TimelineItem>) => void
}) {
  const audioTracks = tracks.filter(t => t.type === 'media' || t.type === 'video' || t.type === 'audio')

  const activeClipOnTrack = (trackId: string) =>
    timelineItems.find(i =>
      i.trackId === trackId && i.enabled !== false &&
      currentTime >= i.startTime && currentTime < i.startTime + (i.outPoint - i.inPoint)
    )

  const eqItem = timelineItems.find(i => i.id === selectedId) ?? null
  const eqTrackName = eqItem ? (tracks.find(t => t.id === eqItem.trackId)?.label ?? '') : ''

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: 'var(--bg-base)' }}>
      {/* Header */}
      <div style={{ padding: '0 16px', height: 36, borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', background: 'var(--bg-surface)', flexShrink: 0 }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Fairlight — Audio Mixer</span>
      </div>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Channel strips */}
        <div style={{ display: 'flex', gap: 2, padding: '16px 16px 16px 16px', overflowX: 'auto', flexShrink: 0, alignItems: 'flex-end', borderRight: '1px solid var(--border)' }}>
          {audioTracks.length === 0 && (
            <p style={{ fontSize: 12, color: 'var(--text-muted)', alignSelf: 'center', padding: '0 16px' }}>
              No media tracks — add clips to the timeline first.
            </p>
          )}
          {audioTracks.map(track => {
            const volume = track.volume ?? 1
            const dbLabel = volume <= 0 ? '−∞' : volume >= 0.995 ? '0.0' : `${(20 * Math.log10(volume)).toFixed(1)}`
            const activeClip = activeClipOnTrack(track.id)

            return (
              <div key={track.id} style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                width: 68, padding: '10px 6px 8px',
                background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 6,
                outline: activeClip ? '1.5px solid var(--accent)' : 'none',
              }}>
                {/* Track label */}
                <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {track.label}
                </span>

                {/* Active clip name */}
                <span style={{ fontSize: 8, color: activeClip ? 'var(--accent-light)' : 'transparent', maxWidth: 56, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', height: 10 }}>
                  {activeClip?.label ?? '·'}
                </span>

                {/* dB readout */}
                <span style={{ fontSize: 9, color: track.muted ? 'var(--text-muted)' : 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums', height: 12 }}>
                  {dbLabel} <span style={{ fontSize: 7 }}>dB</span>
                </span>

                {/* Vertical fader */}
                <div style={{ height: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', width: '100%', overflow: 'visible' }}>
                  <input
                    type="range" min={0} max={1} step={0.01} value={volume}
                    onChange={e => onVolumeChange(track.id, parseFloat(e.target.value))}
                    style={{
                      width: 96, position: 'absolute',
                      transform: 'rotate(-90deg)',
                      accentColor: track.muted ? '#555' : 'var(--accent)',
                      cursor: 'pointer',
                      opacity: track.muted ? 0.4 : 1,
                    }}
                  />
                </div>

                {/* Mute / Solo */}
                <div style={{ display: 'flex', gap: 3 }}>
                  <button
                    onClick={() => onMuteToggle(track.id)}
                    title="Mute"
                    style={{
                      width: 26, height: 18, fontSize: 8, fontWeight: 700, borderRadius: 3,
                      background: track.muted ? '#dc2626' : 'var(--bg-card)',
                      color: track.muted ? '#fff' : 'var(--text-muted)',
                      border: `1px solid ${track.muted ? '#dc2626' : 'var(--border)'}`,
                      cursor: 'pointer',
                    }}
                  >M</button>
                  <button
                    onClick={() => onSoloToggle(track.id)}
                    title="Solo"
                    style={{
                      width: 26, height: 18, fontSize: 8, fontWeight: 700, borderRadius: 3,
                      background: track.solo ? '#d97706' : 'var(--bg-card)',
                      color: track.solo ? '#fff' : 'var(--text-muted)',
                      border: `1px solid ${track.solo ? '#d97706' : 'var(--border)'}`,
                      cursor: 'pointer',
                    }}
                  >S</button>
                </div>
              </div>
            )
          })}
        </div>

        {/* EQ + Inspector panel */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
          {eqItem ? (
            <>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 16 }}>
                EQ — {eqTrackName && <span style={{ color: 'var(--accent-light)', marginRight: 4 }}>{eqTrackName}</span>}{eqItem.label}
              </div>

              {/* 3-band EQ sliders */}
              <div style={{ display: 'flex', gap: 32, marginBottom: 24 }}>
                {(['low', 'mid', 'high'] as const).map(band => {
                  const val = eqItem.eq?.[band] ?? 0
                  const color = val > 0 ? '#4ade80' : val < 0 ? '#f87171' : 'var(--text-muted)'
                  return (
                    <div key={band} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, minWidth: 100 }}>
                      <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{band}</span>
                      <input
                        type="range" min={-12} max={12} step={0.5} value={val}
                        onChange={e => {
                          const v = parseFloat(e.target.value)
                          onClipChange(eqItem.id, { eq: { low: 0, mid: 0, high: 0, ...(eqItem.eq ?? {}), [band]: v } })
                        }}
                        style={{ width: 100, accentColor: val !== 0 ? (val > 0 ? '#4ade80' : '#f87171') : 'var(--accent)', cursor: 'pointer' }}
                      />
                      {/* +/- bar */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 10, fontWeight: 600, color, fontVariantNumeric: 'tabular-nums', minWidth: 48, textAlign: 'center' }}>
                          {val > 0 ? '+' : ''}{val.toFixed(1)} dB
                        </span>
                        {val !== 0 && (
                          <button
                            onClick={() => onClipChange(eqItem.id, { eq: { low: 0, mid: 0, high: 0, ...(eqItem.eq ?? {}), [band]: 0 } })}
                            style={{ fontSize: 8, color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                            title="Reset"
                          >✕</button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Divider */}
              <div style={{ height: 1, background: 'var(--border)', marginBottom: 16 }} />

              {/* Clip info */}
              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                <div>Start: <span style={{ color: 'var(--text-secondary)' }}>{eqItem.startTime.toFixed(2)}s</span></div>
                <div>Duration: <span style={{ color: 'var(--text-secondary)' }}>{(eqItem.outPoint - eqItem.inPoint).toFixed(2)}s</span></div>
              </div>
            </>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 8 }}>
              <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Select a clip to edit its EQ</p>
              <p style={{ fontSize: 10, color: 'var(--text-muted)', opacity: 0.6 }}>Click any clip in the timeline, then switch to this tab</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function VideoEditor({
  projectId, projectName, videoUrl, captions: propCaptions, clips, outputs: propOutputs, modules: modulesProp,
  contentType: propContentType, allowImport, onModulesChange, onDataSaved,
}: Props) {
  const router        = useRouter()
  const pathname      = usePathname()
  const { user }      = useUser()

  function ownerUsername() {
    return user?.username ?? user?.emailAddresses[0]?.emailAddress.split('@')[0] ?? null
  }

  function navigateToProject(slug: string, username?: string | null) {
    const uname = username ?? ownerUsername()
    if (uname && slug) router.replace(`/${uname}/${slug}`)
  }

  const videoRef      = useRef<HTMLVideoElement | null>(null)
  // Captures sync wall-time at the exact moment onTimeUpdate fires (before React re-render latency).
  // Passed to Timeline so its RAF tick doesn't drift between timeupdate events.
  const tlSyncRef     = useRef<{ time: number; wall: number }>({ time: 0, wall: performance.now() })
  // Focus motion recording: buffer fills on pointer-move during playback, committed on pointer-up
  const focusRecordingRef    = useRef(false)
  const focusBufferRef       = useRef<Array<{ time: number; x: number; y: number }>>([])
  const lastFocusKfTimeRef   = useRef(0)
  const { padTrafficLights: isElectronMac } = useElectronChrome()

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
  const mediaItemsRef = useRef<MediaItem[]>([])
  const [selectedMediaId, setSelectedMediaId] = useState<string | null>(null)

  useEffect(() => { mediaItemsRef.current = mediaItems }, [mediaItems])

  // Color adjustments
  const [adjustments, setAdjustments] = useState<VideoAdjustments>(DEFAULT_ADJUSTMENTS)

  // Context menu
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null)

  // Transcription
  const [importedFile, setImportedFile] = useState<File | null>(null)
  const [localProjectName, setLocalProjectName] = useState(projectName)
  const [editingName, setEditingName] = useState(false)
  const [nameInput, setNameInput] = useState(projectName)
  const [activeModules, setActiveModules] = useState<ModuleKey[]>(() => modulesProp ?? ALL_MODULE_KEYS)
  const [showModulesMenu, setShowModulesMenu] = useState(false)
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
  // Suppress dirty-tracking while loadCfproj is applying state changes
  const isLoadingRef = useRef(false)

  // Save state
  const fileHandleRef      = useRef<FileSystemFileHandle | undefined>(undefined)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [showSaveMenu, setShowSaveMenu] = useState(false)
  const savedStatusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [isDirty, setIsDirty] = useState(false)
  const autoSaveTimerRef        = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cloudAutoSaveTimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveToCloudRef          = useRef<() => Promise<void>>(async () => {})
  const cloudAutoSaveFnRef      = useRef<() => Promise<void>>(async () => {})
  // Holds the cloud autosave received in the project GET response, checked after mount
  const pendingCloudAutosaveRef = useRef<CfProjFile | null>(null)
  // LUT functions loaded on-demand when the first .cube file is imported
  const lutFnsRef = useRef<{
    parseCube: (t: string) => LutData
    applyLutToCanvas: (ctx: CanvasRenderingContext2D, lut: LutData, w: number, h: number) => void
  } | null>(null)

  // Recovery state — set when a more-recent autosave is found on mount
  const [recovery, setRecovery] = useState<{ cfproj: CfProjFile; at: Date; source: 'local' | 'cloud' } | null>(null)
  const [showExport, setShowExport] = useState(false)
  const [showShortcuts, setShowShortcuts] = useState(false)

  // Viewport layout
  const [viewportTab, setViewportTab] = useState<'video' | 'audio'>('video')
  const [audioLayout, setAudioLayout] = useState<'tab' | 'below'>('tab')
  const [audioSplitH, setAudioSplitH] = useState(160)

  // Edit tool state
  const [silenceTrimStatus, setSilenceTrimStatus] = useState<'idle' | 'working' | 'done' | 'error'>('idle')
  const [silenceThreshold, setSilenceThreshold] = useState(0.5)

  // Playback speed
  const [playbackRate, setPlaybackRate] = useState(1)

  // Before/after color compare
  const [showOriginal, setShowOriginal] = useState(false)

  // Viewer overlays
  const [showSafeAreas, setShowSafeAreas] = useState(false)
  const [aspectGuide, setAspectGuide] = useState<'none' | '9:16' | '1:1' | '4:5' | '2.35:1'>('none')
  const [viewerZoom, setViewerZoom] = useState(1)
  const [showStoryboard, setShowStoryboard] = useState(false)
  const [showVUMeter, setShowVUMeter] = useState(false)
  const [frameBlendEnabled, setFrameBlendEnabled] = useState(false)
  const [opticalFlowEnabled, setOpticalFlowEnabled] = useState(false)
  const [motionBlurGlobal, setMotionBlurGlobal] = useState(false)
  const [showColorScopes, setShowColorScopes] = useState(false)
  const [colorScopesType, setColorScopesType] = useState<'waveform' | 'vectorscope' | 'histogram' | 'parade' | 'spectrum'>('waveform')
  const [showRenderQueue, setShowRenderQueue] = useState(false)
  const [audioDuckingEnabled, setAudioDuckingEnabled] = useState(false)

  // Audio ducking: analyzes primary track, reduces volume on music tracks under dialogue
  const duckingRafRef    = useRef<number | null>(null)
  const duckingCtxRef    = useRef<AudioContext | null>(null)
  const duckingSourceRef = useRef<MediaElementAudioSourceNode | null>(null)
  const duckingAnalyser  = useRef<AnalyserNode | null>(null)
  const duckingGainRef   = useRef<GainNode | null>(null)

  useEffect(() => {
    if (!audioDuckingEnabled) {
      if (duckingRafRef.current !== null) { cancelAnimationFrame(duckingRafRef.current); duckingRafRef.current = null }
      return
    }
    const v = videoRef.current
    if (!v) return

    try {
      if (!duckingCtxRef.current) duckingCtxRef.current = new AudioContext()
      const ctx = duckingCtxRef.current
      if (!duckingSourceRef.current) {
        const src = ctx.createMediaElementSource(v)
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 256
        const gain = ctx.createGain()
        src.connect(analyser).connect(gain).connect(ctx.destination)
        duckingSourceRef.current = src
        duckingAnalyser.current  = analyser
        duckingGainRef.current   = gain
      }

      const buf = new Uint8Array(duckingAnalyser.current!.frequencyBinCount)
      function tick() {
        duckingAnalyser.current!.getByteTimeDomainData(buf)
        // RMS level of primary clip audio
        let sum = 0
        for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v }
        const rms = Math.sqrt(sum / buf.length)
        // Duck: reduce gain when RMS > 0.05 (dialogue threshold)
        const target = rms > 0.05 ? 0.3 : 1.0
        const current = duckingGainRef.current!.gain.value
        duckingGainRef.current!.gain.value = current + (target - current) * 0.05 // smooth 50ms RC
        duckingRafRef.current = requestAnimationFrame(tick)
      }
      duckingRafRef.current = requestAnimationFrame(tick)
    } catch { /* blocked before user gesture */ }

    return () => {
      if (duckingRafRef.current !== null) { cancelAnimationFrame(duckingRafRef.current); duckingRafRef.current = null }
    }
  }, [audioDuckingEnabled]) // eslint-disable-line

  // LUT data keyed by MediaItem id
  const [lutMap, setLutMap] = useState<Map<string, LutData>>(new Map())

  // EQ — Web Audio chain per active clip (low/mid/high BiquadFilter + GainNode)
  const eqCtxRef    = useRef<AudioContext | null>(null)
  const eqSourceRef = useRef<MediaElementAudioSourceNode | null>(null)
  const eqNodesRef  = useRef<{ low: BiquadFilterNode; mid: BiquadFilterNode; high: BiquadFilterNode; gain: GainNode } | null>(null)
  const eqSrcIdRef  = useRef<string | null>(null)  // tracks which clip the EQ chain was built for

  // Multi-select
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  // Chapter markers
  const [chapters, setChapters] = useState<ChapterMarker[]>([])


  // Internal clipboard for copy/paste within the editor
  const clipboardRef = useRef<TimelineItem | null>(null)

  function handleSelectItem(id: string | null) {
    setSelectedId(id)
    setSelectedIds(new Set())   // single click always clears multi-select
  }

  const selectedItem = timelineItems.find(i => i.id === selectedId) ?? null
  const selectedMedia = mediaItems.find(m => m.id === selectedMediaId) ?? null
  const isAudioOnly = mediaItems.length > 0 && mediaItems.every(m => m.contentType === 'audio')
  const hasVideo      = activeModules.includes('video')
  const hasAudio      = activeModules.includes('audio')
  const hasStoryboard = (activeModules as string[]).includes('storyboard')

  // Interpolate speed from a clip's velocity curve keyframes
  function interpSpeedRamp(points: Array<{ t: number; speed: number }>, t: number): number {
    if (!points.length) return 1
    const sorted = [...points].sort((a, b) => a.t - b.t)
    if (t <= sorted[0].t) return sorted[0].speed
    if (t >= sorted[sorted.length - 1].t) return sorted[sorted.length - 1].speed
    for (let i = 0; i < sorted.length - 1; i++) {
      if (t >= sorted[i].t && t <= sorted[i + 1].t) {
        const frac = (t - sorted[i].t) / (sorted[i + 1].t - sorted[i].t)
        // Smooth-step (cubic) interpolation for the velocity ease
        const smooth = frac * frac * (3 - 2 * frac)
        return sorted[i].speed + (sorted[i + 1].speed - sorted[i].speed) * smooth
      }
    }
    return 1
  }

  // Viewer is a pure timeline monitor — shows the enabled clip at the playhead.
  // Respects mute/solo: muted tracks are skipped; when any track is soloed, only
  // solo tracks play.
  const viewerClip = useMemo(() => {
    const hasSolo = tracks.some(t => (t.type === 'media' || t.type === 'video' || t.type === 'audio') && t.solo)
    const mediaTracks = tracks.filter(t =>
      (t.type === 'media' || t.type === 'video' || t.type === 'audio') &&
      !t.muted &&
      (!hasSolo || t.solo)
    )
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

  // Real-time speed: interpolates velocity curve if the clip has speedPoints
  const rampSpeed = useMemo(() => {
    const clip = viewerClip
    if (!clip) return playbackRate
    const baseSpeed = clip.speed ?? 1
    if (!clip.speedPoints?.length) return baseSpeed * playbackRate
    const clipDur = clip.outPoint - clip.inPoint
    if (clipDur <= 0) return baseSpeed
    const localT = Math.max(0, Math.min(1, (currentTime - clip.startTime) / clipDur))
    return interpSpeedRamp(clip.speedPoints, localT) * baseSpeed
  }, [viewerClip?.id, viewerClip?.speedPoints, viewerClip?.speed, currentTime, playbackRate]) // eslint-disable-line

  // Apply track volume when the active clip changes
  useEffect(() => {
    const v = videoRef.current
    if (!v || !viewerClip) return
    const track = tracks.find(t => t.id === viewerClip.trackId)
    v.volume = Math.max(0, Math.min(1, track?.volume ?? 1))
  }, [viewerClip?.id, tracks]) // eslint-disable-line

  // Apply per-clip playback speed (and velocity ramp) to the video element
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    v.playbackRate = rampSpeed
  }, [rampSpeed])

  // Per-clip EQ via Web Audio API
  useEffect(() => {
    const v = videoRef.current
    const clip = viewerClip
    const eq = clip?.eq

    // Tear down chain if no EQ or clip changed
    if (!eq || !clip || !v) {
      eqNodesRef.current?.gain.disconnect()
      eqNodesRef.current = null
      eqSourceRef.current?.disconnect()
      eqSourceRef.current = null
      eqSrcIdRef.current = null
      return
    }

    try {
      // Create AudioContext lazily
      if (!eqCtxRef.current) eqCtxRef.current = new AudioContext()
      const ctx = eqCtxRef.current

      // Rebuild chain when clip changes
      if (eqSrcIdRef.current !== clip.id) {
        eqNodesRef.current?.gain.disconnect()
        eqSourceRef.current?.disconnect()
        const src = ctx.createMediaElementSource(v)
        const low  = ctx.createBiquadFilter(); low.type  = 'lowshelf';  low.frequency.value  = 200
        const mid  = ctx.createBiquadFilter(); mid.type  = 'peaking';   mid.frequency.value  = 1000; mid.Q.value = 1
        const high = ctx.createBiquadFilter(); high.type = 'highshelf'; high.frequency.value = 6000
        const gain = ctx.createGain()
        src.connect(low).connect(mid).connect(high).connect(gain).connect(ctx.destination)
        eqSourceRef.current = src
        eqNodesRef.current  = { low, mid, high, gain }
        eqSrcIdRef.current  = clip.id
      }

      // Update filter gains
      const nodes = eqNodesRef.current
      if (nodes) {
        nodes.low.gain.value  = eq.low
        nodes.mid.gain.value  = eq.mid
        nodes.high.gain.value = eq.high
      }
    } catch { /* AudioContext may be blocked before user interaction */ }
  }, [viewerClip?.id, viewerClip?.eq]) // eslint-disable-line

  // LUT — apply color lookup table to video frames via OffscreenCanvas
  const lutCanvasRef  = useRef<OffscreenCanvas | null>(null)
  const lutRvfcRef    = useRef<number | null>(null)
  const lutRafRef     = useRef<number | null>(null)

  useEffect(() => {
    const clip = viewerClip
    const lut  = clip?.lutId ? lutMap.get(clip.lutId) : null
    const v    = videoRef.current

    // Cancel any previous LUT rVFC loop
    const cancelLut = () => {
      if (lutRvfcRef.current !== null && v) {
        (v as any).cancelVideoFrameCallback?.(lutRvfcRef.current)
        lutRvfcRef.current = null
      }
      if (lutRafRef.current !== null) { cancelAnimationFrame(lutRafRef.current); lutRafRef.current = null }
      lutCanvasRef.current = null
    }

    if (!lut || !v || !clip || clip.contentType !== 'video') { cancelLut(); return }

    function processFrame() {
      if (!v || !lut) return
      const vw = v.videoWidth, vh = v.videoHeight
      if (vw === 0 || vh === 0) { schedule(); return }
      if (!lutCanvasRef.current || lutCanvasRef.current.width !== vw || lutCanvasRef.current.height !== vh) {
        lutCanvasRef.current = new OffscreenCanvas(vw, vh)
      }
      const ctx = lutCanvasRef.current.getContext('2d') as OffscreenCanvasRenderingContext2D | null
      if (!ctx) { schedule(); return }
      ctx.drawImage(v, 0, 0, vw, vh)
      lutFnsRef.current?.applyLutToCanvas(ctx as unknown as CanvasRenderingContext2D, lut, vw, vh)
      schedule()
    }

    function schedule() {
      if ((v as any).requestVideoFrameCallback) {
        lutRvfcRef.current = (v as any).requestVideoFrameCallback(processFrame)
      } else {
        lutRafRef.current = requestAnimationFrame(processFrame)
      }
    }
    schedule()
    return cancelLut
  }, [viewerClip?.id, viewerClip?.lutId, lutMap]) // eslint-disable-line

  // Clip transform: opacity, flip, crop, zoom, and fade envelope from current playhead
  const clipTransform = useMemo(() => {
    if (!viewerClip) return undefined
    const clip = viewerClip
    const clipDur = clip.outPoint - clip.inPoint
    const clipLocalTime = currentTime - clip.startTime
    let fadeOpacity = 1
    if (clip.fadeIn && clip.fadeIn > 0 && clipLocalTime < clip.fadeIn) {
      fadeOpacity = Math.min(1, clipLocalTime / clip.fadeIn)
    }
    if (clip.fadeOut && clip.fadeOut > 0 && clipLocalTime > clipDur - clip.fadeOut) {
      fadeOpacity = Math.min(fadeOpacity, Math.min(1, (clipDur - clipLocalTime) / clip.fadeOut))
    }
    // Ken Burns: animate cropZoom/cropX/cropY over the clip's duration
    let cropZoom = clip.cropZoom ?? 100
    let cropX    = clip.cropX ?? 0
    let cropY    = clip.cropY ?? 0
    if (clip.kenBurns && clipDur > 0) {
      const t = Math.max(0, Math.min(1, clipLocalTime / clipDur))
      const s = t * t * (3 - 2 * t)  // smooth-step
      const kb = clip.kenBurns
      cropZoom = kb.fromZoom + (kb.toZoom - kb.fromZoom) * s
      cropX    = kb.fromX   + (kb.toX   - kb.fromX)   * s
      cropY    = kb.fromY   + (kb.toY   - kb.fromY)   * s
    }

    return {
      opacity: clip.opacity ?? 100,
      flipH: clip.flipH ?? false,
      flipV: clip.flipV ?? false,
      cropZoom, cropX, cropY,
      fadeOpacity,
    }
  }, [viewerClip?.id, viewerClip?.opacity, viewerClip?.flipH, viewerClip?.flipV, // eslint-disable-line
      viewerClip?.cropZoom, viewerClip?.cropX, viewerClip?.cropY,
      viewerClip?.fadeIn, viewerClip?.fadeOut, viewerClip?.kenBurns, currentTime]) // eslint-disable-line

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
    // Otherwise fetch directly from the API (normal cloud-saved project).
    // The response may include _cloudAutosave if a newer autosave exists.
    fetch(`/api/projects/${projectId}`)
      .then(async r => {
        if (!r.ok) return
        const raw = await r.json() as CfProjFile & { _cloudAutosave?: CfProjFile }
        const { _cloudAutosave, ...project } = raw
        if (_cloudAutosave) pendingCloudAutosaveRef.current = _cloudAutosave
        loadCfproj(JSON.stringify(project))
      })
      .catch(() => {})
      .finally(() => setIsLoadingProject(false))
  }, []) // eslint-disable-line

  async function loadCfproj(raw: string) {
    // Block dirty-tracking while we apply the loaded state so that
    // loading itself doesn't get treated as unsaved user changes.
    isLoadingRef.current = true
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
      setChapters(loaded.chapters ?? [])
      setMediaItems(resolvedMedia)
      setActiveModules(cfproj.modules ?? ALL_MODULE_KEYS)
      resetHistory({ timelineItems: patchedItems, tracks: loadedTracks, adjustments: DEFAULT_ADJUSTMENTS, captions: loaded.captions })

      // ── Recovery check ────────────────────────────────────────
      // Show recovery only when the autosave is NEWER than the loaded
      // project. This prevents spurious banners caused by the load itself.
      const projectSavedAt = cfproj.savedAt ? new Date(cfproj.savedAt).getTime() : 0
      const localSaved = readAutosave(savedProjectId)
      const cloudSaved = pendingCloudAutosaveRef.current   // set by the fetch before loadCfproj is called
      const localAt  = localSaved?.savedAt  ? new Date(localSaved.savedAt).getTime()  : 0
      const cloudAt  = cloudSaved?.savedAt  ? new Date(cloudSaved.savedAt).getTime()  : 0

      if (cloudAt > projectSavedAt && cloudSaved) {
        setRecovery({ cfproj: cloudSaved, at: new Date(cloudAt), source: 'cloud' })
      } else if (localAt > projectSavedAt && localSaved) {
        setRecovery({ cfproj: localSaved, at: new Date(localAt), source: 'local' })
      } else {
        // Autosave is not newer — discard it so it can't resurface later
        clearAutosave(savedProjectId)
      }
    } catch {
      // Silently ignore corrupt/unreadable project
    } finally {
      setIsLoadingProject(false)
    }
    // Clear the loading guard AFTER React has committed the state changes
    // and run effects. setTimeout(0) fires in the next macrotask, after
    // React's synchronous effect queue for this render is complete.
    setTimeout(() => { isLoadingRef.current = false }, 0)
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

  // Recovery check is now inside loadCfproj, which runs after the project
  // data is available and can compare timestamps properly.

  // ── Dirty tracking + auto-save ─────────────────────────────
  // Sets the dirty flag and debounces a localStorage snapshot 5 s after the
  // last change. The snapshot is cleared on any successful manual save.
  const hasMountedRef = useRef(false)
  useEffect(() => {
    if (!hasMountedRef.current) { hasMountedRef.current = true; return }
    if (isLoadingRef.current) return  // project load is applying state — not a user change

    setIsDirty(true)

    const snapshot = buildSnapshot()   // captures current state right now
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
    autoSaveTimerRef.current = setTimeout(() => {
      writeAutosave(savedProjectId, serialize(snapshot))
    }, 5000)

    // Cloud auto-save: 30 s after last change, writes to autosave_data column
    // (separate from the manually-saved data column).
    const name = localProjectName.trim()
    if (name && name !== 'New Project' && projectId) {
      if (cloudAutoSaveTimerRef.current) clearTimeout(cloudAutoSaveTimerRef.current)
      cloudAutoSaveTimerRef.current = setTimeout(() => {
        cloudAutoSaveFnRef.current()
      }, 30_000)
    }
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

  // When a clip is extended past its source duration, pass loopDuration so
  // VideoPlayer can loop the video seamlessly instead of stopping at end.
  const viewerLoopDuration = useMemo(() => {
    if (!viewerClip) return undefined
    const srcDur = mediaItems.find(m => m.url === viewerClip.url)?.duration
    if (!srcDur) return undefined
    // Loop cycle = inPoint→srcDur (not 0→srcDur); use the actual playable length per cycle
    const loopCycleDur = srcDur - viewerClip.inPoint
    const clipDur = viewerClip.outPoint - viewerClip.inPoint
    return clipDur > loopCycleDur && loopCycleDur > 0 ? loopCycleDur : undefined
  }, [viewerClip?.id, viewerClip?.outPoint, viewerClip?.inPoint, mediaItems]) // eslint-disable-line

  const selectedDrawFocusItem = useMemo(() => {
    const item = timelineItems.find(i => i.id === selectedId)
    if (!item) return null
    const track = tracks.find(t => t.id === item.trackId)
    return track?.type === 'drawfocus' ? item : null
  }, [selectedId, timelineItems, tracks])

  // Draw Focus overlay — interpolates keyframes when present, falls back to static focusX/Y.
  // Priority 1: selected focus clip. Priority 2: any clip the playhead is inside.
  const activeFocusClip = useMemo(() => {
    const getFocusPos = (clip: typeof timelineItems[0]) => {
      const kf = clip.focusKeyframes
      if (kf && kf.length > 0) return interpolateFocusKF(kf, currentTime - clip.startTime)
      return { x: clip.focusX ?? 0.5, y: clip.focusY ?? 0.5 }
    }
    if (selectedDrawFocusItem) {
      return getFocusPos(selectedDrawFocusItem)
    }
    for (const track of tracks) {
      if (track.type !== 'drawfocus') continue
      const hit = timelineItems.find(i =>
        i.trackId === track.id &&
        i.enabled !== false &&
        currentTime >= i.startTime &&
        currentTime < i.startTime + (i.outPoint - i.inPoint)
      )
      if (hit) return getFocusPos(hit)
    }
    return undefined
  }, [selectedDrawFocusItem, timelineItems, tracks, currentTime])

  function handleSetFocusPoint(x: number, y: number) {
    if (!selectedDrawFocusItem) return
    if (focusRecordingRef.current) {
      // Throttle by wall clock so we record at ~30fps regardless of timeupdate rate
      const wallNow = performance.now()
      if (wallNow - lastFocusKfTimeRef.current < 1000 / 30) return
      lastFocusKfTimeRef.current = wallNow
      // Derive accurate timeline time from the sync anchor + elapsed wall time
      const liveTime = tlSyncRef.current.time +
        (wallNow - tlSyncRef.current.wall) / 1000 * playbackRate
      focusBufferRef.current.push({ time: liveTime - selectedDrawFocusItem.startTime, x, y })
    } else {
      // Paused — update static position
      handleClipChange(selectedDrawFocusItem.id, { focusX: x, focusY: y })
    }
  }

  function handleFocusRecordStart() {
    if (!isPlaying || !selectedDrawFocusItem) return
    focusRecordingRef.current = true
    focusBufferRef.current = []
    lastFocusKfTimeRef.current = 0  // 0 ensures first keyframe is captured immediately
  }

  function handleFocusRecordEnd() {
    if (!focusRecordingRef.current) return
    focusRecordingRef.current = false
    const buffer = focusBufferRef.current
    focusBufferRef.current = []
    if (buffer.length === 0 || !selectedDrawFocusItem) return
    // Merge: replace keyframes in the recorded time range, keep those outside it
    const rangeStart = buffer[0].time
    const rangeEnd   = buffer[buffer.length - 1].time
    const existing   = selectedDrawFocusItem.focusKeyframes ?? []
    const outside    = existing.filter(k => k.time < rangeStart || k.time > rangeEnd)
    const merged     = [...outside, ...buffer].sort((a, b) => a.time - b.time)
    handleClipChange(selectedDrawFocusItem.id, { focusKeyframes: merged })
  }

  const isRecordingFocus = isPlaying && selectedDrawFocusItem !== null

  function handleFocusKeyframeMove(index: number, x: number, y: number) {
    if (!selectedDrawFocusItem?.focusKeyframes) return
    handleClipChange(selectedDrawFocusItem.id, {
      focusKeyframes: selectedDrawFocusItem.focusKeyframes.map((k, i) =>
        i === index ? { ...k, x, y } : k
      ),
    })
  }

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

      // Space = play/pause (works with or without media loaded)
      if (e.code === 'Space') {
        e.preventDefault()
        setIsPlaying(p => !p)
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

      // Delete / Backspace — supports single or multi-select
      if ((e.key === 'Delete' || e.key === 'Backspace') && (selectedId || selectedIds.size > 0)) {
        e.preventDefault()
        if (selectedIds.size > 1) {
          setTimelineItems(p => p.filter(i => !selectedIds.has(i.id)))
          setSelectedIds(new Set())
          setSelectedId(null)
        } else if (selectedId) {
          if (e.shiftKey) {
            handleRippleDelete(selectedId)
          } else {
            setTimelineItems(p => p.filter(i => i.id !== selectedId))
            setSelectedId(null)
          }
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
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [selectedId, isPlaying, timelineItems])  // eslint-disable-line — currentTime excluded intentionally: all reads use functional setCurrentTime

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

  // Captures the exact wall-clock moment the video fires timeupdate so Timeline's RAF
  // interpolation doesn't drift due to React re-render latency (~16ms per frame).
  const handleTimeUpdate = useCallback((t: number) => {
    tlSyncRef.current = { time: t, wall: performance.now() }
    setCurrentTime(t)
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

  async function computeAudioPeaks(url: string): Promise<number[]> {
    try {
      const arrayBuffer = await fetch(url).then(r => r.arrayBuffer())
      const offCtx = new OfflineAudioContext(1, 1, 44100)
      const decoded = await offCtx.decodeAudioData(arrayBuffer)
      const data = decoded.getChannelData(0)
      const bands = 80, step = Math.floor(data.length / bands)
      return Array.from({ length: bands }, (_, i) => {
        let max = 0
        for (let j = 0; j < step; j++) max = Math.max(max, Math.abs(data[i * step + j] ?? 0))
        return max
      })
    } catch { return [] }
  }

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
    // .cube LUT files — parse and store in lutMap, add to media pool as 'lut' type
    if (file.name.toLowerCase().endsWith('.cube')) {
      const id = crypto.randomUUID()
      file.text().then(async text => {
        try {
          if (!lutFnsRef.current) {
            const mod = await import('@/lib/lut-parser')
            lutFnsRef.current = { parseCube: mod.parseCube, applyLutToCanvas: mod.applyLutToCanvas }
          }
          const lut = lutFnsRef.current.parseCube(text)
          setLutMap(prev => new Map(prev).set(id, lut))
          setMediaItems(prev => [...prev, { id, name: file.name, contentType: 'lut', file }])
        } catch (err) {
          console.warn('LUT parse error:', err)
        }
      })
      return
    }

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
    setViewportTab(ct === 'audio' ? 'audio' : 'video')

    // Probe duration (fast for local blob URLs) and update the pool entry
    readDuration(url, ct).then((dur) => {
      setMediaItems(prev => prev.map(m => m.id === id ? { ...m, duration: dur } : m))
    })

    // Capture first frame as thumbnail for video files
    if (ct === 'video') {
      generateVideoThumbnail(url).then((thumbnail) => {
        if (!thumbnail) return
        setMediaItems(prev => prev.map(m => m.id === id ? { ...m, thumbnail } : m))
        // Update library entry if already uploaded
        const item = mediaItemsRef.current.find(m => m.id === id)
        if (item?.r2Key) {
          fetch('/api/media/library', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, name: item.name, contentType: file.type, duration: item.duration ?? 0, r2Key: item.r2Key, thumbnail }),
          }).catch(() => {})
        }
      })
    }

    // Compute audio peak waveform in background (used by Timeline mini waveform)
    if (ct === 'audio') {
      computeAudioPeaks(url).then(peaks => {
        if (peaks.length) setMediaItems(prev => prev.map(m => m.id === id ? { ...m, peaks } : m))
      })
    }

    // Upload to R2 in the background — blob URL stays usable for this session
    uploadMediaToR2(file, id)
  }

  async function uploadMediaToR2(file: File, mediaId: string) {
    // Some browsers return empty type for formats like .mkv or .avi;
    // the presign route guesses from the extension when contentType is empty.
    const contentType = file.type || ''
    try {
      const presignRes = await fetch('/api/media/presign-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, contentType, mediaId, size: file.size }),
      })
      if (!presignRes.ok) {
        const err = await presignRes.json().catch(() => ({})) as { error?: string }
        const msg = presignRes.status === 413
          ? 'File is too large. Maximum size is 500 MB.'
          : (err.error ?? `Upload rejected (${presignRes.status})`)
        setMediaItems(prev => prev.map(m => m.id === mediaId ? { ...m, uploadStatus: 'error' } : m))
        setTranscribeError(msg)
        return
      }
      const { uploadUrl, key } = await presignRes.json() as { uploadUrl: string; key: string }

      // PUT directly to R2 via presigned URL. If your R2 bucket has no CORS
      // policy, this PUT may fail — add a CORS rule in the Cloudflare dashboard
      // allowing PUT from your app's origin.
      const putRes = await fetch(uploadUrl, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': contentType || 'application/octet-stream' },
      })
      if (!putRes.ok) throw new Error(`R2 upload failed (${putRes.status})`)

      setMediaItems(prev => prev.map(m =>
        m.id === mediaId ? { ...m, r2Key: key, uploadStatus: 'uploaded' } : m
      ))

      // Register in account media library so other projects can reuse this file
      const item = mediaItemsRef.current.find(m => m.id === mediaId)
      fetch('/api/media/library', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: mediaId,
          name: item?.name ?? file.name,
          contentType: contentType || file.type,
          duration: item?.duration ?? 0,
          r2Key: key,
          thumbnail: item?.thumbnail ?? null,
        }),
      }).catch(() => {})
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Upload failed'
      setMediaItems(prev => prev.map(m => m.id === mediaId ? { ...m, uploadStatus: 'error' } : m))
      // Surface a brief note if the error looks like a CORS/network block
      if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('CORS')) {
        setTranscribeError('Upload blocked — configure R2 CORS to allow PUT from this origin, or contact support.')
      } else {
        setTranscribeError(msg)
      }
    }
  }

  async function handleAddFromLibrary(lib: LibraryMediaItem) {
    // Check if already in this project's media pool
    if (mediaItems.some(m => m.id === lib.id)) return
    // Fetch a signed URL for the R2 file — no re-upload needed
    const res = await fetch(`/api/media/signed-url?key=${encodeURIComponent(lib.r2Key)}`)
    if (!res.ok) return
    const { url } = await res.json() as { url: string }
    const ct: import('@/lib/editor-types').MediaItem['contentType'] = lib.contentType.startsWith('video') ? 'video' : 'audio'
    setMediaItems(prev => [...prev, {
      id: lib.id, name: lib.name, contentType: ct, url,
      duration: lib.duration, thumbnail: lib.thumbnail ?? undefined,
      r2Key: lib.r2Key, uploadStatus: 'uploaded',
    }])
    setSelectedMediaId(lib.id)
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

  function handleAddTrack(type?: string) {
    if (type === 'drawfocus') {
      const n = tracks.filter(t => t.type === 'drawfocus').length + 1
      const id = `df${n}`
      setTracksWithHistory(prev => [
        ...prev.filter(t => t.type !== 'caption'),
        { id, label: `Focus ${n}`, type: 'drawfocus' as const, height: TRACK_HEIGHT },
      ])
      setTlHeight(h => Math.min(MAX_TL, h + TRACK_HEIGHT))
      return
    }
    const mediaTracks = tracks.filter(t => t.type === 'media' || t.type === 'video' || t.type === 'audio')
    const n = mediaTracks.length + 1
    const id = `m${n}`
    setTracksWithHistory(prev => [...prev.filter(t => t.type !== 'caption'), { id, label: `M${n}`, type: 'media', height: TRACK_HEIGHT }])
    setTlHeight(h => Math.min(MAX_TL, h + TRACK_HEIGHT))
  }

  function handleCreateFocusClip(trackId: string, startTime: number, duration: number) {
    const n = timelineItems.filter(i => {
      const t = tracks.find(tr => tr.id === i.trackId)
      return t?.type === 'drawfocus'
    }).length + 1
    const newItem: TimelineItem = {
      id: `df-${Date.now()}`,
      trackId,
      startTime,
      inPoint: 0,
      outPoint: duration,
      label: `Focus ${n}`,
      color: '#a78bfa',
      captions: [],
      enabled: true,
      focusX: 0.5,
      focusY: 0.5,
      focusRadius: 0.2,
    }
    setTimelineItems(prev => [...prev, newItem])
    setSelectedId(newItem.id)
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
    setTranscribeProgress(101)
    setTranscribeError('')
    if (typeof window !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {})
    }

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
      if (typeof window !== 'undefined' && Notification.permission === 'granted') {
        new Notification('Transcription complete', { body: `${out.wordCount?.toLocaleString()} words ready in ${localProjectName}`, icon: '/favicon.ico' })
      }
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
      chapters,
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
    setChapters(loaded.chapters ?? [])
    resetHistory({ timelineItems: loaded.timelineItems, tracks: loadedTracks, adjustments: DEFAULT_ADJUSTMENTS, captions: loaded.captions })
    // Cloud autosave: clear it now that we've loaded it (manual save will write fresh data)
    if (recovery.source === 'cloud' && projectId) {
      fetch(`/api/projects/${projectId}/autosave`, { method: 'DELETE' }).catch(() => {})
    }
    setRecovery(null)
    setIsDirty(true)
  }

  function handleDismissRecovery() {
    if (recovery?.source === 'cloud' && projectId) {
      fetch(`/api/projects/${projectId}/autosave`, { method: 'DELETE' }).catch(() => {})
    } else {
      clearAutosave(savedProjectId)
    }
    setRecovery(null)
  }

  function commitName() {
    const trimmed = nameInput.trim()
    if (trimmed && trimmed !== localProjectName) {
      setLocalProjectName(trimmed)
      if (projectId) {
        fetch(`/api/projects/${projectId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: trimmed }),
        })
          .then(r => r.ok ? r.json() : null)
          .then((data: { slug?: string; username?: string } | null) => {
            if (data?.slug) navigateToProject(data.slug, data.username)
          })
          .catch(() => {})
      }
    } else {
      setNameInput(localProjectName)
    }
    setEditingName(false)
  }

  async function saveToCloud(opts?: { silent?: boolean; modulesOverride?: ModuleKey[] }) {
    if (!opts?.silent) setShowSaveMenu(false)
    // Prompt for a real name if it's still the default
    let nameToUse = localProjectName.trim()
    if (nameToUse === 'New Project') {
      if (opts?.silent) return   // never prompt during auto-save
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
      project.modules = opts?.modulesOverride ?? activeModules
      project.moduleSavedAt = { ...project.moduleSavedAt, video: new Date().toISOString() }
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(project),
      })
      if (res.status === 403) {
        const body = await res.json().catch(() => ({})) as { upgrade?: boolean }
        if (body.upgrade) {
          showUpgrade('You\'ve reached the 5-project limit on the free plan. Upgrade to Pro for unlimited projects.')
          setSaveStatus('idle')
          return
        }
      }
      if (!res.ok) throw new Error('Cloud save failed')
      const saved = await res.json().catch(() => ({})) as { slug?: string; username?: string }
      posthog.capture('project_saved', { name: nameToUse })
      onDataSaved?.(project)
      // Clear cloud autosave since the manual save is now canonical
      if (projectId) {
        fetch(`/api/projects/${projectId}/autosave`, { method: 'DELETE' }).catch(() => {})
      }
      flashSaved()
      // Navigate to pretty URL after first save (exits /new) or any save that produced a slug
      if (saved.slug && pathname === '/new') {
        navigateToProject(saved.slug, saved.username)
      }
    } catch {
      setSaveStatus('error')
    }
  }
  // Keep refs current so timers always call the latest closure
  saveToCloudRef.current = () => saveToCloud({ silent: true })

  async function cloudAutoSave() {
    if (!projectId) return
    const nameToUse = localProjectName.trim()
    if (!nameToUse || nameToUse === 'New Project') return
    try {
      const snapshot = buildSnapshot()
      snapshot.name = nameToUse
      const project = serialize(snapshot)
      project.modules = activeModules
      await fetch(`/api/projects/${projectId}/autosave`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(project),
      })
    } catch { /* silent — autosave failures are non-critical */ }
  }
  cloudAutoSaveFnRef.current = cloudAutoSave

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


  // ── Edit handlers ───────────────────────────────────────────

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

  function handleTrackMuteToggle(trackId: string) {
    setTracksWithHistory(prev => prev.map(t => t.id === trackId ? { ...t, muted: !t.muted } : t))
  }

  function handleTrackSoloToggle(trackId: string) {
    setTracksWithHistory(prev => prev.map(t => t.id === trackId ? { ...t, solo: !t.solo } : t))
  }

  function handleClipSpeedChange(id: string, speed: number) {
    setTimelineItems(prev => prev.map(i => i.id === id ? { ...i, speed } : i))
  }

  function handleClipChange(id: string, patch: Partial<TimelineItem>) {
    setTimelineItems(prev => prev.map(i => i.id === id ? { ...i, ...patch } : i))
  }

  function handleTrackVolumeChange(trackId: string, volume: number) {
    setTracks(prev => prev.map(t => t.id === trackId ? { ...t, volume } : t))
    const v = videoRef.current
    if (v && viewerClip?.trackId === trackId) {
      v.volume = Math.max(0, Math.min(1, volume))
    }
  }

  function handleStoryboardReorder(draggedId: string, targetId: string) {
    setTimelineItems(prev => {
      const dragged = prev.find(i => i.id === draggedId)
      const target  = prev.find(i => i.id === targetId)
      if (!dragged || !target) return prev
      const tmp = dragged.startTime
      return prev.map(i =>
        i.id === draggedId ? { ...i, startTime: target.startTime } :
        i.id === targetId  ? { ...i, startTime: tmp } : i
      )
    })
  }

  function handleAddChapter() {
    const marker: ChapterMarker = { id: crypto.randomUUID(), time: currentTime, title: `Chapter ${chapters.length + 1}` }
    setChapters(prev => [...prev, marker].sort((a, b) => a.time - b.time))
  }

  function handleRenameChapter(id: string, title: string) {
    setChapters(prev => prev.map(c => c.id === id ? { ...c, title } : c))
  }

  function handleDeleteChapter(id: string) {
    setChapters(prev => prev.filter(c => c.id !== id))
  }

  const clampLeft   = (d: number) => setLeftW(w => Math.max(MIN_LEFT, Math.min(MAX_LEFT, w + d)))
  const clampRight  = (d: number) => setRightW(w => Math.max(MIN_RIGHT, Math.min(MAX_RIGHT, w - d)))
  const clampTl     = (d: number) => setTlHeight(h => Math.max(MIN_TL, Math.min(MAX_TL, h - d)))
  const clampAudioH = (d: number) => setAudioSplitH(h => Math.max(80, Math.min(320, h + d)))

  // ── Page tab config ──────────────────────────────────────────
  const PAGES: { id: EditorPage; label: string; icon: React.ElementType }[] = [
    { id: 'edit',    label: 'Edit',    icon: Film },
    ...(hasVideo ? [{ id: 'color'   as const, label: 'Color',   icon: Palette }] : []),
    ...(hasAudio ? [{ id: 'audio'   as const, label: 'Audio',   icon: Music   }] : []),
    ...(hasVideo ? [{ id: 'deliver' as const, label: 'Deliver', icon: Package }] : []),
  ]

  return (
    <div data-editor="true" className="flex flex-col h-full" style={{ background: 'var(--bg-base)' }}>

      {/* ── Header ───────────────────────────────────────────── */}
      <div className="electron-drag-container flex items-center gap-3 px-4 shrink-0" style={{ height: 40, borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)', paddingLeft: isElectronMac ? 80 : 16 }}>
        <Link href="/dashboard" className="flex items-center gap-1.5 text-xs shrink-0" style={{ color: 'var(--text-muted)' }}>
          <ArrowLeft size={12} /> Dashboard
        </Link>
        <div className="w-px h-4 shrink-0" style={{ background: 'var(--border)' }} />
        {editingName ? (
          <input
            autoFocus
            value={nameInput}
            onChange={e => setNameInput(e.target.value)}
            onBlur={commitName}
            onKeyDown={e => { if (e.key === 'Enter') commitName(); if (e.key === 'Escape') { setNameInput(localProjectName); setEditingName(false) } }}
            className="text-xs font-semibold bg-transparent outline-none border-b flex-1 min-w-0"
            style={{ color: 'var(--text-primary)', borderColor: 'var(--accent)', maxWidth: 240 }}
          />
        ) : (
          <button
            onClick={() => { setNameInput(localProjectName); setEditingName(true) }}
            className="text-xs font-semibold truncate flex-1 text-left hover:opacity-70 transition-opacity"
            style={{ color: 'var(--text-primary)', maxWidth: 240 }}
            title="Click to rename project"
          >
            {localProjectName}
          </button>
        )}

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
              onClick={() => saveToCloud()}
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
                onClick={() => saveToCloud()}
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

        {/* Share button */}
        {projectId && (
          <ShareButton projectId={projectId} />
        )}

        {/* Modules — add / remove loaded modules */}
        <div className="relative shrink-0">
          <button
            onClick={() => setShowModulesMenu(v => !v)}
            className="flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium"
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}
            title="Manage modules"
          >
            <Plus size={10} /> Modules
          </button>
          {showModulesMenu && (
            <div
              className="absolute right-0 top-full mt-1 rounded shadow-lg z-50 overflow-hidden"
              style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', minWidth: 220 }}
              onMouseLeave={() => setShowModulesMenu(false)}
            >
              <div className="px-3 py-2 text-xs font-semibold" style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                Switch module
              </div>
              {MODULE_DEFS.map(mod => {
                const active = activeModules.includes(mod.key)
                return (
                  <button
                    key={mod.key}
                    onClick={async () => {
                      if (active) return  // already on this module
                      const newMods = [mod.key]  // exclusive: one module at a time
                      setActiveModules(newMods)
                      setShowModulesMenu(false)
                      await saveToCloud({ silent: true, modulesOverride: newMods })
                      onModulesChange?.(newMods)
                    }}
                    disabled={active}
                    className="flex items-center gap-2.5 w-full px-3 py-2 text-xs text-left"
                    style={{ color: active ? 'var(--text-primary)' : 'var(--text-muted)', opacity: active ? 1 : 0.75, cursor: active ? 'default' : 'pointer' }}
                    onMouseEnter={e => { if (!active) (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-card-hover)' }}
                    onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent' }}
                  >
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: active ? mod.color : 'var(--border)', flexShrink: 0 }} />
                    <span style={{ flex: 1 }}>{mod.label}</span>
                    {active && <CheckIcon size={11} color="var(--text-muted)" />}
                  </button>
                )
              })}
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
            {recovery.source === 'cloud'
              ? <>Cloud autosave from <strong>{formatRelativeTime(recovery.at)}</strong> found — restore to continue where you left off.</>
              : <>Unsaved changes from <strong>{formatRelativeTime(recovery.at)}</strong> were found — your last session may have ended unexpectedly.</>
            }
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
                onAddFromLibrary={handleAddFromLibrary}
              />
            </div>
            <VResizeHandle onDelta={clampLeft} />

            {/* ── Center: viewport tabs + content ─────────────── */}
            <div className="flex-1 overflow-hidden min-w-0 flex flex-col" style={{ position: 'relative' }}>
              {/* Tab bar */}
              <div className="flex items-center shrink-0" style={{ height: 30, background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)' }}>
                {([
                  { id: 'video' as const, label: 'Video', icon: Film,                              show: hasVideo },
                  { id: 'audio' as const, label: 'Audio', icon: isAudioOnly ? Mic : AudioLines,    show: hasAudio },
                ] as const).filter(t => t.show).map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    onClick={() => setViewportTab(id)}
                    className="flex items-center gap-1.5 px-4 h-full text-xs transition-colors"
                    style={{
                      color: viewportTab === id ? 'var(--text-primary)' : 'var(--text-muted)',
                      borderBottom: `2px solid ${viewportTab === id ? 'var(--accent)' : 'transparent'}`,
                      background: 'transparent',
                    }}
                  >
                    <Icon size={11} />
                    {label}
                  </button>
                ))}
                {/* Before/after color compare */}
                {viewportTab === 'video' && !isAudioOnly && (
                  <button
                    onClick={() => setShowOriginal(v => !v)}
                    className="flex items-center gap-1 px-2 py-1 rounded text-xs"
                    title="Toggle original vs. graded (before/after color compare)"
                    style={{
                      color: showOriginal ? '#f97316' : 'var(--text-muted)',
                      background: showOriginal ? 'rgba(249,115,22,0.1)' : 'transparent',
                      border: `1px solid ${showOriginal ? 'rgba(249,115,22,0.35)' : 'transparent'}`,
                    }}
                  >
                    {showOriginal ? 'Before' : 'Compare'}
                  </button>
                )}

                {/* Split layout toggle — show audio below video */}
                {viewportTab === 'video' && !isAudioOnly && (
                  <button
                    onClick={() => setAudioLayout(l => l === 'tab' ? 'below' : 'tab')}
                    className="flex items-center gap-1.5 px-2 py-1 rounded text-xs"
                    title={audioLayout === 'below' ? 'Show audio as separate tab' : 'Show audio below video'}
                    style={{
                      color: audioLayout === 'below' ? 'var(--accent-light)' : 'var(--text-muted)',
                      background: audioLayout === 'below' ? 'var(--accent-subtle)' : 'transparent',
                    }}
                  >
                    <PanelsTopBottom size={12} />
                    {audioLayout === 'below' ? 'Split' : 'Split'}
                  </button>
                )}

                {/* Safe areas overlay */}
                {viewportTab === 'video' && !isAudioOnly && (
                  <button
                    onClick={() => setShowSafeAreas(v => !v)}
                    className="px-2 py-1 rounded text-xs"
                    title="Show safe areas (title/action)"
                    style={{
                      color: showSafeAreas ? 'var(--accent-light)' : 'var(--text-muted)',
                      background: showSafeAreas ? 'var(--accent-subtle)' : 'transparent',
                    }}
                  >Safe</button>
                )}

                {/* Aspect guide */}
                {viewportTab === 'video' && !isAudioOnly && (
                  <select value={aspectGuide}
                    onChange={e => setAspectGuide(e.target.value as typeof aspectGuide)}
                    className="text-xs rounded px-1 py-0.5"
                    title="Aspect ratio guide"
                    style={{
                      background: 'var(--bg-card)', border: '1px solid var(--border)',
                      color: aspectGuide !== 'none' ? 'var(--accent-light)' : 'var(--text-muted)',
                    }}
                  >
                    <option value="none">No guide</option>
                    <option value="9:16">9:16</option>
                    <option value="1:1">1:1</option>
                    <option value="4:5">4:5</option>
                    <option value="2.35:1">2.35:1</option>
                  </select>
                )}

                {/* VU meter */}
                {viewportTab === 'video' && !isAudioOnly && (
                  <button
                    onClick={() => setShowVUMeter(v => !v)}
                    className="px-2 py-1 rounded text-xs"
                    title="VU audio meter"
                    style={{
                      color: showVUMeter ? 'var(--accent-light)' : 'var(--text-muted)',
                      background: showVUMeter ? 'var(--accent-subtle)' : 'transparent',
                    }}
                  >VU</button>
                )}

                {/* Frame blend */}
                {viewportTab === 'video' && !isAudioOnly && (
                  <button
                    onClick={() => setFrameBlendEnabled(v => !v)}
                    className="px-2 py-1 rounded text-xs"
                    title="Frame blending (smooth slow-motion)"
                    style={{
                      color: frameBlendEnabled ? 'var(--accent-light)' : 'var(--text-muted)',
                      background: frameBlendEnabled ? 'var(--accent-subtle)' : 'transparent',
                    }}
                  >Blend</button>
                )}

                {/* Optical flow */}
                {viewportTab === 'video' && !isAudioOnly && (
                  <button
                    onClick={() => setOpticalFlowEnabled(v => !v)}
                    className="px-2 py-1 rounded text-xs"
                    title="Optical flow (multi-frame temporal smoothing)"
                    style={{
                      color: opticalFlowEnabled ? 'var(--accent-light)' : 'var(--text-muted)',
                      background: opticalFlowEnabled ? 'var(--accent-subtle)' : 'transparent',
                    }}
                  >Flow</button>
                )}

                {/* Motion blur */}
                {viewportTab === 'video' && !isAudioOnly && (
                  <button
                    onClick={() => setMotionBlurGlobal(v => !v)}
                    className="px-2 py-1 rounded text-xs"
                    title="Motion blur (speed-proportional shutter blur)"
                    style={{
                      color: motionBlurGlobal ? 'var(--accent-light)' : 'var(--text-muted)',
                      background: motionBlurGlobal ? 'var(--accent-subtle)' : 'transparent',
                    }}
                  >MBlur</button>
                )}

                {/* Storyboard view */}
                {hasStoryboard && (
                  <button
                    onClick={() => setShowStoryboard(v => !v)}
                    className="mr-2 px-2 py-1 rounded text-xs"
                    title="Storyboard view"
                    style={{
                      color: showStoryboard ? 'var(--accent-light)' : 'var(--text-muted)',
                      background: showStoryboard ? 'var(--accent-subtle)' : 'transparent',
                    }}
                  >Board</button>
                )}

                {/* Color scopes */}
                {viewportTab === 'video' && !isAudioOnly && (
                  <button
                    onClick={() => setShowColorScopes(v => !v)}
                    className="mr-1 px-2 py-1 rounded text-xs"
                    title="Color scopes"
                    style={{
                      color: showColorScopes ? 'var(--accent-light)' : 'var(--text-muted)',
                      background: showColorScopes ? 'var(--accent-subtle)' : 'transparent',
                    }}
                  >Scopes</button>
                )}

                {/* Render queue */}
                <button
                  onClick={() => setShowRenderQueue(true)}
                  className="px-2 py-1 rounded text-xs"
                  title="Render queue"
                  style={{ color: 'var(--text-muted)' }}
                >Queue</button>
              </div>

              {/* Content area */}
              {audioLayout === 'below' && viewportTab === 'video' && !isAudioOnly ? (
                // Side-by-side: video on top, waveform below
                <div className="flex-1 flex flex-col min-h-0">
                  <div style={{ flex: '1 1 0', minHeight: 0, overflow: 'hidden' }}>
                    <VideoPlayer
                      src={effectiveUrl} contentType={effectiveContentType}
                      captions={effectiveCaptions} currentTime={currentTime}
                      timeOffset={clipTimeOffset} isPlaying={isPlaying}
                      adjustments={adjustments}
                      showOriginal={showOriginal}
                      clipLabel={viewerClip?.label}
                      onTimeUpdate={handleTimeUpdate}
                      onPlay={() => setIsPlaying(true)} onPause={() => setIsPlaying(false)}
                      videoRef={videoRef}
                      onMediaError={handleMediaError}
                      preloadSrcs={mediaItems.map(m => m.url).filter((u): u is string => !!u)}
                      seekHints={seekHints}
                      clipTransform={clipTransform}
                      viewerZoom={viewerZoom}
                      onViewerZoomChange={setViewerZoom}
                      showSafeAreas={showSafeAreas}
                      aspectGuide={aspectGuide}
                      showVUMeter={showVUMeter}
                      frameBlendEnabled={frameBlendEnabled}
                      clipSpeed={rampSpeed}
                      motionBlurEnabled={motionBlurGlobal || (viewerClip?.motionBlurEnabled ?? false)}
                      currentClipSpeed={rampSpeed}
                      opticalFlowEnabled={opticalFlowEnabled}
                      blendMode={viewerClip?.blendMode}
                      loopDuration={viewerLoopDuration}
                      clipInPoint={viewerClip?.inPoint ?? 0}
                      titleClip={viewerClip?.contentType === 'title' ? {
                        text: viewerClip.titleText ?? '',
                        fontSize: viewerClip.titleFontSize ?? 48,
                        color: viewerClip.titleColor ?? '#ffffff',
                        bg: viewerClip.titleBg ?? 'transparent',
                        position: viewerClip.titlePosition ?? 'center',
                        animation: viewerClip.titleAnimation ?? 'none',
                        localProgress: (() => { const d = viewerClip.outPoint - viewerClip.inPoint; return d > 0 ? Math.max(0, Math.min(1, (currentTime - viewerClip.startTime) / d)) : 0 })(),
                      } : undefined}
                      onSeekRequest={handleSeek}
                      playbackRate={playbackRate}
                      onPlaybackRateChange={rate => { if (videoRef.current) videoRef.current.playbackRate = rate; setPlaybackRate(rate) }}
                      activeFocusClip={activeFocusClip}
                      onSetFocusPoint={selectedDrawFocusItem ? handleSetFocusPoint : undefined}
                      onFocusRecordStart={handleFocusRecordStart}
                      onFocusRecordEnd={handleFocusRecordEnd}
                      isRecordingFocus={isRecordingFocus}
                      focusKeyframes={selectedDrawFocusItem?.focusKeyframes}
                      focusClipStartTime={selectedDrawFocusItem?.startTime}
                      onFocusKeyframeMove={selectedDrawFocusItem ? handleFocusKeyframeMove : undefined}
                    />
                  </div>
                  <HResizeHandle onDelta={clampAudioH} />
                  <div style={{ height: audioSplitH, flexShrink: 0, overflow: 'hidden' }}>
                    <AudioWaveform
                      src={selectedMedia?.url ?? null}
                      contentType={(selectedMedia?.contentType === 'video' || selectedMedia?.contentType === 'audio') ? selectedMedia.contentType : null}
                      currentTime={currentTime}
                      duration={selectedMedia?.duration ?? 0}
                      onSeek={handleSeek}
                    />
                  </div>
                </div>
              ) : viewportTab === 'audio' ? (
                // Audio waveform tab
                <div className="flex-1 overflow-hidden min-h-0">
                  <AudioWaveform
                    src={selectedMedia?.url ?? null}
                    contentType={(selectedMedia?.contentType === 'video' || selectedMedia?.contentType === 'audio') ? selectedMedia.contentType : null}
                    currentTime={currentTime}
                    duration={selectedMedia?.duration ?? 0}
                    onSeek={handleSeek}
                  />
                </div>
              ) : (
                // Video tab (default)
                <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
                  <div className={showColorScopes ? 'flex-1 min-h-0' : 'flex-1 min-h-0'} style={{ flex: showColorScopes ? '1 1 0' : '1 1 auto' }}>
                    <VideoPlayer
                      src={effectiveUrl} contentType={effectiveContentType}
                      captions={effectiveCaptions} currentTime={currentTime}
                      timeOffset={clipTimeOffset} isPlaying={isPlaying}
                      adjustments={adjustments}
                      showOriginal={showOriginal}
                      clipLabel={viewerClip?.label}
                      onTimeUpdate={handleTimeUpdate}
                      onPlay={() => setIsPlaying(true)} onPause={() => setIsPlaying(false)}
                      videoRef={videoRef}
                      onMediaError={handleMediaError}
                      preloadSrcs={mediaItems.map(m => m.url).filter((u): u is string => !!u)}
                      seekHints={seekHints}
                      clipTransform={clipTransform}
                      viewerZoom={viewerZoom}
                      onViewerZoomChange={setViewerZoom}
                      showSafeAreas={showSafeAreas}
                      aspectGuide={aspectGuide}
                      showVUMeter={showVUMeter}
                      frameBlendEnabled={frameBlendEnabled}
                      clipSpeed={rampSpeed}
                      motionBlurEnabled={motionBlurGlobal || (viewerClip?.motionBlurEnabled ?? false)}
                      currentClipSpeed={rampSpeed}
                      opticalFlowEnabled={opticalFlowEnabled}
                      blendMode={viewerClip?.blendMode}
                      loopDuration={viewerLoopDuration}
                      clipInPoint={viewerClip?.inPoint ?? 0}
                      titleClip={viewerClip?.contentType === 'title' ? {
                        text: viewerClip.titleText ?? '',
                        fontSize: viewerClip.titleFontSize ?? 48,
                        color: viewerClip.titleColor ?? '#ffffff',
                        bg: viewerClip.titleBg ?? 'transparent',
                        position: viewerClip.titlePosition ?? 'center',
                        animation: viewerClip.titleAnimation ?? 'none',
                        localProgress: (() => { const d = viewerClip.outPoint - viewerClip.inPoint; return d > 0 ? Math.max(0, Math.min(1, (currentTime - viewerClip.startTime) / d)) : 0 })(),
                      } : undefined}
                      onSeekRequest={handleSeek}
                      playbackRate={playbackRate}
                      onPlaybackRateChange={rate => { if (videoRef.current) videoRef.current.playbackRate = rate; setPlaybackRate(rate) }}
                      activeFocusClip={activeFocusClip}
                      onSetFocusPoint={selectedDrawFocusItem ? handleSetFocusPoint : undefined}
                      onFocusRecordStart={handleFocusRecordStart}
                      onFocusRecordEnd={handleFocusRecordEnd}
                      isRecordingFocus={isRecordingFocus}
                      focusKeyframes={selectedDrawFocusItem?.focusKeyframes}
                      focusClipStartTime={selectedDrawFocusItem?.startTime}
                      onFocusKeyframeMove={selectedDrawFocusItem ? handleFocusKeyframeMove : undefined}
                    />
                  </div>
                  {showColorScopes && (
                    <div style={{ height: 140, flexShrink: 0, borderTop: '1px solid var(--border)' }}>
                      <ColorScopes videoRef={videoRef} isPlaying={isPlaying} scope={colorScopesType} onScopeChange={setColorScopesType} />
                    </div>
                  )}
                </div>
              )}

              {/* Storyboard overlay */}
              {showStoryboard && (
                <StoryboardView
                  items={timelineItems}
                  mediaItems={mediaItems}
                  selectedId={selectedId}
                  onSelect={(id) => { handleSelectItem(id); setShowStoryboard(false) }}
                  onSeek={handleSeek}
                  onReorder={handleStoryboardReorder}
                  onClose={() => setShowStoryboard(false)}
                />
              )}
            </div>

            <VResizeHandle onDelta={clampRight} />
            <div className="shrink-0 overflow-hidden" style={{ width: rightW }}>
              <Inspector
                selectedItem={selectedItem} adjustments={adjustments} outputs={localOutputs}
                onAdjustmentsChange={setAdjustmentsWithHistory}
                onTransitionChange={handleTransitionChange}
                onClipChange={handleClipChange}
                importedFile={importedFile}
                transcribeStatus={transcribeStatus}
                transcribeProgress={transcribeProgress}
                transcribeError={transcribeError}
                onTranscribe={handleTranscribe}
                captions={localCaptions}
                currentTime={currentTime}
                onSeek={handleSeek}
                silenceTrimStatus={silenceTrimStatus}
                silenceThreshold={silenceThreshold}
                onSilenceThresholdChange={setSilenceThreshold}
                onSilenceTrim={handleSilenceTrim}
                chapters={chapters}
                onAddChapter={handleAddChapter}
                onRenameChapter={handleRenameChapter}
                onDeleteChapter={handleDeleteChapter}
                onSpeedChange={handleClipSpeedChange}
                isAudioOnly={isAudioOnly}
                lutItems={mediaItems.filter(m => m.contentType === 'lut').map(m => ({ id: m.id, name: m.name }))}
                audioDuckingEnabled={audioDuckingEnabled}
                onAudioDuckingToggle={() => setAudioDuckingEnabled(v => !v)}
              />
            </div>
          </div>

          {/* Timeline resize + Timeline */}
          <HResizeHandle onDelta={clampTl} />
          <Timeline
            items={timelineItems} captions={effectiveCaptions} tracks={tracks}
            duration={duration} currentTime={currentTime} isPlaying={isPlaying} selectedId={selectedId}
            zoomLevel={zoomLevel} height={tlHeight}
            playbackRate={playbackRate}
            syncAnchorRef={tlSyncRef}
            activeTool={activeTool} snapEnabled={snapEnabled}
            inPoint={inPoint} outPoint={outPoint}
            hasCopied={!!clipboardRef.current}
            onSeek={handleSeek} onSelectItem={handleSelectItem}
            onMoveItem={handleMoveItem} onTrimItem={handleTrimItem}
            onSplitItem={handleSplitItem}
            onZoomChange={setZoomLevel}
            onDeleteItem={(id) => { setTimelineItems(p => p.filter(i => i.id !== id)); setSelectedId(null) }}
            onRippleDelete={handleRippleDelete}
            onDropMedia={handleDropMedia}
            onCreateFocusClip={handleCreateFocusClip}
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
            onTrackMuteToggle={handleTrackMuteToggle}
            onTrackSoloToggle={handleTrackSoloToggle}
            onTrackVolumeChange={handleTrackVolumeChange}
            selectedIds={selectedIds}
            onMultiSelect={setSelectedIds}
            mediaItems={mediaItems}
          />
        </>
      )}

      {activePage === 'color' && (
        <ColorPage adjustments={adjustments} onAdjustmentsChange={setAdjustmentsWithHistory} />
      )}
      {activePage === 'audio' && (
        <FairlightPage
          tracks={tracks}
          timelineItems={timelineItems}
          currentTime={currentTime}
          selectedId={selectedId}
          onVolumeChange={handleTrackVolumeChange}
          onMuteToggle={handleTrackMuteToggle}
          onSoloToggle={handleTrackSoloToggle}
          onClipChange={handleClipChange}
        />
      )}
      {activePage === 'deliver' && (
        <div className="flex-1 flex overflow-hidden">
          <RenderQueue
            inline
            timelineItems={timelineItems}
            mediaItems={mediaItems}
            projectName={localProjectName}
            inPoint={inPoint}
            outPoint={outPoint}
            onClose={() => setActivePage('edit')}
          />
        </div>
      )}

      {/* ── Page tabs (centered, DaVinci-style) ─────────────── */}
      <div
        className="flex items-center justify-center shrink-0"
        style={{ height: 38, borderTop: '1px solid var(--border)', background: 'var(--bg-base)' }}
      >
        <div className="flex items-stretch gap-0.5 px-1">
          {PAGES.map(({ id, label, icon: Icon }) => {
            const active = activePage === id
            return (
              <button
                key={id}
                onClick={() => setActivePage(id)}
                className="flex items-center justify-center gap-1.5 px-5 transition-colors rounded-sm"
                style={{
                  height: 30,
                  color: active ? 'var(--accent-light)' : 'var(--text-muted)',
                  background: active ? 'rgba(139,92,246,0.12)' : 'transparent',
                  border: `1px solid ${active ? 'rgba(139,92,246,0.3)' : 'transparent'}`,
                  fontSize: 11,
                  fontWeight: active ? 600 : 400,
                  letterSpacing: '0.04em',
                }}
              >
                <Icon size={12} />
                {label}
              </button>
            )
          })}
        </div>
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
            background: saveStatus === 'saved' ? 'var(--bg-card)' : '#250f0f',
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
          captions={localCaptions}
          inPoint={inPoint}
          outPoint={outPoint}
          onClose={() => setShowExport(false)}
        />
      )}

      {showRenderQueue && (
        <RenderQueue
          projectName={localProjectName}
          timelineItems={timelineItems}
          mediaItems={mediaItems}
          inPoint={inPoint}
          outPoint={outPoint}
          onClose={() => setShowRenderQueue(false)}
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
