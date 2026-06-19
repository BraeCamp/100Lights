'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { Mic, Square, Play, Pause, Trash2, RefreshCw, ChevronDown } from 'lucide-react'
import type { BeatHit, BeatAnalysis, BeatType } from '@/lib/beat-analyzer'
import { analyzeBeats } from '@/lib/beat-analyzer'
import { playDrumHit, DRUM_PACKS, type PackId } from '@/lib/drum-samples'

// ── Constants ────────────────────────────────────────────────────────────────

const BEAT_TYPES: BeatType[] = ['kick', 'snare', 'hihat', 'clap', 'other']

const TYPE_COLORS: Record<BeatType, string> = {
  kick:  '#7c3aed',
  snare: '#dc2626',
  hihat: '#ca8a04',
  clap:  '#0284c7',
  other: '#6b7280',
}

const TYPE_LABELS: Record<BeatType, string> = {
  kick:  'Kick',
  snare: 'Snare',
  hihat: 'Hi-Hat',
  clap:  'Clap',
  other: 'Other',
}

// Piano roll note range (C2–C6)
const NOTE_MIN = 36
const NOTE_MAX = 84
const NOTE_RANGE = NOTE_MAX - NOTE_MIN
const LANE_HEIGHT = 96

const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']

function midiName(note: number) {
  return `${NOTE_NAMES[note % 12]}${Math.floor(note / 12) - 1}`
}

type Phase = 'idle' | 'recording' | 'analyzing' | 'editing'

// ── Helper: decode a Blob to AudioBuffer ─────────────────────────────────────

async function decodeAudio(blob: Blob): Promise<AudioBuffer> {
  const ab = await blob.arrayBuffer()
  const ctx = new AudioContext()
  return ctx.decodeAudioData(ab)
}

// ── Time ruler tick labels ────────────────────────────────────────────────────

function RulerTicks({ duration, px, onSeek }: { duration: number; px: number; onSeek?: (t: number) => void }) {
  const step = duration <= 4 ? 0.5 : duration <= 10 ? 1 : 2
  const ticks: number[] = []
  for (let t = 0; t <= duration; t += step) ticks.push(t)
  return (
    <div
      style={{ position: 'relative', height: 18, borderBottom: '1px solid var(--border)', cursor: onSeek ? 'pointer' : 'default' }}
      onClick={e => {
        if (!onSeek) return
        const rect = e.currentTarget.getBoundingClientRect()
        onSeek(Math.max(0, Math.min(duration, ((e.clientX - rect.left) / rect.width) * duration)))
      }}
    >
      {ticks.map(t => (
        <div key={t} style={{
          position: 'absolute',
          left: (t / duration) * px,
          top: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          pointerEvents: 'none',
        }}>
          <span style={{ fontSize: 9, color: 'var(--text-muted)', userSelect: 'none', whiteSpace: 'nowrap' }}>
            {t.toFixed(t < 1 ? 1 : 0)}s
          </span>
          <div style={{ width: 1, height: 5, background: 'var(--border-light)', marginTop: 2 }} />
        </div>
      ))}
    </div>
  )
}

// ── HitBlock: draggable piano-roll note block ─────────────────────────────────

interface HitBlockProps {
  hit: BeatHit
  duration: number
  pxWidth: number
  selected: boolean
  onSelect: () => void
  onMove: (id: string, time: number, note: number | undefined) => void
  onDelete: () => void
}

