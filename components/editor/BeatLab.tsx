'use client'

import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { Mic, Square, Play, Pause, Trash2, RefreshCw, ChevronDown, Volume2, VolumeX } from 'lucide-react'
import type { BeatHit, BeatAnalysis, BeatType, ReferenceSound } from '@/lib/beat-analyzer'
import { analyzeBeats } from '@/lib/beat-analyzer'
import { playDrumHit } from '@/lib/drum-samples'
import { playMelodicNote, MELODIC_TYPES } from '@/lib/instrument-synth'
import { aiClassifyHits } from '@/lib/ai-beat-classifier'
import { correctionsAdd, correctionsGetAll } from '@/lib/correction-store'
import { libraryGetAll } from '@/lib/sound-library'

// ── Constants ────────────────────────────────────────────────────────────────

const ALL_DRUM_TYPES: BeatType[] = ['kick', 'snare', 'hihat', 'open-hihat', 'clap', 'tom', 'crash', 'rim']
const DEFAULT_ENABLED: BeatType[] = ['kick', 'snare', 'hihat', 'clap']

type InstrumentFamily = 'drums' | 'guitar' | 'piano' | 'synth'
const FAMILY_LABEL: Record<InstrumentFamily, string> = { drums: 'Drums', guitar: 'Guitar', piano: 'Piano', synth: 'Synth' }
const FAMILY_VARIANTS: Record<Exclude<InstrumentFamily, 'drums'>, BeatType[]> = {
  guitar: ['guitar-acoustic', 'guitar-electric', 'guitar-nylon'],
  piano:  ['piano-grand', 'piano-electric', 'piano-rhodes'],
  synth:  ['synth-lead', 'synth-pad', 'synth-bass', 'synth-arp'],
}

const TYPE_COLORS: Record<BeatType, string> = {
  kick:              '#7c3aed',
  snare:             '#dc2626',
  hihat:             '#ca8a04',
  'open-hihat':      '#d97706',
  clap:              '#0284c7',
  tom:               '#059669',
  crash:             '#9333ea',
  rim:               '#db2777',
  'guitar-acoustic': '#b45309',
  'guitar-electric': '#0891b2',
  'guitar-nylon':    '#a16207',
  'piano-grand':     '#1d4ed8',
  'piano-electric':  '#0369a1',
  'piano-rhodes':    '#1e40af',
  'synth-lead':      '#be123c',
  'synth-pad':       '#9333ea',
  'synth-bass':      '#15803d',
  'synth-arp':       '#c2410c',
  other:             '#6b7280',
}

const TYPE_LABELS: Record<BeatType, string> = {
  kick:              'Kick',
  snare:             'Snare',
  hihat:             'Hi-Hat',
  'open-hihat':      'Open HH',
  clap:              'Clap',
  tom:               'Tom',
  crash:             'Crash',
  rim:               'Rim',
  'guitar-acoustic': 'Acoustic',
  'guitar-electric': 'Electric Gtr',
  'guitar-nylon':    'Nylon',
  'piano-grand':     'Grand Piano',
  'piano-electric':  'Electric Piano',
  'piano-rhodes':    'Rhodes',
  'synth-lead':      'Synth Lead',
  'synth-pad':       'Synth Pad',
  'synth-bass':      'Synth Bass',
  'synth-arp':       'Arp',
  other:             'Other',
}

const NOTE_MIN = 36
const NOTE_MAX = 84
const NOTE_RANGE = NOTE_MAX - NOTE_MIN
const LANE_HEIGHT = 88

const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']
function midiName(note: number) {
  return `${NOTE_NAMES[note % 12]}${Math.floor(note / 12) - 1}`
}

type Phase = 'idle' | 'recording' | 'analyzing' | 'editing'
type RecMode = 'hits' | 'loop'

async function decodeAudio(blob: Blob): Promise<AudioBuffer> {
  const ab = await blob.arrayBuffer()
  const ctx = new AudioContext()
  return ctx.decodeAudioData(ab)
}

// ── Waveform ─────────────────────────────────────────────────────────────────

function Waveform({ audioBuffer, pxWidth }: { audioBuffer: AudioBuffer; pxWidth: number }) {
  const height = 40
  const mid = height / 2
  const data = audioBuffer.getChannelData(0)
  const spx = data.length / pxWidth

  const path = useMemo(() => {
    const top: string[] = [], bot: string[] = []
    for (let x = 0; x < pxWidth; x++) {
      const s = Math.floor(x * spx)
      const e = Math.min(data.length, Math.floor((x + 1) * spx))
      let peak = 0
      for (let i = s; i < e; i++) { const a = Math.abs(data[i]); if (a > peak) peak = a }
      const h = peak * (mid - 1)
      top.push(`${x === 0 ? 'M' : 'L'} ${x} ${mid - h}`)
      bot.push(`L ${x} ${mid + h}`)
    }
    return top.join(' ') + ' ' + bot.reverse().join(' ') + ' Z'
  }, [audioBuffer, pxWidth]) // eslint-disable-line

  return (
    <div style={{ paddingLeft: 88, borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
      <svg width={pxWidth} height={height} style={{ display: 'block' }}>
        <path d={path} fill="rgba(139,92,246,0.2)" stroke="rgba(139,92,246,0.35)" strokeWidth={0.5} />
      </svg>
    </div>
  )
}

// ── Time ruler ────────────────────────────────────────────────────────────────

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
        <div key={t} style={{ position: 'absolute', left: (t / duration) * px, top: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', pointerEvents: 'none' }}>
          <span style={{ fontSize: 9, color: 'var(--text-muted)', userSelect: 'none', whiteSpace: 'nowrap' }}>
            {t.toFixed(t < 1 ? 1 : 0)}s
          </span>
          <div style={{ width: 1, height: 5, background: 'var(--border-light)', marginTop: 2 }} />
        </div>
      ))}
    </div>
  )
}

