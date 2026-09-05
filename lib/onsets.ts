// The audio spikes — where each syllable actually landed.
//
// Brae: "the program connects those names to the audio spikes from the user
// saying the words to place the applicable instrument."
//
// ── Why the transcript's own times are not good enough ─────────────────────
//
// A speech recogniser reports word times, and they are close, but they are
// close in the way a subtitle is close: they are built to land on a word, not
// on a transient. Deepgram's boundaries land within a few tens of milliseconds,
// and at 120bpm a sixteenth note is 125ms — so a word timed 40ms late is a
// third of a subdivision out, and a hit that should sit on the beat sits behind
// it. Quantising hides that until two hits round to different steps, and then
// the pattern is simply wrong.
//
// The attack of the syllable, on the other hand, is exactly the moment the
// person meant. It is a sharp rise in energy and it is easy to find. So the
// transcript decides WHICH drum, and the audio decides WHEN — the same split
// the rest of this feature is built on, applied one level down.
//
// Nothing here is speech recognition. It is looking for the moment a sound
// starts, which is the same job an audio-to-MIDI drum tracker does.

/** A detected attack, in seconds from the start of the recording. */
export interface Onset {
  t: number
  /** Peak energy of the attack, 0..1 — used for velocity and for ranking. */
  strength: number
}

export interface OnsetOptions {
  /** Analysis hop. 5ms resolves anything a person can say. */
  hopMs?: number
  /**
   * The closest two attacks may be, in ms.
   *
   * ⚠️ Not a tuning knob so much as a definition of what counts as one sound.
   * A syllable like "ka" has a burst and a vowel and can read as two rises
   * 30ms apart; at 200bpm a real sixteenth is still 75ms. 55ms sits between
   * those, so it merges the halves of one syllable without ever merging two
   * deliberate hits.
   */
  minGapMs?: number
  /** How far above the local floor a rise has to get to count. */
  sensitivity?: number
}

/**
 * Where the sounds start.
 *
 * The method is a rectified energy envelope, a first difference (so it responds
 * to the RISE rather than to loudness — a held vowel is loud and is not an
 * onset), and peak-picking against a running local mean so it survives somebody
 * getting quieter through a bar.
 */
export function detectOnsets(
  samples: Float32Array,
  sampleRate: number,
  opts: OnsetOptions = {},
): Onset[] {
  const hop = Math.max(1, Math.round(sampleRate * (opts.hopMs ?? 5) / 1000))
  const minGap = (opts.minGapMs ?? 55) / 1000
  const sensitivity = opts.sensitivity ?? 1.6
  if (samples.length < hop * 4) return []

  // ── Energy envelope ──────────────────────────────────────────────────────
  const frames = Math.floor(samples.length / hop)
  const env = new Float32Array(frames)
  for (let f = 0; f < frames; f++) {
    let sum = 0
    const start = f * hop
    for (let i = start; i < start + hop; i++) sum += samples[i] * samples[i]
    env[f] = Math.sqrt(sum / hop)
  }

  // ── Rise, not level ──────────────────────────────────────────────────────
  // Half-wave rectified difference: only growth counts. Without the
  // rectification a decay reads as an event and every hit produces two.
  const flux = new Float32Array(frames)
  for (let f = 1; f < frames; f++) flux[f] = Math.max(0, env[f] - env[f - 1])

  // ── A moving floor ───────────────────────────────────────────────────────
  // A fixed threshold fails the moment somebody leans back from the
  // microphone. The floor follows the recent past instead.
  const win = Math.max(3, Math.round(0.25 * sampleRate / hop))

  // ⚠️ A relative threshold alone hears a drum part in an empty room. Flux is
  // measured against the RECENT past, and in near-silence the recent past is
  // also near-silence, so ordinary noise clears the bar and the take comes back
  // with hits nobody played. An absolute floor and a share of this recording's
  // own peak, together: the first rejects a quiet room outright, the second
  // rejects breaths and chair creaks in a loud one.
  let peakEnv = 0
  for (let f = 0; f < frames; f++) peakEnv = Math.max(peakEnv, env[f])
  const floor = Math.max(0.004, peakEnv * 0.05)

  const onsets: Onset[] = []
  let lastT = -Infinity
  for (let f = 1; f < frames - 1; f++) {
    const from = Math.max(0, f - win)
    let mean = 0
    for (let i = from; i < f; i++) mean += flux[i]
    mean /= Math.max(1, f - from)
    const bar = mean * sensitivity + 1e-4
    if (env[f] < floor) continue
    if (flux[f] < bar) continue
    // A local maximum, so a slow swell produces one onset and not thirty.
    if (flux[f] < flux[f - 1] || flux[f] < flux[f + 1]) continue
    const t = f * hop / sampleRate
    if (t - lastT < minGap) {
      // Two rises inside one syllable: keep the stronger, which is the attack.
      const prev = onsets[onsets.length - 1]
      if (prev && flux[f] > prev.strength) { prev.t = t; prev.strength = flux[f] }
      continue
    }
    onsets.push({ t, strength: flux[f] })
    lastT = t
  }

  // Normalise strength so velocity has a scale that does not depend on how
  // loud this particular room was.
  const peak = onsets.reduce((m, o) => Math.max(m, o.strength), 0)
  if (peak > 0) for (const o of onsets) o.strength = o.strength / peak
  return onsets
}

export interface TimedWord { word: string; s?: number; e?: number }

/**
 * Give each word the moment its sound actually started.
 *
 * ⚠️ Matched IN ORDER, not by nearest. Nearest-neighbour looks better on paper
 * and fails on the case this exists for: a fast run of four syllables where the
 * recogniser's times drift late will let two words claim one onset and leave
 * another unclaimed, silently dropping a hit and doubling another. Words are
 * spoken in sequence and onsets happen in sequence, so walking both in step is
 * both correct and cheap.
 *
 * A word with no onset near it keeps whatever time it had. That is the honest
 * outcome for a syllable the microphone did not catch as a transient — a
 * whispered "ts" over a loud room — and it is better than inventing one.
 */
export function alignToOnsets(
  words: TimedWord[],
  onsets: Onset[],
  { toleranceMs = 180 }: { toleranceMs?: number } = {},
): Array<TimedWord & { strength?: number; from: 'onset' | 'word' }> {
  const tol = toleranceMs / 1000
  const out: Array<TimedWord & { strength?: number; from: 'onset' | 'word' }> = []
  let o = 0
  for (const w of words) {
    if (typeof w.s !== 'number') { out.push({ ...w, from: 'word' }); continue }
    // Advance past onsets that are behind this word beyond any tolerance —
    // they belonged to something already spoken (or to a noise).
    while (o < onsets.length && onsets[o].t < w.s - tol) o++
    const cand = onsets[o]
    if (cand && Math.abs(cand.t - w.s) <= tol) {
      out.push({ ...w, s: cand.t, strength: cand.strength, from: 'onset' })
      o++
    } else {
      out.push({ ...w, from: 'word' })
    }
  }
  return out
}

/** Mono samples from an audio buffer, averaged across channels. */
export function monoOf(buf: { numberOfChannels: number; length: number; getChannelData(i: number): Float32Array }): Float32Array {
  if (buf.numberOfChannels === 1) return buf.getChannelData(0)
  const out = new Float32Array(buf.length)
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c)
    for (let i = 0; i < out.length; i++) out[i] += d[i] / buf.numberOfChannels
  }
  return out
}
