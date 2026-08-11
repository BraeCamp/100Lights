'use client'

/**
 * BeatMaker — a standalone, chrome-free browser drum machine.
 *
 * A step grid (drum lanes × 16 sixteenth-note steps), a kit picker, pattern
 * presets, transport (look-ahead Web Audio scheduler), tempo + swing, a moving
 * step indicator, and MIDI/WAV export. It is deliberately self-contained: it
 * reuses the shared *libraries* (lane list, kits, patterns, drum synthesis, MIDI
 * writer, WAV encoder) but does NOT touch the DAW/useDaw state — so it works on a
 * plain page with nothing seeded.
 *
 * Sound path: lib/drum-synth.ts pure-math voices, synthesised once into
 * AudioBuffers per lane (no IndexedDB, no sample packs, no seeding). Kits re-voice
 * the same pattern by applying each kit's per-pad volume/pitch (lib/drum-presets
 * DRUM_KITS) as a GainNode + playbackRate at schedule time.
 *
 * One shared AudioContext, created/resumed inside a user-gesture handler.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DRUM_LANES, STEPS_PER_BAR, STEP_BEATS, DRUM_KITS, DRUM_PATTERNS, DEFAULT_KIT,
  type DrumKit, type DrumPattern,
} from '@/lib/drum-presets'
import {
  synthKick, synth808, synthSnare, synthHat, synthClap, synthTom, synthRim, synthCrash,
} from '@/lib/drum-synth'
import { writeMidiFile } from '@/lib/midi-file'
import { audioBufferToWav } from '@/lib/wav-encoder'
import { openSketchInStudio } from '@/lib/open-in-studio'
import { useAppShellOptional } from '@/components/apps/AppChrome'
import type { MidiNote } from '@/lib/daw-types'
import type { DrumPadSettings } from '@/lib/daw-types'

// Play/record-feel animation styles. 'random' resolves to a concrete one when the
// app opens (so each session feels a little different); 'off' disables them.
type AnimStyle = 'off' | 'pulse' | 'ripple' | 'bounce' | 'random'
const ANIM_CONCRETE: Exclude<AnimStyle, 'random' | 'off'>[] = ['pulse', 'ripple', 'bounce']
const ANIM_KEY = 'beatmaker-anim'

const MIN_BPM = 40
const MAX_BPM = 300
const LOOKAHEAD_S = 0.12    // schedule this far ahead of the audio clock
const TICK_MS = 25          // scheduler wakeup interval
const EXPORT_BARS = 2       // WAV loop length

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const clampBpm = (v: number) => clamp(Math.round(v), MIN_BPM, MAX_BPM)

type Grid = Record<string, boolean[]>

const emptyGrid = (): Grid =>
  Object.fromEntries(DRUM_LANES.map(l => [l.key, new Array(STEPS_PER_BAR).fill(false)]))

const gridFromPattern = (p: DrumPattern): Grid => {
  const g = emptyGrid()
  for (const key of Object.keys(p.hits)) {
    if (!g[key]) continue
    for (const s of p.hits[key]) if (s >= 0 && s < STEPS_PER_BAR) g[key][s] = true
  }
  return g
}

// ── Lane → pure-synth voice (rendered once per AudioContext sample rate) ────────
// Kit-aware: the kick lane uses the deep 808 sub for '808' packs, and the snare/hat lanes use
// the kit's VOICE timbre — so kits differ in character, not just per-pad volume/pitch.
function synthLaneData(laneKey: string, sr: number, pack: string, voices?: DrumKit['voices']): Float32Array {
  switch (laneKey) {
    case 'kick':      return pack === '808' ? synth808(sr) : synthKick(sr)
    case 'snare':     return synthSnare(sr, voices?.snare ?? 'acoustic')
    case 'closedHat': return synthHat(sr, false, voices?.hat ?? 'normal')
    case 'openHat':   return synthHat(sr, true, voices?.hat ?? 'normal')
    case 'clap':      return synthClap(sr)
    case 'crash':     return synthCrash(sr)
    case 'rim':       return synthRim(sr)
    case 'tomHi':     return synthTom(sr, 165)
    case 'tomMid':    return synthTom(sr, 120)
    case 'tomLo':     return synthTom(sr, 85)
    default:          return synthKick(sr)
  }
}

/** Build one AudioBuffer per lane for a given context + kit voices (works online + offline). */
function buildLaneBuffers(ctx: BaseAudioContext, pack: string, voices?: DrumKit['voices']): Map<string, AudioBuffer> {
  const sr = ctx.sampleRate
  const m = new Map<string, AudioBuffer>()
  for (const l of DRUM_LANES) {
    const data = synthLaneData(l.key, sr, pack, voices)
    const buf = ctx.createBuffer(1, data.length, sr)
    buf.getChannelData(0).set(data)
    m.set(l.key, buf)
  }
  return m
}