// ── HitBlock ──────────────────────────────────────────────────────────────────

interface HitBlockProps {
  hit: BeatHit
  duration: number
  pxWidth: number
  selected: boolean
  muted: boolean
  aiSuggestion?: BeatType
  onSelect: () => void
  onMove: (id: string, time: number, note: number) => void
  onDelete: () => void
}

function HitBlock({ hit, duration, pxWidth, selected, muted, aiSuggestion, onSelect, onMove, onDelete }: HitBlockProps) {
  const color = TYPE_COLORS[hit.type] ?? '#6b7280'
  const noteVal = hit.note ?? Math.round((NOTE_MIN + NOTE_MAX) / 2)
  const left = (hit.time / duration) * pxWidth - 6
  const top = (1 - (noteVal - NOTE_MIN) / NOTE_RANGE) * (LANE_HEIGHT - 10) + 1

  function handlePointerDown(e: React.PointerEvent) {
    e.stopPropagation()
    e.preventDefault()
    onSelect()

    const startX = e.clientX
    const startY = e.clientY
    const startTime = hit.time
    const startNote = noteVal
    const capDur = duration
    const capPx = pxWidth

    function onGlobalMove(ev: PointerEvent) {
      const dx = ev.clientX - startX
      const dy = ev.clientY - startY
      const newTime = Math.max(0, Math.min(capDur - 0.01, startTime + (dx / capPx) * capDur))
      const newNote = Math.max(NOTE_MIN, Math.min(NOTE_MAX, Math.round(startNote - (dy / LANE_HEIGHT) * NOTE_RANGE)))
      onMove(hit.id, newTime, newNote)
    }
    function onGlobalUp() {
      document.removeEventListener('pointermove', onGlobalMove)
      document.removeEventListener('pointerup', onGlobalUp)
    }
    document.addEventListener('pointermove', onGlobalMove)
    document.addEventListener('pointerup', onGlobalUp)
  }

  return (
    <div style={{ position: 'absolute', left, top, zIndex: selected ? 10 : 1 }}>
      <div
        onPointerDown={handlePointerDown}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => { e.stopPropagation(); onDelete() }}
        title={aiSuggestion ? `AI: ${aiSuggestion}` : undefined}
        style={{
          width: 13, height: 8,
          background: muted ? 'var(--border-light)' : color,
          borderRadius: 2,
          opacity: muted ? 0.35 : selected ? 1 : 0.35 + 0.6 * hit.velocity,
          cursor: 'grab',
          boxShadow: selected && !muted
            ? `0 0 0 1px #fff, 0 0 0 2px ${color}`
            : aiSuggestion
              ? '0 0 0 1.5px rgba(139,92,246,0.8)'
              : 'none',
          touchAction: 'none',
          transition: 'box-shadow 0.1s',
        }}
      />
      {/* AI suggestion marker — small purple dot above the hit */}
      {aiSuggestion && !muted && (
        <div style={{
          position: 'absolute', top: -5, left: 3,
          width: 5, height: 5, borderRadius: '50%',
          background: 'rgba(139,92,246,0.9)',
          pointerEvents: 'none',
        }} />
      )}
    </div>
  )
}

// ── Note grid (C-note lines) ──────────────────────────────────────────────────

function NoteGrid() {
  const lines: React.ReactNode[] = []
  for (let n = NOTE_MIN; n <= NOTE_MAX; n += 12) {
    const y = (1 - (n - NOTE_MIN) / NOTE_RANGE) * LANE_HEIGHT
    lines.push(<div key={n} style={{ position: 'absolute', left: 0, right: 0, top: y, height: 1, background: 'rgba(139,92,246,0.15)', pointerEvents: 'none' }} />)
  }
  return <>{lines}</>
}

// ── Note Y-axis labels ────────────────────────────────────────────────────────

function NoteAxis() {
  const markers: React.ReactNode[] = []
  for (let n = NOTE_MIN; n <= NOTE_MAX; n += 12) {
    const y = (1 - (n - NOTE_MIN) / NOTE_RANGE) * LANE_HEIGHT
    markers.push(
      <div key={n} style={{ position: 'absolute', right: 3, top: y - 5, fontSize: 8, color: 'rgba(139,92,246,0.45)', pointerEvents: 'none', userSelect: 'none' }}>
        {midiName(n)}
      </div>
    )
  }
  return (
    <div style={{ position: 'relative', width: 24, height: LANE_HEIGHT, flexShrink: 0, background: 'var(--bg-surface)', borderRight: '1px solid rgba(139,92,246,0.08)' }}>
      {markers}
    </div>
  )
}

// ── Lane ──────────────────────────────────────────────────────────────────────

interface LaneProps {
  type: BeatType
  hits: BeatHit[]
  duration: number
  pxWidth: number
  selectedId: string | null
  muted: boolean
  aiSuggestions?: Map<string, BeatType> | null
  onSelect: (id: string) => void
  onMoveHit: (id: string, t: number, note: number) => void
  onDeleteHit: (id: string) => void
  onAddHit: (t: number, note: number) => void
  onToggleMute: () => void
}

