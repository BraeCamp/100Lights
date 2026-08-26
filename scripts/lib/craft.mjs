// The craft layer: the things a producer knows, written down as code.
//
// Every song in this project so far hand-typed its own chord voicings as literal
// MIDI arrays, its own drum patterns, and its own humanising. Eight songs, seven
// different field vocabularies for "a chord". That is not reuse being missed for
// tidiness — it means the QUALITY of each song depends on how much care went
// into that one script, and the analysis keeps finding the same four faults in
// all of them:
//
//   · every part sits within 1.5 ms of the grid, with no direction
//   · two parts occupy the identical octave and mask each other
//   · three layers arrive at one seam
//   · every section has the same note density
//
// All four are structural, all four are avoidable by construction, and none of
// them are matters of taste. So they live here, and a song starts from a higher
// floor instead of relying on the author remembering.
//
// What is NOT here, deliberately: anything that decides what the music IS. No
// progressions, no forms, no genre presets that assemble a track. Those choices
// belong to the song, because a template applied before the music exists is how
// you get a set of pieces that all sound the same — and because a template is a
// CHARACTER, not a parts list.

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)
export const rng = (seed = 7) => { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 } }

// ═══ GROOVE ═════════════════════════════════════════════════════════════════
//
// The measured fault: every part averaged within 1.5 ms of the grid with a
// spread of 1-3 ms. That is symmetric jitter around zero, and it is motion
// without feel — it measures loose and still sounds like a machine, because no
// part LEANS. A groove is the difference in direction between parts: the snare
// arriving after the beat while the bass arrives before it is what makes a bar
// feel like it is being played rather than being clocked.
//
// The numbers are conventional session-musician behaviour, in milliseconds
// against the grid. Negative is ahead of the beat.

export const ROLE_LEAN = {
  kick:   { lean: 0, jitter: 2 },        // the anchor; everything else is relative to it
  sub:    { lean: 0, jitter: 2 },
  snare:  { lean: 11, jitter: 4 },       // behind the beat — the single biggest "played" cue
  clap:   { lean: 12, jitter: 4 },
  rim:    { lean: 8, jitter: 4 },
  hats:   { lean: 3, jitter: 7 },        // loosest part of the kit
  perc:   { lean: 5, jitter: 6 },
  bass:   { lean: -6, jitter: 3 },       // pushes, which is what makes a groove drive
  chords: { lean: 7, jitter: 5 },        // comping sits back
  keys:   { lean: 6, jitter: 5 },
  pad:    { lean: 0, jitter: 9 },        // no attack to place; spread it instead
  arp:    { lean: -2, jitter: 3 },
  pluck:  { lean: 2, jitter: 4 },
  default:{ lean: 3, jitter: 4 },
}

/** Whole-band character. A feel scales the leans rather than replacing them, so
 *  the RELATIONSHIPS between parts survive. */
export const FEELS = {
  tight:    { scale: 0.45, swing: 0 },     // modern electronic; still not zero
  straight: { scale: 1.0, swing: 0 },
  laidback: { scale: 1.5, swing: 0.54 },   // soul, trip-hop, lo-fi
  swung:    { scale: 1.2, swing: 0.60 },   // shuffle
  driving:  { scale: 0.8, swing: 0, push: -3 },  // everything a touch early
}

/**
 * Build a groove for one song. `swing` is the position of the off-16ths as a
 * fraction of the beat: 0.5 is straight, 0.66 is triplet. It is applied ONLY to
 * the parts that should swing — swinging the kick and snare as well as the hats
 * turns a shuffle into a tempo change.
 */
