// ── "Headroom" — a song built to expose the cutting out ─────────────────────
//
//   node scripts/song-headroom.mjs   → ~/Desktop/100lights-songs/Headroom.cfproj
//
// Brae: "Audio cutting out again. It isn't slowing down or lagging. Is it the
// computer trying to play every separate note in a piano roll perhaps, or is it
// still the effect? Can you make another song to test on in case anything that
// changed could have made existing projects break."
//
// It is the notes, and this song is arranged so you can hear that rather than
// take my word for it. Two mechanisms, both measured, neither of them lag and
// neither of them an effect:
//
//   THE MASTER LIMITER, which is the one you are almost certainly hearing.
//   Every voice sums at full level — there is no polyphony compensation — so
//   the peak of an Apollo track scales LINEARLY with how many notes are down,
//   and the master limiter (instant attack, 0.98 ceiling, 120 ms release) then
//   pulls the WHOLE TRACK down to fit. Each dense chord ducks everything else
//   on that track and crawls back over a tenth of a second.
//
//   ⚠️ How soon it bites depends on how hot the patch is voiced, which is why
//   this is not one number. On the INIT preset a single note already peaks at
//   0.39, so THREE notes reach the ceiling and an eight-note chord needs about
//   10 dB of reduction. On a properly voiced patch like the Warm Keys this song
//   uses, it is six or seven notes for about 3 dB. Both are audible; the first
//   is severe. `--measure` prints it for this song's own instrument.
//
//   VOICE STEALING, past global.poly (16 notes). The allocator kills an active
//   voice outright rather than releasing it, so a note stops mid-sustain. This
//   needs a genuinely dense roll — sixteen notes still sounding at once, which
//   long releases make easier than it sounds.
//
//   ⚠️ The limit counts NOTES, not unison voices — verified against the
//   allocator, which holds a fixed pool of 32 Voice objects and takes one per
//   note-on, with unison rendered inside a voice. A comment in apollo-voices
//   said a four-note chord at unison 7 was "28 voices against a limit of 16",
//   and that arithmetic is wrong. Reducing unison there was still right, for
//   the summing above and for CPU, but not for the reason given.
//
// ⚠️ The per-track limiter is PER APOLLO INSTRUMENT, not the mix. Spreading a
// chord across three tracks does not trigger it; stacking it on one does. So
// the test has to put the density on a SINGLE track, and Chords is that track.
//
// The arrangement is the experiment:
//
//   ROOM, two notes on Chords — under the ceiling, nothing ducks.
//   GATHER, three — the ceiling is exactly here. This is where it starts.
//   WEIGHT, six and seven — audibly ducked, and everything else on that track
//     ducks with it, which is the sound being described.
//   AIR, back to two — the level comes back up, and the contrast is the proof.
//   WEIGHT II repeats it so it is not a one-off, and SETTLE lands.
//
// The same eight bars played thin and thick, so the difference is the only
// variable. If a future change fixes this, AIR and WEIGHT stop differing in
// level and the song stops being a test — which is the point.
//
// ⚠️ It is also a REGRESSION FIXTURE for everything that changed this week: it
// loads through the ordinary project path, uses ordinary Apollo instruments,
// and nothing in it depends on the sound library being installed. If an
// existing project broke, this one breaks the same way.
//
// 40 bars at 96 — a hundred seconds. A minor.

import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { uid, rng, feel, N, eq3, reverb, compressor, assemble, assertInRange } from './song-kit.mjs'
import { kick, hatDual, subBass, bass, warmEp, pad, strings } from './apollo-voices.mjs'

const BPM = 96
const BPB = 4
const OUT_DIR = join(homedir(), 'Desktop', '100lights-songs')
mkdirSync(OUT_DIR, { recursive: true })

const rand = rng(20260831)
const F = feel(rand, BPM)

// A minor, i–VI–III–VII. Four bars, and every section uses the same four, so
// harmony is never the thing that changed between two sections.
const ROOTS = [45, 41, 36, 43]                          // A2, F2, C2, G2

// Voicings of the SAME four chords at five densities. This is the instrument
// under test: the only difference between Room and Weight is how many of these
// notes are held at once.
const VOICINGS = {
  two:   [[57, 64], [53, 60], [55, 64], [50, 59]],
  three: [[57, 60, 64], [53, 57, 60], [55, 60, 64], [50, 55, 59]],
  four:  [[57, 60, 64, 69], [53, 57, 60, 65], [55, 60, 64, 67], [50, 55, 59, 62]],
  six:   [[45, 52, 57, 60, 64, 69], [41, 48, 53, 57, 60, 65],
          [43, 50, 55, 60, 64, 67], [38, 45, 50, 55, 59, 62]],
  seven: [[45, 52, 57, 60, 64, 69, 72], [41, 48, 53, 57, 60, 65, 69],
          [43, 50, 55, 60, 64, 67, 72], [38, 45, 50, 55, 59, 62, 67]],
}

