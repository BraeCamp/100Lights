/**
 * voice-hmm.ts — note-level HMM / Viterbi note tracker (pYIN-style).
 *
 * PURE module. No DOM, no audio, no external deps. Given a sequence of per-frame
 * acoustic observations (pitch + confidence + onset + energy), it finds the single
 * most-likely NOTE SEQUENCE that jointly explains the whole line, instead of deciding
 * each frame independently. This is the accuracy ceiling-raiser that sits on top of the
 * frame-by-frame pitch detector: it smooths octave flips and scattered pitch noise
 * (jump penalty + self-loop), refuses to fragment vibrato into many notes (self-loop),
 * splits re-articulations of the same pitch (onset-gated attack sub-state), and centres
 * emissions on a globally-estimated tuning so a consistently sharp/flat singer still
 * rounds to the right semitones.
 *
 * Model: log-domain Viterbi over states = { silence } ∪ { attack(n), sustain(n) } for
 * every MIDI note n in the derived range. Every note BEGINS with an attack frame; that
 * makes the state→note collapse trivial and gives a clean, onset-gated place to allow
 * re-articulation of the same pitch.
 *
 * Integration is a LATER step: the pipeline's FeatureFrame (lib/voice-backfill.ts) maps
 * to HmmFrame via  { time, midi: (freq?69+12*log2(freq/440):null), conf: clarity,
 * onset: normalize(flux), energy: rms }. This module deliberately does not import or
 * touch that file.
 */

// ── Public types ──────────────────────────────────────────────────────────────

export interface HmmFrame {
  /** Seconds from start. Frames are assumed evenly spaced (~10ms). */
  time: number
  /** Octave-corrected, possibly fractional MIDI pitch, or null when unvoiced. */
  midi: number | null
  /** Pitch clarity / confidence, 0–1. */
  conf: number
  /** Onset strength, 0–1. */
  onset: number
  /** Normalized RMS energy, 0–1. */
  energy: number
}

export interface HmmNote {
  startSec: number
  /** Integer MIDI note number. */
  midi: number
  durSec: number
  /** 0.3–1, from mean energy over the note. */
  velocity: number
}

export interface HmmOptions {
  /** Gaussian width of the pitch emission, in semitones. Default 0.6. */
  sigma?: number
  /** Robustness cap: pitch error beyond this many semitones stops adding penalty
   *  (heavy-tailed / Huber-like emission). This is what lets a lone octave-flipped
   *  frame be SMOOTHED (staying costs a bounded −cap²/2σ², cheaper than a there-and-back
   *  jump) instead of spawning a spurious note. Default 2.5. */
  distanceCapSemitones?: number
  /** Reward weight on `conf` in a note emission (confident frame ⇒ strong note evidence). Default 1.5. */
  confWeight?: number
  /** Reward weight on `energy` in a note emission. Default 1.0. */
  energyWeight?: number
  /** Log-penalty for a note state covering an unvoiced (midi===null) frame. Default 6.
   *  (Lowered from 8 — biased toward keeping borderline notes; see `keepBias`.) */
  unvoicedNotePenalty?: number
  /** Extra penalty for a note covering a frame quieter than `energyGate`. Default 2.5.
   *  (Lowered from 4 so a quiet/breathy note survives; see `keepBias`.) */
  lowEnergyNotePenalty?: number
  /** Energy floor below which a voiced note frame is treated as "too quiet". Default 0.05. */
  energyGate?: number
  /** Flat silence baseline. Silence WINS this against a note when the frame is quiet/uncertain.
   *  Default 0.35 (lowered from 0.5 to keep more borderline notes; see `keepBias`). */
  silenceBias?: number
  /** How hard a loud+confident+pitched frame pushes silence DOWN (silence should then lose). Default 6. */
  silenceLoudPenalty?: number

  /** Bonus for staying in the same note / staying silent (self-loop). Higher ⇒ less
   *  fragmentation (vibrato & wobble stay one note). Default 2. */
  selfLoopBonus?: number
  /** Log-cost to enter a note from silence (before onset bonus). Default −4. */
  enterNotePenalty?: number
  /** Log-cost to leave a note into silence. Default −4. */
  exitNotePenalty?: number
  /** Base log-cost of a note→note change (before distance & onset terms). Default −3. */
  noteChangePenalty?: number
  /** Per-semitone penalty on a note→note jump — the second line of defence against
   *  octave/large jumps. Default 1.2. */
  jumpPenaltyPerSemitone?: number
  /** Added to entering-a-note and note→note transitions, scaled by the incoming frame's
   *  `onset` (a strong onset makes a note change cheap/expected). Default 6. */
  onsetTransitionBonus?: number

