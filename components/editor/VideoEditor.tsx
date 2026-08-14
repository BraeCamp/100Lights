'use client'

import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { useElectronChrome } from '@/lib/use-electron-chrome'
import dynamic from 'next/dynamic'
import { Download, Film, Palette, Music, Package, MousePointer2, Scissors, Undo2, Redo2, Save, Cloud, HardDrive, ChevronDown, CheckCircle2, FilePlus, AudioLines, PanelsTopBottom, Mic, Share2, Link2, Check as CheckIcon, Plus, Type, X, Loader2, Upload, Layers, SwatchBook, FolderOpen, Clapperboard, Wand2, Sparkles } from 'lucide-react'
import { useRouter, usePathname } from 'next/navigation'
import { useUser } from '@clerk/nextjs'
import VideoPlayer from '@/components/editor/VideoPlayer'
import AudioWaveform from '@/components/editor/AudioWaveform'
import Timeline from '@/components/editor/Timeline'
import MediaLibrary, { type StockClip } from '@/components/editor/MediaLibrary'
import AiAssistant from '@/components/editor/AiAssistant'
import ContextMenu from '@/components/editor/ContextMenu'
import { LogoMark } from '@/components/Logo'
import { useResizable, ResizeHandle } from '@/components/editor/daw/useResizable'
import { highlightHelpTargets } from '@/components/editor/daw/HelpButton'
import { usePerfMode } from '@/lib/perf-mode'
import { useRegisterCommands } from '@/lib/commands'
import { readWorkspace, writeWorkspace } from '@/lib/editor-workspace'
import { saveProject } from '@/lib/project-store'
import { projectPath } from '@/lib/project-url'
import type { LutData } from '@/lib/lut-parser'

// Heavy panels — loaded on demand so the initial editor paint is fast
const Inspector     = dynamic(() => import('@/components/editor/Inspector'),     { ssr: false, loading: () => <div style={{ flex: 1, background: 'var(--bg-surface)' }} /> })
const ColorScopes   = dynamic(() => import('@/components/editor/ColorScopes'),   { ssr: false })
const RenderQueue   = dynamic(() => import('@/components/editor/RenderQueue'),   { ssr: false })
const ExportModal   = dynamic(() => import('@/components/editor/ExportModal'),   { ssr: false })
// Same appearance/theme panel the audio editor uses — one customization system
// across both editors (see the shared WorkshopThemeProvider in ProjectEditor).
const AppearancePanel = dynamic(() => import('@/components/editor/daw/AppearancePanel'), { ssr: false })
const ProjectSwitcher = dynamic(() => import('@/components/editor/ProjectSwitcher'), { ssr: false })
const StoryboardView = dynamic(() => import('@/components/editor/StoryboardView'), { ssr: false })
const DawMixSync    = dynamic(() => import('@/components/editor/DawMixSync'),    { ssr: false })

