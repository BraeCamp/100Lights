'use client'

import { useState, useEffect, useReducer, useRef, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useUser } from '@clerk/nextjs'
import { computeRevertPatch } from '@/lib/daw-undo'
import dynamic from 'next/dynamic'
import type { DawView, EditTarget, DawProject, DawTrack } from '@/lib/daw-types'
import { defaultProject, TRACK_COLORS, DEFAULT_TRACK_HEIGHT, defaultTrackInstrument, voiceChainEffects } from '@/lib/daw-types'
import type { DawAction } from '@/lib/daw-state'
import { DawContext, reducer, makeAudioClip, migrateProject, useDaw } from '@/lib/daw-state'
import { InspectorBridge } from './daw/InspectorBridge'
import { DuplicateCleanup } from './daw/DuplicateCleanup'
import { Library, Settings, FileText, Users } from 'lucide-react'
import { DawEngine } from '@/lib/daw-engine'
import type { CollabPeer } from '@/lib/daw-types'
import { uploadRecordingBlob } from '@/lib/record-upload'
import type { AudioTrackInit, ModuleKey } from '@/lib/editor-types'
import type { PodcastMeta } from '@/lib/project-serializer'
import type { Caption } from '@/lib/types'
import { captureAudioInput } from '@/lib/audio-capture'
import { monitorFxParams } from '@/lib/daw-engine'
import type { AudioInputSource } from '@/lib/audio-capture'
import Transport from './daw/Transport'
import HelpButton from './daw/HelpButton'
import { InspectButton } from './daw/InspectMode'
import PracticeButton from './daw/PracticeButton'
import { VUMeter } from './daw/TrackRow'
import SoundLibraryPanel from './SoundLibrary'
import GuestPanel from './daw/GuestPanel'
import { saveSnapshot, loadSnapshot, deleteSnapshot } from '@/lib/offline-store'
import { getPresets } from '@/lib/midi-presets'

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
  captions?: Caption[]
  currentTime?: number
  onTimeChange?: (t: number) => void
  onProjectNameCommit?: (name: string) => void
  onSave?: (tracks: AudioTrack[], meta?: { audioMode?: 'music' | 'podcast'; podcastMeta?: PodcastMeta; dawProject?: import('@/lib/daw-types').DawProject }) => Promise<void>
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
        border: '1px solid #2e2e2e',
        background: 'rgba(61,143,239,0.08)', color: '#7ab4f5',
        cursor: busy ? 'wait' : 'pointer', fontWeight: 600, whiteSpace: 'nowrap', flexShrink: 0,
      }}
    >
      <span style={{ fontSize: 11 }}>⊕</span>
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
                  background: track.inputSource ? 'rgba(61,143,239,0.15)' : 'var(--bg-surface)',
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
                style={{ width: '100%', fontSize: 11, padding: '3px 5px', marginTop: 4, background: '#111', border: '1px solid var(--border)', color: 'var(--text-primary)', borderRadius: 3, outline: 'none', cursor: 'pointer' }}
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
              style={{ fontSize: 11, padding: '4px 10px', borderRadius: 4, border: '1px solid var(--accent)', background: 'rgba(61,143,239,0.15)', color: 'var(--accent-light)', cursor: 'pointer', width: '100%' }}
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

