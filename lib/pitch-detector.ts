/**
 * Frame-by-frame pitch detection using normalized autocorrelation (MPM algorithm).
 * Used to:
 *   1. Extract accurate MIDI notes from sung/hummed melodic hits
 *   2. Build a pitch+dynamics curve for voice-to-instrument synthesis
 */

import { analyzeSpectralEnvelope } from './spectral-match'

export interface PitchFrame {
  time:      number        // seconds from start
  freq:      number | null // Hz, null = unvoiced / silence
  amplitude: number        // RMS 0-1
  midi:      number | null // MIDI note (rounded), null = unvoiced
}

// ── Autocorrelation pitch detection (MPM / McLeod Pitch Method) ───────────────

function detectPitchInFrame(frame: Float32Array, sampleRate: number): number | null {
  const n    = frame.length
  const half = Math.floor(n / 2)

  // Compute autocorrelation r(lag) and square-mean function m(lag)
  const r = new Float32Array(half)
  const m = new Float32Array(half)
  for (let lag = 0; lag < half; lag++) {
    let sum = 0, sq1 = 0, sq2 = 0
    for (let i = 0; i < half; i++) {
      sum += frame[i] * frame[i + lag]
      sq1 += frame[i] ** 2
      sq2 += frame[i + lag] ** 2
    }
    r[lag] = sum
    m[lag] = (sq1 + sq2) * 0.5
  }

  // Normalized SDF: nsdf(lag) = 2*r(lag) / m(lag)
  const nsdf = new Float32Array(half)
  for (let i = 0; i < half; i++) {
    nsdf[i] = m[i] > 0 ? (2 * r[i]) / m[i] : 0
  }

  // Find all positive peaks above threshold.
  // 0.30 is lower than the original 0.45 — catches more voiced frames in
  // speech (short vowels, soft consonants) without introducing many false
  // positives, because we still require a clear local maximum.
  const THRESHOLD = 0.30
  let d = 1
  while (d < half - 1 && nsdf[d] > 0) d++

  let bestLag = -1
  let bestVal = -1
  let prevPos = nsdf[d] > 0

  for (let i = d + 1; i < half - 1; i++) {
    const cur  = nsdf[i]
    const next = nsdf[i + 1]
    const prev = nsdf[i - 1]
    if (cur > THRESHOLD && cur >= next && cur > prev && !prevPos) {
      if (cur > bestVal) { bestVal = cur; bestLag = i }
    }
    prevPos = cur > 0
  }

  // Fallback: if MPM found nothing (NSDF never crossed zero so !prevPos never
  // triggered), do a brute-force peak search starting after the minimum lag
  // for 4000 Hz.  This handles sustained tones and harmonic-rich signals.
  if (bestLag < 2) {
    const minLag = Math.floor(sampleRate / 4000)
    for (let i = Math.max(minLag, 2); i < half - 1; i++) {
      const cur = nsdf[i]
      if (cur > THRESHOLD && cur > nsdf[i - 1] && cur >= nsdf[i + 1]) {
        if (cur > bestVal) { bestVal = cur; bestLag = i }
      }
    }
  }
  if (bestLag < 2 || bestVal < THRESHOLD) return null

  // Parabolic interpolation for sub-sample accuracy
  const a = nsdf[bestLag - 1]
  const b = nsdf[bestLag]
  const c = nsdf[bestLag + 1]
  const denom = a - 2 * b + c
  const interpLag = denom !== 0 ? bestLag + 0.5 * (a - c) / denom : bestLag

  const freq = sampleRate / interpLag
  return freq >= 50 && freq <= 4000 ? freq : null
}

// ── Public: extract pitch curve from a full AudioBuffer ───────────────────────

function _buildPitchFrames(raw: Float32Array, sr: number, frameSize: number, hopSize: number): PitchFrame[] {
  const out: PitchFrame[] = []
  for (let offset = 0; offset + frameSize <= raw.length; offset += hopSize) {
    const frame = raw.subarray(offset, offset + frameSize)
    let sumSq = 0
    for (let i = 0; i < frame.length; i++) sumSq += frame[i] ** 2
    const amplitude = Math.sqrt(sumSq / frame.length)
    const freq = amplitude > 0.008 ? detectPitchInFrame(frame as Float32Array, sr) : null
    out.push({ time: offset / sr, freq, amplitude: Math.min(1, amplitude * 4), midi: freq ? freqToMidi(freq) : null })
  }
  for (let i = 1; i < out.length - 1; i++) {
    if (out[i].midi === null && out[i - 1].midi !== null && out[i + 1].midi !== null) {
      const med = Math.round(((out[i - 1].midi ?? 0) + (out[i + 1].midi ?? 0)) / 2)
      out[i] = { ...out[i], midi: med, freq: midiToFreq(med) }
    }
  }
  return out
}

