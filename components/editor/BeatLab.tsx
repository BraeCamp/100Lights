'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { Mic, Square, Play, Pause, Trash2, RefreshCw, ChevronDown } from 'lucide-react'
import type { BeatHit, BeatAnalysis, BeatType } from '@/lib/beat-analyzer'
import { analyzeBeats, triggerHit } from '@/lib/beat-analyzer'

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

type Phase = 'idle' | 'recording' | 'analyzing' | 'editing'

// ── Helper: decode a Blob to AudioBuffer ─────────────────────────────────────

async function decodeAudio(blob: Blob): Promise<AudioBuffer> {
  const ab = await blob.arrayBuffer()
  const ctx = new AudioContext()
  return ctx.decodeAudioData(ab)
}

// ── Time ruler tick labels ────────────────────────────────────────────────────

function RulerTicks({ duration, px }: { duration: number; px: number }) {
  const step = duration <= 4 ? 0.5 : duration <= 10 ? 1 : 2
  const ticks: number[] = []
  for (let t = 0; t <= duration; t += step) ticks.push(t)
  return (
    <div style={{ position: 'relative', height: 18, borderBottom: '1px solid var(--border)' }}>
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

// ── HitBlock: a single draggable hit marker ───────────────────────────────────

interface HitBlockProps {
  hit: BeatHit
  duration: number
  pxWidth: number
  selected: boolean
  onSelect: () => void
  onMove: (newTime: number) => void
  onDelete: () => void
}

function HitBlock({ hit, duration, pxWidth, selected, onSelect, onMove, onDelete }: HitBlockProps) {
  const dragStart = useRef<{ x: number; time: number } | null>(null)
  const blockRef = useRef<HTMLDivElement>(null)

  const left = (hit.time / duration) * pxWidth
  const h = Math.max(8, Math.round(hit.velocity * 32))
  const color = TYPE_COLORS[hit.type]

  function handlePointerDown(e: React.PointerEvent) {
    e.stopPropagation()
    onSelect()
    dragStart.current = { x: e.clientX, time: hit.time }
    blockRef.current?.setPointerCapture(e.pointerId)
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (!dragStart.current) return
    const dx = e.clientX - dragStart.current.x
    const dt = (dx / pxWidth) * duration
    const newTime = Math.max(0, Math.min(duration - 0.01, dragStart.current.time + dt))
    onMove(newTime)
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
        left: left - 4,
        bottom: 0,
        width: 8,
        height: h,
        background: color,
        borderRadius: 2,
        cursor: 'grab',
        opacity: selected ? 1 : 0.78,
        boxShadow: selected ? `0 0 0 2px #fff, 0 0 0 3px ${color}` : 'none',
        zIndex: selected ? 10 : 1,
        touchAction: 'none',
        transition: 'box-shadow 0.1s',
      }}
    />
  )
}

// ── Lane: a single drum-type row ──────────────────────────────────────────────

interface LaneProps {
  type: BeatType
  hits: BeatHit[]
  duration: number
  pxWidth: number
  selectedId: string | null
  onSelect: (id: string) => void
  onMoveHit: (id: string, t: number) => void
  onDeleteHit: (id: string) => void
  onAddHit: (t: number) => void
}

function Lane({ type, hits, duration, pxWidth, selectedId, onSelect, onMoveHit, onDeleteHit, onAddHit }: LaneProps) {
  const color = TYPE_COLORS[type]
  const label = TYPE_LABELS[type]

  function handleLaneClick(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    const t = ((e.clientX - rect.left) / rect.width) * duration
    onAddHit(Math.max(0, Math.min(duration - 0.01, t)))
  }

  return (
    <div style={{ display: 'flex', alignItems: 'stretch', height: 44, borderBottom: '1px solid var(--border)' }}>
      {/* Label */}
      <div style={{
        width: 64, flexShrink: 0,
        display: 'flex', alignItems: 'center', paddingLeft: 10,
        borderRight: '1px solid var(--border)',
        background: 'var(--bg-surface)',
      }}>
        <div style={{ width: 6, height: 6, borderRadius: '50%', background: color, marginRight: 7, flexShrink: 0 }} />
        <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-secondary)', letterSpacing: '0.04em' }}>
          {label}
        </span>
      </div>
      {/* Hit area */}
      <div
        onClick={handleLaneClick}
        style={{
          flex: 1, position: 'relative', cursor: 'crosshair',
          background: 'var(--bg-card)',
          backgroundImage: 'repeating-linear-gradient(90deg, transparent, transparent calc(12.5% - 1px), var(--border) calc(12.5% - 1px), var(--border) 12.5%)',
        }}
      >
        {hits.map(hit => (
          <HitBlock
            key={hit.id}
            hit={hit}
            duration={duration}
            pxWidth={pxWidth}
            selected={hit.id === selectedId}
            onSelect={() => onSelect(hit.id)}
            onMove={(t) => onMoveHit(hit.id, t)}
            onDelete={() => onDeleteHit(hit.id)}
          />
        ))}
      </div>
    </div>
  )
}

