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
