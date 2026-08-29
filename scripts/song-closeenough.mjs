// "close enough" — C minor, 112 BPM. An original song in the measured Artemas
// space (styles/artemas.json), not a recreation of any of theirs.
//
// ── WHAT THIS SONG IS ───────────────────────────────────────────────────────
//
// It says the same thing over and over and never quite resolves. The chords are
// the song — not a bed under something else — and almost nothing happens to
// them. What moves is where they sit, not what they are.
//
// It is deliberately the opposite record to "under it all", written the same
// day: that one is 132 BPM, sub-led, nearly empty and travels as far as it can;
// this one is slow, full, harmony-led and barely travels at all. Both are inside
// the same artist profile, which is the point CRAFT §7b is making.
//
// ── WHY THIS SHAPE ──────────────────────────────────────────────────────────
//
//   i always kinda knew… | 98 bpm | sub 24% / bass 25% | harmony −5.2 dB
//                        | 2 sections | travels 3.0 dB | "harmony-forward and static"
//
//   harmony  −5.2 dB. The chords are as loud as the drums. This is the single
//                    most unusual number in the whole reference set: the harmony
//                    layer across the five records spans −5.2 to −20 dB, and
//                    every song written here so far has sat at the quiet end,
//                    because §2 says to leave the midrange for a voice. One of
//                    the five does not, and this is that one.
//   static   2 sections, travels 3.0 dB. Our songs have been travelling 17.7 dB.
//                    So the dynamic scale here is 0.80–1.0 — narrower even than
//                    "i'd ruin it again"'s 0.72 — and there are five sections
//                    rather than nine, none of which strips the harmony out.
//   low end  sub 24 / bass 25, the most balanced pair in the set. Neither one is
//                    the story, which is what leaves room for the chords.
//   tempo    112. Not the 98 median: 98 is where "the quiet part" and "Cold
//                    Signal" already sit, and a record that refuses to develop
//                    needs enough forward motion not to stall. Well inside 95–152.
//   swing    none. All five references are 49.5–50.0%.
//
// ── WHY C MINOR, AND THE ONE CHORD THAT DOES THE WORK ───────────────────────
//
// C minor is in the measured key set and is the only one of the five that is not
// heavily flat, which suits a record whose harmony has to stay legible while
// being the loudest thing in it.
//
//   i – i – ♭VI – v.   Cm9 · Cm9 · A♭maj7♯11 · Gm7
//
// The minor v is the whole trick. In a minor key the v chord is normally raised
// to a dominant (G7) precisely so that it pulls home; left minor it has no
// leading tone and pulls nowhere, so the loop can turn over indefinitely without
// ever sounding like it has arrived or like it has stopped. That is "static" as
// a harmonic decision rather than as an absence of one.
//
// It is a plain m7 and not the m11 written first. `check-notes` found the reason:
// the eleventh chord's NINTH is A natural, the one pitch outside C minor, and it
// was landing 48 times in the loudest harmony layer. A borrowed tone that passes
// once is colour; the same exposed non-diatonic ninth on a chord this record
// returns to fourteen times is a decision to make on purpose, and the dorian
// inflection is not worth that much here. Gm7 is fully diatonic and still
// refuses to resolve, which is the entire job of the chord.
//
// Two bars of tonic out of four, for the same reason as the other song: a loop
// this short needs somewhere to sit still, or the turnaround becomes the hook.
//
// ── WHAT EACH PART DOES, AND REFUSES TO DO ──────────────────────────────────
//
//   piano  the co-lead. Real recorded grand, rootless so the bass keeps the
//          bottom. It HOLDS — long chords, almost no rhythm of its own — because
//          the record's motion has to come from somewhere other than the part
//          carrying the harmony, or "static" turns into "repetitive".
//   ep     the same chords, an octave up, comping in eighths. This is where the
//          movement went. It is chordal throughout and never plays a line: the
//          standing rule against lead lines is not suspended for the song whose
//          harmony is loudest, it matters more there.
//   bass   loudest element after the harmony (the references put bass on top in
//          all five, median −4.1 dB). One figure, every bar, barely varied — it
//          is the floor the chords stand on, not a part with an argument.
//   sub    downbeats only, and short. At 24% it underlines the bass rather than
//          replacing it, and it does NOT glide: "under it all" spends its whole
//          budget on a moving sub, and doing it twice would make the two songs
//          the same trick at different speeds.
//   drums  boombap kit — the dustiest and darkest of the eight, which is what a
//          warm static record wants. Mid-density: eighth hats with a few
//          sixteenth ghosts, ~7 onsets/sec against the measured 5.5–9.2.
// ── TWO THINGS TRIED THAT DID NOT WORK ──────────────────────────────────────
//
// WIDENING THE EP. `listen` warns that the mix is near-mono (0.967 against the
// references' 0.438–0.932), and the obvious fix was to take this song's copy of
// warmEp from unison 2 to unison 3 — which also fixes a known fault, since two
// detuned copies sit at the extremes with no centre voice between them. It made
// the measurement WORSE, 0.967 to 0.969, and lowMid worse with it. The reason is
// the same in both directions: the third copy is the CENTRE one, and a centre
// voice is mono energy. Reverted. Half the mix here is sub, bass and kick, all
// of which are mono on purpose, so the reachable floor is high whatever the top
// end does; the references get to 0.44 with a wide vocal this does not have.
//
// TRACKHEAD EFFECTS for the same job. They are not applied by the offline
// renderer at all — `listen` reports them as a render fault — so width added
// there is invisible to every measurement taken before delivery. Where a part
// needs space it is done inside the Apollo patch (`verb`), which does render.
//
//   out    the drums leave for the last eight bars. It is the one genuinely
//          sparse place in the song, and on a record this static it has to be a
//          removal, because there is no build available to make.
//
// ── THE ONE DEVICE ──────────────────────────────────────────────────────────
//
// The voicing CLIMBS. Every section re-voices the same four chords a little
// higher and then voice-leads within itself, so bar 1 of the last verse is the
// same harmony as bar 1 of the first and is unmistakably further up. That is the
// only long-range movement in the song, and it is the reason it can stay on one
// loop for two minutes without the loop being the thing you notice.