export function detectPitchCurve(
  audioBuffer: AudioBuffer,
  frameSize = 2048,
  hopSize   = 512,
): PitchFrame[] {
  return _buildPitchFrames(audioBuffer.getChannelData(0), audioBuffer.sampleRate, frameSize, hopSize)
}

// Async version — yields to the browser every 8 frames so the UI stays responsive.
// The inner autocorrelation is O(n²) per frame; processing hundreds of frames
// synchronously locks the main thread for several seconds on long recordings.
export async function detectPitchCurveAsync(
  audioBuffer: AudioBuffer,
  frameSize = 2048,
  hopSize   = 512,
): Promise<PitchFrame[]> {
  const raw   = audioBuffer.getChannelData(0)
  const sr    = audioBuffer.sampleRate
  const out: PitchFrame[] = []
  const yieldEvery = 8

  for (let offset = 0, frameIdx = 0; offset + frameSize <= raw.length; offset += hopSize, frameIdx++) {
    if (frameIdx > 0 && frameIdx % yieldEvery === 0) {
      await new Promise<void>(r => setTimeout(r, 0))
    }
    const frame = raw.subarray(offset, offset + frameSize)
    let sumSq = 0
    for (let i = 0; i < frame.length; i++) sumSq += frame[i] ** 2
    const amplitude = Math.sqrt(sumSq / frame.length)
    const freq = amplitude > 0.008 ? detectPitchInFrame(frame as Float32Array, sr) : null
    out.push({ time: offset / sr, freq, amplitude: Math.min(1, amplitude * 4), midi: freq ? freqToMidi(freq) : null })
  }

  for (let i = 1; i < out.length - 1; i++) {
    if (out[i].midi === null && out[i - 1].midi !== null && out[i + 1].midi !== null) {
      const med = Math.round(((out[i - 1].midi ?? 0) + (out[i + 1].midi ?? 0)) / 2)
      out[i] = { ...out[i], midi: med, freq: midiToFreq(med) }
    }
  }

  return out
}

// ── Public: synthesize voice pitch curve as continuous sawtooth synth ─────────
// Uses an OscillatorNode (not a sample) so the output is inherently continuous —
// no per-note attack envelope, no grain restarts, no "notey" artifacts.
// Pitch and amplitude are automated frame-by-frame via AudioParam scheduling.

export interface SynthOptions {
  waveform:       OscillatorType  // sawtooth | sine | square | triangle
  filterCutoff:   number          // Hz — controls brightness
  pitchShift:     number          // semitones added to detected pitch
  followPitch:    boolean         // automate frequency per-frame from detected pitch
  followDynamics: boolean         // automate gain per-frame from RMS envelope
  harmProfile?:   Float32Array    // normalized harmonic amplitudes from reference (index = harmonic number)
}

export const DEFAULT_SYNTH_OPTIONS: SynthOptions = {
  waveform:       'sawtooth',
  filterCutoff:   1400,
  pitchShift:     0,
  followPitch:    true,
  followDynamics: true,
}

