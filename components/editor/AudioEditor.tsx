'use client'

import { useState, useEffect, useReducer, useRef, useCallback, useMemo } from 'react'
import dynamic from 'next/dynamic'
import type { DawView, EditTarget, DawProject, DawTrack } from '@/lib/daw-types'
import { defaultProject, TRACK_COLORS, DEFAULT_TRACK_HEIGHT, defaultTrackInstrument, voiceChainEffects } from '@/lib/daw-types'
import type { DawAction } from '@/lib/daw-state'
import { DawContext, reducer, makeAudioClip, migrateProject, useDaw } from '@/lib/daw-state'
import { DawEngine } from '@/lib/daw-engine'
import type { AudioTrackInit, ModuleKey } from '@/lib/editor-types'
import type { PodcastMeta } from '@/lib/project-serializer'
import type { Caption } from '@/lib/types'
import { captureAudioInput } from '@/lib/audio-capture'
import type { AudioInputSource } from '@/lib/audio-capture'
import Transport from './daw/Transport'
import { VUMeter } from './daw/TrackRow'
import SoundLibraryPanel from './SoundLibrary'
import GuestPanel from './daw/GuestPanel'
import { seedDefaultSamples } from '@/lib/default-samples'
import { getPresets } from '@/lib/midi-presets'

// ── Re-exports for backward compat (ProjectEditor imports these) ──────────────

export interface AudioTrack extends AudioTrackInit {
  url: string
}

export interface AudioEditorProps {
  projectId?: string
  projectName: string
  initialTracks?: AudioTrack[]
  captions?: Caption[]
  currentTime?: number
  onTimeChange?: (t: number) => void
  onProjectNameCommit?: (name: string) => void
  onSave?: (tracks: AudioTrack[], meta?: { audioMode?: 'music' | 'podcast'; podcastMeta?: PodcastMeta }) => Promise<void>
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

// ── Podcast Setup Panel ───────────────────────────────────────────────────────

type MicPermState = 'checking' | 'granted' | 'denied' | 'prompt' | 'unavailable'

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
  const historyRef = useRef<DawProject[]>([])
  const projectRef         = useRef(project)
  const selectedTrackIdRef = useRef<string | null>(null)
  const voiceChainAppliedRef = useRef(false)

  // ── Per-track external input recording ──────────────────────────────────────
  type InputRec = { recorder: MediaRecorder; startBeat: number; chunks: Blob[] }
  const inputRecsRef    = useRef<Map<string, InputRec>>(new Map())
  const inputStreamsRef = useRef<Map<string, MediaStream>>(new Map())
  // Seed default samples once per browser (no-op if already done)
  useEffect(() => { seedDefaultSamples().catch(() => {}) }, [])

  // Keep engine in sync with available MIDI presets
  useEffect(() => { engineRef.current?.setPresets(getPresets()) }, [])

  useEffect(() => { projectRef.current = project }, [project])