// ── Playhead ─────────────────────────────────────────────────────────────────

function Playhead({ time, duration, pxWidth }: { time: number; duration: number; pxWidth: number }) {
  const left = (time / duration) * pxWidth + 64  // 64px = lane label width
  if (time <= 0) return null
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

  const recorderRef  = useRef<MediaRecorder | null>(null)
  const chunksRef    = useRef<Blob[]>([])
  const recTimerRef  = useRef<ReturnType<typeof setInterval> | null>(null)
  const audioCtxRef  = useRef<AudioContext | null>(null)
  const playRafRef   = useRef<number>(0)
  const playStartRef = useRef<{ wallTime: number; beatTime: number } | null>(null)
  const timelineRef  = useRef<HTMLDivElement>(null)
  const [timelinePx, setTimelinePx] = useState(800)

  // Measure the timeline div
  useEffect(() => {
    if (!timelineRef.current) return
    const ro = new ResizeObserver(([e]) => setTimelinePx(e.contentRect.width - 64))
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
    } catch (err) {
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

  function startPlayback() {
    if (duration <= 0) return
    const ctx = getAudioCtx()
    const startFrom = playhead >= duration ? 0 : playhead
    const now = ctx.currentTime

    // Schedule all hits that come after startFrom
    for (const hit of hits) {
      if (hit.time < startFrom - 0.01) continue
      const when = now + (hit.time - startFrom)
      triggerHit(ctx, hit, Math.max(now, when))
    }

    playStartRef.current = { wallTime: performance.now(), beatTime: startFrom }
    setIsPlaying(true)
  }

  function stopPlayback() {
    cancelAnimationFrame(playRafRef.current)
    setIsPlaying(false)
    playStartRef.current = null
  }

  function togglePlay() {
    if (isPlaying) stopPlayback()
    else startPlayback()
  }

  // ── Hit editing ────────────────────────────────────────────────────────────

  const moveHit = useCallback((id: string, t: number) => {
    setHits(prev => prev.map(h => h.id === id ? { ...h, time: t } : h).sort((a, b) => a.time - b.time))
  }, [])

  const deleteHit = useCallback((id: string) => {
    setHits(prev => prev.filter(h => h.id !== id))
    setSelectedId(null)
  }, [])

  function addHit(type: BeatType, t: number) {
    const newHit: BeatHit = { id: crypto.randomUUID(), time: t, type, velocity: 0.7 }
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

        {/* Play / Stop (editing mode) */}
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

            {/* BPM badge */}
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

        {/* Idle: big record prompt */}
        {phase === 'idle' && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 18, padding: 40 }}>
            <div style={{ width: 72, height: 72, borderRadius: '50%', background: 'rgba(220,38,38,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid rgba(220,38,38,0.3)' }}>
              <Mic size={32} color="#dc2626" />
            </div>
            <div style={{ textAlign: 'center', maxWidth: 320 }}>
              <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>
                Beatbox your rhythm
              </p>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.7 }}>
                Hit Record and beatbox for a few seconds. 100Lights will detect the
                kick, snare, and hi-hat sounds and separate them into lanes for editing.
              </p>
            </div>
            {error && (
              <p style={{ fontSize: 12, color: '#ef4444', textAlign: 'center' }}>{error}</p>
            )}
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

        {/* Recording: animated mic + timer */}
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
              Detecting kicks, snares, and hi-hats…
            </p>
          </div>
        )}

        {/* Editing: sequencer grid */}
        {phase === 'editing' && duration > 0 && (
          <div ref={timelineRef} style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>

            {/* Playhead */}
            {isPlaying && <Playhead time={playhead} duration={duration} pxWidth={timelinePx} />}

            {/* Ruler */}
            <div style={{ paddingLeft: 64 }}>
              <RulerTicks duration={duration} px={timelinePx} />
            </div>

            {/* Lanes */}
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {BEAT_TYPES.map(type => (
                <Lane
                  key={type}
                  type={type}
                  hits={hitsByType[type]}
                  duration={duration}
                  pxWidth={timelinePx}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                  onMoveHit={moveHit}
                  onDeleteHit={deleteHit}
                  onAddHit={(t) => addHit(type, t)}
                />
              ))}
            </div>

            {/* Legend */}
            <div style={{
              padding: '6px 10px', borderTop: '1px solid var(--border)',
              background: 'var(--bg-surface)', flexShrink: 0,
              display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
            }}>
              {BEAT_TYPES.map(t => (
                <span key={t} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--text-muted)' }}>
                  <div style={{ width: 7, height: 7, borderRadius: '50%', background: TYPE_COLORS[t] }} />
                  {TYPE_LABELS[t]} ({hitsByType[t].length})
                </span>
              ))}
              <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--border-light)' }}>
                Click lane to add hit · Drag to move · Double-click to delete
              </span>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
