// One library sample, played across the keys.
//
// Brae: "let's make it so that there's a samples tab when the user clicks on
// presets in the piano roll. This should help the AI also come up with better
// songs."
//
// A preset has always been a FOLDER of per-note samples ("Violin – All
// Notes"), and a single sample in the library — a kick, a recorded vocal, a
// catalog pluck — had no way onto a piano-roll clip except by baking forty-nine
// pitched copies of it into a folder first. A sample preset skips the folder:
// it names the sample and its root note, and the engine pitches the one
// recording to whatever key is played (lib/daw-engine.ts, _loadPresetBuffer).
// Nothing is copied, so the library stays the library and the preset travels
// with the project as a name and a root.
//
// The AI sees these through the same library list every other preset is in,
// so "make the bass the 808 kick" and "write a pad part with the vocal chop"
// are sentences now — see the `sample:` ids in VoiceControl's library.

import type { LibraryEntry } from './sound-library'
import type { MidiPreset } from './midi-presets'
import { noteNameToMidi, midiToNoteName } from './scale-constants'

/** A library id, as the voice rules and planner carry it — resolved by the studio. */
export const SAMPLE_ID_PREFIX = 'sample:'

/** How far a single sample is asked to stretch either side of its root. Two
 *  octaves down starts to sound like a slowed tape; two up like a chipmunk —
 *  both are sometimes the point, and the range is only a suggestion to the
 *  picker, never a wall. */
export const SAMPLE_SPAN = 24

