// Real recorded sound, addressable by a string that needs no seeding.
//
// Apollo can play samples — `osc.engine = 'sample'` / `'multisample'` — and that
// is how a drum sounds like a drum instead of like a filtered saw. What was
// missing was a way for a sample to travel INSIDE a project: the patch holds a
// `sampleId`, and the studio resolves it through the Sound Library, which means
// a library entry has to exist first. A project referencing one on a fresh
// machine finds nothing and plays silence.
//
// So ids that describe where the sound comes from, and can be resolved from the
// id alone on both sides:
//
//   builtin:/drum-kits/studio/36.wav     a public asset — fetched in the app,
//                                        read straight off disk here
//   builtin:ai/grand-piano/C3            one root of an AI multisample
//                                        instrument (base64 mp3 inside the JS)
//
// Nothing is stored in the project but the string, so a .cfproj stays small and
// works anywhere. lib/default-samples.ts fulfils the same ids in the browser.

import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const PUBLIC = join(REPO, 'public')
const CACHE = join(tmpdir(), '100lights-sample-cache')

export const PREFIX = 'builtin:'

// Measured pitches, built by scripts/build-ai-tuning.mjs. Absent on a fresh
// checkout until that has run — the names are used until then, which is what
// the mislabelling makes wrong, so the check reports it loudly.
let TUNING = null
try { TUNING = JSON.parse(readFileSync(join(REPO, 'scripts/ai-instrument-tuning.json'), 'utf8')) }
catch { TUNING = null }

/** GM pad numbers every generated kit provides. */
export const DRUM_PADS = {
  kick: 36, snare: 38, clap: 39, lowTom: 41, hat: 42,
  midTom: 45, openHat: 46, highTom: 48, crash: 49, rim: 51,
}
export const DRUM_KITS = ['studio', 'boombap', 'house', 'lofi', 'pop', 'rock', 'techno', 'trap808']
export const AI_INSTRUMENTS = ['grand-piano', 'electric-guitar', 'electric-bass', 'fretless-bass', 'synth-bass']

/** `builtin:/drum-kits/<kit>/<pad>.wav` — one drum one-shot. */
export function drumId(kit, pad) {
  if (!DRUM_KITS.includes(kit)) throw new Error(`unknown drum kit "${kit}" — have: ${DRUM_KITS.join(', ')}`)
  const n = typeof pad === 'string' ? DRUM_PADS[pad] : pad
  if (n == null) throw new Error(`unknown drum pad "${pad}" — have: ${Object.keys(DRUM_PADS).join(', ')}`)
  return `${PREFIX}/drum-kits/${kit}/${n}.wav`
}

/** `builtin:ai/<instrument>/<note>` — one root of a multisample instrument. */
export function aiId(instrument, note) {
  if (!AI_INSTRUMENTS.includes(instrument)) throw new Error(`unknown AI instrument "${instrument}" — have: ${AI_INSTRUMENTS.join(', ')}`)
  return `${PREFIX}ai/${instrument}/${note}`
}

const NOTE_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }
/** "C#3" → MIDI. The AI files use scientific pitch with C4 = 60. */
export function noteToMidi(name) {
  const m = /^([A-G])(#|b)?(-?\d+)$/.exec(name.trim())
  if (!m) throw new Error(`unparseable note name: ${name}`)
  return (Number(m[3]) + 1) * 12 + NOTE_PC[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0)
}

let _aiCache = new Map()
/** The roots exactly as the file declares them — names trusted, nothing measured. */
export function aiRootsRaw(instrument) {
  const file = join(PUBLIC, 'ai-instruments', `${instrument}.js`)
  if (!existsSync(file)) throw new Error(`AI instrument not on disk: ${file}`)
  const src = readFileSync(file, 'utf8')
  const roots = []
  for (const m of src.matchAll(/"([A-G]#?-?\d+)"\s*:\s*"data:audio\/[a-z0-9]+;base64,([^"]+)"/g)) {
    roots.push({ note: m[1], midi: noteToMidi(m[1]), b64: m[2], id: aiId(instrument, m[1]) })
  }
  if (!roots.length) throw new Error(`no roots found in ${file}`)
  roots.sort((a, b) => a.midi - b.midi)
  return roots
}

