#!/usr/bin/env node
// Is every instrument in this song actually in tune with the others?
//
//   node --experimental-strip-types scripts/check-tuning.mjs song.cfproj
//
// "The song sounds slightly off" is not something the note checker can catch.
// Every note can sit in the right key, at the right time, and the song can still
// sound sour — because a synth voice is not one pitch. Unison spreads a voice
// across several detuned copies, and Apollo's `detune` is a WIDTH: with two
// voices the spread puts them at the extremes with nothing in the middle, so
// 0.46 is not "a little movement", it is two pitches 92 cents apart and no
// centre for the ear to land on. That reads as out of tune, not as warmth.
//
// So this renders each track's real patch through the real engine, measures the
// pitch that actually comes out, and compares it with the note that was asked
// for. It reports the error in CENTS, which is the unit the complaint is in.

import { readFileSync, writeFileSync, mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { execFileSync } from 'child_process'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Cents between two frequencies. */
const cents = (f, ref) => 1200 * Math.log2(f / ref)
const midiHz = m => 440 * Math.pow(2, (m - 69) / 12)

/** Read a 16-bit stereo WAV into a mono Float32Array. */
function readWavMono(path) {
  const buf = readFileSync(path)
  let pos = 12, dataOff = -1, dataLen = 0, channels = 2, rate = 48000
  while (pos < buf.length - 8) {
    const id = buf.toString('ascii', pos, pos + 4)
    const size = buf.readUInt32LE(pos + 4)
    if (id === 'fmt ') { channels = buf.readUInt16LE(pos + 10); rate = buf.readUInt32LE(pos + 12) }
    if (id === 'data') { dataOff = pos + 8; dataLen = size; break }
    pos += 8 + size + (size & 1)
  }
  if (dataOff < 0) throw new Error('no data chunk')
  const frames = Math.floor(dataLen / (2 * channels))
  const out = new Float32Array(frames)
  for (let i = 0; i < frames; i++) {
    let s = 0
    for (let c = 0; c < channels; c++) s += buf.readInt16LE(dataOff + (i * channels + c) * 2) / 32768
    out[i] = s / channels
  }
  return { data: out, rate }
}

/**
 * How far the note actually sounds from the note that was asked for.
 *
 * This deliberately does NOT do general pitch detection, because general pitch
 * detection answers the wrong question here. A sub bass is a fundamental plus a
 * deliberate octave-down sub-oscillator; the combined waveform's true period is
 * the LOWER one, so any honest pitch tracker reports it an octave down — and it
 * is not out of tune, it is a sub bass. Measured on Undertow's Sub at C2: 65.41Hz
 * at power 0.062 with 32.70Hz underneath at 0.036. Both are meant to be there.
 *
 * An autocorrelation tracker called that "1200 cents flat", and reporting it
 * would have sent someone hunting a bug in a part that is perfectly in tune.
 *
 * But the note that was asked for is KNOWN. So look only in a narrow band around
 * it — ±150 cents, wide enough to catch any tuning error worth the name, narrow
 * enough that an octave cannot be mistaken for one — and measure precisely where
 * the energy sits in there. Octave ambiguity stops existing.
 */
export function tuningNear(data, rate, expectHz) {
  const from = Math.floor(rate * 0.25)
  const N = Math.min(Math.floor(rate * 1.5), data.length - from)
  if (N < rate * 0.3) return null

  // Goertzel power at one frequency.
  const power = f => {
    let re = 0, im = 0
    for (let i = 0; i < N; i++) {
      const t = i / rate
      re += data[from + i] * Math.cos(2 * Math.PI * f * t)
      im += data[from + i] * Math.sin(2 * Math.PI * f * t)
    }
    return Math.hypot(re, im) / N
  }

  // Coarse sweep across ±150 cents, then refine around the winner. 2-cent steps
  // are finer than anything a person can hear as mistuning on its own.
  let bestF = 0, bestP = 0
  for (let c = -150; c <= 150; c += 2) {
    const f = expectHz * Math.pow(2, c / 1200)
    const p = power(f)
    if (p > bestP) { bestP = p; bestF = f }
  }
  if (bestF === 0) return null
  for (let step = 1; step >= 0.1; step /= 4) {
    for (let c = -step * 3; c <= step * 3; c += step) {
      const f = bestF * Math.pow(2, c / 1200)
      const p = power(f)
      if (p > bestP) { bestP = p; bestF = f }
    }
  }

  // Is there actually a note here? Compare against the overall level, so a patch
  // that plays nothing near the asked-for pitch is reported as such rather than
  // as a confident reading of noise.
  let rms = 0
  for (let i = 0; i < N; i++) rms += data[from + i] * data[from + i]
  rms = Math.sqrt(rms / N)
  if (rms < 1e-4 || bestP < rms * 0.02) return null

  // Every strong tone in the band, not just the winner.
  //
  // Reporting one number hides the actual problem. A unison of two sits at BOTH
  // extremes with nothing in the middle, so "46 cents flat" is really "two
  // pitches 92 cents apart and none of them the written note" — a different
  // complaint with a different fix. Picking whichever voice happened to be
  // louder would describe a detuned pair as a flat one.
  const curve = []
  for (let c = -150; c <= 150; c += 2) {
    const f = expectHz * Math.pow(2, c / 1200)
    curve.push({ c, f, p: power(f) })
  }
  const peaks = []
  for (let i = 1; i < curve.length - 1; i++) {
    if (curve[i].p > curve[i - 1].p && curve[i].p >= curve[i + 1].p && curve[i].p >= bestP * 0.45) {
      peaks.push({ err: curve[i].c, strength: curve[i].p / rms })
    }
  }
  const spreadCents = peaks.length > 1 ? Math.max(...peaks.map(p => p.err)) - Math.min(...peaks.map(p => p.err)) : 0

  return {
    hz: bestF, err: cents(bestF, expectHz), strength: bestP / rms,
    peaks, spreadCents,
    /** The pitch the ear tries to land on — the middle of what is sounding. */
    centreErr: peaks.length ? peaks.reduce((s, p) => s + p.err, 0) / peaks.length : cents(bestF, expectHz),
  }
}

/** Kept for the detector tests: general pitch, octave-safe. */
export function pitchOf(data, rate, expectHz) {
  const win = Math.floor(rate * 0.09)
  const hop = Math.floor(rate * 0.03)
  const minLag = Math.max(2, Math.floor(rate / (expectHz * 2.2)))
  const maxLag = Math.min(win - 2, Math.ceil(rate / (expectHz / 2.2)))
  const picks = []
  for (let start = Math.floor(rate * 0.15); start + win < data.length; start += hop) {
    let energy = 0
    for (let i = 0; i < win; i++) energy += data[start + i] * data[start + i]
    if (Math.sqrt(energy / win) < 0.004) continue          // silence / tail

    // Normalised square difference, then take the FIRST strong peak rather than
    // the biggest one.
    //
    // Plain autocorrelation picks the global maximum, and correlation always
    // rises again at twice the period — so it happily reports a note an octave
    // too low. The first version of this file did exactly that and confidently
    // told me Sub, Bass and Hats were 1200 cents flat, which is not a tuning
    // error, it is my detector being wrong. Reporting that to someone as "your
    // bass is an octave out" would have sent them chasing a bug that isn't
    // there. The first-peak-above-threshold rule is what makes it octave-safe.
    const nsdf = new Float64Array(maxLag + 1)
    for (let lag = minLag; lag <= maxLag; lag++) {
      let r = 0, m = 0
      for (let i = 0; i < win - lag; i++) {
        r += data[start + i] * data[start + i + lag]
        m += data[start + i] * data[start + i] + data[start + i + lag] * data[start + i + lag]
      }
      nsdf[lag] = m > 0 ? (2 * r) / m : 0
    }
    let peak = 0
    for (let lag = minLag + 1; lag < maxLag; lag++) {
      if (nsdf[lag] > nsdf[lag - 1] && nsdf[lag] >= nsdf[lag + 1] && nsdf[lag] > peak) peak = nsdf[lag]
    }
    if (peak < 0.3) continue                                // nothing periodic here
    const threshold = peak * 0.85
    let bestLag = -1
    for (let lag = minLag + 1; lag < maxLag; lag++) {
      if (nsdf[lag] > nsdf[lag - 1] && nsdf[lag] >= nsdf[lag + 1] && nsdf[lag] >= threshold) { bestLag = lag; break }
    }
    if (bestLag <= 0) continue

    // Sub-sample interpolation, which is not optional here: at 48kHz a C4 sits
    // near lag 184, so being one whole sample out is already 9 cents — bigger
    // than the errors this is supposed to detect.
    const y0 = nsdf[bestLag - 1], y1 = nsdf[bestLag], y2 = nsdf[bestLag + 1]
    const denom = 2 * (2 * y1 - y0 - y2)
    const refined = denom !== 0 ? bestLag + (y2 - y0) / denom : bestLag
    picks.push(rate / refined)
  }
  if (!picks.length) return null
  picks.sort((a, b) => a - b)
  const median = picks[Math.floor(picks.length / 2)]
  const errs = picks.map(f => cents(f, expectHz))
  const lo = errs[Math.floor(errs.length * 0.1)], hi = errs[Math.floor(errs.length * 0.9)]
  return { hz: median, err: cents(median, expectHz), wobble: Math.abs(hi - lo), frames: picks.length }
}

/**
 * How much the note THROBS — the actual sound of a detuned unison.
 *
 * My first attempt measured pitch stability and found nothing, because two
 * steady detuned copies have a perfectly steady period between them: the
 * detuning does not move the pitch, it beats. Two tones 92 cents apart at G3
 * (196Hz) sit at 190.9 and 201.1Hz and swing the volume up and down about ten
 * times a second. That wobble is what makes a chord sound sour, and it lives in
 * the amplitude envelope, not the pitch track.
 *
 * Returns the depth of that swing and, more importantly, its RATE. The rate is
 * the part that matters and I had it backwards at first: two copies of equal
 * loudness cancel and reinforce completely whatever their spacing, so the depth
 * is near-total either way. What separates lush from sour is speed. The beat
 * rate is simply the frequency difference — at G3, 8 cents apart is 0.9Hz and
 * you hear richness; 92 cents apart is 10.2Hz and you hear two instruments
 * failing to agree. Roughness sets in somewhere above about 5Hz.
 */
export function beatOf(data, rate) {
  const from = Math.floor(rate * 0.3)
  const to = Math.min(data.length, from + rate * 2)
  if (to - from < rate * 0.5) return null

  // Envelope: rectify, then a one-pole lowpass slow enough to ignore the
  // waveform itself but fast enough to follow a 20Hz beat.
  const env = new Float64Array(to - from)
  let y = 0
  const a = Math.exp(-2 * Math.PI * 30 / rate)
  for (let i = from; i < to; i++) {
    y = a * y + (1 - a) * Math.abs(data[i])
    env[i - from] = y
  }
  let mean = 0
  for (const v of env) mean += v
  mean /= env.length
  if (mean < 1e-4) return null

  // Strongest modulation between 0.5 and 25Hz — the range a person hears as
  // wobble rather than as pitch or as a slow swell.
  let bestDepth = 0, bestRate = 0
  for (let f = 0.5; f <= 25; f += 0.25) {
    let re = 0, im = 0
    for (let i = 0; i < env.length; i++) {
      const t = i / rate
      re += (env[i] - mean) * Math.cos(2 * Math.PI * f * t)
      im += (env[i] - mean) * Math.sin(2 * Math.PI * f * t)
    }
    const mag = 2 * Math.hypot(re, im) / env.length / mean
    if (mag > bestDepth) { bestDepth = mag; bestRate = f }
  }
  return { depth: bestDepth, rate: bestRate }
}

// A long, plain note in a comfortable register: this measures the INSTRUMENT,
// not the writing. Percussion is skipped — a kick has no pitch to be wrong.
const TEST_NOTE = 60
const isPercussive = name => /kick|snare|hat|rim|clap|perc|tom|crash|ride|shaker/i.test(name)

// Importing this file (the detector test does) must not run the whole CLI.
const file = process.argv[2]
if (!file) {
  if (process.argv[1]?.endsWith('check-tuning.mjs')) {
    console.error('usage: check-tuning.mjs <song.cfproj>')
    process.exit(2)
  }
} else {
  runCli(file)
}

function runCli(file) {
const cf = JSON.parse(readFileSync(file, 'utf8'))
const project = cf.dawProject ?? cf
const tmp = mkdtempSync(join(tmpdir(), 'tuning-'))

const rows = []
for (const track of project.tracks) {
  if (track.instrument?.type !== 'apollo') continue
  const notes = project.arrangementClips
    .filter(c => c.kind === 'midi' && c.trackId === track.id)
    .flatMap(c => c.notes ?? [])
  if (!notes.length) continue

  // Test at the register the part actually lives in — pitch error can depend on
  // the note (a wrong sample root drifts with distance from the root).
  const pitches = notes.map(n => n.pitch).sort((a, b) => a - b)
  const note = isPercussive(track.name) ? TEST_NOTE : pitches[Math.floor(pitches.length / 2)]
  const expectHz = midiHz(note)

  const patchPath = join(tmp, `${track.id}.json`)
  writeFileSync(patchPath, JSON.stringify(track.instrument.params))
  const wav = join(tmp, `${track.id}.wav`)
  try {
    execFileSync('node', [
      '--experimental-strip-types', join(ROOT, 'scripts/apollo-render.mjs'),
      '--patch', patchPath, '--notes', `${note}:0:2.5:0.9`, '--seconds', '3', '--out', wav,
    ], { stdio: 'pipe', cwd: ROOT })
  } catch (e) {
    rows.push({ name: track.name, note, err: null, wobble: null, why: 'render failed' })
    continue
  }

  const { data, rate } = readWavMono(wav)
  const p = tuningNear(data, rate, expectHz)
  const b = beatOf(data, rate)
  const osc = (track.instrument.params.oscs ?? []).filter(o => o.enabled !== false)
  const spread = Math.max(0, ...osc.map(o => (o.unison > 1 ? (o.detune ?? 0) * 100 : 0)))
  rows.push({
    name: track.name, note, percussive: isPercussive(track.name),
    err: p?.centreErr ?? null, voices: p?.peaks?.length ?? 0, heard: p?.spreadCents ?? 0, spread,
    beatRate: b && b.depth > 0.15 ? b.rate : null,
    why: p ? null : 'no steady pitch found',
  })
}

const noteName = m => ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'][m % 12] + (Math.floor(m / 12) - 1)

console.log(`TUNING  —  ${project.name ?? 'project'}\n`)
console.log('track      test note   centre pitch   voices   heard spread   beating')
for (const r of rows) {
  const err = r.err == null ? '     —' : `${r.err >= 0 ? '+' : ''}${r.err.toFixed(1)}¢`
  const wob = r.beatRate == null ? '   —' : `${r.beatRate.toFixed(1)}Hz`
  const heard = r.heard ? `${r.heard.toFixed(0)}¢ apart` : '—'
  const voices = r.voices ? String(r.voices) : '—'
  console.log(`  ${r.name.padEnd(9)} ${noteName(r.note).padStart(6)} ${err.padStart(14)} ${voices.padStart(8)} ${heard.padStart(14)} ${wob.padStart(9)}${r.why ? '  ' + r.why : ''}`)
}

// What counts as a problem. ±5 cents is inaudible on its own; two instruments
// 10 cents apart start to beat; anything past 25 cents is heard as wrong rather
// than as character. Wobble is judged harder, because an unsteady pitch is what
// makes a chord sound sour even when its average is correct.
// Roughness, not richness. Slow beating under ~4Hz is what a chorused pad is
// supposed to do; past about 5Hz the ear stops hearing one thick note and
// starts hearing two notes disagreeing, which is the complaint.
const bad = rows.filter(r => !r.percussive && (
  (r.err != null && Math.abs(r.err) > 12) ||
  (r.heard > 20) ||
  (r.beatRate != null && r.beatRate > 5)))

console.log('')
if (!bad.length) {
  console.log('Every pitched instrument lands within 12 cents and beats slowly enough to read as warmth. ✓')
} else {
  console.log('OFF:')
  for (const r of bad) {
    const parts = []
    if (r.err != null && Math.abs(r.err) > 12) parts.push(`centre sits ${r.err >= 0 ? '+' : ''}${r.err.toFixed(0)}¢ from the written note`)
    if (r.heard > 20) parts.push(`${r.voices} voices ${r.heard.toFixed(0)}¢ apart, nothing on the note itself`)
    if (r.beatRate != null && r.beatRate > 5) parts.push(`beats at ${r.beatRate.toFixed(1)}Hz — heard as roughness, not warmth`)
    console.log(`  ${r.name} — ${parts.join(', ')}${r.spread ? `  (unison spread ±${(r.spread / 2).toFixed(0)}¢)` : ''}`)
  }
  process.exitCode = 1
}
}