  /** Base cost of RE-ARTICULATION (sustain(n)→attack(n), same pitch again). Very negative so
   *  it only fires on a strong onset. Default −40. */
  reartPenalty?: number
  /** Onset bonus for re-articulation, scaled by `onset`. With default reartPenalty, a
   *  near-full onset (reartPenalty + reartOnsetBonus > selfLoopBonus) starts a NEW note at
   *  the same pitch; no onset ⇒ stays one note. Default 45. */
  reartOnsetBonus?: number

  /** Notes shorter than this are dropped after decoding. Default 0.05 (lowered from 0.06
   *  so a short-but-real note survives). */
  minDurationSec?: number

  /** Recall knob, 0→1 (default 0). Shifts the whole silence-vs-note balance TOWARD notes
   *  without touching the self-loop/jump smoothing that keeps vibrato/wobble as one note.
   *  Higher ⇒ lower effective silenceBias + lower unvoiced/low-energy note penalties, so
   *  quiet/breathy/borderline notes survive. Driven by the widget's sensitivity slider.
   *  Deliberately capped so it can never flip a genuinely UNVOICED (silent) frame into a
   *  note — unvoiced frames keep a large residual note penalty, so silence still wins them. */
  keepBias?: number

  /** Global tuning offset in semitones (e.g. +0.35 = 35 cents sharp), or 'auto' to
   *  estimate it as the median of (midi − round(midi)) over confident voiced frames.
   *  Emissions are centred on (noteMidi + tuning). Default 'auto'. */
  tuning?: number | 'auto'
  /** Confidence floor a frame must clear to feed the auto-tuning estimate. Default 0.5. */
  tuningConfFloor?: number

  /** Half-width (semitones) of the note→note transition window. Bounds Viterbi to
   *  O(T·K·window). Default 12. */
  transitionWindow?: number
  /** Hard lower/upper clamp on the note-state range. Defaults 36 / 84. */
  noteRangeLo?: number
  noteRangeHi?: number
}

// ── Defaults ──────────────────────────────────────────────────────────────────

interface Resolved {
  sigma: number
  distanceCapSemitones: number
  confWeight: number
  energyWeight: number
  unvoicedNotePenalty: number
  lowEnergyNotePenalty: number
  energyGate: number
  silenceBias: number
  silenceLoudPenalty: number
  selfLoopBonus: number
  enterNotePenalty: number
  exitNotePenalty: number
  noteChangePenalty: number
  jumpPenaltyPerSemitone: number
  onsetTransitionBonus: number
  reartPenalty: number
  reartOnsetBonus: number
  minDurationSec: number
  tuning: number | 'auto'
  tuningConfFloor: number
  transitionWindow: number
  noteRangeLo: number
  noteRangeHi: number
}

function resolve(o: HmmOptions | undefined): Resolved {
  const d = o ?? {}
  // Recall knob → note-keeping shifts. Bounded so a truly unvoiced/silent frame can never
  // become a note (the residual unvoiced penalty stays comfortably above silenceBias).
  const keepBias = Math.max(0, Math.min(1, d.keepBias ?? 0))
  const silenceBias0     = d.silenceBias ?? 0.35
  const unvoicedPenalty0 = d.unvoicedNotePenalty ?? 6
  const lowEnergyPen0    = d.lowEnergyNotePenalty ?? 2.5
  return {
    sigma: d.sigma ?? 0.6,
    distanceCapSemitones: d.distanceCapSemitones ?? 2.5,
    confWeight: d.confWeight ?? 1.5,
    energyWeight: d.energyWeight ?? 1.0,
    // keepBias lowers silence's baseline and the quiet/unvoiced note penalties, tilting
    // borderline frames toward notes. Unvoiced penalty is floored at 3.5 so an all-unvoiced
    // (silent) buffer still decodes to silence (3.5 ≫ silenceBias) — no phantom notes.
    unvoicedNotePenalty: Math.max(3.5, unvoicedPenalty0 - 2.5 * keepBias),
    lowEnergyNotePenalty: Math.max(0.5, lowEnergyPen0 - 1.5 * keepBias),
    energyGate: d.energyGate ?? 0.05,
    silenceBias: silenceBias0 - 0.4 * keepBias,
    silenceLoudPenalty: d.silenceLoudPenalty ?? 6,
    selfLoopBonus: d.selfLoopBonus ?? 2,
    enterNotePenalty: d.enterNotePenalty ?? -4,
    exitNotePenalty: d.exitNotePenalty ?? -4,
    noteChangePenalty: d.noteChangePenalty ?? -3,
    jumpPenaltyPerSemitone: d.jumpPenaltyPerSemitone ?? 1.2,
    onsetTransitionBonus: d.onsetTransitionBonus ?? 6,
    reartPenalty: d.reartPenalty ?? -40,
    reartOnsetBonus: d.reartOnsetBonus ?? 45,
    minDurationSec: d.minDurationSec ?? 0.05,
    tuning: d.tuning ?? 'auto',
    tuningConfFloor: d.tuningConfFloor ?? 0.5,
    transitionWindow: d.transitionWindow ?? 12,
    noteRangeLo: d.noteRangeLo ?? 36,
    noteRangeHi: d.noteRangeHi ?? 84,
  }
}

