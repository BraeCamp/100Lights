// Turning a folder of samples into a playable instrument.
//
// Apollo's "From Instrument…" takes every sample in one Sound Library folder
// and lays them across the keyboard as key zones. Three questions decide
// whether the result plays like an instrument or like a pile of files:
//
//   1. What pitch is this sample?  → noteOf()
//   2. Which take do we keep when a pitch was sampled more than once? → bestTakes()
//   3. How far does each zone reach? → spanZones()
//
// It lives here rather than in the panel because all three are pure, all three
// are easy to get subtly wrong, and none of them are observable from a
// screenshot — a zone map that is off by one semitone still renders a tidy
// table, and only sounds wrong.

/** The part of a library entry that pitch detection actually reads. */
export interface SampleLike {
  name: string
  tags?: string[]
  renderSpec?: { midiNote?: number }
}

const SEMIS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

/** "A#3" → 58. Exact match only: this is a note name, not a name containing one. */
export function midiFromNoteName(name: string): number | null {
  const m = name.trim().match(/^([A-Ga-g])(#|b)?(-?\d+)$/)
  if (!m) return null
  let semis = SEMIS.indexOf(m[1].toUpperCase())
  if (semis < 0) return null
  if (m[2] === '#') semis += 1
  if (m[2] === 'b') semis -= 1
  // C-1 is MIDI 0, so the octave is offset by one. Flats and sharps are
  // allowed to fall off either end of their octave (Cb3, B#3) and wrap.
  return (Number(m[3]) + 1) * 12 + semis
}

/**
 * The pitch of a sample, in the order the sources can be trusted.
 *
 * Catalog instruments carry `note:A#3`, written at import from the sample's
 * own filename — exact, and the reason the importer bothers to keep it.
 * Falling back to the display name is only safe because the match is anchored:
 * an entry called "Grand Piano, Steinway B A#3" deliberately does NOT match. A
 * matcher loose enough to find the pitch inside that name is also loose enough
 * to invent one for "Tom 2" or "Harmonica-Special20-C".
 */
export function noteOf(e: SampleLike): number | null {
  if (typeof e.renderSpec?.midiNote === 'number') return e.renderSpec.midiNote
  const tag = e.tags?.find(t => t.startsWith('note:'))
  if (tag) {
    const n = midiFromNoteName(tag.slice('note:'.length))
    if (n != null) return n
  }
  return midiFromNoteName(e.name)
}

/** The velocity layer a sample was recorded at, if it says. 1 is softest. */
export function velLayer(e: SampleLike): number | null {
  const t = e.tags?.find(x => x.startsWith('vl:'))
  const n = t ? Number(t.slice(3)) : NaN
  return Number.isFinite(n) ? n : null
}

/** Lower is better: first round robin, on the main mic. */
export function takeRank(e: SampleLike): number {
  const rr = Number(e.tags?.find(t => t.startsWith('rr:'))?.match(/\d+/)?.[0] ?? '1')
  return (e.tags?.includes('mic:main') ? 0 : 100) + rr
}

/**
 * The one take to keep out of every take of a single pitch.
 *
 * Velocity comes first, because it is the choice you can HEAR. A piano
 * sampled at three dynamics, reduced by picking whichever take sorted first,
 * plays pianissimo on C and fortissimo on C# — the instrument lurches between
 * dynamics as you move up the keyboard. Picking the same layer at every pitch
 * is what makes it sound like one instrument, and the middle layer is the one
 * that is usable both quiet and loud.
 */
function chooseTake<T extends SampleLike>(takes: T[]): T {
  const layers = [...new Set(takes.map(velLayer).filter((n): n is number => n != null))]
  if (layers.length > 1) {
    layers.sort((a, b) => a - b)
    const mid = layers[Math.floor((layers.length - 1) / 2)]
    takes = takes.filter(t => velLayer(t) === mid)
  }
  return takes.reduce((best, t) => (takeRank(t) < takeRank(best) ? t : best), takes[0])
}

/**
 * One sample per pitch, sorted low to high.
 *
 * A properly multisampled instrument holds several takes of each note — round
 * robins, mic positions, velocity layers. The VCSL Steinway is 351 files across
 * 88 pitches. Keeping them all builds 351 zones and downloads 1.3 GB to do it,
 * and most of those zones are dead: from the third take of a pitch onward the
 * midpoint split puts hiKey below loKey, so the zone covers no key at all and
 * its sample is fetched to never sound.
 */
export function bestTakes<T extends SampleLike>(items: T[]): { item: T; note: number }[] {
  const byNote = new Map<number, T[]>()
  for (const item of items) {
    const note = noteOf(item)
    if (note == null) continue
    if (!byNote.has(note)) byNote.set(note, [])
    byNote.get(note)!.push(item)
  }
  return [...byNote.entries()]
    .map(([note, takes]) => ({ item: chooseTake(takes), note }))
    .sort((a, b) => a.note - b.note)
}

/**
 * Stretch each sampled note out to meet its neighbours, so the whole keyboard
 * plays with no silent gaps between zones. The outermost zones run to the ends
 * of the range — a piano sampled from A0 should still answer at C-1.
 */
export function spanZones(notes: number[]): { loKey: number; hiKey: number; rootKey: number }[] {
  return notes.map((note, k) => {
    const prev = k > 0 ? notes[k - 1] : null
    const next = k < notes.length - 1 ? notes[k + 1] : null
    return {
      rootKey: note,
      loKey: prev == null ? 0 : Math.floor((prev + note) / 2) + 1,
      hiKey: next == null ? 127 : Math.floor((note + next) / 2),
    }
  })
}
