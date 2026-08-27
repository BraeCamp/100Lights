// What the notes themselves say, before anything is rendered.
//
// Audio analysis is expensive and blunt: it can tell you a mix is dark, but it
// cannot tell you the hats are quantised dead to the grid, that every instrument
// occupies the same octave, or that the arrangement adds four layers at once and
// then never changes again. Those are the things that make music sound
// programmed, and all of them are visible in the note data for free.
//
// Nothing here judges. It measures, and `verdicts.mjs` decides what is a
// problem — so the same numbers can be read against different targets for
// different genres without rewriting the analysis.

const round = (v, n = 2) => +v.toFixed(n)
const NOTE_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']
export const noteName = p => `${NOTE_NAMES[((p % 12) + 12) % 12]}${Math.floor(p / 12) - 1}`

/** Tracks whose pitches are triggers rather than notes. */
export const isPercussive = (name, pitches) =>
  /kick|snare|clap|hat|hihat|perc|drum|rim|tom|crash|ride|shaker|tick|snap|cowbell/i.test(name) ||
  new Set(pitches).size <= 2

// ── Sections ────────────────────────────────────────────────────────────────
/**
 * Songs assembled by song-kit have one clip per track per section, named
 * "Track · Section", so the arrangement's own structure is recoverable exactly.
 * For anything else, fall back to the beats where clips begin.
 */
export function sections(dp) {
  const clips = dp.arrangementClips ?? []
  if (!clips.length) return []
  const starts = [...new Set(clips.map(c => c.startBeat))].sort((a, b) => a - b)
  const bpb = dp.timeSignatureNum || 4
  const end = Math.max(...clips.map(c => c.startBeat + c.durationBeats))
  return starts.map((s, i) => {
    const next = starts[i + 1] ?? end
    const here = clips.filter(c => c.startBeat === s)
    const named = here.map(c => (c.name ?? '').split('·').pop().trim()).filter(Boolean)
    const counts = {}
    for (const n of named) counts[n] = (counts[n] ?? 0) + 1
    const name = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? `bar ${s / bpb + 1}`
    return {
      name, startBeat: s, endBeat: next,
      bars: round((next - s) / bpb, 2),
      startBar: s / bpb + 1,
      tracks: [...new Set(clips.filter(c => c.startBeat < next && c.startBeat + c.durationBeats > s).map(c => c.trackId))],
    }
  })
}

// ── Groove ──────────────────────────────────────────────────────────────────
/**
 * How far each track sits from the grid, and in which direction.
 *
 * This is the measurement that was missing entirely. A drummer does not play on
 * the grid: the snare lands a few milliseconds late and the bass a few early,
 * and the size and consistency of those offsets is most of what "feel" means. A
 * generator that jitters every part by the same symmetric random amount has
 * motion but no feel — it measures as loose with zero push, which is exactly
 * what a machine sounds like.
 *
 * Reported per track: mean offset in ms (negative = ahead of the beat, the
 * "pushing" feel; positive = behind, "laid back"), the spread, and the swing
 * ratio of the off-eighths.
 */
export function groove(dp, trackNotes) {
  const spb = 60 / (dp.tempo || 120)
  const out = []
  for (const [name, notes] of Object.entries(trackNotes)) {
    if (!notes.length) continue
    const offsets = [], swingOffsets = []
    for (const n of notes) {
      const grid = Math.round(n.beat * 4) / 4                 // nearest 16th
      const offBeats = n.beat - grid
      const ms = offBeats * spb * 1000
      if (Math.abs(ms) > 120) continue                        // deliberately off-grid, not feel
      offsets.push(ms)
      const sixteenth = Math.round(n.beat * 4) % 4
      if (sixteenth === 1 || sixteenth === 3) swingOffsets.push(ms)
    }
    if (!offsets.length) continue
    const mean = offsets.reduce((a, b) => a + b, 0) / offsets.length
    const sd = Math.sqrt(offsets.reduce((a, b) => a + (b - mean) ** 2, 0) / offsets.length)
    const onGrid = offsets.filter(o => Math.abs(o) < 1).length / offsets.length
    const swingMean = swingOffsets.length ? swingOffsets.reduce((a, b) => a + b, 0) / swingOffsets.length : 0
    // A swing ratio expressed the way a DAW does: 50% is straight, 66% is triplet.
    const sixteenthMs = spb * 250
    out.push({
      track: name,
      meanOffsetMs: round(mean, 1),
      spreadMs: round(sd, 1),
      onGridPct: round(onGrid * 100, 1),
      swingPct: round(50 + (swingMean / Math.max(1e-6, sixteenthMs)) * 50, 1),
      notes: notes.length,
    })
  }
  return out
}