const NOTE_IN_TEXT = /(?:^|[\s_\-(])([A-G](?:#|b)?)(-?\d)(?=$|[\s_\-)])/i

/**
 * The root the sample was recorded at, as far as the library can say.
 *
 * A per-note instrument entry says it outright (renderSpec.midiNote). A name
 * or tag with a note in it ("Pluck C4", tag "F#3") says it too. A musical key
 * with no octave ("F#") is put in the third octave — the register most
 * one-shots and chops sit in. Otherwise middle C, which is what every sampler
 * assumes.
 */
export function guessRootNote(entry: Pick<LibraryEntry, 'name' | 'tags' | 'key' | 'renderSpec' | 'category'>): number {
  const spec = entry.renderSpec?.midiNote
  if (typeof spec === 'number' && spec >= 0 && spec <= 127) return spec
  for (const t of entry.tags ?? []) {
    const m = noteNameToMidi(t.trim())
    if (m != null) return m
  }
  const inName = NOTE_IN_TEXT.exec(entry.name ?? '')
  if (inName) {
    const m = noteNameToMidi(`${inName[1].toUpperCase()}${inName[2]}`)
    if (m != null) return m
  }
  if (entry.key) {
    const m = noteNameToMidi(`${entry.key.trim()}3`)
    if (m != null) return m
  }
  return 60
}

/** True when this entry is a sound in its own right — not one note of an
 *  instrument folder, which is already a preset. */
export function isPickableSample(entry: Pick<LibraryEntry, 'id' | 'name' | 'folder' | 'audioBlob' | 'catalogUrl' | 'communityRef' | 'renderSpec' | 'tags'>): boolean {
  const hasAudio = !!(entry.audioBlob || entry.catalogUrl || entry.communityRef || entry.renderSpec)
  if (!hasAudio) return false
  if (entry.tags?.includes('apollo-image-spectral')) return false
  if (/–\s*All Notes$/i.test(entry.folder ?? '')) return false
  if (entry.renderSpec?.kind === 'soundfont') return false
  // A bare note name ("C4", "F#3") is one note of something, not a sound.
  if (/^[A-G](#|b)?-?\d$/i.test((entry.name ?? '').trim())) return false
  return true
}

/** What the preset is called: the sample's own name, or the folder when the
 *  name is a bare note. */
export function samplePresetName(entry: Pick<LibraryEntry, 'name' | 'folder'>): string {
  const n = (entry.name ?? '').trim()
  return n || (entry.folder ?? 'Sample')
}

/**
 * The preset for a sample — pure, no audio touched. `addPreset` stores it and
 * `ADD_PRESET` embeds it in the project; see the piano roll's Samples tab.
 */
export function samplePresetFor(
  entry: Pick<LibraryEntry, 'id' | 'name' | 'folder' | 'tags' | 'key' | 'renderSpec' | 'category'>,
  opts: { rootNote?: number; loNote?: number; hiNote?: number; name?: string } = {},
): Omit<MidiPreset, 'id' | 'builtIn' | 'createdAt'> {
  const rootNote = Math.max(0, Math.min(127, Math.round(opts.rootNote ?? guessRootNote(entry))))
  const loNote = Math.max(0, Math.min(127, Math.round(opts.loNote ?? rootNote - SAMPLE_SPAN)))
  const hiNote = Math.max(loNote, Math.min(127, Math.round(opts.hiNote ?? rootNote + SAMPLE_SPAN)))
  return {
    // The SOUND's name when the row stood for several notes of it — "Arp",
    // not "Arp C4" — so the preset reads like an instrument.
    name: opts.name?.trim() || samplePresetName(entry),
    // The folder is a label here, never looked up: a sample preset resolves
    // through sampleId. It is the library folder so the preset picker groups it
    // with where it came from.
    folder: entry.folder ?? 'Samples',
    loNote, hiNote,
    category: (entry.category as string) || 'custom',
    group: 'Samples',
    sampleId: entry.id,
    rootNote,
    tags: entry.tags?.filter(t => noteNameToMidi(t.trim()) == null),
  }
}

/** "C4" for a root, for labels. */
export function rootLabel(midi: number): string { return midiToNoteName(midi) }

/** A sound as the Samples tab lists it: one row, however many notes of it the
 *  library holds. `entry` is the note nearest middle C — the one "Use" takes. */
export interface PickableSound<T> { entry: T; name: string; notes: number }

const TRAILING_NOTE = /\s+[A-G](?:#|b)?-?\d$/i

/**
 * One row per sound.
 *
 * Brae: "some are repeats but as different base notes. That should be
 * changed." The seeded synth sounds arrive as one entry per note — "Arp A3",
 * "Arp C4", "Arp E4" — and the picker showed every one. They are one sound
 * at several pitches, and the engine re-renders a seeded sound at whatever
 * pitch is played anyway, so the row is the sound and its notes are a count.
 * Grouped by folder and the name with its note taken off; the representative
 * is the note nearest middle C.
 */
export function collapseNoteVariants<T extends Pick<LibraryEntry, 'id' | 'name' | 'folder' | 'renderSpec' | 'tags' | 'key' | 'category'>>(entries: T[]): PickableSound<T>[] {
  const groups = new Map<string, T[]>()
  for (const e of entries) {
    const base = (e.name ?? '').replace(TRAILING_NOTE, '').trim() || e.name
    const key = `${e.folder ?? ''}|${base.toLowerCase()}`
    const g = groups.get(key) ?? []
    g.push(e)
    groups.set(key, g)
  }
  const out: PickableSound<T>[] = []
  for (const g of groups.values()) {
    const base = (g[0].name ?? '').replace(TRAILING_NOTE, '').trim() || g[0].name
    const rep = g.length === 1 ? g[0] : g.reduce((best, e) => Math.abs(guessRootNote(e) - 60) < Math.abs(guessRootNote(best) - 60) ? e : best, g[0])
    out.push({ entry: rep, name: g.length > 1 ? base : g[0].name, notes: g.length })
  }
  return out
}

/** Is this the id form the voice path carries for a library sample? */
export function isSampleRef(id: string | undefined | null): id is string {
  return typeof id === 'string' && id.startsWith(SAMPLE_ID_PREFIX)
}
export function sampleRefId(ref: string): string { return ref.slice(SAMPLE_ID_PREFIX.length) }
