// Shared authoring kit for songs I write directly into the studio's own format.
//
// This exists because the first pass at the dark-minimal set was a `chords`
// array plus a `melody` array played twice: a lead line over a loop, one clip
// per track, ~60 seconds, no dynamics. Brae's read was "elementary… quick and
// sloppy", and he was right. The rules that produced the one he liked are all
// structural, so they belong in the tooling rather than in my good intentions:
//
//   • no lead lines at all (standing rule) — the music has to work through
//     harmony, groove, texture and arc
//   • a real arc: sections that add and remove ONE layer at a time
//   • every track split into one clip PER SECTION, so the arrangement is
//     editable in the DAW rather than a single frozen blob
//   • humanised velocity and micro-timing; nothing sits exactly on the grid
//   • the dynamics live as EFFECT BARS in the FX lane where Brae can see and
//     edit them, not hidden inside clip graphs
//
// Notes are authored per section with beats relative to that section, and this
// assembles them into clips whose `startBeat` places the section on the timeline
// (clip notes are clip-relative, which is the shape the loader expects).

import { randomUUID } from 'crypto'

export const uid = () => randomUUID()

// ── Deterministic randomness ────────────────────────────────────────────────
// Seeded so a render is reproducible: when Brae says "the hats are too loud in
// the second half" I need to change that and nothing else.
export function rng(seed = 7) {
  let s = seed >>> 0
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 }
}

/** Humanising helpers. `bpm` converts milliseconds of feel into beats. */
export function feel(rand, bpm) {
  const msToBeats = ms => ms / 1000 * (bpm / 60)
  return {
    msToBeats,
    /** ±ms of micro-timing, in beats. Straight grid is the robotic tell. */
    jitter: ms => (rand() * 2 - 1) * msToBeats(ms),
    /** Velocity around a base, clamped to MIDI range. */
    vary: (base, spread = 6) => Math.max(1, Math.min(127, Math.round(base + (rand() * 2 - 1) * spread))),
    /** Swing offset for a 16th-note index: pushes the off-16ths late. */
    swing16: (i, amount = 0.06) => (i % 2 ? amount : 0),
    chance: p => rand() < p,
  }
}

export const N = (pitch, startBeat, durationBeats, velocity = 90) => ({
  id: uid(),
  pitch,
  startBeat: +Math.max(0, startBeat).toFixed(4),
  durationBeats: +Math.max(0.05, durationBeats).toFixed(4),
  velocity,
})

// ── Effect palette ──────────────────────────────────────────────────────────
// Deliberately limited to eq3 / chorus / compressor / reverb: the engine's
// `delay` and `distortion` nodes derive a non-finite AudioParam at headless
// bounce time (the cfproj data scans clean — the NaN appears at runtime), which
// silently kills a render. Saturation and delay go on in post instead.
export const eq3 = (lowGain, midGain, highGain, lowFreq = 200, midFreq = 900, highFreq = 6000) =>
  ({ id: uid(), type: 'eq3', params: { enabled: true, lowGain, midGain, highGain, lowFreq, midFreq, highFreq } })
export const reverb = (wet, decay, preDelay = 0.02) =>
  ({ id: uid(), type: 'reverb', params: { enabled: true, wet, decay, preDelay } })
export const chorus = (mix = 0.35, rate = 0.5, depth = 0.4) =>
  ({ id: uid(), type: 'chorus', params: { enabled: true, type: 'chorus', rate, depth, feedback: 0.2, mix, stages: 3 } })
export const compressor = (threshold = -20, ratio = 3, makeupGain = 2) =>
  ({ id: uid(), type: 'compressor', params: { enabled: true, threshold, ratio, attack: 0.005, release: 0.22, knee: 6, makeupGain } })

// ── FX-lane effect bars ─────────────────────────────────────────────────────
// A bar carries `fx` (the fully-on target) and one `graph` from 0 (neutral) to
// 1 (that target), with point times in BEATS from the bar's start. Every active
// param in `fx` follows the single graph together.
export function bar(trackKey, startBeat, durationBeats, fx, points, row = 0) {
  return {
    trackKey, startBeat, durationBeats, row, fx,
    graph: points.map(([t, v]) => ({ id: uid(), t: +t.toFixed(4), v: +v.toFixed(4), smooth: false, h1: [0, 0], h2: [0, 0] })),
  }
}

/** The transition Brae asked for: pull the low-pass down and duck slightly over
 *  the last beats of a section, so the arrival into the next one lands harder.
 *  The numbers are the ones that measured as real contrast (~2–3 dB) rather than
 *  the first, inaudible attempt: duck to ~0.77 and close the filter properly. */
export const dipInto = (trackKey, sectionStartBeat, beats = 2, row = 0) =>
  bar(trackKey, sectionStartBeat - beats, beats, { filterHz: 620, gain: 0.77 },
      [[0, 0], [beats * 0.65, 0.85], [beats, 1]], row)

/** A long emphasis across a section: a little drive and a relative volume lift.
 *  Volume tops out at 1, so an emphasised part sits at its section base and
 *  rides up rather than trying to exceed unity. */
export const lift = (trackKey, startBeat, durationBeats, { drive = 0.04, gain = 1.08 } = {}, row = 1) =>
  bar(trackKey, startBeat, durationBeats, { drive, gain },
      [[0, 0], [durationBeats * 0.25, 1], [durationBeats * 0.8, 1], [durationBeats, 0.25]], row)