export function groove({ bpm, feel = 'straight', swing = null, seed = 7 } = {}) {
  const f = FEELS[feel] ?? FEELS.straight
  const rand = rng(seed)
  const swingPct = swing ?? f.swing ?? 0
  const msToBeats = ms => (ms / 1000) * (bpm / 60)
  const beatMs = 60000 / bpm
  const SWINGS = new Set(['hats', 'perc', 'arp', 'keys', 'chords', 'pluck'])

  // A slow drift, in addition to per-note noise. Roger Linn — who invented the
  // swing control — advises against random timing jitter, and the KTH rule
  // system's finding is that what reads as human is white noise per onset PLUS
  // a 1/f drift across the phrase. Pure per-note randomness reads as sloppiness;
  // the drift reads as a player.
  let drift = 0
  const drifts = Array.from({ length: 64 }, () => { drift = drift * 0.85 + (rand() * 2 - 1) * 0.4; return drift })

  return {
    swingPct,
    /** Beat offset for one note of a given role. */
    offset(role, beat) {
      const r = ROLE_LEAN[role] ?? ROLE_LEAN.default
      let ms = r.lean * f.scale + (f.push ?? 0)

      // The metrical rule, from the Groove MIDI Dataset: drummers play ON-beat
      // notes LATE and OFF-beat notes EARLY. It is a structured deviation, not
      // noise, and it is a large part of why a quantised part and a played one
      // differ by ~23 ms mean absolute error rather than by a few.
      const inBeat = Math.abs(beat - Math.round(beat)) < 0.05
      ms += (inBeat ? 3.5 : -3.5) * f.scale

      ms += (rand() * 2 - 1) * r.jitter * f.scale
      ms += drifts[Math.floor(Math.abs(beat)) % drifts.length] * r.jitter * f.scale
      let out = msToBeats(ms)

      // Swing, tempo-aware. A fixed percentage is wrong at speed: measured jazz
      // swing runs about 3.5:1 slow and collapses to 1:1 fast, because the short
      // off-note holds a roughly constant ~100 ms. So the swing delay is capped
      // at what keeps the off-note from disappearing.
      if (swingPct && SWINGS.has(role)) {
        const six = Math.round(beat * 4)
        if (six % 2 === 1) {
          const sixteenthMs = beatMs / 4
          const wantMs = sixteenthMs * (swingPct - 0.5) * 2
          const maxMs = Math.max(0, sixteenthMs - 45)   // leave the off-note room to be heard
          out += msToBeats(Math.min(wantMs, maxMs))
        }
      }
      return out
    },
    /** Velocity for a note: accent the downbeat, lift the backbeat, ghost the rest. */
    velocity(role, beat, base, { bpb = 4, spread = 7 } = {}) {
      const inBar = ((beat % bpb) + bpb) % bpb
      let v = base
      if (Math.abs(inBar) < 0.05) v += 8                          // bar downbeat
      else if (Math.abs(inBar % 1) < 0.05) v += 3                 // other beats
      else v -= 4                                                  // off the beat
      if (role === 'hats' && Math.abs(inBar % 1 - 0.5) < 0.05) v -= 6   // the "and" is a ghost
      v += (rand() * 2 - 1) * spread
      return Math.round(clamp(v, 1, 127))
    },
    rand,
  }
}

/** Apply a groove to a list of {pitch, beat, durationBeats, velocity} notes. */
export function play(notes, role, g, { bpb = 4 } = {}) {
  return notes.map(n => ({
    ...n,
    beat: Math.max(0, n.beat + g.offset(role, n.beat)),
    velocity: g.velocity(role, n.beat, n.velocity ?? 90, { bpb }),
  }))
}

// ═══ HARMONY ════════════════════════════════════════════════════════════════

