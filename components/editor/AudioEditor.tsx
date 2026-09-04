'use client'

import { useState, useEffect, useReducer, useRef, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { createPortal } from 'react-dom'
import { useUser } from '@clerk/nextjs'
import { computeRevertPatch, takeUndoGroup, type UndoEntry } from '@/lib/daw-undo'
import { reducer as undoReducer, type OverlayKind } from '@/lib/daw-state'
import Appear, { useSticky, useAppear } from '@/components/ui/Appear'
import { canConsolidate, consolidateMidiClip } from '@/lib/daw-consolidate'
import { spliceClipAt } from '@/lib/daw-splice'
import { ADD_OPTIONS, makeDefaultParams as makeDefaultEffectParams } from '@/lib/daw-effect-catalog'
import { CHECKOUT_LS_KEY } from '@/lib/apollo/checkout'
import { installDawDiagnose, type DiagnoseEngine } from '@/lib/daw-diagnose'
import { sessionCaptureToClips } from '@/lib/daw-session'
import dynamic from 'next/dynamic'
import type { DawView, EditTarget, DawProject, DawTrack, DawClip, AudioClip, ApolloInstrumentParams } from '@/lib/daw-types'
import { defaultProject, TRACK_COLORS, DEFAULT_TRACK_HEIGHT, defaultTrackInstrument, voiceChainEffects, clipLockedBy, isAudioClip, isMidiClip } from '@/lib/daw-types'
import { legacyToBar } from '@/lib/effect-bar'
import type { DawAction } from '@/lib/daw-state'
import { DawContext, DawPlayheadProvider, reducer, makeAudioClip, extractPeaks, migrateProject, useDaw } from '@/lib/daw-state'
import { useApolloTrackItem, ApolloTrackItemBar } from '@/components/editor/daw/ApolloTrackItem'
import { useApolloMotion } from '@/components/editor/daw/ApolloMotion'
import { consumeStudioSeed } from '@/lib/open-in-studio'
import { readWorkspace, writeWorkspace } from '@/lib/editor-workspace'
import { InspectorBridge } from './daw/InspectorBridge'
import { DuplicateCleanup } from './daw/DuplicateCleanup'
import MergeReview from './daw/MergeReview'
import PopOut from '@/components/PopOut'
import { setActiveStudio } from '@/lib/voice/studio-registry'
import { Library, Settings, FileText, Users, Palette, Code2, FolderOpen, PlusCircle, RotateCw, Pencil, Keyboard, X, Link2, Upload, ExternalLink, Minimize2 } from 'lucide-react'
import { LogoMark } from '@/components/Logo'
import { WorkshopThemeProvider } from './WorkshopThemeProvider'
import { UITierProvider } from './UITierProvider'
import { DawEngine } from '@/lib/daw-engine'
import type { CollabPeer } from '@/lib/daw-types'
import { uploadRecordingBlob } from '@/lib/record-upload'
import type { AudioTrackInit, ModuleKey } from '@/lib/editor-types'
import type { PodcastMeta } from '@/lib/project-serializer'
import { openProjectsFromFile } from '@/lib/project-serializer'
import { openMediaInStudio } from '@/lib/media-handoff'
import { useMediaDrop } from '@/lib/use-media-drop'
import { detectMediaKind } from '@/lib/media-import'
import type { Caption } from '@/lib/types'
import { captureAudioInput } from '@/lib/audio-capture'
import { monitorFxParams } from '@/lib/daw-engine'
import type { AudioInputSource } from '@/lib/audio-capture'
import Transport from './daw/Transport'
import UITierSwitcher from './daw/UITierSwitcher'
import { useUITierOptional } from './UITierProvider'
import { UI_DENSITIES, DENSITY_INFO } from '@/lib/ui-density'
import { useResizable, ResizeHandle } from './daw/useResizable'
import HelpButton from './daw/HelpButton'
import { InspectButton } from './daw/InspectMode'
import PracticeButton from './daw/PracticeButton'
import { VUMeter } from './daw/TrackRow'
import { DevicePopoutHost } from './daw/DeviceChain'
import SoundLibraryPanel from './SoundLibrary'
import { useRegisterCommands } from '@/lib/commands'
import SendToProjectButton from './SendToProjectButton'
import PolyCodePanel from './daw/PolyCodePanel'
import GuestPanel from './daw/GuestPanel'
import { saveSnapshot, loadSnapshot, deleteSnapshot, getBranch } from '@/lib/offline-store'
import { mergeProjects, applyResolutions, hasDiverged, type MergeConflict } from '@/lib/project-merge'
import { getPresets, combinePresets } from '@/lib/midi-presets'
import { installDragSelectionGuard } from '@/lib/ui/drag-selection-guard'

// ── Re-exports for backward compat (ProjectEditor imports these) ──────────────

export interface AudioTrack extends AudioTrackInit {
  url: string
}

export interface AudioEditorProps {
  projectId?: string
  projectName: string
  initialTracks?: AudioTrack[]
  /** Saved DAW arrangement from the cloud project file — takes priority over initialTracks. */
  initialDawProject?: import('@/lib/daw-types').DawProject
  /** Shared-project viewers (free plan): the UI is a faithful read-only mirror —
   *  local edit actions are dropped, remote/broadcast state still applies. */
  readOnly?: boolean
  /** Signed-out visitor — can build freely, but save/export require an account. */
  isGuest?: boolean
  captions?: Caption[]
  currentTime?: number
  onTimeChange?: (t: number) => void
  onProjectNameCommit?: (name: string) => void
  onSave?: (tracks: AudioTrack[], meta?: { audioMode?: 'music' | 'podcast'; podcastMeta?: PodcastMeta; dawProject?: import('@/lib/daw-types').DawProject }) => Promise<void>
  /** Save the project to the user's own computer instead of the cloud. */
  onSaveLocal?: (tracks: AudioTrack[], meta?: { audioMode?: 'music' | 'podcast'; podcastMeta?: PodcastMeta; dawProject?: import('@/lib/daw-types').DawProject }) => Promise<void>
  /** When set on a read-only (view) member, enables "suggest changes": local
   *  edits the owner can accept. Serializes/POSTs the proposal upstream. */
  onSuggest?: (note: string, tracks: AudioTrack[], meta?: { audioMode?: 'music' | 'podcast'; podcastMeta?: PodcastMeta; dawProject?: import('@/lib/daw-types').DawProject }) => Promise<void>
  hideHeader?: boolean
  activeModules?: ModuleKey[]
  onModulesChange?: (modules: ModuleKey[]) => void
  audioMode?: 'music' | 'podcast'
  initialPodcastMeta?: PodcastMeta
}

// ── Lazy view imports ─────────────────────────────────────────────────────────

/** window.__daw* console/automation hooks. On in development; a production build
 *  can opt in with NEXT_PUBLIC_DAW_HOOKS=1, which is how a prod bundle gets
 *  profiled or driven headlessly — dev-mode React is several times slower than
 *  what ships, so measuring only the dev server measures the wrong program.
 *  Off by default in production. */
const DAW_HOOKS = process.env.NODE_ENV === 'development' || process.env.NEXT_PUBLIC_DAW_HOOKS === '1'

const EpisodePanel = dynamic(() => import('./daw/EpisodePanel'), { ssr: false })
const SessionView = dynamic(() => import('./daw/SessionView'), { ssr: false })
const ArrangementView = dynamic(() => import('./daw/ArrangementView'), { ssr: false })
const Mixer = dynamic(() => import('./daw/Mixer'), { ssr: false })
const PianoRoll = dynamic(() => import('./daw/PianoRoll'), { ssr: false })
const DeviceChain = dynamic(() => import('./daw/DeviceChain'), { ssr: false })
const ReturnDeviceChain = dynamic(() => import('./daw/DeviceChain').then(m => ({ default: m.ReturnDeviceChain })), { ssr: false })
const InstrumentPicker = dynamic(() => import('./daw/InstrumentPicker'), { ssr: false })
const PadInput = dynamic(() => import('./daw/PadInput'), { ssr: false })
// Liveblocks only loads for saved projects — keeps collab out of the main editor chunk
const CollabLayer = dynamic(() => import('./daw/CollabLayer'), { ssr: false })
const DawMixSync = dynamic(() => import('./DawMixSync'), { ssr: false })   // cross-project audio links (live)

// Build-history coalescing: a slider drag or repeated tweaks of one control fire
// many same-target UPDATE actions — collapse them to a single net step. Returns
// a stable key for "the same control", or null for non-coalescable actions.
const COALESCE_TYPES = new Set<string>([
  'UPDATE_TRACK', 'UPDATE_EFFECT', 'UPDATE_CLIP', 'UPDATE_MIDI_NOTE', 'UPDATE_CLIP_EFFECT',
  'UPDATE_RETURN_EFFECT', 'UPDATE_MIDI_EFFECT', 'UPDATE_RETURN_TRACK', 'UPDATE_AUTOMATION_POINT',
  'MOVE_CLIP', 'MOVE_TRACK', 'SET_TEMPO', 'SET_SWING', 'SET_MASTER_VOLUME', 'SET_CROSSFADER', 'SET_KEY_SCALE',
])
// View / transport-only actions — they change how the project is viewed or
// played, not its creative content, so they're kept out of the build history
// (the replay is about how the song was made, not where the loop was set).
const HISTORY_EXCLUDE = new Set<string>([
  'SET_LOOP', 'SET_LOOP_ENABLED', 'SET_WAVEFORM_ZOOM', 'SET_CROSSFADER',
])

function buildTargetKey(a: DawAction): string | null {
  if (!COALESCE_TYPES.has(a.type)) return null
  const r = a as unknown as Record<string, unknown>
  const id = ['trackId', 'clipId', 'effectId', 'noteId', 'laneId', 'pointId', 'returnId']
    .map(k => r[k]).filter(v => v != null).join('/')
  const fields = r.patch && typeof r.patch === 'object' ? Object.keys(r.patch as object).sort().join(',') : ''
  return `${a.type}:${id}:${fields}`
}
const AppearancePanel = dynamic(() => import('./daw/AppearancePanel'), { ssr: false })
const SessionRecap = dynamic(() => import('./daw/SessionRecap'), { ssr: false })

// ── Podcast Setup Panel ───────────────────────────────────────────────────────

type MicPermState = 'checking' | 'granted' | 'denied' | 'prompt' | 'unavailable'

// Share button shown before the first save: saving is what creates the
// project id (and its collab room), so sharing simply saves first. The real
// Share button (CollabInvite) takes over the slot once the id exists and
// finishes the gesture via window.__openShareWhenReady.
function UnsavedShareButton({ onShare }: { onShare: () => Promise<void> }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  const [busy, setBusy] = useState(false)
  // Start the flight recorder before anything else can fail. Everything that
  // goes wrong from here — a render that comes back silent, a preset with no
  // samples, a worklet that throws — is written down and survives a reload.
  useEffect(() => { void import('@/lib/diag-journal').then(m => m.installDiag()) }, [])
  // ⚠️ Installed once for the whole studio, not per draggable thing. The
  // browser's own text selection is what appears under a drag, and it appears
  // wherever the pointer travels — so the guard has to be on the page, not on
  // the handle. See lib/ui/drag-selection-guard.ts.
  useEffect(() => installDragSelectionGuard(), [])

  useEffect(() => {
    const find = () => {
      const el = document.getElementById('transport-collab-slot')
      if (el) setSlot(el)
      return !!el
    }
    if (find()) return
    const t = setInterval(() => { if (find()) clearInterval(t) }, 200)
    return () => clearInterval(t)
  }, [])
  if (!slot) return null
  return createPortal(
    <button
      onClick={() => {
        if (busy) return
        setBusy(true)
        ;(window as unknown as { __openShareWhenReady?: boolean }).__openShareWhenReady = true
        void onShare().finally(() => setBusy(false))
      }}
      title="Share this project (saves it first)"
      data-help-id="invite"
      style={{
        display: 'flex', alignItems: 'center', gap: 5,
        fontSize: 10, height: 24, padding: '0 8px', borderRadius: 5,
        border: '1px solid var(--border)',
        background: 'rgb(var(--accent-rgb) / 0.08)', color: 'var(--accent-light)',
        cursor: busy ? 'wait' : 'pointer', fontWeight: 600, whiteSpace: 'nowrap', flexShrink: 0,
      }}
    >
      <PlusCircle size={12} />
      {busy ? 'Saving…' : 'Share'}
    </button>,
    slot,
  )
}

function PodcastSetupPanel() {
  const { project, dispatch } = useDaw()
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([])
  const [openTrackId,  setOpenTrackId]  = useState<string | null>(null)
  const [micPerm, setMicPerm] = useState<MicPermState>('checking')
  const isElectron = typeof window !== 'undefined' && !!(window as Window & { electronAPI?: unknown }).electronAPI

  // Detect permission state on mount, and watch for changes
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setMicPerm('unavailable')
      return
    }
    const perm = navigator.permissions as Permissions & { query?: (d: { name: string }) => Promise<PermissionStatus> }
    if (perm?.query) {
      perm.query({ name: 'microphone' })
        .then(status => {
          setMicPerm(status.state as MicPermState)
          status.onchange = () => setMicPerm(status.state as MicPermState)
        })
        .catch(() => setMicPerm('prompt'))
    } else {
      setMicPerm('prompt')
    }
  }, [])

  async function requestMicAccess() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.getTracks().forEach(t => t.stop())
      setMicPerm('granted')
      const devs = await navigator.mediaDevices.enumerateDevices()
      setAudioDevices(devs.filter(d => d.kind === 'audioinput'))
    } catch (err) {
      if (err instanceof DOMException && err.name === 'NotAllowedError') setMicPerm('denied')
    }
  }

  useEffect(() => {
    navigator.mediaDevices?.enumerateDevices().then(devs => {
      setAudioDevices(devs.filter(d => d.kind === 'audioinput'))
    }).catch(() => {})
  }, [])

  const voiceTracks = project.tracks.filter(
    t => t.type === 'audio' && (t.name === 'Host' || /^Guest \d+$/.test(t.name))
  )

  function getDeviceName(inputSource: string | null | undefined): string | null {
    if (!inputSource) return null
    if (inputSource === 'mic') return 'Default Microphone'
    if (inputSource === 'system') return 'System Audio'
    return audioDevices.find(d => d.deviceId === inputSource)?.label || 'Microphone'
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '10px' }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.07em', marginBottom: 8, textTransform: 'uppercase' }}>
        Recording Setup
      </div>
      {voiceTracks.map(track => {
        const deviceName = getDeviceName(track.inputSource)
        return (
          <div key={track.id} style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: track.color, flexShrink: 0 }} />
              <span style={{ fontSize: 11, color: 'var(--text-primary)', flex: 1 }}>{track.name}</span>
              {/* Test-level VU meter — active whenever a source is selected */}
              <VUMeter deviceId={track.inputSource} active={!!track.inputSource} />
              <button
                onClick={() => setOpenTrackId(openTrackId === track.id ? null : track.id)}
                title="Select microphone input"
                style={{
                  fontSize: 9, padding: '2px 6px', borderRadius: 3, cursor: 'pointer', fontWeight: 700,
                  border: `1px solid ${track.inputSource ? 'var(--accent)' : 'var(--border)'}`,
                  background: track.inputSource ? 'rgb(var(--accent-rgb) / 0.15)' : 'var(--bg-surface)',
                  color: track.inputSource ? 'var(--accent-light)' : 'var(--text-muted)',
                }}
              >MIC</button>
            </div>
            {deviceName && (
              <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 2, marginLeft: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {deviceName}
              </div>
            )}
            {openTrackId === track.id && (
              <select
                value={track.inputSource ?? ''}
                onChange={e => {
                  const deviceId = e.target.value || null
                  dispatch({ type: 'UPDATE_TRACK', trackId: track.id, patch: { inputSource: deviceId } })
                  setOpenTrackId(null)
                }}
                style={{ width: '100%', fontSize: 11, padding: '3px 5px', marginTop: 4, background: 'var(--bg-base)', border: '1px solid var(--border)', color: 'var(--text-primary)', borderRadius: 3, outline: 'none', cursor: 'pointer' }}
              >
                <option value="">— None —</option>
                <option value="mic">Microphone (default)</option>
                {audioDevices.map(d => (
                  <option key={d.deviceId} value={d.deviceId}>{d.label || 'Microphone'}</option>
                ))}
                <option value="system">System Audio</option>
              </select>
            )}
          </div>
        )
      })}
      {/* Mic permission diagnostic */}
      <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.07em', marginBottom: 8, textTransform: 'uppercase' }}>
          Microphone Status
        </div>

        {micPerm === 'granted' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#4ade80' }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#4ade80', flexShrink: 0 }} />
            Microphone access granted
          </div>
        )}

        {micPerm === 'prompt' && (
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>
              Microphone access hasn&apos;t been granted yet. Click below to allow it.
            </div>
            <button
              onClick={requestMicAccess}
              style={{ fontSize: 11, padding: '4px 10px', borderRadius: 4, border: '1px solid var(--accent)', background: 'rgb(var(--accent-rgb) / 0.15)', color: 'var(--accent-light)', cursor: 'pointer', width: '100%' }}
            >
              Grant Microphone Access
            </button>
          </div>
        )}

        {micPerm === 'denied' && (
          <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 4, padding: '8px 10px', fontSize: 11, color: '#fca5a5', lineHeight: 1.6 }}>
            <strong style={{ color: '#f87171' }}>Microphone blocked.</strong>
            {isElectron ? (
              <ol style={{ margin: '5px 0 0 14px', padding: 0 }}>
                <li>Open <strong>System Settings → Privacy &amp; Security → Microphone</strong></li>
                <li>Enable access for <strong>100Lights</strong></li>
                <li>Restart the app</li>
              </ol>
            ) : (
              <ol style={{ margin: '5px 0 0 14px', padding: 0 }}>
                <li>Click the <strong>lock icon</strong> in your browser&apos;s address bar</li>
                <li>Set <strong>Microphone</strong> to <em>Allow</em></li>
                <li>Reload the page</li>
              </ol>
            )}
          </div>
        )}

        {micPerm === 'unavailable' && (
          <div style={{ fontSize: 11, color: '#f97316', lineHeight: 1.6 }}>
            Your browser doesn&apos;t support microphone access. Use Chrome, Edge, or Safari.
          </div>
        )}
      </div>

      <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.07em', marginBottom: 8, textTransform: 'uppercase' }}>
          Quick Tips
        </div>
        <ul style={{ margin: 0, padding: '0 0 0 14px', fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.7, listStyleType: 'disc' }}>
          <li>Arm a track (•) then press record</li>
          <li>Voice chain is pre-applied to voice tracks</li>
          <li>Use Music Bed for background music at low volume</li>
        </ul>
      </div>
    </div>
  )
}

// ── Initial project builder ───────────────────────────────────────────────────

function buildInitialProject(tracks: AudioTrack[]): DawProject {
  const base = defaultProject()
  const dawTracks: DawTrack[] = tracks.map((t, i) => ({
    id: t.id,
    name: t.name,
    type: 'audio' as const,
    color: TRACK_COLORS[i % TRACK_COLORS.length],
    volume: 0.8,
    pan: 0,
    mute: false,
    solo: false,
    armed: false,
    height: DEFAULT_TRACK_HEIGHT,
    effects: [],
    instrument: defaultTrackInstrument('audio'),
  }))
  const beatsPerSecond = base.tempo / 60
  const arrangementClips = tracks.map(t =>
    makeAudioClip(t.id, t.name, 0, t.duration * beatsPerSecond, {
      audioUrl: t.url,
      r2Key: t.r2Key,
    })
  )
  const sessionGrid: Record<string, (null)[]> = {}
  for (const t of dawTracks) {
    sessionGrid[t.id] = Array(base.scenes.length).fill(null)
  }
  return { ...base, tracks: dawTracks, arrangementClips, sessionGrid }
}

function buildPodcastProject(): DawProject {
  const base = defaultProject()
  const tracks: DawTrack[] = [
    { id: crypto.randomUUID(), name: 'Host',    type: 'audio', color: TRACK_COLORS[0], volume: 0.8, pan: 0, mute: false, solo: false, armed: false, height: DEFAULT_TRACK_HEIGHT, effects: [], instrument: defaultTrackInstrument('audio') },
    { id: crypto.randomUUID(), name: 'Guest 1', type: 'audio', color: TRACK_COLORS[1], volume: 0.8, pan: 0, mute: false, solo: false, armed: false, height: DEFAULT_TRACK_HEIGHT, effects: [], instrument: defaultTrackInstrument('audio') },
    { id: crypto.randomUUID(), name: 'Music Bed', type: 'audio', color: TRACK_COLORS[2], volume: 0.3, pan: 0, mute: false, solo: false, armed: false, height: DEFAULT_TRACK_HEIGHT, effects: [], instrument: defaultTrackInstrument('audio') },
  ]
  const sessionGrid: Record<string, (null)[]> = {}
  for (const t of tracks) sessionGrid[t.id] = Array(base.scenes.length).fill(null)
  return { ...base, tracks, sessionGrid, tempo: 0 }
}

const DEFAULT_PODCAST_META: PodcastMeta = {
  showName: '', episodeTitle: '', episodeNumber: null, season: null, description: '', guests: '',
}

// ── Main component ────────────────────────────────────────────────────────────


