'use client'

import { uploadRecordingBlob } from '@/lib/record-upload'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Play, Square, Circle, SkipBack, Repeat, Music2, Volume2 } from 'lucide-react'
import { useDaw, formatBeat, makeAudioClip } from '@/lib/daw-state'
import { useElectronChrome } from '@/lib/use-electron-chrome'
import dynamic from 'next/dynamic'

const PadTuner    = dynamic(() => import('./PadTuner'),    { ssr: false })
const MaskingPanel = dynamic(() => import('./MaskingPanel'), { ssr: false })

function fmtHMS(secs: number): string {
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = Math.floor(secs % 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
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

  async function handleRecord() {
    if (recording) {
      if (playing) engine.stop()
      await engine.stopRecording()
    } else {
      try {
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

        const recordableTracks = armedTracks.filter(t => t.inputSource)
        await Promise.all(recordableTracks.map(t => engine.startMicInput(t.id, t.inputSource ?? 'mic')))
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
  }

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

  function handleBpmCommit(value: string) {
    const n = parseFloat(value)
    if (!isNaN(n) && n > 0) dispatch({ type: 'SET_TEMPO', tempo: n })
    setEditingBpm(false)
  }

  function handleTap() {
    const bpm = engine.tap()
    if (bpm !== null) dispatch({ type: 'SET_TEMPO', tempo: bpm })
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
    background: '#1e1e1e',
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
    background: '#111',
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
    background: '#111',
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
    background: '#1a1a1a',
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
          style={project.loopEnabled ? active : loopToolArmed ? { ...base, border: '1px solid rgba(61,143,239,0.7)', color: '#7ab4f5' } : base}
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
        style={project.loopEnabled ? active : loopToolArmed ? { ...base, border: '1px solid rgba(61,143,239,0.7)', color: '#7ab4f5' } : base}
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
        <span style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: '0.06em' }}>SWING</span>
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
          style={{ background: '#111', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 10, borderRadius: 3, padding: '2px 3px', cursor: 'pointer' }}
          title="Root note"
        >
          {['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'].map((n, i) => (
            <option key={i} value={i}>{n}</option>
          ))}
        </select>
        <select
          value={project.scale ?? 'major'}
          onChange={e => dispatch({ type: 'SET_KEY_SCALE', key: project.key ?? 0, scale: e.target.value })}
          style={{ background: '#111', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 10, borderRadius: 3, padding: '2px 3px', cursor: 'pointer' }}
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

      {/* Collab slot — CollabLayer portals the avatars + invite button here
          so they live in the transport row instead of their own bar */}
      <div id="transport-collab-slot" style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto', flexShrink: 0 }} />

      {/* Floating tuner panel */}
      {showTuner && typeof document !== 'undefined' && createPortal(
        <div style={{
          position: 'fixed', top: 56, right: 12, zIndex: 9998,
          width: 290, background: '#111', border: '1px solid #2a2a2a',
          borderRadius: 10, boxShadow: '0 12px 40px rgba(0,0,0,0.7)',
          overflow: 'hidden',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '7px 12px', borderBottom: '1px solid #1e1e1e', background: '#171717',
          }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>♩ Tuner</span>
            <button onClick={() => setShowTuner(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#555', fontSize: 18, lineHeight: 1, padding: '0 2px' }}>×</button>
          </div>
          <PadTuner />
        </div>,
        document.body
      )}

      {/* Floating masking panel */}
      {showMask && typeof document !== 'undefined' && createPortal(
        <div style={{
          position: 'fixed', top: 56, right: showTuner ? 314 : 12, zIndex: 9997,
          width: 290, background: '#111', border: '1px solid #2a2a2a',
          borderRadius: 10, boxShadow: '0 12px 40px rgba(0,0,0,0.7)',
          overflow: 'hidden',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '7px 12px', borderBottom: '1px solid #1e1e1e', background: '#171717',
          }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>Masking Detector</span>
            <button onClick={() => setShowMask(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#555', fontSize: 18, lineHeight: 1, padding: '0 2px' }}>×</button>
          </div>
          <MaskingPanel />
        </div>,
        document.body
      )}
    </div>
  )
}