export async function synthesizeFromPitchCurve(
  pitchCurve:    PitchFrame[],
  sampleRate:    number,
  _rootNote:     number,
  totalDuration: number,
  options:       SynthOptions = DEFAULT_SYNTH_OPTIONS,
): Promise<AudioBuffer> {
  const sr  = sampleRate
  const len = Math.ceil(sr * totalDuration)
  if (len < 1) throw new Error('Recording too short to synthesize')

  // Group the continuous pitch curve into discrete note events so each sung
  // note (C#, A, etc.) becomes its own oscillator with a clean envelope,
  // instead of one sliding oscillator that just modulates volume.
  const notes = extractNoteEvents(pitchCurve, 0.04)
  if (notes.length === 0) throw new Error('No pitched notes detected — try singing more clearly or increasing the recording gain')

  const ctx   = new OfflineAudioContext(1, len, sr)
  const shift = Math.pow(2, options.pitchShift / 12)

  // Single shared lowpass filter → destination
  const filter = ctx.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.value = options.filterCutoff
  filter.Q.value = 0.5
  filter.connect(ctx.destination)

  // Median MIDI (used when followPitch is off — plays all notes at one pitch)
  const midiValues = pitchCurve.filter(f => f.midi !== null).map(f => f.midi!).sort((a, b) => a - b)
  const medianMidi = midiValues.length > 0 ? midiValues[Math.floor(midiValues.length / 2)] : 60

  // Normalize note amplitudes so the loudest note hits 0.8 — prevents quiet
  // recordings from producing near-silent synth output.
  const maxAmp = notes.reduce((m, n) => Math.max(m, n.amplitude), 0.001)
  const ampScale = 0.8 / maxAmp

  for (const note of notes) {
    const midi = options.followPitch ? note.midi : medianMidi
    const freq = midiToFreq(midi) * shift
    const dur  = Math.max(0.04, note.end - note.start)
    const t0   = note.start
    const normAmp = Math.min(0.88, note.amplitude * ampScale)
    const peak = options.followDynamics ? normAmp : 0.72

    // Short attack so notes feel punchy; release scales with note length
    const attack  = Math.min(0.012, dur * 0.08)
    const release = Math.min(0.07, dur * 0.18)

    // Primary oscillator
    const osc = ctx.createOscillator()
    osc.type = options.waveform
    osc.frequency.value = freq

    // Detuned unison copy (+7 cents) for slight thickness without losing pitch clarity
    const osc2 = ctx.createOscillator()
    osc2.type = options.waveform
    osc2.frequency.value = freq * Math.pow(2, 0.07 / 12)

    const g = ctx.createGain()
    g.gain.setValueAtTime(0, t0)
    g.gain.linearRampToValueAtTime(peak, t0 + attack)
    g.gain.setValueAtTime(peak * 0.88, t0 + dur - release)
    g.gain.linearRampToValueAtTime(0, t0 + dur)

    const g2 = ctx.createGain()
    g2.gain.value = 0.3  // unison voice at 30%

    osc.connect(g)
    osc2.connect(g2)
    g2.connect(g)
    g.connect(filter)

    osc.start(t0); osc.stop(t0 + dur + 0.01)
    osc2.start(t0); osc2.stop(t0 + dur + 0.01)
  }

  return ctx.startRendering()
}