const NEG_INF = -Infinity

// ── Tuning estimate ─────────────────────────────────────────────────────────

/** Median of (midi − round(midi)) over confident voiced frames, in semitones. */
function estimateTuning(frames: HmmFrame[], confFloor: number): number {
  const offs: number[] = []
  for (const f of frames) {
    if (f.midi == null || f.conf < confFloor) continue
    offs.push(f.midi - Math.round(f.midi))
  }
  if (offs.length === 0) return 0
  offs.sort((a, b) => a - b)
  const m = offs.length >> 1
  return offs.length % 2 ? offs[m] : (offs[m - 1] + offs[m]) / 2
}

// ── Note range from voiced frames ──────────────────────────────────────────────

function deriveRange(frames: HmmFrame[], r: Resolved): { lo: number; hi: number } {
  let mn = Infinity
  let mx = -Infinity
  for (const f of frames) {
    if (f.midi == null) continue
    if (f.midi < mn) mn = f.midi
    if (f.midi > mx) mx = f.midi
  }
  if (!isFinite(mn)) {
    // No voiced frames at all — return a minimal valid range.
    return { lo: r.noteRangeLo, hi: r.noteRangeLo }
  }
  let lo = Math.floor(mn) - 1
  let hi = Math.ceil(mx) + 1
  lo = Math.max(r.noteRangeLo, lo)
  hi = Math.min(r.noteRangeHi, hi)
  if (hi < lo) hi = lo
  return { lo, hi }
}

// ── Emissions ──────────────────────────────────────────────────────────────────

/** Silence-state log-emission for a frame. */
function emitSilence(f: HmmFrame, r: Resolved): number {
  let e = r.silenceBias
  if (f.midi != null) e -= r.silenceLoudPenalty * f.conf * f.energy
  return e
}

/**
 * Note-state log-emission for note `n` (used by both attack(n) and sustain(n)).
 * `tuning` centres the pitch term; the squared error is CAPPED for robustness.
 */
function emitNote(f: HmmFrame, n: number, r: Resolved, tuning: number, cap2: number, twoSigma2: number): number {
  if (f.midi == null) return -r.unvoicedNotePenalty
  const d = f.midi - (n + tuning)
  const d2 = Math.min(d * d, cap2)
  let e = -d2 / twoSigma2 + r.confWeight * f.conf + r.energyWeight * f.energy
  if (f.energy < r.energyGate) e -= r.lowEnergyNotePenalty
  return e
}

// ── Main decode ────────────────────────────────────────────────────────────────