function HitBlock({ hit, duration, pxWidth, selected, onSelect, onMove, onDelete }: HitBlockProps) {
  const dragStart = useRef<{ x: number; y: number; time: number; note: number } | null>(null)
  const blockRef = useRef<HTMLDivElement>(null)
  const color = TYPE_COLORS[hit.type]

  const noteVal = hit.note ?? Math.round((NOTE_MIN + NOTE_MAX) / 2)
  const left = (hit.time / duration) * pxWidth - 6
  const top = (1 - (noteVal - NOTE_MIN) / NOTE_RANGE) * (LANE_HEIGHT - 10) + 1

  function handlePointerDown(e: React.PointerEvent) {
    e.stopPropagation()
    onSelect()
    dragStart.current = { x: e.clientX, y: e.clientY, time: hit.time, note: noteVal }
    blockRef.current?.setPointerCapture(e.pointerId)
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (!dragStart.current) return
    const dx = e.clientX - dragStart.current.x
    const dy = e.clientY - dragStart.current.y
    const newTime = Math.max(0, Math.min(duration - 0.01, dragStart.current.time + (dx / pxWidth) * duration))
    const newNote = hit.note !== undefined
      ? Math.max(NOTE_MIN, Math.min(NOTE_MAX, Math.round(dragStart.current.note - (dy / LANE_HEIGHT) * NOTE_RANGE)))
      : undefined
    onMove(hit.id, newTime, newNote)
  }

  function handlePointerUp() { dragStart.current = null }

  return (
    <div
      ref={blockRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onDoubleClick={(e) => { e.stopPropagation(); onDelete() }}
      style={{
        position: 'absolute',
        left,
        top,
        width: 13,
        height: 8,
        background: color,
        borderRadius: 2,
        opacity: selected ? 1 : 0.35 + 0.6 * hit.velocity,
        cursor: 'grab',
        boxShadow: selected ? `0 0 0 1px #fff, 0 0 0 2px ${color}` : 'none',
        zIndex: selected ? 10 : 1,
        touchAction: 'none',
        transition: 'box-shadow 0.1s',
      }}
    />
  )
}

// ── Note grid overlay ─────────────────────────────────────────────────────────

function NoteGrid() {
  const lines: React.ReactNode[] = []
  for (let n = NOTE_MIN; n <= NOTE_MAX; n++) {
    const y = (1 - (n - NOTE_MIN) / NOTE_RANGE) * LANE_HEIGHT
    const isC = n % 12 === 0
    lines.push(
      <div key={n} style={{
        position: 'absolute', left: 0, right: 0, top: y, height: isC ? 1 : 0,
        background: isC ? 'rgba(139,92,246,0.18)' : 'transparent',
        pointerEvents: 'none',
      }} />
    )
  }
  return <>{lines}</>
}

// ── Lane ──────────────────────────────────────────────────────────────────────

interface LaneProps {
  type: BeatType
  hits: BeatHit[]
  duration: number
  pxWidth: number
  selectedId: string | null
  onSelect: (id: string) => void
  onMoveHit: (id: string, t: number, note: number | undefined) => void
  onDeleteHit: (id: string) => void
  onAddHit: (t: number, note: number) => void
}

function Lane({ type, hits, duration, pxWidth, selectedId, onSelect, onMoveHit, onDeleteHit, onAddHit }: LaneProps) {
  const color = TYPE_COLORS[type]
  const label = TYPE_LABELS[type]

  function handleLaneClick(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    const t = ((e.clientX - rect.left) / rect.width) * duration
    const note = Math.round(NOTE_MAX - ((e.clientY - rect.top) / rect.height) * NOTE_RANGE)
    onAddHit(
      Math.max(0, Math.min(duration - 0.01, t)),
      Math.max(NOTE_MIN, Math.min(NOTE_MAX, note)),
    )
  }

  return (
    <div style={{ display: 'flex', alignItems: 'stretch', height: LANE_HEIGHT, borderBottom: '1px solid var(--border)' }}>
      {/* Label */}
      <div style={{
        width: 64, flexShrink: 0,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        borderRight: '1px solid var(--border)',
        background: 'var(--bg-surface)',
        gap: 4,
      }}>
        <div style={{ width: 7, height: 7, borderRadius: '50%', background: color }} />
        <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-secondary)', letterSpacing: '0.04em' }}>
          {label}
        </span>
        <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>
          {hits.length}
        </span>
      </div>
      {/* Hit area */}
      <div
        onClick={handleLaneClick}
        style={{
          flex: 1, position: 'relative', cursor: 'crosshair', height: LANE_HEIGHT,
          background: 'var(--bg-card)',
          backgroundImage: 'repeating-linear-gradient(90deg, transparent, transparent calc(12.5% - 1px), var(--border) calc(12.5% - 1px), var(--border) 12.5%)',
        }}
      >
        <NoteGrid />
        {hits.map(hit => (
          <HitBlock
            key={hit.id}
            hit={hit}
            duration={duration}
            pxWidth={pxWidth}
            selected={hit.id === selectedId}
            onSelect={() => onSelect(hit.id)}
            onMove={onMoveHit}
            onDelete={() => onDeleteHit(hit.id)}
          />
        ))}
      </div>
    </div>
  )
}

// ── Note Y-axis labels ────────────────────────────────────────────────────────