// ── Audio transformation: voice → synth timbre ───────────────────────────────
// Transform the original recording to have synth-like harmonic character.
// Always uses originalBuf as the audio source — never rebuilds from oscillators.
// When harmProfile is provided, a per-harmonic peaking EQ chain reshapes the
// voice's spectrum toward the reference's harmonic ratios before saturation.
// Tuned iteratively against reference recordings.
export async function transformVoiceToSynth(
  originalBuf: AudioBuffer,
  pitchCurve: PitchFrame[],
  sampleRate: number,
  totalDuration: number,
  options: SynthOptions
): Promise<AudioBuffer> {
  const notes = extractNoteEvents(pitchCurve)
  if (notes.length === 0) throw new Error('No pitched notes detected — try singing more clearly')

  const ctx = new OfflineAudioContext(
    originalBuf.numberOfChannels,
    Math.ceil(totalDuration * sampleRate),
    sampleRate
  )

  // Always start from the original audio
  const src = ctx.createBufferSource()
  src.buffer = originalBuf

  // Arctan saturation — k controls harmonic content (6 = warm, 12 = gritty)
  const shaper = ctx.createWaveShaper()
  const kSat = 8
  const shaperCurve = new Float32Array(512)
  for (let i = 0; i < 512; i++) {
    const x = (i * 2 / 511) - 1
    shaperCurve[i] = (Math.PI + kSat) * x / (Math.PI + kSat * Math.abs(x))
  }
  shaper.curve = shaperCurve
  shaper.oversample = '4x'

  let lastNode: AudioNode = src
  lastNode.connect(shaper)
  lastNode = shaper

  // Harmonic-profile EQ: when a reference sample was chosen, reshape the voice
  // spectrum so its harmonics match the reference's amplitude ratios.
  if (options.harmProfile && options.harmProfile.length > 1) {
    const profile = options.harmProfile
    const numHarmonics = profile.length - 1

    // Median fundamental from detected notes
    const sorted = notes.slice().sort((a, b) => a.midi - b.midi)
    const medianMidi = sorted[Math.floor(sorted.length / 2)].midi + (options.pitchShift ?? 0)
    const f0 = midiToFreq(medianMidi)

    // Voice's average magnitude spectrum (to compute how much each harmonic needs boosting)
    const fftSize = 4096
    const vMag = analyzeSpectralEnvelope(originalBuf, fftSize)
    const binHz = sampleRate / fftSize
    const peakVoice = Math.max(...vMag) + 1e-10

    for (let h = 1; h <= numHarmonics; h++) {
      const freq = f0 * h
      if (freq >= sampleRate / 2) break
      if (profile[h] < 0.01) continue

      // Sample voice amplitude around this harmonic (average ±3 bins)
      const centerBin = Math.round(freq / binHz)
      let vSum = 0, vN = 0
      for (let d = -3; d <= 3; d++) {
        const b = centerBin + d
        if (b >= 0 && b < vMag.length) { vSum += vMag[b]; vN++ }
      }
      const voiceAmp = vN > 0 ? (vSum / vN) / peakVoice : 0.5

      // How many dB to shift to reach the target harmonic amplitude
      const gDb = Math.max(-16, Math.min(16, 20 * Math.log10((profile[h] + 1e-6) / (voiceAmp + 1e-6))))
      if (Math.abs(gDb) < 0.5) continue

      const eq = ctx.createBiquadFilter()
      eq.type = 'peaking'
      eq.frequency.value = freq
      eq.Q.value = 2.5
      eq.gain.value = gDb
      lastNode.connect(eq)
      lastNode = eq
    }
  }

  // Resonant filter for synth character
  const medianNote = notes.slice().sort((a, b) => a.midi - b.midi)[Math.floor(notes.length / 2)]
  const baseCutoff = midiToFreq(medianNote.midi) * 4
  const filter = ctx.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.value = Math.min(options.filterCutoff ?? baseCutoff, sampleRate / 2 - 100)
  filter.Q.value = 2.5

  const gain = ctx.createGain()
  gain.gain.value = 0.75

  lastNode.connect(filter)
  filter.connect(gain)
  gain.connect(ctx.destination)
  src.start(0)

  return ctx.startRendering()
}

// ── Note event extraction ─────────────────────────────────────────────────────
// Converts a pitch curve into discrete note events by finding stable pitch
// regions (runs where MIDI pitch doesn't change by more than 1 semitone).

export interface NoteEvent { start: number; end: number; midi: number; amplitude: number }

export function extractNoteEvents(pitchCurve: PitchFrame[], minDuration = 0.04): NoteEvent[] {
  if (pitchCurve.length < 2) return []
  const events: NoteEvent[] = []
  let noteStart = -1, noteMidi = -1, ampSum = 0, ampCount = 0, silenceFrames = 0

  // Allow up to ~60ms of silence within a note before splitting — prevents
  // one sung note from breaking into fragments on slightly breathy frames.
  const hopSec     = pitchCurve.length > 1 ? pitchCurve[1].time - pitchCurve[0].time : 0.012
  const maxSilence = Math.ceil(0.06 / hopSec)

  const flush = (endTime: number) => {
    if (noteStart >= 0 && endTime - noteStart >= minDuration)
      events.push({ start: noteStart, end: endTime, midi: noteMidi, amplitude: Math.min(0.9, (ampSum / ampCount) * 0.9) })
    noteStart = -1; silenceFrames = 0
  }

  for (const frame of pitchCurve) {
    if (frame.midi !== null && frame.amplitude > 0.025) {
      const r = Math.round(frame.midi)
      if (noteStart < 0) {
        noteStart = frame.time; noteMidi = r; ampSum = frame.amplitude; ampCount = 1; silenceFrames = 0
      } else if (Math.abs(r - noteMidi) <= 1) {
        // Same note (within ±1 semitone): extend it
        ampSum += frame.amplitude; ampCount++; silenceFrames = 0
      } else {
        // Different pitch: new note
        flush(frame.time); noteStart = frame.time; noteMidi = r; ampSum = frame.amplitude; ampCount = 1
      }
    } else {
      // Silence/unvoiced frame
      if (noteStart >= 0) {
        silenceFrames++
        if (silenceFrames > maxSilence) flush(frame.time)
        // else: swallow the gap — might be a short breath between syllables
      }
    }
  }
  flush(pitchCurve[pitchCurve.length - 1].time + 0.02)
  return events
}