// ── Velocity ────────────────────────────────────────────────────────────────
/** Velocity shape per track: range, and whether accents follow the bar. */
export function dynamics(dp, trackNotes) {
  const bpb = dp.timeSignatureNum || 4
  return Object.entries(trackNotes).filter(([, n]) => n.length).map(([name, notes]) => {
    const vels = notes.map(n => n.velocity)
    const mean = vels.reduce((a, b) => a + b, 0) / vels.length
    const sd = Math.sqrt(vels.reduce((a, b) => a + (b - mean) ** 2, 0) / vels.length)
    const downbeats = notes.filter(n => Math.abs(n.beat % bpb) < 0.05)
    const offbeats = notes.filter(n => Math.abs(n.beat % bpb) >= 0.05)
    const avg = a => a.length ? a.reduce((s, n) => s + n.velocity, 0) / a.length : 0
    // Only meaningful when the part actually plays on and off the downbeat. A
    // sub that only ever lands on beat one has no offbeats to be louder than,
    // and reporting "accent +81" for that is a measurement of nothing.
    const accent = downbeats.length && offbeats.length ? round(avg(downbeats) - avg(offbeats), 1) : null
    return {
      track: name,
      meanVelocity: Math.round(mean),
      spread: round(sd, 1),
      range: [Math.min(...vels), Math.max(...vels)],
      // Positive means downbeats are played harder, which is what a human does.
      accent,
      distinctValues: new Set(vels).size,
    }
  })
}

// ── Register ────────────────────────────────────────────────────────────────
/**
 * Where each part lives, and where two parts are fighting for the same space.
 *
 * Two instruments in the same octave playing at the same time mask each other no
 * matter how the mix is balanced — the fix is arrangement (move one an octave,
 * or thin it), not EQ. Reported as an overlap fraction between every pair that
 * actually sounds at the same time.
 */
export function registers(trackNotes) {
  const spans = {}
  for (const [name, notes] of Object.entries(trackNotes)) {
    if (!notes.length) continue
    const p = notes.map(n => n.pitch).sort((a, b) => a - b)
    const q = f => p[Math.min(p.length - 1, Math.floor(f * (p.length - 1)))]
    spans[name] = { lo: p[0], hi: p[p.length - 1], p10: q(0.1), p90: q(0.9), median: q(0.5) }
  }
  const clashes = []
  const names = Object.keys(spans)
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const a = spans[names[i]], b = spans[names[j]]
      const lo = Math.max(a.p10, b.p10), hi = Math.min(a.p90, b.p90)
      if (hi <= lo) continue
      const overlap = (hi - lo) / Math.max(1, Math.min(a.p90 - a.p10, b.p90 - b.p10))
      if (overlap > 0.6) clashes.push({ a: names[i], b: names[j], overlap: round(overlap, 2), semitones: hi - lo })
    }
  }
  return {
    spans: Object.fromEntries(Object.entries(spans).map(([k, v]) =>
      [k, { ...v, range: `${noteName(v.lo)}–${noteName(v.hi)}`, core: `${noteName(v.p10)}–${noteName(v.p90)}` }])),
    clashes: clashes.sort((x, y) => y.overlap - x.overlap),
  }
}

// ── Arrangement ─────────────────────────────────────────────────────────────
/**
 * The shape of the song: which layers are present in each section, how dense
 * each one is, and how many layers change at each seam.
 *
 * The rule this is here to check is that an arrangement adds and removes ONE
 * layer at a time. Four layers arriving together is the sound of a loop being
 * switched on, and it is the single most common way an assembled arrangement
 * gives itself away.
 */
export function arrangement(dp, trackNotes) {
  const secs = sections(dp)
  const byId = Object.fromEntries((dp.tracks ?? []).map(t => [t.id, t.name]))
  const spb = 60 / (dp.tempo || 120)
  const rows = secs.map(s => {
    const active = {}
    for (const c of (dp.arrangementClips ?? [])) {
      if (c.startBeat >= s.endBeat || c.startBeat + c.durationBeats <= s.startBeat) continue
      const name = byId[c.trackId] ?? c.trackId
      const inWindow = (c.notes ?? []).filter(n => {
        const at = c.startBeat + n.startBeat
        return at >= s.startBeat && at < s.endBeat
      })
      if (!inWindow.length) continue
      active[name] = (active[name] ?? 0) + inWindow.length
    }
    const beats = s.endBeat - s.startBeat
    return {
      name: s.name, startBar: s.startBar, bars: s.bars,
      layers: Object.keys(active).sort(),
      notes: Object.values(active).reduce((a, b) => a + b, 0),
      notesPerBar: round(Object.values(active).reduce((a, b) => a + b, 0) / Math.max(1, s.bars), 1),
      perTrack: active,
      seconds: round(beats * spb, 1),
    }
  })
  for (let i = 1; i < rows.length; i++) {
    const prev = new Set(rows[i - 1].layers), now = new Set(rows[i].layers)
    rows[i].entering = [...now].filter(x => !prev.has(x))
    rows[i].leaving = [...prev].filter(x => !now.has(x))
    rows[i].churn = rows[i].entering.length + rows[i].leaving.length
  }
  if (rows[0]) { rows[0].entering = rows[0].layers; rows[0].leaving = []; rows[0].churn = 0 }
  return rows
}