function NoteAxis() {
  const markers: React.ReactNode[] = []
  for (let n = NOTE_MIN; n <= NOTE_MAX; n += 12) {
    const y = (1 - (n - NOTE_MIN) / NOTE_RANGE) * LANE_HEIGHT
    markers.push(
      <div key={n} style={{ position: 'absolute', right: 4, top: y - 5, fontSize: 8, color: 'rgba(139,92,246,0.5)', pointerEvents: 'none', userSelect: 'none' }}>
        {midiName(n)}
      </div>
    )
  }
  return (
    <div style={{ position: 'relative', width: 24, height: LANE_HEIGHT, flexShrink: 0, background: 'var(--bg-surface)', borderRight: '1px solid rgba(139,92,246,0.1)' }}>
      {markers}
    </div>
  )
}

// ── Playhead ─────────────────────────────────────────────────────────────────

function Playhead({ time, duration, pxWidth }: { time: number; duration: number; pxWidth: number }) {
  const left = (time / duration) * pxWidth + 64
  if (time < 0) return null
  return (
    <div style={{
      position: 'absolute',
      left, top: 0, bottom: 0,
      width: 1,
      background: 'var(--accent)',
      pointerEvents: 'none',
      zIndex: 20,
    }} />
  )
}

// ── Main BeatLab component ───────────────────────────────────────────────────

interface BeatLabProps {
  onExport?: (hits: BeatHit[], bpm: number | null) => void
}