  const dispatch = useCallback((action: DawAction) => {
    if (action.type !== 'LOAD_PROJECT') {
      historyRef.current = [...historyRef.current.slice(-49), projectRef.current]
    }
    rawDispatch(action)
  }, [])

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
    engineRef.current?.updateProject(project)
  }, [project])

  useEffect(() => {
    return () => { engineRef.current?.dispose() }
  }, [])

  // ── Transport state ─────────────────────────────────────────────────────────
  const [playing, setPlaying] = useState(false)
  const [recording, setRecording] = useState(false)
  const [position, setPositionState] = useState(0)
  const [metronome, setMetronome] = useState(false)

  useEffect(() => {
    const engine = engineRef.current!

    const onTransport = (e: Event) => {
      setPlaying((e as CustomEvent<{ playing: boolean }>).detail.playing)
    }
    const onRecording = (e: Event) => {
      const rec = (e as CustomEvent<{ recording: boolean }>).detail.recording
      setRecording(rec)

      if (rec) {
        // Start a MediaRecorder for every armed audio track that has an inputSource set.
        // Tracks sharing the same source reuse one MediaStream (avoid double permission prompt).
        ;(async () => {
          const armed = projectRef.current.tracks.filter(
            t => t.type === 'audio' && t.armed
          )
          console.debug('[rec] onRecording(true) — armed audio tracks:', armed.map(t => t.name))
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
              console.debug('[rec] per-track recorder started for:', track.name, 'startBeat:', startBeat)
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
        const endBeat = engineRef.current!.currentBeat
        let pending = 0

        for (const { recorder } of inputRecsRef.current.values()) {
          if (recorder.state !== 'inactive') pending++
        }

        const cleanup = () => {
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
            console.debug('[rec] per-track onstop — trackId:', trackId, 'blobSize:', blob.size, 'chunks:', chunks.length, 'startBeat:', startBeat, 'endBeat:', endBeat)
            if (blob.size > 0) {
              const url = URL.createObjectURL(blob)
              const dur = Math.max(0.25, endBeat - startBeat)
              const track = projectRef.current.tracks.find(t => t.id === trackId)
              const clip  = makeAudioClip(
                trackId,
                `${track?.name ?? 'Input'} Recording`,
                startBeat, dur,
                { audioUrl: url },
              )
              dispatch({ type: 'ADD_CLIP', clip })
              console.debug('[rec] per-track clip dispatched:', clip.id, 'at beat', startBeat)
            }
            pending--
            if (pending === 0) cleanup()
          }
          recorder.stop()
        }
      }
    }

    const onRecordingComplete = (e: Event) => {
      const { blob, startBeat, durationBeats } = (e as CustomEvent<{ blob: Blob; startBeat: number; durationBeats: number }>).detail
      console.debug('[rec] onRecordingComplete — blobSize:', blob.size, 'startBeat:', startBeat, 'duration:', durationBeats)
      if (durationBeats < 0.1 || blob.size === 0) {
        console.debug('[rec] onRecordingComplete — skipped (too short or empty blob)')
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
      console.debug('[rec] onRecordingComplete — trackId:', trackId, 'audioTracks:', p.tracks.filter(t => t.type === 'audio').map(t => t.name))
      if (!trackId) return
      const clip = makeAudioClip(trackId, 'Recording', startBeat, durationBeats, { audioUrl: url })
      dispatch({ type: 'ADD_CLIP', clip })
      console.debug('[rec] master bus clip dispatched:', clip.id, 'at beat', startBeat)
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
  }, [])

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
  const [bottomTab, setBottomTab] = useState<'devices' | 'instrument'>('devices')
  const [leftTab,   setLeftTab]   = useState<'library' | 'episode' | 'setup' | 'guests'>(isPodcast ? 'setup' : 'library')
  const [showPads,  setShowPads]  = useState(false)
  const [isSaving,  setIsSaving]  = useState(false)
  const [saveStatus, setSaveStatus] = useState<'saved' | 'error' | null>(null)
  const [expandedPianoRollClipId, setExpandedPianoRollClipId] = useState<string | null>(null)

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
        await onSaveRef.current(tracks, { audioMode: props.audioMode, podcastMeta })
        setSaveStatus('saved')
        setTimeout(() => setSaveStatus(null), 2500)
      } catch {
        setSaveStatus('error')
        setTimeout(() => setSaveStatus(null), 4000)
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

      if ((e.metaKey || e.ctrlKey) && e.code === 'KeyZ' && !e.shiftKey) {
        e.preventDefault()
        const prev = historyRef.current.pop()
        if (prev) rawDispatch({ type: 'LOAD_PROJECT', project: prev })
        return
      }

      if (e.code === 'Delete' || e.code === 'Backspace') {
        const ids = selectedClipIdsRef.current
        if (ids.size > 0) {
          e.preventDefault()
          ids.forEach(id => dispatch({ type: 'REMOVE_CLIP', clipId: id }))
          setSelectedClipIds(new Set())
          setSelectedClipId(null)
        } else if (selectedClipIdRef.current) {
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
    onSave: onSave ? () => { void handleSaveRef.current() } : undefined,
    isSaving,
    audioMode: props.audioMode,
    podcastMeta,
  }), [
    engineForRender,
    project, dispatch, view, editTarget, selectedTrackId, selectedReturnId, selectedClipId, selectedClipIds,
    playing, recording, position, setPosition, metronome, showPads,
    expandedPianoRollClipId, onSave, isSaving, podcastMeta,
  ])

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
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
        <Transport />

        {/* Body */}
        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          {/* Left sidebar: Library (always) + Episode (podcast only) */}
          <div style={{
            width: 240,
            flexShrink: 0,
            borderRight: '1px solid var(--border)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            background: 'var(--bg-surface)',
          }}>
            {isPodcast && (
              <div style={{ display: 'flex', flexShrink: 0, borderBottom: '1px solid var(--border)', height: 30 }}>
                {(['setup', 'episode', 'guests'] as const).map((tab, i, arr) => (
                  <button
                    key={tab}
                    onClick={() => setLeftTab(tab)}
                    style={{
                      flex: 1, background: leftTab === tab ? 'var(--bg-card)' : 'transparent',
                      border: 'none', borderRight: i < arr.length - 1 ? '1px solid var(--border)' : 'none',
                      color: leftTab === tab ? 'var(--text-primary)' : 'var(--text-muted)',
                      fontSize: 11, cursor: 'pointer', fontWeight: leftTab === tab ? 500 : 400,
                    }}
                  >{tab === 'setup' ? 'Setup' : tab === 'episode' ? 'Episode' : 'Guests'}</button>
                ))}
              </div>
            )}
            {isPodcast && (
              <div style={{ display: 'flex', padding: '5px 8px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
                <button
                  onClick={handleAddGuest}
                  title="Add a new guest track with voice processing"
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
                    return t && t.type !== 'audio' ? (
                      <button
                        onClick={() => setShowPads(v => !v)}
                        title="Open pad / keyboard input"
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

      {/* Save toast */}
      {(saveStatus === 'saved' || saveStatus === 'error') && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 100,
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '10px 16px', borderRadius: 10,
          background: saveStatus === 'saved' ? '#18251a' : '#250f0f',
          border: `1px solid ${saveStatus === 'saved' ? '#166534' : '#7f1d1d'}`,
          color: saveStatus === 'saved' ? '#4ade80' : '#f87171',
          fontSize: 13, fontWeight: 500,
          boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
        }}>
          {saveStatus === 'saved' ? '✓ Project saved' : '✗ Save failed'}
        </div>
      )}
    </DawContext.Provider>
  )
}