import { uid, N, rng, feel, assemble, bar, dipInto, lift, assertInRange } from './song-kit.mjs'
import { groove, play, voice, intoSlot, stagger, densityArc, deMud } from './lib/craft.mjs'
import { subBass, warmEp } from './apollo-voices.mjs'
import { sKick, sClap, sHat, sPiano, sBass } from './sampled-voices.mjs'

const BPM = 112, BPB = 4, KEY = 'C', SCALE = 'minor'
const rand = rng(20260830)
const f = feel(rand, BPM)
const g = groove({ bpm: BPM, spreadMs: 16, seed: 20260830 })

// ── Harmony ─────────────────────────────────────────────────────────────────
const LOOP = ['Cm9', 'Cm9', 'Abmaj7#11', 'Gm7']
const ROOTS = { Cm9: 48, 'Abmaj7#11': 44, Gm7: 43 }
const chordAt = i => LOOP[i % 4]

// ── Sub ─────────────────────────────────────────────────────────────────────
// Downbeat, and short enough to leave the bar to the bass.
const subBar = i => [{
  pitch: intoSlot(ROOTS[chordAt(i)] - 12, 'sub'), beat: 0, durationBeats: 2.6, velocity: 88,
}]

// ── Bass ────────────────────────────────────────────────────────────────────
// One figure. It does not develop, and that is the job: root on the downbeat,
// the same root pushed off the third beat, and a fifth on the way back round.
const bassBar = i => {
  const root = intoSlot(ROOTS[chordAt(i)], 'bass')
  return [
    { pitch: root, beat: 0, durationBeats: 1.4, velocity: 106 },
    { pitch: root, beat: 2.25, durationBeats: 0.8, velocity: 90 },
    { pitch: root + 7, beat: 3.5, durationBeats: 0.45, velocity: 78 },
  ]
}

