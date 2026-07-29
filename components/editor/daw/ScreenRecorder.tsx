'use client'

/**
 * Capture the studio, two ways:
 *  1. "Screen" — record what you're doing live (screen + the DAW's own audio).
 *  2. "History" — an interactive scrubber over the project's recorded
 *     construction log: drag the slider to any step (snaps to each edit), see
 *     what that step did and where in the program, listen to the piece as it
 *     stood at that point, play through at a chosen speed, or record the whole
 *     replay to a video. Plays back the REAL recorded history, edits and all.
 *
 * Audio is tapped from the engine's master bus rather than from system
 * capture, so what lands in the file is exactly what the studio played.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useDaw, reducer } from '@/lib/daw-state'
import type { DawAction } from '@/lib/daw-state'
import { defaultProject, type DawProject, type DawHistoryEntry } from '@/lib/daw-types'
import {
  ScreenRecorder as Recorder,
  formatDuration,
  formatSize,
  screenRecordingSupported,
  type RecordingResult,
} from '@/lib/screen-recorder'
import ClickHighlighter, { type ClickStyle } from './ClickHighlighter'
import { shareClip } from '@/lib/community'

const CLICK_STYLES: { id: ClickStyle; label: string }[] = [
  { id: 'ripple', label: 'Ripple' },
  { id: 'glow', label: 'Glow' },
  { id: 'burst', label: 'Burst' },
]
const SPEEDS = [0.5, 1, 2, 4]

const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

// A starting point for replay: the project's transport settings (tempo, key,
// loop) but with no content — the history rebuilds the tracks/clips/notes.
function replayBase(p: DawProject): DawProject {
  return {
    ...defaultProject(),
    id: p.id, name: p.name, tempo: p.tempo,
    timeSignatureNum: p.timeSignatureNum, timeSignatureDen: p.timeSignatureDen,
    key: p.key, scale: p.scale, swing: p.swing,
    loopStart: p.loopStart, loopEnd: p.loopEnd, loopEnabled: p.loopEnabled,
    masterVolume: p.masterVolume,
  }
}

// Prefer this session's live build log when it has entries, otherwise the
// project's saved history — so replay works whether the project was just built
// in this session or freshly loaded/uploaded (empty live log must not shadow it).
function resolveHistory(live: DawProject['history'] | undefined, saved: DawProject['history']): NonNullable<DawProject['history']> {
  return live && live.length ? live : (saved ?? [])
}

const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B']
function pitchName(p: number): string {
  return NOTE_NAMES[((p % 12) + 12) % 12] + (Math.floor(p / 12) - 1)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function instrLabel(instr: any): string {
  if (!instr) return ''
  const p = instr.params ?? {}
  switch (instr.type) {
    case 'poly': return `poly synth${p.waveform ? ` · ${p.waveform}` : ''}`
    case 'drum': return `drum kit · ${p.pack ?? 'synth'}`
    case 'fm': return 'FM synth'
    case 'fm4op': return `FM synth${p.name ? ` · ${p.name}` : ''}`
    case 'wavetable': return 'wavetable synth'
    case 'sampler': return 'sampler'
    default: return String(instr.type)
  }
}

// A human-readable description of what a step did, and where in the program it
// happens — so the timeline explains each edit rather than just "it was made".
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function describeStep(a: any): { icon: string; text: string; where: string } {
  switch (a?.type) {
    case 'ADD_TRACK':
      return { icon: '➕', text: `Added track “${a.name ?? 'Track'}”${a.instrument ? ` — ${instrLabel(a.instrument)}` : ''}`, where: a.instrument ? 'Track list + instrument panel' : 'Track list (＋ Track)' }
    case 'SET_INSTRUMENT':
      return { icon: '🎛', text: `Set instrument → ${instrLabel(a.instrument)}`, where: 'Instrument panel (double-click the track)' }
    case 'ADD_CLIP':
      return { icon: a.clip?.isDrumClip ? '🥁' : '🎵', text: `Added ${a.clip?.isDrumClip ? 'a beat' : 'a clip'} “${a.clip?.name ?? ''}”`, where: a.clip?.isDrumClip ? 'Step sequencer' : 'Arrangement / piano roll' }
    case 'ADD_MIDI_NOTE':
      return { icon: '♪', text: `Placed a note · ${pitchName(a.note.pitch)}`, where: 'Piano roll / step sequencer' }
    case 'UPDATE_MIDI_NOTE':
      return { icon: '✎', text: `Edited a note${a.patch?.pitch != null ? ` → ${pitchName(a.patch.pitch)}` : a.patch?.startBeat != null ? ' (moved)' : a.patch?.velocity != null ? ' (velocity)' : ''}`, where: 'Piano roll' }
    case 'REMOVE_MIDI_NOTE':
      return { icon: '✕', text: 'Removed a note', where: 'Piano roll / step sequencer' }
    case 'UPDATE_TRACK':
      return { icon: '🎚', text: `Adjusted track · ${Object.keys(a.patch ?? {}).join(', ') || 'settings'}`, where: 'Mixer / track header' }
    case 'ADD_EFFECT': case 'ADD_CLIP_EFFECT':
      return { icon: '🌫', text: 'Added an effect', where: 'FX chain' }
    case 'SET_TEMPO':
      return { icon: '⏱', text: `Tempo → ${a.tempo} BPM`, where: 'Transport bar' }
    case 'SET_SWING':
      return { icon: '〰', text: `Swing → ${Math.round((a.swing ?? 0) * 100)}%`, where: 'Transport bar' }
    case 'SET_KEY_SCALE':
      return { icon: '🎼', text: 'Set key / scale', where: 'Transport bar' }
    default:
      return { icon: '•', text: String(a?.type ?? 'step'), where: 'Studio' }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function affectedTrackId(a: any, state: DawProject): string | null {
  if (!a) return null
  if (a.type === 'ADD_TRACK') return a.id ?? null
  if (a.trackId) return a.trackId
  if (a.clip?.trackId) return a.clip.trackId
  if (a.clipId) return state.arrangementClips.find(c => c.id === a.clipId)?.trackId ?? null
  return null
}

export default function ScreenRecorderPanel({ onClose, initialMode = 'screen' }: { onClose: () => void; initialMode?: 'screen' | 'history' }) {
  const { engine, project, dispatch, getBuildHistory, setSelectedTrackId } = useDaw()
  const recRef = useRef<Recorder | null>(null)
  const [mode, setMode] = useState<'screen' | 'history'>(initialMode)
  const [state, setState] = useState<'idle' | 'recording' | 'done'>('idle')
  const [elapsed, setElapsed] = useState(0)
  const [includeMic, setIncludeMic] = useState(false)
  const [captureCursor, setCaptureCursor] = useState(true)
  const [highlightClicks, setHighlightClicks] = useState(true)
  const [clickStyle, setClickStyle] = useState<ClickStyle>('ripple')
  const [result, setResult] = useState<RecordingResult | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [share, setShare] = useState<'idle' | 'sharing' | 'shared'>('idle')
  const [shareErr, setShareErr] = useState<string | null>(null)
  // Record-to-video replay
  const [replaying, setReplaying] = useState(false)
  const [buildProg, setBuildProg] = useState<{ i: number; total: number } | null>(null)
  const cancelRef = useRef(false)
  // History scrubber
  const [scrubStep, setScrubStep] = useState(0)
  const [autoPlay, setAutoPlay] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [listening, setListening] = useState(false)
  const savedProjRef = useRef<DawProject | null>(null)
  const histRef = useRef<NonNullable<DawProject['history']>>([])
  const supported = screenRecordingSupported()

  const liveHistory = resolveHistory(getBuildHistory?.(), project.history)
  const total = histRef.current.length || liveHistory.length
  const hist: NonNullable<DawProject['history']> = histRef.current.length ? histRef.current : liveHistory

  // Freeze the project + its history when entering History mode, so scrubbing —
  // which swaps the displayed project for a folded snapshot — can't lose the
  // source. Restored on exit.
  useEffect(() => {
    if (mode !== 'history' || savedProjRef.current) return
    const h = resolveHistory(getBuildHistory?.(), project.history)
    if (!h.length) return
    savedProjRef.current = project
    histRef.current = h
    setScrubStep(h.length)
  }, [mode]) // eslint-disable-line react-hooks/exhaustive-deps

  const foldToStep = useCallback((n: number) => {
    const saved = savedProjRef.current
    const h = histRef.current
    if (!saved) return
    const clamped = Math.max(0, Math.min(h.length, n))
    let s: DawProject
    if (clamped >= h.length) {
      s = saved // full = the real project, exact
    } else {
      s = replayBase(saved)
      for (let i = 0; i < clamped; i++) s = reducer(s, h[i].action as unknown as DawAction)
    }
    dispatch({ type: 'LOAD_PROJECT', project: s })
    engine.updateProject(s)
    const tid = affectedTrackId(clamped > 0 ? h[clamped - 1].action : null, s)
    if (tid) setSelectedTrackId(tid)
  }, [dispatch, engine, setSelectedTrackId])

  const goToStep = useCallback((n: number) => {
    if (!savedProjRef.current) { savedProjRef.current = project; histRef.current = hist }
    const clamped = Math.max(0, Math.min(histRef.current.length, n))
    setScrubStep(clamped)
    foldToStep(clamped)
  }, [project, hist, foldToStep])

  const restoreProject = useCallback(() => {
    const saved = savedProjRef.current
    engine.stop()
    if (saved) { dispatch({ type: 'LOAD_PROJECT', project: saved }); engine.updateProject(saved) }
    savedProjRef.current = null
    histRef.current = []
    setAutoPlay(false); setListening(false)
  }, [dispatch, engine])

  async function shareToCommunity() {
    if (!result) return
    setShare('sharing'); setShareErr(null)
    try {
      await shareClip(result.blob, project.name || 'My session', '', { durationMs: result.durationMs })
      setShare('shared')
    } catch (e) {
      setShareErr(e instanceof Error ? e.message : 'Share failed'); setShare('idle')
    }
  }

  const finish = useCallback(async () => {
    const r = await recRef.current?.stop() ?? null
    setState(r ? 'done' : 'idle')
    if (r) {
      setResult(r)
      setPreviewUrl(prev => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(r.blob) })
    }
  }, [])

  useEffect(() => {
    if (state !== 'recording') return
    const t = setInterval(() => setElapsed(e => e + 1), 1000)
    return () => clearInterval(t)
  }, [state])

  // Auto-advance the scrubber while playing, at the chosen speed.
  useEffect(() => {
    if (!autoPlay) return
    if (scrubStep >= total) { setAutoPlay(false); return }
    const t = setTimeout(() => goToStep(scrubStep + 1), Math.max(70, Math.round(480 / speed)))
    return () => clearTimeout(t)
  }, [autoPlay, scrubStep, speed, total, goToStep])

  // Restore the real project if the panel unmounts mid-scrub.
  useEffect(() => () => {
    cancelRef.current = true
    recRef.current?.cleanup()
    if (savedProjRef.current) {
      const saved = savedProjRef.current
      try { engine.stop(); dispatch({ type: 'LOAD_PROJECT', project: saved }); engine.updateProject(saved) } catch { /* editor may be gone */ }
    }
    setPreviewUrl(prev => { if (prev) URL.revokeObjectURL(prev); return null })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function toggleListen() {
    if (listening) { engine.stop(); setListening(false); return }
    if (!savedProjRef.current) goToStep(scrubStep) // make sure a snapshot is loaded
    setAutoPlay(false)
    engine.updateProject(project)
    void engine.play(0)
    setListening(true)
  }

  function togglePlay() {
    if (autoPlay) { setAutoPlay(false); return }
    if (listening) { engine.stop(); setListening(false) }
    if (scrubStep >= total) goToStep(0) // restart from the beginning
    else if (!savedProjRef.current) goToStep(scrubStep)
    setAutoPlay(true)
  }

  function leaveHistory() { restoreProject() }

  async function start() {
    setError(null)
    const rec = new Recorder()
    recRef.current = rec
    rec.onExternalStop = () => { void finish() }
    try {
      await rec.start({ masterNode: engine.masterCompressor, audioContext: engine.ctx, includeMic, captureCursor })
      setElapsed(0)
      setState('recording')
    } catch (e) {
      const msg = e instanceof Error && e.name === 'NotAllowedError'
        ? 'Screen sharing was cancelled.'
        : e instanceof Error ? e.message : 'Could not start recording.'
      setError(msg)
      rec.cleanup()
      setState('idle')
    }
  }

  // Record the whole replay to a video: fold the history from empty, playing the
  // song at each milestone, then the finished track, while screen-recording.
  async function recordReplay() {
    const h = histRef.current.length ? histRef.current : resolveHistory(getBuildHistory?.(), project.history)
    if (!h.length) { setError('This project has no recorded build history yet.'); return }
    if (!supported) { setError('This browser can’t record the screen.'); return }
    setError(null)
    const saved = savedProjRef.current ?? project
    const beatSec = 60 / (saved.tempo || 120)
    cancelRef.current = false
    const rec = new Recorder()
    recRef.current = rec
    rec.onExternalStop = () => { cancelRef.current = true }
    try {
      await rec.start({ masterNode: engine.masterCompressor, audioContext: engine.ctx, includeMic, captureCursor })
      setElapsed(0); setState('recording')
    } catch (e) {
      setError(e instanceof Error && e.name === 'NotAllowedError' ? 'Screen sharing was cancelled.' : 'Could not start recording.')
      rec.cleanup(); return
    }
    setReplaying(true)
    const nonMilestone = h.filter(x => !x.label).length || 1
    const stepDelay = Math.min(450, Math.max(45, Math.round(14000 / nonMilestone)))
    try {
      let s = replayBase(saved)
      dispatch({ type: 'LOAD_PROJECT', project: s }); engine.updateProject(s)
      await wait(600)
      for (let i = 0; i < h.length; i++) {
        if (cancelRef.current) break
        s = reducer(s, h[i].action as unknown as DawAction)
        setBuildProg({ i: i + 1, total: h.length })
        dispatch({ type: 'LOAD_PROJECT', project: s }); engine.updateProject(s)
        if (h[i].label) {
          engine.updateProject(s); await engine.play(0)
          await wait(Math.min(4500, Math.max(2000, 4 * beatSec * 1000)))
          engine.stop()
          await wait(300)
        } else {
          await wait(stepDelay)
        }
      }
      if (!cancelRef.current) {
        const contentBeats = s.arrangementClips.reduce((m, c) => Math.max(m, c.startBeat + c.durationBeats), 0)
        engine.updateProject(s); await engine.play(0)
        await wait(Math.min(30000, Math.max(4000, contentBeats * beatSec * 1000)))
        engine.stop()
      }
    } finally {
      engine.stop()
      dispatch({ type: 'LOAD_PROJECT', project: saved }); engine.updateProject(saved)
      savedProjRef.current = null; histRef.current = []
      setReplaying(false); setBuildProg(null)
      await finish()
    }
  }

  function download() {
    if (!result || !previewUrl) return
    const ext = result.mimeType.includes('mp4') ? 'mp4' : 'webm'
    const name = (project.name || 'session').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    const a = Object.assign(document.createElement('a'), { href: previewUrl, download: `${name || 'session'}.${ext}` })
    document.body.appendChild(a); a.click(); a.remove()
  }

  function reset() {
    setPreviewUrl(prev => { if (prev) URL.revokeObjectURL(prev); return null })
    setResult(null)
    setState('idle')
  }

  const inProgress = state === 'recording' || replaying
  const curStep = hist[scrubStep - 1] as DawHistoryEntry | undefined
  const desc = curStep ? describeStep(curStep.action) : null

  return (
    <div style={{
      position: 'fixed', right: 18, bottom: 84, zIndex: 60, width: 340,
      background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14,
      padding: '14px 16px', boxShadow: '0 18px 50px rgba(0,0,0,0.5)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--text-primary)' }}>
          {mode === 'history' ? 'Build history' : 'Record session'}
        </span>
        <button onClick={() => { leaveHistory(); onClose() }} aria-label="Close"
          style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 15, lineHeight: 1 }}>×</button>
      </div>

      {/* Mode toggle */}
      {state !== 'done' && !inProgress && (
        <div style={{ display: 'flex', gap: 4, padding: 3, background: 'var(--bg-inset, rgba(0,0,0,0.2))', borderRadius: 9, marginBottom: 12 }}>
          {(['screen', 'history'] as const).map(m => (
            <button key={m} onClick={() => { if (m === 'screen') leaveHistory(); setMode(m); setError(null) }} style={{
              flex: 1, padding: '6px 0', borderRadius: 7, fontSize: 11.5, fontWeight: 700, cursor: 'pointer', border: 'none',
              background: mode === m ? 'var(--accent, #7c3aed)' : 'transparent',
              color: mode === m ? '#fff' : 'var(--text-muted)',
            }}>{m === 'screen' ? '● Screen' : '↺ History'}</button>
          ))}
        </div>
      )}

      {!supported && mode === 'screen' && (
        <p style={{ fontSize: 11.5, color: '#f59e0b', lineHeight: 1.6, margin: 0 }}>
          This browser can&rsquo;t capture the screen. Chrome, Edge or Firefox on desktop can.
        </p>
      )}

      {/* ── SCREEN mode, idle ── */}
      {supported && mode === 'screen' && state === 'idle' && (
        <>
          <p style={{ fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.65, margin: '0 0 10px' }}>
            Captures your screen plus the studio&rsquo;s audio straight from the mixer — not system
            sound, so nothing else on your machine ends up in the take.
          </p>
          <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11.5, color: 'var(--text-secondary)', marginBottom: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={includeMic} onChange={e => setIncludeMic(e.target.checked)} />
            Also record my microphone
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11.5, color: 'var(--text-secondary)', marginBottom: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={captureCursor} onChange={e => setCaptureCursor(e.target.checked)} />
            Capture mouse activity (show the cursor &amp; clicks)
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11.5, color: 'var(--text-secondary)', marginBottom: highlightClicks ? 8 : 12, cursor: 'pointer' }}>
            <input type="checkbox" checked={highlightClicks} onChange={e => setHighlightClicks(e.target.checked)} />
            ✨ Highlight my clicks (cinematic)
          </label>
          {highlightClicks && (
            <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
              {CLICK_STYLES.map(s => (
                <button key={s.id} onClick={() => setClickStyle(s.id)} style={{
                  flex: 1, padding: '6px 0', borderRadius: 7, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                  border: `1px solid ${clickStyle === s.id ? 'rgba(139,92,246,0.5)' : 'var(--border)'}`,
                  background: clickStyle === s.id ? 'rgba(139,92,246,0.18)' : 'transparent',
                  color: clickStyle === s.id ? 'var(--accent-light)' : 'var(--text-muted)',
                }}>{s.label}</button>
              ))}
            </div>
          )}
          <button onClick={() => void start()}
            style={{ width: '100%', padding: '9px 0', borderRadius: 9, border: 'none', background: '#dc2626', color: '#fff', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>
            ● Start recording
          </button>
        </>
      )}

      {/* ── HISTORY mode: interactive scrubber ── */}
      {mode === 'history' && !inProgress && state !== 'done' && (
        total === 0 ? (
          <p style={{ fontSize: 11.5, color: '#f59e0b', lineHeight: 1.6, margin: 0 }}>
            No build history recorded for this project yet. It records as you build — make some
            edits, or open a project authored with a history.
          </p>
        ) : (
          <>
            {/* Step readout */}
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 6 }}>
              <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11, color: 'var(--text-muted)' }}>
                Step {scrubStep} / {total}
              </span>
              {scrubStep === total && <span style={{ fontSize: 10.5, color: '#34d399', fontWeight: 600 }}>· finished</span>}
              {scrubStep === 0 && <span style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>· empty project</span>}
            </div>

            {/* Current step description + where */}
            <div style={{ minHeight: 46, marginBottom: 8, padding: '8px 10px', borderRadius: 9, background: 'var(--bg-inset, rgba(0,0,0,0.18))', border: '1px solid var(--border)' }}>
              {desc ? (
                <>
                  <div style={{ fontSize: 12.5, color: 'var(--text-primary)', fontWeight: 600 }}>{desc.icon} {desc.text}</div>
                  <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 2 }}>where: {desc.where}</div>
                </>
              ) : (
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Drag the slider or press play to step through the build.</div>
              )}
            </div>

            {/* Scrubber — snaps to each recorded edit */}
            <input
              type="range" min={0} max={total} step={1} value={scrubStep}
              onChange={e => { setAutoPlay(false); goToStep(Number(e.target.value)) }}
              style={{ width: '100%', accentColor: 'var(--accent, #7c3aed)', cursor: 'pointer' }}
            />

            {/* Transport controls */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '8px 0 8px' }}>
              <button onClick={() => { setAutoPlay(false); goToStep(scrubStep - 1) }} title="Previous edit"
                style={{ ...ctrlBtn }}>◀</button>
              <button onClick={togglePlay} title={autoPlay ? 'Pause' : 'Play through'}
                style={{ ...ctrlBtn, flex: 1, background: 'var(--accent, #7c3aed)', color: '#fff', border: 'none' }}>
                {autoPlay ? '⏸ Pause' : '▶ Play'}
              </button>
              <button onClick={() => { setAutoPlay(false); goToStep(scrubStep + 1) }} title="Next edit"
                style={{ ...ctrlBtn }}>▶</button>
              <select value={speed} onChange={e => setSpeed(Number(e.target.value))} title="Playback speed"
                style={{ ...ctrlBtn, width: 'auto', padding: '0 6px', cursor: 'pointer' }}>
                {SPEEDS.map(s => <option key={s} value={s}>{s}×</option>)}
              </select>
            </div>

            {/* Listen to the partial piece at this step */}
            <button onClick={toggleListen}
              style={{ width: '100%', padding: '8px 0', borderRadius: 9, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                border: `1px solid ${listening ? 'transparent' : 'var(--border)'}`,
                background: listening ? '#059669' : 'transparent', color: listening ? '#fff' : 'var(--text-primary)' }}>
              {listening ? '■ Stop' : '♪ Listen to this version'}
            </button>

            <div style={{ height: 1, background: 'var(--border)', margin: '12px 0 10px' }} />

            <button onClick={() => void recordReplay()} disabled={!supported}
              style={{ width: '100%', padding: '8px 0', borderRadius: 9, border: 'none', background: '#dc2626', color: '#fff', fontSize: 12, fontWeight: 700, cursor: supported ? 'pointer' : 'not-allowed', opacity: supported ? 1 : 0.6 }}>
              ● Record the full replay to video
            </button>
            <p style={{ fontSize: 10.5, color: 'var(--text-muted)', margin: '8px 0 0', lineHeight: 1.5 }}>
              This is the real recorded history — saved with the project. Scrubbing plays it back; it never fabricates.
            </p>
          </>
        )
      )}

      {state === 'recording' && mode === 'screen' && highlightClicks && !replaying && <ClickHighlighter style={clickStyle} />}

      {/* ── In progress (recording and/or replaying to video) ── */}
      {inProgress && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <span style={{ width: 9, height: 9, borderRadius: 5, background: '#dc2626', animation: 'pulse 1.2s infinite' }} />
            <span style={{ fontSize: 20, fontVariantNumeric: 'tabular-nums', color: 'var(--text-primary)', fontWeight: 700 }}>
              {formatDuration(elapsed * 1000)}
            </span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 'auto' }}>
              {replaying ? 'replaying build' : includeMic ? 'screen + studio + mic' : 'screen + studio'}
            </span>
          </div>
          {replaying && buildProg && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ height: 5, borderRadius: 99, background: 'var(--border)', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${Math.round(buildProg.i / buildProg.total * 100)}%`, background: 'var(--accent, #7c3aed)', transition: 'width 0.15s' }} />
              </div>
              <p style={{ fontSize: 10.5, color: 'var(--text-muted)', margin: '5px 0 0' }}>Building… step {buildProg.i} / {buildProg.total}</p>
            </div>
          )}
          <button onClick={() => { if (replaying) cancelRef.current = true; else void finish() }}
            style={{ width: '100%', padding: '9px 0', borderRadius: 9, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-primary)', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>
            ■ Stop
          </button>
        </>
      )}

      {/* ── Done: video preview ── */}
      {state === 'done' && result && previewUrl && (
        <>
          <video src={previewUrl} controls playsInline
            style={{ width: '100%', borderRadius: 9, border: '1px solid var(--border)', display: 'block', marginBottom: 8, background: '#000' }} />
          <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '0 0 10px' }}>
            {formatDuration(result.durationMs)} · {formatSize(result.sizeBytes)}
          </p>
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            <button onClick={download}
              style={{ flex: 1, padding: '8px 0', borderRadius: 8, border: 'none', background: '#7c3aed', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
              Save video
            </button>
            <button onClick={reset}
              style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer' }}>
              Record another
            </button>
          </div>
          {share === 'shared' ? (
            <p style={{ fontSize: 11.5, color: '#34d399', fontWeight: 600, margin: 0 }}>✓ Shared to the community</p>
          ) : (
            <button onClick={() => void shareToCommunity()} disabled={share === 'sharing'}
              style={{ width: '100%', padding: '8px 0', borderRadius: 8, border: '1px solid rgba(139,92,246,0.35)', background: 'rgba(139,92,246,0.14)', color: 'var(--accent-light)', fontSize: 12, fontWeight: 700, cursor: 'pointer', opacity: share === 'sharing' ? 0.6 : 1 }}>
              {share === 'sharing' ? 'Sharing…' : '↑ Share to community'}
            </button>
          )}
          {shareErr && <p style={{ fontSize: 11, color: '#ef4444', margin: '6px 0 0' }}>{shareErr}</p>}
        </>
      )}

      {error && (
        <p style={{ fontSize: 11.5, color: '#ef4444', margin: '10px 0 0', lineHeight: 1.6 }}>{error}</p>
      )}

      <style>{`@keyframes pulse { 0%,100% { opacity: 1 } 50% { opacity: 0.25 } }`}</style>
    </div>
  )
}

const ctrlBtn: React.CSSProperties = {
  height: 30, minWidth: 34, borderRadius: 8, border: '1px solid var(--border)',
  background: 'transparent', color: 'var(--text-primary)', fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
}