export function trackNotesHMM(frames: HmmFrame[], opts?: HmmOptions): HmmNote[] {
  const r = resolve(opts)
  const T = frames.length
  if (T === 0) return []

  const hop = T > 1 ? frames[1].time - frames[0].time : 0.01

  const tuning = r.tuning === 'auto' ? estimateTuning(frames, r.tuningConfFloor) : r.tuning
  const { lo, hi } = deriveRange(frames, r)
  const K = hi - lo + 1

  const cap2 = r.distanceCapSemitones * r.distanceCapSemitones
  const twoSigma2 = 2 * r.sigma * r.sigma
  const win = r.transitionWindow

  // State layout: 0 = silence; note k (=n-lo): attack = 1+2k, sustain = 2+2k.
  const S = 1 + 2 * K
  const SIL = 0
  const atk = (k: number) => 1 + 2 * k
  const sus = (k: number) => 2 + 2 * k

  // Reusable per-frame emission buffers.
  const emNote = new Float64Array(K)
  const fillEmissions = (t: number) => {
    const f = frames[t]
    for (let k = 0; k < K; k++) emNote[k] = emitNote(f, lo + k, r, tuning, cap2, twoSigma2)
  }

  let prev = new Float64Array(S).fill(NEG_INF)
  let cur = new Float64Array(S)
  const back: Int32Array[] = new Array(T)

  // ── Frame 0 init ──
  {
    const f = frames[0]
    fillEmissions(0)
    const b0 = new Int32Array(S).fill(-1)
    prev[SIL] = emitSilence(f, r)
    const enter0 = r.enterNotePenalty + r.onsetTransitionBonus * f.onset
    for (let k = 0; k < K; k++) {
      prev[atk(k)] = enter0 + emNote[k]
      prev[sus(k)] = NEG_INF // a note must begin with an attack frame
    }
    back[0] = b0
  }

  // ── Forward pass ──
  for (let t = 1; t < T; t++) {
    const f = frames[t]
    fillEmissions(t)
    cur.fill(NEG_INF)
    const b = new Int32Array(S).fill(-1)
    const emSil = emitSilence(f, r)
    const onsetBonus = r.onsetTransitionBonus * f.onset

    const relax = (target: number, score: number, src: number) => {
      if (score > cur[target]) {
        cur[target] = score
        b[target] = src
      }
    }

    // From silence.
    const pSil = prev[SIL]
    if (pSil > NEG_INF) {
      relax(SIL, pSil + r.selfLoopBonus + emSil, SIL)
      const enter = pSil + r.enterNotePenalty + onsetBonus
      for (let k = 0; k < K; k++) relax(atk(k), enter + emNote[k], SIL)
    }

    // From in-note states (attack or sustain of note n = lo+k).
    for (let k = 0; k < K; k++) {
      const nA = atk(k)
      const nS = sus(k)
      const pA = prev[nA]
      const pS = prev[nS]
      const best = pA > pS ? pA : pS
      if (best <= NEG_INF) continue

      // Stay in the same note → sustain(n) (self-loop; also attack→sustain progression).
      if (pA > NEG_INF) relax(nS, pA + r.selfLoopBonus + emNote[k], nA)
      if (pS > NEG_INF) relax(nS, pS + r.selfLoopBonus + emNote[k], nS)

      // Re-articulation → attack(n) (only cheap on a strong onset).
      const reart = best + r.reartPenalty + r.reartOnsetBonus * f.onset + emNote[k]
      const reartSrc = pA >= pS ? nA : nS
      relax(nA, reart, reartSrc)

      // Note change → attack(m), m within window.
      const mLo = Math.max(0, k - win)
      const mHi = Math.min(K - 1, k + win)
      for (let m = mLo; m <= mHi; m++) {
        if (m === k) continue
        const dist = Math.abs(m - k)
        const chg = best + r.noteChangePenalty - r.jumpPenaltyPerSemitone * dist + onsetBonus + emNote[m]
        relax(atk(m), chg, reartSrc)
      }

      // Note → silence.
      relax(SIL, best + r.exitNotePenalty + emSil, reartSrc)
    }

    back[t] = b
    const tmp = prev
    prev = cur
    cur = tmp
  }

  // ── Backtrack ──
  let bestState = 0
  let bestScore = NEG_INF
  for (let s = 0; s < S; s++) {
    if (prev[s] > bestScore) {
      bestScore = prev[s]
      bestState = s
    }
  }
  const path = new Int32Array(T)
  let s = bestState
  for (let t = T - 1; t >= 0; t--) {
    path[t] = s
    s = back[t][s]
    if (s < 0 && t > 0) s = SIL // safety (shouldn't happen)
  }

  // ── Collapse state path → notes ──
  const out: HmmNote[] = []
  let openNote = -1 // MIDI of the open note, or -1
  let startFrame = 0
  let energySum = 0
  let nFrames = 0

  const closeNote = (endExclusive: number) => {
    if (openNote < 0) return
    const durSec = nFrames * hop
    const meanE = nFrames > 0 ? energySum / nFrames : 0
    const velocity = Math.min(1, Math.max(0.3, meanE))
    if (durSec >= r.minDurationSec) {
      out.push({ startSec: frames[startFrame].time, midi: openNote, durSec, velocity })
    }
    openNote = -1
    energySum = 0
    nFrames = 0
    void endExclusive
  }

  for (let t = 0; t < T; t++) {
    const st = path[t]
    if (st === SIL) {
      closeNote(t)
      continue
    }
    const isAttack = (st - 1) % 2 === 0
    const k = (st - 1) >> 1
    const note = lo + k
    if (isAttack) {
      // Every attack starts a new note instance (fresh note OR re-articulation).
      closeNote(t)
      openNote = note
      startFrame = t
      energySum = frames[t].energy
      nFrames = 1
    } else {
      // sustain(n): extend the open note (guaranteed same note by transition rules).
      if (openNote === note) {
        energySum += frames[t].energy
        nFrames++
      } else {
        // Defensive: orphan sustain — treat as a note start.
        closeNote(t)
        openNote = note
        startFrame = t
        energySum = frames[t].energy
        nFrames = 1
      }
    }
  }
  closeNote(T)

  return out
}
