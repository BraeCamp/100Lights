// Turn a recipe's raw notes into named chords for the article piano viewer.
// Recipes carry exact MIDI note data, so this is precise — no audio analysis.

export interface Chord {
  name: string           // "C", "Am", "G7", "Fmaj7"…
  pitches: number[]      // MIDI note numbers, low→high
  beat: number           // onset in beats
  dur: number            // duration in beats
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

// Interval-set (from root, sorted) → chord-quality suffix. Longer matches win.
const QUALITIES: Array<[number[], string]> = [
  [[0, 4, 7, 11], 'maj7'],
  [[0, 3, 7, 10], 'm7'],
  [[0, 4, 7, 10], '7'],
  [[0, 3, 6, 10], 'm7♭5'],
  [[0, 4, 7, 9], '6'],
  [[0, 4, 8], 'aug'],
  [[0, 3, 6], 'dim'],
  [[0, 4, 7], ''],       // major
  [[0, 3, 7], 'm'],      // minor
  [[0, 5, 7], 'sus4'],
  [[0, 2, 7], 'sus2'],
]

function eq(a: number[], b: number[]) { return a.length === b.length && a.every((x, i) => x === b[i]) }

/** Best chord name for a set of MIDI pitches. Prefers the lowest note as root. */
export function nameChord(pitches: number[]): string {
  const pcs = [...new Set(pitches.map(p => ((p % 12) + 12) % 12))]
  if (pcs.length === 0) return ''
  if (pcs.length === 1) return NOTE_NAMES[pcs[0]]
  const bassPc = ((Math.min(...pitches) % 12) + 12) % 12
  // Try every pitch class as root; score = quality match, tie-break to bass root
  let best: { root: number; suffix: string; score: number } | null = null
  for (const root of pcs) {
    const intervals = [...new Set(pcs.map(pc => (pc - root + 12) % 12))].sort((a, b) => a - b)
    for (const [tpl, suffix] of QUALITIES) {
      if (eq(intervals, tpl)) {
        const score = tpl.length * 10 + (root === bassPc ? 5 : 0)
        if (!best || score > best.score) best = { root, suffix, score }
      }
    }
  }
  if (best) {
    const slash = ((Math.min(...pitches) % 12) + 12) % 12 !== best.root ? `/${NOTE_NAMES[bassPc]}` : ''
    return NOTE_NAMES[best.root] + best.suffix + slash
  }
  // No template matched — name by bass
  return NOTE_NAMES[bassPc]
}

/** Group notes sharing an onset into chords, in time order. */
export function groupIntoChords(notes: Array<{ pitch: number; startBeat: number; durationBeats: number }>): Chord[] {
  const sorted = [...notes].sort((a, b) => a.startBeat - b.startBeat || a.pitch - b.pitch)
  const chords: Chord[] = []
  for (const n of sorted) {
    const last = chords[chords.length - 1]
    if (last && Math.abs(n.startBeat - last.beat) < 0.25) {
      last.pitches.push(n.pitch)
      last.dur = Math.max(last.dur, n.durationBeats)
    } else {
      chords.push({ name: '', pitches: [n.pitch], beat: n.startBeat, dur: n.durationBeats })
    }
  }
  for (const c of chords) {
    c.pitches.sort((a, b) => a - b)
    c.name = nameChord(c.pitches)
  }
  return chords
}

export const KEY_NAMES = NOTE_NAMES

/** Transpose a chord list by a number of semitones (for changing key). */
export function transposeChords(chords: Chord[], semitones: number): Chord[] {
  if (semitones === 0) return chords
  return chords.map(c => {
    const pitches = c.pitches.map(p => p + semitones)
    return { ...c, pitches, name: nameChord(pitches) }
  })
}