// ── Assembly ────────────────────────────────────────────────────────────────
/**
 * tracks:   [{ key, name, instrument, presetId, volume, pan, effects, isDrum, rollFx }]
 * sections: [{ name, bars, parts: { [trackKey]: Note[] } }]  — note beats are
 *           relative to the section, and become one clip per section per track.
 * bars:     effect-bar descriptors from bar()/dipInto()/lift(), beats absolute.
 */
export function assemble({ name, bpm, bpb = 4, key, scale, swing = 0, tracks, sections, bars: fxBars = [], masterVolume = 0.82 }) {
  const clips = []
  let beat = 0
  const sectionAt = {}
  for (const sec of sections) {
    sectionAt[sec.name] = beat
    const len = sec.bars * bpb
    for (const t of tracks) {
      const notes = sec.parts?.[t.key]
      if (!notes || !notes.length) continue      // a track that sits out has no clip here
      // Drop a note that lands on the same pitch at the same instant as one
      // already there. Two identical hits do not sound twice as loud, they phase
      // against each other and come out as one slightly wrong note — and it
      // happens by accident, when a random sixteenth fill lands on a beat that
      // already has a hit. check-notes.mjs found exactly that in Winter Drift:
      // two C4 hats together at beat 163.5. Keeping the LOUDER of the two.
      const bySlot = new Map()
      for (const n of notes) {
        const startBeat = +Math.max(0, n.startBeat).toFixed(4)
        // Keep the note inside its clip. Humanising pushes late notes later, and
        // a note that runs past the clip boundary is reported as a fault by
        // check-notes and gets cut at playback anyway.
        const durationBeats = +Math.max(0.05, Math.min(n.durationBeats, len - startBeat)).toFixed(4)
        const slot = `${n.pitch}@${startBeat.toFixed(3)}`
        const prev = bySlot.get(slot)
        if (!prev || (n.velocity ?? 0) > (prev.velocity ?? 0)) bySlot.set(slot, { ...n, startBeat, durationBeats })
      }
      clips.push({
        kind: 'midi', id: uid(), trackId: t.id, name: `${t.name} · ${sec.name}`,
        startBeat: beat, durationBeats: len,
        // Written WITHOUT note ids. A note's id is runtime identity, not musical
        // data: `restoreNoteIds` in lib/note-ids.ts re-derives them by index on
        // load, so the stored form does not need them — and they are 17-22% of a
        // song file and, being random, do not compress. This is the app's own
        // convention (lib/note-ids.ts, npm run test:noteids); the authoring path
        // simply was not following it.
        notes: [...bySlot.values()].sort((a, b) => a.startBeat - b.startBeat)
          .map(({ id, ...rest }) => rest),
        isDrumClip: !!t.isDrum, presetId: t.presetId ?? null,
        rollFx: sec.rollFx?.[t.key] ?? t.rollFx ?? {},
      })
    }
    beat += len
  }
  const songBeats = beat

  const byKey = Object.fromEntries(tracks.map(t => [t.key, t.id]))
  const clipEffects = fxBars
    .filter(b => b.startBeat >= 0)
    .map(b => ({ id: uid(), trackId: byKey[b.trackKey], startBeat: +b.startBeat.toFixed(4),
                 durationBeats: +b.durationBeats.toFixed(4), row: b.row ?? 0, fx: b.fx, graph: b.graph }))

  const dawProject = {
    id: uid(), name, tempo: bpm, timeSignatureNum: bpb, timeSignatureDen: 4,
    swing, key, scale, masterVolume,
    tracks: tracks.map(t => ({
      id: t.id, name: t.name, type: 'audio', color: t.color ?? '#a78bfa',
      volume: t.volume ?? 0.8, pan: t.pan ?? 0, mute: false, solo: false, armed: false,
      height: 64, effects: t.effects ?? [], instrument: t.instrument ?? { type: 'none', params: {} },
    })),
    arrangementClips: clips,
    sessionGrid: [], scenes: [], automationLanes: [], clipEffects,
    returnTracks: [],        // effects go on the trackhead, never on returns
    takeLanes: [],
    loopStart: 0, loopEnd: songBeats, loopEnabled: false,
  }
  return {
    project: {
      _type: '100lights-project', version: 1, id: uid(), name, savedAt: new Date(0).toISOString(),
      tracks: [], clips: [], adjustments: {}, zoomLevel: 1, captions: [], outputs: [],
      media: [], modules: ['audio'], audioMode: true, dawProject,
    },
    songBeats, sectionAt,
    seconds: songBeats * (60 / bpm),
  }
}

/** Guard rail: sampled presets only sound right inside their sampled range.
 *  Out-of-range notes repitch badly — the "plays a bit off" problem. */
export function assertInRange(label, notes, lo, hi) {
  const bad = notes.filter(n => n.pitch < lo || n.pitch > hi)
  if (bad.length) {
    const pitches = [...new Set(bad.map(n => n.pitch))].sort((a, b) => a - b)
    throw new Error(`${label}: ${bad.length} note(s) outside the preset's sampled range ${lo}..${hi}: ${pitches.join(', ')}`)
  }
}