// ── Piano ───────────────────────────────────────────────────────────────────
// Rootless and HELD. `centre` climbs a little each section — the only long-range
// movement in the song. The recorded grand is only usable C3–A4 (its low roots
// are mislabelled and dropped), so the climb is capped well inside that and
// `assertInRange` refuses anything that escapes it.
const PIANO_RANGE = [48, 69]          // C3–A4, the grand's usable span
let pianoVoicing = null
const pianoBar = (i, centre) => {
  // FOLDED into the instrument's range, not merely centred inside it. `voice()`
  // places degrees within centre ± spread, but its voice-leading pass then
  // searches centre ± (spread + 6) for the nearest octave — a 28-semitone window
  // at spread 8, against the grand's usable 21. No centre and spread exist that
  // fit, which is why two attempts at tuning them both still produced a B♭2 the
  // piano does not have. Folding each note into the range afterwards is the only
  // thing that actually holds.
  const v = voice(chordAt(i), { style: 'rootless', centre, spread: 8, near: pianoVoicing })
    .map(p => intoSlot(p, PIANO_RANGE))
  pianoVoicing = v
  return v.map((p, k) => ({
    pitch: p, beat: k * 0.03, durationBeats: BPB - 0.25 - k * 0.03, velocity: 82 - k * 3,
  }))
}

// ── Electric piano ──────────────────────────────────────────────────────────
// The same chords an octave up, comping in eighths. Chordal on every beat — it
// never reduces to a single moving voice, which is what would make it a line.
let epVoicing = null
const epBar = (i, centre, busy) => {
  // FOLDED into the upper slot (G4–E6), and 'rootless' rather than 'open'.
  // Both matter, and the reason is the band table: lowMid is 120–400 Hz, and a
  // recorded grand playing chords in its usable C3–A4 has its fundamentals at
  // 262–370 Hz — it lives in lowMid by physics, and no fader or filter moves it
  // out. So the harmony's LOUD layer has to be the one that can go higher.
  // 'open' was the wrong style for that: it drops the second-highest note an
  // octave by design, which pulled this part straight back down into the piano's
  // register and left the mix at 45% lowMid against the reference's 22%.
  const v = deMud([...new Set(
    voice(chordAt(i), { style: 'rootless', centre, spread: 10, near: epVoicing })
      .map(p => intoSlot(p, 'upper')),
  )].sort((a, b) => a - b)).slice(0, 3)
  epVoicing = v
  // warmEp is three synth voices per note (osc A at unison 2, osc B at 1), so a
  // three-note chord costs nine and two overlapping chords cost eighteen —
  // Apollo allows sixteen. Hits are spaced a beat apart and each is shorter
  // than the gap, so only one chord is ever sounding.
  const hits = busy ? [0, 1.5, 2.5, 3.5] : [0, 1.5, 3]
  const out = []
  for (const h of hits) {
    for (const p of v) {
      out.push({ pitch: p, beat: h, durationBeats: 0.4, velocity: h === 0 ? 66 : 52 })
    }
  }
  return out
}

// ── Drums ───────────────────────────────────────────────────────────────────
const kickBar = () => [
  { pitch: 36, beat: 0, durationBeats: 0.5, velocity: 116 },
  { pitch: 36, beat: 2.25, durationBeats: 0.5, velocity: 98 },
]
// The backbeat leans: harder on the bar that starts a two-bar phrase, softer on
// the answer. Written flat first, and `listen` was right to call it out — an
// unvarying clap is the one thing that makes a static record sound programmed.
const clapBar = b => [{ pitch: 39, beat: 2, durationBeats: 0.5, velocity: b % 2 ? 96 : 112 }]
// Eighths, with a sixteenth ghost pair on the last beat — enough to sit around
// 7 onsets/sec without the hats becoming the busiest thing in the room.
const hatBar = b => {
  const out = Array.from({ length: 8 }, (_, k) => ({
    pitch: 42, beat: k * 0.5, durationBeats: 0.2, velocity: k % 2 ? 84 : 62,
  }))
  if (b % 2 === 1) out.push({ pitch: 42, beat: 3.25, durationBeats: 0.16, velocity: 48 })
  return out
}

