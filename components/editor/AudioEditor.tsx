'use client'

import { useState, useEffect, useReducer, useRef, useCallback, useMemo } from 'react'
import dynamic from 'next/dynamic'
import type { DawView, EditTarget, DawProject, DawTrack } from '@/lib/daw-types'
import { defaultProject, TRACK_COLORS, DEFAULT_TRACK_HEIGHT, defaultTrackInstrument } from '@/lib/daw-types'
import type { DawAction } from '@/lib/daw-state'
import { DawContext, reducer, makeAudioClip, migrateProject } from '@/lib/daw-state'
import { DawEngine } from '@/lib/daw-engine'
import type { AudioTrackInit, ModuleKey } from '@/lib/editor-types'
import type { Caption } from '@/lib/types'
import Transport from './daw/Transport'
import SoundLibraryPanel from './SoundLibrary'

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
  onSave?: (tracks: AudioTrack[]) => Promise<void>
  hideHeader?: boolean
  activeModules?: ModuleKey[]
  onModulesChange?: (modules: ModuleKey[]) => void
}

// ── Lazy view imports ─────────────────────────────────────────────────────────

const SessionView = dynamic(() => import('./daw/SessionView'), { ssr: false })
const ArrangementView = dynamic(() => import('./daw/ArrangementView'), { ssr: false })
const Mixer = dynamic(() => import('./daw/Mixer'), { ssr: false })
const PianoRoll = dynamic(() => import('./daw/PianoRoll'), { ssr: false })
const DeviceChain = dynamic(() => import('./daw/DeviceChain'), { ssr: false })
const InstrumentPicker = dynamic(() => import('./daw/InstrumentPicker'), { ssr: false })

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

// ── Main component ────────────────────────────────────────────────────────────