/**
 * The roots an AI instrument provides, anchored to the pitch each one ACTUALLY
 * sounds rather than the note name it carries.
 *
 * Several names are wrong by an octave or more (grand-piano's "G2" sounds at
 * MIDI 64), and a zone map built on the names puts those samples at the wrong
 * root, so every note drawn from them plays at the wrong pitch. The measured
 * table is built by scripts/build-ai-tuning.mjs.
 *
 * Roots that land on the same pitch after correction are deduplicated — the
 * longest recording wins, because the short ones are the ones that run out
 * mid-note.
 */
export function aiRoots(instrument) {
  if (_aiCache.has(instrument)) return _aiCache.get(instrument)
  const raw = aiRootsRaw(instrument)
  const tuned = TUNING?.[instrument]
  let roots = raw
  if (tuned?.length) {
    const byNote = new Map(tuned.map(t => [t.note, t]))
    const kept = new Map()
    for (const r of raw) {
      const t = byNote.get(r.note)
      if (!t) continue                       // measured as silent/unmeasurable
      // Anchor on the FRACTIONAL measured pitch, not the rounded one. A root
      // that sounds 0.32 semitones flat and is filed as an integer plays every
      // note drawn from it 32 cents flat — audible against a bass, and invisible
      // to any check that only looks at whole notes.
      const slot = t.rootKey
      const prev = kept.get(slot)
      if (!prev || t.durSec > prev.durSec) kept.set(slot, { ...r, midi: t.sounds, slot, durSec: t.durSec })
    }
    roots = [...kept.values()]
  }
  roots.sort((a, b) => a.midi - b.midi)
  _aiCache.set(instrument, roots)
  return roots
}

/**
 * A `builtin:` id → a WAV on disk that apollo-render can load.
 *
 * AI roots are base64 mp3 inside a JS file, so they are decoded once into a
 * cache directory. Decoding is done by ffmpeg rather than in-process because
 * Node has no mp3 decoder and a wrong one here would be inaudible until it
 * reached a mix.
 */
export function resolveSample(id) {
  if (!id?.startsWith(PREFIX)) return null
  const rest = id.slice(PREFIX.length)

  if (rest.startsWith('/')) {
    const p = join(PUBLIC, rest.replace(/^\//, ''))
    if (!existsSync(p)) throw new Error(`sample "${id}" is not on disk (looked in ${p})`)
    return p
  }

  const m = /^ai\/([^/]+)\/(.+)$/.exec(rest)
  if (!m) throw new Error(`unrecognised builtin sample id: ${id}`)
  const [, instrument, note] = m
  mkdirSync(CACHE, { recursive: true })
  const out = join(CACHE, `${instrument}-${note.replace('#', 's')}.wav`)
  if (existsSync(out)) return out
  // The RAW list: this only needs the note's audio, and the tuned list drops
  // duplicates, so asking it here would fail to resolve a root that exists.
  const root = aiRootsRaw(instrument).find(r => r.note === note)
  if (!root) {
    const have = aiRootsRaw(instrument).map(r => r.note).join(' ')
    throw new Error(`"${instrument}" has no root ${note} — it has: ${have}`)
  }
  const mp3 = join(CACHE, `${instrument}-${note.replace('#', 's')}.mp3`)
  writeFileSync(mp3, Buffer.from(root.b64, 'base64'))
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', mp3, '-ac', '2', '-ar', '48000', out])
  return out
}

/** Every `builtin:` sample a patch references, in the order Apollo will need. */
export function patchSampleIds(patch) {
  const ids = new Set()
  for (const o of patch?.oscs ?? []) {
    for (const id of [o.smp?.sampleId, o.gran?.sampleId, o.spec?.sampleId]) {
      if (id?.startsWith(PREFIX)) ids.add(id)
    }
    for (const z of o.ms?.zones ?? []) if (z.sampleId?.startsWith(PREFIX)) ids.add(z.sampleId)
  }
  return [...ids]
}
