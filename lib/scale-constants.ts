// The one place pitch is defined: scale intervals, note names, and the
// conversions between MIDI numbers, note names and frequencies.
//
// These had drifted into a dozen private copies — scale tables in ten files
// (including Apollo's patch.ts and a third copy inlined in the worklet), note
// name arrays in twelve, and 440 * 2^((n-69)/12) written out twenty-two times.
// Duplicated pitch maths is quietly dangerous: two modules that disagree about
// what F#3 means produce a bug nobody can hear until it is in a render.

export type ScaleType =
  | 'chromatic' | 'major' | 'minor' | 'pentatonic-major' | 'pentatonic-minor'
  | 'dorian' | 'phrygian' | 'lydian' | 'mixolydian' | 'locrian'
  | 'harmonic-minor' | 'melodic-minor' | 'blues' | 'whole-tone' | 'diminished'

export const SCALE_INTERVALS: Record<ScaleType, number[]> = {
  'chromatic':        [0,1,2,3,4,5,6,7,8,9,10,11],
  'major':            [0,2,4,5,7,9,11],
  'minor':            [0,2,3,5,7,8,10],
  'pentatonic-major': [0,2,4,7,9],
  'pentatonic-minor': [0,3,5,7,10],
  'dorian':           [0,2,3,5,7,9,10],
  'phrygian':         [0,1,3,5,7,8,10],
  'lydian':           [0,2,4,6,7,9,11],
  'mixolydian':       [0,2,4,5,7,9,10],
  'locrian':          [0,1,3,5,6,8,10],
  'harmonic-minor':   [0,2,3,5,7,8,11],
  'melodic-minor':    [0,2,3,5,7,9,11],
  'blues':            [0,3,5,6,7,10],
  'whole-tone':       [0,2,4,6,8,10],
  'diminished':       [0,2,3,5,6,8,9,11],
}

export const SCALE_LABELS: Record<ScaleType, string> = {
  'chromatic':        'Chromatic',
  'major':            'Major',
  'minor':            'Minor (Natural)',
  'pentatonic-major': 'Pentatonic Major',
  'pentatonic-minor': 'Pentatonic Minor',
  'dorian':           'Dorian',
  'phrygian':         'Phrygian',
  'lydian':           'Lydian',
  'mixolydian':       'Mixolydian',
  'locrian':          'Locrian',
  'harmonic-minor':   'Harmonic Minor',
  'melodic-minor':    'Melodic Minor',
  'blues':            'Blues',
  'whole-tone':       'Whole Tone',
  'diminished':       'Diminished',
}

export const ROOT_NOTES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'] as const
export type RootNote = typeof ROOT_NOTES[number]

export function isNoteInScale(midiNote: number, root: RootNote, scale: ScaleType): boolean {
  if (scale === 'chromatic') return true
  const rootIdx = ROOT_NOTES.indexOf(root)
  const semitone = ((midiNote - rootIdx) % 12 + 12) % 12
  return SCALE_INTERVALS[scale].includes(semitone)
}

export function snapToScale(midiNote: number, root: RootNote, scale: ScaleType): number {
  if (isNoteInScale(midiNote, root, scale)) return midiNote
  for (let d = 1; d <= 6; d++) {
    if (isNoteInScale(midiNote - d, root, scale)) return midiNote - d
    if (isNoteInScale(midiNote + d, root, scale)) return midiNote + d
  }
  return midiNote
}

// ── Naming and frequency ─────────────────────────────────────────────────────
// Beside the scales because it is the same domain, duplicated by the same
// modules.

/** Concert-A reference. Change here, not in a call site. */
export const A4_HZ = 440
export const A4_MIDI = 69

/** MIDI note -> frequency in Hz. */
export function midiToFreq(midi: number, a4 = A4_HZ): number {
  return a4 * Math.pow(2, (midi - A4_MIDI) / 12)
}

/** Frequency in Hz -> (fractional) MIDI note. */
export function freqToMidi(hz: number, a4 = A4_HZ): number {
  return A4_MIDI + 12 * Math.log2(Math.max(1e-9, hz) / a4)
}

/**
 * MIDI note -> name with octave, e.g. 54 -> "F#3".
 *
 * Octave numbering is the one the sound library and the engine already use
 * (C4 = 60). Two conventions in one codebase would mean samples named an
 * octave away from the note that plays them.
 */
export function midiToNoteName(midi: number): string {
  return ROOT_NOTES[((midi % 12) + 12) % 12] + String(Math.floor(midi / 12) - 1)
}

/** "F#3" -> 54, or null when it is not a note name. The exact inverse of
 *  midiToNoteName, so a round trip is lossless. Flats are accepted on input. */
export function noteNameToMidi(name: string): number | null {
  const m = /^([A-Ga-g])(#|b)?(-?\d+)$/.exec(name.trim())
  if (!m) return null
  const natural = (ROOT_NOTES as readonly string[]).indexOf(m[1].toUpperCase())
  if (natural < 0) return null
  let idx = natural
  if (m[2] === '#') idx = (natural + 1) % 12
  else if (m[2] === 'b') idx = (natural + 11) % 12
  return idx + (Number(m[3]) + 1) * 12
}

/** Playback-rate ratio for retuning a sample by a number of semitones. */
export function semitoneRatio(semitones: number): number {
  return Math.pow(2, semitones / 12)
}