export default function AudioEditor(props: AudioEditorProps) {
  const { initialTracks, onSave, onProjectNameCommit } = props
  const isPodcast = props.audioMode === 'podcast'

  const initialProject = useMemo(
    () => {
      if (props.initialDawProject) return props.initialDawProject
      if (initialTracks?.length) return buildInitialProject(initialTracks)
      if (isPodcast) return buildPodcastProject()
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
  const historyRef = useRef<Array<{ before: DawProject; action: DawAction }>>([])
  const redoRef    = useRef<Array<{ before: DawProject; action: DawAction }>>([])
  const projectRef         = useRef(project)
  const selectedTrackIdRef = useRef<string | null>(null)
  const voiceChainAppliedRef = useRef(false)

  // ── Collab broadcast refs ────────────────────────────────────────────────────
  const broadcastRef  = useRef<((action: DawAction) => void) | null>(null)
  const isRemoteRef   = useRef(false)

  // Actions that shouldn't be synced to collaborators (view/UI preferences)
  // Loop region/toggle are deliberately local: each collaborator loops their
  // own playback without yanking everyone else's transport around.
  const NO_BROADCAST = new Set<DawAction['type']>(['LOAD_PROJECT', 'SET_WAVEFORM_ZOOM', 'SET_CROSSFADER', 'SET_LOOP', 'SET_LOOP_ENABLED'])

  // ── Blink guidance — local only, never broadcast ─────────────────────────────
  const [blinkIds, setBlinkIds] = useState<Set<string>>(new Set())
  const triggerBlink = useCallback((ids: string[]) => {
    setBlinkIds(new Set(ids))
    setTimeout(() => setBlinkIds(new Set()), 1400)
  }, [])

  // ── Offline persistence — IndexedDB autosave + crash/offline recovery ───────
  const snapshotKey = props.projectId ?? `unsaved:${props.audioMode ?? 'music'}`
  const [restorePrompt, setRestorePrompt] = useState<{ savedAt: number; project: DawProject } | null>(null)
  const [isOffline, setIsOffline] = useState(false)
  const restoreResolvedRef = useRef(false)
  const autosaveTimerRef = useRef<number | null>(null)

  // Offer to restore a local snapshot that never made it to the server
  useEffect(() => {
    let cancelled = false
    loadSnapshot(snapshotKey)
      .then(rec => {
        if (cancelled) return
        const differs = rec && JSON.stringify(rec.project) !== JSON.stringify(projectRef.current)
        if (rec && !rec.synced && differs) {
          setRestorePrompt({ savedAt: rec.savedAt, project: rec.project })
        } else {
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
    if (autosaveTimerRef.current !== null) window.clearTimeout(autosaveTimerRef.current)
    autosaveTimerRef.current = window.setTimeout(() => {
      void saveSnapshot(snapshotKey, projectRef.current).catch(() => {})
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

  // Online / offline indicator
  useEffect(() => {
    setIsOffline(!navigator.onLine)
    const on = () => setIsOffline(false)
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
    engineForRender.setPresets(getPresets())
    // Dev console access to the live engine (window.__daw)
    if (process.env.NODE_ENV === 'development') {
      (window as unknown as { __daw?: DawEngine }).__daw = engineRef.current ?? undefined
    }
  }, [engineForRender])


  useEffect(() => { projectRef.current = project }, [project])

  const readOnlyRef = useRef(!!props.readOnly)
  useEffect(() => { readOnlyRef.current = !!props.readOnly }, [props.readOnly])

  // Collab attribution: stamp who created clips (dispatch-time, so the stamp
  // travels with the broadcast and every client stores the same author)
  const { user } = useUser()
  const userNameRef = useRef<string>('')
  useEffect(() => { userNameRef.current = user?.firstName || user?.username || '' }, [user])

  const dispatch = useCallback((action: DawAction) => {
    // View-only collaborators: their room access is read-only server-side, so
    // local edits would silently diverge from the real project. Drop them here
    // instead — the UI stays a live mirror. (LOAD_PROJECT still applies: it
    // carries the room's state to us.)
    if (readOnlyRef.current && action.type !== 'LOAD_PROJECT') return
    // Reducers must be deterministic for collaboration: actions that create
    // entities carry their ids, otherwise each client mints a different one
    // and every later edit to that entity diverges across the room.
    if (action.type === 'ADD_TRACK' && !action.id) action = { ...action, id: crypto.randomUUID() }
    if (action.type === 'ADD_SCENE' && !action.id) action = { ...action, id: crypto.randomUUID() }
    if (action.type === 'DUPLICATE_TRACK' && !action.seed) action = { ...action, seed: crypto.randomUUID() }
    if (action.type === 'ADD_CLIP' && !action.clip.createdBy && userNameRef.current) {
      action = { ...action, clip: { ...action.clip, createdBy: userNameRef.current } }
    }
    if (action.type !== 'LOAD_PROJECT') {
      historyRef.current = [...historyRef.current.slice(-49), { before: projectRef.current, action }]
      redoRef.current = []
    }
    rawDispatch(action)
    if (!isRemoteRef.current && !NO_BROADCAST.has(action.type)) {
      broadcastRef.current?.(action)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

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
          dispatch({ type: 'ADD_CLIP_EFFECT', effect: {
            id: crypto.randomUUID(), trackId, type: fx.type,
            startBeat: placed, durationBeats: dur, row: i,
            params: monitorFxParams(fx),
          } })
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
        dispatch({ type: 'ADD_CLIP_EFFECT', effect: {
          id: crypto.randomUUID(), trackId, type: fx.type,
          startBeat, durationBeats, row: i,
          params: monitorFxParams(fx),
        } })
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

  // RAF loop: update positionBeatRef every frame, flush to state every ~100ms
  const positionBeatRef = useRef(0)
  useEffect(() => {
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
  }, [])

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

  const [view, setView] = useState<DawView>('arrangement')
  const [editTarget, setEditTarget] = useState<EditTarget>(null)
  const [selectedTrackId_,  setSelectedTrackId_]  = useState<string | null>(null)
  const [selectedReturnId_, setSelectedReturnId_] = useState<string | null>(null)
  useEffect(() => { selectedTrackIdRef.current = selectedTrackId_ }, [selectedTrackId_])
  const selectedTrackId  = selectedTrackId_
  const selectedReturnId = selectedReturnId_
  const setSelectedTrackId  = useCallback((id: string | null) => { setSelectedTrackId_(id);  if (id) setSelectedReturnId_(null) }, [])
  const setSelectedReturnId = useCallback((id: string | null) => { setSelectedReturnId_(id); if (id) setSelectedTrackId_(null)  }, [])
  const [selectedClipId,  setSelectedClipId]  = useState<string | null>(null)
  const [selectedClipIds, setSelectedClipIds] = useState<Set<string>>(new Set())

  // Dev console access to the multi-selection (window.__dawSelection)
  useEffect(() => {
    if (process.env.NODE_ENV === 'development') {
      (window as unknown as { __dawSelection?: string[] }).__dawSelection = [...selectedClipIds]
    }
  })
  const [selectedEffectIds, setSelectedEffectIds] = useState<Set<string>>(new Set())
  const [bottomTab, setBottomTab] = useState<'devices' | 'instrument'>('devices')
  const [leftTab,     setLeftTab]     = useState<'library' | 'episode' | 'setup' | 'guests'>(isPodcast ? 'setup' : 'library')
  const [sidebarOpen, setSidebarOpen] = useState(true)

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
            stretchNotes: true, rootNote: 0, presetId: defaultPresetId() ?? undefined,
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
  useEffect(() => { selectedClipIdRef.current  = selectedClipId },  [selectedClipId])
  useEffect(() => { selectedClipIdsRef.current = selectedClipIds }, [selectedClipIds])

  const handleSaveRef = useRef(async () => {})
  useEffect(() => {
    handleSaveRef.current = async () => {
      if (!onSaveRef.current) return
      setIsSaving(true)
      try {
        const p = projectRef.current
        const tracks: AudioTrack[] = p.tracks
          .filter(t => t.type === 'audio')
          .map(t => {
            const clip = p.arrangementClips.find(c => c.trackId === t.id && c.kind === 'audio')
            const audioClip = clip?.kind === 'audio' ? clip : undefined
            return {
              id: t.id,
              name: t.name,
              url: audioClip?.audioUrl ?? '',
              duration: audioClip ? audioClip.durationBeats * (60 / p.tempo) : 0,
              r2Key: audioClip?.r2Key,
            } satisfies AudioTrack
          })
        // Persist the full arrangement. Blob URLs are browser-local — strip
        // them; clips keep their r2Key (eager upload) and resolve audio on load.
        const stripUrl = <C,>(c: C & { kind: string; audioUrl?: string }): C =>
          c.kind === 'audio' && c.audioUrl?.startsWith('blob:') ? { ...c, audioUrl: undefined } : c
        const dawProject = {
          ...p,
          arrangementClips: p.arrangementClips.map(stripUrl),
          sessionGrid: Object.fromEntries(Object.entries(p.sessionGrid).map(([tid, row]) =>
            [tid, row.map(c => (c ? stripUrl(c) : c))])),
        }
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
          redoRef.current = [...redoRef.current.slice(-49), { before: projectRef.current, action: entry.action }]
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
          historyRef.current = [...historyRef.current.slice(-49), { before: projectRef.current, action: entry.action }]
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
    loopToolArmed,
    setLoopToolArmed,
    onSave: onSave ? () => handleSaveRef.current() : undefined,
    isSaving,
    audioMode: props.audioMode,
    podcastMeta,
    blinkIds,
    triggerBlink,
    collabPeers,
  }), [
    engineForRender,
    project, dispatch, view, editTarget, selectedTrackId, selectedReturnId, selectedClipId, selectedClipIds,
    selectedEffectIds,
    playing, recording, position, setPosition, metronome, showPads,
    expandedPianoRollClipId, loopToolArmed, onSave, isSaving, podcastMeta, blinkIds, triggerBlink,
    collabPeers,
  ])

  // ── Render ───────────────────────────────────────────────────────────────────
  const editorContent = (
    <DawContext.Provider value={contextValue}>
      <div
        data-editor="true"
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          background: 'var(--bg-base)',
          overflow: 'hidden',
        }}
      >
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
          />
        )}
        <Transport />

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
              {!isPodcast ? (
                <button
                  onClick={() => setSidebarOpen(v => !v)}
                  title="Sound Library"
                  data-help-id="sound-library"
                  style={{
                    width: 28, height: 28, borderRadius: 6, border: 'none', cursor: 'pointer',
                    background: sidebarOpen ? 'rgba(99,102,241,0.12)' : 'transparent',
                    color: sidebarOpen ? 'var(--accent)' : 'var(--text-muted)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'background 0.12s, color 0.12s',
                  }}
                >
                  <Library size={14} />
                </button>
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
                        background: isActive ? 'rgba(99,102,241,0.12)' : 'transparent',
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
            </div>

            {/* Collapsible panel */}
            <div style={{
              width: sidebarOpen ? 240 : 0,
              flexShrink: 0,
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              transition: 'width 0.15s ease',
              background: 'var(--bg-surface)',
            }}>
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
                <SoundLibraryPanel embedded={true} />
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
              {props.readOnly && (
                <span style={{
                  display: 'flex', alignItems: 'center', gap: 6, fontSize: 10.5, fontWeight: 700,
                  padding: '3px 12px', borderRadius: 999, whiteSpace: 'nowrap',
                  background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.45)', color: '#f59e0b',
                }}>
                  👁 View only — upgrade to Pro to edit shared projects
                </span>
              )}
              <InspectorBridge />
              <DuplicateCleanup />
              <PracticeButton />
              <InspectButton />
              <HelpButton />
            </div>

            {/* Active view */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
              {view === 'session' && <SessionView />}
              {view === 'arrangement' && <ArrangementView />}
              {view === 'mixer' && <Mixer />}
            </div>

            {/* Piano roll is now rendered inline under each track in TrackRow */}

            {/* Device chain / instrument panel — shown when a track or return is selected */}
            {(selectedTrackId !== null || selectedReturnId !== null) && (
              <div style={{ flexShrink: 0, borderTop: '1px solid var(--border)', background: 'var(--bg-base)' }}>
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
                      >⌨ Pads</button>
                    ) : null
                  })()}
                  <button
                    onClick={() => { setSelectedTrackId(null); setSelectedReturnId(null) }}
                    style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: '0 4px' }}
                    title="Close panel"
                  >×</button>
                </div>
                {/* Panel content */}
                <div style={{ maxHeight: bottomTab === 'instrument' ? 320 : 200, overflowY: 'auto', overflowX: 'auto' }}>
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
          background: '#1c1c26', border: '1px solid #3d8fef',
          boxShadow: '0 8px 32px rgba(0,0,0,0.6)', maxWidth: 520,
        }}>
          <div style={{ fontSize: 12, color: 'var(--text-primary)', lineHeight: 1.5 }}>
            <strong>Unsaved session recovered</strong>
            <span style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)' }}>
              Local backup from {new Date(restorePrompt.savedAt).toLocaleString()} — restore it?
            </span>
          </div>
          <button onClick={handleRestore} style={{
            fontSize: 12, fontWeight: 600, padding: '6px 14px', borderRadius: 6, cursor: 'pointer',
            border: '1px solid #3d8fef', background: 'rgba(61,143,239,0.18)', color: '#7ab5f7', whiteSpace: 'nowrap',
          }}>Restore</button>
          <button onClick={handleDiscardRestore} style={{
            fontSize: 12, padding: '6px 12px', borderRadius: 6, cursor: 'pointer',
            border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', whiteSpace: 'nowrap',
          }}>Discard</button>
        </div>
      )}

      {/* Save toast */}
      {(saveStatus === 'saved' || saveStatus === 'error') && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 100,
          display: 'flex', flexDirection: 'column', gap: 2,
          padding: '10px 16px', borderRadius: 10,
          background: saveStatus === 'saved' ? '#18251a' : '#250f0f',
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

  return editorContent
}
