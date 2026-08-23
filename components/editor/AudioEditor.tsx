'use client'

import { useState, useEffect, useReducer, useRef, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useUser } from '@clerk/nextjs'
import { computeRevertPatch } from '@/lib/daw-undo'
import { canConsolidate, consolidateMidiClip } from '@/lib/daw-consolidate'
import { CHECKOUT_LS_KEY } from '@/lib/apollo/checkout'
import { sessionCaptureToClips } from '@/lib/daw-session'
import dynamic from 'next/dynamic'
import type { DawView, EditTarget, DawProject, DawTrack, ApolloInstrumentParams } from '@/lib/daw-types'
import { defaultProject, TRACK_COLORS, DEFAULT_TRACK_HEIGHT, defaultTrackInstrument, voiceChainEffects, clipLockedBy, isAudioClip, isMidiClip } from '@/lib/daw-types'
import { legacyToBar } from '@/lib/effect-bar'
import type { DawAction } from '@/lib/daw-state'
import { DawContext, reducer, makeAudioClip, extractPeaks, migrateProject, useDaw } from '@/lib/daw-state'
import { useApolloTrackItem, ApolloTrackItemBar } from '@/components/editor/daw/ApolloTrackItem'
import { useApolloMotion } from '@/components/editor/daw/ApolloMotion'
import { consumeStudioSeed } from '@/lib/open-in-studio'
import { readWorkspace, writeWorkspace } from '@/lib/editor-workspace'
import { InspectorBridge } from './daw/InspectorBridge'
import { DuplicateCleanup } from './daw/DuplicateCleanup'
import MergeReview from './daw/MergeReview'
import { Library, Settings, FileText, Users, Palette, Code2, FolderOpen, PlusCircle, RotateCw, Pencil, Keyboard, X, Link2, Upload } from 'lucide-react'
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
import type { Caption } from '@/lib/types'
import { captureAudioInput } from '@/lib/audio-capture'
import { monitorFxParams } from '@/lib/daw-engine'
import type { AudioInputSource } from '@/lib/audio-capture'
import Transport from './daw/Transport'
import UITierSwitcher from './daw/UITierSwitcher'
import { useResizable, ResizeHandle } from './daw/useResizable'
import HelpButton from './daw/HelpButton'
import { InspectButton } from './daw/InspectMode'
import PracticeButton from './daw/PracticeButton'
import { VUMeter } from './daw/TrackRow'
import SoundLibraryPanel from './SoundLibrary'
import { useRegisterCommands } from '@/lib/commands'
import SendToProjectButton from './SendToProjectButton'
import PolyCodePanel from './daw/PolyCodePanel'
import GuestPanel from './daw/GuestPanel'
import { saveSnapshot, loadSnapshot, deleteSnapshot, getBranch } from '@/lib/offline-store'
import { mergeProjects, applyResolutions, hasDiverged, type MergeConflict } from '@/lib/project-merge'
import { getPresets, combinePresets } from '@/lib/midi-presets'

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
function ApolloRackWindow({ trackId, seed, trackName, following, onToggleFollow, onChange, onClose }: {
  trackId: string
  seed: unknown
  trackName: string
  following: boolean
  onToggleFollow: () => void
  onChange: (next: { fxMain: unknown[] }) => void
  onClose: () => void
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
        // Following means "always show the selected track". Pinning holds the
        // window on one track so picking sounds elsewhere in Beacon can't yank
        // an edit-in-progress away.
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

  const initialProject = useMemo(
    () => {
      if (props.initialDawProject) return props.initialDawProject
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
  const historyRef = useRef<Array<{ before: DawProject; action: DawAction }>>([])
  const redoRef    = useRef<Array<{ before: DawProject; action: DawAction }>>([])
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
  const dirtyReadyRef = useRef(false)   // skip the first post-load settle
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
  // media which opens a fresh video project seeded with it. Opening navigates
  // (loads via the /projects/<id> route), so flush + confirm if there are edits.
  async function handleOpenImport() {
    const read = await openProjectsFromFile().catch(() => null)
    if (!read) return
    if (read.media.length) { await openMediaInStudio(read.media); return }
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
    else setDawDirty(true)
    if (autosaveTimerRef.current !== null) window.clearTimeout(autosaveTimerRef.current)
    autosaveTimerRef.current = window.setTimeout(() => {
      void saveSnapshot(snapshotKey, projectRef.current).catch(() => {})
      setDawDirty(false)   // recoverable now
    }, 1500)
    return () => { if (autosaveTimerRef.current !== null) window.clearTimeout(autosaveTimerRef.current) }
  }, [project, snapshotKey])

  // Flush immediately when the tab is hidden / window is closing
  useEffect(() => {
    function flush() {
      if (!restoreResolvedRef.current) return
      if (document.visibilityState === 'hidden') {
        void saveSnapshot(snapshotKey, projectRef.current).catch(() => {})
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
    if (process.env.NODE_ENV === 'development') {
      (window as unknown as { __daw?: DawEngine }).__daw = engineRef.current ?? undefined
    }
  }, [engineForRender, project.presets])


  useEffect(() => { projectRef.current = project }, [project])

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
      historyRef.current = [...historyRef.current.slice(-(UNDO_LIMIT - 1)), { before: projectRef.current, action }]
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

  // Dev-only: expose dispatch + a project/history snapshot so a genuine build
  // session can be driven and recorded (the History capture mode then replays
  // what actually happened — edits and refinements included).
  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return
    const w = window as unknown as {
      __dawDispatch?: typeof dispatch
      __dawSnapshot?: () => { project: DawProject; history: NonNullable<DawProject['history']> }
      __dawInspect?: () => unknown
      __dawRenderWav?: (opts?: Parameters<DawEngine['renderWav']>[0]) => Promise<unknown>
      __dawRenderOffline?: (opts?: { startBeat?: number; endBeat?: number }) => Promise<unknown>
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
  const [position, setPositionState] = useState(0)
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

  // RAF loop: update positionBeatRef every frame, flush to state every ~100ms.
  // Only runs while the transport is playing — when stopped, the playhead only
  // moves via explicit seeks (setPosition), so the loop would be pure waste.
  const positionBeatRef = useRef(0)
  useEffect(() => {
    if (!playing) {
      // One final flush so the paused playhead reflects the stop position.
      positionBeatRef.current = engineRef.current!.currentBeat
      setPositionState(positionBeatRef.current)
      return
    }
    let lastFlush = 0
    let raf: number

    function frame(now: number) {
      positionBeatRef.current = engineRef.current!.currentBeat
      if (now - lastFlush > 100) {
        setPositionState(positionBeatRef.current)
        lastFlush = now
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [playing])

  const setPosition = useCallback((b: number) => {
    engineRef.current!.seek(b)
    positionBeatRef.current = b
    setPositionState(b)
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
  const [apolloRack, setApolloRack] = useState<{ trackId: string; seed: unknown; follow?: boolean } | null>(null)

  // Dev console access to the multi-selection (window.__dawSelection)
  useEffect(() => {
    if (process.env.NODE_ENV === 'development') {
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

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
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
        if (engine.isRecording) {
          void engine.stopRecording()
        } else {
          void engine.startRecording()
        }
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

      // Undo/redo revert only the popped action's own footprint (computed
      // against CURRENT state, so collaborators' concurrent edits survive)
      // and broadcast the patch so the room follows instead of self-healing
      // the undo away.
      if ((e.metaKey || e.ctrlKey) && e.code === 'KeyZ' && !e.shiftKey) {
        e.preventDefault()
        const entry = historyRef.current.pop()
        if (entry) {
          redoRef.current = [...redoRef.current.slice(-(UNDO_LIMIT - 1)), { before: projectRef.current, action: entry.action }]
          const patch = computeRevertPatch(entry.before, projectRef.current, entry.action)
          const patchAction: DawAction = { type: 'PATCH_PROJECT', patch }
          rawDispatch(patchAction)
          if (!isRemoteRef.current) broadcastRef.current?.(patchAction)
        }
        return
      }

      if ((e.metaKey || e.ctrlKey) && e.code === 'KeyZ' && e.shiftKey) {
        e.preventDefault()
        const entry = redoRef.current.pop()
        if (entry) {
          historyRef.current = [...historyRef.current.slice(-(UNDO_LIMIT - 1)), { before: projectRef.current, action: entry.action }]
          const patch = computeRevertPatch(entry.before, projectRef.current, entry.action)
          const patchAction: DawAction = { type: 'PATCH_PROJECT', patch }
          rawDispatch(patchAction)
          if (!isRemoteRef.current) broadcastRef.current?.(patchAction)
        }
        return
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
  }, [setPosition])

  // ── Context value ────────────────────────────────────────────────────────────
  const contextValue = useMemo(() => ({
    project,
    dispatch,
    engine: engineForRender,
    // Live construction log (this session's edits) for the History capture mode,
    // so replay works without a save+reopen round-trip.
    getBuildHistory: () => buildLogRef.current,
    consolidateBuildHistory,
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
    position,
    setPosition,
    metronome,
    setMetronome,
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
    playing, recording, position, setPosition, metronome, showPads,
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
  ], [view, isPodcast, props.onSave, props.readOnly])

  // ── Render ───────────────────────────────────────────────────────────────────
  const editorContent = (
    <DawContext.Provider value={contextValue}>
      <div
        data-editor="true"
        data-editor-kind="audio"
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          backgroundColor: 'var(--bg-base)',
          backgroundImage: 'var(--workshop-pattern, none)',
          backgroundSize: 'var(--workshop-pattern-size, auto)',
          overflow: 'hidden',
        }}
      >
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
          {/* Left sidebar: file-cabinet rail + collapsible panel */}
          <div style={{ display: 'flex', flexShrink: 0, borderRight: '1px solid var(--border)' }}>

            {/* Rail — always visible */}
            <div style={{
              width: 40, flexShrink: 0,
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', paddingTop: 8, gap: 2,
              background: 'var(--bg-surface)',
              borderRight: sidebarOpen ? '1px solid var(--border)' : 'none',
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
              {/* Return to the projects list. (The sidebar still opens from the
                  Sound Library / Code tab buttons just below.) */}
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

            {/* Collapsible panel */}
            <div style={{
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
                  background: 'rgba(124,58,237,0.15)', border: '1px solid rgba(124,58,237,0.5)', color: '#a78bfa',
                }}>
                  ✎ Suggesting — edits are local until the owner accepts
                  <button onClick={() => void submitSuggestion()} disabled={submittingSuggestion}
                    style={{ fontSize: 10, fontWeight: 700, padding: '2px 9px', borderRadius: 999, cursor: 'pointer', border: 'none', background: '#7c3aed', color: '#fff', opacity: submittingSuggestion ? 0.6 : 1 }}>
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
      {apolloRack && (
        <ApolloRackWindow
          trackId={apolloRack.trackId}
          seed={apolloRack.seed}
          trackName={project.tracks.find(t => t.id === apolloRack.trackId)?.name ?? 'Track'}
          following={!!apolloRack.follow}
          onToggleFollow={() => setApolloRack({ ...apolloRack, follow: !apolloRack.follow })}
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
      )}
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
                      return rt ? <span style={{ fontSize: 10, color: '#a78bfa', marginLeft: 8, borderLeft: `2px solid ${rt.color}`, paddingLeft: 6 }}>{rt.name} — FX</span> : null
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
                        style={{ marginLeft: 8, background: showPads ? 'var(--accent)' : 'transparent', border: showPads ? '1px solid var(--accent)' : '1px solid var(--border)', borderRadius: 4, color: showPads ? '#fff' : 'var(--text-muted)', cursor: 'pointer', fontSize: 11, padding: '2px 8px' }}
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
      {restorePrompt && (
        <div className="electron-nodrag" style={{
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
      )}

      {/* Collab lock notice */}
      {lockNotice && (
        <div role="status" style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 1200,
          display: 'flex', alignItems: 'center', gap: 8, padding: '9px 16px', borderRadius: 999,
          background: 'var(--bg-card)', border: '1px solid rgba(245,158,11,0.5)', color: '#facc15',
          fontSize: 12.5, fontWeight: 600, boxShadow: '0 8px 30px rgba(0,0,0,0.5)', whiteSpace: 'nowrap',
        }}>🔒 {lockNotice} is editing this clip — it’s locked while they’re in it.</div>
      )}

      {/* Suggestion sent */}
      {suggestSent && (
        <div role="status" style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 1200,
          display: 'flex', alignItems: 'center', gap: 8, padding: '9px 16px', borderRadius: 999,
          background: 'var(--bg-card)', border: '1px solid #166534', color: '#4ade80',
          fontSize: 12.5, fontWeight: 600, boxShadow: '0 8px 30px rgba(0,0,0,0.5)', whiteSpace: 'nowrap',
        }}>✓ Suggestion sent — the owner can review and accept it.</div>
      )}

      {/* Sync status toast */}
      {syncMsg && (
        <div role="status" style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 1200,
          display: 'flex', alignItems: 'center', gap: 8, padding: '9px 16px', borderRadius: 999,
          background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-secondary)',
          fontSize: 12.5, fontWeight: 600, boxShadow: '0 8px 30px rgba(0,0,0,0.5)', whiteSpace: 'nowrap',
        }}>↻ {syncMsg}</div>
      )}

      {/* Offline-sync conflict review — the per-item "Yours vs Theirs" panel
          (self-gates on the context's mergeConflicts). */}
      <MergeReview />

      {/* Save toast */}
      {(saveStatus === 'saved' || saveStatus === 'error') && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 100,
          display: 'flex', flexDirection: 'column', gap: 2,
          padding: '10px 16px', borderRadius: 10,
          background: saveStatus === 'saved' ? 'var(--bg-card)' : '#250f0f',
          border: `1px solid ${saveStatus === 'saved' ? '#166534' : '#7f1d1d'}`,
          color: saveStatus === 'saved' ? '#4ade80' : '#f87171',
          fontSize: 13, fontWeight: 500,
          boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
          maxWidth: 320,
        }}>
          {saveStatus === 'saved' ? '✓ Project saved' : '✗ Save failed'}
          {saveStatus === 'error' && saveError && (
            <span style={{ fontSize: 11, fontWeight: 400, opacity: 0.8, wordBreak: 'break-word' }}>{saveError}</span>
          )}
        </div>
      )}
    </DawContext.Provider>
  )

  return <WorkshopThemeProvider><UITierProvider>{editorContent}</UITierProvider></WorkshopThemeProvider>
}