// ── Instrument synthesis ──────────────────────────────────────────────────────
// Renders each NoteEvent as a synthesized instrument note into an AudioBuffer.

export type InstrumentType = 'piano' | 'strings' | 'bells' | 'bass' | 'organ'

export async function synthesizeInstrument(
  notes: NoteEvent[], totalDuration: number, sampleRate: number, instrument: InstrumentType
): Promise<AudioBuffer> {
  const len = Math.ceil(sampleRate * totalDuration)
  if (len < 1 || notes.length === 0) throw new Error('No notes to render')
  const ctx = new OfflineAudioContext(1, len, sampleRate)

  for (const evt of notes) {
    const freq = midiToFreq(evt.midi)
    const dur  = Math.max(0.05, evt.end - evt.start)
    const amp  = evt.amplitude
    const t0   = evt.start

    if (instrument === 'piano') {
      // Sawtooth + high harmonic, fast attack, exponential decay
      const osc = ctx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = freq
      const harm = ctx.createOscillator(); harm.type = 'sine'; harm.frequency.value = freq * 3
      const filt = ctx.createBiquadFilter(); filt.type = 'lowpass'
      filt.frequency.setValueAtTime(5000 + freq * 3, t0)
      filt.frequency.exponentialRampToValueAtTime(800, t0 + Math.min(1.2, dur))
      const g = ctx.createGain()
      g.gain.setValueAtTime(0, t0)
      g.gain.linearRampToValueAtTime(amp * 0.75, t0 + 0.006)
      g.gain.exponentialRampToValueAtTime(amp * 0.12, t0 + Math.min(0.6, dur * 0.75))
      g.gain.linearRampToValueAtTime(0, t0 + Math.min(dur + 0.15, 2))
      const hg = ctx.createGain(); hg.gain.setValueAtTime(amp * 0.15, t0); hg.gain.exponentialRampToValueAtTime(0.001, t0 + 0.08)
      osc.connect(filt); filt.connect(g); g.connect(ctx.destination)
      harm.connect(hg); hg.connect(ctx.destination)
      osc.start(t0); osc.stop(t0 + Math.min(dur + 0.2, 2.5))
      harm.start(t0); harm.stop(t0 + 0.15)

    } else if (instrument === 'strings') {
      // Sawtooth, slow attack, vibrato, sustained
      const osc = ctx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = freq
      const lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 5.2
      const lfoG = ctx.createGain()
      lfoG.gain.setValueAtTime(0, t0)
      lfoG.gain.linearRampToValueAtTime(freq * 0.012, t0 + Math.min(0.3, dur * 0.35))
      lfo.connect(lfoG); lfoG.connect(osc.frequency)
      const filt = ctx.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = 2400
      const g = ctx.createGain()
      g.gain.setValueAtTime(0, t0)
      g.gain.linearRampToValueAtTime(amp * 0.8, t0 + Math.min(0.28, dur * 0.4))
      g.gain.setValueAtTime(amp * 0.75, t0 + dur - 0.06)
      g.gain.linearRampToValueAtTime(0, t0 + dur + 0.04)
      osc.connect(filt); filt.connect(g); g.connect(ctx.destination)
      lfo.start(t0); lfo.stop(t0 + dur + 0.1)
      osc.start(t0); osc.stop(t0 + dur + 0.1)

    } else if (instrument === 'bells') {
      // Inharmonic partials, fast decay (bell series)
      const partials = [1, 2.756, 5.404, 8.930, 13.34]
      const vols     = [1.0, 0.55, 0.28, 0.14, 0.07]
      for (let i = 0; i < partials.length; i++) {
        const osc = ctx.createOscillator(); osc.type = 'sine'; osc.frequency.value = freq * partials[i]
        const decay = Math.max(0.05, (0.8 - i * 0.12) * dur)
        const g = ctx.createGain()
        g.gain.setValueAtTime(0, t0)
        g.gain.linearRampToValueAtTime(amp * vols[i], t0 + 0.003)
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + Math.min(decay + 0.1, dur + 0.5))
        osc.connect(g); g.connect(ctx.destination)
        osc.start(t0); osc.stop(t0 + Math.min(decay + 0.2, dur + 0.6))
      }

    } else if (instrument === 'bass') {
      // Sine + triangle at sub-octave, punchy attack
      const f = freq * 0.5
      const osc = ctx.createOscillator(); osc.type = 'sine'; osc.frequency.value = f
      const sub = ctx.createOscillator(); sub.type = 'triangle'; sub.frequency.value = f
      const filt = ctx.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = 600
      const g = ctx.createGain()
      g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(amp * 0.85, t0 + 0.015)
      g.gain.setValueAtTime(amp * 0.72, t0 + dur - 0.04); g.gain.linearRampToValueAtTime(0, t0 + dur)
      const sg = ctx.createGain(); sg.gain.setValueAtTime(amp * 0.2, t0); sg.gain.exponentialRampToValueAtTime(0.001, t0 + 0.1)
      osc.connect(filt); filt.connect(g); g.connect(ctx.destination)
      sub.connect(sg); sg.connect(ctx.destination)
      osc.start(t0); osc.stop(t0 + dur + 0.05)
      sub.start(t0); sub.stop(t0 + 0.2)

    } else if (instrument === 'organ') {
      // Hammond drawbar approximation: stacked sine harmonics, no attack/decay
      const harmonics = [0.5, 1, 1.5, 2, 3, 4]
      const vols2     = [0.25, 1.0, 0.7, 0.35, 0.18, 0.10]
      for (let i = 0; i < harmonics.length; i++) {
        const osc = ctx.createOscillator(); osc.type = 'sine'; osc.frequency.value = freq * harmonics[i]
        const g = ctx.createGain()
        g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(amp * vols2[i] * 0.28, t0 + 0.008)
        g.gain.setValueAtTime(amp * vols2[i] * 0.28, t0 + dur - 0.008); g.gain.linearRampToValueAtTime(0, t0 + dur)
        osc.connect(g); g.connect(ctx.destination)
        osc.start(t0); osc.stop(t0 + dur + 0.05)
      }
    }
  }

  return ctx.startRendering()
}