/** Held chords, one per bar, at a named density. */
function chords(bars, density, vel = 78) {
  const out = []
  for (let b = 0; b < bars; b++) {
    // Slightly shorter than the bar so the release does not pile the next chord
    // on top of this one — the stealing case is a separate test from the
    // limiter one, and mixing them would make neither readable.
    for (const p of VOICINGS[density][b % 4]) out.push(N(p, b * BPB, BPB * 0.9, F.vary(vel, 3)))
  }
  return out
}

/** The low anchor — one note a bar, so the Sub track is never the dense one. */
function subLine(bars, vel = 88) {
  const out = []
  for (let b = 0; b < bars; b++) out.push(N(ROOTS[b % 4] - 12, b * BPB, BPB * 0.95, F.vary(vel, 3)))
  return out
}

function bassLine(bars, { walking = false } = {}) {
  const out = []
  for (let b = 0; b < bars; b++) {
    const r = ROOTS[b % 4]
    out.push(N(r, b * BPB, 1.6, F.vary(84, 4)))
    out.push(N(r, b * BPB + 2, 1.2, F.vary(72, 4)))
    if (walking) out.push(N(r + 7, b * BPB + 3, 0.8, F.vary(66, 4)))
  }
  return out
}

function kickLine(bars, { half = false } = {}) {
  const out = []
  for (let b = 0; b < bars; b++) {
    out.push(N(36, b * BPB, 0.5, F.vary(104, 3)))
    if (!half) out.push(N(36, b * BPB + 2, 0.5, F.vary(96, 3)))
  }
  return out
}

function hatLine(bars, { eighths = true } = {}) {
  const out = []
  const step = eighths ? 0.5 : 1
  for (let b = 0; b < bars; b++) {
    for (let t = 0; t < BPB; t += step) {
      out.push(N(42, b * BPB + t + F.jitter(6), step * 0.6, F.vary(t % 1 === 0 ? 62 : 46, 6)))
    }
  }
  return out
}

/** A quiet counter-line, so the ducking has something to duck. Not a lead. */
function strung(bars, vel = 56) {
  const out = []
  for (let b = 0; b < bars; b++) {
    const [a, c] = VOICINGS.two[b % 4]
    out.push(N(a + 12, b * BPB + 1, 2.4, F.vary(vel, 4)))
    out.push(N(c + 12, b * BPB + 2.5, 1.4, F.vary(vel - 8, 4)))
  }
  return out
}

