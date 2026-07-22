'use client'

import { uploadRecordingBlob } from '@/lib/record-upload'
import { type MonitorFx } from '@/lib/daw-engine'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Play, Square, Circle, SkipBack, Repeat, Music2, Volume2, Camera, Video, ChevronDown } from 'lucide-react'
import { captureScreenshot, screenshotSupported } from '@/lib/screen-recorder'
import { useDaw, formatBeat, makeAudioClip } from '@/lib/daw-state'
import { useElectronChrome } from '@/lib/use-electron-chrome'
import dynamic from 'next/dynamic'

const PadTuner    = dynamic(() => import('./PadTuner'),    { ssr: false })
// Screen capture pulls in MediaRecorder plumbing nobody needs until they record.
const ScreenRecorderPanel = dynamic(() => import('./ScreenRecorder'), { ssr: false })
const MaskingPanel = dynamic(() => import('./MaskingPanel'), { ssr: false })

function fmtHMS(secs: number): string {
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = Math.floor(secs % 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

const REC_FX_DEFS: Record<MonitorFx['type'], { label: string; min: number; max: number; step: number; def: number; fmt: (v: number) => string }> = {
  volume:     { label: 'Volume',     min: 0,   max: 2,     step: 0.01, def: 1,    fmt: v => `${Math.round(v * 100)}%` },
  filter:     { label: 'Filter',     min: 200, max: 12000, step: 10,   def: 6000, fmt: v => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v)}Hz` },
  reverb:     { label: 'Reverb',     min: 0,   max: 1,     step: 0.01, def: 0.3,  fmt: v => `${Math.round(v * 100)}%` },
  delay:      { label: 'Delay',      min: 0,   max: 1,     step: 0.01, def: 0.3,  fmt: v => `${Math.round(v * 100)}%` },
  distortion: { label: 'Distortion', min: 0,   max: 1,     step: 0.01, def: 0.3,  fmt: v => `${Math.round(v * 100)}%` },
  tremolo:    { label: 'Tremolo',    min: 0,   max: 1,     step: 0.01, def: 0.5,  fmt: v => `${Math.round(v * 100)}%` },
}

export default function Transport() {
  const { project, dispatch, engine, playing, recording, setPosition, metronome, setMetronome, audioMode, triggerBlink, loopToolArmed, setLoopToolArmed } = useDaw()
  const { padTrafficLights } = useElectronChrome()

  // ── Refs ────────────────────────────────────────────────────────────────────
  const posRef = useRef<HTMLSpanElement>(null)
  const rafRef = useRef<number | undefined>(undefined)

  // Podcast wall-clock tracking
  const wallSecsRef    = useRef(0)
  const lastFrameRef   = useRef<number | undefined>(undefined)
  const isPlayingRef   = useRef(playing)
  const podcastPosRef  = useRef<HTMLSpanElement>(null)

  // ── State (music mode only) ─────────────────────────────────────────────────
  const [editingBpm, setEditingBpm] = useState(false)
  const [bpmDraft, setBpmDraft] = useState('')
  const [editingTimeSig, setEditingTimeSig] = useState(false)
  const [showTuner, setShowTuner] = useState(false)
  const [showRecorder, setShowRecorder] = useState(false)
  const [captureOpen, setCaptureOpen] = useState(false)
  const [shotBusy, setShotBusy] = useState(false)
  const captureRef = useRef<HTMLDivElement>(null)
  const [tsDraft, setTsDraft] = useState({ num: project.timeSignatureNum, den: project.timeSignatureDen })
  const [varispeed, setVarispeed] = useState(100)  // 25–200 percent
  const [micError, setMicError] = useState('')
  const [showMask, setShowMask] = useState(false)

  // Inject keyframes for recording pulse + guide blink (once per page)
  useEffect(() => {
    const id = 'daw-anim-styles'
    if (typeof document !== 'undefined' && !document.getElementById(id)) {
      const style = document.createElement('style')
      style.id = id
      style.textContent = [
        '@keyframes dawRecPulse { 0%, 100% { opacity: 1 } 50% { opacity: 0.5 } }',
        '@keyframes dawBlink { 0%, 100% { box-shadow: 0 0 0 0 rgba(250,204,21,0); } 50% { box-shadow: 0 0 0 3px rgba(250,204,21,0.9); } }',
      ].join('\n')
      document.head.appendChild(style)
    }
  }, [])

  // Close the Capture menu on an outside click or Escape
  useEffect(() => {
    if (!captureOpen) return
    function onDown(e: MouseEvent) {
      if (captureRef.current && !captureRef.current.contains(e.target as Node)) setCaptureOpen(false)
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setCaptureOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [captureOpen])

  // Grab a still of the studio and download it as a PNG
  async function takeScreenshot() {
    setCaptureOpen(false)
    if (shotBusy) return
    setShotBusy(true)
    try {
      const blob = await captureScreenshot()
      if (!blob) return
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `100lights-${(project.name || 'session').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } finally {
      setShotBusy(false)
    }
  }

  // Keep isPlayingRef in sync for the RAF closure
  useEffect(() => { isPlayingRef.current = playing }, [playing])

  // RAF loop — music mode: render beats; podcast mode: render wall-clock time
  useEffect(() => {
    if (audioMode === 'podcast') {
      function podcastFrame(nowMs: number) {
        if (isPlayingRef.current) {
          if (lastFrameRef.current !== undefined) {
            wallSecsRef.current += (nowMs - lastFrameRef.current) / 1000
          }
          lastFrameRef.current = nowMs
        } else {
          lastFrameRef.current = undefined
        }
        if (podcastPosRef.current) {
          podcastPosRef.current.textContent = fmtHMS(wallSecsRef.current)
        }
        rafRef.current = requestAnimationFrame(podcastFrame)
      }
      rafRef.current = requestAnimationFrame(podcastFrame)
    } else {
      const num = project.timeSignatureNum
      function musicFrame() {
        if (posRef.current) {
          posRef.current.textContent = formatBeat(engine.currentBeat, num)
        }
        rafRef.current = requestAnimationFrame(musicFrame)
      }
      rafRef.current = requestAnimationFrame(musicFrame)
    }
    return () => { if (rafRef.current !== undefined) cancelAnimationFrame(rafRef.current) }
  }, [engine, project.timeSignatureNum, audioMode])

  // ── Common handlers ─────────────────────────────────────────────────────────

  function handlePlayStop() {
    if (playing) {
      engine.stop()
    } else {
      engine.play()
    }
  }

  // Record-setup box: monitor the input (with effects) before rolling
  const [recordSetup, setRecordSetup] = useState(false)
  const [monitorOn, setMonitorOn] = useState(false)
  const [recFx, setRecFx] = useState<MonitorFx[]>([])
  const [countInBars, setCountInBars] = useState(0)
  const [latencyMs, setLatencyMs] = useState<number>(() => {
    try {
      const s = typeof localStorage !== 'undefined' ? localStorage.getItem('100lights-rec-latency-ms') : null
      if (s !== null) return Number(s)
    } catch { /* ok */ }
    return -1  // -1 = auto
  })
  function commitLatency(v: number) {
    setLatencyMs(v)
    try {
      if (v < 0) localStorage.removeItem('100lights-rec-latency-ms')
      else localStorage.setItem('100lights-rec-latency-ms', String(v))
    } catch { /* ok */ }
  }

  function recordableInput(): string | null {
    const t = project.tracks.find(t => t.type === 'audio' && t.armed && t.inputSource)
    return t?.inputSource ?? null
  }

  function closeRecordSetup() {
    engine.stopMonitor()
    setMonitorOn(false)
    setRecordSetup(false)
  }

  async function toggleMonitor() {
    if (monitorOn) {
      engine.stopMonitor()
      setMonitorOn(false)
      return
    }
    const input = recordableInput()
    if (!input) return
    try {
      await engine.startMonitor(input, recFx)
      setMonitorOn(true)
    } catch (err) {
      const msg = err instanceof DOMException && err.name === 'NotAllowedError'
        ? 'Mic permission denied — allow access in system settings'
        : err instanceof Error ? err.message : 'Input access failed'
      setMicError(msg)
      setTimeout(() => setMicError(''), 8000)
    }
  }

  function patchRecFx(next: MonitorFx[]) {
    setRecFx(next)
    engine.updateMonitorFx(next)
  }

  async function startRecordingNow() {
    engine.stopMonitor()
    setMonitorOn(false)
    setRecordSetup(false)
    try {
      if (countInBars > 0) {
        setMicError(`Count-in — ${countInBars} bar${countInBars > 1 ? 's' : ''}…`)
        await engine.countIn(countInBars * project.timeSignatureNum, project.tempo)
        setMicError('')
      }
      const armedTracks = project.tracks.filter(t => t.type === 'audio' && t.armed && t.inputSource)
      engine.setPendingRecordFx(recFx)
      await Promise.all(armedTracks.map(t => engine.startMicInput(t.id, t.inputSource ?? 'mic')))
      if (!playing) engine.play()
      await engine.startRecording()
      setMicError('')
    } catch (err) {
      const msg = err instanceof DOMException && err.name === 'NotAllowedError'
        ? 'Mic permission denied — allow access in system settings'
        : err instanceof Error ? err.message : 'Microphone access failed'
      setMicError(msg)
      setTimeout(() => setMicError(''), 12000)
    }
  }

  async function handleRecord() {
    if (recording) {
      if (playing) engine.stop()
      await engine.stopRecording()
    } else if (recordSetup) {
      closeRecordSetup()
    } else {
      const audioTracks = project.tracks.filter(t => t.type === 'audio')
      const armedTracks = audioTracks.filter(t => t.armed)

      // No tracks at all → blink the +Track button
      if (project.tracks.length === 0) {
        triggerBlink(['add-track'])
        return
      }

      // Tracks exist but none armed → blink all arm buttons
      if (armedTracks.length === 0) {
        const inputTracks = audioTracks.filter(t => t.inputSource)
        triggerBlink(
          (inputTracks.length > 0 ? inputTracks : audioTracks).map(t => `arm:${t.id}`)
        )
        setMicError(inputTracks.length > 0
          ? `Arm a track to record — click ● on "${inputTracks[0].name}"`
          : 'Arm a track to record — click ● on a track')
        setTimeout(() => setMicError(''), 5000)
        return
      }

      // Every armed track lacks an input → nothing can actually record.
      // Blink the input pickers and stay stopped instead of rolling.
      const armedWithoutInput = armedTracks.filter(t => !t.inputSource)
      if (armedWithoutInput.length === armedTracks.length) {
        triggerBlink(armedWithoutInput.map(t => `input:${t.id}`))
        setMicError('Pick an input on an armed track first — click its input selector')
        setTimeout(() => setMicError(''), 5000)
        return
      }

      // Guards pass — open the setup box: test the sound, add effects,
      // then start the take from there.
      setRecordSetup(true)
    }
  }

  const armedReady = project.tracks.filter(t => t.type === 'audio' && t.armed && t.inputSource)
  const recordSetupPanel = recordSetup && typeof document !== 'undefined' ? createPortal(
    <div
      onMouseDown={e => { if (e.target === e.currentTarget) closeRecordSetup() }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9998, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '16px 18px', width: 'min(400px,92vw)', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-primary)' }}>● Record — set your sound</span>
          <button onClick={closeRecordSetup} aria-label="Close" style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 13 }}>✕</button>
        </div>
        <p style={{ fontSize: 10.5, color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>
          Recording to: {armedReady.map(t => t.name).join(', ') || '—'}. Toggle the monitor to hear yourself with the effects before the take.
        </p>

        <button
          onClick={() => void toggleMonitor()}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
            padding: '9px 0', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 700,
            border: monitorOn ? '1px solid rgba(34,197,94,0.6)' : '1px solid #2e2e2e',
            background: monitorOn ? 'rgba(34,197,94,0.14)' : '#1e1e1e',
            color: monitorOn ? '#4ade80' : '#aaa',
          }}
        >
          🎧 Monitor {monitorOn ? 'ON — you should hear yourself' : 'off'}
        </button>
        <p style={{ fontSize: 9, color: 'var(--text-muted)', margin: '-4px 0 0', lineHeight: 1.4 }}>
          Use wired headphones for the tightest monitoring — Bluetooth adds delay no software can remove.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 7, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)', borderRadius: 9, padding: '9px 11px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.08em', color: 'var(--text-muted)' }}>EFFECTS ON THE TAKE</span>
            <select
              value=""
              onChange={e => {
                const type = e.target.value as MonitorFx['type']
                if (!type) return
                patchRecFx([...recFx, { type, value: REC_FX_DEFS[type].def }])
              }}
              style={{ fontSize: 10, padding: '2px 5px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-secondary)', cursor: 'pointer' }}
            >
              <option value="">+ Add effect</option>
              {(Object.keys(REC_FX_DEFS) as MonitorFx['type'][]).map(t => <option key={t} value={t}>{REC_FX_DEFS[t].label}</option>)}
            </select>
          </div>
          {recFx.length === 0 && (
            <p style={{ fontSize: 10, color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>
              None yet — the take records clean. Anything you add here is heard in the monitor and lands as FX bars under the recording.
            </p>
          )}
          {recFx.map((fx, i) => {
            const def = REC_FX_DEFS[fx.type]
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 10, color: 'var(--text-secondary)', width: 62, flexShrink: 0 }}>{def.label}</span>
                <input type="range" min={def.min} max={def.max} step={def.step} value={fx.value}
                  onChange={e => patchRecFx(recFx.map((f, j) => j === i ? { ...f, value: Number(e.target.value) } : f))}
                  style={{ flex: 1, accentColor: '#dc2626' }} />
                <span style={{ fontSize: 9.5, color: 'var(--text-primary)', width: 38, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{def.fmt(fx.value)}</span>
                <button onClick={() => patchRecFx(recFx.filter((_, j) => j !== i))} aria-label="Remove effect"
                  style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 11, padding: 0 }}>✕</button>
              </div>
            )
          })}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 10, color: 'var(--text-secondary)', width: 62, flexShrink: 0 }}>Timing</span>
          <input type="range" min={-1} max={250} step={1} value={latencyMs}
            onChange={e => commitLatency(Number(e.target.value))}
            title="Recorded takes are placed this much earlier to cancel the audio pipeline's delay. Auto uses the browser's estimate."
            style={{ flex: 1, accentColor: '#dc2626' }} />
          <span style={{ fontSize: 9.5, color: 'var(--text-primary)', width: 52, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
            {latencyMs < 0 ? `auto ${Math.round(engine.recordLatencySec() * 1000)}ms` : `${latencyMs}ms`}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>Count-in</span>
          {[0, 1, 2].map(b => (
            <button key={b} onClick={() => setCountInBars(b)}
              style={{
                fontSize: 10, padding: '3px 10px', borderRadius: 5, cursor: 'pointer', fontWeight: 700,
                border: countInBars === b ? '1px solid rgba(220,38,38,0.6)' : '1px solid #2e2e2e',
                background: countInBars === b ? 'rgba(220,38,38,0.14)' : '#1e1e1e',
                color: countInBars === b ? '#f87171' : '#888',
              }}
            >{b === 0 ? 'Off' : `${b} bar${b > 1 ? 's' : ''}`}</button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={closeRecordSetup}
            style={{ padding: '9px 16px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12 }}>
            Cancel
          </button>
          <button onClick={() => void startRecordingNow()}
            style={{ flex: 1, padding: '9px 0', borderRadius: 8, border: 'none', background: '#dc2626', color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 800 }}>
            ● Start recording
          </button>
        </div>
      </div>
    </div>,
    document.body,
  ) : null

  function handleRewind() {
    engine.seek(0)
    setPosition(0)
  }

  function handlePodcastRewind() {
    engine.seek(0)
    setPosition(0)
    wallSecsRef.current = 0
    lastFrameRef.current = undefined
  }

  function handleLoopToggle() {
    if (project.loopEnabled) {
      dispatch({ type: 'SET_LOOP_ENABLED', enabled: false })
      setLoopToolArmed(false)
      return
    }
    // Arm the loop tool — the region appears once you drag it across the
    // ruler or the track lanes. Double-click loops the whole project instead.
    setLoopToolArmed(!loopToolArmed)
  }

  function handleLoopFullSpan() {
    const clips = project.arrangementClips
    if (clips.length === 0) return
    const start = Math.min(...clips.map(c => c.startBeat))
    const end   = Math.max(...clips.map(c => c.startBeat + c.durationBeats))
    dispatch({ type: 'SET_LOOP', start, end })
    dispatch({ type: 'SET_LOOP_ENABLED', enabled: true })
    setLoopToolArmed(false)
  }

  function handleVolumeChange(e: React.ChangeEvent<HTMLInputElement>) {
    dispatch({ type: 'SET_MASTER_VOLUME', volume: parseFloat(e.target.value) })
    engine.setMasterVolume(parseFloat(e.target.value))
  }

  // ── Music-only handlers ─────────────────────────────────────────────────────

  function applyTempo(n: number) {
    dispatch({ type: 'SET_TEMPO', tempo: n })
    // With tempo markers on the timeline, the marker at the playhead governs —
    // update it too, or the marker watcher snaps the BPM right back.
    const markers = project.tempoMarkers ?? []
    if (markers.length > 0) {
      const beat = engine.currentBeat
      const active = [...markers].filter(m => m.beat <= beat + 0.001).sort((a, b) => b.beat - a.beat)[0] ?? markers[0]
      dispatch({ type: 'ADD_TEMPO_MARKER', marker: { ...active, tempo: n } })
    }
  }

  function handleBpmCommit(value: string) {
    const n = parseFloat(value)
    if (!isNaN(n) && n > 0) applyTempo(n)
    setEditingBpm(false)
  }

  function handleTap() {
    const bpm = engine.tap()
    if (bpm !== null) applyTempo(bpm)
  }

  function handleMetronomeToggle() {
    const next = !metronome
    setMetronome(next)
    engine.setMetronome(next)
  }

  function handleTimeSigCommit() {
    dispatch({ type: 'SET_TIME_SIG', num: tsDraft.num, den: tsDraft.den })
    setEditingTimeSig(false)
  }

  function handleCapture() {
    const blob = engine.captureJam(30)
    if (!blob) {
      setMicError('No buffer yet — press Play first to fill the jam buffer')
      setTimeout(() => setMicError(''), 3000)
      return
    }
    const audioTracks = project.tracks.filter(t => t.type === 'audio')
    if (audioTracks.length === 0) {
      setMicError('Add an audio track to capture to')
      setTimeout(() => setMicError(''), 3000)
      return
    }
    const target = audioTracks.find(t => t.armed) ?? audioTracks[0]
    const url = URL.createObjectURL(blob)
    const durationBeats = 30 * (project.tempo / 60)
    const startBeat = Math.max(0, engine.currentBeat - durationBeats)
    const clip = makeAudioClip(target.id, 'Jam Capture', startBeat, durationBeats, { audioUrl: url })
    dispatch({ type: 'ADD_CLIP', clip })
    void uploadRecordingBlob(blob, clip.id).then(key => {
      if (key) dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch: { r2Key: key } })
    })
  }

  // ── Podcast-only handlers ───────────────────────────────────────────────────

  const voiceTracks = project.tracks.filter(t => t.type === 'audio' && t.name !== 'Music Bed')
  const allVoiceArmed = voiceTracks.length > 0 && voiceTracks.every(t => t.armed)

  function handleRecAllVoice() {
    const arm = !allVoiceArmed
    for (const t of voiceTracks) {
      dispatch({ type: 'UPDATE_TRACK', trackId: t.id, patch: { armed: arm } })
    }
  }

  // ── Style objects ───────────────────────────────────────────────────────────

  const base: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'var(--bg-card)',
    border: '1px solid var(--border)',
    borderRadius: 4,
    color: 'var(--text-secondary)',
    cursor: 'pointer',
    width: 28,
    height: 28,
    flexShrink: 0,
    padding: 0,
  }

  const active: React.CSSProperties = {
    ...base,
    background: 'var(--accent)',
    border: '1px solid var(--accent)',
    color: '#fff',
  }

  const divider: React.CSSProperties = {
    width: 1,
    height: 28,
    background: 'var(--border)',
    flexShrink: 0,
    margin: '0 2px',
  }

  const monoDisplay: React.CSSProperties = {
    background: 'var(--bg-base)',
    border: '1px solid var(--border)',
    borderRadius: 4,
    color: 'var(--text-primary)',
    cursor: 'pointer',
    fontFamily: 'monospace',
    fontSize: 12,
    padding: '3px 8px',
    lineHeight: 1.4,
  }

  const inputStyle: React.CSSProperties = {
    background: 'var(--bg-base)',
    border: '1px solid var(--accent)',
    borderRadius: 3,
    color: 'var(--text-primary)',
    fontSize: 12,
    fontFamily: 'monospace',
    outline: 'none',
    textAlign: 'center',
    padding: '2px 4px',
  }

  const wrapStyle: React.CSSProperties = {
    height: 48,
    background: 'var(--bg-surface)',
    borderBottom: '1px solid var(--border)',
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    paddingLeft: padTrafficLights ? 80 : 10,
    paddingRight: 10,
    flexShrink: 0,
  }

  const wrapClass = 'electron-drag-container'

  // ── Podcast transport ───────────────────────────────────────────────────────

  if (audioMode === 'podcast') {
    return (
      <div style={wrapStyle} className={wrapClass}>
        {recordSetupPanel}
        {/* Transport controls */}
        <button style={base} onClick={handlePodcastRewind} title="Rewind to start" data-help-id="rewind">
          <SkipBack size={13} />
        </button>

        <button
          style={playing ? active : base}
          onClick={handlePlayStop}
          title="Play / Stop (Space)"
          data-help-id="play"
        >
          {playing
            ? <Square size={11} fill="currentColor" />
            : <Play size={13} fill="currentColor" />
          }
        </button>

        <button
          style={{
            ...base,
            color: recording ? '#ff3b3b' : 'var(--text-secondary)',
            border: recording ? '1px solid #ff3b3b' : '1px solid var(--border)',
            background: recording ? 'rgba(255,59,59,0.14)' : '#1e1e1e',
            animation: recording ? 'dawRecPulse 1s infinite' : undefined,
          }}
          onClick={handleRecord}
          title="Record"
          data-help-id="record"
        >
          <Circle size={11} fill={recording ? '#ff3b3b' : 'transparent'} color={recording ? '#ff3b3b' : 'currentColor'} />
        </button>

        {micError && (
          <span style={{ fontSize: 9, color: '#ff3b3b', maxWidth: 140, lineHeight: 1.2 }}>{micError}</span>
        )}

        <button
          style={project.loopEnabled ? active : loopToolArmed ? { ...base, border: '1px solid rgb(var(--accent-rgb) / 0.7)', color: '#7ab4f5' } : base}
          onClick={handleLoopToggle}
          onDoubleClick={handleLoopFullSpan}
          title="Loop — click, then drag across the timeline to set the region. Double-click to loop the whole project."
          data-help-id="loop"
        >
          <Repeat size={13} />
        </button>

        <div style={divider} />

        {/* HH:MM:SS position */}
        <div style={{
          ...monoDisplay,
          cursor: 'default',
          fontSize: 14,
          letterSpacing: '0.06em',
          minWidth: 88,
          textAlign: 'center',
          padding: '3px 10px',
          userSelect: 'none',
        }}>
          <span ref={podcastPosRef}>00:00:00</span>
        </div>

        <div style={divider} />

        {/* Arm all voice tracks */}
        <button
          onClick={handleRecAllVoice}
          title="Arm / disarm all voice tracks for recording"
          data-help-id="rec-all-voice"
          style={{
            ...base,
            width: 'auto',
            padding: '0 10px',
            fontSize: 9,
            fontFamily: 'monospace',
            letterSpacing: '0.06em',
            background: allVoiceArmed ? 'rgba(239,68,68,0.15)' : '#1e1e1e',
            border: allVoiceArmed ? '1px solid #ef4444' : '1px solid var(--border)',
            color: allVoiceArmed ? '#ef4444' : 'var(--text-secondary)',
          }}
        >
          REC ALL VOICE
        </button>

        <div style={{ flex: 1 }} />

        {/* Master volume */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }} data-help-id="master-volume">
          <Volume2 size={12} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={project.masterVolume}
            onChange={handleVolumeChange}
            className="cf-slider"
            style={{ width: 68, accentColor: 'var(--accent)' }}
          />
        </div>
      </div>
    )
  }

  // ── Music transport (original) ──────────────────────────────────────────────

  return (
    <div style={wrapStyle} className={wrapClass}>
      {recordSetupPanel}
      {/* Transport controls */}
      <button style={base} onClick={handleRewind} title="Rewind to start" data-help-id="rewind">
        <SkipBack size={13} />
      </button>

      <button
        style={playing ? active : base}
        onClick={handlePlayStop}
        title="Play / Stop (Space)"
        data-help-id="play"
      >
        {playing
          ? <Square size={11} fill="currentColor" />
          : <Play size={13} fill="currentColor" />
        }
      </button>

      <button
        style={{
          ...base,
          color: recording ? '#ff3b3b' : 'var(--text-secondary)',
          border: recording ? '1px solid #ff3b3b' : '1px solid var(--border)',
          background: recording ? 'rgba(255,59,59,0.14)' : '#1e1e1e',
          animation: recording ? 'dawRecPulse 1s infinite' : undefined,
        }}
        onClick={handleRecord}
        title="Record"
        data-help-id="record"
      >
        <Circle size={11} fill={recording ? '#ff3b3b' : 'transparent'} color={recording ? '#ff3b3b' : 'currentColor'} />
      </button>

      <button
        onClick={handleCapture}
        title="Capture last 30s from jam buffer (starts on first Play)"
        data-help-id="jam"
        style={{
          ...base,
          width: 'auto', padding: '0 8px',
          fontSize: 9, fontFamily: 'monospace', letterSpacing: '0.06em',
          color: engine.isJamActive ? '#a78bfa' : 'var(--text-muted)',
          border: engine.isJamActive ? '1px solid rgba(167,139,250,0.4)' : '1px solid var(--border)',
          background: engine.isJamActive ? 'rgba(167,139,250,0.08)' : '#1e1e1e',
        }}
      >
        JAM
      </button>

      {micError && (
        <span
          title={micError}
          style={{ fontSize: 9, color: '#ff3b3b', maxWidth: 260, lineHeight: 1.25, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' }}
        >{micError}</span>
      )}

      <button
        style={project.loopEnabled ? active : loopToolArmed ? { ...base, border: '1px solid rgb(var(--accent-rgb) / 0.7)', color: '#7ab4f5' } : base}
        onClick={handleLoopToggle}
        onDoubleClick={handleLoopFullSpan}
        title="Loop — click, then drag across the timeline to set the region. Double-click to loop the whole project."
        data-help-id="loop"
      >
        <Repeat size={13} />
      </button>

      <div style={divider} />

      {/* Position */}
      <div style={{
        ...monoDisplay,
        cursor: 'default',
        fontSize: 14,
        letterSpacing: '0.04em',
        minWidth: 78,
        textAlign: 'center',
        padding: '3px 8px',
        userSelect: 'none',
      }}>
        <span ref={posRef}>1.1.1</span>
      </div>

      <div style={divider} />

      {/* BPM */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 3 }} data-help-id="bpm">
        {editingBpm ? (
          <input
            autoFocus
            type="number"
            min={40}
            max={300}
            value={bpmDraft}
            onChange={e => setBpmDraft(e.target.value)}
            onBlur={() => handleBpmCommit(bpmDraft)}
            onKeyDown={e => {
              if (e.key === 'Enter') handleBpmCommit(bpmDraft)
              if (e.key === 'Escape') setEditingBpm(false)
              e.stopPropagation()
            }}
            style={{ ...inputStyle, width: 52 }}
          />
        ) : (
          <button
            onClick={() => { setBpmDraft(String(project.tempo)); setEditingBpm(true) }}
            style={{ ...monoDisplay, minWidth: 52, textAlign: 'center' }}
            title="Click to edit BPM"
          >
            {project.tempo}
          </button>
        )}
        <span style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: '0.08em', userSelect: 'none' }}>BPM</span>
        <button
          onClick={handleTap}
          style={{ ...base, width: 'auto', padding: '0 7px', fontSize: 9, fontFamily: 'monospace', letterSpacing: '0.06em' }}
          title="Tap tempo"
        >
          TAP
        </button>
      </div>

      {/* Time signature */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 2 }} data-help-id="time-sig">
        {editingTimeSig ? (
          <>
            <input
              autoFocus
              type="number"
              min={1}
              max={16}
              value={tsDraft.num}
              onChange={e => setTsDraft(d => ({ ...d, num: Math.max(1, parseInt(e.target.value) || d.num) }))}
              onBlur={handleTimeSigCommit}
              onKeyDown={e => { if (e.key === 'Enter') handleTimeSigCommit(); e.stopPropagation() }}
              style={{ ...inputStyle, width: 28 }}
            />
            <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>/</span>
            <input
              type="number"
              min={1}
              max={16}
              value={tsDraft.den}
              onChange={e => setTsDraft(d => ({ ...d, den: Math.max(1, parseInt(e.target.value) || d.den) }))}
              onBlur={handleTimeSigCommit}
              onKeyDown={e => { if (e.key === 'Enter') handleTimeSigCommit(); e.stopPropagation() }}
              style={{ ...inputStyle, width: 28 }}
            />
          </>
        ) : (
          <button
            onClick={() => {
              setTsDraft({ num: project.timeSignatureNum, den: project.timeSignatureDen })
              setEditingTimeSig(true)
            }}
            style={{ ...monoDisplay, fontSize: 12, padding: '3px 8px' }}
            title="Click to edit time signature"
          >
            {project.timeSignatureNum}/{project.timeSignatureDen}
          </button>
        )}
      </div>

      <div style={divider} />

      {/* Metronome */}
      <button
        style={metronome ? active : base}
        onClick={handleMetronomeToggle}
        title="Toggle metronome (M)"
        data-help-id="metronome"
      >
        <Music2 size={13} />
      </button>

      <div style={divider} />

      {/* Swing */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }} data-help-id="swing">
        <span
          onClick={() => {
            // groove presets: click the label to cycle through named feels
            const GROOVES = [0, 0.12, 0.25, 0.33, 0.5]
            const cur = project.swing ?? 0
            const idx = GROOVES.findIndex(g => Math.abs(g - cur) < 0.03)
            const next = GROOVES[(idx + 1) % GROOVES.length] ?? 0
            dispatch({ type: 'SET_SWING', swing: next })
            engine.swing = next
          }}
          title="Click to cycle groove presets: straight → light → classic swing → triplet feel → hard shuffle"
          style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: '0.06em', cursor: 'pointer' }}
        >SWING</span>
        <input
          type="range" min={0} max={0.5} step={0.01}
          value={project.swing ?? 0}
          onChange={e => {
            const swing = parseFloat(e.target.value)
            dispatch({ type: 'SET_SWING', swing })
            engine.swing = swing
          }}
          className="cf-slider"
          style={{ width: 56, accentColor: 'var(--accent)' }}
          title={`Swing: ${Math.round((project.swing ?? 0) * 100)}%`}
        />
        <span style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'monospace', minWidth: 26, textAlign: 'right' }}>
          {Math.round((project.swing ?? 0) * 100)}%
        </span>
      </div>

      <div style={divider} />

      {/* Varispeed (tape mode) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }} data-help-id="varispeed">
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0 }}>
          <span style={{ fontSize: 9, color: varispeed !== 100 ? '#f59e0b' : 'var(--text-muted)', letterSpacing: '0.06em', lineHeight: 1 }}>SPEED</span>
          <span style={{ fontSize: 6, color: varispeed !== 100 ? 'rgba(245,158,11,0.6)' : 'var(--text-muted)', letterSpacing: '0.04em', lineHeight: 1.4, opacity: 0.7 }}>tape</span>
        </div>
        <input
          type="range" min={25} max={200} step={1}
          value={varispeed}
          onChange={e => {
            const pct = parseInt(e.target.value)
            setVarispeed(pct)
            engine.setPlaybackRate(pct / 100)
          }}
          className="cf-slider"
          style={{ width: 56, accentColor: varispeed !== 100 ? '#f59e0b' : 'var(--accent)' }}
          title={`Varispeed: ${varispeed}% — tape mode (pitch follows speed). Drag to adjust.`}
        />
        <span style={{ fontSize: 9, color: varispeed !== 100 ? '#f59e0b' : 'var(--text-muted)', fontFamily: 'monospace', minWidth: 30, textAlign: 'right' }}>
          {varispeed}%
        </span>
        {varispeed !== 100 && (
          <button
            onClick={() => { setVarispeed(100); engine.setPlaybackRate(1.0) }}
            style={{ ...base, width: 'auto', padding: '0 5px', fontSize: 8, fontFamily: 'monospace', letterSpacing: '0.05em', background: 'rgba(245,158,11,0.15)', border: '1px solid #f59e0b', color: '#f59e0b' }}
            title="Reset speed to 100%"
          >100%</button>
        )}
      </div>

      <div style={divider} />

      {/* Key / Scale */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 3 }} data-help-id="key-scale">
        <select
          value={project.key ?? 0}
          onChange={e => dispatch({ type: 'SET_KEY_SCALE', key: parseInt(e.target.value), scale: project.scale ?? 'major' })}
          style={{ background: 'var(--bg-base)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 10, borderRadius: 3, padding: '2px 3px', cursor: 'pointer' }}
          title="Root note"
        >
          {['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'].map((n, i) => (
            <option key={i} value={i}>{n}</option>
          ))}
        </select>
        <select
          value={project.scale ?? 'major'}
          onChange={e => dispatch({ type: 'SET_KEY_SCALE', key: project.key ?? 0, scale: e.target.value })}
          style={{ background: 'var(--bg-base)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 10, borderRadius: 3, padding: '2px 3px', cursor: 'pointer' }}
          title="Scale"
        >
          {['major','minor','penta-maj','penta-min','dorian','chromatic'].map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      <div style={divider} />

      {/* Master volume */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }} data-help-id="master-volume">
        <Volume2 size={12} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={project.masterVolume}
          onChange={handleVolumeChange}
          className="cf-slider"
          style={{ width: 68, accentColor: 'var(--accent)' }}
        />
      </div>

      <div style={divider} />

      {/* Tuner toggle */}
      <button
        onClick={() => setShowTuner(v => !v)}
        title="Open tuner"
        data-help-id="tuner"
        style={{
          ...base,
          width: 'auto', padding: '0 9px',
          fontSize: 12,
          background: showTuner ? 'var(--accent)' : '#1e1e1e',
          border: showTuner ? '1px solid var(--accent)' : '1px solid var(--border)',
          color: showTuner ? '#fff' : 'var(--text-secondary)',
        }}
      >
        ♩
      </button>

      {/* Masking detector toggle */}
      <button
        onClick={() => setShowMask(v => !v)}
        title="Frequency masking detector — shows which tracks compete in the same bands"
        data-help-id="masking"
        style={{
          ...base,
          width: 'auto', padding: '0 8px',
          fontSize: 9, fontFamily: 'monospace', letterSpacing: '0.06em',
          background: showMask ? 'rgba(239,68,68,0.15)' : '#1e1e1e',
          border: showMask ? '1px solid rgba(239,68,68,0.5)' : '1px solid var(--border)',
          color: showMask ? '#ef4444' : 'var(--text-secondary)',
        }}
      >
        MASK
      </button>

      {/* Capture dropdown — screenshot + session recorder, grouped on the
          right next to the invite/Share button. The auto margin lives here so
          this pair floats to the far end of the transport row. */}
      <div ref={captureRef} style={{ position: 'relative', marginLeft: 'auto', flexShrink: 0 }}>
        <button
          onClick={() => setCaptureOpen(v => !v)}
          title="Capture the studio — take a screenshot or record a session"
          data-help-id="capture"
          aria-haspopup="menu"
          aria-expanded={captureOpen}
          style={{
            ...base,
            width: 'auto', padding: '0 9px', gap: 4,
            fontSize: 11,
            display: 'flex', alignItems: 'center',
            background: (captureOpen || showRecorder) ? '#2a2a2a' : '#1e1e1e',
            border: (captureOpen || showRecorder) ? '1px solid var(--text-muted)' : '1px solid var(--border)',
            color: showRecorder ? '#dc2626' : 'var(--text-secondary)',
          }}
        >
          <Camera size={13} />
          Capture
          <ChevronDown size={12} style={{ opacity: 0.7 }} />
        </button>

        {captureOpen && (
          <div
            role="menu"
            style={{
              position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 60,
              minWidth: 190, padding: 5,
              background: '#161616', border: '1px solid var(--border)', borderRadius: 8,
              boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
              display: 'flex', flexDirection: 'column', gap: 2,
            }}
          >
            <CaptureItem
              icon={<Camera size={14} />}
              label={shotBusy ? 'Preparing…' : 'Screenshot'}
              hint="Grab a still PNG"
              disabled={shotBusy || !screenshotSupported()}
              onClick={takeScreenshot}
            />
            <CaptureItem
              icon={<Video size={14} />}
              label="Record session"
              hint="Screen + studio audio"
              active={showRecorder}
              onClick={() => { setCaptureOpen(false); setShowRecorder(true) }}
            />
          </div>
        )}
      </div>

      {/* Collab slot — CollabLayer portals the avatars + invite button here
          so they live in the transport row instead of their own bar */}
      <div id="transport-collab-slot" style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }} />

      {showRecorder && typeof document !== 'undefined' && createPortal(
        <ScreenRecorderPanel onClose={() => setShowRecorder(false)} />,
        document.body,
      )}

      {/* Floating tuner panel */}
      {showTuner && typeof document !== 'undefined' && createPortal(
        <div style={{
          position: 'fixed', top: 56, right: 12, zIndex: 9998,
          width: 290, background: 'var(--bg-base)', border: '1px solid var(--border)',
          borderRadius: 10, boxShadow: '0 12px 40px rgba(0,0,0,0.7)',
          overflow: 'hidden',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '7px 12px', borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)',
          }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>♩ Tuner</span>
            <button onClick={() => setShowTuner(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 18, lineHeight: 1, padding: '0 2px' }}>×</button>
          </div>
          <PadTuner />
        </div>,
        document.body
      )}

      {/* Floating masking panel */}
      {showMask && typeof document !== 'undefined' && createPortal(
        <div style={{
          position: 'fixed', top: 56, right: showTuner ? 314 : 12, zIndex: 9997,
          width: 290, background: 'var(--bg-base)', border: '1px solid var(--border)',
          borderRadius: 10, boxShadow: '0 12px 40px rgba(0,0,0,0.7)',
          overflow: 'hidden',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '7px 12px', borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)',
          }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>Masking Detector</span>
            <button onClick={() => setShowMask(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 18, lineHeight: 1, padding: '0 2px' }}>×</button>
          </div>
          <MaskingPanel />
        </div>,
        document.body
      )}
    </div>
  )
}

// One row in the Capture dropdown.
function CaptureItem({ icon, label, hint, onClick, disabled, active }: {
  icon: ReactNode
  label: string
  hint: string
  onClick: () => void
  disabled?: boolean
  active?: boolean
}) {
  const [hover, setHover] = useState(false)
  return (
    <button
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 9,
        width: '100%', padding: '7px 9px',
        background: hover && !disabled ? 'rgba(255,255,255,0.06)' : 'transparent',
        border: 'none', borderRadius: 6,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        textAlign: 'left',
      }}
    >
      <span style={{ display: 'flex', color: active ? '#dc2626' : 'var(--text-secondary)', flexShrink: 0 }}>{icon}</span>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.2 }}>{label}</span>
        <span style={{ fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.2 }}>{hint}</span>
      </span>
    </button>
  )
}
