'use client'

/**
 * Capture the studio, two ways:
 *  1. "Screen" — record what you're doing live (screen + the DAW's own audio).
 *     Use this to record a history replay to video, too.
 *  2. "History" — an interactive scrubber over the project's recorded
 *     construction log: drag to any step (snaps to each edit), see what it did
 *     and where in the program, listen to the piece as it stood then, play
 *     through at a chosen speed, or consolidate repeated tweaks. Plays back the
 *     REAL recorded history — never fabricated.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Circle, RotateCcw, SkipBack, SkipForward, Pause, Play, Square, Volume2, Combine, PictureInPicture, PictureInPicture2, Share2, X } from 'lucide-react'
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
import { usePlan } from '@/hooks/usePlan'

const CLICK_STYLES: { id: ClickStyle; label: string }[] = [
  { id: 'ripple', label: 'Ripple' },
  { id: 'glow', label: 'Glow' },
  { id: 'burst', label: 'Burst' },
]
const SPEEDS = [0.5, 1, 2, 4]

// A starting point for replay: the project's transport settings (tempo, key,
// loop) but no content — the history rebuilds the tracks/clips/notes.
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

function resolveHistory(live: DawProject['history'] | undefined, saved: DawProject['history']): NonNullable<DawProject['history']> {
  return live && live.length ? live : (saved ?? [])
}

const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B']
const pitchName = (p: number) => NOTE_NAMES[((p % 12) + 12) % 12] + (Math.floor(p / 12) - 1)

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
    case 'apollo': return 'Apollo hybrid synth'
    case 'sampler': return 'sampler'
    default: return String(instr.type)
  }
}

// What a step did + where in the program it happens.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function describeStep(a: any): { icon: string; text: string; where: string } {
  switch (a?.type) {
    case 'ADD_TRACK': return { icon: '➕', text: `Added “${a.name ?? 'Track'}”${a.instrument ? ` — ${instrLabel(a.instrument)}` : ''}`, where: a.instrument ? 'Track list + instrument panel' : 'Track list' }
    case 'SET_INSTRUMENT': return { icon: '🎛', text: `Instrument → ${instrLabel(a.instrument)}`, where: 'Instrument panel (dbl-click track)' }
    case 'ADD_CLIP': return { icon: a.clip?.isDrumClip ? '🥁' : '🎵', text: `Added ${a.clip?.isDrumClip ? 'a beat' : 'a clip'}`, where: a.clip?.isDrumClip ? 'Step sequencer' : 'Arrangement / piano roll' }
    case 'ADD_MIDI_NOTE': return { icon: '♪', text: `Note · ${pitchName(a.note.pitch)}`, where: 'Piano roll / step seq' }
    case 'UPDATE_MIDI_NOTE': return { icon: '✎', text: `Edited note${a.patch?.pitch != null ? ` → ${pitchName(a.patch.pitch)}` : a.patch?.startBeat != null ? ' (moved)' : ''}`, where: 'Piano roll' }
    case 'REMOVE_MIDI_NOTE': return { icon: '✕', text: 'Removed a note', where: 'Piano roll / step seq' }
    case 'UPDATE_TRACK': return { icon: '🎚', text: `Adjusted ${Object.keys(a.patch ?? {}).join(', ') || 'track'}`, where: 'Mixer / track header' }
    case 'ADD_EFFECT': case 'ADD_CLIP_EFFECT': return { icon: '🌫', text: 'Added an effect', where: 'FX chain' }
    case 'UPDATE_EFFECT': case 'UPDATE_CLIP_EFFECT': return { icon: '🎚', text: 'Tuned an effect', where: 'FX chain' }
    case 'SET_TEMPO': return { icon: '⏱', text: `Tempo → ${a.tempo} BPM`, where: 'Transport bar' }
    case 'SET_SWING': return { icon: '〰', text: `Swing → ${Math.round((a.swing ?? 0) * 100)}%`, where: 'Transport bar' }
    default: return { icon: '•', text: String(a?.type ?? 'step'), where: 'Studio' }
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
  const { engine, project, dispatch, getBuildHistory, setSelectedTrackId, consolidateBuildHistory } = useDaw()
  const { isPro } = usePlan()
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
  // History scrubber
  const [scrubStep, setScrubStep] = useState(0)
  const [autoPlay, setAutoPlay] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [listening, setListening] = useState(false)
  const [consolidateInfo, setConsolidateInfo] = useState<string | null>(null)
  const savedProjRef = useRef<DawProject | null>(null)
  const histRef = useRef<NonNullable<DawProject['history']>>([])
  const [poppedOut, setPoppedOut] = useState(false)
  // While actually capturing, the card hides itself so it never appears in the
  // recording — hover its corner to reveal the timer/Stop. (Brae 2026-08-18.)
  const [reveal, setReveal] = useState(false)
  const winRef = useRef<Window | null>(null)
  const cmdRef = useRef<(d: Record<string, unknown>) => void>(() => {})
  const supported = screenRecordingSupported()

  const liveHistory = resolveHistory(getBuildHistory?.(), project.history)
  const total = histRef.current.length || liveHistory.length
  const hist: NonNullable<DawProject['history']> = histRef.current.length ? histRef.current : liveHistory

  // Freeze the project + history on entering History mode; restore on exit.
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
    if (clamped >= h.length) s = saved
    else {
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
    try { winRef.current?.close() } catch { /* closed */ }
    winRef.current = null
    setPoppedOut(false); setAutoPlay(false); setListening(false); setConsolidateInfo(null)
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
    recRef.current?.cleanup()
    try { winRef.current?.close() } catch { /* closed */ }
    if (savedProjRef.current) {
      const saved = savedProjRef.current
      try { engine.stop(); dispatch({ type: 'LOAD_PROJECT', project: saved }); engine.updateProject(saved) } catch { /* editor gone */ }
    }
    setPreviewUrl(prev => { if (prev) URL.revokeObjectURL(prev); return null })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Pop-out window: a stable listener forwards commands to the current handler.
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== location.origin) return
      const d = e.data as Record<string, unknown> | null
      if (d && d.__lightsHistory && typeof d.cmd === 'string') cmdRef.current(d)
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [])
  // Mirror state to the pop-out whenever it changes.
  useEffect(() => {
    if (poppedOut && winRef.current) {
      try { winRef.current.postMessage({ __lightsHistory: true, type: 'state', step: scrubStep, autoPlay, listening, total }, location.origin) } catch { /* closed */ }
    }
  }, [poppedOut, scrubStep, autoPlay, listening, total])
  // Notice when the user closes the pop-out window.
  useEffect(() => {
    if (!poppedOut) return
    const t = setInterval(() => { if (winRef.current?.closed) { winRef.current = null; setPoppedOut(false) } }, 800)
    return () => clearInterval(t)
  }, [poppedOut])

  function toggleListen() {
    if (listening) { engine.stop(); setListening(false); return }
    if (!savedProjRef.current) goToStep(scrubStep)
    setAutoPlay(false)
    engine.updateProject(project)
    void engine.play(0)
    setListening(true)
  }

  function togglePlay() {
    if (autoPlay) { setAutoPlay(false); return }
    if (listening) { engine.stop(); setListening(false) }
    if (scrubStep >= total) goToStep(0)
    else if (!savedProjRef.current) goToStep(scrubStep)
    setAutoPlay(true)
  }

  function doConsolidate() {
    if (!consolidateBuildHistory) return
    const before = total
    const after = consolidateBuildHistory()
    histRef.current = getBuildHistory?.() ?? histRef.current
    if (savedProjRef.current) savedProjRef.current = { ...savedProjRef.current, history: histRef.current }
    setAutoPlay(false); setListening(false); engine.stop()
    const step = Math.min(scrubStep, after)
    setScrubStep(step); foldToStep(step)
    setConsolidateInfo(before === after ? 'nothing to merge' : `merged ${before} → ${after}`)
  }

  // ── Detachable pop-out window: drive the studio from a separate OS window ──
  function sendInit() {
    if (!savedProjRef.current) { savedProjRef.current = project; histRef.current = hist }
    try {
      winRef.current?.postMessage({
        __lightsHistory: true, type: 'init', total, step: scrubStep, speed, autoPlay, listening,
        steps: hist.map(e => describeStep((e as DawHistoryEntry).action)),
      }, location.origin)
    } catch { /* closed */ }
  }
  // Recomputed each render so it closes over current values.
  cmdRef.current = (d: Record<string, unknown>) => {
    switch (d.cmd) {
      case 'ready': sendInit(); break
      case 'scrubTo': setAutoPlay(false); goToStep(Number(d.step)); break
      case 'prev': setAutoPlay(false); goToStep(scrubStep - 1); break
      case 'next': setAutoPlay(false); goToStep(scrubStep + 1); break
      case 'play':
        if (listening) { engine.stop(); setListening(false) }
        if (scrubStep >= total) goToStep(0); else if (!savedProjRef.current) goToStep(scrubStep)
        setAutoPlay(true); break
      case 'pause': setAutoPlay(false); break
      case 'listen': toggleListen(); break
      case 'stopListen': engine.stop(); setListening(false); break
      case 'setSpeed': setSpeed(Number(d.speed)); break
      case 'consolidate': doConsolidate(); break
      case 'closed': winRef.current = null; setPoppedOut(false); break
    }
  }
  function popOut() {
    if (!savedProjRef.current) goToStep(scrubStep)
    const w = window.open('/history-control', 'lights-history', 'width=400,height=340,menubar=no,toolbar=no,location=no,status=no')
    if (!w) { setError('Pop-out was blocked — allow pop-ups for this site.'); return }
    winRef.current = w
    setPoppedOut(true)
  }
  function bringBack() { try { winRef.current?.close() } catch { /* closed */ } winRef.current = null; setPoppedOut(false) }

  async function start() {
    setError(null)
    const rec = new Recorder()
    recRef.current = rec
    rec.onExternalStop = () => { void finish() }
    try {
      await rec.start({ masterNode: engine.masterCompressor, audioContext: engine.ctx, includeMic, captureCursor, watermark: !isPro })
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

  const inProgress = state === 'recording'
  const curStep = hist[scrubStep - 1] as DawHistoryEntry | undefined
  const desc = curStep ? describeStep(curStep.action) : null

  return (<>
    {state === 'recording' && mode === 'screen' && highlightClicks && <ClickHighlighter style={clickStyle} />}
    <div
      onMouseEnter={() => setReveal(true)}
      onMouseLeave={() => setReveal(false)}
      style={{
        position: 'fixed', right: 18, bottom: 84, zIndex: 60, width: 300,
        background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12,
        padding: '11px 13px', boxShadow: '0 18px 50px rgba(0,0,0,0.5)',
        // invisible while recording (so the capture never shows the card);
        // mouse over the corner brings it back to reach Stop
        opacity: inProgress && !reveal ? 0 : 1,
        transition: 'opacity 0.25s ease',
      }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 9 }}>
        <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--text-primary)' }}>
          {mode === 'history' ? 'History' : 'Record session'}
        </span>
        <button onClick={() => { restoreProject(); onClose() }} aria-label="Close"
          style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}><X size={15} /></button>
      </div>

      {/* Mode toggle */}
      {state !== 'done' && !inProgress && (
        <div style={{ display: 'flex', gap: 4, padding: 3, background: 'var(--bg-inset, rgba(0,0,0,0.2))', borderRadius: 8, marginBottom: 10 }}>
          {(['screen', 'history'] as const).map(m => (
            <button key={m} onClick={() => { if (m === 'screen') restoreProject(); setMode(m); setError(null) }} style={{
              flex: 1, padding: '5px 0', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer', border: 'none',
              background: mode === m ? 'var(--accent, #7c3aed)' : 'transparent',
              color: mode === m ? '#fff' : 'var(--text-muted)',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5,
            }}>{m === 'screen' ? <><Circle size={11} /> Screen</> : <><RotateCcw size={11} /> History</>}</button>
          ))}
        </div>
      )}

      {!supported && mode === 'screen' && (
        <p style={{ fontSize: 11, color: '#f59e0b', lineHeight: 1.55, margin: 0 }}>
          This browser can&rsquo;t capture the screen. Chrome, Edge or Firefox on desktop can.
        </p>
      )}

      {/* ── SCREEN mode, idle ── */}
      {supported && mode === 'screen' && state === 'idle' && (
        <>
          <p style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.55, margin: '0 0 9px' }}>
            Records your screen + the studio&rsquo;s audio (straight from the mixer). Use it to capture a history replay too.
          </p>
          <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11, color: 'var(--text-secondary)', marginBottom: 7, cursor: 'pointer' }}>
            <input type="checkbox" checked={includeMic} onChange={e => setIncludeMic(e.target.checked)} /> Also record my microphone
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11, color: 'var(--text-secondary)', marginBottom: 7, cursor: 'pointer' }}>
            <input type="checkbox" checked={captureCursor} onChange={e => setCaptureCursor(e.target.checked)} /> Show cursor &amp; clicks
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11, color: 'var(--text-secondary)', marginBottom: highlightClicks ? 7 : 11, cursor: 'pointer' }}>
            <input type="checkbox" checked={highlightClicks} onChange={e => setHighlightClicks(e.target.checked)} /> ✨ Highlight clicks
          </label>
          {highlightClicks && (
            <div style={{ display: 'flex', gap: 5, marginBottom: 11 }}>
              {CLICK_STYLES.map(s => (
                <button key={s.id} onClick={() => setClickStyle(s.id)} style={{
                  flex: 1, padding: '5px 0', borderRadius: 6, fontSize: 10.5, fontWeight: 600, cursor: 'pointer',
                  border: `1px solid ${clickStyle === s.id ? 'rgba(139,92,246,0.5)' : 'var(--border)'}`,
                  background: clickStyle === s.id ? 'rgba(139,92,246,0.18)' : 'transparent',
                  color: clickStyle === s.id ? 'var(--accent-light)' : 'var(--text-muted)',
                }}>{s.label}</button>
              ))}
            </div>
          )}
          <button onClick={() => void start()}
            style={{ width: '100%', padding: '8px 0', borderRadius: 8, border: 'none', background: '#dc2626', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <Circle size={12} fill="currentColor" /> Start recording
          </button>
        </>
      )}

      {/* ── HISTORY mode: compact scrubber ── */}
      {mode === 'history' && !inProgress && state !== 'done' && (
        total === 0 ? (
          <p style={{ fontSize: 11, color: '#f59e0b', lineHeight: 1.55, margin: 0 }}>
            No history yet — it records as you build.
          </p>
        ) : poppedOut ? (
          <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            🎚 Controls are open in a separate window — drag it to another screen. Scrubbing there drives this studio live.
            <button onClick={bringBack} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 9, padding: '6px 11px', borderRadius: 7, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-primary)', fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}>
              <PictureInPicture2 size={13} /> Bring controls back here
            </button>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>{scrubStep}/{total}</span>
              <span style={{ fontSize: 11.5, color: 'var(--text-primary)', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {desc ? `${desc.icon} ${desc.text}` : (scrubStep === 0 ? 'empty project' : 'finished ✓')}
              </span>
            </div>
            <div style={{ fontSize: 9.5, color: 'var(--text-muted)', height: 13, marginBottom: 5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {desc ? `↳ ${desc.where}` : ''}
            </div>

            <input type="range" min={0} max={total} step={1} value={scrubStep}
              onChange={e => { setAutoPlay(false); goToStep(Number(e.target.value)) }}
              style={{ width: '100%', accentColor: 'var(--accent, #7c3aed)', cursor: 'pointer' }} />

            <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 7 }}>
              <button onClick={() => { setAutoPlay(false); goToStep(scrubStep - 1) }} title="Previous edit" style={ctrlBtn}><SkipBack size={13} /></button>
              <button onClick={togglePlay} title={autoPlay ? 'Pause' : 'Play'} style={{ ...ctrlBtn, flex: 1, background: 'var(--accent, #7c3aed)', color: 'var(--accent-contrast)', border: 'none' }}>{autoPlay ? <Pause size={14} /> : <Play size={14} />}</button>
              <button onClick={() => { setAutoPlay(false); goToStep(scrubStep + 1) }} title="Next edit" style={ctrlBtn}><SkipForward size={13} /></button>
              <select value={speed} onChange={e => setSpeed(Number(e.target.value))} title="Speed" style={{ ...ctrlBtn, width: 'auto', padding: '0 4px', cursor: 'pointer' }}>
                {SPEEDS.map(s => <option key={s} value={s}>{s}×</option>)}
              </select>
              <button onClick={toggleListen} title="Listen to this version" style={{ ...ctrlBtn, background: listening ? '#059669' : 'transparent', color: listening ? '#fff' : 'var(--text-primary)', border: listening ? 'none' : '1px solid var(--border)' }}>{listening ? <Square size={12} /> : <Volume2 size={14} />}</button>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 9 }}>
              <button onClick={doConsolidate} title="Merge repeated tweaks of the same control into their final value"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 9px', borderRadius: 7, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)', fontSize: 10.5, fontWeight: 600, cursor: 'pointer' }}>
                <Combine size={13} /> Consolidate
              </button>
              <button onClick={popOut} title="Open the controls in a separate window — drag to another screen"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 9px', borderRadius: 7, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)', fontSize: 10.5, fontWeight: 600, cursor: 'pointer' }}>
                <PictureInPicture size={13} /> Pop out
              </button>
              {consolidateInfo && <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{consolidateInfo}</span>}
            </div>
          </>
        )
      )}


      {/* ── Screen recording in progress ── */}
      {inProgress && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 11 }}>
            <span style={{ width: 9, height: 9, borderRadius: 5, background: '#dc2626', animation: 'pulse 1.2s infinite' }} />
            <span style={{ fontSize: 19, fontVariantNumeric: 'tabular-nums', color: 'var(--text-primary)', fontWeight: 700 }}>{formatDuration(elapsed * 1000)}</span>
            <span style={{ fontSize: 10.5, color: 'var(--text-muted)', marginLeft: 'auto' }}>{includeMic ? 'screen + studio + mic' : 'screen + studio'}</span>
          </div>
          <button onClick={() => void finish()}
            style={{ width: '100%', padding: '8px 0', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-primary)', fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}><Square size={12} /> Stop</button>
        </>
      )}

      {/* ── Done: video preview ── */}
      {state === 'done' && result && previewUrl && (
        <>
          <video src={previewUrl} controls playsInline style={{ width: '100%', borderRadius: 8, border: '1px solid var(--border)', display: 'block', marginBottom: 8, background: '#000' }} />
          <p style={{ fontSize: 10.5, color: 'var(--text-muted)', margin: '0 0 9px' }}>{formatDuration(result.durationMs)} · {formatSize(result.sizeBytes)}</p>
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            <button onClick={download} style={{ flex: 1, padding: '7px 0', borderRadius: 8, border: 'none', background: 'var(--accent)', color: 'var(--accent-contrast)', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Save video</button>
            <button onClick={reset} style={{ padding: '7px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer' }}>Again</button>
          </div>
          {share === 'shared' ? (
            <p style={{ fontSize: 11, color: '#34d399', fontWeight: 600, margin: 0 }}>✓ Shared to the community</p>
          ) : (
            <button onClick={() => void shareToCommunity()} disabled={share === 'sharing'}
              style={{ width: '100%', padding: '7px 0', borderRadius: 8, border: '1px solid rgba(139,92,246,0.35)', background: 'rgba(139,92,246,0.14)', color: 'var(--accent-light)', fontSize: 12, fontWeight: 700, cursor: 'pointer', opacity: share === 'sharing' ? 0.6 : 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              {share === 'sharing' ? 'Sharing…' : <><Share2 size={13} /> Share to community</>}
            </button>
          )}
          {shareErr && <p style={{ fontSize: 11, color: '#ef4444', margin: '6px 0 0' }}>{shareErr}</p>}
        </>
      )}

      {error && <p style={{ fontSize: 11, color: '#ef4444', margin: '9px 0 0', lineHeight: 1.55 }}>{error}</p>}

      <style>{`@keyframes pulse { 0%,100% { opacity: 1 } 50% { opacity: 0.25 } }`}</style>
    </div>
  </>)
}

const ctrlBtn: React.CSSProperties = {
  height: 28, minWidth: 30, borderRadius: 7, border: '1px solid var(--border)',
  background: 'transparent', color: 'var(--text-primary)', fontSize: 12, fontWeight: 700, cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
}