export function build() {
  const tracks = [
    { key: 'kick',  id: uid(), name: 'Kick',  presetId: null, volume: 0.52, color: '#f9a8d4',
      instrument: { type: 'apollo', params: kick() } },
    { key: 'hats',  id: uid(), name: 'Hats',  presetId: null, volume: 0.16, pan: 0.18, color: '#fbcfe8',
      instrument: { type: 'apollo', params: hatDual() } },
    { key: 'sub',   id: uid(), name: 'Sub',   presetId: null, volume: 0.46, color: '#a5b4fc',
      instrument: { type: 'apollo', params: subBass() } },
    { key: 'bass',  id: uid(), name: 'Bass',  presetId: null, volume: 0.34, color: '#818cf8',
      instrument: { type: 'apollo', params: bass() },
      effects: [compressor(-18, 3, 1.5)] },
    // ⚠️ THE TRACK UNDER TEST. Everything else is arranged around it so that
    // when it ducks, you can hear it duck against something steady.
    { key: 'chords', id: uid(), name: 'Chords', presetId: null, volume: 0.30, pan: -0.10, color: '#c4b5fd',
      instrument: { type: 'apollo', params: warmEp() },
      effects: [eq3(0, 0.5, 1.0), reverb(0.20, 1.6)] },
    { key: 'pad',   id: uid(), name: 'Pad',   presetId: null, volume: 0.15, pan: 0.12, color: '#ddd6fe',
      instrument: { type: 'apollo', params: pad() } },
    { key: 'strings', id: uid(), name: 'Strings', presetId: null, volume: 0.18, pan: 0.20, color: '#e9d5ff',
      instrument: { type: 'apollo', params: strings() },
      effects: [reverb(0.28, 2.2)] },
  ]

  const sections = [
    // 1. ROOM — two notes on Chords. Below the ceiling; nothing is ducking.
    { name: 'Room', bars: 8, parts: {
        hats: hatLine(8, { eighths: false }),
        sub: subLine(8, 82),
        chords: chords(8, 'two', 74),
      } },
    // 2. GATHER — three notes. The ceiling is exactly here.
    { name: 'Gather', bars: 8, parts: {
        kick: kickLine(8, { half: true }),
        hats: hatLine(8),
        sub: subLine(8),
        bass: bassLine(8),
        chords: chords(8, 'three', 76),
        strings: strung(8, 48),
      } },
    // 3. WEIGHT — six notes. Roughly 2.3 times the ceiling, so about 7 dB of
    //    gain reduction on this track, pumping back over 120 ms after each hit.
    { name: 'Weight', bars: 8, parts: {
        kick: kickLine(8),
        hats: hatLine(8),
        sub: subLine(8, 92),
        bass: bassLine(8, { walking: true }),
        chords: chords(8, 'six', 80),
        pad: chords(8, 'three', 52),
        strings: strung(8, 56),
      } },
    // 4. AIR — back to two. The level comes back, and THAT is the measurement.
    { name: 'Air', bars: 4, parts: {
        hats: hatLine(4, { eighths: false }),
        sub: subLine(4, 78),
        chords: chords(4, 'two', 74),
        strings: strung(4, 44),
      } },
    // 5. WEIGHT II — seven notes, so it is not a one-off and it is worse.
    { name: 'Weight II', bars: 8, parts: {
        kick: kickLine(8),
        hats: hatLine(8),
        sub: subLine(8, 92),
        bass: bassLine(8, { walking: true }),
        chords: chords(8, 'seven', 82),
        pad: chords(8, 'four', 54),
        strings: strung(8, 58),
      } },
    // 6. SETTLE — lands on the thin voicing, which should be the loudest the
    //    Chords track sounds all song. If it is not, the limiter is why.
    { name: 'Settle', bars: 4, parts: {
        sub: subLine(4, 74),
        chords: chords(4, 'two', 72),
        pad: chords(4, 'two', 46),
      } },
  ]

  for (const sec of sections) {
    for (const [key, notes] of Object.entries(sec.parts)) {
      if (key === 'kick' || key === 'hats') continue
      assertInRange(`${sec.name}/${key}`, notes, 24, 96)
    }
  }
  return assemble({ name: 'Headroom', bpm: BPM, bpb: BPB, key: 'A', scale: 'minor', tracks, sections, masterVolume: 0.80 })
}

/**
 * `node scripts/song-headroom.mjs --measure`
 *
 * Renders this song's own Chords instrument at each density the arrangement
 * uses and prints what the limiter had to remove. A fixture that asserts a
 * number in a comment goes stale the first time the engine is touched; one that
 * measures it does not.
 */
async function measure() {
  const { render } = await import('./apollo-kit.mjs')
  const { warmEp } = await import('./apollo-voices.mjs')
  const patch = warmEp()
  console.log('section       notes  peak     rmsDb   limiter')
  let perNote = null
  for (const [name, density] of [['Room', 'two'], ['Gather', 'three'], ['Weight', 'six'], ['Weight II', 'seven']]) {
    const notes = VOICINGS[density][0]
    const r = render(patch, { notes: notes.map(p => `${p}:0:2`).join(','), seconds: 2.5 })
    perNote ??= r.peak / notes.length
    const gr = 20 * Math.log10(Math.min(1, r.peak / (perNote * notes.length)))
    console.log(name.padEnd(13), String(notes.length).padStart(4), String(r.peak).padStart(8),
      String(r.rmsDb).padStart(8), `${gr.toFixed(1)} dB`.padStart(9))
  }
}

if (process.argv.includes('--measure')) { await measure(); process.exit(0) }

const { project, songBeats, seconds, sectionAt } = build()
const out = join(OUT_DIR, 'Headroom.cfproj')
writeFileSync(out, JSON.stringify(project, null, 2))
const clips = project.dawProject.arrangementClips
console.log(`Headroom → ${out}`)
console.log(`  ${project.dawProject.tracks.length} tracks, ${clips.length} clips, ${songBeats} beats, ${seconds.toFixed(1)}s`)
console.log(`  sections: ${Object.entries(sectionAt).map(([n, b]) => `${n}@bar${b / BPB + 1}`).join('  ')}`)
const chordClips = clips.filter(c => c.name.startsWith('Chords'))
console.log(`  Chords density by section: ${chordClips.map(c => `${c.name.split(' · ')[1]}=${c.notes.length / (c.durationBeats / BPB)}`).join('  ')}`)