function Lane({ type, hits, duration, pxWidth, selectedId, muted, aiSuggestions, onSelect, onMoveHit, onDeleteHit, onAddHit, onToggleMute }: LaneProps) {
  const color = TYPE_COLORS[type] ?? '#6b7280'

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
    <div style={{ display: 'flex', alignItems: 'stretch', height: LANE_HEIGHT, borderBottom: '1px solid var(--border)', opacity: muted ? 0.45 : 1 }}>
      {/* Label */}
      <div style={{
        width: 64, flexShrink: 0,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        borderRight: '1px solid var(--border)', background: 'var(--bg-surface)', gap: 3,
      }}>
        <div style={{ width: 7, height: 7, borderRadius: '50%', background: muted ? 'var(--border-light)' : color }} />
        <span style={{ fontSize: 10, fontWeight: 600, color: muted ? 'var(--text-muted)' : 'var(--text-secondary)', letterSpacing: '0.04em' }}>
          {TYPE_LABELS[type]}
        </span>
        <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>{hits.length}</span>
        <button
          onClick={e => { e.stopPropagation(); onToggleMute() }}
          title={muted ? 'Unmute lane' : 'Mute lane'}
          style={{ padding: 2, background: 'none', border: 'none', cursor: 'pointer', color: muted ? '#ef4444' : 'var(--text-muted)', marginTop: 1 }}
        >
          {muted ? <VolumeX size={10} /> : <Volume2 size={10} />}
        </button>
      </div>
      {/* Hit area */}
      <div
        onClick={handleLaneClick}
        style={{
          flex: 1, position: 'relative', cursor: muted ? 'default' : 'crosshair', height: LANE_HEIGHT,
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
            muted={muted}
            aiSuggestion={aiSuggestions?.get(hit.id)}
            onSelect={() => onSelect(hit.id)}
            onMove={onMoveHit}
            onDelete={() => onDeleteHit(hit.id)}
          />
        ))}
      </div>
    </div>
  )
}

// ── Playhead ─────────────────────────────────────────────────────────────────

function Playhead({ time, duration, pxWidth }: { time: number; duration: number; pxWidth: number }) {
  if (time < 0) return null
  return (
    <div style={{
      position: 'absolute', left: (time / duration) * pxWidth + 88, top: 0, bottom: 0,
      width: 1, background: 'var(--accent)', pointerEvents: 'none', zIndex: 20,
    }} />
  )
}

// ── BeatLab ───────────────────────────────────────────────────────────────────

interface BeatLabProps {
  onExport?: (hits: BeatHit[], bpm: number | null) => void
  hasSong?: boolean
  onRequestSongPlay?: () => void
  onRequestSongStop?: () => void
  // When set by parent, switches the active instrument family (e.g. to enter melodic / voice mode)
  requestedFamily?: InstrumentFamily | null
}