export default function BeatLab({ onExport }: BeatLabProps) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [analysis, setAnalysis] = useState<BeatAnalysis | null>(null)
  const [hits, setHits] = useState<BeatHit[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [playhead, setPlayhead] = useState(0)
  const [recordingTime, setRecordingTime] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [bpm, setBpm] = useState<number | null>(null)
  const [duration, setDuration] = useState(0)
  const [selectedType, setSelectedType] = useState<BeatType | null>(null)
  const [showTypeMenu, setShowTypeMenu] = useState(false)
  const [packId, setPackId] = useState<PackId>('synth')

  const recorderRef  = useRef<MediaRecorder | null>(null)
  const chunksRef    = useRef<Blob[]>([])
  const recTimerRef  = useRef<ReturnType<typeof setInterval> | null>(null)
  const audioCtxRef  = useRef<AudioContext | null>(null)
  const playRafRef   = useRef<number>(0)
  const playStartRef = useRef<{ wallTime: number; beatTime: number } | null>(null)
  const timelineRef  = useRef<HTMLDivElement>(null)
  const [timelinePx, setTimelinePx] = useState(800)

  // Measure the timeline div (minus 64px lane label + 24px note axis = 88px)
  useEffect(() => {
    if (!timelineRef.current) return
    const ro = new ResizeObserver(([e]) => setTimelinePx(e.contentRect.width - 88))
    ro.observe(timelineRef.current)
    return () => ro.disconnect()
  }, [])

  // RAF playhead
  useEffect(() => {
    if (!isPlaying || duration <= 0) return
    const tick = () => {
      if (!playStartRef.current) return
      const elapsed = (performance.now() - playStartRef.current.wallTime) / 1000
      const t = playStartRef.current.beatTime + elapsed
      if (t >= duration) { stopPlayback(); return }
      setPlayhead(t)
      playRafRef.current = requestAnimationFrame(tick)
    }
    playRafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(playRafRef.current)
  }, [isPlaying, duration]) // eslint-disable-line

  // ── Recording ──────────────────────────────────────────────────────────────

  async function startRecording() {
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      const recorder = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/ogg' })
      chunksRef.current = []
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      recorder.start(100)
      recorderRef.current = recorder
      setPhase('recording')
      setRecordingTime(0)
      recTimerRef.current = setInterval(() => setRecordingTime(t => t + 0.1), 100)
    } catch {
      setError('Microphone access denied. Please allow microphone access and try again.')
    }
  }

  async function stopRecording() {
    const recorder = recorderRef.current
    if (!recorder) return
    if (recTimerRef.current) clearInterval(recTimerRef.current)
    setPhase('analyzing')

    recorder.stop()
    recorder.stream.getTracks().forEach(t => t.stop())

    await new Promise<void>(res => { recorder.onstop = () => res() })

    const blob = new Blob(chunksRef.current, { type: chunksRef.current[0]?.type ?? 'audio/webm' })
    try {
      const audioBuf = await decodeAudio(blob)
      const result = await analyzeBeats(audioBuf)
      setAnalysis(result)
      setHits(result.hits)
      setBpm(result.bpm)
      setDuration(result.duration)
      setPlayhead(0)
      setPhase('editing')
    } catch {
      setError('Could not analyze audio. Try again with a clearer beatbox.')
      setPhase('idle')
    }
  }

  // ── Playback ───────────────────────────────────────────────────────────────

  function getAudioCtx(): AudioContext {
    if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
      audioCtxRef.current = new AudioContext()
    }
    if (audioCtxRef.current.state === 'suspended') audioCtxRef.current.resume()
    return audioCtxRef.current
  }

  function startPlaybackFrom(startFrom: number) {
    if (duration <= 0) return
    const ctx = getAudioCtx()
    const now = ctx.currentTime

    const kickTimes = hits.filter(h => h.type === 'kick').map(h => h.time).sort((a, b) => a - b)

    for (const hit of hits) {
      if (hit.time < startFrom - 0.01) continue
      const when = Math.max(now, now + (hit.time - startFrom))
      const maxKickDur = hit.type === 'kick'
        ? (() => {
            const idx = kickTimes.indexOf(hit.time)
            const next = kickTimes[idx + 1] ?? Infinity
            return Math.min(0.45, next - hit.time - 0.01)
          })()
        : 0.45
      playDrumHit(ctx, packId, hit.type, when, hit.velocity, hit.note, maxKickDur)
    }

    playStartRef.current = { wallTime: performance.now(), beatTime: startFrom }
    setIsPlaying(true)
  }

  function startPlayback() {
    startPlaybackFrom(playhead >= duration ? 0 : playhead)
  }

  function stopPlayback() {
    cancelAnimationFrame(playRafRef.current)
    setIsPlaying(false)
    playStartRef.current = null
    if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
      audioCtxRef.current.close()
      audioCtxRef.current = null
    }
  }

  function handleSeek(t: number) {
    const wasPlaying = isPlaying
    stopPlayback()
    setPlayhead(t)
    if (wasPlaying) startPlaybackFrom(t)
  }

  function togglePlay() {
    if (isPlaying) stopPlayback()
    else startPlayback()
  }

  // ── Hit editing ────────────────────────────────────────────────────────────

  const moveHit = useCallback((id: string, t: number, note: number | undefined) => {
    setHits(prev => prev.map(h => h.id === id ? { ...h, time: t, note } : h).sort((a, b) => a.time - b.time))
  }, [])

  const deleteHit = useCallback((id: string) => {
    setHits(prev => prev.filter(h => h.id !== id))
    setSelectedId(null)
  }, [])

  function addHit(type: BeatType, t: number, note: number) {
    const newHit: BeatHit = { id: crypto.randomUUID(), time: t, type, velocity: 0.7, note }
    setHits(prev => [...prev, newHit].sort((a, b) => a.time - b.time))
    setSelectedId(newHit.id)
  }

  function changeSelectedType(type: BeatType) {
    if (!selectedId) return
    setHits(prev => prev.map(h => h.id === selectedId ? { ...h, type } : h))
    setShowTypeMenu(false)
  }

  const selectedHit = hits.find(h => h.id === selectedId) ?? null

  // ── Snap to BPM grid ───────────────────────────────────────────────────────

  function quantize() {
    if (!bpm) return
    const beatLen = 60 / bpm
    setHits(prev => prev.map(h => {
      const beat = Math.round(h.time / beatLen)
      return { ...h, time: beat * beatLen }
    }))
  }

  // ── Reset ──────────────────────────────────────────────────────────────────

  function reset() {
    stopPlayback()
    setPhase('idle')
    setHits([])
    setAnalysis(null)
    setBpm(null)
    setDuration(0)
    setSelectedId(null)
    setPlayhead(0)
    setError(null)
  }

  // ── Hit counts per type ────────────────────────────────────────────────────

  const hitsByType = Object.fromEntries(
    BEAT_TYPES.map(t => [t, hits.filter(h => h.type === t)])
  ) as Record<BeatType, BeatHit[]>

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-base)', userSelect: 'none' }}>

      {/* ── Toolbar ───────────────────────────────────────────────────────── */}
      <div style={{
        height: 44, display: 'flex', alignItems: 'center', gap: 10,
        padding: '0 14px', borderBottom: '1px solid var(--border)',
        background: 'var(--bg-surface)', flexShrink: 0,
      }}>
        {/* Record / Stop recording */}
        {phase === 'idle' && (
          <button
            onClick={startRecording}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '5px 12px', borderRadius: 6,
              background: '#dc2626', color: '#fff', border: 'none', cursor: 'pointer',
              fontSize: 12, fontWeight: 600,
            }}
          >
            <Mic size={13} /> Record
          </button>
        )}
        {phase === 'recording' && (
          <>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#dc2626', animation: 'pulse 1s ease-in-out infinite' }} />
            <span style={{ fontSize: 12, fontFamily: 'monospace', color: '#dc2626', minWidth: 52 }}>
              {recordingTime.toFixed(1)}s
            </span>
            <button
              onClick={stopRecording}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '5px 12px', borderRadius: 6,
                background: 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid var(--border)',
                cursor: 'pointer', fontSize: 12, fontWeight: 600,
              }}
            >
              <Square size={11} fill="currentColor" /> Stop
            </button>
          </>
        )}
        {phase === 'analyzing' && (
          <span style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 7 }}>
            <RefreshCw size={13} style={{ animation: 'spin 1s linear infinite' }} />
            Analyzing…
          </span>
        )}

        {/* Play / Stop + BPM + editing controls */}
        {phase === 'editing' && (
          <>
            <button
              onClick={togglePlay}
              style={{
                width: 30, height: 30, borderRadius: '50%',
                background: 'var(--accent)', border: 'none', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#fff', flexShrink: 0,
              }}
            >
              {isPlaying
                ? <Pause size={13} fill="#fff" />
                : <Play size={13} fill="#fff" style={{ marginLeft: 1 }} />}
            </button>

            {/* Pack selector */}
            <div style={{ display: 'flex', gap: 2, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 6, padding: 2 }}>
              {DRUM_PACKS.map(p => (
                <button
                  key={p.id}
                  onClick={() => setPackId(p.id)}
                  style={{
                    padding: '2px 8px', fontSize: 11, borderRadius: 4, border: 'none', cursor: 'pointer',
                    background: packId === p.id ? 'var(--border-light)' : 'transparent',
                    color: packId === p.id ? 'var(--text-primary)' : 'var(--text-muted)',
                    fontWeight: packId === p.id ? 600 : 400,
                  }}
                >
                  {p.name}
                </button>
              ))}
            </div>

            {/* BPM */}
            {bpm && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>BPM</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'monospace' }}>{bpm}</span>
                <button
                  onClick={quantize}
                  title="Snap all hits to BPM grid"
                  style={{ fontSize: 10, padding: '2px 7px', borderRadius: 4, background: 'var(--border)', color: 'var(--text-secondary)', border: 'none', cursor: 'pointer' }}
                >
                  Quantize
                </button>
              </div>
            )}

            {/* Selected hit editor */}
            {selectedHit && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '3px 8px', borderRadius: 6,
                background: 'var(--bg-card)', border: '1px solid var(--border)',
                marginLeft: 6,
              }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: TYPE_COLORS[selectedHit.type], flexShrink: 0 }} />
                <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                  {TYPE_LABELS[selectedHit.type]} @ {selectedHit.time.toFixed(2)}s
                  {selectedHit.note !== undefined && (
                    <span style={{ marginLeft: 5, color: 'var(--accent-light)' }}>{midiName(selectedHit.note)}</span>
                  )}
                </span>
                {/* Type picker */}
                <div style={{ position: 'relative' }}>
                  <button
                    onClick={() => setShowTypeMenu(v => !v)}
                    style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, padding: '2px 5px', borderRadius: 4, background: 'var(--border)', color: 'var(--text-secondary)', border: 'none', cursor: 'pointer' }}
                  >
                    Change <ChevronDown size={10} />
                  </button>
                  {showTypeMenu && (
                    <>
                      <div style={{ position: 'fixed', inset: 0, zIndex: 40 }} onClick={() => setShowTypeMenu(false)} />
                      <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: 4, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 6, zIndex: 50, overflow: 'hidden', minWidth: 100 }}>
                        {BEAT_TYPES.map(t => (
                          <button
                            key={t}
                            onClick={() => changeSelectedType(t)}
                            style={{ display: 'flex', alignItems: 'center', gap: 7, width: '100%', padding: '6px 10px', background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 11, color: 'var(--text-primary)', textAlign: 'left' }}
                            onMouseEnter={e => (e.currentTarget.style.background = 'var(--border)')}
                            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                          >
                            <div style={{ width: 7, height: 7, borderRadius: '50%', background: TYPE_COLORS[t], flexShrink: 0 }} />
                            {TYPE_LABELS[t]}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
                <button
                  onClick={() => selectedId && deleteHit(selectedId)}
                  title="Delete hit (or double-click a marker)"
                  style={{ padding: '2px 5px', borderRadius: 4, background: 'transparent', border: 'none', cursor: 'pointer', color: '#ef4444' }}
                >
                  <Trash2 size={11} />
                </button>
              </div>
            )}

            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                {hits.length} hit{hits.length !== 1 ? 's' : ''}
              </span>
              <button
                onClick={reset}
                title="Start over"
                style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, padding: '4px 9px', borderRadius: 5, background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-secondary)', cursor: 'pointer' }}
              >
                <RefreshCw size={11} /> Re-record
              </button>
            </div>
          </>
        )}
      </div>

      {/* ── Content area ──────────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0 }}>

        {/* Idle */}
        {phase === 'idle' && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 18, padding: 40 }}>
            <div style={{ width: 72, height: 72, borderRadius: '50%', background: 'rgba(220,38,38,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid rgba(220,38,38,0.3)' }}>
              <Mic size={32} color="#dc2626" />
            </div>
            <div style={{ textAlign: 'center', maxWidth: 340 }}>
              <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>
                Beatbox your rhythm
              </p>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.7 }}>
                Hit Record and beatbox for a few seconds. 100Lights detects kick, snare,
                and hi-hat sounds, places them on a piano roll, and uses the pitch you
                sung to tune the synthesizer.
              </p>
            </div>
            {error && <p style={{ fontSize: 12, color: '#ef4444', textAlign: 'center' }}>{error}</p>}
            <button
              onClick={startRecording}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '10px 22px', borderRadius: 8,
                background: '#dc2626', color: '#fff', border: 'none',
                cursor: 'pointer', fontSize: 14, fontWeight: 600,
              }}
            >
              <Mic size={15} /> Start Recording
            </button>
          </div>
        )}

        {/* Recording */}
        {phase === 'recording' && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 20 }}>
            <div style={{
              width: 80, height: 80, borderRadius: '50%',
              background: 'rgba(220,38,38,0.15)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              border: '2px solid rgba(220,38,38,0.5)',
              animation: 'pulse 0.8s ease-in-out infinite',
            }}>
              <Mic size={36} color="#dc2626" />
            </div>
            <div style={{ textAlign: 'center' }}>
              <p style={{ fontSize: 32, fontFamily: 'monospace', fontWeight: 700, color: '#dc2626' }}>
                {recordingTime.toFixed(1)}s
              </p>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
                Beatboxing… click Stop when done
              </p>
            </div>
          </div>
        )}

        {/* Analyzing */}
        {phase === 'analyzing' && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14 }}>
            <RefreshCw size={32} color="var(--accent)" style={{ animation: 'spin 1s linear infinite' }} />
            <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
              Detecting kicks, snares, hi-hats, and pitches…
            </p>
          </div>
        )}

        {/* Editing: piano roll */}
        {phase === 'editing' && duration > 0 && (
          <div ref={timelineRef} style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>

            {/* Playhead */}
            <Playhead time={playhead} duration={duration} pxWidth={timelinePx} />

            {/* Ruler — offset by label (64px) + note axis (24px) = 88px */}
            <div style={{ paddingLeft: 88 }}>
              <RulerTicks duration={duration} px={timelinePx} onSeek={handleSeek} />
            </div>

            {/* Lanes with note axis */}
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {BEAT_TYPES.map(type => (
                <div key={type} style={{ display: 'flex' }}>
                  <NoteAxis />
                  <Lane
                    type={type}
                    hits={hitsByType[type]}
                    duration={duration}
                    pxWidth={timelinePx}
                    selectedId={selectedId}
                    onSelect={setSelectedId}
                    onMoveHit={moveHit}
                    onDeleteHit={deleteHit}
                    onAddHit={(t, note) => addHit(type, t, note)}
                  />
                </div>
              ))}
            </div>

            {/* Legend */}
            <div style={{
              padding: '5px 10px', borderTop: '1px solid var(--border)',
              background: 'var(--bg-surface)', flexShrink: 0,
              display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
            }}>
              {BEAT_TYPES.map(t => (
                <span key={t} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--text-muted)' }}>
                  <div style={{ width: 7, height: 7, borderRadius: '50%', background: TYPE_COLORS[t] }} />
                  {TYPE_LABELS[t]} ({hitsByType[t].length})
                </span>
              ))}
              <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--border-light)' }}>
                Click ruler to seek · Click lane to add · Drag X=time Y=pitch · Double-click to delete
              </span>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