export default function AudioEditor(props: AudioEditorProps) {
  const { initialTracks, onSave, onProjectNameCommit } = props

  const initialProject = useMemo(
    () => (initialTracks?.length ? buildInitialProject(initialTracks) : defaultProject()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  const [project, rawDispatch] = useReducer(reducer, initialProject)
  const engineRef = useRef<DawEngine | null>(null)
  // Create engine on first render; re-create if StrictMode disposed it
  if (engineRef.current === null || engineRef.current.isClosed) {
    engineRef.current = new DawEngine()
  }

  // ── Undo history ────────────────────────────────────────────────────────────
  const historyRef = useRef<DawProject[]>([])
  const projectRef = useRef(project)
  useEffect(() => { projectRef.current = project }, [project])

  const dispatch = useCallback((action: DawAction) => {
    if (action.type !== 'LOAD_PROJECT') {
      historyRef.current = [...historyRef.current.slice(-49), projectRef.current]
    }
    rawDispatch(action)
  }, [])

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
      setRecording((e as CustomEvent<{ recording: boolean }>).detail.recording)
    }

    engine.addEventListener('transport', onTransport)
    engine.addEventListener('recording', onRecording)
    return () => {
      engine.removeEventListener('transport', onTransport)
      engine.removeEventListener('recording', onRecording)
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
  const [view, setView] = useState<DawView>('arrangement')
  const [editTarget, setEditTarget] = useState<EditTarget>(null)
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null)
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null)
  const [bottomTab, setBottomTab] = useState<'devices' | 'instrument'>('devices')

  useEffect(() => { setBottomTab('devices') }, [selectedTrackId])

  // ── Keyboard shortcuts ──────────────────────────────────────────────────────
  const onSaveRef = useRef(onSave)
  useEffect(() => { onSaveRef.current = onSave }, [onSave])

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
        if (engine.isPlaying) {
          engine.stop()
        } else {
          engine.play()
        }
        return
      }

      if (e.code === 'KeyR') {
        e.preventDefault()
        if (engine.isRecording) {
          engine.stopRecording()
        } else {
          engine.startRecording()
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

      if ((e.metaKey || e.ctrlKey) && e.code === 'KeyS') {
        e.preventDefault()
        if (onSaveRef.current) {
          const p = projectRef.current
          const tracks: AudioTrack[] = p.tracks
            .filter(t => t.type === 'audio')
            .map(t => {
              const clip = p.arrangementClips.find(
                c => c.trackId === t.id && c.kind === 'audio'
              )
              const audioClip = clip?.kind === 'audio' ? clip : undefined
              return {
                id: t.id,
                name: t.name,
                url: audioClip?.audioUrl ?? '',
                duration: audioClip
                  ? audioClip.durationBeats * (60 / p.tempo)
                  : 0,
                r2Key: audioClip?.r2Key,
              } satisfies AudioTrack
            })
          onSaveRef.current(tracks)
        }
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [setPosition])

  // ── Context value ────────────────────────────────────────────────────────────
  const contextValue = useMemo(() => ({
    project,
    dispatch,
    engine: engineRef.current!,
    view,
    setView,
    editTarget,
    setEditTarget,
    selectedTrackId,
    setSelectedTrackId,
    selectedClipId,
    setSelectedClipId,
    playing,
    recording,
    position,
    setPosition,
    metronome,
    setMetronome,
  }), [
    project, dispatch, view, editTarget, selectedTrackId, selectedClipId,
    playing, recording, position, setPosition, metronome,
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
          {/* Sound Library sidebar */}
          <div style={{
            width: 240,
            flexShrink: 0,
            borderRight: '1px solid var(--border)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            background: 'var(--bg-surface)',
          }}>
            <SoundLibraryPanel embedded={true} />
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
              {(['session', 'arrangement', 'mixer'] as DawView[]).map(v => (
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

            {/* Piano roll panel — shown when a clip is open for editing */}
            {editTarget !== null && (
              <div style={{ height: 220, flexShrink: 0, borderTop: '1px solid var(--border)', background: 'var(--bg-surface)', overflow: 'hidden' }}>
                <PianoRoll />
              </div>
            )}

            {/* Device chain / instrument panel — shown when a track is selected */}
            {selectedTrackId !== null && (
              <div style={{ flexShrink: 0, borderTop: '1px solid var(--border)', background: 'var(--bg-base)' }}>
                {/* Tab bar */}
                <div style={{ height: 28, display: 'flex', alignItems: 'center', gap: 1, padding: '0 8px', background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)' }}>
                  {(['devices', 'instrument'] as const).map(tab => (
                    <button
                      key={tab}
                      onClick={() => setBottomTab(tab)}
                      style={{ background: bottomTab === tab ? 'var(--bg-card)' : 'transparent', border: bottomTab === tab ? '1px solid var(--border)' : '1px solid transparent', borderRadius: 4, color: bottomTab === tab ? 'var(--text-primary)' : 'var(--text-muted)', cursor: 'pointer', fontSize: 11, padding: '2px 10px', textTransform: 'capitalize' }}
                    >
                      {tab === 'devices' ? 'Devices' : 'Instrument'}
                    </button>
                  ))}
                  {/* Track name label */}
                  {(() => {
                    const t = project.tracks.find(tr => tr.id === selectedTrackId)
                    return t ? <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 8, borderLeft: `2px solid ${t.color}`, paddingLeft: 6 }}>{t.name}</span> : null
                  })()}
                  <button
                    onClick={() => setSelectedTrackId(null)}
                    style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: '0 4px' }}
                    title="Close panel"
                  >×</button>
                </div>
                {/* Panel content */}
                <div style={{ maxHeight: 180, overflowY: 'auto', overflowX: 'auto' }}>
                  {bottomTab === 'devices' && <DeviceChain trackId={selectedTrackId} />}
                  {bottomTab === 'instrument' && <InstrumentPicker trackId={selectedTrackId} />}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </DawContext.Provider>
  )
}