// Cheap 53-bit hash (cyrb53) of a DAW project's AUDIO-relevant content, so a
// re-sync can skip re-rendering when nothing that affects the sound changed
// (a rename, a clip recolor, or a save that only touched the video side all
// leave this identical). `name`/`color`/`label` are stripped so cosmetic edits
// don't force a bounce; everything else is included, erring toward an occasional
// needless render rather than ever serving stale audio.
function dawAudioFingerprint(daw: import('@/lib/daw-types').DawProject): string {
  // `name` is intentionally kept: a sample clip without an r2Key selects its
  // sample BY name, so a rename can change the sound (stale-audio risk otherwise).
  const json = JSON.stringify(daw, (k, v) => (k === 'color' || k === 'colour' || k === 'label') ? undefined : v)
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57
  for (let i = 0; i < json.length; i++) {
    const ch = json.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

// Cross-project audio sync is SYNC-ON-SAVE, not real-time. A linked source
// project is rendered from its latest SAVED state (pulled fresh from the API on
// link, on load, and on manual re-sync). The live Liveblocks-room path is off:
// a source that isn't currently open has an empty/stale room, so subscribing to
// it handed back a silent replica that overwrote the good saved render. Flip
// this true (behind a Pro check) to re-enable live cross-project re-bouncing.
const LIVE_CROSS_PROJECT_SYNC = false
import {
  serialize, saveProjectToFile, openProjectFromFile, openProjectsFromFile, deserialize,
  type CfProjFile, type EditorSnapshot,
} from '@/lib/project-serializer'
import { openMediaInStudio } from '@/lib/media-handoff'
import { writeAutosave, readAutosave, clearAutosave } from '@/lib/autosave'
import {
  DEFAULT_ADJUSTMENTS, DEFAULT_TRACKS, DEFAULT_ASPECT, PROJECT_ASPECTS,
  RULER_HEIGHT, TRACK_HEIGHT, AUDIO_TRACK_HEIGHT, TOOLBAR_HEIGHT, PIXELS_PER_SECOND,
  MODULE_DEFS, ALL_MODULE_KEYS,
  type ModuleKey, type ProjectAspect,
} from '@/lib/editor-types'
import type { Caption, Clip, Output, ContentType, ChapterMarker } from '@/lib/types'
import type { TimelineItem, MediaItem, VideoAdjustments, Track, TransitionType, TempoSeg } from '@/lib/editor-types'
import { projectBeatLines, clipBeatLines, nearestSorted } from '@/lib/video-beats'
import { autoEditTimeline, type AutoEditOptions } from '@/lib/video-auto-edit'
import { VIDEO_EFFECTS, effectsByCategory, getEffect, activeEffectCss, activeOverlays } from '@/lib/video-effects'
import { buildMulticam, activeSpotlight } from '@/lib/video-multicam'
import { analyzeSpeaker, speakerActivityAt, type SpeakerTrack } from '@/lib/speaker-detect'
import BeatMapEditor from './BeatMapEditor'
import { r2CorsEligible } from '@/lib/media-cors'
import { MEDIA_ACCEPT, detectMediaKind, validateMediaFile } from '@/lib/media-import'
import { interpSpeedRamp } from '@/lib/video-export/speed'
import { pickVisibleClips, computeClipTransform, buildClipGradeFilter, buildFilter as buildFilterCss } from '@/lib/video-export/compositor'
import { DEFAULT_CAPTION_STYLE, type CaptionStyle } from '@/lib/editor-types'
import { DEFAULT_MUSIC_VIZ_FORMAT } from '@/lib/music-viz'
import type { ActiveClipTransition, UnderLayer } from '@/components/editor/VideoPlayer'
import type { ContextMenuItem } from './ContextMenu'
import type { LibraryMediaItem } from '@/app/api/media/library/route'
import { useUpgradeModal } from '@/components/UpgradeModal'
import posthog from 'posthog-js'
import { interpolateFocusKF, followPan } from '@/lib/focus-utils'

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
const MIN_RIGHT = 160; const MAX_RIGHT = 400
const MIN_TL = 120;  const MAX_TL = 480
const FRAME_DURATION = 1 / 30  // 30fps — matches the export pipeline (EXPORT_FPS)

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
          Color wheels, tone curves, scopes &amp; LUT import — select a clip and open the <b>Color</b> tab in the Inspector.
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
                          ><X size={10} /></button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Vocal clarity — presence EQ + de-ess + gentle compression */}
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16, marginBottom: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Vocal clarity</span>
                  <button
                    onClick={() => onClipChange(eqItem.id, { vocalClarity: (eqItem.vocalClarity ?? 0) > 0 ? 0 : 0.8 })}
                    style={{ padding: '5px 14px', borderRadius: 999, fontSize: 11.5, fontWeight: 800, cursor: 'pointer', border: 'none', background: (eqItem.vocalClarity ?? 0) > 0 ? 'var(--accent)' : 'var(--bg-card)', color: (eqItem.vocalClarity ?? 0) > 0 ? '#0e0d12' : 'var(--text-secondary)' }}
                  >{(eqItem.vocalClarity ?? 0) > 0 ? 'On' : 'Off'}</button>
                </div>
                {(eqItem.vocalClarity ?? 0) > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 9, color: 'var(--text-muted)', minWidth: 52, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>Strength</span>
                    <input type="range" min={0.2} max={1} step={0.1} value={eqItem.vocalClarity ?? 0.8}
                      onChange={e => onClipChange(eqItem.id, { vocalClarity: parseFloat(e.target.value) })}
                      style={{ flex: 1, accentColor: 'var(--accent)', cursor: 'pointer' }} />
                    <span style={{ fontSize: 10, color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums', minWidth: 34, textAlign: 'right' }}>{Math.round((eqItem.vocalClarity ?? 0.8) * 100)}%</span>
                  </div>
                )}
                <p style={{ fontSize: 10.5, color: 'var(--text-muted)', margin: '10px 0 0', lineHeight: 1.5 }}>High-pass + presence + de-ess + gentle compression — makes a voice clearer and more upfront.</p>
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
    // Canonical vanity URL is `/@user/slug-code` (see lib/project-url). Building
    // `/${uname}/${slug}` by hand dropped the @ and the -code, so the route's
    // resolver 404'd on reload. projectPath() adds both.
    if (uname && slug && projectId) router.replace(projectPath(uname, slug, projectId))
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
  // Live playhead for keyboard handlers: the keydown effect doesn't re-bind on
  // every frame, so reading `currentTime` directly there is stale during playback
  // (split/markers/nav/paste would fire where playback STARTED). Read this ref.
  const currentTimeRef = useRef(0)
  useEffect(() => { currentTimeRef.current = currentTime }, [currentTime])
  const [isPlaying, setIsPlaying] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [zoomLevel, setZoomLevel] = useState(1)
  const [tracks, setTracks] = useState<Track[]>(DEFAULT_TRACKS)
  // Remember workspace — restore the last-used layout (page / left sidebar /
  // viewport tab). Panel SIZES persist separately via useResizable. Read once,
  // client-only, SSR-safe, and validated so a corrupt blob falls back to defaults.
  const wsInit = useMemo(() => {
    const w = readWorkspace('video', {
      activePage: 'edit' as EditorPage,
      videoSidebarOpen: true,
      videoLeftTab: 'media' as 'media' | null,
      viewportTab: 'video' as 'video' | 'audio',
    })
    const pages: EditorPage[] = ['edit', 'color', 'audio', 'deliver']
    return {
      activePage: pages.includes(w.activePage) ? w.activePage : 'edit',
      videoSidebarOpen: typeof w.videoSidebarOpen === 'boolean' ? w.videoSidebarOpen : true,
      videoLeftTab: (w.videoLeftTab === 'media' || w.videoLeftTab === null) ? w.videoLeftTab : 'media',
      viewportTab: (w.viewportTab === 'video' || w.viewportTab === 'audio') ? w.viewportTab : 'video',
    }
  }, [])
  const [activePage, setActivePage] = useState<EditorPage>(wsInit.activePage)
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
  const [rightW, setRightW]   = useState(224)
  // Left media panel — icon-rail + openable panel, mirroring the audio editor.
  const [videoLeftTab, setVideoLeftTab] = useState<'media' | null>(wsInit.videoLeftTab)
  const [videoSidebarOpen, setVideoSidebarOpen] = useState(wsInit.videoSidebarOpen)
  const videoLeftPanel = useResizable({ key: 'video-left-panel', initial: 220, min: 180, max: 520, axis: 'x' })
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
  const mediaFileRef = useRef<HTMLInputElement | null>(null)     // hidden input for the toolbar Import button
  const [importError, setImportError] = useState('')

  // Toolbar Import → validate + import each chosen media file.
  function handleImportInput(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    let firstErr = ''
    for (const f of files) {
      const err = validateMediaFile(f)
      if (err) { if (!firstErr) firstErr = err }
      else handleFileImport(f)
    }
    setImportError(firstErr)
    if (firstErr) setTimeout(() => setImportError(''), 6000)
  }

  // Safety net: if a file is dropped anywhere OUTSIDE a handled drop zone (a gap,
  // a portal'd menu, the window chrome), the browser would navigate away and open
  // the file — destroying the editing session. Swallow stray file drags at the
  // window so a mis-aimed drop is a no-op instead. Only acts on file drags; the
  // editor/panel drop handlers run first (during bubbling) and still import.
  useEffect(() => {
    const guard = (e: DragEvent) => {
      if (e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')) e.preventDefault()
    }
    window.addEventListener('dragover', guard)
    window.addEventListener('drop', guard)
    return () => { window.removeEventListener('dragover', guard); window.removeEventListener('drop', guard) }
  }, [])

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
  const [showAppearance, setShowAppearance] = useState(false)
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [helpTab, setHelpTab] = useState<'shortcuts' | 'features'>('features')

  // Viewport layout
  const [viewportTab, setViewportTab] = useState<'video' | 'audio'>(wsInit.viewportTab)
  const [audioLayout, setAudioLayout] = useState<'tab' | 'below'>('tab')
  // Persist the workspace layout on any change (Remember workspace).
  useEffect(() => {
    writeWorkspace('video', { activePage, videoSidebarOpen, videoLeftTab, viewportTab })
  }, [activePage, videoSidebarOpen, videoLeftTab, viewportTab])
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
  // Project frame shape — sizes the preview stage AND the export canvas
  const [projectAspect, setProjectAspect] = useState<ProjectAspect>(DEFAULT_ASPECT)
  // Per-audio-clip beat grids drive the timeline snap points (lib/video-beats).
  // Opening the editor for one clip (via its right-click menu):
  const [beatMapEditor, setBeatMapEditor] = useState<{ clipId: string } | null>(null)
  // Burned-in caption look (size/color/position/karaoke)
  const [captionStyle, setCaptionStyle] = useState<CaptionStyle>(DEFAULT_CAPTION_STYLE)
  // Union of every audio clip's tempo-derived beat/bar lines (timeline seconds) —
  // the ruler ticks and drag/trim snapping both read this.
  const beatLines = useMemo(() => projectBeatLines(timelineItems), [timelineItems])
  // Full DAW arrangement carried by this project (audio module) — lets the
  // video editor bounce the real mix without opening the DAW.
  const dawProjectRef = useRef<import('@/lib/daw-types').DawProject | null>(null)
  const [hasDawProject, setHasDawProject] = useState(false)
  const [bounceStatus, setBounceStatus] = useState<'idle' | 'working' | 'error'>('idle')
  // ── Cross-project links: live replicas of OTHER projects whose mix we sync in.
  // Each gets its own DawMixSync joined to that project's room, so the linked
  // clip re-renders when the source project is edited. (Phase 1: audio → video, pull.)
  const sourceReplicasRef = useRef<Map<string, import('@/lib/daw-types').DawProject>>(new Map())
  const sourceNamesRef = useRef<Map<string, string>>(new Map())
  // Last-seen savedAt per linked source (from the projects list). When a source's
  // savedAt advances, we re-pull its mix — this is what makes "sync on save" of
  // the ORIGINAL project actually update the linked video clip.
  const sourceSyncedAtRef = useRef<Map<string, string>>(new Map())
  const [linkedSourceIds, setLinkedSourceIds] = useState<string[]>([])
  const [showProjectPicker, setShowProjectPicker] = useState(false)
  const [pickerMode, setPickerMode] = useState<'link' | 'send'>('link')   // link = pull a source in; send = push this mix out
  const [pickerProjects, setPickerProjects] = useState<Array<{ id: string; name: string }> | null>(null)
  // Set during load when the saved audio is newer than the linked mix bounce
  const pendingMixRefreshRef = useRef<string | null>(null)
  // Non-video module data carried through video saves. The projects API
  // replaces `data` wholesale, so a video-module save that omitted these
  // fields would WIPE the audio module's arrangement from the account. Always
  // the data AS LOADED — never the live collab replica, so a diverged replica
  // can't corrupt saved audio.
  const carryoverRef = useRef<Pick<CfProjFile, 'dawProject' | 'audioMedia' | 'audioMode' | 'podcastMeta' | 'moduleSavedAt'>>({})
  function withCarryover(project: CfProjFile): CfProjFile {
    const c = carryoverRef.current
    return {
      ...project,
      dawProject:  project.dawProject  ?? c.dawProject,
      audioMedia:  project.audioMedia  ?? c.audioMedia,
      audioMode:   project.audioMode   ?? c.audioMode,
      podcastMeta: project.podcastMeta ?? c.podcastMeta,
      moduleSavedAt: { ...c.moduleSavedAt, ...project.moduleSavedAt },
    }
  }
  // DAW tracks that carry clips — the link picker's options
  const [dawTracks, setDawTracks] = useState<Array<{ id: string; name: string }>>([])
  function deriveDawTracks(daw: import('@/lib/daw-types').DawProject): Array<{ id: string; name: string }> {
    const withClips = new Set((daw.arrangementClips ?? []).map(c => c.trackId))
    return daw.tracks.filter(t => withClips.has(t.id)).map(t => ({ id: t.id, name: t.name || 'Track' }))
  }
  const [viewerZoom, setViewerZoom] = useState(1)
  const [showStoryboard, setShowStoryboard] = useState(false)
  const [showVUMeter, setShowVUMeter] = useState(false)
  const [frameBlendEnabled, setFrameBlendEnabled] = useState(false)
  const [opticalFlowEnabled, setOpticalFlowEnabled] = useState(false)
  const [motionBlurGlobal, setMotionBlurGlobal] = useState(false)
  const [showColorScopes, setShowColorScopes] = useState(false)
  const [colorScopesType, setColorScopesType] = useState<'waveform' | 'vectorscope' | 'histogram' | 'parade' | 'spectrum'>('waveform')
  // Performance mode — when on, suppress the heavy optional visualizers below.
  const [perfMode] = usePerfMode()
  const [showRenderQueue, setShowRenderQueue] = useState(false)
  // Preview-overlay toggles are grouped under one "Overlays ▾" menu to de-clutter
  // the viewport toolbar (fixed-positioned so it escapes the clipped bar).
  const [showOverlaysMenu, setShowOverlaysMenu] = useState(false)
  const [overlaysMenuPos, setOverlaysMenuPos] = useState<{ top: number; left: number } | null>(null)
  const overlaysBtnRef = useRef<HTMLButtonElement>(null)
  const [audioDuckingEnabled, setAudioDuckingEnabled] = useState(false)

  // Audio ducking: analyzes primary track, reduces volume on music tracks under dialogue
  const duckingRafRef    = useRef<number | null>(null)
  // ── Shared Web Audio graph ──────────────────────────────────────────────
  // A media element allows exactly ONE MediaElementSourceNode for its whole
  // lifetime, so EQ and audio-ducking cannot each build their own graph — the
  // second createMediaElementSource() throws and the clip goes silent. Both
  // features share one AudioContext + source, wired as a single chain:
  //   source → duckGain → low → mid → high → destination
  // with a read-only analyser tap off the source for the ducking RMS. Nodes
  // stay neutral (duckGain = 1, eq gains = 0) when their feature is off, so
  // building the graph never changes the sound on its own.
  const audioCtxRef   = useRef<AudioContext | null>(null)
  const mediaSrcRef   = useRef<MediaElementAudioSourceNode | null>(null)
  const audioChainRef = useRef<{
    duckGain: GainNode
    analyser: AnalyserNode
    low:  BiquadFilterNode
    mid:  BiquadFilterNode
    high: BiquadFilterNode
  } | null>(null)

  function ensureAudioChain() {
    if (audioChainRef.current) return audioChainRef.current
    const v = videoRef.current
    if (!v) return null
    try {
      const ctx = audioCtxRef.current ?? (audioCtxRef.current = new AudioContext())
      // createMediaElementSource can only ever run once per element — cache it
      const src = mediaSrcRef.current ?? (mediaSrcRef.current = ctx.createMediaElementSource(v))
      const duckGain = ctx.createGain()
      const analyser = ctx.createAnalyser(); analyser.fftSize = 256
      const low  = ctx.createBiquadFilter(); low.type  = 'lowshelf';  low.frequency.value  = 200
      const mid  = ctx.createBiquadFilter(); mid.type  = 'peaking';   mid.frequency.value  = 1000; mid.Q.value = 1
      const high = ctx.createBiquadFilter(); high.type = 'highshelf'; high.frequency.value = 6000
      src.connect(analyser)                                         // read-only tap (ducking RMS)
      src.connect(duckGain).connect(low).connect(mid).connect(high).connect(ctx.destination)
      audioChainRef.current = { duckGain, analyser, low, mid, high }
      ctx.resume?.().catch(() => {})
      return audioChainRef.current
    } catch {
      // AudioContext blocked before a user gesture, or the source was already claimed
      return null
    }
  }

  useEffect(() => {
    if (!audioDuckingEnabled || !isPlaying) {
      if (duckingRafRef.current !== null) { cancelAnimationFrame(duckingRafRef.current); duckingRafRef.current = null }
      // Release the duck to unity as the one final frame — ducking only makes
      // sense while audio is running, so a paused frame is always un-ducked.
      if (audioChainRef.current) audioChainRef.current.duckGain.gain.value = 1
      return
    }
    const chain = ensureAudioChain()
    if (!chain) return
    audioCtxRef.current?.resume?.().catch(() => {})

    const buf = new Uint8Array(chain.analyser.frequencyBinCount)
    function tick() {
      chain!.analyser.getByteTimeDomainData(buf)
      // RMS level of primary clip audio
      let sum = 0
      for (let i = 0; i < buf.length; i++) { const s = (buf[i] - 128) / 128; sum += s * s }
      const rms = Math.sqrt(sum / buf.length)
      // Duck: reduce gain when RMS > 0.05 (dialogue threshold)
      const target = rms > 0.05 ? 0.3 : 1.0
      const cur = chain!.duckGain.gain.value
      chain!.duckGain.gain.value = cur + (target - cur) * 0.05 // smooth 50ms RC
      duckingRafRef.current = requestAnimationFrame(tick)
    }
    duckingRafRef.current = requestAnimationFrame(tick)

    return () => {
      if (duckingRafRef.current !== null) { cancelAnimationFrame(duckingRafRef.current); duckingRafRef.current = null }
    }
  }, [audioDuckingEnabled, isPlaying]) // eslint-disable-line

  // LUT data keyed by MediaItem id
  const [lutMap, setLutMap] = useState<Map<string, LutData>>(new Map())

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
    const findOn = (trackId: string) => timelineItems.find(i =>
      i.trackId === trackId && i.enabled !== false &&
      i.contentType !== 'effect' && i.contentType !== 'spotlight' &&   // directives, not visual layers
      currentTime >= i.startTime && currentTime < i.startTime + (i.outPoint - i.inPoint))
    // Multicam: while a spotlight is active, the selected camera is what the preview shows.
    const spot = activeSpotlight(timelineItems, currentTime)
    if (spot) { const h = findOn(spot); if (h) return h }
    for (const track of mediaTracks) { const h = findOn(track.id); if (h) return h }
    return null
  }, [timelineItems, tracks, currentTime])

  // On-canvas move/resize gizmo config — only when the selected clip is the one
  // on screen and it's a media clip (not a title/musicviz overlay). Drives the
  // clip's cropX/cropY/cropZoom through handleClipChange (same path as Inspector).
  const gizmo = useMemo(() => (
    selectedItem && viewerClip && selectedItem.id === viewerClip.id
      && selectedItem.contentType !== 'title' && selectedItem.contentType !== 'musicviz'
      ? { cropZoom: selectedItem.cropZoom ?? 100, cropX: selectedItem.cropX ?? 0, cropY: selectedItem.cropY ?? 0, crop: selectedItem.crop }
      : null
  ), [selectedItem, viewerClip])

  // Workshop theme accent, read once (theme rarely changes mid-session). Hoisted
  // out of the currentTime-dependent memo below so we don't force a synchronous
  // getComputedStyle/style read on every playhead tick.
  const themeAccent = useMemo(() => (
    (typeof window !== 'undefined'
      && getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()) || '#a78bfa'
  ), [])

  // Music-visual overlays active at the playhead — rendered OVER the video (not
  // as a replacement), each reacting to the timeline audio via the player's
  // analyser. mvMatchTheme pulls the accent from the editor's Workshop theme.
  const activeMusicViz = useMemo(() => {
    return timelineItems
      .filter(i => i.contentType === 'musicviz' && i.enabled !== false
        && currentTime >= i.startTime && currentTime < i.startTime + (i.outPoint - i.inPoint))
      .map(i => ({
        id: i.id,
        format: i.mvFormat || DEFAULT_MUSIC_VIZ_FORMAT,
        accent: (i.mvMatchTheme ? themeAccent : i.mvAccent) || i.mvAccent || themeAccent,
        bg: i.mvBg ?? null,
        resolution: i.mvResolution,
        opacity: i.opacity,
        blendMode: i.blendMode,
      }))
  }, [timelineItems, currentTime, themeAccent])

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

  // Per-clip EQ — drives the shared graph's shelf/peak gains (see ensureAudioChain)
  useEffect(() => {
    const clip = viewerClip
    const eq = clip?.eq

    if (eq && clip) {
      const chain = ensureAudioChain()
      if (chain) {
        chain.low.gain.value  = eq.low
        chain.mid.gain.value  = eq.mid
        chain.high.gain.value = eq.high
      }
    } else if (audioChainRef.current) {
      // No EQ on this clip → flatten the shelves (keep the graph intact for ducking)
      audioChainRef.current.low.gain.value  = 0
      audioChainRef.current.mid.gain.value  = 0
      audioChainRef.current.high.gain.value = 0
    }
  }, [viewerClip?.id, viewerClip?.eq]) // eslint-disable-line

  // LUT of the active clip — VideoPlayer renders it via a WebGL overlay canvas
  // (the old OffscreenCanvas loop burned CPU into an invisible buffer).
  const activeLut = viewerClip?.lutId ? (lutMap.get(viewerClip.lutId) ?? null) : null

  // ── Same-origin sources for pixel-reading features ─────────────────────────
  // Scopes, frame blend, optical flow and the LUT overlay all read frames back,
  // which a cross-origin (R2-signed) source taints. When one of those features
  // is active, lazily download the active clip's source and swap in a blob URL
  // — same trick the export capture uses.
  const localizedUrlsRef = useRef<Map<string, string | 'pending'>>(new Map())
  // LUT still renders in perf mode (it's a grade, not a visualizer), so it keeps
  // needing readable frames; the suppressed visualizers don't.
  const pixelFeatureActive = (!perfMode && (showColorScopes || frameBlendEnabled || opticalFlowEnabled)) || !!activeLut
  useEffect(() => {
    // On bucket-allowlisted origins the elements load with crossOrigin and
    // frames are readable directly — no download needed.
    if (r2CorsEligible()) return
    const url = viewerClip?.url
    if (!pixelFeatureActive || !url) return
    if (url.startsWith('blob:') || url.startsWith('data:')) return
    const cache = localizedUrlsRef.current
    if (cache.has(url)) return
    cache.set(url, 'pending')
    let cancelled = false
    ;(async () => {
      try {
        const blob = await (await fetch(url)).blob()
        if (cancelled) return
        const local = URL.createObjectURL(blob)
        cache.set(url, local)
        setMediaItems(prev => prev.map(m => m.url === url ? { ...m, url: local } : m))
        setTimelineItemsRaw(prev => {
          const next = prev.map(i => i.url === url ? { ...i, url: local } : i)
          timelineItemsRef.current = next
          return next
        })
      } catch {
        cache.delete(url)   // will retry next toggle
      }
    })()
    return () => { cancelled = true }
  }, [pixelFeatureActive, viewerClip?.url]) // eslint-disable-line

  /** Edit a caption's text in place (Inspector transcript tab). */
  function handleCaptionEdit(index: number, text: string) {
    setLocalCaptions(prev => prev.map((c, i) => i === index ? { ...c, text, words: undefined } : c))
  }

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
    // Follow-focus: pan to keep the linked dot centered (shared helper = export parity).
    if (clip.followFocusClipId) {
      const fp = followPan(clip, timelineItems, currentTime)
      if (fp) { cropX = fp.cropX; cropY = fp.cropY }
    }

    return {
      opacity: clip.opacity ?? 100,
      flipH: clip.flipH ?? false,
      flipV: clip.flipV ?? false,
      cropZoom, cropX, cropY,
      fadeOpacity,
      fitMode: clip.fitMode,
      crop: clip.crop,
    }
  }, [viewerClip?.id, viewerClip?.opacity, viewerClip?.flipH, viewerClip?.flipV, // eslint-disable-line
      viewerClip?.cropZoom, viewerClip?.cropX, viewerClip?.cropY, viewerClip?.fitMode, viewerClip?.crop,
      viewerClip?.fadeIn, viewerClip?.fadeOut, viewerClip?.kenBurns,
      viewerClip?.followFocusClipId, timelineItems, currentTime]) // eslint-disable-line

  // Transition-in of the active clip: the clip that occupied the SAME TRACK
  // just before this one becomes the frozen frame the transition blends from.
  // Mirrors lib/video-export/compositor.transitionAt (per-track, now that
  // lower tracks stack as layers). The preview renders the frozen frame in a
  // dedicated element, so same-source cuts cross-blend like the export.
  const viewerTransition = useMemo((): ActiveClipTransition | undefined => {
    const clip = viewerClip
    if (!clip?.transitionIn) return undefined
    const clipDur = clip.outPoint - clip.inPoint
    const tPrev = clip.startTime - 0.001
    let prev = timelineItems.find(i =>
      i.trackId === clip.trackId &&
      i.id !== clip.id &&
      i.enabled !== false &&
      tPrev >= i.startTime &&
      i.startTime + (i.outPoint - i.inPoint) > tPrev,
    ) ?? null
    if (prev && (
      prev.contentType === 'title' ||
      prev.contentType === 'audio' ||
      !prev.url
    )) prev = null
    return {
      type: clip.transitionIn,
      duration: Math.max(0.05, Math.min(clip.transitionDuration ?? 0.5, clipDur)),
      prevSrc: prev?.url ?? null,
      prevTime: prev?.outPoint ?? 0,
      prevFitMode: prev?.fitMode,
    }
  }, [viewerClip?.id, viewerClip?.transitionIn, viewerClip?.transitionDuration, timelineItems]) // eslint-disable-line

  // Layers under the active clip — every lower track's clip at the playhead,
  // bottom → top, transformed for this instant. Titles pass through as text.
  const underLayers = useMemo((): UnderLayer[] => {
    const stack = pickVisibleClips(timelineItems, tracks, currentTime)
    if (stack.length <= 1) return []
    const layers: UnderLayer[] = []
    for (const clip of stack.slice(0, -1)) {   // all but the top (= viewerClip)
      if (clip.contentType === 'title') {
        const d = clip.outPoint - clip.inPoint
        layers.push({
          kind: 'title', id: clip.id,
          text: clip.titleText ?? '',
          fontSize: clip.titleFontSize ?? 48,
          color: clip.titleColor ?? '#ffffff',
          bg: clip.titleBg ?? 'transparent',
          position: clip.titlePosition ?? 'center',
          animation: clip.titleAnimation ?? 'none',
          localProgress: d > 0 ? Math.max(0, Math.min(1, (currentTime - clip.startTime) / d)) : 0,
        })
        continue
      }
      if (clip.contentType === 'audio' || !clip.url) continue
      const tf = computeClipTransform(clip, currentTime, timelineItems)
      const gradeFilter = buildClipGradeFilter(clip)
      const globalFilter = buildFilterCss(adjustments)
      layers.push({
        kind: 'video', id: clip.id, src: clip.url,
        startTime: clip.startTime, inPoint: clip.inPoint, outPoint: clip.outPoint,
        speed: clip.speed, speedPoints: clip.speedPoints,
        transform: { ...tf, fitMode: clip.fitMode, crop: clip.crop },
        blendMode: clip.blendMode,
        filter: [globalFilter === 'none' ? '' : globalFilter, gradeFilter].filter(Boolean).join(' '),
      })
    }
    return layers
  }, [timelineItems, tracks, currentTime, adjustments])

  // Draw-focus clips available as follow targets (for the Inspector's "Follow focus dot").
  const focusClips = useMemo(() => {
    const focusTrackIds = new Set(tracks.filter(t => t.type === 'drawfocus').map(t => t.id))
    return timelineItems
      .filter(i => focusTrackIds.has(i.trackId))
      .map(i => ({ id: i.id, label: i.label || 'Focus' }))
  }, [timelineItems, tracks])

  // Converts timeline time ↔ source clip time:  clipTime = timelineTime − offset
  const clipTimeOffset = viewerClip ? viewerClip.startTime - viewerClip.inPoint : 0
  const clipTimeOffsetRef = useRef(clipTimeOffset)
  useEffect(() => { clipTimeOffsetRef.current = clipTimeOffset }, [clipTimeOffset])

  // On mount: drain any media handed off from All Projects / dashboard
  // ("Open / Import Files" with a raw video/audio file → ?importMedia=1).
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!new URLSearchParams(window.location.search).get('importMedia')) return
    // takePendingMedia atomically reads AND clears the store, so a StrictMode
    // double-invoke (or a reload) can't import the same files twice — no
    // cancelled-guard needed, and skipping the import on cleanup would drop them.
    import('@/lib/media-handoff').then(async ({ takePendingMedia }) => {
      const files = await takePendingMedia()
      for (const f of files) handleFileImport(f)
    }).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  // Captions handed off from the standalone Captions app (/apps/captions → "Send to Video editor").
  // Applied on mount when the URL carries ?captions=pending; the user imports/keeps their video and the
  // words are already here. Fires once, then clears the stash.
  useEffect(() => {
    try {
      if (typeof window === 'undefined') return
      if (!new URLSearchParams(window.location.search).has('captions')) return
      const stash = sessionStorage.getItem('cf_pending_captions')
      if (!stash) return
      sessionStorage.removeItem('cf_pending_captions')
      const parsed = JSON.parse(stash) as { captions?: Caption[]; style?: CaptionStyle }
      if (parsed.captions?.length) setCaptionsWithHistory(parsed.captions)
      if (parsed.style) setCaptionStyle(parsed.style)   // carry the burn-in look from the Captions app
    } catch { /* malformed stash — ignore */ }
  }, []) // eslint-disable-line

  // Programmatic control of the video module (window.__video) — mirrors the DAW's __daw hooks so an
  // agent/headless script can operate the editor exactly like a user: import media (file or URL),
  // transcribe, edit captions + burn-in style, name, and open export. Dev-only, like __dawDispatch.
  useEffect(() => {
    if (typeof window === 'undefined' || process.env.NODE_ENV !== 'development') return
    const w = window as unknown as { __video?: Record<string, unknown> }
    const fetchToFile = async (url: string, name?: string, type?: string) => {
      const r = await fetch(url); const b = await r.blob()
      // normalize shorthand ('video'/'audio') → a real MIME so handleFileImport's `startsWith('video/')` check works
      const mime = type === 'video' ? 'video/mp4' : type === 'audio' ? 'audio/mpeg' : (type || b.type)
      return new File([b], name || url.split('/').pop() || 'media', { type: mime })
    }
    w.__video = {
      // Reads from REFS (not the render closure) so it's always current — no stale reads for tests/agents.
      getState: () => ({
        name: localProjectName, captions: captionsRef.current, captionStyle,
        media: mediaItemsRef.current.map(m => ({ id: m.id, name: m.name, contentType: m.contentType, duration: m.duration, uploadStatus: m.uploadStatus })),
        tracks: tracksRef.current.map(t => ({ id: t.id, type: t.type, label: t.label })),
        // Full timeline (each item's kind + track + look) so tests can assert precisely, plus a count.
        items: timelineItemsRef.current.map(i => ({ id: i.id, contentType: i.contentType, trackId: i.trackId, startTime: i.startTime, dur: +(i.outPoint - i.inPoint).toFixed(2), look: i.look, spotlightTrackId: i.spotlightTrackId })),
        timelineItems: timelineItemsRef.current.length,
      }),
      setName: (n: string) => setLocalProjectName(n),
      importFile: (f: File) => handleFileImport(f),
      importFromUrl: async (url: string, name?: string, type?: string) => handleFileImport(await fetchToFile(url, name, type)),
      transcribe: () => handleTranscribe(),
      setCaptions: (c: Caption[]) => setCaptionsWithHistory(c),
      setCaptionStyle: (s: CaptionStyle) => setCaptionStyle(s),
      selectMedia: (id: string) => setSelectedMediaId(id),
      addTrack: (type: 'media' | 'video' | 'audio' = 'audio', id?: string) => {
        const tid = id ?? `${type[0]}${Date.now() % 100000}`
        setTracks(prev => prev.some(t => t.id === tid) ? prev : [...prev, { id: tid, label: type.toUpperCase(), type, height: 56 }])
        return tid
      },
      addToTimeline: (mediaId: string, o: { trackId?: string; startTime?: number } = {}) =>
        handleDropMedia(mediaId, o.trackId ?? (tracksRef.current.find(t => t.type === 'media' || t.type === 'video')?.id ?? 'v1'), o.startTime ?? 0),
      // Add an audio-reactive music-visual clip (full-frame background by default) —
      // format = 'waveform' | 'eq-bars' | 'radial'. Drives the same MusicVizOverlay
      // the user gets from the inspector; returns the clip id.
      addMusicViz: (o: { format?: string; startTime?: number; duration?: number; trackId?: string; accent?: string; bg?: [string, string] | null } = {}) => {
        const trackId = o.trackId ?? (tracksRef.current.find(t => t.type === 'media' || t.type === 'video')?.id ?? 'v1')
        const start = o.startTime ?? 0
        const id = crypto.randomUUID()
        setTimelineItems(prev => [...prev, {
          id, label: 'Music Visual', startTime: start, inPoint: 0, outPoint: o.duration ?? 30,
          captions: [], color: CLIP_COLORS[0], trackId, contentType: 'musicviz',
          mvFormat: o.format ?? DEFAULT_MUSIC_VIZ_FORMAT, mvAccent: o.accent ?? themeAccent,
          mvBg: o.bg ?? null, mvMatchTheme: !o.accent,
        }])
        return id
      },
      // Beat-synced auto-edit: cut the pool footage to the audio bed. Returns { cuts }. The AI drives
      // the whole flow — importFromUrl footage → import audio → autoEdit → export.
      autoEdit: (options?: AutoEditOptions) => runAutoEdit(options),
      // Effects: apply a named look (see listEffects) to a clip, or to ALL video clips by default.
      listEffects: () => VIDEO_EFFECTS.map(e => ({ id: e.id, name: e.name, category: e.category })),
      setEffect: (effectId: string | null, o: { clipId?: string; all?: boolean } = {}) => {
        const ids = o.clipId ? [o.clipId] : timelineItemsRef.current.filter(i => i.contentType === 'video').map(i => i.id)
        return applyEffect(effectId, ids)
      },
      // Add an effect ITEM (contentType 'effect') on a track — the third item type. Returns its id.
      addEffectItem: (lookId?: string) => addEffectItem(lookId),
      // Multicam: auto-switch the spotlight across camera tracks ('audio' = cut to the loudest).
      multicam: (mode: 'roundrobin' | 'audio' = 'audio') => runMulticam(mode),
      // Speaker-driven multicam: analyze mouth movement + audio → cut to who's talking. Async.
      speakerMulticam: () => runSpeakerMulticam(),
      // Offline speaker/mouth-motion analysis of a video URL → { times, activity }.
      analyzeSpeaker: (url: string, opts?: Parameters<typeof analyzeSpeaker>[1]) => analyzeSpeaker(url, opts),
      // Vocal clarity on an audio item (0..1; 0 = off) — presence EQ + de-ess + compression.
      setVocalClarity: (clipId: string, amount = 0.8) => { setTimelineItems(prev => prev.map(i => i.id === clipId ? { ...i, vocalClarity: amount } : i)); return true },
      // Manual spotlight: pin a camera track at the playhead.
      setSpotlight: (cameraTrackId: string, dur?: number) => addSpotlightItem(cameraTrackId, dur),
      openExport: () => setShowExport(true),
      // Direct headless render — same path the Export modal uses (exportTimelineFidelity), building the
      // input from live editor state. Returns the finished video as a base64 data URL so a driver can
      // save it. This closes the "render a finished video through the product" loop.
      export: async (opts: { quality?: 'high' | 'medium' | 'web'; resolution?: 'original' | '1080p' | '720p' | '480p'; aspect?: ProjectAspect; fast?: boolean } = {}) => {
        const { exportTimelineFidelity } = await import('@/lib/video-export')
        const blob = await exportTimelineFidelity({
          timelineItems, tracks, adjustments: adjustmentsRef.current, captions: captionsRef.current, captionStyle,
          luts: lutMap, quality: opts.quality ?? 'high', resolution: opts.resolution ?? '1080p',
          aspect: opts.aspect ?? projectAspect, fast: opts.fast ?? true, range: null,
          onProgress: (frac: number, msg?: string) => { try { console.log(`[export] ${Math.round(frac * 100)}% ${msg ?? ''}`) } catch { /* noop */ } },
        })
        const dataUrl = await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsDataURL(blob) })
        return { type: blob.type, size: blob.size, dataUrl }
      },
    }
    return () => { try { delete (window as unknown as { __video?: unknown }).__video } catch { /* ignore */ } }
  }, [localProjectName, captionStyle, mediaItems, timelineItems, tracks, lutMap, projectAspect]) // eslint-disable-line

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
      setProjectAspect(loaded.aspect)
      setCaptionStyle(loaded.captionStyle ?? DEFAULT_CAPTION_STYLE)
      dawProjectRef.current = cfproj.dawProject ?? null
      setHasDawProject(!!cfproj.dawProject)
      setDawTracks(cfproj.dawProject ? deriveDawTracks(cfproj.dawProject) : [])
      carryoverRef.current = {
        dawProject: cfproj.dawProject,
        audioMedia: cfproj.audioMedia,
        audioMode: cfproj.audioMode,
        podcastMeta: cfproj.podcastMeta,
        moduleSavedAt: cfproj.moduleSavedAt,
      }
      // Linked audio ALWAYS re-syncs from the project's audio on open — the
      // link is live by definition until the user locks a clip.
      if (cfproj.dawProject && patchedItems.some(i => i.dawMixLinked && !i.dawMixLocked && !i.dawMixSourceProjectId)) {
        pendingMixRefreshRef.current = cfproj.moduleSavedAt?.audio ?? new Date().toISOString()
      }
      // Cross-project links: re-fetch each linked source project, rebuild its live
      // replica, and mount its listener so the clip re-syncs again after a reload.
      const srcIds = Array.from(new Set(patchedItems
        .filter(i => i.dawMixLinked && i.dawMixSourceProjectId)
        .map(i => i.dawMixSourceProjectId as string)))
      if (srcIds.length) void rehydrateLinkedSources(srcIds)
      setActiveModules(cfproj.modules ?? ALL_MODULE_KEYS)
      // Apply the saved color grade — without this it stays DEFAULT and the next
      // save overwrites the stored grade (silent loss on every reopen).
      const loadedAdj = loaded.adjustments ?? DEFAULT_ADJUSTMENTS
      setAdjustments(loadedAdj)
      adjustmentsRef.current = loadedAdj
      resetHistory({ timelineItems: patchedItems, tracks: loadedTracks, adjustments: loadedAdj, captions: loaded.captions })

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
      writeAutosave(savedProjectId, withCarryover(serialize(snapshot)))
      setIsDirty(false) // data is safely recoverable now — don't nag on unload
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
  }, [timelineItems, tracks, adjustments, projectAspect, captionStyle, localCaptions, localOutputs, localProjectName, chapters, mediaItems]) // eslint-disable-line

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

  // Escape closes the shortcuts overlay (menus/modals previously only closed on
  // mouse-leave, which strands them on touch/trackpad).
  useEffect(() => {
    if (!showShortcuts) return
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowShortcuts(false) }
    window.addEventListener('keydown', onEsc)
    return () => window.removeEventListener('keydown', onEsc)
  }, [showShortcuts])

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
        i.contentType !== 'effect' &&   // effect items are frame filters, not visual layers
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
    return Math.max(lastClipEnd + 30, 60)
  }, [timelineItems])

  // ── Master clock (RAF) ─────────────────────────────────────
  // When there is no active video to drive onTimeUpdate, RAF advances the playhead.
  // When a video IS active, it fires onTimeUpdate itself and RAF is dormant.
  const rafRef      = useRef<number | null>(null)
  const rafPrevRef  = useRef<number | null>(null)
  const rafLastEmitRef = useRef(0)
  const effectiveUrlRef = useRef(effectiveUrl)
  useEffect(() => { effectiveUrlRef.current = effectiveUrl }, [effectiveUrl])

  useEffect(() => {
    const cancel = () => {
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
      rafPrevRef.current = null
      // Land the state on the exact ref position so nothing that reads
      // `currentTime` (memos) is left up to a frame behind the smooth ref.
      setCurrentTime(currentTimeRef.current)
    }
    if (!isPlaying || effectiveUrl) { cancel(); return }
    rafLastEmitRef.current = 0

    // No active video — tick the clock ourselves. currentTimeRef advances every
    // frame (smooth), but we only push React state at ~30Hz so the per-tick
    // `currentTime` memos don't re-run 60×/s.
    function tick(ts: number) {
      if (rafPrevRef.current !== null) {
        const dt = (ts - rafPrevRef.current) / 1000
        const cap = effectiveUrlRef.current ? Infinity : duration
        const next = currentTimeRef.current + dt
        // Stop at end of last clip
        if (next < cap) {
          currentTimeRef.current = next
          if (ts - rafLastEmitRef.current >= 33) {
            setCurrentTime(next)
            rafLastEmitRef.current = ts
          }
        }
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
        setIsPlaying(p => {
          const next = !p
          // Starting playback: re-seek the active video to exactly where the
          // playhead sits. Scrubbing can leave the element mis-seeked (its
          // currentTime lags, or you crossed a clip boundary), and without this
          // the first timeupdate snaps the playhead — the "jumps on space" bug.
          if (next && v) v.currentTime = Math.max(0, currentTimeRef.current - clipTimeOffsetRef.current)
          return next
        })
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
        const now = currentTimeRef.current
        const clipsAtPlayhead = timelineItems.filter(i =>
          now > i.startTime &&
          now < i.startTime + (i.outPoint - i.inPoint)
        )
        clipsAtPlayhead.forEach(clip => handleSplitItem(clip.id, now))
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
        handlePasteItem(trackId, currentTimeRef.current)
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
        e.preventDefault(); setInPoint(currentTimeRef.current); return
      }
      if (e.code === 'KeyO' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault(); setOutPoint(currentTimeRef.current); return
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
        const prev = points.find(p => p < currentTimeRef.current - 0.02)
        if (prev !== undefined) handleSeek(prev)
        return
      }
      if (e.code === 'ArrowDown' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        const points = [...new Set([...timelineItems.flatMap(i => [i.startTime, i.startTime + (i.outPoint - i.inPoint)])])].sort((a, b) => a - b)
        const next = points.find(p => p > currentTimeRef.current + 0.02)
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
          const availW = window.innerWidth - ((videoSidebarOpen ? videoLeftPanel.size : 0) + 40) - rightW - 60
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

  // ── Beat grid (per audio clip) ──────────────────────────────

  /** Detect BPM + downbeat from ONE clip's audio (source seconds). Used by the
   *  beat-grid editor's Detect button. Returns null on failure. */
  async function detectClipBpm(clip: TimelineItem): Promise<{ bpm: number; offsetSrc: number } | null> {
    if (!clip.url) return null
    try {
      const [{ estimateTempo }, ab] = await Promise.all([
        import('@/lib/beat-analyzer'),
        fetch(clip.url).then(r => r.arrayBuffer()),
      ])
      const ctx = new AudioContext()
      const buffer = await ctx.decodeAudioData(ab)
      ctx.close?.().catch(() => {})
      const { bpm, firstOnset } = estimateTempo(buffer)
      if (!bpm) return null
      return { bpm, offsetSrc: Math.max(0, firstOnset) }
    } catch {
      return null
    }
  }

  /** Save (or clear) a clip's tempo map from the beat-grid editor. */
  function handleSaveBeatMap(clipId: string, beatMap: TempoSeg[] | undefined) {
    setTimelineItems(prev => prev.map(i => i.id === clipId ? { ...i, beatMap } : i))
  }

  /** Split a clip at every beat (or bar) line its own tempo map puts inside it. */
  function handleSplitAtBeats(id: string, unit: 'beat' | 'bar') {
    setTimelineItems(prev => {
      const clip = prev.find(i => i.id === id)
      if (!clip?.beatMap?.length) return prev
      const { beats, bars } = clipBeatLines(clip)
      const lines = unit === 'bar' ? bars : beats
      const clipStart = clip.startTime
      const clipEnd = clip.startTime + (clip.outPoint - clip.inPoint)
      const cuts = lines.filter(t => t > clipStart + 0.05 && t < clipEnd - 0.05)
      if (!cuts.length) return prev
      const boundaries = [...cuts, clipEnd]
      const srcDur = clip.outPoint - clip.inPoint
      const kb = clip.kenBurns
      const lerp = (a: number, b: number, t: number) => a + (b - a) * t
      const segments: TimelineItem[] = []
      let segStart = clipStart
      let segIn = clip.inPoint
      boundaries.forEach((cut, idx) => {
        const segOut = segIn + (cut - segStart)
        const isFirst = idx === 0
        const isLast = idx === boundaries.length - 1
        // Interpolate the Ken Burns move so it stays continuous across segments
        // instead of restarting in each one.
        let segKb = kb
        if (kb && srcDur > 0) {
          const f0 = (segIn - clip.inPoint) / srcDur, f1 = (segOut - clip.inPoint) / srcDur
          segKb = {
            fromZoom: lerp(kb.fromZoom, kb.toZoom, f0), fromX: lerp(kb.fromX, kb.toX, f0), fromY: lerp(kb.fromY, kb.toY, f0),
            toZoom: lerp(kb.fromZoom, kb.toZoom, f1), toX: lerp(kb.fromX, kb.toX, f1), toY: lerp(kb.fromY, kb.toY, f1),
          }
        }
        segments.push({
          ...clip,
          id: isFirst ? clip.id : crypto.randomUUID(),
          startTime: segStart,
          inPoint: segIn,
          outPoint: segOut,
          kenBurns: segKb,
          // A transition-in / fade-in belongs to the head; a fade-out to the tail.
          transitionIn: isFirst ? clip.transitionIn : undefined,
          transitionDuration: isFirst ? clip.transitionDuration : undefined,
          fadeIn: isFirst ? clip.fadeIn : undefined,
          fadeOut: isLast ? clip.fadeOut : undefined,
        })
        segStart = cut
        segIn = segOut
      })
      return prev.flatMap(i => i.id === id ? segments : [i])
    })
  }

  /** Lock/unlock a linked DAW clip. Unlocking re-syncs it immediately. */
  function handleToggleDawLock(id: string) {
    const clip = timelineItemsRef.current.find(i => i.id === id)
    if (!clip?.dawMixLinked) return
    const nowLocked = !clip.dawMixLocked
    setTimelineItems(prev => prev.map(i => i.id === id ? { ...i, dawMixLocked: nowLocked } : i))
    if (!nowLocked) {
      // Back on the live link — catch up with the current audio right away.
      setTimeout(() => { void resyncLinkedClip(clip) }, 50)
    }
  }

  /** Effective sync mode for a linked clip. Default is SAVE-sync (re-bounce on
   *  save / reopen / source-save / manual re-sync) — real-time is opt-in per
   *  clip via the context menu. */
  const syncModeOf = (i: TimelineItem): 'live' | 'save' => i.dawMixSyncMode ?? 'save'

  /** Re-bounce one linked clip now, from the right source (own DAW or a linked
   *  project's saved mix). Used by unlock and by switching a clip to real-time. */
  function resyncLinkedClip(clip: TimelineItem) {
    if (clip.dawMixSourceProjectId) void resyncSource(clip.dawMixSourceProjectId)
    else void refreshDawMix(clip.dawMixTracks)
  }

  /** Toggle a linked clip between real-time and save-sync. Switching to
   *  real-time catches it up immediately; switching to save just stops the
   *  live re-bouncing (it'll refresh on the next save / reopen / re-sync). */
  function handleSetDawSyncMode(id: string) {
    const clip = timelineItemsRef.current.find(i => i.id === id)
    if (!clip?.dawMixLinked) return
    const next: 'live' | 'save' = syncModeOf(clip) === 'live' ? 'save' : 'live'
    setTimelineItems(prev => prev.map(i => i.id === id ? { ...i, dawMixSyncMode: next } : i))
    if (next === 'live') setTimeout(() => { void resyncLinkedClip(clip) }, 50)
  }

  /** Move a clip's start to the nearest beat across all clips' grids. */
  function handleQuantizeToBeat(id: string) {
    const lines = projectBeatLines(timelineItemsRef.current).beats
    if (!lines.length) return
    setTimelineItems(prev => prev.map(i => i.id === id ? { ...i, startTime: nearestSorted(lines, i.startTime) ?? i.startTime } : i))
  }

  /**
   * Bounce the DAW arrangement — or a single DAW track (a stem) — to a wav as
   * a LINKED clip. The first bounce of a selection creates its own audio track
   * and clip; later runs (manual, stale-on-load, live edits over the collab
   * room) re-render each linked selection and swap the media in place. Stems
   * always render the FULL arrangement window, so every linked clip stays
   * time-aligned with every other and with the full mix.
   */
  const sameSel = (a?: string[], b?: string[]) => [...(a ?? [])].sort().join(',') === [...(b ?? [])].sort().join(',')
  // A linked clip's identity is (source project, track selection). Absent source = this project's own DAW.
  const sameLink = (i: TimelineItem, trackIds: string[] | undefined, src: string | undefined) =>
    !!i.dawMixLinked && sameSel(i.dawMixTracks, trackIds) && (i.dawMixSourceProjectId ?? undefined) === (src ?? undefined)
  const dawMixBusyRef = useRef(false)
  // Set when the own-project DAW changes; lets a save-sync mix skip live
  // re-bounces yet still refresh on the next save.
  const dawDirtyRef = useRef(false)
  // Last cross-project render error, surfaced in the "rendered empty" alert so a
  // failed sync self-reports (was a silent catch — impossible to diagnose).
  const lastMixErrorRef = useRef<string>('')
  // Audio fingerprint of the last render per link key — lets a re-sync skip the
  // bounce when the source's sound is unchanged. See dawAudioFingerprint.
  const lastRenderFpRef = useRef<Map<string, string>>(new Map())
  // Per-track stem cache per link key, so a re-sync re-renders only the
  // tracks whose audio changed (see renderProjectMixCached).
  const stemCacheRef = useRef<Map<string, Map<string, import('@/lib/song-video/render-audio').StemEntry>>>(new Map())

  // Re-uploads of a linked mix wait for the edits to settle (8 s after the
  // last refresh) so a burst of live changes doesn't push transient renders
  // to R2. The blob URL is live immediately either way.
  const linkedUploadTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  function scheduleLinkedUpload(mediaId: string, file: File) {
    const timers = linkedUploadTimersRef.current
    const prior = timers.get(mediaId)
    if (prior) clearTimeout(prior)
    timers.set(mediaId, setTimeout(() => {
      timers.delete(mediaId)
      void uploadMediaToR2(file, mediaId)
    }, 8000))
  }

  async function refreshDawMix(trackIds?: string[], stamp?: string) {
    const daw = dawProjectRef.current
    if (!daw || dawMixBusyRef.current) return
    dawMixBusyRef.current = true
    try {
      await renderDawSelection(daw, trackIds, stamp ?? new Date().toISOString())
    } finally {
      dawMixBusyRef.current = false
    }
  }

  /** Re-render EVERY linked selection (live edits, stale-on-load). `opts.modes`
   *  restricts to clips of those sync modes (live path passes ['live']; the
   *  post-save path passes ['save']; load/rehydrate pass nothing = all). */
  const mixRerunPendingRef = useRef(false)
  async function refreshAllDawMixes(stamp?: string, opts?: { modes?: ('live' | 'save')[] }) {
    if (dawMixBusyRef.current) {
      // An edit landed mid-render — run again when this pass finishes so the
      // final audio state is never silently skipped.
      mixRerunPendingRef.current = true
      return
    }
    // Each distinct (source project, track selection) renders from the right
    // DawProject: this project's own DAW (no source) or a linked source replica.
    const links: Array<{ src?: string; tracks?: string[] }> = []
    for (const i of timelineItemsRef.current) {
      // Locked clips keep their render — only links with an unlocked clip refresh.
      if (i.dawMixLinked && !i.dawMixLocked &&
          (!opts?.modes || opts.modes.includes(syncModeOf(i))) &&
          !links.some(l => (l.src ?? undefined) === (i.dawMixSourceProjectId ?? undefined) && sameSel(l.tracks, i.dawMixTracks)))
        links.push({ src: i.dawMixSourceProjectId, tracks: i.dawMixTracks })
    }
    if (!links.length) return
    // Clear the own-DAW dirty flag only when this pass actually covers save-mode
    // clips (all-modes or an explicit ['save']). A live-only pass must NOT clear
    // it, or a later save would skip the save-mode clip's refresh.
    if (!opts?.modes || opts.modes.includes('save')) dawDirtyRef.current = false
    dawMixBusyRef.current = true
    const stampVal = stamp ?? new Date().toISOString()
    try {
      for (const l of links) {
        const daw = l.src ? sourceReplicasRef.current.get(l.src) : dawProjectRef.current
        if (!daw) continue
        await renderDawSelection(daw, l.tracks, stampVal, l.src, l.src ? sourceNamesRef.current.get(l.src) : undefined)
      }
    } finally {
      dawMixBusyRef.current = false
      if (mixRerunPendingRef.current) {
        mixRerunPendingRef.current = false
        void refreshAllDawMixesRef.current()
      }
    }
  }

  async function renderDawSelection(daw: import('@/lib/daw-types').DawProject, trackIds: string[] | undefined, stampVal: string, src?: string, srcLabel?: string) {
    // The window always spans the FULL arrangement so stems stay aligned.
    const endBeat = (daw.arrangementClips ?? []).reduce((m, c) => Math.max(m, c.startBeat + (c.durationBeats ?? 0)), 0)
    if (endBeat <= 0) { setBounceStatus('error'); setTimeout(() => setBounceStatus('idle'), 2500); return }
    // Skip the (expensive) bounce when the source's audio content is byte-for-byte
    // what we already rendered for this link — the common case for reopen, focus
    // re-syncs, and saves that didn't touch the sound.
    const linkKey = `${src ?? 'own'}::${[...(trackIds ?? [])].sort().join(',')}`
    const fp = dawAudioFingerprint(daw)
    const alreadyLinked = timelineItemsRef.current.some(i => sameLink(i, trackIds, src))
    if (alreadyLinked && lastRenderFpRef.current.get(linkKey) === fp) {
      setBounceStatus('idle')
      return
    }
    setBounceStatus('working')
    try {
      const isStem = !!trackIds?.length
      const source = isStem ? {
        ...daw,
        // Clip filter isolates the stem; muting the rest is belt-and-braces.
        arrangementClips: (daw.arrangementClips ?? []).filter(c => trackIds!.includes(c.trackId)),
        tracks: daw.tracks.map(t => trackIds!.includes(t.id) ? t : { ...t, mute: true }),
      } : daw
      const stemNames = isStem
        ? daw.tracks.filter(t => trackIds!.includes(t.id)).map(t => t.name || 'Track')
        : []
      const label = src
        ? (srcLabel || 'Linked mix')
        : isStem
          ? `DAW: ${stemNames.slice(0, 2).join(' + ')}${stemNames.length > 2 ? ` +${stemNames.length - 2}` : ''}`
          : 'DAW Mix'

      const { renderProjectAudioBlob, renderProjectMixCached } = await import('@/lib/song-video/render-audio')
      // Full-mix syncs use the per-track stem cache (re-render only changed tracks);
      // single-track stem selections render directly.
      let stemCache = stemCacheRef.current.get(linkKey)
      if (!stemCache) { stemCache = new Map(); stemCacheRef.current.set(linkKey, stemCache) }
      const { blob, durationSec, peaks: renderedPeaks } = isStem
        ? await renderProjectAudioBlob(source, { startBeat: 0, endBeat, userId: user?.id })
        : await renderProjectMixCached(source, { startBeat: 0, endBeat, userId: user?.id }, stemCache)
      const baseName = src ? (srcLabel || 'Linked project') : (localProjectName || 'Project')
      // The render is compressed (AAC/.m4a) when the browser can, else WAV —
      // name the file from the blob's actual type so the presign guesses right.
      const mime = blob.type || 'audio/wav'
      const ext = mime.includes('mp4') || mime.includes('m4a') ? '.m4a' : mime.includes('mpeg') ? '.mp3' : '.wav'
      const file = new File([blob], `${baseName} ${isStem ? stemNames.join('+') : 'mix'}${ext}`, { type: mime })
      const url = URL.createObjectURL(file)
      // Duration comes straight from the render (no extra <audio> metadata decode).
      const dur = durationSec

      const siblings = timelineItemsRef.current.filter(i => sameLink(i, trackIds, src))
      const linked = siblings.find(i => !i.dawMixLocked)
      const hasLockedSibling = siblings.some(i => i.dawMixLocked && i.url === linked?.url)
      if (linked) {
        // Replace in place: same media item, same clip — new audio. `file`
        // must follow too: the audio-only ffmpeg export path reads it. When a
        // LOCKED copy shares this media, fork instead: the unlocked clips get
        // a fresh media item and the locked one keeps its frozen render.
        const media = mediaItemsRef.current.find(m => m.url === linked.url)
        const prevUrl = linked.url
        if (media && !hasLockedSibling) {
          setMediaItems(prev => prev.map(m => m.id === media.id
            ? { ...m, url, file, duration: dur, peaks: undefined, uploadStatus: 'uploading' as const }
            : m))
          // Live edits arrive in bursts — upload only the settled render.
          scheduleLinkedUpload(media.id, file)
        } else {
          const mediaId = crypto.randomUUID()
          setMediaItems(prev => [...prev, { id: mediaId, name: file.name, contentType: 'audio', url, file, duration: dur, uploadStatus: 'uploading' }])
          scheduleLinkedUpload(mediaId, file)
        }
        setTimelineItems(prev => prev.map(i => {
          if (!(sameLink(i, trackIds, src) && !i.dawMixLocked)) return i
          // Untrimmed clips follow the new mix length; trimmed ones just clamp.
          const wasFull = i.inPoint === 0 && (!media?.duration || Math.abs((i.outPoint - i.inPoint) - media.duration) < 0.05)
          return {
            ...i, url,
            dawMixStamp: stampVal,
            inPoint: Math.min(i.inPoint, Math.max(0, dur - 0.1)),
            outPoint: wasFull ? dur : Math.min(i.outPoint, dur),
          }
        }))
        if (prevUrl?.startsWith('blob:') && !hasLockedSibling) URL.revokeObjectURL(prevUrl)
      } else {
        // First bounce of this selection: its own audio track + linked clip.
        const mediaId = crypto.randomUUID()
        setMediaItems(prev => [...prev, { id: mediaId, name: file.name, contentType: 'audio', url, file, duration: dur, uploadStatus: 'uploading' }])
        uploadMediaToR2(file, mediaId)
        const trackLabel = src ? (srcLabel || 'Linked').slice(0, 10) : isStem ? (stemNames[0] ?? 'DAW').slice(0, 8) : 'DAW'
        const trackId = crypto.randomUUID()
        setTracks(prev => [...prev, { id: trackId, label: trackLabel, type: 'audio', height: AUDIO_TRACK_HEIGHT }])
        setTimelineItems(prev => [...prev, {
          id: crypto.randomUUID(),
          label,
          startTime: 0, inPoint: 0, outPoint: dur,
          captions: [], color: src ? '#8b5cf6' : '#3b82f6',
          trackId, url, contentType: 'audio',
          dawMixLinked: true, dawMixStamp: stampVal,
          dawMixTracks: trackIds?.length ? [...trackIds] : undefined,
          dawMixSourceProjectId: src,
        }])
      }
      // Peaks came back with the render — no re-decode of the file needed.
      if (renderedPeaks.length) setMediaItems(prev => prev.map(m => m.url === url ? { ...m, peaks: renderedPeaks } : m))
      // NOTE: the beat grid is NOT seeded from the linked DAW tempo — the video
      // module's snap points come from each audio clip's own beat map (set via
      // its right-click menu), which always takes priority.
      lastMixErrorRef.current = ''
      lastRenderFpRef.current.set(linkKey, fp)   // remember what we rendered so an unchanged re-sync skips
      setBounceStatus('idle')
    } catch (e) {
      lastMixErrorRef.current = e instanceof Error ? e.message : String(e)
      console.error('[dawmix] render failed', e)
      setBounceStatus('error')
      setTimeout(() => setBounceStatus('idle'), 2500)
    }
  }

  const refreshAllDawMixesRef = useRef(refreshAllDawMixes)
  refreshAllDawMixesRef.current = refreshAllDawMixes
  function handleBounceDawMix(trackIds?: string[]) { void refreshDawMix(trackIds) }

  // Debounced re-render of every linked mix (own + cross-project sources) behind
  // the last edit, so a burst of changes renders once. Shared by the own-project
  // live link and every cross-project source's live link.
  const liveMixTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  function scheduleMixRefresh(live: boolean) {
    if (liveMixTimerRef.current) clearTimeout(liveMixTimerRef.current)
    liveMixTimerRef.current = setTimeout(() => {
      // Only real-time links re-bounce on edits; save-sync links wait for a save.
      if (timelineItemsRef.current.some(i => i.dawMixLinked && !i.dawMixLocked && syncModeOf(i) === 'live'))
        void refreshAllDawMixesRef.current(undefined, { modes: ['live'] })
    }, live ? 2500 : 1200)
  }

  // ── Cross-project links: PULL a source in, or PUSH this mix to a target ───────
  async function openProjectPicker(mode: 'link' | 'send' = 'link') {
    setPickerMode(mode)
    setShowProjectPicker(true)
    if (pickerProjects) return
    try {
      const r = await fetch('/api/projects')
      const data = r.ok ? await r.json() as Array<{ id: string; name: string }> : []
      // Don't offer to link a project to itself.
      setPickerProjects(data.filter(p => p.id !== savedProjectId))
    } catch { setPickerProjects([]) }
  }
  // PUSH: stash this project as the source under the target, then open the target,
  // which resolves the link on load (see the push-target effect). One-shot.
  function sendToTarget(targetId: string) {
    setShowProjectPicker(false)
    try { localStorage.setItem(`cf_link_source_${targetId}`, savedProjectId) } catch { /* storage unavailable */ }
    window.location.assign(`/projects/${targetId}`)
  }
  // Reload: re-fetch each linked source so its live replica + listener come back.
  // Sync-on-save: fetch a linked source's latest SAVED arrangement (the studio
  // persists to the DB on save) and cache it as the replica we render from.
  // This is the authoritative state — unlike the live collab room, which is
  // empty when the source project isn't open. Returns null if unreachable or
  // it carries no audio.
  async function pullSavedSource(sid: string): Promise<import('@/lib/daw-types').DawProject | null> {
    try {
      const r = await fetch(`/api/projects/${sid}`)
      if (!r.ok) return null
      const cf = await r.json() as { name?: string; dawProject?: import('@/lib/daw-types').DawProject }
      if (!cf.dawProject?.tracks?.length) return null
      sourceReplicasRef.current.set(sid, cf.dawProject)
      if (cf.name) sourceNamesRef.current.set(sid, cf.name)
      return cf.dawProject
    } catch { return null }
  }

  // Manual "Re-sync" on a linked project: pull its latest saved mix, re-bounce.
  async function resyncSource(sid: string, opts?: { silent?: boolean }) {
    setBounceStatus('working')
    const daw = await pullSavedSource(sid)
    if (!daw) {
      setBounceStatus('error')
      setTimeout(() => setBounceStatus('idle'), 2500)
      if (!opts?.silent) window.alert(`Couldn't re-sync that project — it may be unreachable or have no audio.`)
      return
    }
    await renderDawSelection(daw, undefined, new Date().toISOString(), sid, sourceNamesRef.current.get(sid))
  }
  const resyncSourceRef = useRef(resyncSource)
  resyncSourceRef.current = resyncSource

  // Sync-on-save auto-detect: while sources are linked, watch each source's
  // savedAt (via the cheap projects list — one request, no full download) and
  // re-pull when it advances. This is what makes saving the ORIGINAL audio
  // project update the linked video clip — no manual re-sync needed. Runs on an
  // interval and whenever the tab regains focus (so switching back from the
  // audio tab syncs right away). Locked clips are left frozen.
  useEffect(() => {
    if (!linkedSourceIds.length) return
    let alive = true
    let checking = false   // in-flight guard: never run two checks at once (they'd interleave renders)
    let lastAt = 0
    async function check() {
      if (!alive || checking || (typeof document !== 'undefined' && document.visibilityState === 'hidden')) return
      checking = true
      try {
        const r = await fetch('/api/projects')
        if (!r.ok) return
        const list = await r.json() as Array<{ id: string; savedAt?: string }>
        const byId = new Map(list.map(p => [p.id, p.savedAt ?? '']))
        for (const sid of linkedSourceIds) {
          const remote = byId.get(sid)
          if (!remote) continue
          const rt = new Date(remote).getTime()
          if (!Number.isFinite(rt)) continue   // unparseable savedAt — skip rather than NaN-compare
          const seen = sourceSyncedAtRef.current.get(sid)
          // First sighting = establish the baseline, don't re-render.
          if (seen == null) { sourceSyncedAtRef.current.set(sid, remote); continue }
          const changed = rt > new Date(seen).getTime()
          const hasUnlocked = timelineItemsRef.current.some(i =>
            i.dawMixLinked && !i.dawMixLocked && i.dawMixSourceProjectId === sid)
          if (changed && hasUnlocked) {
            sourceSyncedAtRef.current.set(sid, remote)   // record before await so we don't double-fire
            await resyncSourceRef.current(sid, { silent: true })
          } else if (changed) {
            sourceSyncedAtRef.current.set(sid, remote)
          }
        }
      } catch { /* transient — try again next tick */ }
      finally { checking = false; lastAt = Date.now() }
    }
    void check()
    const iv = setInterval(check, 15000)
    // focus + visibilitychange both fire on a single tab switch — coalesce them
    // with a short cooldown so returning to the tab does ONE check, not two.
    const onVis = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
      if (Date.now() - lastAt < 3000) return
      void check()
    }
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('focus', onVis)
    return () => { alive = false; clearInterval(iv); document.removeEventListener('visibilitychange', onVis); window.removeEventListener('focus', onVis) }
  }, [linkedSourceIds]) // eslint-disable-line react-hooks/exhaustive-deps

  // Free cached stem PCM (tens of MB each) + fingerprints for sources that are no
  // longer linked, so linking/unlinking over a session doesn't leak memory.
  useEffect(() => {
    const linked = new Set(linkedSourceIds)
    for (const map of [stemCacheRef.current, lastRenderFpRef.current]) {
      for (const key of Array.from(map.keys())) {
        const src = key.split('::')[0]
        if (src !== 'own' && !linked.has(src)) (map as Map<string, unknown>).delete(key)
      }
    }
  }, [linkedSourceIds])

  async function rehydrateLinkedSources(sourceIds: string[]) {
    // Always re-pull the saved state so opening the video syncs it to whatever
    // the linked audio project last saved (rather than a stale cached replica).
    const fetched: string[] = []
    for (const sid of sourceIds) {
      if (await pullSavedSource(sid)) fetched.push(sid)
    }
    if (fetched.length) {
      setLinkedSourceIds(prev => Array.from(new Set([...prev, ...fetched])))
      void refreshAllDawMixesRef.current()   // re-render from the fresh sources
    }
  }
  async function handleLinkProject(sourceId: string, sourceName: string) {
    setShowProjectPicker(false)
    if (linkedSourceIds.includes(sourceId) && sourceReplicasRef.current.has(sourceId)) {
      // Already linked — just re-sync it.
      void renderDawSelection(sourceReplicasRef.current.get(sourceId)!, undefined, new Date().toISOString(), sourceId, sourceNamesRef.current.get(sourceId))
      return
    }
    setBounceStatus('working')
    try {
      const r = await fetch(`/api/projects/${sourceId}`)
      if (!r.ok) throw new Error('fetch failed')
      const cf = await r.json() as { name?: string; dawProject?: import('@/lib/daw-types').DawProject }
      const daw = cf.dawProject
      if (!daw || !Array.isArray(daw.tracks) || !daw.tracks.length) {
        window.alert(`“${sourceName}” has no audio to sync.`)
        setBounceStatus('idle')
        return
      }
      const name = sourceName || cf.name || 'Linked project'
      sourceReplicasRef.current.set(sourceId, daw)
      sourceNamesRef.current.set(sourceId, name)
      setLinkedSourceIds(prev => prev.includes(sourceId) ? prev : [...prev, sourceId])   // tracks the link for the Linked-projects UI + load-time re-pull
      await renderDawSelection(daw, undefined, new Date().toISOString(), sourceId, name)
      // If nothing landed on the timeline, the render came back empty/silent —
      // say so instead of leaving the user staring at an empty pool.
      if (!timelineItemsRef.current.some(i => i.dawMixLinked && i.dawMixSourceProjectId === sourceId)) {
        const why = lastMixErrorRef.current ? `\n\nReason: ${lastMixErrorRef.current}` : ''
        window.alert(`Linked “${name}”, but its mix rendered empty — the project may have no audible clips, or its sounds couldn't load here (e.g. recorded/imported audio that was never uploaded to the cloud).${why}`)
      }
    } catch (err) {
      setBounceStatus('error')
      setTimeout(() => setBounceStatus('idle'), 2500)
      window.alert(`Couldn't sync “${sourceName || 'that project'}” in: ${err instanceof Error ? err.message : 'render failed'}.`)
    }
  }

  // Live audio→video: edits arriving over the project's collab room update the
  // DawProject replica immediately; the actual re-bounce debounces behind the
  // last edit so a burst of changes renders once.
  function handleLiveDawProject(project: import('@/lib/daw-types').DawProject, live: boolean) {
    dawProjectRef.current = project
    setHasDawProject(true)
    // Guard: the track list rarely changes — don't re-render per action.
    const derived = deriveDawTracks(project)
    setDawTracks(prev =>
      prev.length === derived.length && prev.every((t, i) => t.id === derived[i].id && t.name === derived[i].name)
        ? prev
        : derived)
    // Only auto-render when an UNLOCKED mix is linked — a project that never
    // bounced stays manual, and locked links keep their frozen render.
    dawDirtyRef.current = true   // a save-sync mix will pick this up on save
    scheduleMixRefresh(live)
  }

  // Stale mix detected during load → refresh once state has settled.
  useEffect(() => {
    if (!pendingMixRefreshRef.current || !hasDawProject) return
    const stamp = pendingMixRefreshRef.current
    pendingMixRefreshRef.current = null
    void refreshAllDawMixesRef.current(stamp)
  }, [hasDawProject]) // eslint-disable-line

  // PUSH target: another editor sent this project a link via "Send to project"
  // (stashed the source id under our project). Resolve it once loaded, reusing
  // the same pull path so it lands as a live linked clip.
  const pushLinkDoneRef = useRef(false)
  useEffect(() => {
    if (isLoadingProject || pushLinkDoneRef.current) return
    pushLinkDoneRef.current = true
    try {
      const key = `cf_link_source_${savedProjectId}`
      const src = localStorage.getItem(key)
      if (src && src !== savedProjectId) { localStorage.removeItem(key); void handleLinkProject(src, '') }
    } catch { /* storage unavailable */ }
  }, [isLoadingProject]) // eslint-disable-line

  // Sync timers die with the editor.
  useEffect(() => () => {
    if (liveMixTimerRef.current) clearTimeout(liveMixTimerRef.current)
    for (const t of linkedUploadTimersRef.current.values()) clearTimeout(t)
    linkedUploadTimersRef.current.clear()
  }, [])

  // Blade split: split a clip at a given timeline time.
  function handleSplitItem(id: string, atTime: number) {
    setTimelineItems(prev => {
      const clip = prev.find(i => i.id === id)
      if (!clip) return prev
      const splitSource = atTime - clip.startTime + clip.inPoint
      if (splitSource <= clip.inPoint + 0.05 || splitSource >= clip.outPoint - 0.05) return prev
      const f = (splitSource - clip.inPoint) / (clip.outPoint - clip.inPoint)   // 0..1 cut point in the clip
      // Ken Burns: keep the move continuous across the cut by splitting it at the
      // interpolated midpoint instead of restarting the full move in each half.
      let kbA = clip.kenBurns, kbB = clip.kenBurns
      if (clip.kenBurns) {
        const kb = clip.kenBurns
        const lerp = (a: number, b: number) => a + (b - a) * f
        const mZoom = lerp(kb.fromZoom, kb.toZoom), mX = lerp(kb.fromX, kb.toX), mY = lerp(kb.fromY, kb.toY)
        kbA = { fromZoom: kb.fromZoom, fromX: kb.fromX, fromY: kb.fromY, toZoom: mZoom, toX: mX, toY: mY }
        kbB = { fromZoom: mZoom, fromX: mX, fromY: mY, toZoom: kb.toZoom, toX: kb.toX, toY: kb.toY }
      }
      const clipA: TimelineItem = {
        ...clip, outPoint: splitSource, kenBurns: kbA,
        // The fade-out belongs to the tail now — a mid-clip fade-out would dip to black at the cut.
        fadeOut: undefined,
      }
      const clipB: TimelineItem = {
        ...clip, id: crypto.randomUUID(), startTime: atTime, inPoint: splitSource, kenBurns: kbB,
        // The tail keeps its fade-out but not the head-only fade-in or transition-in
        // (both would otherwise re-play from black at the cut).
        fadeIn: undefined, transitionIn: undefined, transitionDuration: undefined,
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

    // Detect via the shared helper (MIME first, then extension) so containers
    // that arrive with an empty type (.mkv/.mov/.avi…) still file as video.
    const ct: ContentType = detectMediaKind(file) === 'audio' ? 'audio' : 'video'
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

    // Probe duration (fast for local blob URLs) and update the pool entry.
    // A video whose metadata won't load (duration 0) is one the browser can't
    // decode — flag it so the pool explains the blank preview instead of looking
    // silently broken. Server-side transcription can still work; editing needs
    // an H.264/AAC MP4 (or WebM).
    readDuration(url, ct).then((dur) => {
      const undecodable = !(dur > 0)   // metadata never loaded → browser can't decode it
      setMediaItems(prev => prev.map(m => m.id === id ? {
        ...m,
        duration: dur,
        warn: undecodable
          ? (ct === 'video'
              ? 'This video’s codec isn’t supported for preview in the browser. It still imports and can be transcribed, but to edit/see it here, convert it to an H.264 MP4.'
              : 'This audio’s codec isn’t supported in the browser. It still imports and can be transcribed; convert it to MP3 or WAV to preview/edit it here.')
          : m.warn,
      } : m))
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

  // Open / Import Files — pick a project (.cfproj / Firefly .zip) to open in place,
  // or raw media (mp4/mov/mp3…) which opens a fresh video project seeded with it.
  // Same picker the All Projects page uses.
  async function handleOpenImport() {
    const read = await openProjectsFromFile().catch(() => null)
    if (!read) return
    if (read.media.length) { await openMediaInStudio(read.media); return }
    const proj = read.projects[0]
    if (!proj) { if (read.errors.length) window.alert(read.errors[0]); return }
    if (isDirty && !window.confirm('Open a different project? Unsaved changes to the current one will be lost.')) return
    await loadCfproj(JSON.stringify(proj))
    setLocalProjectName(proj.name || 'Untitled')
  }

  // Re-attempt a failed upload for a media item that still holds its File (e.g.
  // a linked mix whose PUT to R2 failed). Clears the error and re-uploads.
  function handleRetryUpload(id: string) {
    const item = mediaItemsRef.current.find(m => m.id === id)
    if (!item?.file) { setTranscribeError('Can’t retry — re-sync this clip to regenerate its audio, then it will upload again.'); return }
    setMediaItems(prev => prev.map(m => m.id === id ? { ...m, uploadStatus: 'uploading', uploadError: undefined } : m))
    void uploadMediaToR2(item.file, id)
  }

  // Mark an item uploaded + register it in the account library (shared by the
  // direct and proxied upload paths).
  function markUploaded(mediaId: string, key: string, file: File, contentType: string) {
    setMediaItems(prev => prev.map(m => m.id === mediaId ? { ...m, r2Key: key, uploadStatus: 'uploaded', uploadError: undefined } : m))
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
  }

  // Fallback: POST the bytes through our own server, which PUTs to R2 (no browser
  // CORS involved). Only for files under the proxy's size cap. Reports the real
  // reason on failure so a stuck upload is diagnosable.
  async function proxyUpload(file: File, mediaId: string): Promise<{ ok: true; key: string } | { ok: false; reason: string }> {
    if (file.size > 4 * 1024 * 1024) return { ok: false, reason: `${(file.size / 1048576).toFixed(1)}MB exceeds the 4MB server-upload cap` }
    // Send only the extension in a header (ASCII-safe) — a full filename can carry
    // non-latin1 characters that make fetch throw when set as a header value.
    const ext = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.')).toLowerCase() : ''
    try {
      const res = await fetch('/api/media/upload', {
        method: 'POST',
        headers: {
          'Content-Type': file.type || 'application/octet-stream',
          'x-media-id': mediaId,
          'x-ext': ext,
        },
        body: file,
      })
      if (res.ok) {
        const { key } = await res.json() as { key: string }
        return key ? { ok: true, key } : { ok: false, reason: 'server returned no key' }
      }
      const body = await res.json().catch(() => ({})) as { error?: string }
      return { ok: false, reason: `server ${res.status}${body.error ? `: ${body.error}` : ''}` }
    } catch (e) { return { ok: false, reason: `request failed: ${e instanceof Error ? e.message : String(e)}` } }
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
          ? (err.error ?? 'File is too large. Maximum size is 500 MB.')
          : (err.error ?? `Upload rejected (${presignRes.status})`)
        setMediaItems(prev => prev.map(m => m.id === mediaId ? { ...m, uploadStatus: 'error', uploadError: msg } : m))
        setTranscribeError(msg)
        return
      }
      const { uploadUrl, key } = await presignRes.json() as { uploadUrl: string; key: string }

      // Try the direct presigned PUT first (offloads bandwidth from our server).
      let direct = false
      try {
        const putRes = await fetch(uploadUrl, {
          method: 'PUT',
          body: file,
          headers: { 'Content-Type': contentType || 'application/octet-stream' },
        })
        direct = putRes.ok
      } catch { direct = false }

      if (direct) { markUploaded(mediaId, key, file, contentType); return }

      // Direct PUT was blocked (typically R2 CORS) — fall back through our server.
      const proxied = await proxyUpload(file, mediaId)
      if (proxied.ok) { markUploaded(mediaId, proxied.key, file, contentType); return }

      const msg = `Upload blocked (R2 CORS); server fallback also failed — ${proxied.reason}. Add the R2 CORS rule for this origin.`
      setMediaItems(prev => prev.map(m => m.id === mediaId ? { ...m, uploadStatus: 'error', uploadError: msg } : m))
      setTranscribeError(msg)
    } catch (err) {
      // Presign or something unexpected threw — last-ditch proxy attempt.
      const proxied = await proxyUpload(file, mediaId)
      if (proxied.ok) { markUploaded(mediaId, proxied.key, file, contentType); return }
      const raw = err instanceof Error ? err.message : 'Upload failed'
      setMediaItems(prev => prev.map(m => m.id === mediaId ? { ...m, uploadStatus: 'error', uploadError: `${raw}; server fallback: ${proxied.reason}` } : m))
      setTranscribeError(raw)
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

  // Add a Pexels stock clip (link-only): the clip's `url` is the Pexels CDN URL — no download, no
  // upload, no storage (mirrors Lightning Bug). Duration is probed from the URL by addMediaToTimeline.
  function handleAddStock(clip: StockClip) {
    const id = 'pexels-' + clip.id
    const media: MediaItem = { id, name: clip.title || 'Stock clip', contentType: 'video', url: clip.mp4, thumbnail: clip.poster || undefined }
    if (!mediaItems.some(m => m.id === id)) setMediaItems(prev => [...prev, media])
    setSelectedMediaId(id)
    void addMediaToTimeline(media)
  }

  // Insert a text/title clip at the playhead (the title system was fully built —
  // model, Inspector editor, renderer — but had no way to create one).
  function addTitleClip() {
    const track = tracks.find(t => t.type === 'media' || t.type === 'video') ?? tracks[0]
    const trackId = track?.id ?? 'v1'
    const at = currentTimeRef.current
    const newItem: TimelineItem = {
      id: crypto.randomUUID(),
      label: 'Title',
      startTime: at, inPoint: 0, outPoint: 3,
      captions: [], color: CLIP_COLORS[timelineItems.length % CLIP_COLORS.length],
      trackId, contentType: 'title',
      titleText: 'Your title', titleFontSize: 48, titleColor: '#ffffff',
      titleBg: 'transparent', titlePosition: 'center', titleAnimation: 'fade',
    }
    setTimelineItems(prev => [...prev, newItem])
    setSelectedId(newItem.id)
    handleSeek(at)
  }

  // Auto-edit — build a beat-synced montage from the video clips in the media pool over the audio bed.
  // Cuts land on musical bars when the audio carries a beat map (else a steady cadence). Powers both the
  // toolbar button and window.__video.autoEdit (the AI/agent surface). No-op + note if there's nothing
  // to work with. Undoable (goes through the history-tracked setTimelineItems).
  const [autoEditNote, setAutoEditNote] = useState<string | null>(null)
  const runAutoEdit = useCallback((options?: AutoEditOptions) => {
    const items = timelineItemsRef.current
    const trks = tracksRef.current
    const trackId = (trks.find(t => t.type === 'media' || t.type === 'video')?.id) ?? 'v1'
    const audioIds = new Set(trks.filter(t => t.type === 'audio').map(t => t.id))
    const endOf = (i: TimelineItem) => i.startTime + (i.outPoint - i.inPoint) / (i.speed && i.speed > 0 ? i.speed : 1)
    // The bed = audio-content items (robust to which track they sit on). When there's a bed, the montage
    // spans the SONG and each clip is TRIMMED to its cut — "shortening" long footage to fit the music.
    // With no audio, fall back to the footage's own extent.
    const audioItems = items.filter(i => i.contentType === 'audio' || audioIds.has(i.trackId))
    const songEnd = (audioItems.length ? audioItems : items).reduce((m, i) => Math.max(m, endOf(i)), 0)
    let pool = mediaItemsRef.current.filter(m => m.contentType === 'video' && m.url).map(m => ({ url: m.url as string, duration: m.duration, label: m.name }))
    if (!pool.length) pool = items.filter(i => i.trackId === trackId && i.url && i.contentType === 'video').map(i => ({ url: i.url as string, duration: undefined, label: i.label }))
    if (!pool.length) { setAutoEditNote('Add some video clips first — try the Stock tab.'); return { cuts: 0 } }
    if (songEnd <= 0.2) { setAutoEditNote('Add an audio track to edit to.'); return { cuts: 0 } }
    const { beats, bars } = projectBeatLines(items)
    const keepItems = items.filter(i => i.trackId !== trackId)
    const res = autoEditTimeline({ keepItems, pool, trackId, songEnd, bars, beats, startAt: 0, options })
    setTimelineItems(res.items)
    setSelectedId(null)
    setAutoEditNote(`Auto-edit: ${res.cuts} cuts over ${Math.round(songEnd)}s ${bars.length ? 'synced to the beat.' : '(steady cadence — add a beat map for beat-sync).'}`)
    return res
  }, [setTimelineItems])

  // Clear the auto-edit note after a moment.
  useEffect(() => { if (!autoEditNote) return; const t = setTimeout(() => setAutoEditNote(null), 4000); return () => clearTimeout(t) }, [autoEditNote])

  // Effects — apply a named look (lib/video-effects) to clips. buildClipGradeFilter renders it in BOTH
  // the preview and the export, so what you see is what renders. Applies to the given clip ids.
  const [fxOpen, setFxOpen] = useState(false)
  const [fxScopeAll, setFxScopeAll] = useState(false)
  const applyEffect = useCallback((effectId: string | null, ids: string[]) => {
    if (!ids.length) { setAutoEditNote('Select a clip (or add video) to apply an effect.'); return 0 }
    const set = new Set(ids)
    setTimelineItems(prev => prev.map(i => set.has(i.id) ? { ...i, look: effectId || undefined } : i))
    const nm = getEffect(effectId)?.name
    setAutoEditNote(effectId ? `Applied “${nm}” to ${ids.length} clip${ids.length > 1 ? 's' : ''}.` : `Cleared effect on ${ids.length} clip${ids.length > 1 ? 's' : ''}.`)
    return ids.length
  }, [setTimelineItems])

  // Add an EFFECT ITEM — a timeline item (contentType 'effect') that grades the frame for its span. This
  // is the third item type (with video + audio), and it lives on the same unified track as everything
  // else. Restyle it by selecting it and picking a look in the Effects popover; drag/trim to place it.
  const addEffectItem = useCallback((lookId?: string) => {
    const trackId = (tracksRef.current.find(t => t.type === 'media' || t.type === 'video')?.id) ?? 'v1'
    const look = lookId ?? VIDEO_EFFECTS[0].id
    const newItem: TimelineItem = {
      id: crypto.randomUUID(), label: getEffect(look)?.name ?? 'Effect',
      startTime: currentTimeRef.current, inPoint: 0, outPoint: 3, captions: [],
      color: '#a855f7', trackId, contentType: 'effect', look,
    }
    setTimelineItems(prev => [...prev, newItem])
    setSelectedId(newItem.id)
    setAutoEditNote(`Added “${getEffect(look)?.name}” effect item — drag to place; restyle in Effects.`)
    return newItem.id
  }, [setTimelineItems])

  // ── Multicam spotlight ─────────────────────────────────────────────────────
  const [fxOpenMc, setFxOpenMc] = useState(false)
  // Camera tracks = tracks that carry video. Multicam switches the spotlight between them.
  const cameraTrackIds = useMemo(() => tracks.filter(t => timelineItems.some(i => i.trackId === t.id && i.contentType === 'video')).map(t => t.id), [tracks, timelineItems])
  // Per-track audio energy at t (0..1) from the item's waveform peaks — drives "cut to the loudest".
  const trackEnergyAt = useCallback((trackId: string, t: number) => {
    const it = timelineItemsRef.current.find(i => i.trackId === trackId && (i.contentType === 'audio' || i.contentType === 'video') && t >= i.startTime && t < i.startTime + (i.outPoint - i.inPoint))
    if (!it || !it.url) return 0
    const peaks = mediaItemsRef.current.find(m => m.url === it.url)?.peaks
    if (!peaks || !peaks.length) return 0
    const span = (it.outPoint - it.inPoint) || 1
    const frac = Math.max(0, Math.min(0.999, (t - it.startTime) / span))
    return peaks[Math.floor(frac * peaks.length)] ?? 0
  }, [])
  // Ensure a lane for spotlight items exists; returns its id.
  const ensureSpotlightLane = useCallback((): string => {
    const existing = tracksRef.current.find(t => timelineItemsRef.current.some(i => i.trackId === t.id && i.contentType === 'spotlight'))
    if (existing) return existing.id
    const id = 'spotlight-lane'
    if (!tracksRef.current.some(t => t.id === id)) setTracks(prev => [...prev, { id, label: 'Spotlight', type: 'media', height: TRACK_HEIGHT }])
    return id
  }, [])
  const runMulticam = useCallback((mode: 'roundrobin' | 'audio') => {
    const items = timelineItemsRef.current
    const camIds = tracksRef.current.filter(t => items.some(i => i.trackId === t.id && i.contentType === 'video')).map(t => t.id)
    if (camIds.length < 2) { setAutoEditNote('Multicam needs video on 2+ tracks (put each camera on its own track).'); return { switches: 0 } }
    const laneId = ensureSpotlightLane()
    const endOf = (i: TimelineItem) => i.startTime + (i.outPoint - i.inPoint) / (i.speed && i.speed > 0 ? i.speed : 1)
    const audioItems = items.filter(i => i.contentType === 'audio')
    const songEnd = (audioItems.length ? audioItems : items.filter(i => i.contentType === 'video')).reduce((m, i) => Math.max(m, endOf(i)), 0)
    const { beats, bars } = projectBeatLines(items)
    const res = buildMulticam({ cameraTrackIds: camIds, laneId, songEnd, bars, beats, energyAt: mode === 'audio' ? trackEnergyAt : undefined, options: { mode } })
    setTimelineItems(prev => [...prev.filter(i => i.contentType !== 'spotlight'), ...res.items])
    setAutoEditNote(`Multicam: ${res.switches} switches across ${camIds.length} cameras${mode === 'audio' ? ' (cut to the loudest)' : ''}.`)
    return res
  }, [ensureSpotlightLane, trackEnergyAt, setTimelineItems])
  // Speaker-driven multicam: analyze each camera for mouth movement (offline), combine with audio
  // loudness, and cut to whoever's talking. Async (seeks each clip); falls back to audio on failure.
  const [speakerBusy, setSpeakerBusy] = useState(false)
  const runSpeakerMulticam = useCallback(async () => {
    const items = timelineItemsRef.current
    const camIds = tracksRef.current.filter(t => items.some(i => i.trackId === t.id && i.contentType === 'video')).map(t => t.id)
    if (camIds.length < 2) { setAutoEditNote('Multicam needs video on 2+ tracks (one camera per track).'); return { switches: 0 } }
    setSpeakerBusy(true)
    setAutoEditNote('Analyzing who’s speaking…')
    try {
      const analyses = new Map<string, { track: SpeakerTrack; item: TimelineItem }>()
      let done = 0
      for (const cam of camIds) {
        const vidItem = items.find(i => i.trackId === cam && i.contentType === 'video' && i.url)
        if (!vidItem?.url) continue
        const track = await analyzeSpeaker(vidItem.url, { from: vidItem.inPoint, to: vidItem.outPoint, step: 0.4 })
        analyses.set(cam, { track, item: vidItem })
        done++; setAutoEditNote(`Analyzing speakers… ${done}/${camIds.length}`)
      }
      // Combined speaker score: mouth-region motion (primary) + audio loudness (secondary).
      const speakerScoreAt = (trackId: string, t: number) => {
        const a = analyses.get(trackId)
        let visual = 0
        if (a) { const src = a.item.inPoint + (t - a.item.startTime) * (a.item.speed && a.item.speed > 0 ? a.item.speed : 1); visual = speakerActivityAt(a.track, src) }
        return visual * 1.0 + trackEnergyAt(trackId, t) * 0.5
      }
      const laneId = ensureSpotlightLane()
      const endOf = (i: TimelineItem) => i.startTime + (i.outPoint - i.inPoint) / (i.speed && i.speed > 0 ? i.speed : 1)
      const audioItems = items.filter(i => i.contentType === 'audio')
      const songEnd = (audioItems.length ? audioItems : items.filter(i => i.contentType === 'video')).reduce((m, i) => Math.max(m, endOf(i)), 0)
      const { beats, bars } = projectBeatLines(items)
      const res = buildMulticam({ cameraTrackIds: camIds, laneId, songEnd, bars, beats, energyAt: speakerScoreAt, options: { mode: 'audio' } })
      setTimelineItems(prev => [...prev.filter(i => i.contentType !== 'spotlight'), ...res.items])
      const anyFace = [...analyses.values()].some(a => a.track.times.length)
      setAutoEditNote(`Multicam: ${res.switches} switches — cut to the speaker${anyFace ? ' (mouth + audio)' : ' (audio only — no motion read)'}.`)
      return res
    } catch {
      setAutoEditNote('Speaker analysis failed — using “Cut to loudest” instead.')
      return runMulticam('audio')
    } finally { setSpeakerBusy(false) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ensureSpotlightLane, trackEnergyAt, setTimelineItems])

  // Manual spotlight: pin a camera at the playhead for `dur` seconds.
  const addSpotlightItem = useCallback((cameraTrackId: string, dur = 3) => {
    const laneId = ensureSpotlightLane()
    const camIdx = cameraTrackIds.indexOf(cameraTrackId)
    const newItem: TimelineItem = {
      id: crypto.randomUUID(), label: `Cam ${camIdx + 1}`, startTime: currentTimeRef.current, inPoint: 0, outPoint: dur,
      captions: [], color: '#f59e0b', trackId: laneId, contentType: 'spotlight', spotlightTrackId: cameraTrackId,
    }
    setTimelineItems(prev => [...prev, newItem]); setSelectedId(newItem.id)
    setAutoEditNote(`Spotlight → Cam ${camIdx + 1} at the playhead (drag/trim to place).`)
    return newItem.id
  }, [ensureSpotlightLane, cameraTrackIds, setTimelineItems])

  // ── AI assistant — maps the model's actions to the editor's REAL functions. Because it calls them
  // directly (not the dev-only window.__video hook), the assistant works in production. ────────────
  const [aiOpen, setAiOpen] = useState(false)
  async function addStockByQuery(query: string, count = 4) {
    const n = Math.max(1, Math.min(8, count || 4))
    const r = await fetch(`/api/pexels-bg?order=random&limit=${n}${query ? `&q=${encodeURIComponent(query)}` : ''}`)
    const d = r.ok ? await r.json() as { results?: StockClip[] } : { results: [] }
    let added = 0
    for (const row of d.results ?? []) { handleAddStock(row); added++ }
    return added
  }
  async function importAudioUrl(url: string) {
    if (!/^https?:/i.test(url)) return
    const resp = await fetch(url); const blob = await resp.blob()
    await handleFileImport(new File([blob], (url.split('/').pop() || 'audio').replace(/\?.*$/, ''), { type: 'audio/mpeg' }))
    for (let i = 0; i < 40; i++) { await new Promise(res => setTimeout(res, 400)); const a = mediaItemsRef.current.find(m => m.contentType === 'audio' && m.url); if (a) { await addMediaToTimeline(a); return } }
  }
  function aiStateSummary() {
    const items = timelineItemsRef.current
    const vids = items.filter(i => i.contentType === 'video').length
    const hasAudio = items.some(i => i.contentType === 'audio')
    return `${items.length} timeline items (${vids} video${hasAudio ? ', an audio bed' : ', no audio yet'}); ${cameraTrackIds.length} camera track(s); project "${localProjectName || 'Untitled'}".`
  }
  async function execAiAction(action: { name: string; input: Record<string, unknown> }): Promise<string> {
    const { name, input } = action
    switch (name) {
      case 'search_and_add_stock': { const n = await addStockByQuery(String(input.query ?? ''), Number(input.count) || 4); return `Added ${n} “${input.query}” clip${n === 1 ? '' : 's'}` }
      case 'import_audio': { await importAudioUrl(String(input.url ?? '')); return 'Imported the audio track' }
      case 'auto_edit': { const res = runAutoEdit({ barsPerCut: input.barsPerCut as number | undefined, transition: input.transition as AutoEditOptions['transition'], look: input.look as string | undefined }); return `Auto-edited — ${res?.cuts ?? 0} cuts` }
      case 'apply_effect': { const ids = input.scope === 'selected' && selectedId ? [selectedId] : timelineItemsRef.current.filter(i => i.contentType === 'video').map(i => i.id); const n = applyEffect(String(input.effect) === 'none' ? null : String(input.effect), ids); return `Applied “${input.effect}” to ${n} clip${n === 1 ? '' : 's'}` }
      case 'multicam': { const m = input.mode === 'speaker' ? await runSpeakerMulticam() : runMulticam(input.mode === 'loudest' ? 'audio' : 'roundrobin'); return `Multicam — ${(m as { switches?: number })?.switches ?? 0} switches` }
      case 'rename_project': { setLocalProjectName(String(input.name ?? 'Untitled')); return `Renamed to “${input.name}”` }
      case 'open_export': { setShowExport(true); return 'Opened export' }
      default: return `(skipped unknown action: ${name})`
    }
  }

  // Temporarily unused: the Music-Visual toolbar button was removed pending a
  // re-wire into the new media-panel flow. Keep the function for that follow-up.
  function addMusicVizClip() {
    const track = tracks.find(t => t.type === 'media' || t.type === 'video') ?? tracks[0]
    const trackId = track?.id ?? 'v1'
    const at = currentTimeRef.current
    // Default accent = the editor's Workshop accent (memoized above), so it
    // matches the user's theme.
    const newItem: TimelineItem = {
      id: crypto.randomUUID(),
      label: 'Music Visual',
      startTime: at, inPoint: 0, outPoint: 5,
      captions: [], color: CLIP_COLORS[timelineItems.length % CLIP_COLORS.length],
      trackId, contentType: 'musicviz',
      mvFormat: DEFAULT_MUSIC_VIZ_FORMAT, mvAccent: themeAccent, mvBg: null,
      mvMatchTheme: true,
    }
    setTimelineItems(prev => [...prev, newItem])
    setSelectedId(newItem.id)
    handleSeek(at)
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

  // Apply a finished transcript: build the Output, set captions, notify, persist. Shared by the
  // local (on-device) and AI (Deepgram) paths.
  function applyTranscript(newCaptions: Caption[], duration: number | undefined, source: 'on-device' | 'AI') {
    const out: Output = {
      id: `transcript-${Date.now()}`, type: 'transcript', title: 'Full Transcript',
      wordCount: newCaptions.reduce((n, c) => n + c.text.split(' ').length, 0),
      createdAt: new Date(), content: newCaptions.map(c => c.text).join(' '), captions: newCaptions,
    }
    setCaptionsWithHistory(newCaptions)
    setLocalOutputs([out])
    setTranscribeStatus('done')
    posthog.capture('transcription_completed', { word_count: out.wordCount, source })
    if (typeof window !== 'undefined' && Notification.permission === 'granted') {
      new Notification('Transcription complete', { body: `${out.wordCount?.toLocaleString()} words ready in ${localProjectName}`, icon: '/favicon.ico' })
    }
    const media = selectedMediaId ? mediaItems.find(m => m.id === selectedMediaId) : null
    saveProject({
      id: savedProjectId, name: localProjectName,
      contentType: media?.contentType ?? propContentType ?? 'video',
      createdAt: new Date().toISOString(), duration,
      captions: newCaptions, outputs: [out],
    })
  }

  // Hybrid transcription: run the FREE on-device Whisper pass first, and only escalate to the paid
  // Deepgram API when the local model is unavailable, can't decode the audio, or returns a
  // low-confidence result (hallucinated/empty lines). Most clean speech never touches the paid API.
  async function handleTranscribe() {
    if (transcribeStatus === 'transcribing') return
    const media = selectedMediaId ? mediaItems.find(m => m.id === selectedMediaId) : null
    if (!media) return

    setTranscribeStatus('transcribing')
    setTranscribeProgress(101)
    setTranscribeError('')
    if (typeof window !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {})
    }

    // 1) LOCAL first — on-device Whisper. Works even before R2 upload finishes; $0.
    try {
      const blob: Blob | null = media.file ?? (media.url ? await fetch(media.url).then(r => (r.ok ? r.blob() : null)).catch(() => null) : null)
      if (blob) {
        const { transcribeLocally } = await import('@/lib/local-stt')
        const local = await transcribeLocally(blob, {
          onProgress: p => setTranscribeProgress(p.status === 'transcribing' ? 101 : Math.min(100, Math.round(p.progress ?? 0))),
        })
        if (local.captions.length && local.lowConfidenceFraction <= 0.35) {
          applyTranscript(local.captions.map(c => ({ start: c.start, end: c.end, text: c.text, words: c.words, speaker: c.speaker })), undefined, 'on-device')
          return
        }
      }
    } catch { /* local unavailable / undecodable / low-confidence → fall through to the AI pass */ }

    // 2) AI escalation — Deepgram (fetches the R2 upload). Requires the upload to have finished.
    if (!media.r2Key) {
      setTranscribeError(media.uploadStatus === 'uploading' ? 'Still uploading — try again in a moment.' : 'Upload failed. Please remove and re-import the file.')
      setTranscribeStatus('error')
      return
    }
    try {
      // Content hash of the audio → lets the server skip a repeat Deepgram call (deterministic cache).
      // We already hold the bytes, so hashing here costs nothing extra; best-effort (skip on failure).
      let contentHash: string | undefined
      try {
        if (media.file && crypto?.subtle) {
          const digest = await crypto.subtle.digest('SHA-256', await media.file.arrayBuffer())
          contentHash = Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('')
        }
      } catch { /* hashing unavailable — just transcribe without the cache key */ }
      const res = await fetch('/api/transcribe', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ r2Key: media.r2Key, contentType: media.contentType, contentHash }),
      })
      if (res.status === 429) {
        setTranscribeStatus('error')
        showUpgrade('You\'ve used your free AI transcriptions for this month. Upgrade to Pro for 30/month.')
        return
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(err.error ?? `Server error ${res.status}`)
      }
      const data = await res.json() as { captions?: Caption[]; duration?: number }
      applyTranscript(data.captions ?? [], data.duration, 'AI')
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
      aspect: projectAspect,
      captionStyle,
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

  async function handleRestore() {
    if (!recovery) return
    const loaded = deserialize(recovery.cfproj)
    carryoverRef.current = {
      dawProject: recovery.cfproj.dawProject ?? carryoverRef.current.dawProject,
      audioMedia: recovery.cfproj.audioMedia ?? carryoverRef.current.audioMedia,
      audioMode: recovery.cfproj.audioMode ?? carryoverRef.current.audioMode,
      podcastMeta: recovery.cfproj.podcastMeta ?? carryoverRef.current.podcastMeta,
      moduleSavedAt: recovery.cfproj.moduleSavedAt ?? carryoverRef.current.moduleSavedAt,
    }
    const loadedTracks = loaded.tracks.filter(t => t.type !== 'caption')
    // Re-resolve media the same way loadCfproj does — deserialize strips urls, so
    // without this every restored clip would be orphaned (shown offline) even
    // though its media is still in R2.
    const urlMap = await resolveR2Keys(recovery.cfproj.media)
    const patchedItems = loaded.timelineItems.map(item => {
      const clip = recovery.cfproj.clips.find(c => c.id === item.id)
      const signedUrl = clip?.mediaRefId ? urlMap.get(clip.mediaRefId) : undefined
      return signedUrl ? { ...item, url: signedUrl } : item
    })
    const resolvedMedia: import('@/lib/editor-types').MediaItem[] = recovery.cfproj.media.map(m => ({
      id: m.id, name: m.name, contentType: m.contentType, duration: m.duration,
      url: urlMap.get(m.id), r2Key: m.r2Key, uploadStatus: m.r2Key ? 'uploaded' as const : undefined,
    }))
    setLocalProjectName(loaded.name)
    setTracks(loadedTracks)
    tracksRef.current = loadedTracks
    setTimelineItemsRaw(patchedItems)
    timelineItemsRef.current = patchedItems
    setMediaItems(resolvedMedia)
    setZoomLevel(loaded.zoomLevel)
    setLocalCaptions(loaded.captions)
    captionsRef.current = loaded.captions
    setLocalOutputs(loaded.outputs)
    setChapters(loaded.chapters ?? [])
    setProjectAspect(loaded.aspect)
    setCaptionStyle(loaded.captionStyle ?? DEFAULT_CAPTION_STYLE)
    const restoredAdj = loaded.adjustments ?? DEFAULT_ADJUSTMENTS
    setAdjustments(restoredAdj)
    adjustmentsRef.current = restoredAdj
    resetHistory({ timelineItems: patchedItems, tracks: loadedTracks, adjustments: restoredAdj, captions: loaded.captions })
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
      const project: CfProjFile = withCarryover(serialize(snapshot))
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
      // Save-sync: after a save, bring any "on save" linked mixes up to date so
      // the clip reflects the arrangement you just saved (non-blocking — it swaps
      // the media in place and re-uploads on its own timer).
      if (dawDirtyRef.current && timelineItemsRef.current.some(i => i.dawMixLinked && !i.dawMixLocked && syncModeOf(i) === 'save'))
        void refreshAllDawMixesRef.current(undefined, { modes: ['save'] })
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
      const project = withCarryover(serialize(snapshot))
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
      const project: CfProjFile = withCarryover(serialize(buildSnapshot()))
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
      const project: CfProjFile = withCarryover(serialize({ ...snap, id: crypto.randomUUID(), name: newName.trim() }))
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

  // ── Command palette (⌘K): existing video actions, no new logic ─
  useRegisterCommands([
    { id: 'video.addTitle', group: 'Video', label: 'Add Title', keywords: 'text clip caption', when: () => activePage === 'edit', run: () => addTitleClip() },
    { id: 'video.addMusicViz', group: 'Video', label: 'Add Music Visual', keywords: 'visualizer audio waveform', when: () => activePage === 'edit', run: () => addMusicVizClip() },
    { id: 'video.export', group: 'Video', label: 'Export', keywords: 'render deliver output', shortcut: '⌘E', run: () => setShowExport(true) },
    { id: 'video.save', group: 'Video', label: 'Save', keywords: 'cloud persist', shortcut: '⌘S', run: () => { void saveToCloud() } },
    ...PAGES.map((p): import('@/lib/commands').Command => ({
      id: `video.page.${p.id}`,
      group: 'Video Pages',
      label: `Go to ${p.label}`,
      keywords: 'page tab view',
      when: () => activePage !== p.id,
      run: () => setActivePage(p.id),
    })),
  ], [activePage, hasVideo, hasAudio])

  return (
    <div data-editor="true" data-editor-kind="video" className="flex flex-col h-full" style={{ background: 'var(--bg-base)' }}
      // Drop an OS file anywhere in the editor (viewer, empty space) to import it.
      // The media panel handles its own drops (and stops propagation); internal
      // clip drags carry 'mediaId', not 'Files', so they pass straight through.
      onDragOver={e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' } }}
      onDrop={e => {
        if (!e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        for (const f of Array.from(e.dataTransfer.files)) {
          if (detectMediaKind(f)) handleFileImport(f)
        }
      }}
    >

      {/* ── Header ───────────────────────────────────────────── */}
      <div className="electron-drag-container flex items-center gap-3 px-4 shrink-0" style={{ height: 40, borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)', paddingLeft: isElectronMac ? 80 : 16 }}>
        {/* Import media files (video / audio / LUT) into this project */}
        <input ref={mediaFileRef} type="file" accept={MEDIA_ACCEPT} multiple onChange={handleImportInput} className="hidden" />
        <button
          onClick={handleOpenImport}
          title="Open a project (.cfproj / Firefly .zip), or import media to a new video project"
          className="flex items-center gap-1.5 text-xs shrink-0 hover:opacity-70 transition-opacity"
          style={{ color: 'var(--text-muted)' }}
        >
          <FolderOpen size={12} /> Open / Import Files
        </button>
        <div className="w-px h-4 shrink-0" style={{ background: 'var(--border)' }} />
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
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
              className="text-xs font-semibold truncate text-left hover:opacity-70 transition-opacity"
              style={{ color: 'var(--text-primary)', maxWidth: 240 }}
              title="Click to rename project"
            >
              {localProjectName}
            </button>
          )}
          {projectId && <ProjectSwitcher currentId={savedProjectId} dirty={isDirty} />}
        </div>

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
          <button
            onClick={() => setShowShortcuts(true)}
            className="p-1.5 rounded" title="Keyboard shortcuts (?)"
            style={{ color: 'var(--text-muted)', fontWeight: 800, fontSize: 12, width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            ?
          </button>
        </div>
        <div className="w-px h-4 shrink-0" style={{ background: 'var(--border)' }} />

        {/* Import media (video / audio / LUT) */}
        {activePage === 'edit' && (
          <button
            onClick={() => mediaFileRef.current?.click()}
            data-help-id="import-media"
            className="flex items-center gap-1 px-2 py-1 rounded text-xs shrink-0"
            title="Import video, audio, or LUT files (or drag them in)"
            style={{ color: 'var(--text-secondary)', background: 'var(--bg-card)', border: '1px solid var(--border)' }}
          >
            <FolderOpen size={12} /> Import
          </button>
        )}

        {/* Insert a title/text clip */}
        {activePage === 'edit' && (
          <button
            onClick={addTitleClip}
            data-help-id="add-title"
            className="flex items-center gap-1 px-2 py-1 rounded text-xs shrink-0"
            title="Add a text / title clip at the playhead"
            style={{ color: 'var(--text-secondary)', background: 'var(--bg-card)', border: '1px solid var(--border)' }}
          >
            <Type size={12} /> Title
          </button>
        )}

        {/* Auto-edit — beat-synced montage from the media pool over the audio bed */}
        {activePage === 'edit' && (
          <button
            onClick={() => runAutoEdit()}
            data-help-id="auto-edit"
            className="flex items-center gap-1 px-2 py-1 rounded text-xs shrink-0"
            title="Auto-edit: cut the video clips to the beat of the audio"
            style={{ color: '#0e0d12', background: 'var(--accent)', border: '1px solid var(--accent)', fontWeight: 700 }}
          >
            <Wand2 size={12} /> Auto-edit
          </button>
        )}

        {/* AI assistant — describe what to make, it drives the editor */}
        {activePage === 'edit' && (
          <button
            onClick={() => setAiOpen(o => !o)}
            data-help-id="ai-assistant"
            className="flex items-center gap-1 px-2 py-1 rounded text-xs shrink-0"
            title="AI assistant — describe what to make"
            style={{ color: aiOpen ? '#0e0d12' : 'var(--text-secondary)', background: aiOpen ? 'var(--accent)' : 'var(--bg-card)', border: `1px solid ${aiOpen ? 'var(--accent)' : 'var(--border)'}`, fontWeight: 700 }}
          >
            <Sparkles size={12} /> AI
          </button>
        )}

        {/* Effects — apply a named look to the selected clip (or all clips) */}
        {activePage === 'edit' && (
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setFxOpen(o => !o)}
              data-help-id="effects"
              className="flex items-center gap-1 px-2 py-1 rounded text-xs shrink-0"
              title="Apply a look / effect to the selected clip (or all clips)"
              style={{ color: 'var(--text-secondary)', background: 'var(--bg-card)', border: '1px solid var(--border)' }}
            >
              <SwatchBook size={12} /> Effects
            </button>
            {fxOpen && (
              <div style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 50, width: 264, maxHeight: 380, overflowY: 'auto', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: 10, boxShadow: '0 12px 32px rgba(0,0,0,0.4)' }}>
                <div style={{ display: 'flex', gap: 6, marginBottom: 9 }}>
                  {([['Selected', false], ['All clips', true]] as const).map(([lbl, all]) => (
                    <button key={lbl} onClick={() => setFxScopeAll(all)} style={{ flex: 1, padding: '5px 8px', borderRadius: 8, fontSize: 11.5, fontWeight: 700, cursor: 'pointer', border: `1px solid ${fxScopeAll === all ? 'var(--accent)' : 'var(--border)'}`, background: fxScopeAll === all ? 'var(--accent)' : 'transparent', color: fxScopeAll === all ? '#0e0d12' : 'var(--text-secondary)' }}>{lbl}</button>
                  ))}
                </div>
                {(() => {
                  const ids = fxScopeAll
                    ? timelineItems.filter(i => i.contentType === 'video').map(i => i.id)
                    : (selectedIds.size ? [...selectedIds] : (selectedId ? [selectedId] : []))
                  const activeLook = !fxScopeAll && selectedId ? timelineItems.find(i => i.id === selectedId)?.look : undefined
                  return (
                    <>
                      <button onClick={() => { addEffectItem(activeLook || undefined); setFxOpen(false) }} style={{ width: '100%', textAlign: 'left', padding: '7px 9px', marginBottom: 7, borderRadius: 8, fontSize: 12, fontWeight: 750, cursor: 'pointer', border: '1px solid var(--accent)', background: 'color-mix(in srgb, var(--accent) 12%, transparent)', color: 'var(--accent)' }}>＋ Add as a timeline effect (spans the playhead)</button>
                      <button onClick={() => applyEffect(null, ids)} style={{ width: '100%', textAlign: 'left', padding: '6px 9px', marginBottom: 7, borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', border: `1px solid ${!activeLook ? 'var(--accent)' : 'var(--border)'}`, background: 'transparent', color: 'var(--text-secondary)' }}>None (clear)</button>
                      {effectsByCategory().map(({ category, effects }) => (
                        <div key={category} style={{ marginBottom: 9 }}>
                          <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-muted)', margin: '2px 0 5px' }}>{category}</div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                            {effects.map(e => (
                              <button key={e.id} onClick={() => applyEffect(e.id, ids)} title={e.css}
                                style={{ padding: '5px 9px', borderRadius: 999, fontSize: 11.5, fontWeight: 700, cursor: 'pointer', border: `1px solid ${activeLook === e.id ? 'var(--accent)' : 'var(--border)'}`, background: activeLook === e.id ? 'var(--accent)' : 'var(--bg-surface)', color: activeLook === e.id ? '#0e0d12' : 'var(--text-secondary)' }}>{e.name}</button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </>
                  )
                })()}
              </div>
            )}
          </div>
        )}

        {/* Multicam — switch the spotlight between camera tracks */}
        {activePage === 'edit' && (
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setFxOpenMc(o => !o)}
              data-help-id="multicam"
              className="flex items-center gap-1 px-2 py-1 rounded text-xs shrink-0"
              title="Multicam: switch the spotlight between camera tracks"
              style={{ color: 'var(--text-secondary)', background: 'var(--bg-card)', border: '1px solid var(--border)' }}
            >
              <Layers size={12} /> Multicam
            </button>
            {fxOpenMc && (
              <div style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 50, width: 250, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: 10, boxShadow: '0 12px 32px rgba(0,0,0,0.4)' }}>
                {cameraTrackIds.length < 2 ? (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>Put each camera on its own track (video on 2+ tracks), then switch the spotlight between them here.</div>
                ) : (
                  <>
                    <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-muted)', margin: '0 0 6px' }}>Auto-switch ({cameraTrackIds.length} cameras)</div>
                    <button onClick={() => { runSpeakerMulticam() }} disabled={speakerBusy} style={{ width: '100%', padding: '8px', borderRadius: 8, marginBottom: 6, fontSize: 12, fontWeight: 800, cursor: speakerBusy ? 'default' : 'pointer', border: 'none', background: 'var(--accent)', color: '#0e0d12', opacity: speakerBusy ? 0.6 : 1 }}>{speakerBusy ? 'Analyzing…' : 'Cut to the speaker'}</button>
                    <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                      <button onClick={() => { runMulticam('audio'); setFxOpenMc(false) }} style={{ flex: 1, padding: '6px 8px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)' }}>Cut to loudest</button>
                      <button onClick={() => { runMulticam('roundrobin'); setFxOpenMc(false) }} style={{ flex: 1, padding: '6px 8px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)' }}>Round-robin</button>
                    </div>
                    <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-muted)', margin: '0 0 6px' }}>Manual (at playhead)</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                      {cameraTrackIds.map((tid, idx) => (
                        <button key={tid} onClick={() => addSpotlightItem(tid)} style={{ padding: '5px 10px', borderRadius: 999, fontSize: 11.5, fontWeight: 700, cursor: 'pointer', border: '1px solid var(--border)', background: 'var(--bg-surface)', color: 'var(--text-secondary)' }}>Cam {idx + 1}</button>
                      ))}
                    </div>
                    <p style={{ fontSize: 10.5, color: 'var(--text-muted)', margin: '9px 0 0', lineHeight: 1.5 }}>“Cut to loudest” follows whoever’s audio is loudest. Speaker (mouth-movement) detection is the next pass.</p>
                  </>
                )}
              </div>
            )}
          </div>
        )}
        {autoEditNote && (
          <div style={{ position: 'fixed', left: '50%', bottom: 24, transform: 'translateX(-50%)', zIndex: 60, background: 'var(--bg-card)', border: '1px solid var(--accent)', color: 'var(--text-primary)', padding: '8px 16px', borderRadius: 999, fontSize: 12.5, fontWeight: 700, boxShadow: '0 6px 24px rgba(0,0,0,0.3)' }}>{autoEditNote}</div>
        )}

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
              data-help-id="blade-tool"
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
                <><Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> Saving…</>
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

        {/* Customize appearance — same theme panel as the audio editor */}
        <button
          onClick={() => setShowAppearance(true)}
          className="flex items-center gap-1 px-2 py-1 rounded text-xs shrink-0"
          style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}
          title="Customize appearance (theme)"
        >
          <SwatchBook size={11} />
        </button>

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
          data-help-id="export-btn"
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
            {/* ── Left: file-cabinet rail + collapsible media panel ─── */}
            <div style={{ display: 'flex', flexShrink: 0, borderRight: '1px solid var(--border)' }}>

              {/* Rail — always visible */}
              <div style={{
                width: 40, flexShrink: 0,
                display: 'flex', flexDirection: 'column',
                alignItems: 'center', paddingTop: 8, gap: 2,
                background: 'var(--bg-surface)',
                borderRight: videoSidebarOpen ? '1px solid var(--border)' : 'none',
              }}>
                {/* Logo — takes the user straight home */}
                <a
                  href="/dashboard"
                  title="Home"
                  data-help-id="home"
                  style={{
                    width: 28, height: 28, marginBottom: 4, flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none',
                  }}
                >
                  <LogoMark size={22} />
                </a>
                {/* Return to the projects list */}
                <a
                  href="/projects"
                  title="Return to projects"
                  data-help-id="return-to-projects"
                  style={{
                    width: 28, height: 28, borderRadius: 6, marginBottom: 6, flexShrink: 0, cursor: 'pointer', textDecoration: 'none',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: 'transparent', color: 'var(--text-muted)',
                    transition: 'background 0.12s, color 0.12s',
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(var(--accent-rgb) / 0.12)'; (e.currentTarget as HTMLElement).style.color = 'var(--accent)' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)' }}
                >
                  <FolderOpen size={15} />
                </a>
                {/* Media library toggle */}
                {([
                  { tab: 'media' as const, Icon: Clapperboard, label: 'Media library', help: 'media-library' },
                ]).map(({ tab, Icon, label, help }) => {
                  const isActive = videoSidebarOpen && videoLeftTab === tab
                  return (
                    <button
                      key={tab}
                      onClick={() => { if (isActive) setVideoSidebarOpen(false); else { setVideoLeftTab(tab); setVideoSidebarOpen(true) } }}
                      title={label}
                      data-help-id={help}
                      style={{
                        width: 28, height: 28, borderRadius: 6, border: 'none', cursor: 'pointer',
                        background: isActive ? 'rgb(var(--accent-rgb) / 0.12)' : 'transparent',
                        color: isActive ? 'var(--accent)' : 'var(--text-muted)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        transition: 'background 0.12s, color 0.12s',
                      }}
                    >
                      <Icon size={14} />
                    </button>
                  )
                })}
                {/* Appearance / theme customization — always available */}
                <button
                  onClick={() => setShowAppearance(true)}
                  title="Customize appearance"
                  data-help-id="appearance"
                  style={{
                    width: 28, height: 28, borderRadius: 6, border: 'none', cursor: 'pointer',
                    marginTop: 'auto', marginBottom: 8, background: 'transparent',
                    color: 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'background 0.12s, color 0.12s',
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(var(--accent-rgb) / 0.12)'; (e.currentTarget as HTMLElement).style.color = 'var(--accent)' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)' }}
                >
                  <Palette size={14} />
                </button>
              </div>

              {/* Collapsible media panel */}
              <div style={{
                width: videoSidebarOpen ? videoLeftPanel.size : 0,
                flexShrink: 0,
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
                transition: videoLeftPanel.dragging ? 'none' : 'width 0.15s ease',
                background: 'var(--bg-surface)',
                position: 'relative',
              }}>
                {videoSidebarOpen && <ResizeHandle axis="x" edge="right" onPointerDown={videoLeftPanel.handleProps.onPointerDown} />}
                <MediaLibrary
                  items={mediaItems} selectedId={selectedMediaId}
                  onSelect={setSelectedMediaId}
                  onImport={handleFileImport}
                  onBounceDawMix={hasDawProject ? handleBounceDawMix : undefined}
                  onLinkProject={() => openProjectPicker('link')}
                  onSendProject={hasDawProject ? () => openProjectPicker('send') : undefined}
                  linkedSources={linkedSourceIds.map(id => ({ id, name: sourceNamesRef.current.get(id) || 'Linked project', syncing: bounceStatus === 'working' }))}
                  onOpenSource={(id) => window.open(`/projects/${id}`, '_blank')}
                  onResyncSource={(id) => { void resyncSource(id) }}
                  dawTracks={dawTracks}
                  bounceStatus={bounceStatus}
                  onAddToTimeline={addMediaToTimeline}
                  onRemove={(id) => setMediaItems(prev => {
                    const m = prev.find(x => x.id === id)
                    if (m?.url?.startsWith('blob:')) { try { URL.revokeObjectURL(m.url) } catch { /* already revoked */ } }
                    return prev.filter(x => x.id !== id)
                  })}
                  onContextMenu={openCtx}
                  onAddFromLibrary={handleAddFromLibrary}
                  onRetryUpload={handleRetryUpload}
                  onAddStock={handleAddStock}
                />
              </div>
            </div>

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
                    Split
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

                {/* Project aspect ratio — sizes the preview frame AND the export */}
                {viewportTab === 'video' && !isAudioOnly && (
                  <select value={projectAspect}
                    onChange={e => setProjectAspect(e.target.value as ProjectAspect)}
                    className="text-xs rounded px-1 py-0.5"
                    title="Project aspect ratio — the preview frame and exported video use this shape (9:16 for TikTok/Reels/Shorts)"
                    style={{
                      background: 'var(--bg-card)', border: '1px solid var(--border)',
                      color: projectAspect !== '16:9' ? 'var(--accent-light)' : 'var(--text-muted)',
                    }}
                  >
                    {PROJECT_ASPECTS.map(a => <option key={a} value={a}>{a}</option>)}
                  </select>
                )}

                {/* Preview overlays — VU / scopes / motion smoothing / storyboard,
                    grouped into one menu instead of six terse toggles. */}
                {viewportTab === 'video' && !isAudioOnly && (() => {
                  const overlays = [
                    { label: 'VU meter', on: showVUMeter, toggle: () => setShowVUMeter(v => !v) },
                    { label: 'Color scopes', on: showColorScopes, toggle: () => setShowColorScopes(v => !v) },
                    { label: 'Frame blend', on: frameBlendEnabled, toggle: () => setFrameBlendEnabled(v => !v) },
                    { label: 'Optical flow', on: opticalFlowEnabled, toggle: () => setOpticalFlowEnabled(v => !v) },
                    { label: 'Motion blur', on: motionBlurGlobal, toggle: () => setMotionBlurGlobal(v => !v) },
                    ...(hasStoryboard ? [{ label: 'Storyboard', on: showStoryboard, toggle: () => setShowStoryboard(v => !v) }] : []),
                  ]
                  const anyOn = overlays.some(o => o.on)
                  return (
                    <div style={{ position: 'relative' }}>
                      <button
                        ref={overlaysBtnRef}
                        onClick={() => { const r = overlaysBtnRef.current?.getBoundingClientRect(); if (r) setOverlaysMenuPos({ top: r.bottom + 4, left: r.left }); setShowOverlaysMenu(v => !v) }}
                        className="flex items-center gap-1 px-2 py-1 rounded text-xs"
                        title="Preview overlays — meters, scopes, motion smoothing"
                        style={{ color: anyOn ? 'var(--accent-light)' : 'var(--text-muted)', background: anyOn ? 'var(--accent-subtle)' : 'transparent' }}
                        aria-haspopup="menu" aria-expanded={showOverlaysMenu}
                      >
                        <Layers size={12} /> Overlays <ChevronDown size={11} />
                      </button>
                      {showOverlaysMenu && overlaysMenuPos && (<>
                        <div style={{ position: 'fixed', inset: 0, zIndex: 999 }} onClick={() => setShowOverlaysMenu(false)} />
                        <div role="menu" className="menu-pop" style={{ position: 'fixed', top: overlaysMenuPos.top, left: overlaysMenuPos.left, zIndex: 1000, minWidth: 190, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.4)', padding: 4 }}>
                          {overlays.map(o => (
                            <button key={o.label} role="menuitemcheckbox" aria-checked={o.on} onClick={o.toggle}
                              className="flex items-center gap-2 w-full text-left rounded"
                              style={{ padding: '6px 8px', fontSize: 12.5, background: 'transparent', border: 'none', cursor: 'pointer', color: o.on ? 'var(--accent-light)' : 'var(--text-primary)' }}
                              onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-surface)' }}
                              onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
                              <span style={{ width: 14, flexShrink: 0, display: 'inline-flex' }}>{o.on && <CheckIcon size={13} />}</span>
                              {o.label}
                            </button>
                          ))}
                        </div>
                      </>)}
                    </div>
                  )
                })()}

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
                      gizmo={gizmo}
                      onGizmoChange={(patch) => selectedItem && handleClipChange(selectedItem.id, patch)}
                      showSafeAreas={showSafeAreas}
                      projectAspect={projectAspect}
                      transition={viewerTransition}
                      underLayers={underLayers}
                      musicViz={activeMusicViz}
                      captionStyle={captionStyle}
                      clipGradeFilter={[viewerClip ? buildClipGradeFilter(viewerClip) : '', activeEffectCss(timelineItems, currentTime)].filter(Boolean).join(' ')}
                      overlays={activeOverlays(timelineItems, currentTime, viewerClip ? [viewerClip.look] : [])}
                      lutData={activeLut}
                      showVUMeter={showVUMeter}
                      frameBlendEnabled={frameBlendEnabled}
                      clipSpeed={rampSpeed}
                      motionBlurEnabled={motionBlurGlobal || (viewerClip?.motionBlurEnabled ?? false)}
                      currentClipSpeed={rampSpeed}
                      opticalFlowEnabled={opticalFlowEnabled}
                      perfMode={perfMode}
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
                      gizmo={gizmo}
                      onGizmoChange={(patch) => selectedItem && handleClipChange(selectedItem.id, patch)}
                      showSafeAreas={showSafeAreas}
                      projectAspect={projectAspect}
                      transition={viewerTransition}
                      underLayers={underLayers}
                      musicViz={activeMusicViz}
                      captionStyle={captionStyle}
                      clipGradeFilter={[viewerClip ? buildClipGradeFilter(viewerClip) : '', activeEffectCss(timelineItems, currentTime)].filter(Boolean).join(' ')}
                      overlays={activeOverlays(timelineItems, currentTime, viewerClip ? [viewerClip.look] : [])}
                      lutData={activeLut}
                      showVUMeter={showVUMeter}
                      frameBlendEnabled={frameBlendEnabled}
                      clipSpeed={rampSpeed}
                      motionBlurEnabled={motionBlurGlobal || (viewerClip?.motionBlurEnabled ?? false)}
                      currentClipSpeed={rampSpeed}
                      opticalFlowEnabled={opticalFlowEnabled}
                      perfMode={perfMode}
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
                  {showColorScopes && !perfMode && (
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
                onAddMusicViz={addMusicVizClip}
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
                captionStyle={captionStyle}
                onCaptionStyleChange={setCaptionStyle}
                onCaptionEdit={handleCaptionEdit}
                focusClips={focusClips}
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
            beatLines={beatLines}
            onEditBeatMap={id => setBeatMapEditor({ clipId: id })}
            onSplitAtBeats={handleSplitAtBeats}
            onQuantizeToBeat={handleQuantizeToBeat}
            onToggleDawLock={handleToggleDawLock}
            onSetDawSyncMode={handleSetDawSyncMode}
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
            tracks={tracks}
            adjustments={adjustments}
            aspect={projectAspect}
            captions={localCaptions}
            captionStyle={captionStyle}
            luts={lutMap}
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
                data-help-id={`page-${id}`}
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
      {aiOpen && <AiAssistant module="video" stateSummary={aiStateSummary} execute={execAiAction} onClose={() => setAiOpen(false)} />}

      {importError && (
        <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 2500, background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.4)', color: '#f87171', padding: '9px 15px', borderRadius: 9, fontSize: 12.5, maxWidth: '90vw', boxShadow: '0 8px 30px rgba(0,0,0,0.4)' }}>
          {importError}
        </div>
      )}

      {/* Per-audio-clip beat-grid editor (opened from a clip's right-click menu) */}
      {beatMapEditor && (() => {
        const clip = timelineItems.find(i => i.id === beatMapEditor.clipId)
        if (!clip) return null
        return (
          <BeatMapEditor
            clip={clip}
            onSave={(bm) => handleSaveBeatMap(clip.id, bm)}
            onClose={() => setBeatMapEditor(null)}
            onDetect={() => detectClipBpm(clip)}
          />
        )
      })()}

      {/* Live audio→video link: listen to the project's DAW collab room and
          re-bounce the linked mix track when the arrangement changes. */}
      {hasDawProject && projectId && (
        <DawMixSync
          projectId={savedProjectId}
          getProject={() => dawProjectRef.current}
          onProject={handleLiveDawProject}
        />
      )}

      {/* Cross-project links are sync-on-save (see LIVE_CROSS_PROJECT_SYNC): the
          linked mix is rendered from the source's saved state on link / load /
          manual re-sync, not from a live room. Real-time re-bouncing is gated
          off here — flip the flag (behind Pro) to restore the live listeners. */}
      {LIVE_CROSS_PROJECT_SYNC && linkedSourceIds.map(sid => (
        <DawMixSync
          key={sid}
          projectId={sid}
          getProject={() => sourceReplicasRef.current.get(sid) ?? null}
          onProject={(p, live) => { sourceReplicasRef.current.set(sid, p); scheduleMixRefresh(live) }}
        />
      ))}

      {/* Pick a project to link its audio in */}
      {showProjectPicker && (
        <div onClick={() => setShowProjectPicker(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(8,8,12,0.55)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div onClick={e => e.stopPropagation()}
            style={{ width: 'min(440px, 92vw)', maxHeight: '70vh', display: 'flex', flexDirection: 'column', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14, boxShadow: '0 20px 60px rgba(0,0,0,0.5)', overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
              <Link2 size={15} color="var(--accent-light)" />
              <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{pickerMode === 'send' ? 'Send this audio to a project' : 'Link a project’s audio'}</span>
              <button onClick={() => setShowProjectPicker(false)} style={{ marginLeft: 'auto', color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer' }}><X size={16} /></button>
            </div>
            <p style={{ padding: '10px 16px 4px', margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>{pickerMode === 'send'
              ? 'This project’s full mix links into the project you pick — it live-updates there whenever you edit here.'
              : 'Its full mix syncs in as a live clip — edit that project and this clip re-renders to match.'}</p>
            <div style={{ overflowY: 'auto', padding: '6px 8px 12px' }}>
              {pickerProjects === null ? (
                <p style={{ padding: '16px', fontSize: 13, color: 'var(--text-muted)', textAlign: 'center' }}>Loading your projects…</p>
              ) : pickerProjects.length === 0 ? (
                <p style={{ padding: '16px', fontSize: 13, color: 'var(--text-muted)', textAlign: 'center' }}>No other projects to link.</p>
              ) : pickerProjects.map(p => {
                const linked = linkedSourceIds.includes(p.id)
                return (
                  <button key={p.id} onClick={() => pickerMode === 'send' ? sendToTarget(p.id) : handleLinkProject(p.id, p.name)}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', padding: '9px 10px', borderRadius: 8, background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-primary)' }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-surface)' }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
                    <Music size={13} color="var(--text-muted)" />
                    <span style={{ flex: 1, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                    {linked && <span style={{ fontSize: 10, color: 'var(--accent-light)', fontWeight: 600 }}>linked · re-sync</span>}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}

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
            ? <><span className="success-pop success-ring" style={{ position: 'relative', borderRadius: '50%', color: 'var(--success)' }}><CheckCircle2 size={14} /></span> Project saved</>
            : <><Cloud size={14} /> Save failed — check your connection</>
          }
        </div>
      )}

      {showAppearance && <AppearancePanel onClose={() => setShowAppearance(false)} editorKind="video" />}

      {showExport && (
        <ExportModal
          projectName={localProjectName}
          timelineItems={timelineItems}
          mediaItems={mediaItems}
          tracks={tracks}
          adjustments={adjustments}
          aspect={projectAspect}
          captions={localCaptions}
          captionStyle={captionStyle}
          luts={lutMap}
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
          tracks={tracks}
          adjustments={adjustments}
          aspect={projectAspect}
          captions={localCaptions}
          captionStyle={captionStyle}
          luts={lutMap}
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
            <div className="flex items-center justify-between px-5 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
              <div className="flex items-center gap-1">
                {([['features', 'Features'], ['shortcuts', 'Shortcuts']] as const).map(([id, label]) => (
                  <button key={id} onClick={() => setHelpTab(id)}
                    className="text-xs font-semibold px-3 py-1.5 rounded"
                    style={{
                      background: helpTab === id ? 'var(--accent)' : 'transparent',
                      color: helpTab === id ? '#fff' : 'var(--text-muted)',
                    }}>{label}</button>
                ))}
              </div>
              <button onClick={() => setShowShortcuts(false)} style={{ color: 'var(--text-muted)', fontSize: 18, lineHeight: 1 }}><X size={18} /></button>
            </div>

            {/* ── Features tab: click a feature to jump to (and glow) its control ── */}
            {helpTab === 'features' && (() => {
              const go = (page: EditorPage | undefined, ids: string[]) => {
                setShowShortcuts(false)
                const nav = page && page !== activePage
                if (nav) setActivePage(page)
                if (ids.length) window.setTimeout(() => highlightHelpTargets(ids), nav ? 400 : 80)
              }
              const FEATURES: { title: string; desc: string; page?: EditorPage; ids: string[] }[] = [
                { title: 'Turn audio into visuals', desc: 'Add a waveform / spectrum visual driven by an audio clip. Select an audio clip on the timeline first, then hit Add Music Visual in the inspector.', page: 'edit', ids: ['add-music-viz'] },
                { title: 'Beat grid & BPM snapping', desc: "Right-click an audio clip → Beat grid to set its BPM (and extra tempo sections by timestamp or bar). The clip's beats then become snapping points.", page: 'edit', ids: [] },
                { title: 'Reposition, resize & crop', desc: "Select a clip, then drag inside the preview to move, corners to resize, edges to crop. Items snap to the frame's edges, center and quarters — hold Option to bypass.", page: 'edit', ids: [] },
                { title: 'Add a title / text', desc: 'Drop a text or title clip at the playhead, then style it in the inspector.', page: 'edit', ids: ['add-title'] },
                { title: 'Blade (split) tool', desc: 'Click clips to cut them where you click. Press A or Esc to go back to the select tool.', page: 'edit', ids: ['blade-tool'] },
                { title: 'Import media', desc: 'Bring in video (mp4, mov, webm, mkv…), audio, and LUTs — the Import button in the toolbar, the Media Pool, or just drag files in.', page: 'edit', ids: ['import-media', 'media-library'] },
                { title: 'Color grading', desc: 'Grade the look — exposure, contrast, color balance and LUTs — on the Color page.', page: 'color', ids: ['page-color'] },
                { title: 'Audio mixer', desc: 'Levels, fades and per-track mixing on the Audio page.', page: 'audio', ids: ['page-audio'] },
                { title: 'Export the video', desc: 'Render the finished timeline to a downloadable video file.', ids: ['export-btn'] },
              ]
              return (
                <div className="p-4 flex flex-col gap-1.5">
                  {FEATURES.map(f => (
                    <button key={f.title} onClick={() => go(f.page, f.ids)}
                      className="text-left rounded-lg px-3 py-2.5 transition-colors"
                      style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent)' }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)' }}>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{f.title}</span>
                        <span className="text-xs shrink-0" style={{ color: 'var(--accent-light)' }}>Show me →</span>
                      </div>
                      <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)', lineHeight: 1.45 }}>{f.desc}</p>
                    </button>
                  ))}
                </div>
              )
            })()}

            {helpTab === 'shortcuts' && (
            <>
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
            </>
            )}
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