// ── Extraction ──────────────────────────────────────────────────────────────
/** Flatten a project into per-track absolute-beat notes, which everything uses. */
export function trackNotes(dp) {
  const byId = Object.fromEntries((dp.tracks ?? []).map(t => [t.id, t.name]))
  const out = {}
  for (const c of (dp.arrangementClips ?? [])) {
    if (c.kind && c.kind !== 'midi') continue
    const name = byId[c.trackId] ?? c.trackId
    ;(out[name] ??= [])
    for (const n of c.notes ?? []) {
      out[name].push({
        pitch: n.pitch,
        beat: c.startBeat + n.startBeat,
        durationBeats: n.durationBeats,
        velocity: n.velocity ?? 90,
        clip: c.name,
      })
    }
  }
  for (const k of Object.keys(out)) out[k].sort((a, b) => a.beat - b.beat)
  return out
}

/**
 * Peak simultaneous notes per track, and what that costs in synth voices.
 *
 * Apollo allows 16 voices per patch and unison MULTIPLIES per held note, so a
 * four-voice patch playing a four-note chord is already at the limit and past it
 * the allocator steals notes that are still sounding — audible as stuttering,
 * and invisible to every audio measurement because the render still has sound in
 * it. A pad on unison 4 + 3 costs 7 per note; four notes is 28.
 */
export function polyphony(dp, notes) {
  const byId = Object.fromEntries((dp.tracks ?? []).map(t => [t.name, t]))
  return Object.entries(notes).map(([name, ns]) => {
    // Sweep the note starts and ends; the high-water mark is the answer.
    const events = []
    for (const n of ns) { events.push([n.beat, 1], [n.beat + n.durationBeats, -1]) }
    events.sort((a, b) => a[0] - b[0] || a[1] - b[1])
    let cur = 0, peak = 0
    for (const [, d] of events) { cur += d; if (cur > peak) peak = cur }

    const p = byId[name]?.instrument?.type === 'apollo' ? byId[name].instrument.params : null
    let perNote = 1
    if (p) {
      perNote = 0
      for (const o of p.oscs ?? []) if (o.enabled) perNote += Math.max(1, o.unison || 1)
      if (p.sub?.enabled) perNote += 1
      if (p.noise?.enabled) perNote += 1
      perNote = Math.max(1, perNote)
    }
    return { track: name, maxAtOnce: peak, voicesPerNote: perNote, peakVoices: peak * perNote }
  })
}

/** Notes that run past the end of the clip holding them. */
export function overflow(dp) {
  const byId = Object.fromEntries((dp.tracks ?? []).map(t => [t.id, t.name]))
  const out = []
  for (const c of (dp.arrangementClips ?? [])) {
    for (const n of c.notes ?? []) {
      const over = (n.startBeat + n.durationBeats) - c.durationBeats
      if (over > 0.001) out.push({ track: byId[c.trackId] ?? c.trackId, clip: c.name, over: round(over, 3) })
    }
  }
  return out
}

/**
 * Which parts were WRITTEN to be one continuous sound.
 *
 * A line whose notes overlap is asking to be heard as a single sound that
 * changes pitch rather than a series of separate ones — a sub, a drone, a bowed
 * line. That intent is visible in the note data, and whether the render honours
 * it is checkable, so `listen` does both: it spots the intent here and then
 * looks at the stem to see whether the sound actually held.
 */
export function continuousParts(trackNotes) {
  const out = []
  for (const [name, notes] of Object.entries(trackNotes)) {
    if (notes.length < 4) continue
    let overlaps = 0
    for (let i = 0; i < notes.length - 1; i++) {
      if (notes[i].beat + notes[i].durationBeats > notes[i + 1].beat + 1e-6) overlaps++
    }
    const ratio = overlaps / (notes.length - 1)
    if (ratio >= 0.8) out.push({ track: name, notes: notes.length, overlapRatio: round(ratio, 2) })
  }
  return out
}

/** Everything symbolic, in one call. */
export function symbolic(dp) {
  const notes = trackNotes(dp)
  const pitched = Object.fromEntries(Object.entries(notes).filter(([n, v]) => !isPercussive(n, v.map(x => x.pitch))))
  return {
    tempo: dp.tempo, key: dp.key, scale: dp.scale, swing: dp.swing ?? 0,
    sections: sections(dp),
    arrangement: arrangement(dp, notes),
    groove: groove(dp, notes),
    dynamics: dynamics(dp, notes),
    registers: registers(pitched),
    polyphony: polyphony(dp, notes),
    continuous: continuousParts(notes),
    overflow: overflow(dp),
    totalNotes: Object.values(notes).reduce((a, b) => a + b.length, 0),
    trackNotes: notes,
  }
}