export default function BeatLab({ onExport, hasSong, onRequestSongPlay, onRequestSongStop, requestedFamily }: BeatLabProps) {
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
  const [showTypeMenu, setShowTypeMenu] = useState(false)
  const [mutedTypes, setMutedTypes] = useState<Set<BeatType>>(new Set())
  const [audioBuf, setAudioBuf] = useState<AudioBuffer | null>(null)
  const [selectedTypes, setSelectedTypes] = useState<Set<BeatType>>(new Set(DEFAULT_ENABLED))
  const [instrumentFamily, setInstrumentFamily] = useState<InstrumentFamily>('drums')
  const [melodicVariant, setMelodicVariant] = useState<BeatType>('piano-grand')

  // Let the parent switch modes (e.g. AudioEditor's "Voice Transcription" button)
  useEffect(() => {
    if (requestedFamily) setInstrumentFamily(requestedFamily)
  }, [requestedFamily])
  const [recMode, setRecMode] = useState<RecMode>('hits')
  // Loop mode state
  const [loopBuffer, setLoopBuffer] = useState<AudioBuffer | null>(null)
  const [loopDetectedBpm, setLoopDetectedBpm] = useState<number | null>(null)
  const [loopTargetBpm, setLoopTargetBpm] = useState<number>(120)
  const [loopPlaying, setLoopPlaying] = useState(false)

  const [playSongDuringRec, setPlaySongDuringRec] = useState(false)

  // AI classifier state
  const [aiSuggestions, setAiSuggestions] = useState<Map<string, BeatType> | null>(null)
  const [aiLoading, setAiLoading] = useState(false)
  const [groundTruth, setGroundTruth] = useState('')
  const [showGroundTruth, setShowGroundTruth] = useState(false)

  // Two-sided learning: reference sounds from Sound Library (Side A) + accepted corrections (Side B)
  const [referenceSounds, setReferenceSounds] = useState<ReferenceSound[]>([])
  useEffect(() => {
    async function loadReferences() {
      const [library, corrections] = await Promise.all([
        libraryGetAll().catch(() => []),
        correctionsGetAll().catch(() => []),
      ])
      const fromLibrary: ReferenceSound[] = library
        .filter(e => e.spectral && e.category !== 'voice' && e.category !== 'custom')
        .map(e => ({ category: e.category as BeatType, spectral: e.spectral! }))
      const fromCorrections: ReferenceSound[] = corrections
        .map(e => ({ category: e.correctedTo, spectral: e.spectral }))
      setReferenceSounds([...fromLibrary, ...fromCorrections])
    }
    loadReferences()
  }, [])

  const recorderRef    = useRef<MediaRecorder | null>(null)
  const startedSongRef = useRef(false)
  const chunksRef    = useRef<Blob[]>([])
  const recTimerRef  = useRef<ReturnType<typeof setInterval> | null>(null)
  const audioCtxRef  = useRef<AudioContext | null>(null)
  const playRafRef   = useRef<number>(0)
  const playStartRef = useRef<{ wallTime: number; beatTime: number } | null>(null)
  const loopSrcRef   = useRef<AudioBufferSourceNode | null>(null)
  const loopCtxRef   = useRef<AudioContext | null>(null)
  const timelineRef  = useRef<HTMLDivElement>(null)
  const [timelinePx, setTimelinePx] = useState(800)


  // 88px = 64px lane label + 24px note axis
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
      if (playSongDuringRec && onRequestSongPlay) {
        onRequestSongPlay()
        startedSongRef.current = true
      }
    } catch {
      setError('Microphone access denied.')
    }
  }

  async function stopRecording() {
    const recorder = recorderRef.current
    if (!recorder) return
    if (recTimerRef.current) clearInterval(recTimerRef.current)
    if (startedSongRef.current) {
      onRequestSongStop?.()
      startedSongRef.current = false
    }
    setPhase('analyzing')
    recorder.stop()
    recorder.stream.getTracks().forEach(t => t.stop())
    await new Promise<void>(res => { recorder.onstop = () => res() })
    const blob = new Blob(chunksRef.current, { type: chunksRef.current[0]?.type ?? 'audio/webm' })
    try {
      const buf = await decodeAudio(blob)
      if (recMode === 'loop') {
        // Loop mode: just detect BPM, store buffer, go to editing
        const result = await analyzeBeats(buf, { allowedTypes: ['kick', 'snare'] })
        const detectedBpm = result.bpm ?? 120
        setLoopBuffer(buf)
        setLoopDetectedBpm(detectedBpm)
        setLoopTargetBpm(detectedBpm)
        setLoopPlaying(false)
        setPhase('editing')
      } else {
        const opts = instrumentFamily !== 'drums'
          ? { melodicType: melodicVariant }
          : { allowedTypes: Array.from(selectedTypes), referenceSounds }
        const result = await analyzeBeats(buf, opts)
        setAudioBuf(buf)
        setAnalysis(result)
        setHits(result.hits)
        setBpm(result.bpm)
        setDuration(result.duration)
        setPlayhead(0)
        setMutedTypes(new Set())
        setAiSuggestions(null)
        setPhase('editing')
        // Run AI classification in parallel — doesn't block the UI
        if (instrumentFamily === 'drums' && result.hits.some(h => h.spectral)) {
          setAiLoading(true)
          aiClassifyHits(result.hits, Array.from(selectedTypes), groundTruth.trim() || undefined).then(corrections => {
            setAiSuggestions(corrections)
            setAiLoading(false)
          })
        }
      }
    } catch {
      setError('Could not analyze audio. Try again with a clearer beatbox.')
      setPhase('idle')
    }
  }

  // ── Playback ───────────────────────────────────────────────────────────────

  function getAudioCtx(): AudioContext {
    if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') audioCtxRef.current = new AudioContext()
    if (audioCtxRef.current.state === 'suspended') audioCtxRef.current.resume()
    return audioCtxRef.current
  }

  function startPlaybackFrom(startFrom: number) {
    if (duration <= 0) return
    const ctx = getAudioCtx()
    const now = ctx.currentTime
    const kickTimes = hits.filter(h => h.type === 'kick' && !mutedTypes.has('kick')).map(h => h.time).sort((a, b) => a - b)

    for (const hit of hits) {
      if (hit.time < startFrom - 0.01) continue
      if (mutedTypes.has(hit.type)) continue
      const when = Math.max(now, now + (hit.time - startFrom))
      if (MELODIC_TYPES.has(hit.type)) {
        playMelodicNote(ctx, hit.type, hit.note, when, hit.velocity)
      } else {
        const maxKickDur = hit.type === 'kick'
          ? (() => {
              const idx = kickTimes.indexOf(hit.time)
              const next = kickTimes[idx + 1] ?? Infinity
              return Math.min(0.45, next - hit.time - 0.01)
            })()
          : 0.45
        playDrumHit(ctx, 'synth', hit.type, when, hit.velocity, hit.note, maxKickDur)
      }
    }

    playStartRef.current = { wallTime: performance.now(), beatTime: startFrom }
    setIsPlaying(true)
  }

  function startPlayback() { startPlaybackFrom(playhead >= duration ? 0 : playhead) }

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

  function togglePlay() { if (isPlaying) stopPlayback(); else startPlayback() }

  // ── Loop playback ─────────────────────────────────────────────────────────

  function startLoopPlayback() {
    if (!loopBuffer) return
    stopLoopPlayback()
    const ctx = new AudioContext()
    loopCtxRef.current = ctx
    const src = ctx.createBufferSource()
    src.buffer = loopBuffer
    src.loop = true
    if (loopDetectedBpm && loopTargetBpm) {
      src.playbackRate.value = loopTargetBpm / loopDetectedBpm
    }
    src.connect(ctx.destination)
    src.start()
    loopSrcRef.current = src
    src.onended = () => setLoopPlaying(false)
    setLoopPlaying(true)
  }

  function stopLoopPlayback() {
    loopSrcRef.current?.stop()
    loopSrcRef.current = null
    loopCtxRef.current?.close()
    loopCtxRef.current = null
    setLoopPlaying(false)
  }

  function updateLoopRate(targetBpm: number) {
    setLoopTargetBpm(targetBpm)
    if (loopSrcRef.current && loopDetectedBpm) {
      loopSrcRef.current.playbackRate.value = targetBpm / loopDetectedBpm
    }
  }

  // ── Hit editing ────────────────────────────────────────────────────────────

  const moveHit = useCallback((id: string, t: number, note: number) => {
    setHits(prev => prev.map(h => h.id === id ? { ...h, time: t, note } : h).sort((a, b) => a.time - b.time))
  }, [])

  const deleteHit = useCallback((id: string) => {
    setHits(prev => prev.filter(h => h.id !== id))
    setSelectedId(null)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (phase !== 'editing') return
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
        e.preventDefault()
        deleteHit(selectedId)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [phase, selectedId, deleteHit])

  function addHit(type: BeatType, t: number, note: number) {
    const newHit: BeatHit = { id: crypto.randomUUID(), time: t, type, velocity: 0.7, note }
    setHits(prev => [...prev, newHit].sort((a, b) => a.time - b.time))
    setSelectedId(newHit.id)
  }

  function changeSelectedType(type: BeatType) {
    if (!selectedId) return
    setHits(prev => prev.map(h => {
      if (h.id !== selectedId) return h
      if (type !== h.type && h.spectral) {
        correctionsAdd({
          id:          crypto.randomUUID(),
          spectral:    h.spectral,
          detectedAs:  h.type,
          correctedTo: type,
          savedAt:     new Date().toISOString(),
        }).catch(() => {})
      }
      return { ...h, type }
    }))
    setShowTypeMenu(false)
  }

  function rejectAiForHit(hitId: string) {
    if (!aiSuggestions) return
    const suggested = aiSuggestions.get(hitId)
    if (!suggested) return
    // Save inverse: AI said X, but the current label Y is correct
    const hit = hits.find(h => h.id === hitId)
    if (hit && hit.spectral && suggested !== hit.type) {
      correctionsAdd({
        id:          crypto.randomUUID(),
        spectral:    hit.spectral,
        detectedAs:  suggested,
        correctedTo: hit.type,
        savedAt:     new Date().toISOString(),
      }).catch(() => {})
    }
    setAiSuggestions(prev => {
      if (!prev) return null
      const next = new Map(prev)
      next.delete(hitId)
      return next.size > 0 ? next : null
    })
  }

  function applyAiSuggestions() {
    if (!aiSuggestions) return
    const sixteenth = bpm ? (60 / bpm) / 4 : null
    setHits(prev => {
      let updated = prev.map(h => {
        const suggested = aiSuggestions.get(h.id)
        if (!suggested || suggested === h.type) return h
        if (h.spectral) {
          correctionsAdd({
            id:          crypto.randomUUID(),
            spectral:    h.spectral,
            detectedAs:  h.type,
            correctedTo: suggested,
            savedAt:     new Date().toISOString(),
          }).catch(() => {})
        }
        return { ...h, type: suggested }
      })
      if (sixteenth) {
        updated = updated.map(h => ({ ...h, time: Math.round(h.time / sixteenth) * sixteenth }))
      }
      return updated
    })
    setAiSuggestions(null)
  }

  function acceptAiForHit(hitId: string) {
    if (!aiSuggestions) return
    const suggested = aiSuggestions.get(hitId)
    if (!suggested) return
    setHits(prev => prev.map(h => {
      if (h.id !== hitId) return h
      if (h.spectral && suggested !== h.type) {
        correctionsAdd({
          id:          crypto.randomUUID(),
          spectral:    h.spectral,
          detectedAs:  h.type,
          correctedTo: suggested,
          savedAt:     new Date().toISOString(),
        }).catch(() => {})
      }
      return { ...h, type: suggested }
    }))
    setAiSuggestions(prev => {
      if (!prev) return null
      const next = new Map(prev)
      next.delete(hitId)
      return next.size > 0 ? next : null
    })
  }

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
    setAudioBuf(null)
    setMutedTypes(new Set())
    setAiSuggestions(null)
    setAiLoading(false)
    stopLoopPlayback()
    setLoopBuffer(null)
    setLoopDetectedBpm(null)
  }

  function toggleMute(type: BeatType) {
    setMutedTypes(prev => {
      const next = new Set(prev)
      if (next.has(type)) next.delete(type); else next.add(type)
      return next
    })
  }

  function toggleSelectedType(type: BeatType) {
    setSelectedTypes(prev => {
      const next = new Set(prev)
      if (next.has(type) && next.size > 1) next.delete(type)
      else next.add(type)
      return next
    })
  }

  // Lanes: selected drum types + every type that actually has a hit
  const activeLaneTypes = useMemo(() => {
    const set = new Set<BeatType>()
    if (instrumentFamily === 'drums') selectedTypes.forEach(t => set.add(t))
    hits.forEach(h => set.add(h.type))
    return Array.from(set).sort((a, b) => {
      const ai = ALL_DRUM_TYPES.indexOf(a), bi = ALL_DRUM_TYPES.indexOf(b)
      if (ai !== -1 && bi !== -1) return ai - bi
      if (ai !== -1) return -1
      if (bi !== -1) return 1
      return 0
    })
  }, [hits, instrumentFamily, selectedTypes])

  const hitsByType = useMemo(() => {
    const map = new Map<BeatType, BeatHit[]>()
    for (const t of activeLaneTypes) map.set(t, [])
    for (const h of hits) {
      if (!map.has(h.type)) map.set(h.type, [])
      map.get(h.type)!.push(h)
    }
    return map
  }, [hits, activeLaneTypes])

  const selectedHit = hits.find(h => h.id === selectedId) ?? null
  const activeHitCount = hits.filter(h => !mutedTypes.has(h.type)).length

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-base)', userSelect: 'none' }}>

      {/* ── Toolbar ───────────────────────────────────────────────────────── */}
      <div style={{
        height: 44, display: 'flex', alignItems: 'center', gap: 10,
        padding: '0 14px', borderBottom: '1px solid var(--border)',
        background: 'var(--bg-surface)', flexShrink: 0,
      }}>
        {phase === 'idle' && (
          <button onClick={startRecording} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 6, background: '#dc2626', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
            <Mic size={13} /> Record
          </button>
        )}
        {phase === 'recording' && (
          <>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#dc2626', animation: 'pulse 1s ease-in-out infinite' }} />
            <span style={{ fontSize: 12, fontFamily: 'monospace', color: '#dc2626', minWidth: 52 }}>{recordingTime.toFixed(1)}s</span>
            <button onClick={stopRecording} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 6, background: 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid var(--border)', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
              <Square size={11} fill="currentColor" /> Stop
            </button>
          </>
        )}
        {phase === 'analyzing' && (
          <span style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 7 }}>
            <RefreshCw size={13} style={{ animation: 'spin 1s linear infinite' }} /> Analyzing…
          </span>
        )}

        {phase === 'editing' && (
          <>
            <button onClick={togglePlay} style={{ width: 30, height: 30, borderRadius: '50%', background: 'var(--accent)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', flexShrink: 0 }}>
              {isPlaying ? <Pause size={13} fill="#fff" /> : <Play size={13} fill="#fff" style={{ marginLeft: 1 }} />}
            </button>

            {/* Instrument family badge */}
            <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
              {FAMILY_LABEL[instrumentFamily]}
            </span>

            {/* BPM */}
            {bpm && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>BPM</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'monospace' }}>{bpm}</span>
              </div>
            )}

            {/* Selected hit */}
            {selectedHit && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 8px', borderRadius: 6, background: 'var(--bg-card)', border: '1px solid var(--border)', marginLeft: 6 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: TYPE_COLORS[selectedHit.type], flexShrink: 0 }} />
                <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                  {TYPE_LABELS[selectedHit.type]} @ {selectedHit.time.toFixed(2)}s
                  {selectedHit.note !== undefined && <span style={{ marginLeft: 5, color: 'var(--accent-light)' }}>{midiName(selectedHit.note)}</span>}
                </span>
                {aiSuggestions?.get(selectedHit.id) && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 6px', borderRadius: 4, background: 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.3)' }}>
                    <span style={{ fontSize: 9, color: 'rgba(139,92,246,0.8)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>AI says</span>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: TYPE_COLORS[aiSuggestions.get(selectedHit.id)!] }} />
                    <span style={{ fontSize: 10, color: 'var(--accent-light)' }}>{TYPE_LABELS[aiSuggestions.get(selectedHit.id)!]}</span>
                    <button onClick={() => acceptAiForHit(selectedHit.id)} title="Accept — AI is right" style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: 'var(--accent)', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 700 }}>✓</button>
                    <button onClick={() => rejectAiForHit(selectedHit.id)} title="Reject — current label is correct" style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: 'rgba(239,68,68,0.15)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)', cursor: 'pointer', fontWeight: 700 }}>✕</button>
                  </div>
                )}
                <div style={{ position: 'relative' }}>
                  <button onClick={() => setShowTypeMenu(v => !v)} style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, padding: '2px 5px', borderRadius: 4, background: 'var(--border)', color: 'var(--text-secondary)', border: 'none', cursor: 'pointer' }}>
                    Change <ChevronDown size={10} />
                  </button>
                  {showTypeMenu && (
                    <>
                      <div style={{ position: 'fixed', inset: 0, zIndex: 40 }} onClick={() => setShowTypeMenu(false)} />
                      <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: 4, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 6, zIndex: 50, overflow: 'hidden', minWidth: 130, maxHeight: 280, overflowY: 'auto' }}>
                        {activeLaneTypes.map(t => (
                          <button key={t} onClick={() => changeSelectedType(t)} style={{ display: 'flex', alignItems: 'center', gap: 7, width: '100%', padding: '6px 10px', background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 11, color: 'var(--text-primary)', textAlign: 'left' }}
                            onMouseEnter={e => (e.currentTarget.style.background = 'var(--border)')}
                            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                          >
                            <div style={{ width: 7, height: 7, borderRadius: '50%', background: TYPE_COLORS[t], flexShrink: 0 }} /> {TYPE_LABELS[t]}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
                <button onClick={() => selectedId && deleteHit(selectedId)} style={{ padding: '2px 5px', borderRadius: 4, background: 'transparent', border: 'none', cursor: 'pointer', color: '#ef4444' }}>
                  <Trash2 size={11} />
                </button>
              </div>
            )}

            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
              {/* Two-sided learning status */}
              {referenceSounds.length > 0 && (
                <span style={{ fontSize: 10, color: 'var(--text-muted)', padding: '2px 6px', borderRadius: 4, background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
                  ◈ {referenceSounds.length} ref
                </span>
              )}
              {/* AI status */}
              {aiLoading && (
                <span style={{ fontSize: 10, color: 'var(--accent-light)', display: 'flex', alignItems: 'center', gap: 5 }}>
                  <RefreshCw size={10} style={{ animation: 'spin 1s linear infinite' }} /> AI checking…
                </span>
              )}
              {aiSuggestions && aiSuggestions.size > 0 && !aiLoading && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 8px', borderRadius: 6, background: 'rgba(139,92,246,0.12)', border: '1px solid rgba(139,92,246,0.3)' }}>
                  <span style={{ fontSize: 10, color: 'var(--accent-light)' }}>
                    ✦ AI: {aiSuggestions.size} correction{aiSuggestions.size !== 1 ? 's' : ''}
                  </span>
                  <button onClick={applyAiSuggestions} title="Accept all — saves corrections for learning" style={{ fontSize: 10, padding: '2px 7px', borderRadius: 4, background: 'var(--accent)', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 600 }}>
                    Apply all
                  </button>
                  <button onClick={() => setAiSuggestions(null)} title="Dismiss — ignore suggestions without saving" style={{ fontSize: 10, padding: '2px 5px', borderRadius: 4, background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>Dismiss</button>
                </div>
              )}
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                {activeHitCount} active{mutedTypes.size > 0 && ` · ${hits.length - activeHitCount} muted`}
              </span>
              <button onClick={reset} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, padding: '4px 9px', borderRadius: 5, background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-secondary)', cursor: 'pointer' }}>
                <RefreshCw size={11} /> Re-record
              </button>
            </div>
          </>
        )}
      </div>

      {/* ── Content ───────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0 }}>

        {phase === 'idle' && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 18, padding: 40, overflowY: 'auto' }}>
            {/* Mode selector */}
            <div style={{ display: 'flex', gap: 2, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: 3 }}>
              {(['hits', 'loop'] as RecMode[]).map(m => (
                <button key={m} onClick={() => setRecMode(m)} style={{ padding: '5px 16px', borderRadius: 6, border: 'none', cursor: 'pointer', background: recMode === m ? 'var(--border-light)' : 'transparent', color: recMode === m ? 'var(--text-primary)' : 'var(--text-muted)', fontSize: 12, fontWeight: recMode === m ? 600 : 400, transition: 'all 0.15s' }}>
                  {m === 'hits' ? 'Beat Grid' : 'Loop'}
                </button>
              ))}
            </div>

            <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'rgba(220,38,38,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid rgba(220,38,38,0.3)' }}>
              <Mic size={28} color="#dc2626" />
            </div>
            <div style={{ textAlign: 'center', maxWidth: 360 }}>
              {recMode === 'hits' ? (
                <>
                  <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>Beatbox your rhythm</p>
                  <p style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.7 }}>
                    Select which sounds you&apos;ll beatbox, then hit Record.
                    Hits snap to the detected tempo grid.
                  </p>
                </>
              ) : (
                <>
                  <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>Record a loop</p>
                  <p style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.7 }}>
                    Record any rhythm or sound. 100Lights detects the tempo and
                    creates a loopable clip you can stretch to any BPM.
                  </p>
                </>
              )}
            </div>

            {/* Instrument selector — hits mode only */}
            {recMode === 'hits' && <div style={{ width: '100%', maxWidth: 420 }}>
              {/* Family tabs */}
              <div style={{ display: 'flex', gap: 3, marginBottom: 12, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: 3 }}>
                {(['drums', 'guitar', 'piano', 'synth'] as InstrumentFamily[]).map(f => (
                  <button key={f} onClick={() => setInstrumentFamily(f)} style={{
                    flex: 1, padding: '5px 8px', borderRadius: 6, border: 'none', cursor: 'pointer',
                    background: instrumentFamily === f ? 'var(--border-light)' : 'transparent',
                    color: instrumentFamily === f ? 'var(--text-primary)' : 'var(--text-muted)',
                    fontSize: 12, fontWeight: instrumentFamily === f ? 600 : 400, transition: 'all 0.15s',
                  }}>
                    {FAMILY_LABEL[f]}
                  </button>
                ))}
              </div>

              {/* Drums: sound type grid */}
              {instrumentFamily === 'drums' && (
                <>
                  <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8, textAlign: 'center' }}>
                    Sounds to detect
                  </p>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
                    {ALL_DRUM_TYPES.map(type => {
                      const active = selectedTypes.has(type)
                      const color = TYPE_COLORS[type]
                      return (
                        <button key={type} onClick={() => toggleSelectedType(type)} style={{
                          padding: '8px 4px', borderRadius: 7,
                          border: `1.5px solid ${active ? color : 'var(--border)'}`,
                          background: active ? `${color}18` : 'var(--bg-card)',
                          cursor: 'pointer', color: active ? color : 'var(--text-muted)',
                          fontSize: 11, fontWeight: active ? 700 : 400,
                          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5,
                          transition: 'all 0.15s',
                        }}>
                          <div style={{ width: 8, height: 8, borderRadius: '50%', background: active ? color : 'var(--border)' }} />
                          {TYPE_LABELS[type]}
                        </button>
                      )
                    })}
                  </div>
                </>
              )}

              {/* Melodic: variant picker */}
              {instrumentFamily !== 'drums' && (
                <>
                  <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8, textAlign: 'center' }}>
                    Select variant
                  </p>
                  <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                    {FAMILY_VARIANTS[instrumentFamily as Exclude<InstrumentFamily, 'drums'>].map(type => {
                      const active = melodicVariant === type
                      const color = TYPE_COLORS[type]
                      return (
                        <button key={type} onClick={() => setMelodicVariant(type)} style={{
                          padding: '10px 16px', borderRadius: 8, flex: 1,
                          border: `1.5px solid ${active ? color : 'var(--border)'}`,
                          background: active ? `${color}18` : 'var(--bg-card)',
                          cursor: 'pointer', color: active ? color : 'var(--text-muted)',
                          fontSize: 12, fontWeight: active ? 700 : 400,
                          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5,
                          transition: 'all 0.15s',
                        }}>
                          <div style={{ width: 8, height: 8, borderRadius: '50%', background: active ? color : 'var(--border)' }} />
                          {TYPE_LABELS[type]}
                        </button>
                      )
                    })}
                  </div>
                  <p style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', marginTop: 10, lineHeight: 1.6 }}>
                    Hum or play a melody — each note will be mapped to the {FAMILY_LABEL[instrumentFamily].toLowerCase()} sound
                  </p>
                </>
              )}
            </div>}

            {hasSong && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer', userSelect: 'none' }}>
                <input
                  type="checkbox"
                  checked={playSongDuringRec}
                  onChange={e => setPlaySongDuringRec(e.target.checked)}
                  style={{ width: 14, height: 14, accentColor: 'var(--accent)', cursor: 'pointer' }}
                />
                Play song while recording
              </label>
            )}
            {error && <p style={{ fontSize: 12, color: '#ef4444', textAlign: 'center' }}>{error}</p>}
            <button onClick={startRecording} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 22px', borderRadius: 8, background: '#dc2626', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 600 }}>
              <Mic size={15} /> {recMode === 'loop' ? 'Start Loop Recording' : 'Start Recording'}
            </button>

            {/* Ground truth — helps AI correct misclassifications */}
            {instrumentFamily === 'drums' && (
              <div style={{ width: '100%', maxWidth: 320 }}>
                <button
                  onClick={() => setShowGroundTruth(v => !v)}
                  style={{ fontSize: 11, color: groundTruth.trim() ? 'var(--accent-light)' : 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 3 }}
                >
                  {groundTruth.trim()
                    ? `✓ Pattern declared — AI will use as ground truth`
                    : '+ Declare your pattern (helps AI learn)'}
                </button>
                {showGroundTruth && (
                  <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <p style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.6, margin: 0 }}>
                      Describe what you&apos;ll beatbox, e.g. &quot;kick snare kick snare with hihats on every beat&quot;.
                      AI will compare its detections against this and fix mistakes.
                    </p>
                    <textarea
                      value={groundTruth}
                      onChange={e => setGroundTruth(e.target.value)}
                      placeholder="e.g. 4-on-floor kick pattern, snare on 2 and 4, closed hihats on every 8th note"
                      rows={2}
                      style={{ width: '100%', padding: '7px 10px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: 11, lineHeight: 1.5, resize: 'none', boxSizing: 'border-box', fontFamily: 'inherit' }}
                    />
                  </div>
                )}
              </div>
            )}

          </div>
        )}

        {phase === 'recording' && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 20 }}>
            <div style={{ width: 80, height: 80, borderRadius: '50%', background: 'rgba(220,38,38,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid rgba(220,38,38,0.5)', animation: 'pulse 0.8s ease-in-out infinite' }}>
              <Mic size={36} color="#dc2626" />
            </div>
            <div style={{ textAlign: 'center' }}>
              <p style={{ fontSize: 32, fontFamily: 'monospace', fontWeight: 700, color: '#dc2626' }}>{recordingTime.toFixed(1)}s</p>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
                {recMode === 'loop'
                  ? 'Recording loop…'
                  : instrumentFamily === 'drums'
                    ? `Detecting: ${Array.from(selectedTypes).map(t => TYPE_LABELS[t]).join(', ')}`
                    : `Detecting melody → ${TYPE_LABELS[melodicVariant]} (${FAMILY_LABEL[instrumentFamily]})`}
              </p>
              {startedSongRef.current && (
                <p style={{ fontSize: 11, color: 'var(--accent-light)', marginTop: 2 }}>♪ Song playing in background</p>
              )}
              <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Click Stop when done</p>
            </div>
          </div>
        )}

        {phase === 'analyzing' && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14 }}>
            <RefreshCw size={32} color="var(--accent)" style={{ animation: 'spin 1s linear infinite' }} />
            <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Detecting hits and snapping to grid…</p>
          </div>
        )}

        {/* ── Loop editing ──────────────────────────────────────────────── */}
        {phase === 'editing' && recMode === 'loop' && loopBuffer && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 24, padding: 40 }}>
            <Waveform audioBuffer={loopBuffer} pxWidth={Math.min(600, timelinePx || 600)} />
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
              {loopDetectedBpm && (
                <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                  Detected BPM: <strong style={{ color: 'var(--text-primary)' }}>{loopDetectedBpm}</strong>
                </p>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 12, color: 'var(--text-muted)', minWidth: 70 }}>Target BPM</span>
                <input
                  type="range" min={40} max={220} step={1} value={loopTargetBpm}
                  onChange={e => updateLoopRate(Number(e.target.value))}
                  style={{ width: 180 }}
                />
                <span style={{ fontSize: 13, fontWeight: 700, fontFamily: 'monospace', color: 'var(--text-primary)', minWidth: 36 }}>
                  {loopTargetBpm}
                </span>
                {loopDetectedBpm && loopTargetBpm !== loopDetectedBpm && (
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    {((loopTargetBpm / loopDetectedBpm) * 100 - 100).toFixed(0)}%
                  </span>
                )}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={loopPlaying ? stopLoopPlayback : startLoopPlayback} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '8px 18px', borderRadius: 7, background: 'var(--accent)', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                {loopPlaying ? <><Pause size={14} fill="#fff" /> Stop</> : <><Play size={14} fill="#fff" style={{ marginLeft: 1 }} /> Play Loop</>}
              </button>
              <button onClick={reset} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '8px 14px', borderRadius: 7, background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-secondary)', cursor: 'pointer' }}>
                <RefreshCw size={12} /> Re-record
              </button>
            </div>
          </div>
        )}

        {phase === 'editing' && recMode === 'hits' && duration > 0 && (
          <div ref={timelineRef} style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>

            <Playhead time={playhead} duration={duration} pxWidth={timelinePx} />

            {/* Ruler */}
            <div style={{ paddingLeft: 88 }}>
              <RulerTicks duration={duration} px={timelinePx} onSeek={handleSeek} />
            </div>

            {/* Waveform */}
            {audioBuf && <Waveform audioBuffer={audioBuf} pxWidth={timelinePx} />}

            {/* Lanes */}
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {activeLaneTypes.map(type => (
                <div key={type} style={{ display: 'flex' }}>
                  <NoteAxis />
                  <Lane
                    type={type}
                    hits={hitsByType.get(type) ?? []}
                    duration={duration}
                    pxWidth={timelinePx}
                    selectedId={selectedId}
                    muted={mutedTypes.has(type)}
                    aiSuggestions={aiSuggestions}
                    onSelect={setSelectedId}
                    onMoveHit={moveHit}
                    onDeleteHit={deleteHit}
                    onAddHit={(t, note) => addHit(type, t, note)}
                    onToggleMute={() => toggleMute(type)}
                  />
                </div>
              ))}
            </div>

            {/* Legend */}
            <div style={{ padding: '5px 10px', borderTop: '1px solid var(--border)', background: 'var(--bg-surface)', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
              {activeLaneTypes.map(t => (
                <span key={t} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: mutedTypes.has(t) ? 'var(--text-muted)' : 'var(--text-secondary)', opacity: mutedTypes.has(t) ? 0.5 : 1 }}>
                  <div style={{ width: 7, height: 7, borderRadius: '50%', background: TYPE_COLORS[t] }} />
                  {TYPE_LABELS[t]} ({hitsByType.get(t)?.length ?? 0})
                </span>
              ))}
              <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--border-light)' }}>
                Click ruler to seek · Click lane to add · Drag X=time Y=pitch · Dbl-click to delete
              </span>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