// ── Live tuner: real-time mic → pitch (YIN algorithm) ─────────────────────────
// Deletable section — no other code in this file depends on anything below here.
//
// Algorithm: YIN (de Cheveigné & Kawahara, 2002) with:
//   • Hann windowing        — reduces spectral leakage at frame edges
//   • CMND step 2           — cumulative mean normalization (from the paper)
//   • Absolute threshold    — first minimum below 0.12 = high sensitivity
//   • Parabolic refinement  — sub-sample accuracy, ~0.5¢ resolution
//   • IIR + jump tracking   — smooth for sustained notes, fast on pitch change
//
// References: GuitarTuna uses a similar YIN variant; pYIN (Mauch 2014) extends
// it probabilistically but is heavier. For browser real-time, YIN is optimal.

export interface LivePitchResult {
  hz:         number  // detected frequency in Hz (smoothed)
  midi:       number  // nearest MIDI note (0–127)
  noteName:   string  // e.g. "A4"
  cents:      number  // deviation from nearest semitone (−50 to +50)
  confidence: number  // 0–1 derived from YIN CMND value; ≥0.75 = in-tune lock
  rms:        number  // signal loudness 0–1 for level indicator
}

// Pre-built Hann window for reuse across frames
const HANN_SIZE = 4096
const HANN: Float32Array = (() => {
  const w = new Float32Array(HANN_SIZE)
  for (let i = 0; i < HANN_SIZE; i++) w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (HANN_SIZE - 1))
  return w
})()

const LIVE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