/** Per-lane voicing (gain + semitone pitch) for the selected kit's pad settings. */
function laneVoicing(kit: DrumKit): Record<string, { gain: number; rate: number }> {
  const params = kit.instrument.params as { pads?: Record<number, DrumPadSettings> }
  const pads = params.pads
  const out: Record<string, { gain: number; rate: number }> = {}
  for (const l of DRUM_LANES) {
    const pad = pads?.[l.pitch]
    const gain = pad?.volume ?? 0.85
    const semis = pad?.pitch ?? 0
    out[l.key] = { gain, rate: Math.pow(2, semis / 12) }
  }
  return out
}

const LS_KEY = 'beatmaker-v1'
const SWING_MAX = 0.5

// `onPattern` (optional) surfaces the current grid as beat-based MidiNotes so a host app — the
// Firefly sketchpad — can fold the beat into a project. The standalone /apps/beatmaker page
// passes nothing, so its behavior is unchanged.
export default function BeatMaker({ onPattern, restore }: {
  onPattern?: (notes: MidiNote[]) => void
  restore?: { notes: MidiNote[]; nonce: number }
} = {}) {
  const [grid, setGrid] = useState<Grid>(emptyGrid)
  const [bpm, setBpm] = useState(120)
  const [bpmText, setBpmText] = useState('120')
  const [swing, setSwing] = useState(0)
  const [kitId, setKitId] = useState(DEFAULT_KIT.id)
  const [patternId, setPatternId] = useState('')
  const [playing, setPlaying] = useState(false)
  const [displayStep, setDisplayStep] = useState(-1)
  const [loaded, setLoaded] = useState(false)
  const [recording, setRecording] = useState(false)
  const [animStyle, setAnimStyle] = useState<AnimStyle>('pulse')
  const [resolvedAnim, setResolvedAnim] = useState<Exclude<AnimStyle, 'random'>>('pulse')
  const [savedNote, setSavedNote] = useState('')
  const [tapNonce, setTapNonce] = useState<Record<string, number>>({})   // per-pad click flash (light up only on tap)

  // Optional — present on the standalone /apps/beatmaker page (inside AppChrome), absent when
  // BeatMaker is embedded (Firefly). Gates Save-to-history and the History restore hook.
  const shell = useAppShellOptional()

  const kit = useMemo(() => DRUM_KITS.find(k => k.id === kitId) ?? DEFAULT_KIT, [kitId])

  // Resolve the play-animation style once on open. 'random' picks a concrete style for the session.
  useEffect(() => {
    let stored: AnimStyle = 'pulse'
    try { const s = localStorage.getItem(ANIM_KEY) as AnimStyle | null; if (s) stored = s } catch { /* off */ }
    setAnimStyle(stored)
    setResolvedAnim(stored === 'random' ? ANIM_CONCRETE[Math.floor(Math.random() * ANIM_CONCRETE.length)] : (stored === 'off' ? 'off' : stored))
  }, [])
  const changeAnim = useCallback((s: AnimStyle) => {
    setAnimStyle(s)
    setResolvedAnim(s === 'random' ? ANIM_CONCRETE[Math.floor(Math.random() * ANIM_CONCRETE.length)] : (s === 'off' ? 'off' : s))
    try { localStorage.setItem(ANIM_KEY, s) } catch { /* off */ }
  }, [])

  // Surface the grid to an embedding host (Firefly) as beat-based drum MidiNotes (GM pitches,
  // 16th-note grid). No-op on the standalone page.
  useEffect(() => {
    if (!onPattern) return
    const notes: MidiNote[] = []
    for (const lane of DRUM_LANES) {
      const row = grid[lane.key] || []
      for (let s = 0; s < row.length; s++) {
        if (row[s]) notes.push({ id: crypto.randomUUID(), pitch: lane.pitch, startBeat: s * STEP_BEATS, durationBeats: STEP_BEATS, velocity: 100 })
      }
    }
    onPattern(notes)
  }, [grid, onPattern])

  // Restore a saved beat grid (Firefly "open sketch") from its drum notes.
  const restoreNonce = restore?.nonce
  useEffect(() => {
    if (!restore) return
    const g = emptyGrid()
    for (const n of restore.notes ?? []) {
      const lane = DRUM_LANES.find(l => l.pitch === n.pitch)
      if (!lane) continue
      const step = Math.round(n.startBeat / STEP_BEATS)
      if (step >= 0 && step < STEPS_PER_BAR) g[lane.key][step] = true
    }
    setGrid(g)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restoreNonce])

  // ── Refs the scheduler/rAF read without re-subscribing ────────────────────────
  const ctxRef = useRef<AudioContext | null>(null)
  const buffersRef = useRef<Map<string, AudioBuffer> | null>(null)
  const gridRef = useRef(grid); useEffect(() => { gridRef.current = grid }, [grid])
  const bpmRef = useRef(bpm); useEffect(() => { bpmRef.current = bpm }, [bpm])
  const swingRef = useRef(swing); useEffect(() => { swingRef.current = swing }, [swing])
  const voicingRef = useRef(laneVoicing(kit))
  useEffect(() => { voicingRef.current = laneVoicing(kit) }, [kit])
  // The kit's PACK ('synth'|'808') + VOICE timbres (snare/hat) decide the synth voices. Mirror
  // them in refs and rebuild the lane buffers whenever the kit changes so switching kits actually
  // swaps the kick/snare/hat character (per-pad volume/pitch stays live via voicingRef).
  const pack = useMemo(() => ((kit.instrument.params as { pack?: string }).pack === '808' ? '808' : 'synth'), [kit])
  const packRef = useRef(pack)
  const voicesRef = useRef(kit.voices)
  const buildSig = `${pack}|${kit.voices?.snare ?? 'acoustic'}|${kit.voices?.hat ?? 'normal'}`
  useEffect(() => {
    packRef.current = pack
    voicesRef.current = kit.voices
    if (ctxRef.current) buffersRef.current = buildLaneBuffers(ctxRef.current, pack, kit.voices)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildSig])

  const timerRef = useRef<number | null>(null)
  const rafRef = useRef<number | null>(null)
  const nextStepTimeRef = useRef(0)   // audio-clock time of the next step to schedule
  const stepRef = useRef(0)           // index of the next step to schedule
  const queueRef = useRef<Array<{ step: number; time: number }>>([])  // for the visual playhead
  const loopStartRef = useRef(0)      // audio-clock time step 0 fires (for record quantize)
  const recordingRef = useRef(false); useEffect(() => { recordingRef.current = recording }, [recording])

  // ── Persistence ───────────────────────────────────────────────────────────────
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY)
      if (raw) {
        const s = JSON.parse(raw) as Partial<{ grid: Grid; bpm: number; swing: number; kitId: string }>
        if (s.grid) {
          const g = emptyGrid()
          for (const l of DRUM_LANES) if (Array.isArray(s.grid[l.key])) {
            for (let i = 0; i < STEPS_PER_BAR; i++) g[l.key][i] = !!s.grid[l.key][i]
          }
          setGrid(g)
        }
        if (typeof s.bpm === 'number') { const b = clampBpm(s.bpm); setBpm(b); setBpmText(String(b)) }
        if (typeof s.swing === 'number') setSwing(clamp(s.swing, 0, SWING_MAX))
        if (typeof s.kitId === 'string' && DRUM_KITS.some(k => k.id === s.kitId)) setKitId(s.kitId)
      }
    } catch { /* storage off / bad json */ }
    setLoaded(true)
  }, [])

  useEffect(() => {
    if (!loaded) return
    try { localStorage.setItem(LS_KEY, JSON.stringify({ grid, bpm, swing, kitId })) } catch { /* off */ }
  }, [grid, bpm, swing, kitId, loaded])

  // ── AudioContext + lane buffers ───────────────────────────────────────────────
  const ensureCtx = useCallback((): AudioContext => {
    if (!ctxRef.current) {
      const c = new AudioContext()
      ctxRef.current = c
      buffersRef.current = buildLaneBuffers(c, packRef.current, voicesRef.current)
    }
    return ctxRef.current
  }, [])

  // Fire one drum hit into a destination at an absolute audio-clock time.
  const triggerHit = useCallback((
    ctx: BaseAudioContext, buffers: Map<string, AudioBuffer>,
    voicing: Record<string, { gain: number; rate: number }>,
    laneKey: string, time: number, dest: AudioNode,
  ) => {
    const buf = buffers.get(laneKey)
    if (!buf) return
    const v = voicing[laneKey] ?? { gain: 0.85, rate: 1 }
    const src = ctx.createBufferSource()
    src.buffer = buf
    src.playbackRate.value = v.rate
    const g = ctx.createGain()
    g.gain.value = v.gain
    src.connect(g); g.connect(dest)
    src.start(time)
    src.onended = () => { try { src.disconnect(); g.disconnect() } catch { /* torn down */ } }
  }, [])

  // ── Look-ahead scheduler ──────────────────────────────────────────────────────
  const scheduler = useCallback(() => {
    const c = ctxRef.current, buffers = buffersRef.current
    if (!c || !buffers) return
    const secPerStep = 60 / bpmRef.current / 4        // one 16th note
    while (nextStepTimeRef.current < c.currentTime + LOOKAHEAD_S) {
      const step = stepRef.current
      // Swing: push the off-16ths (odd steps) later by up to half a step.
      const offset = (step % 2 === 1) ? swingRef.current * secPerStep : 0
      const t = nextStepTimeRef.current + offset
      const g = gridRef.current
      for (const l of DRUM_LANES) {
        if (g[l.key]?.[step]) triggerHit(c, buffers, voicingRef.current, l.key, t, c.destination)
      }
      queueRef.current.push({ step, time: t })
      nextStepTimeRef.current += secPerStep
      stepRef.current = (step + 1) % STEPS_PER_BAR
    }
  }, [triggerHit])

  const drawStep = useCallback(() => {
    const c = ctxRef.current
    if (c) {
      const q = queueRef.current
      while (q.length && q[0].time <= c.currentTime) {
        const n = q.shift()!
        setDisplayStep(n.step)
      }
    }
    rafRef.current = requestAnimationFrame(drawStep)
  }, [])

  const stop = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
    queueRef.current = []
    setPlaying(false)
    setRecording(false)
    setDisplayStep(-1)
  }, [])

  const start = useCallback(() => {
    const c = ensureCtx()
    void c.resume()
    stepRef.current = 0
    queueRef.current = []
    nextStepTimeRef.current = c.currentTime + 0.1
    loopStartRef.current = nextStepTimeRef.current
    timerRef.current = window.setInterval(scheduler, TICK_MS)
    rafRef.current = requestAnimationFrame(drawStep)
    setPlaying(true)
  }, [ensureCtx, scheduler, drawStep])

  const togglePlay = useCallback(() => { if (playing) stop(); else start() }, [playing, stop, start])

  // Audition a single lane when toggled on (nice tactile feedback, ignores while playing).
  const auditionLane = useCallback((laneKey: string) => {
    const c = ensureCtx()
    void c.resume()
    if (buffersRef.current) triggerHit(c, buffersRef.current, voicingRef.current, laneKey, c.currentTime, c.destination)
  }, [ensureCtx, triggerHit])

  // Tapping a drum pad: always plays the sound (fun to bash on), and when armed +
  // playing, lands a hit on the grid quantized to the nearest 16th step.
  const padHit = useCallback((laneKey: string) => {
    auditionLane(laneKey)
    setTapNonce(m => ({ ...m, [laneKey]: (m[laneKey] ?? 0) + 1 }))   // light up + slight jump on click only
    if (!recordingRef.current || !playing) return
    const c = ctxRef.current
    if (!c) return
    const secPerStep = 60 / bpmRef.current / 4
    let step = Math.round((c.currentTime - loopStartRef.current) / secPerStep) % STEPS_PER_BAR
    if (step < 0) step += STEPS_PER_BAR
    setGrid(prev => {
      if (prev[laneKey]?.[step]) return prev
      const next: Grid = { ...prev, [laneKey]: prev[laneKey].slice() }
      next[laneKey][step] = true
      return next
    })
    setPatternId('')
  }, [auditionLane, playing])

  // Arming record also starts the transport so hits have a clock to land on.
  const toggleRecord = useCallback(() => {
    setRecording(r => {
      const next = !r
      if (next && !playing) start()
      return next
    })
  }, [playing, start])

  const toggleCell = useCallback((laneKey: string, step: number) => {
    setGrid(prev => {
      const wasOn = prev[laneKey]?.[step]
      const next: Grid = { ...prev, [laneKey]: prev[laneKey].slice() }
      next[laneKey][step] = !wasOn
      if (!wasOn && !playing) auditionLane(laneKey)
      return next
    })
    setPatternId('')   // grid diverges from the loaded preset
  }, [playing, auditionLane])

  const loadPattern = useCallback((id: string) => {
    setPatternId(id)
    const p = DRUM_PATTERNS.find(x => x.id === id)
    if (p) setGrid(gridFromPattern(p))
  }, [])

  const clearGrid = useCallback(() => { setGrid(emptyGrid()); setPatternId('') }, [])

  // ── Tempo input (select-all on focus, commit on blur/Enter, clamp) ────────────
  const commitBpm = useCallback(() => {
    const n = parseInt(bpmText, 10)
    const b = Number.isFinite(n) ? clampBpm(n) : bpm
    setBpm(b); setBpmText(String(b))
  }, [bpmText, bpm])

  // ── MIDI export ───────────────────────────────────────────────────────────────
  // Each active cell → a GM drum note (lane.pitch) one 16th long. writeMidiFile is
  // the shared writer (single-track format-0); GM drum pitches (36 kick, 38 snare…)
  // survive round-trip regardless of channel.
  const gridToNotes = useCallback((g: Grid) => {
    const notes: Array<{ pitch: number; startBeat: number; durationBeats: number; velocity: number }> = []
    for (const l of DRUM_LANES) {
      const row = g[l.key]; if (!row) continue
      for (let s = 0; s < STEPS_PER_BAR; s++) {
        if (row[s]) notes.push({ pitch: l.pitch, startBeat: s * STEP_BEATS, durationBeats: STEP_BEATS, velocity: 100 })
      }
    }
    return notes
  }, [])

  const download = useCallback((blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = filename
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }, [])

  const hasHits = useMemo(() => DRUM_LANES.some(l => grid[l.key]?.some(Boolean)), [grid])

  const exportMidi = useCallback(() => {
    const notes = gridToNotes(grid)
    if (notes.length === 0) return
    download(writeMidiFile(notes, bpm, `Beat — ${kit.name}`), 'beat.mid')
  }, [grid, bpm, kit.name, gridToNotes, download])

  // ── WAV export — offline render of EXPORT_BARS bars of the loop ────────────────
  const renderWavBlob = useCallback(async (g: Grid, theBpm: number, theSwing: number, theKit: DrumKit): Promise<Blob> => {
    const sr = 44100
    const secPerStep = 60 / theBpm / 4
    const bars = EXPORT_BARS
    const total = bars * STEPS_PER_BAR * secPerStep + 1.4   // + tail for cymbals/808
    const offline = new OfflineAudioContext(2, Math.ceil(total * sr), sr)
    const thePack = (theKit.instrument.params as { pack?: string }).pack === '808' ? '808' : 'synth'
    const buffers = buildLaneBuffers(offline, thePack, theKit.voices)
    const voicing = laneVoicing(theKit)
    const master = offline.createGain()
    master.gain.value = 0.9
    master.connect(offline.destination)
    for (let bar = 0; bar < bars; bar++) {
      for (let step = 0; step < STEPS_PER_BAR; step++) {
        const offset = (step % 2 === 1) ? theSwing * secPerStep : 0
        const t = (bar * STEPS_PER_BAR + step) * secPerStep + offset + 0.02
        for (const l of DRUM_LANES) {
          if (g[l.key]?.[step]) triggerHit(offline, buffers, voicing, l.key, t, master)
        }
      }
    }
    const rendered = await offline.startRendering()
    return audioBufferToWav(rendered)
  }, [triggerHit])

  const [rendering, setRendering] = useState(false)
  const exportWav = useCallback(async () => {
    if (!hasHits || rendering) return
    setRendering(true)
    try {
      const blob = await renderWavBlob(grid, bpm, swing, kit)
      download(blob, 'beat-loop.wav')
    } finally { setRendering(false) }
  }, [hasHits, rendering, grid, bpm, swing, kit, renderWavBlob, download])

  // Hand the beat off to the studio as a drum track (the subtle "power" export).
  const openStudio = useCallback(() => {
    if (!hasHits) return
    const beat = gridToNotes(grid).map(n => ({ ...n, id: crypto.randomUUID() }))
    openSketchInStudio([], beat, { tempo: bpm, name: `Beat — ${kit.name}` })
  }, [grid, bpm, kit.name, gridToNotes, hasHits])

  // ── Save to (and restore from) the shared app History ─────────────────────────
  const saveBeat = useCallback(() => {
    if (!shell || !hasHits) return
    shell.history.save({
      title: `Beat — ${kit.name}`,
      subtitle: `${bpm} BPM · ${kit.name}`,
      data: { grid: gridRef.current, bpm, swing, kitId },
    })
    setSavedNote('Saved ✓')
    window.setTimeout(() => setSavedNote(''), 1800)
  }, [shell, hasHits, kit.name, bpm, swing, kitId])

  useEffect(() => {
    if (!shell) return
    shell.registerRestore((data) => {
      const d = data as Partial<{ grid: Grid; bpm: number; swing: number; kitId: string }>
      if (d.grid) {
        const ng = emptyGrid()
        for (const l of DRUM_LANES) if (Array.isArray(d.grid[l.key])) for (let i = 0; i < STEPS_PER_BAR; i++) ng[l.key][i] = !!d.grid![l.key][i]
        setGrid(ng)
      }
      if (typeof d.bpm === 'number') { const b = clampBpm(d.bpm); setBpm(b); setBpmText(String(b)) }
      if (typeof d.swing === 'number') setSwing(clamp(d.swing, 0, SWING_MAX))
      if (typeof d.kitId === 'string' && DRUM_KITS.some(k => k.id === d.kitId)) setKitId(d.kitId)
      setPatternId('')
    })
  }, [shell])

  // ── Headless test hook (mirrors the __voice* / __daw* convention) ─────────────
  useEffect(() => {
    const w = window as unknown as {
      __beatMaker?: {
        getState: () => { bpm: number; kitId: string; swing: number; grid: Grid }
        exportMidiBytes: () => Promise<Uint8Array>
        setGrid: (g: Grid) => void
        renderPeak: () => Promise<number>
      }
    }
    w.__beatMaker = {
      getState: () => ({ bpm: bpmRef.current, kitId: kit.id, swing: swingRef.current, grid: gridRef.current }),
      setGrid: (g: Grid) => setGrid(g),
      exportMidiBytes: async () => {
        const notes = gridToNotes(gridRef.current)
        const blob = writeMidiFile(notes, bpmRef.current, `Beat — ${kit.name}`)
        return new Uint8Array(await blob.arrayBuffer())
      },
      renderPeak: async () => {
        const blob = await renderWavBlob(gridRef.current, bpmRef.current, swingRef.current, kit)
        const ab = await blob.arrayBuffer()
        // WAV: 16-bit PCM starting at byte 44.
        const view = new DataView(ab)
        let peak = 0
        for (let i = 44; i + 1 < ab.byteLength; i += 2) {
          const s = Math.abs(view.getInt16(i, true)) / 32768
          if (s > peak) peak = s
        }
        return peak
      },
    }
    return () => { delete w.__beatMaker }
  }, [kit, gridToNotes, renderWavBlob])

  // ── Cleanup ───────────────────────────────────────────────────────────────────
  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current)
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    void ctxRef.current?.close()
  }, [])

  // ── UI ────────────────────────────────────────────────────────────────────────
  const cellSize = 26
  return (
    <div style={{ border: '1px solid var(--border-subtle, #2a2a2a)', borderRadius: 14, padding: 18, background: 'var(--bg-surface, #14141a)' }}>
      <style>{`
        @keyframes bm-pulse { 0%{transform:scale(1)} 42%{transform:scale(1.11); filter:brightness(1.18)} 100%{transform:scale(1)} }
        @keyframes bm-ripple { 0%{box-shadow:0 0 0 0 rgba(96,165,250,.32)} 100%{box-shadow:0 0 0 5px rgba(96,165,250,0)} }
        @keyframes bm-bounce { 0%{transform:translateY(0)} 45%{transform:translateY(-2px)} 100%{transform:translateY(0)} }
        @keyframes bm-rec-pulse { 0%,100%{box-shadow:0 0 0 0 rgba(239,68,68,.5)} 50%{box-shadow:0 0 0 5px rgba(239,68,68,0)} }
        @keyframes bm-tap { 0%{ background: var(--accent); transform: scale(1.04) } 100%{ background: transparent; transform: scale(1) } }
        .bm-anim-pulse { animation: bm-pulse .2s ease-out }
        .bm-anim-ripple { animation: bm-ripple .3s ease-out }
        .bm-anim-bounce { animation: bm-bounce .22s ease-out }
        .bm-rec-armed { animation: bm-rec-pulse 1.1s ease-in-out infinite }
        .bm-tap { animation: bm-tap .26s ease-out }
        .bm-pad { -webkit-tap-highlight-color: transparent }
        .bm-pad:active { transform: scale(.97) }
        @media (prefers-reduced-motion: reduce) { .bm-anim-pulse,.bm-anim-ripple,.bm-anim-bounce,.bm-rec-armed,.bm-tap { animation: none !important } }
      `}</style>
      {/* Transport + controls */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end', marginBottom: 16 }}>
        <button
          onClick={togglePlay}
          data-help-id="beatmaker-play"
          style={{
            fontSize: 15, fontWeight: 700, padding: '10px 22px', borderRadius: 10, cursor: 'pointer',
            border: 'none', color: playing ? '#fff' : '#0e0d12', background: playing ? '#dc2626' : 'var(--accent, #16a34a)', minWidth: 96,
          }}
        >
          {playing ? 'Stop' : 'Play'}
        </button>

        <button
          onClick={toggleRecord}
          aria-pressed={recording}
          title="Record: tap the pads in time and they land on the grid"
          className={recording ? 'bm-rec-armed' : ''}
          style={{
            fontSize: 14, fontWeight: 700, padding: '10px 16px', borderRadius: 10, cursor: 'pointer',
            border: recording ? '1px solid #ef4444' : '1px solid var(--border-subtle,#333)',
            color: recording ? '#fff' : 'var(--text-secondary,#bbb)',
            background: recording ? '#dc2626' : 'transparent', display: 'inline-flex', alignItems: 'center', gap: 7,
          }}
        >
          <span style={{ width: 9, height: 9, borderRadius: 999, background: recording ? '#fff' : '#ef4444', display: 'inline-block' }} />
          {recording ? 'Recording' : 'Record'}
        </button>

        <label style={{ display: 'flex', flexDirection: 'column', fontSize: 11, color: 'var(--text-muted)', gap: 3 }}>
          Tempo (BPM)
          <input
            type="number" inputMode="numeric" value={bpmText}
            onChange={e => setBpmText(e.target.value)}
            onFocus={e => e.currentTarget.select()}
            onBlur={commitBpm}
            onKeyDown={e => { if (e.key === 'Enter') { commitBpm(); e.currentTarget.blur() } }}
            min={MIN_BPM} max={MAX_BPM}
            style={{ width: 76, padding: '7px 8px', borderRadius: 8, border: '1px solid var(--border-subtle,#333)', background: 'var(--bg-base,#0c0c10)', color: 'var(--text-primary,#eee)', fontSize: 14, fontWeight: 600 }}
          />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', fontSize: 11, color: 'var(--text-muted)', gap: 3 }}>
          Kit
          <select
            value={kitId} onChange={e => setKitId(e.target.value)}
            style={{ padding: '7px 8px', borderRadius: 8, border: '1px solid var(--border-subtle,#333)', background: 'var(--bg-base,#0c0c10)', color: 'var(--text-primary,#eee)', fontSize: 13.5 }}
          >
            {DRUM_KITS.map(k => <option key={k.id} value={k.id}>{k.name}</option>)}
          </select>
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', fontSize: 11, color: 'var(--text-muted)', gap: 3 }}>
          Preset
          <select
            value={patternId} onChange={e => loadPattern(e.target.value)}
            style={{ padding: '7px 8px', borderRadius: 8, border: '1px solid var(--border-subtle,#333)', background: 'var(--bg-base,#0c0c10)', color: 'var(--text-primary,#eee)', fontSize: 13.5 }}
          >
            <option value="">Load a groove…</option>
            {DRUM_PATTERNS.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', fontSize: 11, color: 'var(--text-muted)', gap: 3, minWidth: 120 }}>
          Swing {Math.round((swing / SWING_MAX) * 100)}%
          <input
            type="range" min={0} max={SWING_MAX} step={0.02} value={swing}
            onChange={e => setSwing(parseFloat(e.target.value))}
            style={{ width: 120 }}
          />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', fontSize: 11, color: 'var(--text-muted)', gap: 3 }}>
          Animation
          <select
            value={animStyle} onChange={e => changeAnim(e.target.value as AnimStyle)}
            title="How the pads react as the beat plays"
            style={{ padding: '7px 8px', borderRadius: 8, border: '1px solid var(--border-subtle,#333)', background: 'var(--bg-base,#0c0c10)', color: 'var(--text-primary,#eee)', fontSize: 13.5 }}
          >
            <option value="off">Off</option>
            <option value="pulse">Pulse</option>
            <option value="ripple">Ripple</option>
            <option value="bounce">Bounce</option>
            <option value="random">Random</option>
          </select>
        </label>

        <button
          onClick={clearGrid}
          style={{ fontSize: 13, fontWeight: 600, padding: '8px 14px', borderRadius: 9, cursor: 'pointer', border: '1px solid var(--border-subtle,#333)', background: 'transparent', color: 'var(--text-secondary,#bbb)' }}
        >
          Clear
        </button>
      </div>

      {/* Step grid */}
      <div style={{ overflowX: 'auto' }}>
        <div style={{ display: 'inline-block', minWidth: 'max-content' }}>
          {/* Step ruler */}
          <div style={{ display: 'flex', marginLeft: 88, marginBottom: 4 }}>
            {Array.from({ length: STEPS_PER_BAR }).map((_, s) => (
              <div key={s} style={{
                width: cellSize, marginRight: 3, textAlign: 'center', fontSize: 9,
                color: displayStep === s ? '#facc15' : (s % 4 === 0 ? 'var(--text-secondary,#999)' : 'var(--text-muted,#555)'),
                fontWeight: s % 4 === 0 ? 700 : 400,
              }}>{s % 4 === 0 ? (s / 4) + 1 : ''}</div>
            ))}
          </div>

          {DRUM_LANES.map(lane => {
            const n = tapNonce[lane.key] ?? 0
            return (
            <div key={lane.key} style={{ display: 'flex', alignItems: 'center', marginBottom: 3 }}>
              <button
                type="button"
                key={`${lane.key}-${n}`}
                onClick={() => padHit(lane.key)}
                aria-label={`Play ${lane.label}`}
                className={`bm-pad ${n > 0 ? 'bm-tap' : ''}`}
                style={{
                  width: 84, marginRight: 4, fontSize: 11.5, fontWeight: 700, textAlign: 'right', padding: '4px 6px', borderRadius: 6, cursor: 'pointer',
                  border: '1px solid transparent', background: 'transparent', color: 'var(--text-secondary,#bbb)',
                }}
              >
                {lane.label}
              </button>
              {Array.from({ length: STEPS_PER_BAR }).map((_, s) => {
                const on = grid[lane.key]?.[s]
                const isBeat = s % 4 === 0
                const isCur = displayStep === s
                return (
                  <button
                    key={s}
                    onClick={() => toggleCell(lane.key, s)}
                    aria-label={`${lane.label} step ${s + 1}`}
                    aria-pressed={on}
                    className={resolvedAnim !== 'off' && on && isCur ? `bm-anim-${resolvedAnim}` : ''}
                    style={{
                      width: cellSize, height: cellSize, marginRight: 3, borderRadius: 5, cursor: 'pointer',
                      border: isCur ? '1px solid #facc15' : '1px solid var(--border-subtle,#2a2a2a)',
                      background: on
                        ? (isCur ? '#fde047' : '#3b82f6')
                        : (isCur ? 'rgba(250,204,21,0.18)' : (isBeat ? 'var(--bg-elevated,#20202a)' : 'var(--bg-base,#101014)')),
                      transition: 'background 40ms linear',
                      padding: 0,
                    }}
                  />
                )
              })}
            </div>
            )
          })}
        </div>
      </div>

      {/* Export */}
      <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
        <button
          onClick={exportMidi} disabled={!hasHits}
          style={{ fontSize: 13.5, fontWeight: 600, padding: '9px 16px', borderRadius: 9, cursor: hasHits ? 'pointer' : 'not-allowed', opacity: hasHits ? 1 : 0.5, border: '1px solid var(--border-subtle,#333)', background: 'var(--bg-elevated,#20202a)', color: 'var(--text-primary,#eee)' }}
        >
          Download MIDI
        </button>
        <button
          onClick={exportWav} disabled={!hasHits || rendering}
          style={{ fontSize: 13.5, fontWeight: 600, padding: '9px 16px', borderRadius: 9, cursor: (hasHits && !rendering) ? 'pointer' : 'not-allowed', opacity: (hasHits && !rendering) ? 1 : 0.5, border: '1px solid var(--border-subtle,#333)', background: 'var(--bg-elevated,#20202a)', color: 'var(--text-primary,#eee)' }}
        >
          {rendering ? 'Rendering…' : `Download WAV (${EXPORT_BARS} bars)`}
        </button>
        {shell && (
          <button
            onClick={saveBeat} disabled={!hasHits}
            style={{ fontSize: 13.5, fontWeight: 700, padding: '9px 16px', borderRadius: 9, cursor: hasHits ? 'pointer' : 'not-allowed', opacity: hasHits ? 1 : 0.5, border: 'none', background: 'var(--accent,#60a5fa)', color: '#0e0d12' }}
          >
            {savedNote || 'Save beat'}
          </button>
        )}
        <button
          onClick={openStudio} disabled={!hasHits}
          style={{ fontSize: 13, fontWeight: 600, padding: '9px 14px', borderRadius: 9, cursor: hasHits ? 'pointer' : 'not-allowed', opacity: hasHits ? 1 : 0.5, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)' }}
        >
          Open in 100Lights
        </button>
        <span style={{ fontSize: 11.5, color: 'var(--text-muted)', alignSelf: 'center' }}>
          {kit.desc}
        </span>
      </div>
    </div>
  )
}