const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }
/** "F#m9", "Ebmaj7", "Bsus4", "A7", "Dm11" → {root, quality, tones} */
export function parseChord(sym) {
  const m = /^([A-G])([#b]?)(.*)$/.exec(sym.trim())
  if (!m) throw new Error(`unparseable chord: ${sym}`)
  const root = (PC[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + 12) % 12
  const q = m[3]
  // Intervals from the root, in semitones.
  const T = { P1: 0, m3: 3, M3: 4, P4: 5, d5: 6, P5: 7, m6: 8, M6: 9, m7: 10, M7: 11, M9: 14, m9: 13, P11: 17, A11: 18, M13: 21 }
  let tones
  if (/^m(aj)?7/.test(q) && q.startsWith('maj')) tones = [T.P1, T.M3, T.P5, T.M7]
  else if (/^maj9/.test(q)) tones = [T.P1, T.M3, T.P5, T.M7, T.M9]
  else if (/^maj/.test(q)) tones = [T.P1, T.M3, T.P5, T.M7]
  else if (/^m11/.test(q)) tones = [T.P1, T.m3, T.P5, T.m7, T.M9, T.P11]
  else if (/^m9/.test(q)) tones = [T.P1, T.m3, T.P5, T.m7, T.M9]
  else if (/^m7/.test(q)) tones = [T.P1, T.m3, T.P5, T.m7]
  else if (/^m6/.test(q)) tones = [T.P1, T.m3, T.P5, T.M6]
  else if (/^dim/.test(q) || q === '°') tones = [T.P1, T.m3, T.d5]
  else if (/^aug/.test(q) || q === '+') tones = [T.P1, T.M3, T.m6]
  else if (/^sus2/.test(q)) tones = [T.P1, 2, T.P5]
  else if (/^(9sus|sus4?9)/.test(q)) tones = [T.P1, T.P4, T.P5, T.m7, T.M9]
  else if (/^sus/.test(q)) tones = [T.P1, T.P4, T.P5]
  else if (/^13/.test(q)) tones = [T.P1, T.M3, T.m7, T.M9, T.M13]
  else if (/^11/.test(q)) tones = [T.P1, T.P5, T.m7, T.M9, T.P11]
  else if (/^9/.test(q)) tones = [T.P1, T.M3, T.P5, T.m7, T.M9]
  else if (/^7/.test(q)) tones = [T.P1, T.M3, T.P5, T.m7]
  else if (/^6/.test(q)) tones = [T.P1, T.M3, T.P5, T.M6]
  else if (/^m/.test(q)) tones = [T.P1, T.m3, T.P5]
  else tones = [T.P1, T.M3, T.P5]
  if (/#11/.test(q) && !tones.includes(T.A11)) tones = [...tones, T.A11]
  return { symbol: sym, root, tones, minor: /^m(?!aj)/.test(q) }
}

/**
 * The low interval limit.
 *
 * Two notes close together low down do not sound like a chord, they sound like
 * mud — the ear cannot resolve them and the intermodulation fills the low mids.
 * The conventional limits: below about E2 keep to octaves and fifths, thirds do
 * not work below about F2/A2, and nothing tighter than a fifth belongs under C3.
 * This is why a voicing that is fine at C4 turns to soup an octave down, and it
 * is one of the few genuinely hard rules in arranging.
 */
export function lowIntervalOk(a, b) {
  const [lo, hi] = a < b ? [a, b] : [b, a]
  const gap = hi - lo
  if (lo >= 60) return true              // C4 and up: anything
  if (lo >= 52) return gap >= 3          // E3+: minor third
  if (lo >= 48) return gap >= 4          // C3+: major third
  if (lo >= 43) return gap >= 5          // G2+: fourth
  if (lo >= 40) return gap >= 7          // E2+: fifth
  return gap >= 12 || gap === 0          // below E2: octaves only
}

/** Strip anything that breaks the limit, keeping the outer voices. */
export function deMud(pitches) {
  const s = [...pitches].sort((a, b) => a - b)
  const out = [s[0]]
  for (let i = 1; i < s.length; i++) if (lowIntervalOk(out[out.length - 1], s[i])) out.push(s[i])
  return out
}

/**
 * Realise a chord as actual pitches.
 *
 * `style`:
 *   triad     root position triad, for when plainness is the point
 *   shell     root, 3rd, 7th — the guide tones, and almost never wrong
 *   rootless  3rd, 7th and colour, no root: the bass has the root, and doubling
 *             it in the chord part is what makes a mix sound crowded at the
 *             bottom while staying empty in the middle
 *   open      drop-2: take the second voice from the top down an octave, which
 *             is the standard way to stop a close voicing sounding like a lump
 *   quartal   stacked fourths — modal, and sits wide without implying much
 *
 * `near` is the previous voicing. Given one, the realisation is chosen to move
 * the least — voice leading, which is most of what separates chords that
 * progress from chords that jump.
 */
export function voice(chord, { style = 'rootless', centre = 62, spread = 14, near = null } = {}) {
  const c = typeof chord === 'string' ? parseChord(chord) : chord
  const t = c.tones
  // Quartal is built, not folded. Every other style places its degrees in the
  // octave nearest the centre, and doing that to a stack of fourths collapses it
  // into a cluster inside one octave — which is the opposite of the sound.
  if (style === 'quartal') {
    let base = c.root
    while (base < centre - spread) base += 12
    while (base > centre) base -= 12
    return deMud([base, base + 5, base + 10, base + 15])
  }
  let degrees
  switch (style) {
    case 'triad': degrees = t.slice(0, 3); break
    case 'shell': degrees = [t[0], t[1], t.find(x => x === 10 || x === 11) ?? t[2]]; break
    case 'quartal': degrees = [t[0], t[0] + 5, t[0] + 10, t[0] + 15]; break
    case 'open':
    case 'rootless':
    default: {
      const upper = t.slice(1)
      degrees = upper.length >= 3 ? upper : t
      break
    }
  }
  // Place each degree in the octave nearest the centre, then spread it out.
  let pitches = degrees.map(d => {
    const pc = (c.root + d) % 12
    let p = centre - (centre % 12) + pc
    while (p < centre - spread) p += 12
    while (p > centre + spread) p -= 12
    return p
  })
  pitches = [...new Set(pitches)].sort((a, b) => a - b)
  if (style === 'open' && pitches.length >= 3) {
    const i = pitches.length - 2
    pitches = [...pitches.slice(0, i), ...pitches.slice(i + 1), pitches[i] - 12].sort((a, b) => a - b)
  }
  // Voice leading: try every octave placement of each note and keep the one that
  // moves least from the previous chord.
  if (near?.length) {
    pitches = pitches.map(p => {
      let best = p, bestD = Infinity
      for (let o = -12; o <= 12; o += 12) {
        const cand = p + o
        if (cand < centre - spread - 6 || cand > centre + spread + 6) continue
        const d = Math.min(...near.map(n => Math.abs(cand - n)))
        if (d < bestD) { bestD = d; best = cand }
      }
      return best
    })
    pitches = [...new Set(pitches)].sort((a, b) => a - b)
  }
  return deMud(pitches)
}

// ═══ REGISTER ═══════════════════════════════════════════════════════════════
//
// The measured fault: "Keys" and "Pad" occupying the identical 14 semitones.
// Two parts in one octave mask each other whatever the faders do, and the fix is
// arrangement, not EQ. Slots make the collision impossible to write by accident.

export const SLOTS = {
  sub:      [28, 45],   // E1–A2
  bass:     [36, 55],   // C2–G3
  lowChord: [48, 64],   // C3–E4
  chord:    [55, 74],   // G3–D5
  upper:    [67, 88],   // G4–E6
  air:      [79, 96],   // G5–C7
}

/** Fold a pitch into a slot by octaves, so a written line keeps its shape. */
export function intoSlot(pitch, slot) {
  const [lo, hi] = SLOTS[slot] ?? slot
  let p = pitch
  while (p < lo) p += 12
  while (p > hi) p -= 12
  return p
}

/** Warn about parts that will fight. Call it while writing, not after. */
export function checkSlots(assignment) {
  const bad = []
  const names = Object.keys(assignment)
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const a = SLOTS[assignment[names[i]]] ?? assignment[names[i]]
      const b = SLOTS[assignment[names[j]]] ?? assignment[names[j]]
      const overlap = Math.min(a[1], b[1]) - Math.max(a[0], b[0])
      if (overlap > 10) bad.push(`${names[i]} and ${names[j]} share ${overlap} semitones`)
    }
  }
  return bad
}

// ═══ ARRANGEMENT ════════════════════════════════════════════════════════════
//
// The measured faults: three layers arriving at one seam, and every section
// carrying the same note density. Both are the sound of a loop being switched
// on and off rather than an arrangement.

/**
 * Stagger the ENTRANCES so no seam has several layers arriving together.
 *
 * Only entrances. The first version of this counted departures too, and it was
 * wrong in a way worth recording: told that a strip-back section drops the kick,
 * the hats and the bass at once, it "fixed" the seam by pushing the kick INTO
 * the strip-back — destroying the one gesture the section existed for.
 *
 * Several layers arriving together is the sound of a loop being switched on.
 * Several layers LEAVING together is a drop-out, which is one of the strongest
 * things an arrangement can do. They are not the same event and they do not get
 * the same rule.
 *
 * `plan` is a list of {name, bars, want:[layer…]}. An entrance that cannot be
 * staggered is reported in `unresolved` rather than silently dropped — a layer
 * arriving early is a build, a layer never arriving is a hole.
 */
export function stagger(plan, { maxChurn = 2 } = {}) {
  const out = plan.map(s => ({ ...s, layers: [...new Set(s.want)] }))
  const unresolved = []
  for (let i = 1; i < out.length; i++) {
    const prev = out[i - 1]
    const prevSet = new Set(prev.layers)
    const entering = out[i].layers.filter(x => !prevSet.has(x))
    if (entering.length <= maxChurn) continue

    // Coming back after a drop-out, the whole band arriving together is the
    // POINT — it is the payoff the drop set up, and staggering it would throw
    // away the release. A section counts as a drop-out when it only removed
    // layers relative to the section before it.
    const before = out[i - 2]
    const isReturnFromDrop = before
      ? prev.layers.length < before.layers.length && prev.layers.every(x => before.layers.includes(x))
      : false
    if (isReturnFromDrop) continue

    // Otherwise pull entrances back a section so it builds rather than switching
    // on. Never into a section that deliberately dropped that layer: doing that
    // was the first version's bug — told the strip-back drops kick, hats and
    // bass, it put the kick back into the strip-back.
    let over = entering.length - maxChurn
    const prevDropped = new Set(before ? before.layers.filter(x => !prev.want.includes(x)) : [])
    for (let k = 0; k < entering.length && over > 0; k++) {
      const move = entering[k]
      if (prevDropped.has(move)) continue
      prev.layers.push(move)
      over--
    }
    if (over > 0) unresolved.push(`${out[i].name}: ${entering.length} layers arrive at once (${entering.join(', ')})`)
  }
  return { sections: out, unresolved }
}

/**
 * A density target per section, as a multiplier on the busiest section.
 *
 * The rule this encodes is that the quietest section has to be GENUINELY quiet.
 * A ratio under about 1.8 between the sparsest and densest reads as constant,
 * and constant density is the thing that makes an arrangement sound like a loop
 * with layers muted.
 */
export function densityArc(energies) {
  const lo = Math.min(...energies), hi = Math.max(...energies)
  const span = Math.max(1e-6, hi - lo)
  return energies.map(e => 0.25 + 0.75 * ((e - lo) / span))
}

/** Thin a part to a density: keeps downbeats and the loudest notes first. */
export function thin(notes, keepFraction, { bpb = 4 } = {}) {
  if (keepFraction >= 1) return notes
  const scored = notes.map(n => {
    const inBar = ((n.beat % bpb) + bpb) % bpb
    let s = (n.velocity ?? 90)
    if (Math.abs(inBar) < 0.05) s += 200            // never lose the downbeat
    else if (Math.abs(inBar % 1) < 0.05) s += 60
    return { n, s }
  }).sort((a, b) => b.s - a.s)
  return scored.slice(0, Math.max(1, Math.round(notes.length * keepFraction)))
    .map(x => x.n).sort((a, b) => a.beat - b.beat)
}

// ═══ MOTIF ══════════════════════════════════════════════════════════════════
// Small transformations, so a part can develop instead of repeating. These are
// options to draw from, not a checklist to apply.

export const motif = {
  transpose: (notes, semitones) => notes.map(n => ({ ...n, pitch: n.pitch + semitones })),
  invert: (notes, axis) => notes.map(n => ({ ...n, pitch: 2 * (axis ?? notes[0].pitch) - n.pitch })),
  retrograde: notes => {
    const end = Math.max(...notes.map(n => n.beat + n.durationBeats))
    return notes.map(n => ({ ...n, beat: end - n.beat - n.durationBeats })).sort((a, b) => a.beat - b.beat)
  },
  augment: (notes, factor = 2) => notes.map(n => ({ ...n, beat: n.beat * factor, durationBeats: n.durationBeats * factor })),
  /** Answer a phrase: same rhythm, moved to fit a new chord. */
  answer: (notes, chordTones) => notes.map(n => {
    const pcs = chordTones.map(t => t % 12)
    let p = n.pitch
    for (let d = 0; d <= 6; d++) {
      if (pcs.includes(((p - d) % 12 + 12) % 12)) { p -= d; break }
      if (pcs.includes(((p + d) % 12 + 12) % 12)) { p += d; break }
    }
    return { ...n, pitch: p }
  }),
}