function yinDetect(windowed: Float32Array, sr: number): { hz: number; confidence: number } | null {
  const N       = windowed.length
  const half    = N >> 1                      // analysis length
  const minTau  = Math.ceil(sr / 1200)        // 1200 Hz upper bound (~37 at 44.1 kHz)
  const maxTau  = Math.floor(sr / 70)         // 70 Hz lower bound  (~630 at 44.1 kHz)
  const clamp   = Math.min(maxTau, half - 2)

  // Step 1: difference function  d[τ] = Σ_j (x[j] − x[j+τ])²
  const d = new Float32Array(clamp + 1)
  for (let tau = minTau; tau <= clamp; tau++) {
    let s = 0
    for (let j = 0; j < half; j++) {
      const delta = windowed[j] - windowed[j + tau]
      s += delta * delta
    }
    d[tau] = s
  }

  // Step 2: cumulative mean normalized difference (CMND)
  const cmnd    = new Float32Array(clamp + 1)
  cmnd[0]       = 1
  let runSum    = 0
  for (let tau = 1; tau <= clamp; tau++) {
    runSum     += d[tau]
    cmnd[tau]   = runSum > 0 ? d[tau] * tau / runSum : 1
  }

  // Step 3: absolute threshold — first minimum below 0.12
  // Lower threshold = more sensitive (GuitarTuna is ~0.15; 0.10 for voice)
  const THRESHOLD = 0.12
  let tau = minTau
  while (tau <= clamp - 1) {
    if (cmnd[tau] < THRESHOLD) {
      // walk to local minimum
      while (tau + 1 <= clamp && cmnd[tau + 1] < cmnd[tau]) tau++
      break
    }
    tau++
  }
  if (tau >= clamp) return null

  // Step 4: parabolic interpolation for sub-sample accuracy
  const a    = tau > 0     ? cmnd[tau - 1] : cmnd[tau]
  const b    = cmnd[tau]
  const c    = tau < clamp ? cmnd[tau + 1] : cmnd[tau]
  const den  = 2 * (2 * b - a - c)
  const fine = den === 0 ? tau : tau + (a - c) / den
  if (fine <= 0) return null

  return { hz: sr / fine, confidence: 1 - b }
}

export class LivePitchDetector {
  private ctx:      AudioContext | null        = null
  private analyser: AnalyserNode | null        = null
  private stream:   MediaStream | null         = null
  private rafId:    number | null              = null
  private buf:      Float32Array<ArrayBuffer>  = new Float32Array(HANN_SIZE)
  private win:      Float32Array<ArrayBuffer>  = new Float32Array(HANN_SIZE)
  private smoothHz: number | null              = null
  private silFrames = 0
  private mediaRec:  MediaRecorder | null      = null
  private recChunks: Blob[]                    = []