// ── Arrangement ─────────────────────────────────────────────────────────────
// Five sections, and the harmony is in every one of them. The energies sit in a
// narrow band on purpose: this record is not supposed to travel.
const SECTIONS = [
  { name: 'Open',    bars: 8,  energy: 0.62, want: ['piano', 'ep', 'bass'] },
  { name: 'Verse',   bars: 16, energy: 0.80, want: ['piano', 'ep', 'bass', 'sub', 'kick', 'hats'] },
  { name: 'Turn',    bars: 8,  energy: 0.92, want: ['piano', 'ep', 'bass', 'sub', 'kick', 'hats', 'clap'] },
  { name: 'Verse 2', bars: 16, energy: 0.86, want: ['piano', 'ep', 'bass', 'sub', 'kick', 'hats', 'clap'] },
  { name: 'Out',     bars: 8,  energy: 0.66, want: ['piano', 'ep', 'bass', 'sub'] },
]

// The climb: where the piano and the EP are centred in each section. The span
// is six semitones, bounded at both ends by the recorded grand's usable C3–A4 —
// the first pass started at 55 and `assertInRange` refused it, because a
// rootless voicing centred there reaches down to 46 and the piano's low roots
// do not exist. A wider climb would need a different instrument, not a wider
// spread.
const CENTRE = { Open: 60, Verse: 61, Turn: 63, 'Verse 2': 65, Out: 66 }

const TRACKS = [
  { key: 'sub',   id: uid(), name: 'Sub',   presetId: null, volume: 0.64, color: '#a78bfa',
    instrument: { type: 'apollo', params: subBass() } },
  { key: 'bass',  id: uid(), name: 'Bass',  presetId: null, volume: 0.66, color: '#f472b6',
    instrument: { type: 'apollo', params: sBass('electric-bass', { cutoff: 0.50 }) } },
  { key: 'piano', id: uid(), name: 'Piano', presetId: null, volume: 0.36, pan: -0.12, color: '#fcd34d',
    instrument: { type: 'apollo', params: sPiano({ cutoff: 0.90 }) } },
  { key: 'ep',    id: uid(), name: 'EP',    presetId: null, volume: 0.58, pan: 0.16, color: '#67e8f9',
    instrument: { type: 'apollo', params: warmEp() } },
  { key: 'kick',  id: uid(), name: 'Kick',  presetId: null, volume: 0.70, color: '#fb923c',
    instrument: { type: 'apollo', params: sKick('boombap') } },
  { key: 'clap',  id: uid(), name: 'Clap',  presetId: null, volume: 0.92, pan: 0.14, color: '#a3e635',
    instrument: { type: 'apollo', params: sClap('boombap', { verb: 0.22 }) } },
  { key: 'hats',  id: uid(), name: 'Hats',  presetId: null, volume: 0.82, pan: 0.20, color: '#fda4af',
    instrument: { type: 'apollo', params: sHat('boombap', { verb: 0.10 }) } },
]

const density = densityArc(SECTIONS.map(s => s.energy))
const staged = stagger(SECTIONS)
for (const u of staged.unresolved) console.log(`  ! ${u}`)