// The Apollo Rack window, mounted by the editor so it outlives the Devices
// panel that opens it (and so it can be moved/resized over Beacon while you
// keep working).
const ApolloCardLazy = dynamic(() => import('@/components/apps/apollo/ApolloCard'), { ssr: false })
function ApolloRackWindow({ trackId, seed, trackName, following, onToggleFollow, onChange, onClose, detached, onToggleDetach }: {
  trackId: string
  seed: unknown
  trackName: string
  following: boolean
  onToggleFollow: () => void
  onChange: (next: { fxMain: unknown[] }) => void
  onClose: () => void
  /** True while this rack is drawn in its own OS window. */
  detached?: boolean
  onToggleDetach?: () => void
}) {
  // Opened from the transport there is no seed yet: build one from this
  // track's FX chain. Rebuilt when the window retargets to another track.
  //
  // The patch is tagged with the track it was built for. ApolloCard snapshots
  // its patch prop on mount, so rendering it with a patch belonging to the
  // PREVIOUS track — which is what the first render after a retarget would do,
  // before the async rebuild lands — would leave the old track's FX on screen
  // for good. Nothing renders until the two agree.
  const [built, setBuilt] = useState<{ forTrack: string; patch: unknown; hasVoice: boolean } | null>(
    seed ? { forTrack: trackId, patch: seed, hasVoice: patchHasVoice(seed) } : null,
  )
  const { project, dispatch } = useDaw()
  useEffect(() => {
    if (seed) { setBuilt({ forTrack: trackId, patch: seed, hasVoice: patchHasVoice(seed) }); return }
    let cancelled = false
    void (async () => {
      const track = project.tracks.find(t => t.id === trackId)
      const { translateChain } = await import('@/lib/apollo/daw-fx')
      const { translateInstrument } = await import('@/lib/apollo/daw-synth')
      const { initPatch } = await import('@/lib/apollo/patch')
      // Take the track's instrument when Apollo can express it, so playing the
      // hosted clip sounds like the track rather than like nothing. Sampled
      // instruments have no Apollo equivalent — those fall back to the silent
      // FX-only patch, and the footer disables play and says why.
      const voice = track?.instrument ? translateInstrument(track.instrument) : null
      const p = voice ?? initPatch()
      if (!voice) {
        for (const o of p.oscs) o.enabled = false
        p.sub.enabled = false; p.noise.enabled = false
        p.matrix = []
      }
      p.fxMain = (track?.effects?.length ? translateChain(track.effects, project.tempo) : []) ?? []
      p.fxBus1 = []; p.fxBus2 = []
      // Apollo should agree with the project about what key the song is in.
      const { patchWithProjectKey } = await import('@/lib/apollo/daw-sample')
      const keyed = patchWithProjectKey(p, project.key ?? 0, project.scale ?? 'major')
      if (!cancelled) setBuilt({ forTrack: trackId, patch: keyed, hasVoice: patchHasVoice(keyed) })
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackId, seed])

  const basePatch = built?.forTrack === trackId ? built.patch : null

  // Mirror of the patch handed to the card, so the item can push it into the
  // worklet on play (see useApolloTrackItem).
  const patchRef = useRef<unknown>(null)
  const item = useApolloTrackItem(trackId, () => patchRef.current)
  // A patch the card must ADOPT rather than merely see: loading a clip into an
  // oscillator rewrites the patch, and ApolloProvider only reads its prop at
  // mount, so the card is remounted on the stamp. Cleared when the window
  // retargets, or the new track would inherit the old track's sample.
  const [override, setOverride] = useState<{ patch: unknown; stamp: number } | null>(null)
  useEffect(() => { setOverride(null) }, [trackId])
  // Auto-load the selected item's samples once there is a patch to build on.
  // Driven from here because `basePatch` arrives asynchronously and this effect
  // re-runs when it does.
  useEffect(() => {
    if (!basePatch || override) return
    let cancelled = false
    void item.autoLoadPreset(basePatch as never).then(next => {
      if (next && !cancelled) setOverride({ patch: next, stamp: Date.now() })
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basePatch, override, item.autoLoadPreset])
  // Capture times against whichever clock is running: Apollo's, while the
  // hosted item is looping there, otherwise the DAW transport.
  const motion = useApolloMotion(trackId, { beatSource: item.timelineBeat })

  // Hand the clip to Apollo's own sequencer. It rides along on the patch and is
  // never read back out — onChange only consumes fxMain — so it cannot leak
  // into the track's effects.
  const patch = useMemo(() => {
    const base = override?.patch ?? basePatch
    if (!base) return null
    if (!item.apolloClip) return base
    return { ...(base as object), clips: [item.apolloClip], activeClip: 0, clipMode: true }
  }, [basePatch, override, item.apolloClip])

  patchRef.current = patch

  if (!patch) return null
  return (
    <ApolloCardLazy
      key={`${trackId}:${item.itemKey}:${override?.stamp ?? 0}`}
      patch={patch as never}
      // Opened from a track's Devices panel the subject IS the effect chain, so
      // start there; opened from the transport it is the whole instrument.
      scope={seed ? 'fx' : 'all'}
      title={trackName}
      onParamMove={motion.onParamMove}
      liveParams={motion.live}
      top={
        <ApolloTrackItemBar
          item={item}
          trackName={trackName}
          canPlay={!!built?.hasVoice}
          recording={motion.recording}
          onToggleRecord={motion.toggleRecord}
          lanes={motion.lanes}
          onRevert={motion.revertParam}
          onRevertAll={motion.revertAll}
          onPatch={next => setOverride({ patch: next, stamp: Date.now() })}
          patch={patch}
          trackId={trackId}
        />
      }
      headerExtra={
        <>
        {/* ⚠️ Desktop only. A browser can open a popup, but it is blocked by
            default and buried behind the window often enough that the button
            would mostly appear to do nothing. The desktop app opens a real
            panel window every time, which is the whole point of asking. */}
        {onToggleDetach && typeof window !== 'undefined' && !!window.electronAPI && (
          <button
            onClick={onToggleDetach}
            title={detached
              ? 'Put it back in the main window'
              : 'Open in its own window — move it anywhere, including another screen'}
            style={{
              width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center',
              borderRadius: 7, cursor: 'pointer',
              border: `1px solid ${detached ? 'var(--accent)' : 'var(--border)'}`,
              background: detached ? 'rgb(var(--accent-rgb) / .22)' : 'var(--bg-elevated, #16181d)',
              color: detached ? 'var(--accent-light)' : 'var(--text-muted)',
            }}
          >
            {detached ? <Minimize2 size={13} /> : <ExternalLink size={13} />}
          </button>
        )}
        {/* Following means "always show the selected track". Pinning holds the
            window on one track so picking sounds elsewhere in Beacon can't yank
            an edit-in-progress away. */}
        <button
          onClick={onToggleFollow}
          data-apollo-follow={following ? '1' : '0'}
          title={following ? 'Following the selected track — click to pin to this one' : `Pinned to ${trackName} — click to follow the selection`}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            fontSize: 10, fontWeight: 700, letterSpacing: 0.4, padding: '4px 9px', borderRadius: 999, cursor: 'pointer',
            background: 'transparent',
            color: following ? 'var(--accent, #4aa9ff)' : 'var(--text-muted, #8b93a0)',
            border: `1px solid ${following ? 'var(--accent, #4aa9ff)' : 'var(--border, #262c35)'}`,
          }}
        ><PinGlyph pinned={!following} />{following ? 'FOLLOWING' : 'PINNED'}</button>
        </>
      }
      onChange={(next: unknown) => {
        onChange(next as { fxMain: unknown[] })
        // The window shows the whole instrument now, so oscillator, filter,
        // envelope and mod edits have to persist too — otherwise they sound
        // while the window is open and vanish the moment it closes.
        //
        // Only for a track Apollo can actually voice. A sampled or builtin
        // instrument has no Apollo equivalent, so the patch standing in for it
        // is a silent placeholder, and writing that back would replace a
        // working instrument with silence.
        const track = project.tracks.find(t => t.id === trackId)
        // Ask the patch on screen, not the one originally built: an auto-loaded
        // preset gives the card a real voice even though the built patch had
        // none, and its edits have to persist like any other.
        if (!patchHasVoice(next) && !built?.hasVoice && track?.instrument?.type !== 'apollo') return
        const voice = JSON.parse(JSON.stringify(next)) as { fxMain: unknown[]; fxBus1: unknown[]; fxBus2: unknown[] }
        // FX live on the track's own chain; keeping a copy here as well would
        // process everything twice.
        voice.fxMain = []; voice.fxBus1 = []; voice.fxBus2 = []
        dispatch({ type: 'SET_INSTRUMENT', trackId, instrument: { type: 'apollo', params: voice } as never })
        // An edit is the moment the sound genuinely moves to Apollo. Release
        // the clips from Beacon's own sampler now — a clip's presetId overrides
        // the track instrument, so leaving it set would have the preset play
        // twice with Apollo shaping only half of it.
        item.commitHandover()
      }}
      onClose={() => { item.stop(); onClose() }}
    />
  )
}



/**
 * Does this patch actually make a sound on its own?
 *
 * The rack is reached two ways, and only one of them carries an instrument.
 * Opened from a track's Devices panel the patch is an FX-only shell with every
 * oscillator switched off, built purely to edit the effect chain. Treating that
 * as a voice and saving it as the track's instrument replaces a working sound
 * with silence — which is exactly what "I added some effects and it stopped
 * producing audio" looks like from the outside. So this asks the patch rather
 * than trusting where it came from.
 */
function patchHasVoice(patch: unknown): boolean {
  const p = patch as {
    oscs?: { enabled?: boolean }[]
    sub?: { enabled?: boolean }
    noise?: { enabled?: boolean }
  } | null
  if (!p) return false
  return !!(p.oscs?.some(o => o?.enabled) || p.sub?.enabled || p.noise?.enabled)
}

// Flat thumbtack, drawn as a single-weight stroke so it sits with Beacon's
// other line icons — a glyph like ◉ renders as a beveled 3D dot and reads as
// foreign next to them. Solid head when pinned, hollow when following.
function PinGlyph({ pinned }: { pinned: boolean }) {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor"
      strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
      style={{ flex: 'none' }}>
      <path d="M5.6 2.2h4.8" />
      <path d="M6.7 2.2v4.1L4.9 8.7h6.2L9.3 6.3V2.2Z" fill={pinned ? 'currentColor' : 'none'} />
      <path d="M8 8.7V14" />
    </svg>
  )
}

// Retarget helper: kept as a component so the effect runs after render rather
// than setting state during one.
function ApolloFollow({ trackId, onRetarget }: { trackId: string; onRetarget: (id: string) => void }) {
  useEffect(() => { onRetarget(trackId) }, [trackId, onRetarget])
  return null
}

export default function AudioEditor(props: AudioEditorProps) {
  const { initialTracks, onSave, onProjectNameCommit } = props
  const isPodcast = props.audioMode === 'podcast'
  // Optional: the editor also renders in places without the tier provider.
  const uiTier = useUITierOptional()
  const density = uiTier?.density ?? 'comfortable'
  const setDensity = uiTier?.setDensity ?? (() => {})

  const initialProject = useMemo(
    () => {
      // Through migrateProject like every other entry point. This one used to
      // bypass it, which is how a cloud-loaded project could arrive with slim
      // Apollo patches — and now, with no note ids at all.
      if (props.initialDawProject) return migrateProject(props.initialDawProject)
      if (initialTracks?.length) return buildInitialProject(initialTracks)
      if (isPodcast) return buildPodcastProject()
      // A reader carried something over from an article — seed the timeline with it.
      const seed = consumeStudioSeed()
      if (seed) return migrateProject(seed)
      return defaultProject()
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  const [podcastMeta, setPodcastMeta] = useState<PodcastMeta>(props.initialPodcastMeta ?? DEFAULT_PODCAST_META)

  const [project, rawDispatch] = useReducer(reducer, initialProject)
  const engineRef = useRef<DawEngine | null>(null)
  // Create engine on first render; re-create if StrictMode disposed it
  if (engineRef.current === null || engineRef.current.isClosed) {
    engineRef.current = new DawEngine()
  }
  // Capture the current engine instance for this render so it can be a useMemo dep.
  // engineRef.current can silently change (e.g. StrictMode dispose + recreate) without
  // any listed dep changing, which would leave the context stale with the old engine.
  const engineForRender = engineRef.current

  // ── Undo history ────────────────────────────────────────────────────────────
  // How many actions you can step back through. Entries store a reference to the
  // pre-action project (immutable, so this shares structure — cheap), letting us
  // keep a deep stack without deep-copying each snapshot.
  const UNDO_LIMIT = 200
  const historyRef = useRef<UndoEntry<DawProject>[]>([])
  const redoRef    = useRef<UndoEntry<DawProject>[]>([])
  /**
   * The request every dispatch belongs to, while one is open — see
   * beginUndoGroup in the context. A spoken "do these four things" opens one,
   * dispatches four actions inside it, and closes it; ⌘Z or "undo" then takes
   * all four back at once.
   */
  const undoGroupRef = useRef<{ id: string; label?: string } | null>(null)
  // Construction log for the History capture/replay mode (third capture method):
  // the literal forward action stream, folded from empty to re-play how the
  // project was built. Seeded from a loaded project's history so edits continue it.
  const buildLogRef = useRef<NonNullable<DawProject['history']>>(
    initialProject.history ? [...initialProject.history] : []
  )
  const lastCoalesceRef = useRef<{ key: string; time: number } | null>(null)

  // "Consolidate actions": collapse every run of consecutive same-control tweaks
  // in the build log to its net (final) value. Returns the new step count.
  const consolidateBuildHistory = useCallback((): number => {
    const src = buildLogRef.current
    const out: NonNullable<DawProject['history']> = []
    for (const entry of src) {
      const key = buildTargetKey(entry.action as unknown as DawAction)
      const last = out[out.length - 1]
      if (key && last && buildTargetKey(last.action as unknown as DawAction) === key) out[out.length - 1] = entry
      else out.push(entry)
    }
    buildLogRef.current = out
    lastCoalesceRef.current = null
    return out.length
  }, [])
  const projectRef         = useRef(project)
  const selectedTrackIdRef = useRef<string | null>(null)
  // ── Cross-project audio links (studio audio→audio host, Phase 3) ─────────────
  // A linked audio clip renders ANOTHER project's mix and re-syncs live via that
  // project's room. Replicas + names per source; DawMixSync mounts per source id.
  const sourceReplicasRef = useRef<Map<string, import('@/lib/daw-types').DawProject>>(new Map())
  const sourceNamesRef    = useRef<Map<string, string>>(new Map())
  const [linkedSourceIds, setLinkedSourceIds] = useState<string[]>([])
  const [showLinkPicker, setShowLinkPicker] = useState(false)
  const [linkPickerProjects, setLinkPickerProjects] = useState<Array<{ id: string; name: string }> | null>(null)
  const linkBusyRef = useRef<Set<string>>(new Set())
  const linkTimerRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const [projectLoaded, setProjectLoaded] = useState(!props.projectId)   // new (no cloud id) = ready now; cloud = after LOAD_PROJECT
  const voiceChainAppliedRef = useRef(false)

  // ── Collab broadcast refs ────────────────────────────────────────────────────
  const broadcastRef  = useRef<((action: DawAction) => void) | null>(null)
  const isRemoteRef   = useRef(false)

  // Actions that shouldn't be synced to collaborators (view/UI preferences)
  // Loop region/toggle are deliberately local: each collaborator loops their
  // own playback without yanking everyone else's transport around.
  const NO_BROADCAST = new Set<DawAction['type']>(['LOAD_PROJECT', 'SET_WAVEFORM_ZOOM', 'SET_CROSSFADER', 'SET_LOOP', 'SET_LOOP_ENABLED'])
  // Clip-scoped mutations — refused when a collaborator holds that clip's lock.
  const CLIP_LOCK_ACTIONS = new Set<DawAction['type']>(['REMOVE_CLIP', 'UPDATE_CLIP', 'MOVE_CLIP', 'ADD_MIDI_NOTE', 'REMOVE_MIDI_NOTE', 'UPDATE_MIDI_NOTE'])

  // ── Blink guidance — local only, never broadcast ─────────────────────────────
  const [blinkIds, setBlinkIds] = useState<Set<string>>(new Set())
  const triggerBlink = useCallback((ids: string[]) => {
    setBlinkIds(new Set(ids))
    setTimeout(() => setBlinkIds(new Set()), 1400)
  }, [])

  // ── Offline persistence — IndexedDB autosave + crash/offline recovery ───────
  const snapshotKey = props.projectId ?? `unsaved:${props.audioMode ?? 'music'}`
  const [restorePrompt, setRestorePrompt] = useState<{ savedAt: number; project: DawProject } | null>(null)
  const [resumeExport, setResumeExport] = useState(false)
  const [isOffline, setIsOffline] = useState(false)
  const restoreResolvedRef = useRef(false)
  const autosaveTimerRef = useRef<number | null>(null)
  // Unsaved-changes indicator (shown by the header ProjectSwitcher). Set on a
  // user edit, cleared once the local snapshot lands — same transient semantics
  // as the video editor's isDirty.
  const [dawDirty, setDawDirty] = useState(false)
  /** Progress text while baking synth tracks to audio; null when not freezing. */
  const [freezing, setFreezing] = useState<string | null>(null)
  const freezingA = useAppear(!!freezing, 'drop')
  const freezingS = useSticky(freezing)
  const dirtyReadyRef = useRef(false)   // skip the first post-load settle
  /**
   * Has anything actually changed since the last successful save?
   *
   * Brae: "I don't want to save then leave and have an unsaved file from a
   * previous edit telling me that I have unsaved changes."
   *
   * ⚠️ THE ACT OF LEAVING WAS CAUSING IT. Hiding the tab flushes a snapshot,
   * and that flush wrote `synced: false` unconditionally — so saving and then
   * closing the window marked the file unsynced ON THE WAY OUT, and the next
   * open found an unsynced snapshot and offered to restore an edit that had
   * already been saved. The debounced write could do the same thing, landing
   * 1.5 seconds after a save that had just marked the snapshot clean.
   *
   * A snapshot still gets written either way — losing the recovery copy would
   * be a far worse trade — but it is only marked UNSYNCED when there is
   * genuinely something the server has not got.
   */
  const changedSinceSaveRef = useRef(false)
  // Offline sync (Phase C): a pending 3-way merge whose conflicts need resolving.
  const [pendingMerge, setPendingMerge] = useState<{ merged: DawProject; conflicts: MergeConflict[] } | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState<string | null>(null)

  // Guests build freely; saving or exporting needs an account. Flush the work
  // to the local snapshot first (so nothing is lost across the sign-up round
  // trip), stash which action to resume, then send them to sign-up and back.
  function requireAccount(action: 'save' | 'export') {
    try { void saveSnapshot(snapshotKey, projectRef.current) } catch { /* best effort */ }
    try { sessionStorage.setItem('100lights-resume', JSON.stringify({ key: snapshotKey, action })) } catch { /* ok */ }
    const back = typeof window !== 'undefined' ? window.location.pathname + window.location.search : '/create?modules=audio'
    if (typeof window !== 'undefined') window.location.assign(`/sign-up?redirect_url=${encodeURIComponent(back)}`)
  }
  const requireAccountRef = useRef(requireAccount)
  useEffect(() => { requireAccountRef.current = requireAccount })

  // Open / Import Files — pick a project (.cfproj / Firefly .zip) to open, or raw
  // media. Opening a PROJECT navigates (loads via the /projects/<id> route), so
  // flush + confirm if there are edits.
  //
  // Audio, though, imports straight into the project already open — one track
  // per file, no navigation. It used to hand off to a fresh project instead,
  // which threw away whatever you were working on to make room for the file you
  // wanted to add to it. Video still hands off, since Beacon can't show picture.
  async function handleOpenImport() {
    const read = await openProjectsFromFile().catch(() => null)
    if (!read) return
    if (read.media.length) {
      const engine = engineRef.current
      if (engine && read.media.every(f => detectMediaKind(f) === 'audio')) {
        const { importAudioFiles } = await import('@/lib/daw-audio-import')
        await importAudioFiles(read.media, { engine, dispatch })
        return
      }
      await openMediaInStudio(read.media)
      return
    }
    const proj = read.projects[0]
    if (!proj) { if (read.errors.length) window.alert(read.errors[0]); return }
    if (dawDirty && !window.confirm('Open a different project? Unsaved changes to the current one will be lost.')) return
    try { void saveSnapshot(snapshotKey, projectRef.current) } catch { /* best effort */ }
    localStorage.setItem(`cf_pending_cfproj_${proj.id}`, JSON.stringify(proj))
    window.location.assign(`/projects/${proj.id}`)
  }

  // Offer to restore a local snapshot that never made it to the server.
  // Special case: if we just came back from the guest sign-up gate for THIS
  // project, restore silently (no prompt) and resume the action they wanted.
  useEffect(() => {
    let cancelled = false
    let resume: { key: string; action: 'save' | 'export' } | null = null
    try {
      const raw = sessionStorage.getItem('100lights-resume')
      if (raw) resume = JSON.parse(raw)
    } catch { /* ignore */ }
    loadSnapshot(snapshotKey)
      .then(rec => {
        if (cancelled) return
        const differs = rec && JSON.stringify(rec.project) !== JSON.stringify(projectRef.current)
        const resumingHere = resume && resume.key === snapshotKey && !props.isGuest
        if (rec && resumingHere) {
          // Seamless: bring the work straight back, no Restore/Discard prompt
          sessionStorage.removeItem('100lights-resume')
          rawDispatch({ type: 'LOAD_PROJECT', project: migrateProject(rec.project) })
          restoreResolvedRef.current = true
          if (resume!.action === 'save') setTimeout(() => { void handleSaveRef.current() }, 400)
          if (resume!.action === 'export') setTimeout(() => setResumeExport(true), 400)
        } else if (rec && !rec.synced && differs) {
          setRestorePrompt({ savedAt: rec.savedAt, project: rec.project })
        } else {
          // No unsynced local edits — the loaded project is the synced state, so
          // record it as the branch point for offline 3-way merge (existing
          // projects only; a fresh /new project gets its base on first save).
          if (props.projectId) void saveSnapshot(snapshotKey, projectRef.current, { synced: true }).catch(() => {})
          restoreResolvedRef.current = true
        }
      })
      .catch(() => { restoreResolvedRef.current = true })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshotKey])

  // Debounced autosave — held until the restore prompt is resolved so the
  // initial (empty) project can't clobber a recoverable snapshot
  useEffect(() => {
    if (!restoreResolvedRef.current) return
    // The first run after the restore resolves is the loaded project settling —
    // not a user edit — so don't light the dot for it.
    if (!dirtyReadyRef.current) dirtyReadyRef.current = true
    else { setDawDirty(true); changedSinceSaveRef.current = true }
    if (autosaveTimerRef.current !== null) window.clearTimeout(autosaveTimerRef.current)
    autosaveTimerRef.current = window.setTimeout(() => {
      // Unsynced only if the server really is behind. A snapshot written after
      // a save, for a project nothing has touched since, is the SAVED state.
      void saveSnapshot(snapshotKey, projectRef.current, { synced: !changedSinceSaveRef.current }).catch(() => {})
      setDawDirty(false)   // recoverable now
    }, 1500)
    return () => { if (autosaveTimerRef.current !== null) window.clearTimeout(autosaveTimerRef.current) }
  }, [project, snapshotKey])

  // Flush immediately when the tab is hidden / window is closing
  useEffect(() => {
    function flush() {
      if (!restoreResolvedRef.current) return
      if (document.visibilityState === 'hidden') {
        // ⚠️ This is the one that produced the phantom. Leaving is not editing.
        void saveSnapshot(snapshotKey, projectRef.current, { synced: !changedSinceSaveRef.current }).catch(() => {})
      }
    }
    document.addEventListener('visibilitychange', flush)
    return () => document.removeEventListener('visibilitychange', flush)
  }, [snapshotKey])

  // Online / offline indicator — and reconcile offline edits on reconnect.
  useEffect(() => {
    setIsOffline(!navigator.onLine)
    const on = () => { setIsOffline(false); void syncOfflineEditsRef.current() }
    const off = () => setIsOffline(true)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])

  function handleRestore() {
    if (!restorePrompt) return
    rawDispatch({ type: 'LOAD_PROJECT', project: migrateProject(restorePrompt.project) })
    restoreResolvedRef.current = true
    setRestorePrompt(null)
  }

  function handleDiscardRestore() {
    void deleteSnapshot(snapshotKey).catch(() => {})
    restoreResolvedRef.current = true
    setRestorePrompt(null)
  }

  // Auto-dismiss the restore prompt after 15s so a stray click can't roll the
  // current session back to older, unwanted edits. Timing out keeps the current
  // project (does NOT restore) and releases the autosave hold, which then
  // overwrites the stale snapshot.
  useEffect(() => {
    if (!restorePrompt) return
    const t = window.setTimeout(() => {
      restoreResolvedRef.current = true
      setRestorePrompt(null)
    }, 15000)
    return () => window.clearTimeout(t)
  }, [restorePrompt])

  // ── Per-track external input recording ──────────────────────────────────────
  type InputRec = { recorder: MediaRecorder; startBeat: number; chunks: Blob[] }
  const inputRecsRef    = useRef<Map<string, InputRec>>(new Map())
  // Loop recording: pass counter + wrap watcher (each loop pass becomes a take)
  const recPassRef = useRef(0)
  const wrapWatchRef = useRef<number | null>(null)
  const inputStreamsRef = useRef<Map<string, MediaStream>>(new Map())
  // Seed default samples once per browser (no-op if already done)
  // Seeding moved to SoundLibrary: it must run AFTER initLibrary(user) —
  // seeding pre-identity raced the per-user db/guard namespace and duplicated
  // the library on every load.

  // Prefetch lazy view chunks once the editor is idle, so the first switch to
  // Mixer / Session / Piano Roll / device panels doesn't pause on a network fetch
  useEffect(() => {
    const prefetch = () => {
      void import('./daw/SessionView')
      void import('./daw/Mixer')
      void import('./daw/PianoRoll')
      void import('./daw/DeviceChain')
      void import('./daw/InstrumentPicker')
    }
    const w = window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void }
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(prefetch, { timeout: 4000 })
      return () => w.cancelIdleCallback?.(id)
    }
    const t = window.setTimeout(prefetch, 2500)
    return () => window.clearTimeout(t)
  }, [])

  // Keep engine in sync with available MIDI presets. engineForRender dep:
  // after a StrictMode dispose the recreated engine starts with an empty
  // preset list, which silences all preset-backed MIDI playback in dev.
  useEffect(() => {
    engineForRender.setPresets(combinePresets(project.presets))
    // Dev console access to the live engine (window.__daw)
    if (DAW_HOOKS) {
      (window as unknown as { __daw?: DawEngine }).__daw = engineRef.current ?? undefined
    }
  }, [engineForRender, project.presets])


  useEffect(() => {
    projectRef.current = project
    // Dev-only read-back of the live project (window.__dawProject).
    //
    // __dawDispatch could already drive the studio from outside; nothing could
    // read the result, so a test could issue a command and then only check that
    // it had not thrown. Verifying a voice command means asserting the TRACK IS
    // MUTED, not that a plausible-looking action was dispatched — the two came
    // apart badly once already, when every mixer command produced a well-formed
    // action naming a track called "[object Object]".
    if (DAW_HOOKS) {
      (window as unknown as { __dawProject?: () => DawProject }).__dawProject = () => projectRef.current
    }
  }, [project])

  // Freeze heavy projects by default.
  //
  // "How big is the project" has an exact answer: the same cost model the render
  // windows use, which prices a song in seconds-to-render on THIS machine. Under
  // ~25s the live path is a brief moment nobody notices while combining catches
  // up. Over it, the live synth is the experience — which is what Undertow was.
  //
  // Runs once per project, only when nothing is frozen yet, and only when the
  // user can undo it (not read-only). It is announced in the status pill and
  // "Unfreeze" is one command away, because a project quietly rewriting its own
  // clips would be alarming even when it is right.
  // What there is to bake, read from the PROJECT rather than from the engine.
  //
  // The first version asked the engine, once, in an effect keyed on "the project
  // loaded" — and that is two separate races. The engine doesn't know about the
  // tracks at that instant; it syncs about 183ms later. And `projectLoaded`
  // starts out TRUE for a project with no cloud id, so the effect fired at mount,
  // before there was an engine OR a project. Either way it saw nothing, returned,
  // and never looked again, because its dependencies never changed a second time.
  // The feature was complete, typechecked, registered — and had never once run.
  //
  // Project state has no such timing: when the clips are there, they are there.
  const apolloGroups = useMemo(() => {
    const byTrack = new Map<string, ApolloInstrumentParams>()
    for (const t of project.tracks) {
      if (t.instrument?.type === 'apollo') byTrack.set(t.id, t.instrument.params as ApolloInstrumentParams)
    }
    if (!byTrack.size) return []
    return [...byTrack].map(([trackId, patch]) => ({
      trackId,
      patch: patch as unknown as Parameters<typeof import('@/lib/apollo/freeze-cache').projectRenderEstimate>[1][number]['patch'],
      clips: project.arrangementClips.filter(
        (c): c is Extract<DawClip, { kind: 'midi' }> => c.kind === 'midi' && c.trackId === trackId && c.notes.length > 0),
    })).filter(g => g.clips.length > 0)
  }, [project.tracks, project.arrangementClips])

  // Baking on load is OFF, and this is the measurement that decided it.
  //
  // Freezing all of Undertow takes 66s of rendering, and Chrome runs an
  // OfflineAudioContext carrying JS worklets on the MAIN THREAD. So the render
  // is not something you can schedule around — while it runs, nothing paints:
  //
  //     frame rate during load    40.8/s   (against 59.9/s when it does not run)
  //     stalls over one second    9
  //     worst single stall        11.3s
  //
  // A studio that locks for eleven seconds on open is the exact complaint that
  // started this work, moved from playback to load time. Batching cannot fix it
  // either — one clip per call still blocked 13.3s on a single long pad clip and
  // nearly doubled the total work (see BATCH in daw-freeze).
  //
  // So freezing stays something you ASK for, where you chose it, expect the
  // wait, and watch a progress pill. Everything below is finished and correct
  // and switches on with one line — once rendering happens off the main thread,
  // which means running Helios as plain DSP in a Worker rather than as a
  // worklet inside an OfflineAudioContext. That is the real fix and it is a
  // separate piece of work.
  const AUTO_FREEZE_ON_LOAD = false

  // Loading progress, for the bar at the top of the studio.
  const [loadProgress, setLoadProgress] = useState<{
    done: number; total: number; active: boolean
    phase: 'head' | 'fill' | 'idle' | 'paused'
    /** "Adding filters (2 of 4)" — the fidelity rung being built. */
    layer?: string; layerIndex?: number; layerCount?: number
    /** Set when the loader has recorded a failure — shown so a stall is never silent. */
    trouble?: string
  }>({ done: 0, total: 0, active: false, phase: 'idle' })
  useEffect(() => {
    let stop: (() => void) | undefined
    let cancelled = false
    void import('@/lib/apollo/freeze-cache').then(({ onCombineProgress }) => {
      if (cancelled) return
      stop = onCombineProgress(setLoadProgress)
    })
    return () => { cancelled = true; stop?.() }
  }, [])

  // ── The loading panel ────────────────────────────────────────────────────
  //
  // Brae: "clicking on the loading text above the loading bar opens upwards a
  // list of what is loading and what's in queue, as well as errors... Keep the
  // information of when the user hits play while it's loading and when loading
  // resumes. This way we can see how playing can get in the way of loading."
  //
  // Everything it shows already existed — combineStats() has counts, the failed
  // list, and a 200-event log that already records `paused` (with the reason:
  // playing) and `resumed`. None of it had anywhere to be seen, so a stall was
  // a pill that said "Loading" and nothing else. Polled only while open: this
  // reads counters, and reading them every frame when nobody is looking is how
  // a diagnostic becomes the thing it is diagnosing.
  const [loadPanel, setLoadPanel] = useState(false)

  // ── "Ready to play" ──────────────────────────────────────────────────────
  //
  // Brae: "When the song is ready to be played it will say so at the bottom of
  // the screen so that users know when their project has loaded."
  //
  // ⚠️ THE ENGINE SAYS WHEN, NOT A TIMER. Every clip's sound arrives on its own
  // schedule — a buffer decoding, a synth's worklet coming up — and the engine
  // reports each ('load-change'). The pill appears the moment nothing is left
  // waiting after something WAS waiting, and only then: a project that opens
  // fully ready says nothing, and one that never finishes never lies.
  const [readyPill, setReadyPill] = useState<null | { ready: number }>(null)
  const wasWaiting = useRef(false)
  useEffect(() => {
    const engine = engineRef.current
    if (!engine) return
    let hideTimer: ReturnType<typeof setTimeout> | null = null
    const check = () => {
      const r = engine.readiness()
      const waiting = r.total > 0 && r.ready < r.total
      if (waiting) { wasWaiting.current = true; return }
      if (!wasWaiting.current) return
      wasWaiting.current = false
      setReadyPill({ ready: r.total })
      if (hideTimer) clearTimeout(hideTimer)
      hideTimer = setTimeout(() => setReadyPill(null), 3200)
    }
    engine.addEventListener('load-change', check)
    // A project that arrives with everything still to load: note it, so the
    // pill can fire when the last piece lands.
    const first = setTimeout(check, 300)
    return () => { engine.removeEventListener('load-change', check); clearTimeout(first); if (hideTimer) clearTimeout(hideTimer) }
  }, [project.id])
  const [loadDetail, setLoadDetail] = useState<{
    ready: number; inFlight: number; queued: number; setAside: number; givenUp: number
    lastError: string | null; failed: [string, number][]
    log: { t: number; kind: string; layer?: string; detail?: string; ms?: number; done?: number; total?: number }[]
  } | null>(null)
  useEffect(() => {
    if (!loadPanel) return
    let alive = true
    const read = () => {
      void import('@/lib/apollo/freeze-cache').then(({ combineStats }) => {
        if (!alive) return
        const st = combineStats()
        setLoadDetail({
          ready: st.ready, inFlight: st.inFlight, queued: st.queued,
          setAside: st.setAside, givenUp: st.givenUp,
          lastError: st.lastError, failed: st.failed, log: st.log,
        })
      }).catch(() => {})
    }
    read()
    const id = setInterval(read, 700)
    return () => { alive = false; clearInterval(id) }
  }, [loadPanel])

  // ── Send the loading story once, when it settles ─────────────────────────
  //
  // Brae: "Errors should go to the program and save in the admin so that you
  // can use it to make edits when we make a pass."
  //
  // One row per session, not one per event: the question a pass asks is "which
  // songs load badly, and on what machine", not "list every window that
  // retried". Sent when loading finishes or gives up, and on the way out of the
  // page — a session that was abandoned half-loaded is the most interesting
  // kind and would otherwise be the one never reported.
  const loadReported = useRef(false)
  const sendLoadReport = useCallback((outcome: string) => {
    if (loadReported.current) return
    loadReported.current = true
    void import('@/lib/apollo/freeze-cache').then(({ combineStats, loadLog }) => {
      const st = combineStats()
      const log = loadLog()
      if (!log.length) return
      const kinds = (...k: string[]) => log.filter(e => k.includes(e.kind)).length
      const paused = log.filter(e => e.kind === 'paused')
      // Time parked for playback, read from the gap between each pause and the
      // resume that followed it — the cost of listening while it loads.
      let pausedMs = 0
      for (const p of paused) {
        const back = log.find(e => e.kind === 'resumed' && e.t > p.t)
        pausedMs += (back?.t ?? log[log.length - 1].t) - p.t
      }
      const nav = navigator as Navigator & { deviceMemory?: number }
      const body = {
        projectId: projectRef.current.id ?? '',
        projectName: projectRef.current.name ?? '',
        wanted: st.progress.total, done: st.progress.done,
        elapsedMs: log.length ? log[log.length - 1].t - log[0].t : 0,
        errors: kinds('window-error', 'layer-error', 'job-error'),
        silent: kinds('silent'),
        setAside: st.setAside, givenUp: st.givenUp,
        playInterruptions: paused.length,
        pausedMs,
        outcome,
        device: `${nav.hardwareConcurrency ?? '?'}core ${nav.deviceMemory ?? '?'}GB ${navigator.platform ?? ''}`.slice(0, 200),
        events: log.slice(-60),
      }
      // keepalive so a report survives the page going away, which is exactly
      // when an abandoned half-load needs reporting.
      void fetch('/api/load-report', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body), keepalive: true,
      }).catch(() => {})
    }).catch(() => {})
  }, [])

  useEffect(() => {
    // Settled: everything asked for has arrived, or the loader stopped trying.
    if (loadProgress.total > 0 && loadProgress.done >= loadProgress.total) sendLoadReport('ok')
  }, [loadProgress.done, loadProgress.total, sendLoadReport])

  useEffect(() => {
    const bye = () => sendLoadReport('left')
    window.addEventListener('pagehide', bye)
    return () => window.removeEventListener('pagehide', bye)
  }, [sendLoadReport])

  // ── Server loading ───────────────────────────────────────────────────────
  //
  // Brae: "when the song is loading we should have a button next to the loading
  // text called 'Switch to server loading' so that users can switch manually",
  // and "have the AI detect when the computer is having trouble... we can
  // switch it to server loading".
  //
  // The detector lives in the loader, where the evidence is. This watches it and
  // OFFERS rather than switching by itself: changing how somebody's studio works
  // without asking is the kind of help nobody wants, and the first thing they
  // would do is wonder what else changed. Once they say yes it is remembered, so
  // a machine that struggles is not asked twice.
  const [serverLoad, setServerLoad] = useState(false)
  const [serverOffer, setServerOffer] = useState<string | null>(null)
  const serverOfferA = useAppear(!!serverOffer, 'rise')
  const offeredServer = useRef(false)

  const switchToServer = useCallback((on: boolean, why: string) => {
    setServerLoad(on)
    setServerOffer(null)
    void import('@/lib/apollo/freeze-cache').then(({ setServerLoading }) => setServerLoading(on, why)).catch(() => {})
    try { localStorage.setItem('beacon.serverLoading', on ? 'on' : 'off') } catch { /* private mode */ }
  }, [])

  useEffect(() => {
    try { if (localStorage.getItem('beacon.serverLoading') === 'on') switchToServer(true, 'remembered') } catch { /* ignore */ }
  }, [switchToServer])

  // ⚠️ The "this machine is struggling, shall I switch you to server loading?"
  // offer used to live here. It watched a bake in progress and fired when the
  // bake went badly — and there is no bake any more: playback is real time, so
  // loadProgress never fills and the offer could only ever be a promise the
  // studio could not keep.
  //
  // Brae: "it will be manual." Server rendering is now one deliberate action —
  // saving a project for offline use — rather than something the app decides
  // for you when it thinks you are having a bad time.

  const autoFroze = useRef(false)
  useEffect(() => {
    if (!AUTO_FREEZE_ON_LOAD) return
    if (autoFroze.current || props.readOnly || isPodcast) return
    if (!apolloGroups.length) return          // nothing to bake YET — look again when there is
    autoFroze.current = true
    const groups = apolloGroups
    let cancelled = false
    void (async () => {
      const { projectRenderEstimate } = await import('@/lib/apollo/freeze-cache')
      const est = projectRenderEstimate(projectRef.current.tempo, groups)
      // Record the decision. Whether a project bakes itself is invisible from
      // the outside — it either happens or nothing happens — and "nothing
      // happened" is the same observation whether the estimate came in under
      // the bar or the whole thing silently failed. Those needed telling apart:
      // this feature spent a day looking broken when it had simply never run.
      ;(window as unknown as { __autoFreeze?: unknown }).__autoFreeze = {
        groups: groups.length, clips: est.clips,
        seconds: Math.round(est.seconds * 10) / 10, shouldFreeze: est.shouldFreeze,
      }
      if (cancelled || !est.shouldFreeze) return
      const { freezeApolloProject } = await import('@/lib/apollo/daw-freeze')
      setFreezing(`Baking ${est.clips} clips so this plays smoothly…`)
      try {
        const frozen = await freezeApolloProject(projectRef.current, {
          onProgress: (d, total) => { if (!cancelled) setFreezing(`Baking ${d}/${total}…`) },
        })
        if (cancelled) return
        const baked = frozen.arrangementClips.filter(c => c.kind === 'audio' && 'frozenFrom' in c).length
        if (baked) {
          rawDispatch({ type: 'LOAD_PROJECT', project: migrateProject(frozen) })
          setFreezing(`Baked ${baked} clips — edit a sound to unbake it`)
        } else {
          setFreezing(null)
        }
      } catch { setFreezing(null) }
      setTimeout(() => { if (!cancelled) setFreezing(null) }, 4000)
    })()
    return () => { cancelled = true }
  }, [apolloGroups, props.readOnly, isPodcast])

  // A frozen clip whose source has changed goes back to being editable.
  //
  // Freezing stores a rendered copy and keeps the notes and patch beside it, so
  // the audio is a CACHE and the notes are the truth. When the truth changes —
  // you edit the track's Apollo patch, or the tempo moves — the cache is simply
  // wrong, and the frozen clip would go on playing the old sound with nothing to
  // tell you. That gap is the reason freezing could not be automatic: silently
  // wrong is worse than slow.
  //
  // Thawing rather than warning, because thawing is what you wanted anyway: the
  // clip becomes a synth clip again, plays the patch you just edited, and can be
  // frozen once you are happy. The stamp comparison is cheap — both halves are
  // memoised on object identity — so this can sit on every project change.
  useEffect(() => {
    const frozen = project.arrangementClips.filter(
      c => c.kind === 'audio' && 'frozenFrom' in c && (c as { frozenFrom?: unknown }).frozenFrom)
    if (!frozen.length) return
    let cancelled = false
    void import('@/lib/apollo/daw-freeze').then(({ isFreezeStale, thawClip }) => {
      if (cancelled) return
      const stale: string[] = []
      for (const c of frozen) {
        const track = project.tracks.find(t => t.id === c.trackId)
        const patch = track?.instrument?.type === 'apollo'
          ? (track.instrument.params as unknown as Parameters<typeof isFreezeStale>[1])
          : null
        if (!patch) continue
        if (isFreezeStale(c as Parameters<typeof isFreezeStale>[0], patch, project.tempo)) stale.push(c.id)
      }
      if (!stale.length || cancelled) return
      const ids = new Set(stale)
      rawDispatch({
        type: 'LOAD_PROJECT',
        project: migrateProject({
          ...projectRef.current,
          arrangementClips: projectRef.current.arrangementClips.map(c =>
            ids.has(c.id) ? (thawClip(c as Parameters<typeof thawClip>[0]) ?? c) : c),
        }),
      })
    }).catch(() => {})
    return () => { cancelled = true }
  }, [project.arrangementClips, project.tracks, project.tempo])

  const readOnlyRef = useRef(!!props.readOnly)
  useEffect(() => { readOnlyRef.current = !!props.readOnly }, [props.readOnly])
  // "Suggest changes": a view member edits locally (no broadcast) and submits
  // the result as a proposal. suggestSnapshot is the shared state to restore on
  // discard/submit, since the local edits are just a proposal.
  const [suggesting, setSuggesting] = useState(false)
  const suggestingRef = useRef(false)
  useEffect(() => { suggestingRef.current = suggesting }, [suggesting])
  const suggestSnapshotRef = useRef<DawProject | null>(null)
  const [submittingSuggestion, setSubmittingSuggestion] = useState(false)
  const [suggestSent, setSuggestSent] = useState(false)

  // Collab attribution: stamp who created clips (dispatch-time, so the stamp
  // travels with the broadcast and every client stores the same author)
  const { user } = useUser()
  const userNameRef = useRef<string>('')
  useEffect(() => { userNameRef.current = user?.firstName || user?.username || '' }, [user])

  // Stable playhead getter for presence (a fresh closure each render would
  // restart the presence interval)
  const getPlayheadRef = useRef(() => {
    const eng = engineRef.current
    return eng && eng.isPlaying ? eng.currentBeat : null
  })

  const dispatch = useCallback((action: DawAction) => {
    // View-only collaborators: their room access is read-only server-side, so
    // local edits would silently diverge from the real project. Drop them here
    // instead — the UI stays a live mirror. (LOAD_PROJECT still applies: it
    // carries the room's state to us.)
    // Read-only members can't edit — unless they're in "suggest changes" mode,
    // where edits apply locally (and are never broadcast; see below).
    if (readOnlyRef.current && !suggestingRef.current && action.type !== 'LOAD_PROJECT') return
    // Collab lock: don't clobber a clip a collaborator has open in their editor.
    // (Suggestions are local-only, so locks don't apply to them.)
    if (CLIP_LOCK_ACTIONS.has(action.type) && !suggestingRef.current) {
      const locker = clipLockedBy((action as { clipId?: string }).clipId, collabPeersRef.current)
      if (locker) { notifyLocked(locker); return }
    }
    // Reducers must be deterministic for collaboration: actions that create
    // entities carry their ids, otherwise each client mints a different one
    // and every later edit to that entity diverges across the room.
    if (action.type === 'ADD_TRACK' && !action.id) action = { ...action, id: crypto.randomUUID() }
    if (action.type === 'ADD_SCENE' && !action.id) action = { ...action, id: crypto.randomUUID() }
    if (action.type === 'DUPLICATE_TRACK' && !action.seed) action = { ...action, seed: crypto.randomUUID() }
    if (action.type === 'ADD_CLIP' && !action.clip.createdAt) {
      action = { ...action, clip: { ...action.clip, createdAt: new Date().toISOString(), ...(userNameRef.current && !action.clip.createdBy ? { createdBy: userNameRef.current } : {}) } }
    }
    if (action.type !== 'LOAD_PROJECT') {
      const g = undoGroupRef.current
      historyRef.current = [...historyRef.current.slice(-(UNDO_LIMIT - 1)), { before: projectRef.current, action, ...(g ? { group: g.id, label: g.label } : {}) }]
      redoRef.current = []
      // Build history: skip view/transport-only actions, and coalesce a
      // continuous slider drag (rapid same-target updates) into one step —
      // only the released value is kept.
      if (!HISTORY_EXCLUDE.has(action.type)) {
        const entry = { action } as unknown as NonNullable<DawProject['history']>[number]
        const key = buildTargetKey(action)
        const log = buildLogRef.current
        const now = Date.now()
        const lc = lastCoalesceRef.current
        if (key && lc && lc.key === key && now - lc.time < 500 && log.length) {
          log[log.length - 1] = entry
          lastCoalesceRef.current = { key, time: now }
        } else if (log.length < 5000) {
          log.push(entry)
          lastCoalesceRef.current = key ? { key, time: now } : null
        }
      }
    }
    rawDispatch(action)
    // The project's real content has arrived — cross-project links can resolve.
    if (action.type === 'LOAD_PROJECT') setProjectLoaded(true)
    // Suggestions stay local — never broadcast a proposal into the shared room.
    if (!isRemoteRef.current && !suggestingRef.current && !NO_BROADCAST.has(action.type)) {
      broadcastRef.current?.(action)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // The playback diagnostic, installed for EVERYONE rather than behind
  // DAW_HOOKS like everything below it.
  //
  // That gate is why a playback fault Brae keeps hitting could not be measured
  // where it happens: the hooks are absent from the production bundle, so the
  // only place with the problem is the one place with no instruments. This
  // reads meters and clocks and never touches playback, so there is nothing to
  // gate. window.__dawDiagnose() to start, .report() to read.
  useEffect(() => installDawDiagnose(
    () => engineRef.current as unknown as DiagnoseEngine,
    id => projectRef.current?.tracks.find(t => t.id === id)?.name,
  ), [])

  // A frozen track must not keep playing at the old tempo.
  //
  // Brae: "when I changed bpm, one of the tracks stayed at an old bpm."
  //
  // Freezing renders a synth clip to audio for CPU, and that render is made AT
  // A TEMPO. Change the tempo and every other track moves while the frozen one
  // keeps its old timing — silently, because audio is supposed to keep its own
  // speed, so nothing looks wrong. Freeze is a performance trick the user
  // accepted, not a decision to nail that part to 120 bpm.
  //
  // ⚠️ The detector for this ALREADY EXISTED and nothing ever called it:
  // isFreezeStale(), whose own comment says "a tempo change invalidates it",
  // had zero callers in the repo. Same shape as a warning nobody wired up.
  //
  // Thawing rather than re-rendering: it is instant, exact, and reversible —
  // the notes and patch ride along on the clip — where a re-render is a long
  // async job that would block the studio at the worst moment. The track costs
  // CPU again until it is re-frozen, and being in time is worth more than that.
  const lastTempo = useRef(project.tempo)
  useEffect(() => {
    if (project.tempo === lastTempo.current) return
    lastTempo.current = project.tempo
    const stale = project.arrangementClips.filter(
      c => c.kind === 'audio' && (c as { frozenFrom?: { bpm?: number } }).frozenFrom
        && (c as { frozenFrom?: { bpm?: number } }).frozenFrom?.bpm !== project.tempo,
    )
    if (!stale.length) return
    void (async () => {
      const { thawClip } = await import('@/lib/apollo/daw-freeze')
      const ids = new Set(stale.map(c => c.id))
      const clips = projectRef.current.arrangementClips.map(c =>
        ids.has(c.id) ? (thawClip(c as Parameters<typeof thawClip>[0]) ?? c) : c)
      rawDispatch({ type: 'LOAD_PROJECT', project: migrateProject({ ...projectRef.current, arrangementClips: clips }) })
      setSyncMsg(stale.length === 1
        ? 'One frozen part was rendered at the old tempo — unfrozen so it follows the new one. Re-freeze when you are done.'
        : `${stale.length} frozen parts were rendered at the old tempo — unfrozen so they follow the new one.`)
      setTimeout(() => setSyncMsg(null), 7000)
    })()
  }, [project.tempo, project.arrangementClips])

  // Audio that had to be rerouted to keep playing.
  //
  // A silent recovery beats silence, but it must not be INVISIBLE: something in
  // the studio just stopped working, the sound may be subtly different, and the
  // person listening is the only one who can say whether it still sounds right.
  //
  // ⚠️ Its own effect, deliberately. Written first inside the dev-hooks effect,
  // which early-returns unless DAW_HOOKS — so the one notice that exists for
  // real users in a real failure would have appeared for nobody but us.
  useEffect(() => {
    const eng = engineForRender
    if (!eng?.addEventListener) return
    // ⚠️ One timer, cleared before each notice. Two recoveries close together
    // (a track chain going while the master bus is still being reported) left
    // the FIRST notice's timeout running, and it blanked the second message a
    // moment after it appeared — the more serious failure being the one you
    // could not read.
    let timer: ReturnType<typeof setTimeout> | undefined
    const onRecovered = (e: Event) => {
      const d = (e as CustomEvent<{ how?: string }>).detail
      setSyncMsg(d?.how ? `Audio recovered — ${d.how}.` : 'Audio recovered.')
      clearTimeout(timer)
      timer = setTimeout(() => setSyncMsg(null), 6000)
    }
    eng.addEventListener('audio-recovered', onRecovered)
    return () => { clearTimeout(timer); eng.removeEventListener('audio-recovered', onRecovered) }
  }, [engineForRender])

  // Dev-only: expose dispatch + a project/history snapshot so a genuine build
  // session can be driven and recorded (the History capture mode then replays
  // what actually happened — edits and refinements included).
  useEffect(() => {
    if (!DAW_HOOKS) return
    const w = window as unknown as {
      __dawDispatch?: typeof dispatch
      __dawSnapshot?: () => { project: DawProject; history: NonNullable<DawProject['history']> }
      __dawInspect?: () => unknown
      __dawRenderWav?: (opts?: Parameters<DawEngine['renderWav']>[0]) => Promise<unknown>
      __dawRenderOffline?: (opts?: { startBeat?: number; endBeat?: number }) => Promise<unknown>
      __dawFreezeApollo?: () => Promise<unknown>
      __parseMid?: (file: File) => Promise<unknown>
      __exportMid?: () => Promise<Blob>
      __sessionCapture?: (opts?: { sessionId?: string; enabled?: boolean }) => Promise<unknown>
      __dawSessionCaptureToClips?: typeof sessionCaptureToClips
    }
    w.__dawDispatch = dispatch
    w.__dawSnapshot = () => ({ project: projectRef.current, history: buildLogRef.current })
    try { Object.defineProperty(w, '__dawEngine', { get: () => engineRef.current, configurable: true }) } catch { /* redefined */ }
    w.__dawSessionCaptureToClips = sessionCaptureToClips
    // Dev-only "vision": a readable, at-a-glance view of what's actually happening in the studio as
    // it's driven — transport, the LIVE master output level (so audio flow is verifiable, not guessed),
    // and every track's instrument/FX/clips with real loop state + note counts. This is how an
    // automated/agent driver "sees" the DAW the way a person sees the screen.
    w.__dawInspect = () => {
      const eng = engineRef.current as (DawEngine & { masterAnalyser?: AnalyserNode; isPlaying?: boolean; currentBeat?: number }) | null
      const proj = projectRef.current
      let masterLevelDb: number | null = null
      try {
        const an = eng?.masterAnalyser
        if (an) {
          const buf = new Uint8Array(an.fftSize)
          an.getByteTimeDomainData(buf)
          let sum = 0
          for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v }
          const rms = Math.sqrt(sum / buf.length)
          masterLevelDb = rms > 0.0001 ? Math.round(20 * Math.log10(rms) * 10) / 10 : -Infinity
        }
      } catch { /* ignore */ }
      return {
        transport: { isPlaying: !!eng?.isPlaying, currentBeat: Math.round((eng?.currentBeat ?? 0) * 100) / 100, tempo: proj.tempo },
        masterLevelDb,
        trackCount: proj.tracks.length,
        tracks: proj.tracks.map(t => ({
          name: t.name, kind: t.kind, mute: !!t.mute, solo: !!(t as { solo?: boolean }).solo,
          instrument: t.instrument?.type,
          fx: (t.effects ?? []).map(e => e.type),
          clips: proj.arrangementClips.filter(c => c.trackId === t.id).map(c => {
            const lc = c as { loopEnabled?: boolean; loopLengthBeats?: number }
            return {
              name: c.name, start: c.startBeat, dur: c.durationBeats,
              loop: lc.loopEnabled ? (lc.loopLengthBeats ?? true) : false,
              notes: c.kind === 'midi' ? c.notes.length : undefined,
            }
          }),
        })),
      }
    }
    // Bounce a beat range to lossless WAV(s) for offline mix analysis (see
    // scripts/analyze-mix.py). Real-time capture off the live engine graph.
    w.__dawRenderWav = (opts) => engineRef.current?.renderWav(opts ?? {}) ?? Promise.resolve(null)
    // Bounce the REAL project audio via the OFFLINE render (OfflineAudioContext) — this is the ONE
    // that produces actual sound in a headless/automated browser, unlike the realtime renderWav which
    // captures silence when there's no audio device. Returns the encoded mix as base64 so an agent can
    // pair it with a screen recording. Auto-picks the whole arrangement if no range is given.
    w.__dawRenderOffline = async (opts) => {
      const proj = projectRef.current
      const clips = proj.arrangementClips ?? []
      const startBeat = opts?.startBeat ?? 0
      const endBeat = opts?.endBeat ?? Math.max(4, ...clips.map(c => c.startBeat + c.durationBeats))
      const { renderProjectAudioBlob } = await import('@/lib/song-video/render-audio')
      const mix = await renderProjectAudioBlob(proj, { startBeat, endBeat })
      const bytes = new Uint8Array(await mix.blob.arrayBuffer())
      let s = ''; const CH = 0x8000
      for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CH)))
      return { base64: btoa(s), type: mix.blob.type, durationSec: mix.durationSec, bytes: bytes.length }
    }
    // Freeze every Apollo track: render each synth clip once, offline, and swap
    // it for an audio clip playing that render. A project with several Apollo
    // tracks is several full synths running at once, which is enough to stop the
    // audio thread keeping up — the project opens and you cannot hear it. A
    // frozen clip is one buffer with no voices to allocate, which is the
    // cheapest thing the engine can play. The notes and the patch ride along on
    // the clip, so it can be thawed back and edited.
    w.__dawFreezeApollo = async () => {
      const { freezeApolloProject } = await import('@/lib/apollo/daw-freeze')
      const frozen = await freezeApolloProject(projectRef.current, {
        onProgress: (done, total, name) => console.log(`[freeze] ${done}/${total} ${name}`),
      })
      dispatch({ type: 'LOAD_PROJECT', project: frozen })
      const froze = frozen.arrangementClips.filter(c => c.kind === 'audio').length
      return { clips: frozen.arrangementClips.length, audioClips: froze }
    }
    // Dev-only: the raw render entry, so a benchmark can time ONE whole-project
    // pass against the batched strategy without going through the cache.
    void import('@/lib/apollo/daw-freeze').then(m => {
      (w as unknown as { __apolloFreezeModule?: unknown }).__apolloFreezeModule = m
    }).catch(() => {})
    // Dev-only: the combine cache itself, so a diagnostic can ask WHICH clips
    // are missing rather than just how many.
    void import('@/lib/apollo/freeze-cache').then(m => {
      (w as unknown as { __combineCacheModule?: unknown }).__combineCacheModule = m
    }).catch(() => {})
    // Dev-only: exercise the MIDI importer in isolation (returns {project, report}).
    w.__parseMid = (file) => import('@/lib/midi-import').then(m => m.parseMidiFile(file))
    // Dev-only: export the current project as a .mid blob (round-trip testing).
    w.__exportMid = () => import('@/lib/midi-file').then(m => m.writeProjectMidi(projectRef.current).blob)
    // Phase-B session capture: a recorder pre-primed with this project's musical
    // metadata. Caller drives it: `const s = await window.__sessionCapture();
    // await s.startCapture(); s.event('take_started',{}); ... await s.end()`.
    // A generation flow wraps its run in one of these to emit a session dir.
    w.__sessionCapture = (opts) => import('@/lib/session-capture/browser').then(({ BrowserSessionRecorder }) => {
      const s = new BrowserSessionRecorder(opts)
      const p = projectRef.current
      s.setMusical({
        bpm: p.tempo,
        key: `${p.scale ?? ''}`.trim() || null,
        time_signature: `${p.timeSignatureNum}/${p.timeSignatureDen}`,
        genre_tags: [],
        instrument_list: p.tracks.filter(t => t.kind !== 'group').map(t => t.name),
      })
      return s
    })
  }, [])

  // ── Community deep-link: /new?communityItem={id} drops the shared thing
  // straight into this fresh project (sample → track+clip, recipe → roll clip,
  // preset → installed). Best-effort; the editor works regardless.
  const communityImportRan = useRef(false)
  useEffect(() => {
    if (communityImportRan.current) return
    communityImportRan.current = true
    const itemId = new URLSearchParams(window.location.search).get('communityItem')
    if (!itemId) return
    void (async () => {
      try {
        const { getCommunityItem, importItem } = await import('@/lib/community')
        const item = await getCommunityItem(itemId)
        if (!item) return
        await importItem(item)  // installs into library / recipes / presets
        if (item.kind === 'sample') {
          const trackId = crypto.randomUUID()
          dispatch({ type: 'ADD_TRACK', id: trackId, name: item.name })
          const meta = (item.payload ?? {}) as { duration?: number }
          const durBeats = Math.max(1, engineRef.current?.secondsToBeats(meta.duration ?? 2) ?? 4)
          dispatch({ type: 'ADD_CLIP', clip: makeAudioClip(trackId, item.name, 0, durBeats, { libraryId: `community:${item.id}` }) })
        } else if (item.kind === 'recipe') {
          const { getAllChordRecipes, buildRecipeClip } = await import('@/lib/practice-recipes')
          const recipe = getAllChordRecipes().find(r => r.id === `community-${item.id}`)
          if (recipe) {
            const trackId = crypto.randomUUID()
            dispatch({ type: 'ADD_TRACK', id: trackId, name: item.name })
            dispatch({ type: 'ADD_CLIP', clip: buildRecipeClip(recipe, trackId, 0) })
          }
        }
      } catch { /* deep-link is best-effort */ }
    })()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // On mount: drain audio handed off from the dashboard / All Projects
  // ("Open / Import Files" with a raw audio file → ?importMedia=1). Each file
  // gets its own track, named after it. takePendingMedia atomically reads AND
  // clears the store, so a StrictMode double-invoke can't import twice.
  const mediaImportRan = useRef(false)
  useEffect(() => {
    if (mediaImportRan.current) return
    mediaImportRan.current = true
    if (!new URLSearchParams(window.location.search).get('importMedia')) return
    void (async () => {
      try {
        const { takePendingMedia } = await import('@/lib/media-handoff')
        const files = await takePendingMedia()
        if (!files.length) return
        const engine = engineRef.current
        if (!engine) return
        const { importAudioFiles } = await import('@/lib/daw-audio-import')
        await importAudioFiles(files, { engine, dispatch })
      } catch { /* handoff is best-effort */ }
    })()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Drop an audio file anywhere on Beacon and it becomes a track. Without this
  // the browser handles the drop itself and NAVIGATES AWAY from the studio, so
  // this is as much a guard as a feature. Track lanes have their own drop
  // handler that places the clip at the beat you aimed at; it stops propagation,
  // so this only ever sees drops on empty space.
  const importDroppedFiles = useCallback((files: File[]) => {
    if (props.readOnly) return
    const engine = engineRef.current
    if (!engine) return
    void import('@/lib/daw-audio-import').then(({ importAudioFiles }) =>
      importAudioFiles(files, { engine, dispatch }),
    ).catch(() => {})
  }, [props.readOnly, dispatch])
  const { isOver: draggingAudioOver, dropProps: audioDropProps } = useMediaDrop(importDroppedFiles, { accept: ['audio', 'video'] })

  // Fix-a-clip deep-link: /new?importAudio=<url>&importName=<label> drops an
  // external audio file onto a fresh track so it can be edited. Used by the
  // demo-clip fixer at /audio-check ("Edit in studio"). Best-effort.
  const clipImportRan = useRef(false)
  useEffect(() => {
    if (clipImportRan.current) return
    clipImportRan.current = true
    const params = new URLSearchParams(window.location.search)
    const url = params.get('importAudio')
    if (!url) return
    void (async () => {
      try {
        const name = params.get('importName') || 'Clip to fix'
        const trackId = crypto.randomUUID()
        dispatch({ type: 'ADD_TRACK', id: trackId, name })
        const clip = makeAudioClip(trackId, name, 0, 8, { audioUrl: url })
        dispatch({ type: 'ADD_CLIP', clip })
        const buf = await engineRef.current?.loadClipBuffer(clip)
        if (buf) {
          dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch: { waveformPeaks: extractPeaks(buf), durationBeats: engineRef.current!.secondsToBeats(buf.duration), bufferDuration: buf.duration } })
          // Persist so the clip survives a reload — audioUrl is stripped on save.
          try {
            const ab = await (await fetch(url)).arrayBuffer()
            void uploadRecordingBlob(new Blob([ab], { type: 'audio/wav' }), clip.id).then(key => key && dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch: { r2Key: key } }))
          } catch { /* persistence is non-fatal */ }
        }
      } catch { /* deep-link is best-effort */ }
    })()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Cross-project audio links: render a source project's mix and re-sync ──────
  async function renderMixOf(daw: import('@/lib/daw-types').DawProject): Promise<Blob | null> {
    const endBeat = (daw.arrangementClips ?? []).reduce((m, c) => Math.max(m, c.startBeat + (c.durationBeats ?? 0)), 0)
    if (endBeat <= 0) return null
    const { renderProjectAudioBlob } = await import('@/lib/song-video/render-audio')
    const { blob } = await renderProjectAudioBlob(daw, { startBeat: 0, endBeat })
    return blob
  }
  // PULL: link another project's mix in as a new live audio track.
  async function linkProjectAudio(sourceId: string, name: string) {
    setShowLinkPicker(false)
    if (linkBusyRef.current.has(sourceId)) return
    linkBusyRef.current.add(sourceId)
    try {
      let daw = sourceReplicasRef.current.get(sourceId)
      if (!daw) {
        const r = await fetch(`/api/projects/${sourceId}`)
        if (!r.ok) throw new Error('fetch failed')
        const cf = await r.json() as { name?: string; dawProject?: import('@/lib/daw-types').DawProject }
        if (!cf.dawProject?.tracks?.length) { window.alert(`“${name || 'That project'}” has no audio to sync.`); return }
        daw = cf.dawProject
        sourceReplicasRef.current.set(sourceId, daw)
        sourceNamesRef.current.set(sourceId, name || cf.name || 'Linked project')
      }
      const blob = await renderMixOf(daw)
      if (!blob) { window.alert('That project has no arrangement to sync.'); return }
      const url = URL.createObjectURL(blob)
      const label = sourceNamesRef.current.get(sourceId) || name || 'Linked mix'
      const trackId = crypto.randomUUID()
      dispatch({ type: 'ADD_TRACK', id: trackId, name: `↳ ${label}` })
      const clip = makeAudioClip(trackId, label, 0, 8, { audioUrl: url, dawMixSourceProjectId: sourceId, dawMixStamp: new Date().toISOString() })
      dispatch({ type: 'ADD_CLIP', clip })
      const buf = await engineRef.current?.loadClipBuffer(clip)
      if (buf) dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch: { waveformPeaks: extractPeaks(buf), durationBeats: engineRef.current!.secondsToBeats(buf.duration), bufferDuration: buf.duration } })
      setLinkedSourceIds(prev => prev.includes(sourceId) ? prev : [...prev, sourceId])   // mounts DawMixSync
    } catch { window.alert('Could not link that project.') }
    finally { linkBusyRef.current.delete(sourceId) }
  }
  // Re-render a source and swap the buffer of every clip linked to it (live edits + reload).
  async function resyncLinkedSource(sourceId: string) {
    const daw = sourceReplicasRef.current.get(sourceId)
    if (!daw) return
    const clips = projectRef.current.arrangementClips.filter(c => isAudioClip(c) && c.dawMixSourceProjectId === sourceId) as import('@/lib/daw-types').AudioClip[]
    if (!clips.length) return
    const blob = await renderMixOf(daw)
    if (!blob) return
    const url = URL.createObjectURL(blob)
    const ab = await blob.arrayBuffer()
    const stamp = new Date().toISOString()
    for (const c of clips) {
      engineRef.current?.evictBuffer(c.id)
      let buf: AudioBuffer | null = null
      try { buf = (await engineRef.current?.loadBufferFromArrayBuffer(c.id, ab.slice(0))) ?? null } catch { /* decode failed */ }   // slice: decode detaches the buffer
      dispatch({ type: 'UPDATE_CLIP', clipId: c.id, patch: { audioUrl: url, dawMixStamp: stamp, ...(buf ? { waveformPeaks: extractPeaks(buf), bufferDuration: buf.duration } : {}) } })
    }
  }
  function scheduleLinkResync(sourceId: string, live: boolean) {
    const t = linkTimerRef.current
    const prior = t.get(sourceId); if (prior) clearTimeout(prior)
    t.set(sourceId, setTimeout(() => { t.delete(sourceId); void resyncLinkedSource(sourceId) }, live ? 2500 : 1200))
  }
  async function openLinkPicker() {
    setShowLinkPicker(true)
    if (linkPickerProjects) return
    try {
      const r = await fetch('/api/projects')
      const data = r.ok ? await r.json() as Array<{ id: string; name: string }> : []
      setLinkPickerProjects(data.filter(p => p.id !== props.projectId))
    } catch { setLinkPickerProjects([]) }
  }

  // Reload / push: for every clip that links a source, fetch that source, mount
  // its listener, and re-render (blob URLs die on reload, so linked audio always
  // re-renders from source). Derived from project state → covers open + push.
  const linkedClipSources = useMemo(() => Array.from(new Set(
    project.arrangementClips.filter(c => isAudioClip(c) && c.dawMixSourceProjectId).map(c => (c as import('@/lib/daw-types').AudioClip).dawMixSourceProjectId!)
  )), [project.arrangementClips])
  useEffect(() => {
    for (const sid of linkedClipSources) {
      if (sourceReplicasRef.current.has(sid) || linkBusyRef.current.has(sid)) continue
      linkBusyRef.current.add(sid)
      void (async () => {
        try {
          const r = await fetch(`/api/projects/${sid}`)
          if (!r.ok) return
          const cf = await r.json() as { name?: string; dawProject?: import('@/lib/daw-types').DawProject }
          if (!cf.dawProject?.tracks?.length) return
          sourceReplicasRef.current.set(sid, cf.dawProject)
          sourceNamesRef.current.set(sid, cf.name || 'Linked project')
          setLinkedSourceIds(prev => prev.includes(sid) ? prev : [...prev, sid])
          await resyncLinkedSource(sid)
        } catch { /* source unreachable — clip stays silent until re-synced */ }
        finally { linkBusyRef.current.delete(sid) }
      })()
    }
  }, [linkedClipSources]) // eslint-disable-line react-hooks/exhaustive-deps

  // PUSH target: another editor sent this project a link ("Send to project").
  // Resolve once loaded so the added clip isn't wiped by LOAD_PROJECT.
  const pushLinkDoneRef = useRef(false)
  useEffect(() => {
    if (!projectLoaded || pushLinkDoneRef.current) return
    pushLinkDoneRef.current = true
    try {
      const key = `cf_link_source_${props.projectId}`
      const src = props.projectId ? localStorage.getItem(key) : null
      if (src && src !== props.projectId) { localStorage.removeItem(key); void linkProjectAudio(src, '') }
    } catch { /* storage unavailable */ }
  }, [projectLoaded]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-apply voice chain to Host and Guest 1 tracks on new podcast projects
  useEffect(() => {
    if (!isPodcast) return
    if (voiceChainAppliedRef.current) return
    voiceChainAppliedRef.current = true
    const p = projectRef.current
    const targets = p.tracks.filter(
      t => (t.name === 'Host' || t.name === 'Guest 1') && t.effects.length === 0
    )
    for (const track of targets) {
      dispatch({ type: 'UPDATE_TRACK', trackId: track.id, patch: { effects: voiceChainEffects() } })
    }
  }, [isPodcast, dispatch])

  // ── Engine lifecycle ────────────────────────────────────────────────────────
  useEffect(() => {
    // engineForRender dep: after a StrictMode dispose+recreate, the fresh
    // engine must receive the current project — with [project] alone a
    // loaded-but-unedited project never reaches it (silent playback).
    engineForRender.updateProject(project)
  }, [project, engineForRender])

  // Notice if the transport is running and nothing is coming out. Brae hit this
  // and it could not be reproduced; rather than guess, capture the state at the
  // moment it happens. `expectedNow` is what keeps it honest — this component
  // knows where the notes are, so a rest or a fade-out never looks like a fault.
  useEffect(() => {
    let cancelled = false
    let stop: (() => void) | null = null
    void import('@/lib/apollo/silence-watchdog').then(({ startSilenceWatchdog, stopSilenceWatchdog }) => {
      if (cancelled) { stopSilenceWatchdog(); return }
      stop = stopSilenceWatchdog
      startSilenceWatchdog(
        () => engineRef.current as unknown as ReturnType<Parameters<typeof startSilenceWatchdog>[0]>,
        (beat) => {
          // Is any clip supposed to be sounding here?
          const p = projectRef.current
          return (p.arrangementClips ?? []).some(c =>
            c.startBeat <= beat && c.startBeat + (c.durationBeats ?? 0) > beat &&
            (!('notes' in c) || ((c as { notes?: unknown[] }).notes?.length ?? 0) > 0))
        },
        () => {
          const p = projectRef.current
          return {
            tracks: p.tracks.length,
            muted: p.tracks.filter(t => t.mute).map(t => t.name),
            soloed: p.tracks.filter(t => t.solo).map(t => t.name),
            masterVolume: p.masterVolume,
            combine: (window as unknown as { __combineStats?: () => unknown }).__combineStats?.(),
          }
        },
      )
    }).catch(() => {})
    return () => { cancelled = true; stop?.() }
  }, [])

  useEffect(() => {
    return () => { engineRef.current?.dispose() }
  }, [])

  // ── Transport state ─────────────────────────────────────────────────────────
  // Other users' live focus (bridged from the Liveblocks room; empty when solo)
  const [collabPeers, setCollabPeers] = useState<CollabPeer[]>([])
  const collabPeersRef = useRef<CollabPeer[]>([])
  useEffect(() => { collabPeersRef.current = collabPeers }, [collabPeers])
  // Collab lock: "X is editing this clip" notice, shown when an edit is blocked.
  const [lockNotice, setLockNotice] = useState<string | null>(null)
  const notifyLocked = useCallback((byName: string) => {
    setLockNotice(byName)
    window.setTimeout(() => setLockNotice(cur => cur === byName ? null : cur), 2600)
  }, [])
  const [playing, setPlaying] = useState(false)
  const [recording, setRecording] = useState(false)
  // The playhead lives in DawPlayheadProvider, not here — state in this
  // component re-renders the whole editor. Only seeks touch this counter, and
  // those are user-initiated and rare.
  const [seekNonce, setSeekNonce] = useState(0)
  const [metronome, setMetronome] = useState(false)

  useEffect(() => {
    // engineForRender dep: after a StrictMode dispose the ref is re-pointed at
    // a fresh engine during render, and this effect must re-attach to it —
    // with [] deps the listeners stay on the disposed engine and playing/
    // recording state never updates in dev.
    const engine = engineRef.current!

    const onTransport = (e: Event) => {
      setPlaying((e as CustomEvent<{ playing: boolean }>).detail.playing)
    }
    // Builds a clip from a finished pass. Pass 0 lands on the arrangement
    // (with the record-setup FX bars); later passes stack as take lanes.
    const finalizePassClip = (trackId: string, blob: Blob, startBeat: number, endBeat: number, passIndex: number) => {
      if (blob.size === 0) return
      const url = URL.createObjectURL(blob)
      const dur = Math.max(0.25, endBeat - startBeat)
      const track = projectRef.current.tracks.find(t => t.id === trackId)
      const latBeats = engineRef.current?.secondsToBeats(engineRef.current.recordLatencySec()) ?? 0
      const placed = Math.max(0, startBeat - latBeats)
      if (passIndex === 0) {
        const clip = makeAudioClip(trackId, `${track?.name ?? 'Input'} Recording`, placed, dur, { audioUrl: url })
        dispatch({ type: 'ADD_CLIP', clip })
        const pendingFx = engineRef.current?.pendingRecordFx ?? []
        pendingFx.forEach((fx, i) => {
          dispatch({ type: 'ADD_CLIP_EFFECT', effect: legacyToBar({
            id: crypto.randomUUID(), trackId, type: fx.type,
            startBeat: placed, durationBeats: dur, row: i,
            params: monitorFxParams(fx),
          }) })
        })
        void uploadRecordingBlob(blob, clip.id).then(key => {
          if (key) dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch: { r2Key: key } })
        })
      } else {
        const clip = makeAudioClip(trackId, `Take ${passIndex + 1}`, placed, dur, { audioUrl: url })
        dispatch({ type: 'ADD_TAKE_LANE', lane: { id: crypto.randomUUID(), trackId, name: `Take ${passIndex + 1}`, clips: [clip] } })
        void uploadRecordingBlob(blob, clip.id).then(key => {
          if (key) dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch: { r2Key: key } })
        })
      }
    }

    // Loop wrap during recording: close every per-track recorder into a
    // pass clip and immediately start fresh ones for the next pass.
    const rotateLoopPass = (wrapToBeat: number) => {
      const passIndex = recPassRef.current
      recPassRef.current++
      const endBeat = projectRef.current.loopEnd
      for (const [trackId, entry] of [...inputRecsRef.current]) {
        const { recorder, startBeat, chunks } = entry
        if (recorder.state === 'inactive') continue
        recorder.onstop = () => {
          const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' })
          finalizePassClip(trackId, blob, startBeat, endBeat, passIndex)
        }
        recorder.stop()
        const stream = recorder.stream
        const fresh = new MediaRecorder(stream, recorder.mimeType ? { mimeType: recorder.mimeType } : undefined)
        const freshChunks: Blob[] = []
        fresh.ondataavailable = (ev: BlobEvent) => { if (ev.data.size > 0) freshChunks.push(ev.data) }
        fresh.start(100)
        inputRecsRef.current.set(trackId, { recorder: fresh, startBeat: wrapToBeat, chunks: freshChunks })
      }
    }

    const onRecording = (e: Event) => {
      const rec = (e as CustomEvent<{ recording: boolean }>).detail.recording
      setRecording(rec)

      if (rec) {
        recPassRef.current = 0
        // Loop recording: when the transport wraps, finalize the pass into a
        // take lane and start fresh recorders — every loop pass is kept.
        if (projectRef.current.loopEnabled && wrapWatchRef.current === null) {
          let lastBeat = engineRef.current?.currentBeat ?? 0
          wrapWatchRef.current = window.setInterval(() => {
            const eng = engineRef.current
            if (!eng || !eng.isRecording) return
            const b = eng.currentBeat
            if (lastBeat - b > 1) rotateLoopPass(b)
            lastBeat = b
          }, 90)
        }
        // Start a MediaRecorder for every armed audio track that has an inputSource set.
        // Tracks sharing the same source reuse one MediaStream (avoid double permission prompt).
        ;(async () => {
          const armed = projectRef.current.tracks.filter(
            t => t.type === 'audio' && t.armed
          )
          console.log('[rec] onRecording(true) — armed audio tracks:', armed.map(t => t.name))
          for (const track of armed) {
            const src = (track.inputSource ?? 'mic') as AudioInputSource
            try {
              let stream = inputStreamsRef.current.get(src)
              if (!stream) {
                stream = await captureAudioInput(src)
                inputStreamsRef.current.set(src, stream)
              }
              const chunks: Blob[] = []
              const preferredMimes = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']
              const mime = preferredMimes.find(m => MediaRecorder.isTypeSupported(m)) ?? ''
              const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
              recorder.ondataavailable = (ev: BlobEvent) => {
                if (ev.data.size > 0) chunks.push(ev.data)
              }
              recorder.start(100)
              const startBeat = engineRef.current!.currentBeat
              console.log('[rec] per-track recorder started for:', track.name, 'startBeat:', startBeat)
              inputRecsRef.current.set(track.id, {
                recorder,
                startBeat,
                chunks,
              })
            } catch (err) {
              console.warn(`[rec] Input capture failed for "${track.name}":`, err)
            }
          }
        })()
      } else {
        // Stop all active input recorders; dispatch a clip for each when its data arrives.
        if (wrapWatchRef.current !== null) { clearInterval(wrapWatchRef.current); wrapWatchRef.current = null }
        const finalPass = recPassRef.current
        const endBeat = engineRef.current!.currentBeat
        let pending = 0

        for (const { recorder } of inputRecsRef.current.values()) {
          if (recorder.state !== 'inactive') pending++
        }

        const cleanup = () => {
          if (engineRef.current) engineRef.current.pendingRecordFx = []
          inputRecsRef.current.clear()
          for (const stream of inputStreamsRef.current.values()) {
            stream.getTracks().forEach(t => t.stop())
          }
          inputStreamsRef.current.clear()
        }

        if (pending === 0) { cleanup(); return }

        for (const [trackId, { recorder, startBeat, chunks }] of inputRecsRef.current) {
          if (recorder.state === 'inactive') continue
          recorder.onstop = () => {
            const mime = recorder.mimeType || 'audio/webm'
            const blob = new Blob(chunks, { type: mime })
            console.log('[rec] per-track onstop — trackId:', trackId, 'blobSize:', blob.size, 'startBeat:', startBeat, 'endBeat:', endBeat, 'pass:', finalPass)
            finalizePassClip(trackId, blob, startBeat, endBeat, finalPass)
            pending--
            if (pending === 0) cleanup()
          }
          recorder.stop()
        }
      }
    }

    const onRecordingComplete = (e: Event) => {
      const { blob, startBeat, durationBeats } = (e as CustomEvent<{ blob: Blob; startBeat: number; durationBeats: number }>).detail
      console.log('[rec] onRecordingComplete — blobSize:', blob.size, 'startBeat:', startBeat, 'duration:', durationBeats)
      // Per-track recorders handle clip creation when tracks are armed — skip
      // master bus here to avoid duplicates.
      if (projectRef.current.tracks.some(t => t.type === 'audio' && t.armed)) return
      if (durationBeats < 0.1 || blob.size === 0) {
        console.log('[rec] onRecordingComplete — skipped (too short or empty blob)')
        return
      }
      const url = URL.createObjectURL(blob)
      const p   = projectRef.current
      // Use selected track if it's audio, otherwise fall back to first audio track
      const trackId = (() => {
        const sel = selectedTrackIdRef.current
        if (sel && p.tracks.find(t => t.id === sel && t.type === 'audio')) return sel
        return p.tracks.find(t => t.type === 'audio')?.id ?? null
      })()
      console.log('[rec] onRecordingComplete — trackId:', trackId, 'audioTracks:', p.tracks.filter(t => t.type === 'audio').map(t => t.name))
      if (!trackId) return
      const latBeats2 = engineRef.current?.secondsToBeats(engineRef.current.recordLatencySec()) ?? 0
      const clip = makeAudioClip(trackId, 'Recording', Math.max(0, startBeat - latBeats2), durationBeats, { audioUrl: url })
      dispatch({ type: 'ADD_CLIP', clip })
      const pendingFx = engineRef.current?.pendingRecordFx ?? []
      pendingFx.forEach((fx, i) => {
        dispatch({ type: 'ADD_CLIP_EFFECT', effect: legacyToBar({
          id: crypto.randomUUID(), trackId, type: fx.type,
          startBeat, durationBeats, row: i,
          params: monitorFxParams(fx),
        }) })
      })
      if (engineRef.current) engineRef.current.pendingRecordFx = []
      console.log('[rec] master bus clip dispatched:', clip.id, 'at beat', startBeat)
      void uploadRecordingBlob(blob, clip.id).then(key => {
        if (key) dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch: { r2Key: key } })
      })
    }
    engine.addEventListener('transport', onTransport)
    engine.addEventListener('recording', onRecording)
    engine.addEventListener('recording-complete', onRecordingComplete)
    return () => {
      engine.removeEventListener('transport', onTransport)
      engine.removeEventListener('recording', onRecording)
      engine.removeEventListener('recording-complete', onRecordingComplete)
      // Release any open input streams
      for (const stream of inputStreamsRef.current.values()) {
        stream.getTracks().forEach(t => t.stop())
      }
      inputStreamsRef.current.clear()
      inputRecsRef.current.clear()
    }
  }, [engineForRender]) // eslint-disable-line react-hooks/exhaustive-deps

  // Imperative playhead read for things that need it without re-rendering
  // (export ranges, keyboard nudges). The visible playhead comes from
  // DawPlayheadProvider.
  const positionBeatRef = useRef(0)
  useEffect(() => {
    if (!playing) { positionBeatRef.current = engineRef.current?.currentBeat ?? 0; return }
    let raf = 0
    const frame = () => { positionBeatRef.current = engineRef.current?.currentBeat ?? 0; raf = requestAnimationFrame(frame) }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [playing])

  const setPosition = useCallback((b: number) => {
    engineRef.current!.seek(b)
    positionBeatRef.current = b
    setSeekNonce(n => n + 1)   // nudges the playhead provider to re-read
  }, [])

  // ── UI state ────────────────────────────────────────────────────────────────
  // ── Podcast helpers ──────────────────────────────────────────────────────────
  function handleAddGuest() {
    const guestNums = project.tracks
      .filter(t => /^Guest \d+$/.test(t.name))
      .map(t => parseInt(t.name.split(' ')[1]))
      .filter(n => !isNaN(n))
    const nextNum = guestNums.length > 0 ? Math.max(...guestNums) + 1 : 2
    const newId = crypto.randomUUID()
    dispatch({ type: 'ADD_TRACK', id: newId, name: `Guest ${nextNum}` })
    dispatch({ type: 'UPDATE_TRACK', trackId: newId, patch: { effects: voiceChainEffects() } })
  }

  function handlePullTrack(url: string, guestName: string, timelineOffsetMs: number) {
    const trackId   = crypto.randomUUID()
    const bpm       = project.tempo ?? 120
    const startBeat = (timelineOffsetMs / 1000) * (bpm / 60)
    dispatch({ type: 'ADD_TRACK', id: trackId, name: guestName })
    dispatch({ type: 'UPDATE_TRACK', trackId, patch: { effects: voiceChainEffects() } })
    dispatch({
      type: 'ADD_CLIP',
      clip: makeAudioClip(trackId, `${guestName} recording`, startBeat, 0, { audioUrl: url }),
    })
  }

  // Remember workspace — restore the last-used view / left tab / sidebar state.
  // Panel SIZES persist separately via useResizable. Read once, client-only,
  // SSR-safe, and validated (a corrupt blob or a view invalid for the current
  // mode falls back to defaults; never throws).
  const wsInit = useMemo(() => {
    const leftTabs = ['library', 'code', 'episode', 'setup', 'guests'] as const
    const views: DawView[] = isPodcast ? ['arrangement', 'mixer'] : ['session', 'arrangement', 'mixer']
    const defTab = (isPodcast ? 'setup' : 'library') as typeof leftTabs[number]
    const w = readWorkspace('audio', { leftTab: defTab, sidebarOpen: false, view: 'arrangement' as DawView })
    return {
      leftTab: leftTabs.includes(w.leftTab) ? w.leftTab : defTab,
      sidebarOpen: typeof w.sidebarOpen === 'boolean' ? w.sidebarOpen : false,
      view: views.includes(w.view) ? w.view : 'arrangement',
    }
  }, [isPodcast])
  const [view, setView] = useState<DawView>(wsInit.view)
  const [editTarget, setEditTarget] = useState<EditTarget>(null)
  const [selectedTrackId_,  setSelectedTrackId_]  = useState<string | null>(null)
  const [selectedReturnId_, setSelectedReturnId_] = useState<string | null>(null)
  useEffect(() => { selectedTrackIdRef.current = selectedTrackId_ }, [selectedTrackId_])
  const selectedTrackId  = selectedTrackId_
  const selectedReturnId = selectedReturnId_
  const setSelectedTrackId  = useCallback((id: string | null) => { setSelectedTrackId_(id);  if (id) setSelectedReturnId_(null) }, [])
  const setSelectedReturnId = useCallback((id: string | null) => { setSelectedReturnId_(id); if (id) setSelectedTrackId_(null)  }, [])
  const [selectedClipId,  setSelectedClipId]  = useState<string | null>(null)
  // Which track a following Apollo window should point at. A selected CLIP is
  // the more specific thing to have clicked, so its track wins over the track
  // selection — otherwise clicking an item in the arrangement moves nothing.
  const followTrackId = useMemo(() => {
    const clip = selectedClipId
      ? project.arrangementClips.find(c => c.id === selectedClipId)
      : null
    return clip?.trackId ?? selectedTrackId
  }, [selectedClipId, project.arrangementClips, selectedTrackId])
  const [selectedClipIds, setSelectedClipIds] = useState<Set<string>>(new Set())
  const [soundPanel, setSoundPanel] = useState<{ x: number; y: number } | null>(null)
  const [apolloRack, setApolloRack] = useState<{ trackId: string; seed: unknown; follow?: boolean; detached?: boolean } | null>(null)

  // Dev console access to the multi-selection (window.__dawSelection)
  useEffect(() => {
    if (DAW_HOOKS) {
      (window as unknown as { __dawSelection?: string[] }).__dawSelection = [...selectedClipIds]
    }
  })
  const [selectedEffectIds, setSelectedEffectIds] = useState<Set<string>>(new Set())
  const [bottomTab, setBottomTab] = useState<'devices' | 'instrument'>('devices')
  const [leftTab,     setLeftTab]     = useState<'library' | 'code' | 'episode' | 'setup' | 'guests'>(wsInit.leftTab)
  // Start closed so the rail (logo + toggle) is all that shows on load; the
  // open/hide button reveals the panel on demand rather than it always being there.
  const [sidebarOpen, setSidebarOpen] = useState(wsInit.sidebarOpen)
  // Persist the workspace layout on any change (Remember workspace).
  useEffect(() => {
    writeWorkspace('audio', { leftTab, sidebarOpen, view })
  }, [leftTab, sidebarOpen, view])
  const [showAppearance, setShowAppearance] = useState(false)
  const [overlay, setOverlay] = useState<OverlayKind>('none')
  const leftResize = useResizable({ key: 'left-panel', initial: 240, min: 180, max: 520, axis: 'x' })
  const bottomResize = useResizable({ key: 'bottom-panel', initial: 220, min: 120, max: 560, axis: 'y', invert: true })

  // ── Apollo check-in ────────────────────────────────────────────────────────
  // An item developed in standalone Apollo comes home here: its notes and its
  // sound land back on the clip and track it left. Checked on mount and
  // whenever this tab regains focus, since the work happened in another tab.
  useEffect(() => {
    let applied = false
    async function absorb() {
      if (applied) return
      const { readCheckout, writeCheckout, notesFromApollo } = await import('@/lib/apollo/checkout')
      const co = readCheckout()
      if (!co || !co.returnedAt) return
      const proj = projectRef.current
      const clip = proj.arrangementClips.find(c => c.id === co.clipId)
      if (!clip) return   // the clip was deleted while it was out — leave the record alone
      applied = true
      dispatch({ type: 'UPDATE_CLIP', clipId: co.clipId, patch: {
        notes: notesFromApollo(co.notes),
        durationBeats: Math.max(clip.durationBeats, co.lengthBeats),
      } })
      if (co.patch) {
        dispatch({ type: 'SET_INSTRUMENT', trackId: co.trackId,
          instrument: { type: 'apollo', params: co.patch as unknown as ApolloInstrumentParams } })
      }
      writeCheckout(null)   // custody released — the clip visibly updates
    }
    void absorb()
    // The work happens in another tab, so listen for the cross-tab `storage`
    // event the check-in write fires — that lands the item immediately, even
    // with both tabs visible side by side. Focus and a slow poll are belt and
    // braces for the cases storage events miss (same-tab writes, restores).
    const retry = () => { applied = false; void absorb() }
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key === CHECKOUT_LS_KEY) retry()
    }
    window.addEventListener('storage', onStorage)
    window.addEventListener('focus', retry)
    const poll = setInterval(retry, 4000)
    return () => {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener('focus', retry)
      clearInterval(poll)
    }
  }, [dispatch])

  // Tab toggles Session <-> Arrangement. They are two views of ONE project, one
  // keystroke apart (the Ableton model the rebuild follows) - the live view is
  // not a separate app you navigate to. Podcast mode has no session view.
  useEffect(() => {
    function onTab(e: KeyboardEvent) {
      if (e.key !== 'Tab') return
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return
      const t = e.target as HTMLElement
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) return
      if (isPodcast) return
      e.preventDefault()   // Tab would otherwise walk focus out of the studio
      setView(v => (v === 'session' ? 'arrangement' : 'session'))
    }
    window.addEventListener('keydown', onTab)
    return () => window.removeEventListener('keydown', onTab)
  }, [isPodcast])

  // B toggles the sound library panel (Ableton-style browser shortcut)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'b' && e.key !== 'B') return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) return
      setSidebarOpen(v => !v)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])
  const [showPads,  setShowPads]  = useState(false)
  const [isSaving,  setIsSaving]  = useState(false)
  const [saveStatus, setSaveStatus] = useState<'saved' | 'error' | null>(null)
  const [saveError,  setSaveError]  = useState('')
  // The words a toast shows while it fades out are the words it was showing.
  const lockNoticeS = useSticky(lockNotice)
  const syncMsgS = useSticky(syncMsg)
  const saveStatusS = useSticky(saveStatus === 'saved' || saveStatus === 'error' ? saveStatus : null)
  const [expandedPianoRollClipId, setExpandedPianoRollClipId] = useState<string | null>(null)
  const expandedRollRef = useRef<string | null>(null)
  useEffect(() => { expandedRollRef.current = expandedPianoRollClipId }, [expandedPianoRollClipId])
  const [expandedStepSeqClipId, setExpandedStepSeqClipId] = useState<string | null>(null)
  const [loopToolArmed, setLoopToolArmed] = useState(false)

  // ── Create-recipe entry point: the sound library's "+ Create a recipe"
  // button (this editor or the /library page) lands here — fresh track, empty
  // 16-beat MIDI clip, piano roll open and ready to write.
  useEffect(() => {
    function createRecipeDraft() {
      if (readOnlyRef.current) return
      const trackId = crypto.randomUUID()
      dispatch({ type: 'ADD_TRACK', id: trackId, name: 'New Recipe' })
      const clipId = crypto.randomUUID()
      void (async () => {
        const { defaultPresetId } = await import('@/lib/midi-presets')
        dispatch({
          type: 'ADD_CLIP',
          clip: {
            kind: 'midi', id: clipId, trackId, name: 'New Recipe',
            startBeat: 0, durationBeats: 16, isDrumClip: false, notes: [],
            stretchNotes: false, rootNote: 0, presetId: defaultPresetId() ?? undefined,   // loop-on-drag is the default
          },
        })
        setSelectedClipId(clipId)
        setExpandedPianoRollClipId(clipId)
      })()
    }
    void import('./SoundCreate').then(({ consumeCreateRecipeFlag, CREATE_RECIPE_EVENT }) => {
      if (consumeCreateRecipeFlag()) createRecipeDraft()
      window.addEventListener(CREATE_RECIPE_EVENT, onEvent)
    })
    function onEvent(e: Event) { e.preventDefault(); createRecipeDraft() }
    return () => window.removeEventListener('100lights-create-recipe', onEvent)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps


  useEffect(() => { setBottomTab('devices') }, [selectedTrackId])
  useEffect(() => { if (!selectedTrackId) setShowPads(false) }, [selectedTrackId])

  // ── Save ─────────────────────────────────────────────────────────────────────
  const onSaveRef        = useRef(onSave)
  const selectedClipIdRef  = useRef(selectedClipId)
  const selectedClipIdsRef = useRef(selectedClipIds)
  useEffect(() => { onSaveRef.current        = onSave },          [onSave])
  const onSaveLocalRef = useRef(props.onSaveLocal)
  useEffect(() => { onSaveLocalRef.current = props.onSaveLocal }, [props.onSaveLocal])
  const handleSaveLocalRef = useRef(async () => {})
  useEffect(() => {
    handleSaveLocalRef.current = async () => {
      if (!onSaveLocalRef.current) return
      const { tracks, dawProject } = collectSnapshot()
      await onSaveLocalRef.current(tracks, { audioMode: props.audioMode, podcastMeta, dawProject })
    }
  })
  useEffect(() => { selectedClipIdRef.current  = selectedClipId },  [selectedClipId])
  useEffect(() => { selectedClipIdsRef.current = selectedClipIds }, [selectedClipIds])

  // Build the persist-ready snapshot (audio tracks + a blob-URL-stripped
  // DawProject) — shared by Save and "Suggest changes".
  const collectSnapshot = useCallback((): { tracks: AudioTrack[]; dawProject: DawProject } => {
    const p = projectRef.current
    const tracks: AudioTrack[] = p.tracks
      .filter(t => t.type === 'audio')
      .map(t => {
        const clip = p.arrangementClips.find(c => c.trackId === t.id && c.kind === 'audio')
        const audioClip = clip?.kind === 'audio' ? clip : undefined
        return {
          id: t.id, name: t.name, url: audioClip?.audioUrl ?? '',
          duration: audioClip ? audioClip.durationBeats * (60 / p.tempo) : 0, r2Key: audioClip?.r2Key,
        } satisfies AudioTrack
      })
    // Blob URLs are browser-local — strip them; clips keep their r2Key and
    // resolve audio on load.
    const stripUrl = <C,>(c: C & { kind: string; audioUrl?: string }): C =>
      c.kind === 'audio' && c.audioUrl?.startsWith('blob:') ? { ...c, audioUrl: undefined } : c
    // Embed any custom (non-built-in) presets referenced by a clip so the saved
    // project resolves its sounds on any device — even one that never created
    // them. Built-in presets (builtin-*) are universal; skip those.
    const referenced = new Set<string>()
    const collectRef = (c: { kind: string; presetId?: string }) => {
      if (c.kind === 'midi' && c.presetId && !c.presetId.startsWith('builtin-')) referenced.add(c.presetId)
    }
    p.arrangementClips.forEach(collectRef)
    Object.values(p.sessionGrid).forEach(row => row.forEach(c => c && collectRef(c)))
    let embeddedPresets = p.presets
    if (referenced.size) {
      const have = new Set((p.presets ?? []).map(pr => pr.id))
      const missing = referenced.size > have.size || [...referenced].some(id => !have.has(id))
      if (missing) {
        const lib = getPresets()
        const add = lib.filter(pr => referenced.has(pr.id) && !have.has(pr.id))
        if (add.length) embeddedPresets = [...(p.presets ?? []), ...add]
      }
    }
    const dawProject = {
      ...p,
      presets: embeddedPresets,
      history: buildLogRef.current.length ? [...buildLogRef.current] : p.history,
      arrangementClips: p.arrangementClips.map(stripUrl),
      sessionGrid: Object.fromEntries(Object.entries(p.sessionGrid).map(([tid, row]) =>
        [tid, row.map(c => (c ? stripUrl(c) : c))])),
    }
    return { tracks, dawProject }
  }, [])

  const handleSaveRef = useRef(async () => {})
  useEffect(() => {
    handleSaveRef.current = async () => {
      if (!onSaveRef.current) return
      setIsSaving(true)
      try {
        const p = projectRef.current
        const { tracks, dawProject } = collectSnapshot()
        await onSaveRef.current(tracks, { audioMode: props.audioMode, podcastMeta, dawProject })
        // ⚠️ CANCEL THE WRITE ALREADY IN FLIGHT. A snapshot scheduled a moment
        // before the save lands a moment after it, and would put the unsynced
        // marker straight back on a project that has just been saved.
        if (autosaveTimerRef.current !== null) {
          window.clearTimeout(autosaveTimerRef.current)
          autosaveTimerRef.current = null
        }
        changedSinceSaveRef.current = false
        setDawDirty(false)
        void saveSnapshot(props.projectId ?? `unsaved:${props.audioMode ?? 'music'}`, p, { synced: true }).catch(() => {})
        setSaveStatus('saved')
        setSaveError('')
        setTimeout(() => setSaveStatus(null), 2500)
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error'
        console.error('[save]', msg)
        setSaveError(msg)
        setSaveStatus('error')
        setTimeout(() => { setSaveStatus(null); setSaveError('') }, 6000)
      } finally {
        setIsSaving(false)
      }
    }
  })

  // ── Offline sync: reconcile offline edits with the server (3-way merge) ───────
  function applyMerged(project: DawProject, msg: string) {
    rawDispatch({ type: 'LOAD_PROJECT', project: migrateProject(project) })
    setTimeout(() => { void handleSaveRef.current() }, 300)  // persist merged → rebases the branch point
    setSyncMsg(msg); setTimeout(() => setSyncMsg(null), 3200)
  }
  // Resolve a conflicted merge with the user's picks and apply it. Empty choices
  // keep every conflict as "theirs" (the default).
  function resolveMerge(choices: Record<string, 'mine' | 'theirs'>) {
    if (!pendingMerge) return
    const final = applyResolutions(pendingMerge.merged, pendingMerge.conflicts, choices)
    setPendingMerge(null)
    applyMerged(final, 'Applied your resolution.')
  }
  const syncOfflineEditsRef = useRef(async (_manual?: boolean) => {})
  useEffect(() => {
    syncOfflineEditsRef.current = async (manual = false) => {
      if (!props.projectId || syncing || pendingMerge) return
      if (!navigator.onLine) { if (manual) { setSyncMsg('You’re offline — reconnect to sync.'); setTimeout(() => setSyncMsg(null), 3000) } return }
      setSyncing(true)
      try {
        const branch = await getBranch(snapshotKey)
        if (!branch || !hasDiverged(branch.base, branch.working)) { if (manual) { setSyncMsg('Already up to date.'); setTimeout(() => setSyncMsg(null), 3000) } return }
        const res = await fetch(`/api/projects/${props.projectId}`)
        if (!res.ok) { if (manual) { setSyncMsg('Couldn’t reach the server.'); setTimeout(() => setSyncMsg(null), 3000) } return }
        const cf = await res.json()
        const theirs = cf?.dawProject ? (cf.dawProject as DawProject) : null
        if (!theirs) return
        const { merged, conflicts } = mergeProjects(branch.base, branch.working, theirs)
        if (conflicts.length === 0) applyMerged(merged, 'Synced your offline edits.')
        else setPendingMerge({ merged, conflicts })
      } catch { if (manual) { setSyncMsg('Sync failed.'); setTimeout(() => setSyncMsg(null), 3000) } }
      finally { setSyncing(false) }
    }
  })

  // ── Suggest changes (view members) ───────────────────────────────────────────
  function enterSuggest() { suggestSnapshotRef.current = projectRef.current; setSuggesting(true) }
  function discardSuggest() {
    const snap = suggestSnapshotRef.current
    setSuggesting(false)
    if (snap) rawDispatch({ type: 'LOAD_PROJECT', project: snap })
  }
  async function submitSuggestion() {
    const onSuggest = props.onSuggest
    if (!onSuggest || submittingSuggestion) return
    const note = window.prompt('Add a note for the owner about your suggestion (optional):') ?? ''
    setSubmittingSuggestion(true)
    try {
      const { tracks, dawProject } = collectSnapshot()
      await onSuggest(note, tracks, { audioMode: props.audioMode, podcastMeta, dawProject })
      const snap = suggestSnapshotRef.current   // proposal sent → discard the local edits
      setSuggesting(false)
      if (snap) rawDispatch({ type: 'LOAD_PROJECT', project: snap })
      setSuggestSent(true); window.setTimeout(() => setSuggestSent(false), 3500)
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Could not send suggestion')
      setSaveStatus('error'); window.setTimeout(() => { setSaveStatus(null); setSaveError('') }, 6000)
    } finally { setSubmittingSuggestion(false) }
  }

  // Undo and redo used to exist ONLY as two branches inside the keydown handler
  // below, which meant they were reachable by ⌘Z and by nothing else — not the
  // palette, not a menu, not a button. Lifted out so there is one implementation
  // with more than one way in. Both revert only the popped action's own
  // footprint (computed against CURRENT state, so a collaborator's concurrent
  // edits survive) and broadcast the patch so the room follows along instead of
  // self-healing the undo away.
  // Undo and redo take a whole GROUP when the top entry belongs to one — a
  // spoken request of four actions comes back as one step. Each entry still
  // reverts through its own precise patch, newest first, so a grouped undo is
  // N collaboration-safe reverts rather than one wholesale restore. Returns
  // how many came off (0 = nothing to do), so the voice can say "4 changes".
  // ⚠️ EACH REVERT IS COMPUTED AGAINST THE ONE BEFORE IT, not against the
  // project as React last rendered it. projectRef only moves on render, and
  // all N reverts of a group happen in one tick — so computing each against
  // projectRef.current made the second patch carry the first's target back to
  // its un-reverted value (seen on the real path: "undo" after "mute the pad
  // and mute the drums" un-muted the pad and left the drums muted). The
  // running state is stepped through the reducer between patches instead.
  const doUndo = useCallback((): number => {
    const taken = takeUndoGroup(historyRef.current)
    // Reports whether it actually did anything. A caller that says "Undone."
    // when the stack was empty is lying, and voice is the caller most likely to
    // be believed without looking.
    if (!taken.length) return 0
    let cur = projectRef.current
    for (const entry of taken) {
      redoRef.current = [...redoRef.current.slice(-(UNDO_LIMIT - 1)), { before: cur, action: entry.action, group: entry.group, label: entry.label }]
      const patchAction: DawAction = { type: 'PATCH_PROJECT', patch: computeRevertPatch(entry.before, cur, entry.action) }
      rawDispatch(patchAction)
      if (!isRemoteRef.current) broadcastRef.current?.(patchAction)
      cur = undoReducer(cur, patchAction)
    }
    return taken.length
  }, [rawDispatch])

  const doRedo = useCallback((): number => {
    const taken = takeUndoGroup(redoRef.current)
    if (!taken.length) return 0
    let cur = projectRef.current
    for (const entry of taken) {
      historyRef.current = [...historyRef.current.slice(-(UNDO_LIMIT - 1)), { before: cur, action: entry.action, group: entry.group, label: entry.label }]
      const patchAction: DawAction = { type: 'PATCH_PROJECT', patch: computeRevertPatch(entry.before, cur, entry.action) }
      rawDispatch(patchAction)
      if (!isRemoteRef.current) broadcastRef.current?.(patchAction)
      cur = undoReducer(cur, patchAction)
    }
    return taken.length
  }, [rawDispatch])

  const beginUndoGroup = useCallback((label?: string): string => {
    const id = crypto.randomUUID()
    undoGroupRef.current = { id, label }
    return id
  }, [])
  const endUndoGroup = useCallback(() => { undoGroupRef.current = null }, [])

  // ── What the desktop menu bar and the global shortcuts reach ─────────────
  //
  // The menu sends a command; DesktopMenu turns it into this event; the studio
  // is the only thing that knows how to carry it out. Deliberately an event
  // rather than a prop chain: the menu is outside the editor and above it, and
  // threading a callback down from the layout would couple the two for no gain.
  useEffect(() => {
    const onMenu = (e: Event) => {
      const command = (e as CustomEvent<{ command: string }>).detail?.command
      if (command === 'undo') { doUndo(); return }
      if (command === 'redo') { doRedo(); return }
      if (command === 'transport-toggle') {
        // ⚠️ The STUDIO's transport, not the browser's spacebar handling —
        // this arrives when 100Lights is not even the focused app.
        if (engineRef.current?.isPlaying) engineRef.current?.stop()
        else void engineRef.current?.play()
        return
      }
      if (command === 'save-version') {
        const name = window.prompt('Name this version — "before the drop"')
        if (!name?.trim() || !props.projectId) return
        void fetch(`/api/projects/${props.projectId}/versions`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: name.trim() }),
        })
        return
      }
    }
    window.addEventListener('100lights:menu', onMenu)
    return () => window.removeEventListener('100lights:menu', onMenu)
  }, [doUndo, doRedo, props.projectId])


  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable ||
        // A focused slider or combo box owns its arrow keys and Space; the
        // studio's shortcuts used to steal them (arrows seeking the playhead
        // from inside a focused select). Plain buttons are left alone: Space
        // is the transport everywhere else, and a toolbar button that was
        // just clicked must not swallow it.
        !!target.closest?.('[role="slider"], [role="combobox"], [role="textbox"], [role="listbox"]')
      ) return

      const engine = engineRef.current!

      if (e.code === 'Space') {
        e.preventDefault()
        if (engine.isRecording) {
          engine.stop()
          void engine.stopRecording()
        } else if (engine.isPlaying) {
          engine.stop()
        } else {
          engine.play()
        }
        return
      }

      if (e.code === 'KeyR') {
        e.preventDefault()
        // Through the transport's own record flow (arm guards, count-in, the
        // notice when the microphone refuses) — never straight to the engine.
        window.dispatchEvent(new CustomEvent('100lights:record-toggle'))
        return
      }

      if (e.code === 'KeyM') {
        e.preventDefault()
        setMetronome(prev => {
          const next = !prev
          engine.setMetronome(next)
          return next
        })
        return
      }

      if (e.code === 'ArrowLeft' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        setPosition(Math.max(0, engine.currentBeat - 1))
        return
      }

      if (e.code === 'ArrowRight' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        setPosition(engine.currentBeat + 1)
        return
      }

      if ((e.metaKey || e.ctrlKey) && e.code === 'KeyZ' && !e.shiftKey) {
        e.preventDefault(); doUndo(); return
      }

      if ((e.metaKey || e.ctrlKey) && e.code === 'KeyZ' && e.shiftKey) {
        e.preventDefault(); doRedo(); return
      }

      if (e.code === 'Delete' || e.code === 'Backspace') {
        // The clip open in the piano roll is off-limits — pressing Delete
        // with a note selected must never nuke the clip itself, even when
        // focus drifted out of the roll. Other clips still delete normally.
        const rollClip = expandedRollRef.current
        const ids = new Set([...selectedClipIdsRef.current].filter(id => id !== rollClip))
        if (ids.size > 0) {
          e.preventDefault()
          ids.forEach(id => dispatch({ type: 'REMOVE_CLIP', clipId: id }))
          setSelectedClipIds(new Set())
          setSelectedClipId(null)
        } else if (selectedClipIdRef.current && selectedClipIdRef.current !== rollClip) {
          e.preventDefault()
          dispatch({ type: 'REMOVE_CLIP', clipId: selectedClipIdRef.current })
          setSelectedClipId(null)
        }
        return
      }

      if ((e.metaKey || e.ctrlKey) && e.code === 'KeyS') {
        e.preventDefault()
        handleSaveRef.current()
      }

      // ⌘/Ctrl+J — consolidate: print every selected looping MIDI clip's
      // repetitions as real notes so single repeats become editable.
      if ((e.metaKey || e.ctrlKey) && e.code === 'KeyJ') {
        const ids = selectedClipIdsRef.current
        if (ids.size === 0) return
        e.preventDefault()
        for (const id of ids) {
          const clip = projectRef.current.arrangementClips.find(c => c.id === id)
          if (!clip || !isMidiClip(clip) || !canConsolidate(clip)) continue
          const flat = consolidateMidiClip(clip)
          dispatch({ type: 'UPDATE_CLIP', clipId: id, patch: { notes: flat.notes, loopEnabled: false, loopLengthBeats: undefined } })
        }
      }

      // Escape deselects everything. Modals/dropdowns consume Escape first
      // (capture-phase listeners with stopPropagation), so reaching here
      // means nothing was open.
      if (e.key === 'Escape' && !e.defaultPrevented) {
        setSelectedClipIds(new Set())
        setSelectedClipId(null)
        setSelectedEffectIds(new Set())
        setSelectedTrackId(null)
        setSelectedReturnId(null)
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [setPosition, doUndo, doRedo])

  // ── Context value ────────────────────────────────────────────────────────────
  const contextValue = useMemo(() => ({
    project,
    dispatch,
    engine: engineForRender,
    // Live construction log (this session's edits) for the History capture mode,
    // so replay works without a save+reopen round-trip.
    getBuildHistory: () => buildLogRef.current,
    consolidateBuildHistory,
    // Undo and redo, which the context has always declared and only mobile ever
    // filled in — "the desktop editor has its own undo" was true and meant that
    // anything inside the studio wanting to undo had no way to reach it. Voice
    // needs it more than most: every destructive command now confirms, and
    // "undo that" is what someone says when they confirmed too quickly.
    undo: doUndo,
    redo: doRedo,
    beginUndoGroup,
    endUndoGroup,
    view,
    setView,
    editTarget,
    setEditTarget,
    selectedTrackId,
    setSelectedTrackId,
    selectedReturnId,
    setSelectedReturnId,
    selectedClipId,
    setSelectedClipId,
    selectedClipIds,
    setSelectedClipIds,
    soundPanel,
    apolloRack,
    setApolloRack,
    setSoundPanel,
    selectedEffectIds,
    setSelectedEffectIds,
    playing,
    recording,
    setPosition,
    metronome,
    setMetronome,
    showAppearance,
    setShowAppearance,
    overlay,
    setOverlay,
    showPads,
    setShowPads,
    expandedPianoRollClipId,
    setExpandedPianoRollClipId,
    expandedStepSeqClipId,
    setExpandedStepSeqClipId,
    loopToolArmed,
    setLoopToolArmed,
    onSave: onSave ? () => { if (props.isGuest) requireAccountRef.current('save'); else void handleSaveRef.current() } : undefined,
    onSaveLocal: props.onSaveLocal ? () => void handleSaveLocalRef.current() : undefined,
    isSaving,
    dawDirty,
    isGuest: !!props.isGuest,
    requireAccount: (action: 'save' | 'export') => requireAccountRef.current(action),
    resumeExport,
    clearResumeExport: () => setResumeExport(false),
    audioMode: props.audioMode,
    podcastMeta,
    blinkIds,
    triggerBlink,
    collabPeers,
    notifyLocked,
    mergeConflicts: pendingMerge?.conflicts ?? null,
    resolveMerge,
  }), [
    engineForRender,
    project, dispatch, view, editTarget, selectedTrackId, selectedReturnId, selectedClipId, selectedClipIds,
    selectedEffectIds,
    playing, recording, setPosition, metronome, showPads, overlay,
    expandedPianoRollClipId, expandedStepSeqClipId, loopToolArmed, onSave, isSaving, dawDirty, podcastMeta, blinkIds, triggerBlink,
    collabPeers, notifyLocked, pendingMerge, props.isGuest, resumeExport,
  ])

  // ── Command palette (⌘K): existing audio actions only ────────
  useRegisterCommands([
    {
      id: 'audio.save', group: 'Audio', label: 'Save', keywords: 'cloud persist', shortcut: '⌘S',
      when: () => !!props.onSave && !props.readOnly,
      run: () => { void handleSaveRef.current() },
    },
    { id: 'audio.view.session',     group: 'Audio', label: 'Switch to Session view',     keywords: 'clips scenes', when: () => !isPodcast && view !== 'session',     run: () => setView('session') },
    { id: 'audio.view.arrangement', group: 'Audio', label: 'Switch to Arrangement view', keywords: 'timeline',      when: () => view !== 'arrangement', run: () => setView('arrangement') },
    { id: 'audio.view.mixer',       group: 'Audio', label: 'Switch to Mixer view',       keywords: 'channels faders', when: () => view !== 'mixer',       run: () => setView('mixer') },
    {
      id: 'audio.library', group: 'Audio', label: 'Open Sound Library', keywords: 'instruments sounds browser', shortcut: 'B',
      when: () => !isPodcast,
      run: () => { setSidebarOpen(true); setLeftTab('library') },
    },
    { id: 'audio.transport.play', group: 'Audio', label: 'Play / stop', keywords: 'start begin pause space transport',
      shortcut: 'Space', run: () => { const e = engineRef.current; if (!e) return; if (e.isPlaying) e.stop(); else void e.play() } },
    { id: 'audio.transport.top', group: 'Audio', label: 'Go to start', keywords: 'beginning rewind home transport',
      run: () => engineRef.current?.seek(0) },
    { id: 'audio.track.add', group: 'Audio', label: 'Add track', keywords: 'new create track',
      when: () => !props.readOnly,
      run: () => dispatch({ type: 'ADD_TRACK', id: crypto.randomUUID(), name: `Track ${projectRef.current.tracks.length + 1}` }) },
    // ── Bake the synth into audio ───────────────────────────────────────────
    // The permanent version of what combining does temporarily. Combining
    // re-renders in every browser that opens the song; freezing renders ONCE and
    // stores the audio in the project, so from then on there is no synthesis at
    // all — just audio clips, the cheapest thing the engine can play.
    //
    // Reversible on purpose: the notes and the patch ride along on each frozen
    // clip, so Unfreeze puts the piano roll back exactly.
    {
      id: 'audio.freeze', group: 'Sound', label: 'Freeze synth tracks to audio (faster playback)',
      keywords: 'bake render bounce commit apollo performance speed lag',
      when: () => !props.readOnly && projectRef.current.tracks.some(t => t.instrument?.type === 'apollo'),
      run: () => { void (async () => {
        const { freezeApolloProject } = await import('@/lib/apollo/daw-freeze')
        setFreezing('Freezing…')
        try {
          const frozen = await freezeApolloProject(projectRef.current, {
            onProgress: (d, total) => setFreezing(`Freezing ${d}/${total}…`),
          })
          const baked = frozen.arrangementClips.filter(c => c.kind === 'audio' && 'frozenFrom' in c).length
          rawDispatch({ type: 'LOAD_PROJECT', project: migrateProject(frozen) })
          setFreezing(baked ? `Froze ${baked} clips` : 'Nothing could be frozen')
        } catch {
          setFreezing('Freeze failed')
        }
        setTimeout(() => setFreezing(null), 2600)
      })() },
    },
    {
      id: 'audio.thaw', group: 'Sound', label: 'Unfreeze — back to editable synth clips',
      keywords: 'thaw unbake restore midi notes edit apollo',
      when: () => !props.readOnly && projectRef.current.arrangementClips.some(c => c.kind === 'audio' && 'frozenFrom' in c),
      run: () => { void (async () => {
        const { thawClip } = await import('@/lib/apollo/daw-freeze')
        const p = projectRef.current
        const clips = p.arrangementClips.map(c => {
          if (c.kind !== 'audio' || !('frozenFrom' in c)) return c
          return thawClip(c as Parameters<typeof thawClip>[0]) ?? c
        })
        rawDispatch({ type: 'LOAD_PROJECT', project: migrateProject({ ...p, arrangementClips: clips }) })
      })() },
    },
    // Density lives in the palette rather than as another toolbar button —
    // adding a control to save space would be a strange way to save space.
    ...UI_DENSITIES.filter(d => d !== density).map(d => ({
      id: `audio.density.${d}`, group: 'View', label: `Interface: ${DENSITY_INFO[d].label}`,
      keywords: `density spacing compact smaller bigger room ${DENSITY_INFO[d].blurb}`,
      run: () => setDensity(d),
    })),
  ], [view, isPodcast, props.onSave, props.readOnly, dispatch, density, setDensity])

  // ── Sounds and tracks, by name ───────────────────────────────────────────────
  //
  // This is the half of the palette that was missing, and it is the half Brae
  // asked for: the studio registered five commands, none of which had anything
  // to do with MAKING a sound. Changing an instrument meant knowing which panel
  // holds instruments, opening it, and scrolling. Now you type its name.
  //
  // Registered separately from the block above because it depends on the current
  // selection — the commands name the track they will act on, so "Solo Bass"
  // reads as an answer rather than "Solo selected track" reading as a question.
  const paletteTrack = useMemo(
    () => project.tracks.find(t => t.id === selectedTrackId) ?? project.tracks[0] ?? null,
    [project.tracks, selectedTrackId],
  )
  useRegisterCommands([
    ...(paletteTrack ? [
      { id: 'audio.track.mute', group: 'Track', label: `${paletteTrack.mute ? 'Unmute' : 'Mute'} ${paletteTrack.name}`,
        keywords: 'silence track', when: () => !props.readOnly,
        run: () => dispatch({ type: 'UPDATE_TRACK', trackId: paletteTrack.id, patch: { mute: !paletteTrack.mute } }) },
      { id: 'audio.track.solo', group: 'Track', label: `${paletteTrack.solo ? 'Unsolo' : 'Solo'} ${paletteTrack.name}`,
        keywords: 'isolate alone track', when: () => !props.readOnly,
        run: () => dispatch({ type: 'UPDATE_TRACK', trackId: paletteTrack.id, patch: { solo: !paletteTrack.solo } }) },
      { id: 'audio.track.apollo', group: 'Sound', label: `Edit ${paletteTrack.name} in Apollo`,
        keywords: 'synth patch rack instrument sound design edit',
        run: () => setApolloRack({ trackId: paletteTrack.id, seed: null, follow: true }) },
    ] : []),
    // Jump straight to a track instead of finding it in a long list.
    ...project.tracks.filter(t => t.id !== selectedTrackId).map(t => ({
      id: `audio.track.select.${t.id}`, group: 'Track', label: `Select ${t.name}`,
      keywords: 'go to focus track', run: () => setSelectedTrackId(t.id),
    })),
    // NOT one command per preset. That worked at 52 of them and stops working
    // the moment the library grows — a palette whose results are mostly one kind
    // of thing has stopped being a palette. Presets belong in a browser that can
    // page, preview and categorise; the palette's job is to get you TO it.
  ], [project.tracks, selectedTrackId, paletteTrack, props.readOnly, dispatch, setApolloRack, setSelectedTrackId])

  // ── The rest of the studio ───────────────────────────────────────────────────
  //
  // Everything below already worked. None of it was findable.
  //
  // I audited this DAW by grepping for identifier names I had invented, decided
  // seven standard features were missing, and was wrong about six of them:
  // splitting a clip is here and is called "Splice at Playhead"; quantise is an
  // unlabelled Q inside the piano roll; reverse is a checkbox in the Inspector;
  // LUFS metering is in the master strip. Freeze had been implemented for months
  // and surfaced only because Brae asked for it by name. The mistake I made is
  // the same one a user makes — if you don't already know the word, the feature
  // is not there.
  //
  // So: scripts/capability-inventory.mjs reads every labelled control in the
  // studio and reports what ⌘K cannot reach. It found 52 of 1065. This block is
  // the answer to that number. Nothing here is a new capability; each command is
  // a second door onto an action that had exactly one, usually an unlabelled
  // keystroke or an item three levels into a context menu.
  // Which clip a clip command acts on.
  //
  // The obvious answer — the selected one — makes every clip command DISAPPEAR
  // when nothing is selected, which is how you arrive at the palette most of the
  // time: you typed a word, you did not first go and click something. That is
  // the same trap as the Quantize button that greys out exactly when you go
  // looking for it, so it falls back to the clip under the playhead: unambiguous
  // (there is only one per track), visible on screen, and the thing a person
  // means by "this clip" when they haven't clicked anything.
  //
  // Every label names the clip it will act on — "Split Hats · Tide at the
  // playhead" — so the fallback is stated rather than assumed.
  // Resolved when the command RUNS, not on every render: the playhead moves ten
  // times a second, and a memo that depends on it would re-run this — and every
  // command label built from it — at that rate. That is the exact cost the
  // separate playhead context exists to avoid.
  const clipTargetRef = useRef<() => DawClip | null>(() => null)
  clipTargetRef.current = () => {
    const p = projectRef.current
    const byId = p.arrangementClips.find(c => c.id === selectedClipIdRef.current)
    if (byId) return byId
    const beat = engineRef.current?.currentBeat ?? 0
    const under = p.arrangementClips.filter(c => beat >= c.startBeat && beat < c.startBeat + c.durationBeats)
    // Prefer one on the selected track, so a playhead crossing a stack of tracks
    // still resolves to the one being worked on.
    return under.find(c => c.trackId === selectedTrackId) ?? under[0] ?? null
  }
  const clipTarget = () => clipTargetRef.current()

  // Only the SELECTED clip names the commands. When nothing is selected the
  // labels say "the clip at the playhead" — which is what will actually happen,
  // said out loud, rather than a clip name chosen behind the user's back.
  const paletteClip = useMemo(
    () => project.arrangementClips.find(c => c.id === selectedClipId) ?? null,
    [project.arrangementClips, selectedClipId],
  )
  const anyClips = project.arrangementClips.length > 0
  const paletteAudioClip = paletteClip?.kind === 'audio' ? paletteClip : null
  // Named when something is selected, described when it isn't. "at the playhead"
  // is left off here because several labels already end in it — "Split the clip
  // at the playhead at the playhead" is what happens when you forget that.
  const clipLabel = paletteClip ? (paletteClip.name || 'clip') : 'the clip under the playhead'
  const editable = !props.readOnly
  /** Run `fn` against whichever clip the command should act on, if there is one. */
  const withClip = (fn: (c: DawClip) => void) => { const c = clipTarget(); if (c) fn(c) }
  const withAudioClip = (fn: (c: AudioClip) => void) => {
    const c = clipTarget()
    if (c?.kind === 'audio') fn(c)
    else { setFreezing('That only works on an audio clip'); setTimeout(() => setFreezing(null), 2200) }
  }

  useRegisterCommands([
    // ── Transport ────────────────────────────────────────────────────────────
    // Recording is NOT registered here. It is a whole flow — mic permission,
    // count-in, arm checks, the blinks that point you at the button you forgot —
    // and it lives in Transport. A second copy of it in the palette would be a
    // second copy that drifts. Transport registers its own command instead,
    // which is the rule for anything the palette cannot reach without
    // reimplementing it.
    // Same for the loop toggle: turning looping off also has to disarm the loop
    // tool, and only Transport knows that. Registered there.
    { id: 'audio.transport.loopClip', group: 'Transport', label: 'Loop over the selected clip',
      keywords: 'cycle region set loop brace', when: () => editable && !!paletteClip,
      run: () => {
        if (!paletteClip) return
        dispatch({ type: 'SET_LOOP', start: paletteClip.startBeat, end: paletteClip.startBeat + paletteClip.durationBeats })
        dispatch({ type: 'SET_LOOP_ENABLED', enabled: true })
      } },
    { id: 'audio.transport.metronome', group: 'Transport', label: `${metronome ? 'Turn off' : 'Turn on'} the metronome`,
      keywords: 'click count in tempo beat', run: () => setMetronome(m => !m) },
    { id: 'audio.transport.end', group: 'Transport', label: 'Go to the end of the song',
      keywords: 'last final jump forward', run: () => {
        const p = projectRef.current
        setPosition(p.arrangementClips.reduce((m, c) => Math.max(m, c.startBeat + c.durationBeats), 0))
      } },
    { id: 'audio.transport.toClip', group: 'Transport', label: 'Go to the selected clip',
      keywords: 'jump locate playhead', when: () => !!paletteClip,
      run: () => paletteClip && setPosition(paletteClip.startBeat) },

    // ── Edit ─────────────────────────────────────────────────────────────────
    { id: 'audio.edit.undo', group: 'Edit', label: 'Undo', keywords: 'revert back mistake step',
      shortcut: '⌘Z', when: () => editable, run: doUndo },
    { id: 'audio.edit.redo', group: 'Edit', label: 'Redo', keywords: 'forward again reapply',
      shortcut: '⇧⌘Z', when: () => editable, run: doRedo },
    { id: 'audio.edit.selectAll', group: 'Edit', label: 'Select every clip', keywords: 'all everything',
      run: () => setSelectedClipIds(new Set(projectRef.current.arrangementClips.map(c => c.id))) },
    { id: 'audio.edit.deselect', group: 'Edit', label: 'Deselect everything', keywords: 'none clear selection',
      run: () => { setSelectedClipIds(new Set()); setSelectedClipId(null) } },
    { id: 'audio.edit.deleteClip', group: 'Edit', label: `Delete ${clipLabel}`,
      keywords: 'remove erase clip', shortcut: '⌫', when: () => editable && anyClips,
      run: () => {
        const ids = selectedClipIds.size ? [...selectedClipIds] : (clipTarget() ? [clipTarget()!.id] : [])
        ids.forEach(id => dispatch({ type: 'REMOVE_CLIP', clipId: id }))
        setSelectedClipIds(new Set()); setSelectedClipId(null)
      } },
    { id: 'audio.edit.duplicateClip', group: 'Edit', label: `Duplicate ${clipLabel}`,
      keywords: 'copy repeat again clip', shortcut: '⌘D', when: () => editable && anyClips,
      run: () => withClip(c => {
        const copy: DawClip = { ...structuredClone(c), id: crypto.randomUUID(), startBeat: c.startBeat + c.durationBeats }
        dispatch({ type: 'ADD_CLIP', clip: copy })
        setSelectedClipId(copy.id)
      }) },
    { id: 'audio.edit.splice', group: 'Edit', label: paletteClip ? `Split ${clipLabel} at the playhead` : 'Split the clip under the playhead in two',
      keywords: 'splice split cut divide separate scissors chop in two',
      when: () => editable && anyClips,
      run: () => withClip(c => {
        const e = engineRef.current
        if (!e) return
        const cut = spliceClipAt(c, e.currentBeat, b => e.beatsToSeconds(b))
        // The playhead has to be strictly INSIDE the clip. Say so rather than
        // doing nothing, or it reads as the command being broken.
        if (!cut) { setFreezing('Put the playhead inside a clip to split it'); setTimeout(() => setFreezing(null), 2600); return }
        dispatch({ type: 'REMOVE_CLIP', clipId: cut.removeId })
        for (const half of cut.add) dispatch({ type: 'ADD_CLIP', clip: half })
        setSelectedClipId(cut.add[0].id)
      }) },
    { id: 'audio.edit.renameClip', group: 'Edit', label: `Rename ${clipLabel}`,
      keywords: 'name title label clip', when: () => editable && anyClips,
      run: () => withClip(c => {
        const name = window.prompt('Clip name', c.name || '')
        if (name != null) dispatch({ type: 'UPDATE_CLIP', clipId: c.id, patch: { name } })
      }) },

    // ── Clip shaping (all of this lived only in the Inspector) ───────────────
    { id: 'audio.clip.reverse', group: 'Clip', label: `${paletteAudioClip?.reverse ? 'Un-reverse' : 'Reverse'} ${clipLabel}`,
      keywords: 'backwards flip audio reversed', when: () => editable && anyClips,
      run: () => withAudioClip(c => dispatch({ type: 'UPDATE_CLIP', clipId: c.id, patch: { reverse: !c.reverse } })) },
    { id: 'audio.clip.fadeIn', group: 'Clip', label: `Fade in ${clipLabel}`,
      keywords: 'ramp up attack smooth start', when: () => editable && anyClips,
      run: () => withAudioClip(c => dispatch({ type: 'UPDATE_CLIP', clipId: c.id, patch: { fadeIn: c.fadeIn > 0 ? 0 : 0.25 } })) },
    { id: 'audio.clip.fadeOut', group: 'Clip', label: `Fade out ${clipLabel}`,
      keywords: 'ramp down release smooth end', when: () => editable && anyClips,
      run: () => withAudioClip(c => dispatch({ type: 'UPDATE_CLIP', clipId: c.id, patch: { fadeOut: c.fadeOut > 0 ? 0 : 0.25 } })) },
    // Consolidate flattens a looped MIDI clip's repeats into real notes, so the
    // pattern can be edited bar by bar. It existed only as a context-menu item
    // on clips that happen to qualify — invisible until you right-click the
    // right clip.
    { id: 'audio.clip.consolidate', group: 'Clip', label: `Flatten ${clipLabel}’s loop into real notes`,
      keywords: 'consolidate unloop expand repeats flatten bake pattern',
      when: () => editable && anyClips,
      run: () => withClip(c => {
        if (c.kind !== 'midi' || !canConsolidate(c)) {
          setFreezing('That only works on a looping synth clip'); setTimeout(() => setFreezing(null), 2400); return
        }
        dispatch({ type: 'UPDATE_CLIP', clipId: c.id, patch: consolidateMidiClip(c) })
      }) },
    // clip.gain is a LINEAR multiplier — the engine assigns it straight to a
    // GainNode — so a step is a RATIO, not an addition. 1.122 is +1 dB; adding
    // 1 would have been +6 dB and a clamp at 12 would have been +21.
    { id: 'audio.clip.louder', group: 'Clip', label: `Turn ${clipLabel} up 1 dB`,
      keywords: 'gain volume boost level louder up', when: () => editable && anyClips,
      run: () => withAudioClip(c => dispatch({ type: 'UPDATE_CLIP', clipId: c.id, patch: { gain: Math.min(4, (c.gain ?? 1) * 1.122) } })) },
    { id: 'audio.clip.quieter', group: 'Clip', label: `Turn ${clipLabel} down 1 dB`,
      keywords: 'gain volume cut level attenuate quieter down', when: () => editable && anyClips,
      run: () => withAudioClip(c => dispatch({ type: 'UPDATE_CLIP', clipId: c.id, patch: { gain: Math.max(0.02, (c.gain ?? 1) / 1.122) } })) },
    // Normalise — the one thing on the expected-capability list that genuinely
    // did not exist. It reads the clip's actual samples (only the part inside
    // the trim, since that is all you hear) and sets the gain so the loudest
    // peak lands just under full scale. Peak rather than loudness on purpose:
    // this is the "why is this clip so much quieter than the others" tool, and
    // it must never push a clip into clipping.
    { id: 'audio.clip.normalize', group: 'Clip', label: `Normalise ${clipLabel}`,
      keywords: 'normalise normalize level match loudness peak volume boost quiet too low',
      when: () => editable && anyClips,
      run: () => withAudioClip(clip => { void (async () => {
        const e = engineRef.current
        if (!e) return
        const buf = await e.loadClipBuffer(clip)
        if (!buf) { setFreezing('Could not read that clip’s audio'); setTimeout(() => setFreezing(null), 2600); return }
        // Only scan what actually plays — a clip trimmed past a loud transient
        // should normalise to what you HEAR, not to the part cut off screen.
        const from = Math.floor((clip.trimStart ?? 0) * buf.sampleRate)
        const to = Math.min(buf.length, Math.ceil((buf.duration - (clip.trimEnd ?? 0)) * buf.sampleRate))
        let peak = 0
        for (let ch = 0; ch < buf.numberOfChannels; ch++) {
          const d = buf.getChannelData(ch)
          for (let i = from; i < to; i++) { const a = Math.abs(d[i]); if (a > peak) peak = a }
        }
        if (peak < 1e-5) { setFreezing('That clip is silent'); setTimeout(() => setFreezing(null), 2600); return }
        const gain = Math.min(8, 0.97 / peak)
        dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch: { gain } })
        const db = 20 * Math.log10(gain / (clip.gain || 1))
        setFreezing(`Normalised — ${db >= 0 ? '+' : ''}${db.toFixed(1)} dB`)
        setTimeout(() => setFreezing(null), 2600)
      })() }) },
    { id: 'audio.clip.roll', group: 'Clip', label: `Open ${clipLabel} in the piano roll`,
      keywords: 'notes midi edit draw pitches piano roll', when: () => anyClips,
      run: () => withClip(c => {
        if (c.kind !== 'midi') { setFreezing('Only synth clips have notes to edit'); setTimeout(() => setFreezing(null), 2400); return }
        setExpandedPianoRollClipId(c.id)
      }) },

    // ── Track ────────────────────────────────────────────────────────────────
    ...(paletteTrack ? [
      { id: 'audio.track.duplicate', group: 'Track', label: `Duplicate ${paletteTrack.name}`,
        keywords: 'copy clone track', when: () => editable,
        run: () => dispatch({ type: 'DUPLICATE_TRACK', trackId: paletteTrack.id, seed: crypto.randomUUID() }) },
      { id: 'audio.track.remove', group: 'Track', label: `Delete ${paletteTrack.name}`,
        keywords: 'remove track erase', when: () => editable,
        run: () => { if (window.confirm(`Delete "${paletteTrack.name}" and its clips?`)) dispatch({ type: 'REMOVE_TRACK', trackId: paletteTrack.id }) } },
      { id: 'audio.track.rename', group: 'Track', label: `Rename ${paletteTrack.name}`,
        keywords: 'name title label track', when: () => editable,
        run: () => {
          const name = window.prompt('Track name', paletteTrack.name)
          if (name) dispatch({ type: 'UPDATE_TRACK', trackId: paletteTrack.id, patch: { name } })
        } },
      { id: 'audio.track.arm', group: 'Track', label: `${paletteTrack.armed ? 'Disarm' : 'Arm'} ${paletteTrack.name} for recording`,
        keywords: 'record input enable ready', when: () => editable,
        run: () => dispatch({ type: 'UPDATE_TRACK', trackId: paletteTrack.id, patch: { armed: !paletteTrack.armed } }) },
      { id: 'audio.track.soloClear', group: 'Track', label: 'Clear all solos',
        keywords: 'unsolo everything reset listen', when: () => editable && projectRef.current.tracks.some(t => t.solo),
        run: () => projectRef.current.tracks.filter(t => t.solo).forEach(t => dispatch({ type: 'UPDATE_TRACK', trackId: t.id, patch: { solo: false } })) },
      { id: 'audio.track.unmuteAll', group: 'Track', label: 'Unmute every track',
        keywords: 'clear mutes hear everything reset', when: () => editable && projectRef.current.tracks.some(t => t.mute),
        run: () => projectRef.current.tracks.filter(t => t.mute).forEach(t => dispatch({ type: 'UPDATE_TRACK', trackId: t.id, patch: { mute: false } })) },
    ] : []),

    // ── Project ──────────────────────────────────────────────────────────────
    // Tempo and swing are NOT here either. Tempo has to respect the tempo map
    // (a song with tempo markers must retempo one segment, not the whole
    // project) and swing has to be pushed to the live engine as well as stored,
    // or you change it and hear nothing. Both live in Transport and are
    // registered there.
    { id: 'audio.project.timesig', group: 'Project', label: 'Change the time signature',
      keywords: 'meter bar beats 3/4 4/4 6/8 waltz', when: () => editable,
      run: () => {
        const v = window.prompt('Time signature, like 4/4', `${project.timeSignatureNum ?? 4}/${project.timeSignatureDen ?? 4}`)
        const m = v?.match(/^\s*(\d+)\s*\/\s*(\d+)\s*$/)
        if (m) dispatch({ type: 'SET_TIME_SIG', num: Number(m[1]), den: Number(m[2]) })
      } },
    { id: 'audio.project.rename', group: 'Project', label: 'Rename this project',
      keywords: 'title name song', when: () => editable,
      run: () => {
        const name = window.prompt('Project name', project.name || '')
        if (name) dispatch({ type: 'SET_PROJECT_NAME', name })
      } },
    { id: 'audio.project.marker', group: 'Project', label: 'Drop a marker at the playhead',
      keywords: 'cue locator flag bookmark position', when: () => editable,
      run: () => {
        const beat = Math.round(engineRef.current?.currentBeat ?? 0)
        const name = window.prompt('Marker name', `Marker ${(projectRef.current.cueMarkers?.length ?? 0) + 1}`)
        if (name) dispatch({ type: 'ADD_CUE_MARKER', marker: { id: crypto.randomUUID(), beat, name } })
      } },
    { id: 'audio.project.section', group: 'Project', label: 'Start a new section here',
      keywords: 'verse chorus bridge intro arrangement structure', when: () => editable,
      run: () => {
        const beat = Math.round(engineRef.current?.currentBeat ?? 0)
        const name = window.prompt('Section name (Verse, Chorus, …)', 'Section')
        if (name) dispatch({ type: 'ADD_SECTION', section: { id: crypto.randomUUID(), beat, name, color: '#6aa6ff' } })
      } },

    // ── Effects, by name ─────────────────────────────────────────────────────
    //
    // One command per effect type. This is the opposite call to the one made for
    // instrument presets, which were deliberately NOT enumerated — that list
    // grows without limit and would swamp everything else in the palette. The
    // effect list is seventeen and grows about once a year, and "reverb" is
    // precisely the word someone types when they want a reverb.
    ...(paletteTrack ? ADD_OPTIONS.map(opt => ({
      id: `audio.fx.${opt.type}`, group: 'Effects',
      label: `Add ${opt.label} to ${paletteTrack.name}`,
      keywords: `effect device fx insert add ${opt.type} ${opt.label}`,
      when: () => editable,
      run: () => dispatch({
        type: 'ADD_EFFECT', trackId: paletteTrack.id,
        effect: { id: crypto.randomUUID(), type: opt.type, params: makeDefaultEffectParams(opt.type) },
      }),
    })) : []),

    // Automation: a volume curve drawn across the whole song. The lane exists in
    // the data model and in the mixer strip's graph, but nothing named it.
    ...(paletteTrack ? [{
      id: 'audio.track.automation', group: 'Track',
      label: `Draw volume automation on ${paletteTrack.name}`,
      keywords: 'automation lane curve volume fade ride envelope draw over time',
      when: () => editable && !project.automationLanes?.some(l => l.trackId === paletteTrack.id && l.parameter === 'volume'),
      run: () => dispatch({
        type: 'ADD_AUTOMATION_LANE',
        lane: {
          id: crypto.randomUUID(), trackId: paletteTrack.id, parameter: 'volume', label: 'Volume',
          min: 0, max: 1, defaultValue: Math.min(1, paletteTrack.volume ?? 0.8),
          points: [], expanded: true,
        },
      }),
    }] : []),

    // Importing audio was drag-and-drop ONLY — there was no button, no menu item
    // and no file picker anywhere in the studio. If you didn't happen to try
    // dragging a file onto the window, the feature did not exist for you.
    { id: 'audio.import', group: 'Audio', label: 'Import an audio file',
      keywords: 'import add open load wav mp3 sample file drag drop bring in upload',
      when: () => editable,
      run: () => {
        const input = document.createElement('input')
        input.type = 'file'
        input.accept = 'audio/*,video/*'
        input.multiple = true
        input.onchange = () => { if (input.files?.length) importDroppedFiles([...input.files]) }
        input.click()
      } },

    // ── View ─────────────────────────────────────────────────────────────────
    { id: 'audio.view.pads', group: 'View', label: `${showPads ? 'Hide' : 'Show'} the pads`,
      keywords: 'drums beat step sequencer trigger play', when: () => !isPodcast,
      run: () => setShowPads(s => !s) },
    { id: 'audio.view.sidebar', group: 'View', label: 'Hide the sidebar',
      keywords: 'collapse panel wider room space', when: () => sidebarOpen,
      run: () => setSidebarOpen(false) },
    { id: 'audio.view.appearance', group: 'View', label: 'Change the studio’s colours',
      keywords: 'theme appearance skin look pattern customise', run: () => setShowAppearance(true) },
  ], [
    project.tempo, project.swing, project.name,
    project.arrangementClips, paletteClip, paletteAudioClip, paletteTrack, clipLabel, editable, project.timeSignatureNum, project.timeSignatureDen,
    selectedClipIds, metronome, showPads, sidebarOpen, isPodcast, dispatch, doUndo, doRedo,
    setPosition, setMetronome, setSelectedClipId, setSelectedClipIds, setExpandedPianoRollClipId,
    setShowPads, setSidebarOpen, setShowAppearance, overlay, setOverlay,
  ])

  // ⚠️ Publish the studio so things OUTSIDE the editor can reach it.
  //
  // Light lives in the app layout now — beside the page, not inside it — so it
  // is not a descendant of the provider below and context cannot reach it. It
  // asked, was told there was no studio, and refused every command in the
  // studio it was sitting in. The registry is how anything outside this tree
  // finds the editor while it is on screen.
  useEffect(() => {
    setActiveStudio(contextValue)
    return () => setActiveStudio(null)
  }, [contextValue])

  // ── Render ───────────────────────────────────────────────────────────────────
  const editorContent = (
    <DawContext.Provider value={contextValue}>
      {/* The playhead rides its own context: it changes ten times a second,
          and anything in contextValue rebuilds that object and re-renders every
          consumer in the editor. */}
      <DawPlayheadProvider engine={engineForRender} playing={playing} seekNonce={seekNonce}>
      <div
        data-editor="true"
        data-editor-kind="audio"
        {...audioDropProps}
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          backgroundColor: 'var(--bg-base)',
          backgroundImage: 'var(--workshop-pattern, none)',
          backgroundSize: 'var(--workshop-pattern-size, auto)',
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        {/* Loading a heavy song means synthesising it, and that took a minute
            with NOTHING on screen to say so — the studio just felt slow. This is
            the one indicator that covers ordinary loading rather than the
            deliberate Freeze below it. It only appears while there is real work
            outstanding, and it says which half of the work it is doing: getting
            to first sound, or filling in the rest behind you. */}
        {/* The moment the last piece of the song lands. Bottom-centre, where
            the loading strip lives, so the eye is already there. */}
        <Appear show={!!readyPill && !(loadProgress.total > 0 && loadProgress.done < loadProgress.total)} kind="rise" exitMs={180}>
          {cls => (
            <div
              className={`${cls} appear-centered`}
              data-ui-el="ready-to-play"
              role="status"
              style={{
                position: 'absolute', bottom: 10, left: '50%', transform: 'translateX(-50%)', zIndex: 941,
                pointerEvents: 'none', padding: '5px 12px', borderRadius: 999,
                background: 'var(--bg-elevated, #16181d)', border: '1px solid var(--accent)',
                color: 'var(--accent-light, var(--accent))', fontSize: 11, fontWeight: 700, letterSpacing: '0.03em',
                boxShadow: '0 6px 24px rgba(0,0,0,.45)', whiteSpace: 'nowrap',
              }}
            >
              ✓ Ready to play
            </div>
          )}
        </Appear>
        {loadProgress.total > 0 && loadProgress.done < loadProgress.total && (
          <div
            data-ui-el="load-progress"
            style={{
              // Along the BOTTOM, not the top. Brae asked for it there, and it
              // is the better place for it: the top edge is where the transport
              // and the toolbar live, so a strip that appears and disappears
              // there nudges the eye to exactly the controls someone is
              // reaching for. Loading is status, not a control.
              //
              // column-reverse keeps the reading order intact once flipped: the
              // label sits above the hairline bar, and the bar hugs the very
              // bottom edge of the window.
              position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 940,
              pointerEvents: 'none', display: 'flex', flexDirection: 'column-reverse', gap: 0,
            }}
          >
            <div style={{ height: 2, background: 'transparent' }}>
              <div style={{
                height: '100%',
                width: `${Math.round((loadProgress.done / loadProgress.total) * 100)}%`,
                background: playing ? 'var(--text-muted)' : 'var(--accent)',
                transition: 'width 240ms linear, background 300ms',
              }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 6, pointerEvents: 'auto' }}>
              <button
                onClick={() => setLoadPanel(v => !v)}
                title={loadPanel ? 'Hide what is loading' : 'Show what is loading, what is queued and anything that failed'}
                style={{
                  marginBottom: 4, padding: '3px 10px', borderRadius: 999, fontSize: 10.5, fontWeight: 600,
                  background: 'var(--bg-elevated, #16181d)', border: '1px solid var(--border)',
                  color: loadPanel ? 'var(--text-primary)' : 'var(--text-muted)', letterSpacing: '0.02em',
                  cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6,
                }}
              >
                <span style={{ fontSize: 8, opacity: .8 }}>{loadPanel ? '▾' : '▴'}</span>
                {/* Say what is actually happening, and it has changed several
                    times as the loader has. It claimed loading was paused while
                    playing when it was not; then "ahead of the playhead" while
                    rendering fourteen seconds of song; then that playing stops
                    the work, which it no longer does.

                    It now counts LAYERS, not clips. Brae: "We would need to
                    change the loading bar to Layers instead of track items."
                    He is right, and not only for wording: the song is rendered
                    dry first and the effects are layered over it, so every clip
                    is audible almost immediately and "17 of 23" was answering a
                    question nobody had. What arrives is the SOUND. */}
                {loadProgress.phase === 'paused'
                  /* Baking is an OPTIMISATION now, and it stands aside while you
                     listen: rendering runs on the main thread and competes with
                     the note scheduler. The song plays live either way, so this
                     has to read as a deliberate wait rather than as a stall —
                     the previous wording left it showing a layer name that was
                     not being worked on. */
                  ? 'Playing live — loading continues when you pause'
                  : loadProgress.trouble
                    ? `${loadProgress.layer ?? 'Loading'} — ${loadProgress.trouble}`
                    : loadProgress.layer
                      ? loadProgress.layer
                      : loadProgress.phase === 'head'
                        ? 'Getting the sound ready…'
                        : `Loading the song — ${loadProgress.done}/${loadProgress.total}`}
              </button>

              <button
                onClick={() => switchToServer(!serverLoad, serverLoad ? 'switched back' : 'chosen by the user')}
                title={serverLoad
                  ? 'Render on this computer again'
                  : 'Stop rendering on this computer and use renders from the server where they exist'}
                style={{
                  marginBottom: 4, padding: '3px 9px', borderRadius: 999, fontSize: 10, fontWeight: 600,
                  background: serverLoad ? 'rgb(var(--accent-rgb) / .22)' : 'var(--bg-elevated, #16181d)',
                  border: `1px solid ${serverLoad ? 'var(--accent)' : 'var(--border)'}`,
                  color: serverLoad ? 'var(--accent-light)' : 'var(--text-muted)',
                  cursor: 'pointer', whiteSpace: 'nowrap',
                }}
              >{serverLoad ? 'Server loading — on' : 'Switch to server loading'}</button>
            </div>

            {/* The offer, when the machine is visibly struggling. It says WHAT
                it noticed: "we think you should change something" without the
                evidence is just an alarm. */}
            {serverOfferA.mounted && !serverLoad && (
              <div className={serverOfferA.cls} style={{
                pointerEvents: 'auto', alignSelf: 'center', marginBottom: 4,
                display: 'flex', alignItems: 'center', gap: 10,
                background: 'var(--bg-elevated, #16181d)', border: '1px solid #a2591b',
                borderRadius: 999, padding: '4px 6px 4px 12px', fontSize: 11, color: 'var(--text-secondary)',
              }}>
                <span>This computer is having trouble — {serverOffer}.</span>
                <button
                  onClick={() => switchToServer(true, `offered: ${serverOffer}`)}
                  style={{ padding: '3px 9px', borderRadius: 999, border: '1px solid var(--accent)', background: 'rgb(var(--accent-rgb) / .2)', color: 'var(--accent-light)', fontSize: 10.5, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}
                >Use server loading</button>
                <button
                  onClick={() => setServerOffer(null)}
                  style={{ padding: '3px 8px', borderRadius: 999, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', fontSize: 10.5, cursor: 'pointer' }}
                >Keep going here</button>
              </div>
            )}

            {/* Opens UPWARD, above the pill, because the bar lives on the
                bottom edge — a panel that dropped down would go off-screen. */}
            {loadPanel && (
              <div
                style={{
                  pointerEvents: 'auto', alignSelf: 'center', marginBottom: 2,
                  width: 'min(560px, calc(100vw - 24px))', maxHeight: '46vh', overflowY: 'auto',
                  background: 'var(--bg-elevated, #16181d)', border: '1px solid var(--border)',
                  borderRadius: 10, boxShadow: '0 -12px 40px rgba(0,0,0,.55)',
                  padding: '10px 12px', fontSize: 11, color: 'var(--text-secondary)',
                }}
              >
                <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 8, fontVariantNumeric: 'tabular-nums' }}>
                  <span><b style={{ color: 'var(--text-primary)' }}>{loadDetail?.inFlight ?? 0}</b> rendering</span>
                  <span><b style={{ color: 'var(--text-primary)' }}>{loadDetail?.queued ?? 0}</b> queued</span>
                  <span><b style={{ color: 'var(--text-primary)' }}>{loadDetail?.ready ?? 0}</b> ready</span>
                  {!!loadDetail?.setAside && <span style={{ color: '#e0a458' }}><b>{loadDetail.setAside}</b> set aside</span>}
                  {!!loadDetail?.givenUp && <span style={{ color: '#f08c8c' }}><b>{loadDetail.givenUp}</b> given up</span>}
                </div>

                {loadDetail?.lastError && (
                  <div style={{ background: 'rgba(240,140,140,.12)', border: '1px solid rgba(240,140,140,.35)', borderRadius: 6, padding: '5px 8px', marginBottom: 8, color: '#f0b0b0' }}>
                    {loadDetail.lastError}
                  </div>
                )}

                {/* The history, newest first. `paused` rows are the ones Brae
                    asked for by name: they record that PLAY interrupted the
                    work, and `resumed` records it coming back — so the cost of
                    listening while it loads is visible instead of theoretical. */}
                <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.08em', color: 'var(--text-muted)', margin: '2px 0 4px' }}>
                  WHAT HAPPENED
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {(loadDetail?.log ?? []).slice(-40).reverse().map((e, i) => {
                    const bad = ['silent', 'window-error', 'layer-error', 'job-error', 'stall', 'reset', 'gave-up'].includes(e.kind)
                    const wait = e.kind === 'paused' || e.kind === 'resumed'
                    return (
                      <div key={i} style={{
                        display: 'flex', gap: 8, alignItems: 'baseline',
                        fontFamily: 'var(--font-mono, ui-monospace), monospace', fontSize: 10,
                        color: bad ? '#f0a0a0' : wait ? '#e0c07a' : 'var(--text-muted)',
                      }}>
                        <span style={{ opacity: .6, minWidth: 46, textAlign: 'right' }}>{(e.t / 1000).toFixed(1)}s</span>
                        <span style={{ minWidth: 88, fontWeight: 600 }}>{e.kind}</span>
                        <span style={{ flex: 1, minWidth: 0 }}>
                          {e.layer ? `${e.layer} — ` : ''}{e.detail ?? ''}
                          {typeof e.done === 'number' && typeof e.total === 'number' ? ` (${e.done}/${e.total})` : ''}
                          {typeof e.ms === 'number' ? ` ${e.ms}ms` : ''}
                        </span>
                      </div>
                    )
                  })}
                  {!(loadDetail?.log ?? []).length && <span style={{ color: 'var(--text-muted)' }}>Nothing recorded yet.</span>}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Freezing renders the whole song, which takes a while — say so, or it
            looks like the studio has hung. */}
        {freezingA.mounted && (
          <div
            className={`${freezingA.cls} appear-centered`}
            data-ui-el="freeze-status"
            style={{
              position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 950,
              padding: '7px 16px', borderRadius: 999, fontSize: 12, fontWeight: 600,
              background: 'var(--bg-elevated, #16181d)', border: '1px solid var(--accent)',
              color: 'var(--text-primary)', boxShadow: '0 8px 24px rgba(0,0,0,0.35)', pointerEvents: 'none',
            }}
          >
            {freezingS}
          </div>
        )}
        {draggingAudioOver && !props.readOnly && (
          <div
            style={{
              position: 'absolute', inset: 0, zIndex: 900, pointerEvents: 'none',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'color-mix(in srgb, var(--bg-base) 70%, transparent)',
              border: '2px dashed var(--accent)',
            }}
          >
            <div style={{ padding: '14px 22px', borderRadius: 10, background: 'var(--bg-elevated, var(--bg-base))', border: '1px solid var(--accent)', fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
              Drop to add as a track
            </div>
          </div>
        )}
        {showAppearance && <AppearancePanel onClose={() => setShowAppearance(false)} editorKind="audio" />}
        {props.projectId && <SessionRecap projectId={props.projectId} />}
        {/* Pre-save Share: saves the project, then CollabInvite opens */}
        {!props.projectId && props.onSave && !props.readOnly && (
          <UnsavedShareButton onShare={() => handleSaveRef.current()} />
        )}
        {/* Collab layer (Liveblocks room + presence bar) — saved projects only, lazy-loaded */}
        {props.projectId && (
          <CollabLayer
            projectId={props.projectId}
            broadcastRef={broadcastRef}
            rawDispatch={rawDispatch}
            isRemoteRef={isRemoteRef}
            projectRef={projectRef}
            selectedTrackId={selectedTrackId}
            selectedClipId={selectedClipId}
            editingClipId={expandedPianoRollClipId}
            view={view}
            onOthers={setCollabPeers}
            getPlayhead={getPlayheadRef.current}
          />
        )}

        {/* Cross-project audio links: one live listener per LINKED source project.
            A source edit updates its replica and re-syncs the linked clip's audio. */}
        {linkedSourceIds.map(sid => (
          <DawMixSync
            key={sid}
            projectId={sid}
            getProject={() => sourceReplicasRef.current.get(sid) ?? null}
            onProject={(p, live) => { sourceReplicasRef.current.set(sid, p); scheduleLinkResync(sid, live) }}
          />
        ))}

        {/* Pick a project to link its audio in as a live track */}
        {showLinkPicker && (
          <div onClick={() => setShowLinkPicker(false)}
            style={{ position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(8,8,12,0.55)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div onClick={e => e.stopPropagation()}
              style={{ width: 'min(440px, 92vw)', maxHeight: '70vh', display: 'flex', flexDirection: 'column', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14, boxShadow: '0 20px 60px rgba(0,0,0,0.5)', overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
                <Link2 size={15} color="var(--accent-light)" />
                <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>Link a project&rsquo;s audio</span>
                <button onClick={() => setShowLinkPicker(false)} style={{ marginLeft: 'auto', color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer' }}><X size={16} /></button>
              </div>
              <p style={{ padding: '10px 16px 4px', margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>Its full mix drops in as a live audio track — edit that project and this track re-renders to match.</p>
              <div style={{ overflowY: 'auto', padding: '6px 8px 12px' }}>
                {linkPickerProjects === null ? (
                  <p style={{ padding: 16, fontSize: 13, color: 'var(--text-muted)', textAlign: 'center' }}>Loading your projects…</p>
                ) : linkPickerProjects.length === 0 ? (
                  <p style={{ padding: 16, fontSize: 13, color: 'var(--text-muted)', textAlign: 'center' }}>No other projects to link.</p>
                ) : linkPickerProjects.map(p => {
                  const linked = linkedSourceIds.includes(p.id)
                  return (
                    <button key={p.id} onClick={() => linkProjectAudio(p.id, p.name)}
                      style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', padding: '9px 10px', borderRadius: 8, background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-primary)' }}
                      onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-surface)' }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
                      <Library size={13} color="var(--text-muted)" />
                      <span style={{ flex: 1, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                      {linked && <span style={{ fontSize: 10, color: 'var(--accent-light)', fontWeight: 600 }}>linked · re-sync</span>}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        )}
        <Transport onCommitName={onProjectNameCommit} />

        {/* Body */}
        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          {/* Left sidebar: file-cabinet rail + collapsible panel.
              data-hud-hide puts it away in HUD mode, which leaves the song and
              the sound visuals. See lib/voice/hud.ts. */}
          <div data-hud-hide style={{ display: 'flex', flexShrink: 0, borderRight: '1px solid var(--border)' }}>

            {/* Rail — always visible */}
            <div style={{
              width: 40, flexShrink: 0,
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', paddingTop: 8, gap: 2,
              background: 'var(--bg-surface)',
              borderRight: sidebarOpen ? '1px solid var(--border)' : 'none',
            }}>
              {/* Logo — takes the user straight home */}
              <Link
                href="/dashboard"
                onClick={e => {
                  // ⚠️ Desktop: a project window going Home should close itself
                  // and surface the launcher — behaviour that used to come from
                  // Electron's will-navigate, which a client-side <Link> does
                  // not trigger. The browser keeps the client navigation, which
                  // is what keeps Light and the popped-out panels alive.
                  const api = (window as unknown as { electronAPI?: { goHome?: () => Promise<boolean> } }).electronAPI
                  if (!api?.goHome) return
                  e.preventDefault()
                  void api.goHome().then(handled => { if (!handled) window.location.assign('/dashboard') })
                }}
                title="Home"
                data-help-id="home"
                style={{
                  width: 28, height: 28, marginBottom: 4, flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none',
                }}
              >
                <LogoMark size={22} />
              </Link>
              {/* Return to the projects list. (The sidebar still opens from the
                  Sound Library / Code tab buttons just below.) */}
              <Link
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
              </Link>
              {/* Open a project file, or import media into a new video project.
                  Tinted (not muted) so it reads as an action in the icon rail. */}
              <button
                onClick={handleOpenImport}
                title="Open / Import Files — open a project (.cfproj / .zip) or import media"
                style={{
                  width: 28, height: 28, borderRadius: 6, marginBottom: 6, flexShrink: 0, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: 'rgb(var(--accent-rgb) / 0.10)', color: 'var(--accent-light)',
                  border: '1px solid rgb(var(--accent-rgb) / 0.30)',
                  transition: 'background 0.12s, color 0.12s',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgb(var(--accent-rgb) / 0.20)' }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgb(var(--accent-rgb) / 0.10)' }}
              >
                <Upload size={15} />
              </button>
              {!isPodcast ? (
                ([
                  { tab: 'library', Icon: Library, label: 'Sound Library',                     help: 'sound-library' },
                  { tab: 'code',    Icon: Code2,   label: 'Code — generate or edit sounds with math', help: 'sound-code' },
                ] as const).map(({ tab, Icon, label, help }) => {
                  const isActive = sidebarOpen && leftTab === tab
                  return (
                    <button
                      key={tab}
                      onClick={() => { if (isActive) setSidebarOpen(false); else { setLeftTab(tab); setSidebarOpen(true) } }}
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
                })
              ) : (
                ([
                  { tab: 'setup',   Icon: Settings, label: 'Setup'   },
                  { tab: 'episode', Icon: FileText,  label: 'Episode' },
                  { tab: 'guests',  Icon: Users,     label: 'Guests'  },
                ] as const).map(({ tab, Icon, label }) => {
                  const isActive = sidebarOpen && leftTab === tab
                  return (
                    <button
                      key={tab}
                      onClick={() => {
                        if (isActive) setSidebarOpen(false)
                        else { setLeftTab(tab); setSidebarOpen(true) }
                      }}
                      title={label}
                      data-help-id={`rail-${tab}`}
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
                })
              )}
              {/* Link another project's audio in as a live track (cross-project pull) */}
              <button
                onClick={openLinkPicker}
                title="Link another project's audio (full mix) in as a live track"
                aria-label="Link a project's audio"
                style={{
                  width: 28, height: 28, borderRadius: 6, border: 'none', cursor: 'pointer',
                  marginTop: 'auto', flexShrink: 0, background: 'transparent',
                  color: 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'background 0.12s, color 0.12s',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(var(--accent-rgb) / 0.12)'; (e.currentTarget as HTMLElement).style.color = 'var(--accent)' }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)' }}
              >
                <Link2 size={15} />
              </button>
              {/* Send this project's audio into another project (cross-project push) */}
              <SendToProjectButton
                sourceProjectId={props.projectId}
                style={{
                  width: 28, height: 28, borderRadius: 6, border: 'none', cursor: 'pointer',
                  flexShrink: 0, background: 'transparent',
                  color: 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'background 0.12s, color 0.12s',
                }}
              />
              {/* Appearance / theme customization — always available */}
              <button
                onClick={() => setShowAppearance(true)}
                title="Customize appearance"
                data-help-id="appearance"
                style={{
                  width: 28, height: 28, borderRadius: 6, border: 'none', cursor: 'pointer',
                  marginBottom: 8, background: 'transparent',
                  color: 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'background 0.12s, color 0.12s',
                }}
              >
                <Palette size={14} />
              </button>
            </div>

            {/* Collapsible panel. Tagged so a floating window (the Apollo card)
                can open clear of it instead of landing on top of the Sound
                Library — with the card centred, picking a sample was physically
                unreachable. */}
            <div data-editor-dock={sidebarOpen ? 'left' : undefined} style={{
              width: sidebarOpen ? leftResize.size : 0,
              flexShrink: 0,
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              transition: leftResize.dragging ? 'none' : 'width 0.15s ease',
              background: 'var(--bg-surface)',
              position: 'relative',
            }}>
              {sidebarOpen && <ResizeHandle axis="x" edge="right" onPointerDown={leftResize.handleProps.onPointerDown} />}
              {isPodcast && (
                <div style={{ display: 'flex', padding: '5px 8px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
                  <button
                    onClick={handleAddGuest}
                    title="Add a new guest track with voice processing"
                    data-help-id="add-guest"
                    style={{
                      flex: 1, padding: '4px 8px', fontSize: 11, borderRadius: 4,
                      border: '1px solid var(--border)', background: 'transparent',
                      color: 'var(--text-muted)', cursor: 'pointer',
                    }}
                  >+ Guest</button>
                </div>
              )}
              {!isPodcast ? (
                leftTab === 'code' ? <PolyCodePanel /> : <SoundLibraryPanel embedded={true} />
              ) : leftTab === 'setup' ? (
                <PodcastSetupPanel />
              ) : leftTab === 'guests' ? (
                <div style={{ flex: 1, overflow: 'auto', padding: '0 12px' }}>
                  {props.projectId
                    ? <GuestPanel projectId={props.projectId} onPullTrack={handlePullTrack} />
                    : <p style={{ fontSize: 12, color: 'var(--text-muted)', padding: '16px 0' }}>Save the project first to invite guests.</p>
                  }
                </div>
              ) : (
                <EpisodePanel meta={podcastMeta} onChange={setPodcastMeta} />
              )}
            </div>

          </div>

          {/* Main area */}
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
            {/* View tabs */}
            <div style={{
              height: 34,
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              borderBottom: '1px solid var(--border)',
              background: 'var(--bg-surface)',
              padding: '0 8px',
              flexShrink: 0,
            }}>
              {isPodcast && (
                <span style={{
                  fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase',
                  padding: '2px 7px', borderRadius: 4, marginRight: 6,
                  background: 'rgba(249,115,22,0.12)', color: '#f97316',
                  border: '1px solid rgba(249,115,22,0.25)',
                }}>Podcast</span>
              )}
              {(isPodcast ? ['arrangement', 'mixer'] as DawView[] : ['session', 'arrangement', 'mixer'] as DawView[]).map(v => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  data-help-id={`view-${v}`}
                  style={{
                    background: view === v ? 'var(--bg-card)' : 'transparent',
                    border: view === v ? '1px solid var(--border)' : '1px solid transparent',
                    borderRadius: 4,
                    color: view === v ? 'var(--text-primary)' : 'var(--text-secondary)',
                    cursor: 'pointer',
                    fontSize: 12,
                    padding: '3px 10px',
                    textTransform: 'capitalize',
                    letterSpacing: '0.02em',
                  }}
                >
                  {v.charAt(0).toUpperCase() + v.slice(1)}
                </button>
              ))}
              <div style={{ flex: 1 }} />
              {isOffline && (
                <span style={{
                  fontSize: 9, fontWeight: 700, letterSpacing: '0.06em',
                  padding: '2px 8px', borderRadius: 4, marginRight: 6,
                  background: 'rgba(245,158,11,0.12)', color: '#f59e0b',
                  border: '1px solid rgba(245,158,11,0.35)', whiteSpace: 'nowrap',
                }}>OFFLINE — SAVING LOCALLY</span>
              )}
              {!isOffline && props.projectId && !pendingMerge && (
                <button onClick={() => void syncOfflineEditsRef.current(true)} disabled={syncing}
                  title="Reconcile any offline edits with the current shared version"
                  style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.04em', padding: '2px 8px', borderRadius: 4, marginRight: 6, cursor: 'pointer', background: 'var(--bg-card)', color: 'var(--text-secondary)', border: '1px solid var(--border)', whiteSpace: 'nowrap' }}>
                  {syncing ? 'SYNCING…' : <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><RotateCw size={9} /> SYNC</span>}
                </button>
              )}
              {props.readOnly && !suggesting && (
                <span style={{
                  display: 'flex', alignItems: 'center', gap: 8, fontSize: 10.5, fontWeight: 700,
                  padding: '3px 8px 3px 12px', borderRadius: 999, whiteSpace: 'nowrap',
                  background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.45)', color: '#f59e0b',
                }}>
                  👁 View only
                  {props.onSuggest && (
                    <button onClick={enterSuggest} title="Make edits locally and send them to the owner to accept"
                      style={{ fontSize: 10, fontWeight: 700, padding: '2px 9px', borderRadius: 999, cursor: 'pointer', border: 'none', background: '#f59e0b', color: '#1a1206' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Pencil size={11} /> Suggest changes</span>
                    </button>
                  )}
                </span>
              )}
              {props.readOnly && suggesting && (
                <span style={{
                  display: 'flex', alignItems: 'center', gap: 8, fontSize: 10.5, fontWeight: 700,
                  padding: '3px 8px 3px 12px', borderRadius: 999, whiteSpace: 'nowrap',
                  background: 'rgba(124,58,237,0.15)', border: '1px solid rgba(124,58,237,0.5)', color: 'var(--accent-light)',
                }}>
                  ✎ Suggesting — edits are local until the owner accepts
                  <button onClick={() => void submitSuggestion()} disabled={submittingSuggestion}
                    style={{ fontSize: 10, fontWeight: 700, padding: '2px 9px', borderRadius: 999, cursor: 'pointer', border: 'none', background: 'var(--accent)', color: 'var(--accent-contrast)', opacity: submittingSuggestion ? 0.6 : 1 }}>
                    {submittingSuggestion ? 'Sending…' : 'Submit'}
                  </button>
                  <button onClick={discardSuggest} disabled={submittingSuggestion}
                    style={{ fontSize: 10, fontWeight: 700, padding: '2px 9px', borderRadius: 999, cursor: 'pointer', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)' }}>
                    Discard
                  </button>
                </span>
              )}
              <InspectorBridge />
              <span data-ui-el="duplicate-cleanup" style={{ display: 'contents' }}><DuplicateCleanup /></span>
              <span data-ui-el="practice" style={{ display: 'contents' }}><PracticeButton /></span>
              <span data-ui-el="inspect" style={{ display: 'contents' }}><InspectButton /></span>
              <UITierSwitcher />
              <HelpButton />
            </div>

            {/* Active view */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
              {view === 'session' && <SessionView />}
      {/* A following window retargets as the selection changes — and clicking a
          CLIP is a selection too. Selecting an item on another track has to
          move Apollo to that track, or picking a clip in the arrangement looks
          like it does nothing. The clip's own track wins over the track
          selection, because the clip is the more specific thing to have
          clicked. */}
      {apolloRack?.follow && followTrackId && apolloRack.trackId !== followTrackId && (
        <ApolloFollow trackId={followTrackId} onRetarget={id => setApolloRack({ trackId: id, seed: null, follow: true })} />
      )}
      {apolloRack && (() => {
        const trackName = project.tracks.find(t => t.id === apolloRack.trackId)?.name ?? 'Track'
        const rack = (
          <ApolloRackWindow
            trackId={apolloRack.trackId}
            seed={apolloRack.seed}
            trackName={trackName}
            following={!!apolloRack.follow}
            onToggleFollow={() => setApolloRack({ ...apolloRack, follow: !apolloRack.follow })}
            detached={!!apolloRack.detached}
            onToggleDetach={() => setApolloRack({ ...apolloRack, detached: !apolloRack.detached })}
            onChange={next => {
              const track = projectRef.current.tracks.find(t => t.id === apolloRack.trackId)
              if (!track) return
              void import('@/lib/apollo/daw-fx').then(({ applyRackEdit }) => {
                const eff = applyRackEdit(track.effects, next.fxMain as never)
                dispatch({ type: 'SET_TRACK_EFFECTS', trackId: apolloRack.trackId, effects: eff })
              })
            }}
            onClose={() => setApolloRack(null)}
          />
        )
        // ⚠️ The SAME element either way. Detaching moves where it is drawn and
        // nothing else — the patch, the motion recording and the undo history
        // all live above this and never learn that the panel moved. Rendering a
        // different tree for the detached case is how a popped-out panel starts
        // quietly disagreeing with the one it replaced.
        return apolloRack.detached
          ? (
            <PopOut
              title={`Apollo — ${trackName}`}
              width={980}
              height={660}
              // Closing the OS window puts the rack back rather than closing it
              // outright: the person shut a window, they did not abandon an edit.
              onClose={() => setApolloRack(r => (r ? { ...r, detached: false } : r))}
            >
              {rack}
            </PopOut>
          )
          : rack
      })()}
              {view === 'arrangement' && <ArrangementView />}
              {view === 'mixer' && <Mixer />}
            </div>

            {/* Piano roll is now rendered inline under each track in TrackRow */}

            {/* Device chain / instrument panel — shown when a track or return is selected */}
            {(selectedTrackId !== null || selectedReturnId !== null) && (
              <div style={{ flexShrink: 0, borderTop: '1px solid var(--border)', background: 'var(--bg-base)', position: 'relative' }}>
                <ResizeHandle axis="y" edge="top" onPointerDown={bottomResize.handleProps.onPointerDown} />
                {/* Tab bar */}
                <div style={{ height: 28, display: 'flex', alignItems: 'center', gap: 1, padding: '0 8px', background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)' }}>
                  {selectedTrackId && (['devices', 'instrument'] as const).map(tab => (
                    <button
                      key={tab}
                      onClick={() => setBottomTab(tab)}
                      data-help-id={`bottom-${tab}`}
                      style={{ background: bottomTab === tab ? 'var(--bg-card)' : 'transparent', border: bottomTab === tab ? '1px solid var(--border)' : '1px solid transparent', borderRadius: 4, color: bottomTab === tab ? 'var(--text-primary)' : 'var(--text-muted)', cursor: 'pointer', fontSize: 11, padding: '2px 10px', textTransform: 'capitalize' }}
                    >
                      {tab === 'devices' ? 'Devices' : 'Instrument'}
                    </button>
                  ))}
                  {/* Name label */}
                  {(() => {
                    if (selectedTrackId) {
                      const t = project.tracks.find(tr => tr.id === selectedTrackId)
                      return t ? <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 8, borderLeft: `2px solid ${t.color}`, paddingLeft: 6 }}>{t.name}</span> : null
                    }
                    if (selectedReturnId) {
                      const rt = project.returnTracks.find(r => r.id === selectedReturnId)
                      return rt ? <span style={{ fontSize: 10, color: 'var(--accent-light)', marginLeft: 8, borderLeft: `2px solid ${rt.color}`, paddingLeft: 6 }}>{rt.name} — FX</span> : null
                    }
                    return null
                  })()}
                  {/* Pad Input toggle — only for MIDI / drum tracks */}
                  {selectedTrackId && (() => {
                    const t = project.tracks.find(tr => tr.id === selectedTrackId)
                    // Show whenever the track has an instrument — track.type stays
                    // 'audio' even after picking one, so gate on the instrument
                    return t && (t.type !== 'audio' || t.instrument.type !== 'none') ? (
                      <button
                        onClick={() => setShowPads(v => !v)}
                        title="Open pad / keyboard input"
                        data-help-id="pads"
                        style={{ marginLeft: 8, background: showPads ? 'var(--accent)' : 'transparent', border: showPads ? '1px solid var(--accent)' : '1px solid var(--border)', borderRadius: 4, color: showPads ? 'var(--accent-contrast)' : 'var(--text-muted)', cursor: 'pointer', fontSize: 11, padding: '2px 8px' }}
                      ><span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Keyboard size={12} /> Pads</span></button>
                    ) : null
                  })()}
                  <button
                    onClick={() => { setSelectedTrackId(null); setSelectedReturnId(null) }}
                    style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: '0 4px' }}
                    title="Close panel"
                  ><X size={16} /></button>
                </div>
                {/* Panel content */}
                <div style={{ height: bottomResize.size, overflowY: 'auto', overflowX: 'auto' }}>
                  {selectedTrackId && bottomTab === 'devices'    && <DeviceChain trackId={selectedTrackId} />}
                  {selectedTrackId && bottomTab === 'instrument' && <InstrumentPicker trackId={selectedTrackId} />}
                  {selectedReturnId && <ReturnDeviceChain returnId={selectedReturnId} />}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Floating pad / keyboard overlay */}
      {showPads && selectedTrackId && (
        <PadInput trackId={selectedTrackId} onClose={() => setShowPads(false)} />
      )}

      {/* Session-recovery prompt */}
      <Appear show={!!restorePrompt} kind="rise" exitMs={180}>{cls => restorePrompt && (
        <div className={`electron-nodrag ${cls} appear-centered`} style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 120,
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '12px 18px', borderRadius: 10,
          background: 'var(--bg-card)', border: '1px solid var(--accent)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.6)', maxWidth: 520,
        }}>
          <div style={{ fontSize: 12, color: 'var(--text-primary)', lineHeight: 1.5 }}>
            <strong>Unsaved session recovered</strong>
            <span style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)' }}>
              Local backup from {new Date(restorePrompt.savedAt).toLocaleString()} — restore it?
            </span>
            <span style={{ display: 'block', fontSize: 10, color: 'var(--text-muted)', marginTop: 2, opacity: 0.8 }}>
              Auto-dismisses in 15s — your current work is kept.
            </span>
          </div>
          <button onClick={handleRestore} style={{
            fontSize: 12, fontWeight: 600, padding: '6px 14px', borderRadius: 6, cursor: 'pointer',
            border: '1px solid var(--accent)', background: 'rgb(var(--accent-rgb) / 0.18)', color: '#7ab5f7', whiteSpace: 'nowrap',
          }}>Restore</button>
          <button onClick={handleDiscardRestore} style={{
            fontSize: 12, padding: '6px 12px', borderRadius: 6, cursor: 'pointer',
            border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', whiteSpace: 'nowrap',
          }}>Discard</button>
        </div>
      )}</Appear>

      {/* Collab lock notice */}
      <Appear show={!!lockNotice} kind="rise">{cls => (
        <div role="status" className={`${cls} appear-centered`} style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 1200,
          display: 'flex', alignItems: 'center', gap: 8, padding: '9px 16px', borderRadius: 999,
          background: 'var(--bg-card)', border: '1px solid rgba(245,158,11,0.5)', color: '#facc15',
          fontSize: 12.5, fontWeight: 600, boxShadow: '0 8px 30px rgba(0,0,0,0.5)', whiteSpace: 'nowrap',
        }}>🔒 {lockNoticeS} is editing this clip — it’s locked while they’re in it.</div>
      )}</Appear>

      {/* Suggestion sent */}
      <Appear show={!!suggestSent} kind="rise">{cls => (
        <div role="status" className={`${cls} appear-centered`} style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 1200,
          display: 'flex', alignItems: 'center', gap: 8, padding: '9px 16px', borderRadius: 999,
          background: 'var(--bg-card)', border: '1px solid #166534', color: '#4ade80',
          fontSize: 12.5, fontWeight: 600, boxShadow: '0 8px 30px rgba(0,0,0,0.5)', whiteSpace: 'nowrap',
        }}>✓ Suggestion sent — the owner can review and accept it.</div>
      )}</Appear>

      {/* Sync status toast */}
      <Appear show={!!syncMsg} kind="rise">{cls => (
        <div role="status" className={`${cls} appear-centered`} style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 1200,
          display: 'flex', alignItems: 'center', gap: 8, padding: '9px 16px', borderRadius: 999,
          background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-secondary)',
          fontSize: 12.5, fontWeight: 600, boxShadow: '0 8px 30px rgba(0,0,0,0.5)', whiteSpace: 'nowrap',
        }}>↻ {syncMsgS}</div>
      )}</Appear>

      {/* A device popped out of the chain, floating over the studio. Mounted
          here rather than inside DeviceChain because the device panel is a
          popover: a card that unmounted with it could not be used for the one
          thing it is for — watching a device while working on the track. */}
      <DevicePopoutHost />

      {/* Offline-sync conflict review — the per-item "Yours vs Theirs" panel
          (self-gates on the context's mergeConflicts). */}
      <MergeReview />

      {/* Save toast */}
      <Appear show={saveStatus === 'saved' || saveStatus === 'error'} kind="rise">{cls => (
        <div className={cls} style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 100,
          display: 'flex', flexDirection: 'column', gap: 2,
          padding: '10px 16px', borderRadius: 10,
          background: saveStatusS === 'saved' ? 'var(--bg-card)' : '#250f0f',
          border: `1px solid ${saveStatusS === 'saved' ? '#166534' : '#7f1d1d'}`,
          color: saveStatusS === 'saved' ? '#4ade80' : '#f87171',
          fontSize: 13, fontWeight: 500,
          boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
          maxWidth: 320,
        }}>
          {saveStatusS === 'saved' ? '✓ Project saved' : '✗ Save failed'}
          {saveStatusS === 'error' && saveError && (
            <span style={{ fontSize: 11, fontWeight: 400, opacity: 0.8, wordBreak: 'break-word' }}>{saveError}</span>
          )}
        </div>
      )}</Appear>
      </DawPlayheadProvider>
    </DawContext.Provider>
  )

  return <WorkshopThemeProvider><UITierProvider>{editorContent}</UITierProvider></WorkshopThemeProvider>
}
