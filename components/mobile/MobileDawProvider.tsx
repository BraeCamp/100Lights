'use client'

// Supplies the FULL DawContextValue the desktop feature components consume, so
// the real ArrangementView / Mixer / SessionView / PianoRoll / StepSequencer /
// InstrumentPicker / DeviceChain / PadInput all run on mobile unchanged — we
// only change the layout around them. Owns the reducer + one DawEngine.

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { DawContext, reducer, type DawContextValue, type DawAction } from '@/lib/daw-state'
import { DawEngine } from '@/lib/daw-engine'
import { getPresets } from '@/lib/midi-presets'
import { seedProject } from './daw/seed'
import type { DawProject, DawView, EditTarget, CollabPeer } from '@/lib/daw-types'

export function MobileDawProvider({ children, initialProject, onSave, isSaving, isGuest }: {
  children: React.ReactNode
  initialProject?: DawProject
  onSave?: () => void | Promise<void>
  isSaving?: boolean
  isGuest?: boolean
}) {
  const [project, dispatch] = useReducer(reducer, undefined, () => initialProject ?? seedProject())

  // ── Undo / redo ──────────────────────────────────────────────────────────
  // The mobile provider had no history. Snapshot the project before each
  // mutating dispatch (projects are immutable, so snapshots are cheap refs) and
  // let undo/redo swap back via LOAD_PROJECT. Transport/UI state isn't in the
  // reducer, so every dispatch here is a real project edit worth undoing.
  const projectRef = useRef(project)
  useEffect(() => { projectRef.current = project }, [project])
  const undoRef = useRef<DawProject[]>([])
  const redoRef = useRef<DawProject[]>([])
  const [histTick, setHistTick] = useState(0)
  const NO_HISTORY = useMemo(() => new Set<DawAction['type']>(['LOAD_PROJECT', 'SET_MASTER_VOLUME']), [])
  const historyDispatch = useCallback((action: DawAction) => {
    if (!NO_HISTORY.has(action.type)) {
      undoRef.current.push(projectRef.current)
      if (undoRef.current.length > 80) undoRef.current.shift()
      redoRef.current = []
      setHistTick(t => t + 1)
    }
    dispatch(action)
  }, [NO_HISTORY])
  const undo = useCallback(() => {
    const prev = undoRef.current.pop()
    if (!prev) return
    redoRef.current.push(projectRef.current)
    dispatch({ type: 'LOAD_PROJECT', project: prev })
    setHistTick(t => t + 1)
  }, [])
  const redo = useCallback(() => {
    const next = redoRef.current.pop()
    if (!next) return
    undoRef.current.push(projectRef.current)
    dispatch({ type: 'LOAD_PROJECT', project: next })
    setHistTick(t => t + 1)
  }, [])

  const engineRef = useRef<DawEngine | null>(null)
  if (engineRef.current === null || engineRef.current.isClosed) engineRef.current = new DawEngine()
  const engine = engineRef.current

  // StrictMode's throwaway unmount disposes the engine (see the dispose effect
  // below), closing its AudioContext. The render-time guard above only revives
  // it on the *next* render — but an idle provider never re-renders, so the
  // closed engine lingers and playback stays silent ("play does nothing"). This
  // effect runs after every commit: if the engine is closed, it makes a fresh
  // one and forces a re-render so every consumer (and the effects below) rebind
  // to the live engine.
  const [, bumpEngine] = useReducer((x: number) => x + 1, 0)
  useEffect(() => {
    if (engineRef.current?.isClosed) { engineRef.current = new DawEngine(); bumpEngine() }
  })

  // transport
  const [playing, setPlaying] = useState(false)
  const [recording, setRecording] = useState(false)
  const [position, setPositionState] = useState(0)
  const [metronome, setMetronomeState] = useState(false)

  // ephemeral UI selection state the components read
  const [view, setView] = useState<DawView>('arrangement')
  const [editTarget, setEditTarget] = useState<EditTarget>(null)
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null)
  const [selectedReturnId, setSelectedReturnId] = useState<string | null>(null)
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null)
  const [selectedClipIds, setSelectedClipIds] = useState<Set<string>>(new Set())
  const [soundPanel, setSoundPanel] = useState<{ x: number; y: number } | null>(null)
  const [selectedEffectIds, setSelectedEffectIds] = useState<Set<string>>(new Set())
  const [showPads, setShowPads] = useState(false)
  const [expandedPianoRollClipId, setExpandedPianoRollClipId] = useState<string | null>(null)
  const [expandedStepSeqClipId, setExpandedStepSeqClipId] = useState<string | null>(null)
  const [loopToolArmed, setLoopToolArmed] = useState(false)
  const [blinkIds] = useState<Set<string>>(new Set())
  const [collabPeers] = useState<CollabPeer[]>([])

  useEffect(() => { engine.setPresets(getPresets()) }, [engine])
  useEffect(() => { engine.updateProject(project) }, [project, engine])
  useEffect(() => () => { engineRef.current?.dispose() }, [])

  useEffect(() => {
    const onTransport = (e: Event) => setPlaying(!!(e as CustomEvent).detail?.playing)
    const onRecording = (e: Event) => setRecording(!!(e as CustomEvent).detail?.recording)
    engine.addEventListener('transport', onTransport)
    engine.addEventListener('recording', onRecording)
    return () => { engine.removeEventListener('transport', onTransport); engine.removeEventListener('recording', onRecording) }
  }, [engine])

  useEffect(() => {
    if (!playing) return
    let raf = 0
    const tick = () => { setPositionState(engine.currentBeat); raf = requestAnimationFrame(tick) }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, engine])

  const setPosition = useCallback((b: number) => { engine.seek(b); setPositionState(b) }, [engine])
  const setMetronome = useCallback((on: boolean) => { engine.setMetronome(on); setMetronomeState(on) }, [engine])
  const triggerBlink = useCallback(() => { /* no-op on mobile */ }, [])

  const ctx: DawContextValue = useMemo(() => ({
    project, dispatch: historyDispatch, engine,
    undo, redo, canUndo: undoRef.current.length > 0, canRedo: redoRef.current.length > 0,
    view, setView, editTarget, setEditTarget,
    selectedTrackId, setSelectedTrackId, selectedReturnId, setSelectedReturnId,
    selectedClipId, setSelectedClipId, selectedClipIds, setSelectedClipIds,
    soundPanel, setSoundPanel, selectedEffectIds, setSelectedEffectIds,
    showPads, setShowPads,
    expandedPianoRollClipId, setExpandedPianoRollClipId,
    expandedStepSeqClipId, setExpandedStepSeqClipId,
    loopToolArmed, setLoopToolArmed,
    playing, recording, position, setPosition, metronome, setMetronome,
    onSave, isSaving: !!isSaving, isGuest: !!isGuest,
    requireAccount: () => {}, resumeExport: false, clearResumeExport: () => {},
    audioMode: 'music',
    blinkIds, triggerBlink, collabPeers,
    mergeConflicts: null,
  }), [
    project, historyDispatch, undo, redo, histTick, engine, view, editTarget, selectedTrackId, selectedReturnId, selectedClipId, selectedClipIds,
    soundPanel, selectedEffectIds, showPads, expandedPianoRollClipId, expandedStepSeqClipId, loopToolArmed,
    playing, recording, position, setPosition, metronome, setMetronome, onSave, isSaving, isGuest, blinkIds, triggerBlink, collabPeers,
  ])

  return <DawContext.Provider value={ctx}>{children}</DawContext.Provider>
}