let barIndex = 0
const sections = staged.sections.map((sec, si) => {
  const parts = {}
  const push = (k, ns) => { (parts[k] ??= []).push(...ns) }
  const on = new Set(sec.layers)
  const centre = CENTRE[sec.name] ?? 57
  // Re-voice from scratch at each section so the climb actually happens; inside
  // the section `near` then keeps it smooth. Without the reset, voice-leading
  // holds the chords exactly where they were and the song never moves at all.
  pianoVoicing = null
  epVoicing = null
  for (let b = 0; b < sec.bars; b++) {
    const i = barIndex + b
    const shift = ns => ns.map(n => ({ ...n, beat: n.beat + b * BPB }))
    if (on.has('sub')) push('sub', shift(subBar(i)))
    if (on.has('bass')) push('bass', shift(bassBar(i)))
    if (on.has('piano')) push('piano', shift(pianoBar(i, centre)))
    if (on.has('ep')) push('ep', shift(epBar(i, centre + 12, sec.name === 'Turn' || sec.name === 'Verse 2')))
    if (on.has('kick')) push('kick', shift(kickBar()))
    if (on.has('clap')) push('clap', shift(clapBar(b)))
    if (on.has('hats')) push('hats', shift(hatBar(b)))
  }
  barIndex += sec.bars

  // NARROW, unlike "under it all"'s 0.55–1.0. This is the shape that stays put.
  const dyn = 0.80 + 0.20 * density[si]
  const ROLE = { kick: 'kick', clap: 'clap', hats: 'hats', sub: 'sub', bass: 'bass', piano: 'keys', ep: 'keys' }
  const played = {}
  for (const [k, ns] of Object.entries(parts)) {
    played[k] = play(ns, ROLE[k] ?? 'default', g, { bpb: BPB })
      .map(n => N(n.pitch, n.beat, n.durationBeats, Math.max(1, Math.round(n.velocity * dyn))))
  }
  // The recorded grand is only in tune C3–A4; anything outside repitches badly.
  assertInRange(`piano · ${sec.name}`, played.piano ?? [], 48, 69)
  return { name: sec.name, bars: sec.bars, parts: played }
})

// ── Dynamics, in the FX lane where they can be edited ───────────────────────
// Small gestures only. A record that travels 3 dB cannot carry big ones, and
// the ones here are all about ARRIVAL rather than about level.
const at = {}
{
  let b = 0
  for (const s of SECTIONS) { at[s.name] = b; b += s.bars * BPB }
}
const W = n => n * BPB
const bars = [
  bar('piano', 0, W(8), { filterHz: 1400, gain: 0.94 }, [[0, 1], [W(6), 0.35], [W(8), 0]], 0),
  bar('ep', 0, W(8), { filterHz: 900, gain: 0.9 }, [[0, 1], [W(8), 0]], 0),
  dipInto('bass', at['Verse'], 2),
  dipInto('ep', at['Turn'], 2),
  lift('ep', at['Turn'], W(8), { drive: 0.05, gain: 1.08 }, 1),
  lift('piano', at['Turn'], W(8), { drive: 0.03, gain: 1.05 }, 1),
  dipInto('hats', at['Verse 2'], 3),
  lift('bass', at['Verse 2'], W(16), { drive: 0.04, gain: 1.04 }, 1),
  // The drums have gone; the harmony opens up to fill the space they left.
  bar('piano', at['Out'], W(8), { filterHz: 1200, gain: 1.04 }, [[0, 0], [W(2), 1], [W(8), 0.5]], 0),
  bar('ep', at['Out'], W(8), { filterHz: 800, gain: 1.0 }, [[0, 0.2], [W(3), 1], [W(8), 0]], 0),
]

const built = assemble({
  name: 'close enough',
  bpm: BPM, bpb: BPB, key: KEY, scale: SCALE,
  swing: 0, tracks: TRACKS, sections, bars, masterVolume: 0.84,
})

import { writeFileSync } from 'node:fs'
const OUT = process.env.SONG_OUT ?? '/Users/brae/Desktop/100lights-ai-renders/close enough.cfproj'
writeFileSync(OUT, JSON.stringify(built.project))
const dp = built.project.dawProject
const notes = dp.arrangementClips.reduce((a, c) => a + (c.notes?.length ?? 0), 0)
console.log(`${dp.name} — ${BPM} BPM, ${KEY} ${SCALE}, ${built.seconds.toFixed(0)}s, ` +
  `${dp.arrangementClips.length} clips, ${notes} notes, ${dp.clipEffects.length} fx bars`)
for (const s of staged.sections) console.log(`  ${s.name.padEnd(9)} ${String(s.bars).padStart(2)} bars  ${s.layers.join(' ')}`)
console.log(`→ ${OUT}`)