  async start(
    onPitch: (r: LivePitchResult | null) => void,
    captureAudio = false,
    stream?: MediaStream,
  ): Promise<void> {
    this.stop()

    this.stream = stream ?? await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    })
    this.ctx      = new AudioContext()
    await this.ctx.resume()
    this.analyser = this.ctx.createAnalyser()
    this.analyser.fftSize              = HANN_SIZE
    this.analyser.smoothingTimeConstant = 0
    this.ctx.createMediaStreamSource(this.stream).connect(this.analyser)
    this.buf      = new Float32Array(HANN_SIZE)
    this.win      = new Float32Array(HANN_SIZE)
    this.smoothHz = null
    this.silFrames = 0
    this.recChunks = []

    if (captureAudio) {
      try {
        const mr = new MediaRecorder(this.stream)
        mr.ondataavailable = (e) => { if (e.data.size > 0) this.recChunks.push(e.data) }
        mr.start(200)
        this.mediaRec = mr
      } catch { /* capture unavailable on this browser */ }
    }

    const SR = this.ctx.sampleRate

    const tick = () => {
      this.analyser!.getFloatTimeDomainData(this.buf)

      // RMS + peak for level indicator
      let rms = 0, peak = 0
      for (let i = 0; i < this.buf.length; i++) {
        const v = Math.abs(this.buf[i])
        rms += v * v
        if (v > peak) peak = v
      }
      rms = Math.sqrt(rms / this.buf.length)

      // Silence gate — low thresholds so guitar/voice ring-out is tracked.
      // 0.003 RMS ≈ -50 dBFS; 0.008 peak ≈ -42 dBFS.
      if (rms < 0.003 || peak < 0.008) {
        this.silFrames++
        if (this.silFrames > 5) {
          this.smoothHz = null
          onPitch(null)
        }
        this.rafId = requestAnimationFrame(tick)
        return
      }
      this.silFrames = 0

      // Apply Hann window
      for (let i = 0; i < HANN_SIZE; i++) this.win[i] = this.buf[i] * HANN[i]

      const det = yinDetect(this.win, SR)
      if (!det || det.confidence < 0.44) {
        onPitch(null)
        this.rafId = requestAnimationFrame(tick)
        return
      }

      // IIR smoothing with jump detection
      if (this.smoothHz === null) {
        this.smoothHz = det.hz
      } else {
        const centsDiff = Math.abs(1200 * Math.log2(det.hz / this.smoothHz))
        if (centsDiff > 150 && det.confidence > 0.78) {
          // Confident jump to a new note → snap immediately (GuitarTuna behavior)
          this.smoothHz = det.hz
        } else if (centsDiff <= 150) {
          // Same note region → blend (α=0.35 ≈ 25ms time constant at 60fps)
          this.smoothHz = 0.35 * det.hz + 0.65 * this.smoothHz
        }
        // else: uncertain large jump → hold previous
      }

      const midiF   = 69 + 12 * Math.log2(this.smoothHz / 440)
      const midiRnd = Math.round(midiF)
      const cents   = Math.round((midiF - midiRnd) * 100)
      const octave  = Math.floor(midiRnd / 12) - 1
      const name    = LIVE_NAMES[((midiRnd % 12) + 12) % 12]

      onPitch({
        hz:         this.smoothHz,
        midi:       midiRnd,
        noteName:   `${name}${octave}`,
        cents,
        confidence: Math.min(1, det.confidence),
        rms:        Math.min(1, rms * 8),
      })
      this.rafId = requestAnimationFrame(tick)
    }
    this.rafId = requestAnimationFrame(tick)
  }

  /**
   * Stop live detection and return the captured audio blob (if captureAudio was true).
   * Waits for the MediaRecorder to flush its last chunk before resolving.
   */
  async stopAndGetAudio(): Promise<Blob | null> {
    const mr     = this.mediaRec
    const chunks = this.recChunks
    this.mediaRec  = null
    this.recChunks = []

    let blob: Blob | null = null
    if (mr && mr.state !== 'inactive') {
      blob = await new Promise<Blob | null>(resolve => {
        mr.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data) }
        mr.onstop = () => resolve(chunks.length > 0 ? new Blob(chunks, { type: mr.mimeType || 'audio/webm' }) : null)
        mr.stop()
      })
    } else if (chunks.length > 0) {
      blob = new Blob(chunks, { type: 'audio/webm' })
    }

    this._teardown()
    return blob
  }

  stop(): void {
    if (this.mediaRec && this.mediaRec.state !== 'inactive') {
      try { this.mediaRec.stop() } catch { /* ok */ }
    }
    this.mediaRec  = null
    this.recChunks = []
    this._teardown()
  }

  private _teardown(): void {
    if (this.rafId !== null) { cancelAnimationFrame(this.rafId); this.rafId = null }
    this.analyser?.disconnect()
    this.stream?.getTracks().forEach(t => t.stop())
    this.ctx?.close().catch(() => {})
    this.ctx = null; this.analyser = null; this.stream = null; this.smoothHz = null
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function freqToMidi(freq: number): number {
  return Math.round(69 + 12 * Math.log2(freq / 440))
}

export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12)
}

export function midiToName(midi: number): string {
  const names = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']
  return `${names[midi % 12]}${Math.floor(midi / 12) - 1}`
}

/**
 * Run YIN pitch detection on a slice of a mono Float32Array.
 * Pass `offset` to skip the attack transient (e.g. 20% into the buffer).
 * Returns detected MIDI note + frequency + YIN confidence, or null if unvoiced.
 */
export function detectBufferPitch(
  samples: Float32Array,
  sampleRate: number,
  offset = 0,
): { hz: number; midi: number; confidence: number } | null {
  const size = Math.min(HANN_SIZE, samples.length - offset)
  if (size < 1024) return null
  // Apply Hann window to the chunk
  const windowed = new Float32Array(size)
  for (let i = 0; i < size; i++) {
    windowed[i] = samples[offset + i] * HANN[Math.floor(i * HANN_SIZE / size)]
  }
  const r = yinDetect(windowed, sampleRate)
  if (!r || r.confidence < 0.55) return null
  const midi = Math.round(69 + 12 * Math.log2(r.hz / 440))
  return { hz: r.hz, midi, confidence: r.confidence }
}
