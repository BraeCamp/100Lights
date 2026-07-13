// ── Practice Room: recipe library ───────────────────────────────────────────
// A recipe is a small annotated musical construction the user loads into
// their real project and studies in the piano roll. Loading builds a fresh
// track + MIDI clip (ids generated at load time, so collab-safe — the full
// entities travel in ADD_TRACK/ADD_CLIP actions).

import type { MidiNote, MidiClip, TrackInstrument } from './daw-types'
import { defaultPresetId } from './midi-presets'

export interface PracticeRecipe {
  id: string
  title: string
  tagline: string
  /** Study notes shown after loading — the "annotation" on the project file. */
  annotation: string[]
  /** Builds the notes + instrument for a fresh clip at load time. */
  build: () => { trackName: string; instrument: TrackInstrument; isDrumClip: boolean; durationBeats: number; notes: Omit<MidiNote, 'id'>[]; usePreset: boolean }
}

const N = (pitch: number, startBeat: number, durationBeats: number, velocity = 100): Omit<MidiNote, 'id'> =>
  ({ pitch, startBeat, durationBeats, velocity })

// GM drum pitches (match DRUM_LANES in the piano roll)
const KICK = 36, SNARE = 38, CLOSED_HAT = 42, OPEN_HAT = 46

export const PRACTICE_RECIPES: PracticeRecipe[] = [
  {
    id: 'four-on-floor',
    title: 'Four on the floor',
    tagline: 'The heartbeat of house and disco — one bar of drums.',
    annotation: [
      'The kick lands on every beat: 1, 2, 3, 4. That relentless pulse is the genre.',
      'Closed hats sit exactly between the kicks (the "and" of each beat) — they create the bounce, not the kick.',
      'The snare backbeat on 2 and 4 is quieter than you think (velocity 90). Turn it up and hear it fight the kick.',
      'Try: move one hat off the grid slightly (hold ⌥ and drag) and feel the groove loosen.',
    ],
    build: () => ({
      trackName: 'Recipe: Four on the floor',
      instrument: { type: 'drum', params: { pack: 'synth' } },
      isDrumClip: true,
      durationBeats: 4,
      usePreset: false,
      notes: [
        N(KICK, 0, 0.25), N(KICK, 1, 0.25), N(KICK, 2, 0.25), N(KICK, 3, 0.25),
        N(CLOSED_HAT, 0.5, 0.25, 80), N(CLOSED_HAT, 1.5, 0.25, 80), N(CLOSED_HAT, 2.5, 0.25, 80),
        N(OPEN_HAT, 3.5, 0.25, 85),
        N(SNARE, 1, 0.25, 90), N(SNARE, 3, 0.25, 90),
      ],
    }),
  },
  {
    id: 'pop-progression',
    title: 'The pop progression (I–V–vi–IV)',
    tagline: 'C → G → Am → F: the four chords under a thousand hits.',
    annotation: [
      'Each chord holds a whole bar. I (C) feels like home, V (G) adds tension, vi (Am) turns it bittersweet, IV (F) lifts back toward home.',
      'The voicings share notes between neighbors (C and G share G; Am and F share A and C) — that overlap is why the changes feel smooth.',
      'Every chord keeps the same shape and register. Move one chord up an octave and hear the line jump instead of glide.',
      'Try: reorder to vi–IV–I–V (Am first) — same chords, completely different mood.',
    ],
    build: () => ({
      trackName: 'Recipe: Pop progression',
      instrument: { type: 'none', params: {} },
      isDrumClip: false,
      durationBeats: 16,
      usePreset: true,
      notes: [
        // C major: C4 E4 G4
        N(60, 0, 4), N(64, 0, 4), N(67, 0, 4),
        // G major: B3 D4 G4
        N(59, 4, 4), N(62, 4, 4), N(67, 4, 4),
        // A minor: A3 C4 E4
        N(57, 8, 4), N(60, 8, 4), N(64, 8, 4),
        // F major: A3 C4 F4
        N(57, 12, 4), N(60, 12, 4), N(65, 12, 4),
      ],
    }),
  },
  {
    id: 'walking-bass',
    title: 'Walking bass line',
    tagline: 'Quarter notes that stroll from chord to chord.',
    annotation: [
      'One note per beat, no gaps — the "walk" is the unbroken chain of quarter notes.',
      'Beat 1 of each bar states the chord root (C, then A, then F, then G). The notes between are passing tones aiming at the NEXT root.',
      'The last note of each bar is a half-step or whole-step from the next bar\'s first note — that lean is what pulls the line forward.',
      'Try: play it with the pop progression recipe on top; the bass roots match its chords.',
    ],
    build: () => ({
      trackName: 'Recipe: Walking bass',
      instrument: { type: 'none', params: {} },
      isDrumClip: false,
      durationBeats: 16,
      usePreset: true,
      notes: [
        // Bar 1 (C): C2 E2 G2 B2 → aiming at A
        N(36, 0, 1), N(40, 1, 1), N(43, 2, 1), N(47, 3, 1),
        // Bar 2 (Am): A2 C3 E3 G2 → whole step above F, leaning into it
        N(45, 4, 1), N(48, 5, 1), N(52, 6, 1), N(43, 7, 1),
        // Bar 3 (F): F2 A2 C3 F#2 → chromatic half-step into G
        N(41, 8, 1), N(45, 9, 1), N(48, 10, 1), N(42, 11, 1),
        // Bar 4 (G): G2 B2 D3 B2 → resolves back to C
        N(43, 12, 1), N(47, 13, 1), N(50, 14, 1), N(47, 15, 1),
      ],
    }),
  },
]

// ── Chord progressions (Sound Library → Recipes tab) ─────────────────────────
// Dropped onto a track they become normal MIDI clips: notes editable in the
// piano roll, sound switchable via the clip preset picker, and edge-resize
// STRETCHES the progression to the new length (stretchNotes) instead of
// looping — squeeze 16 beats into 12 for a 3/4 feel, or spread it out.

const chord = (startBeat: number, durationBeats: number, ...pitches: number[]): Omit<MidiNote, 'id'>[] =>
  pitches.map(p => N(p, startBeat, durationBeats))

const progression = (
  id: string, title: string, tagline: string, annotation: string[],
  durationBeats: number, notes: Omit<MidiNote, 'id'>[],
): PracticeRecipe => ({
  id, title, tagline, annotation,
  build: () => ({
    trackName: title, instrument: { type: 'none', params: {} },
    isDrumClip: false, durationBeats, usePreset: true, notes,
  }),
})

export const CHORD_RECIPES: PracticeRecipe[] = [
  PRACTICE_RECIPES.find(r => r.id === 'pop-progression')!,
  progression('canon', 'Pachelbel\u2019s Canon (I–V–vi–iii–IV–I–IV–V)', 'C → G → Am → Em → F → C → F → G: the eight-chord wheel behind centuries of songs.',
    ['Two four-chord halves: the first falls (I–V–vi–iii), the second climbs home (IV–I–IV–V).',
     'The bass walks down almost the whole scale: C B A G F E F G — that stepwise descent is the hook.',
     'Try: loop just the first half and it turns melancholy; the second half is what redeems it.'],
    32, [
      ...chord(0, 4, 60, 64, 67),    // C
      ...chord(4, 4, 59, 62, 67),    // G/B
      ...chord(8, 4, 57, 60, 64),    // Am
      ...chord(12, 4, 55, 59, 64),   // Em/G
      ...chord(16, 4, 53, 57, 60),   // F
      ...chord(20, 4, 52, 55, 60),   // C/E
      ...chord(24, 4, 53, 57, 60),   // F
      ...chord(28, 4, 55, 59, 62),   // G
    ]),
  progression('royal-road', 'The royal road (IV–V–iii–vi)', 'F → G → Em → Am: the J-pop chorus engine.',
    ['It never touches the home chord — starting on IV keeps it suspended and yearning the whole way.',
     'V resolving DOWN to iii (instead of home) is the signature move; vi finishes it bittersweet.',
     'Try: append the pop progression after it — royal road for the verse, I–V–vi–IV for the chorus.'],
    16, [
      ...chord(0, 4, 53, 57, 60),   // F
      ...chord(4, 4, 55, 59, 62),   // G
      ...chord(8, 4, 52, 55, 59),   // Em
      ...chord(12, 4, 57, 60, 64),  // Am
    ]),
  progression('minor-251', 'The minor ii–V–i', 'Dm7♭5 → G7 → Cm: the jazz cadence\u2019s shadow twin.',
    ['Same skeleton as the major ii–V–I, but the ♭5 in the first chord and the minor landing darken every step.',
     'The A♭ in Dm7♭5 and the B in G7 squeeze toward the same target from both sides — maximum pull.',
     'Try: play the major ii–V–I right after it and feel the clouds part.'],
    16, [
      ...chord(0, 4, 50, 53, 56, 60),   // Dm7♭5: D3 F3 A♭3 C4
      ...chord(4, 4, 47, 50, 53, 59),   // G7: B2 D3 F3 B3
      ...chord(8, 8, 48, 51, 55, 58),   // Cm7: C3 E♭3 G3 B♭3
    ]),
  progression('creep-move', 'The major-to-minor lift (I–III–IV–iv)', 'C → E → F → Fm: the borrowed-chord heartbreak.',
    ['III (E major, with the foreign G#) is a burst of unexpected light; IV follows naturally.',
     'Then IV turns MINOR — the A♭ drags the brightness down. That major→minor iv is the whole emotion.',
     'Try: keep everything and just revert Fm to F — the ache disappears.'],
    16, [
      ...chord(0, 4, 60, 64, 67),   // C
      ...chord(4, 4, 56, 59, 64),   // E: G#3 B3 E4
      ...chord(8, 4, 57, 60, 65),   // F
      ...chord(12, 4, 56, 60, 65),  // Fm: A♭3 C4 F4
    ]),
  progression('axis-minor', 'The axis progression (vi–IV–I–V)', 'Am → F → C → G: the pop progression started from its saddest chord.',
    ['Same four chords as I–V–vi–IV, rotated to start on the minor vi — instantly moodier.',
     'Try: swap it back to start on C and hear the optimism return.'],
    16, [
      ...chord(0, 4, 57, 60, 64),   // Am
      ...chord(4, 4, 57, 60, 65),   // F
      ...chord(8, 4, 60, 64, 67),   // C
      ...chord(12, 4, 59, 62, 67),  // G
    ]),
  progression('doo-wop', 'Doo-wop changes (I–vi–IV–V)', 'C → Am → F → G: every 50s slow dance.',
    ['The vi chord right after I is the signature — home, then its melancholy twin.',
     'V at the end never resolves inside the loop; the pull back to C is what makes it circular.'],
    16, [
      ...chord(0, 4, 60, 64, 67),   // C
      ...chord(4, 4, 57, 60, 64),   // Am
      ...chord(8, 4, 57, 60, 65),   // F
      ...chord(12, 4, 59, 62, 67),  // G
    ]),
  progression('jazz-251', 'The jazz ii–V–I', 'Dm7 → G7 → Cmaj7: the cadence jazz is built on.',
    ['Sevenths everywhere — the extra note is what makes it "jazz". Delete the 7ths and it turns plain.',
     'The G7 contains B and F (a tritone) — the most unstable interval — which is why landing on Cmaj7 feels so resolved.',
     'Try: keep the rhythm, move every chord up a whole step (Em7–A7–Dmaj7) — same engine, new key.'],
    16, [
      ...chord(0, 4, 50, 53, 57, 60),   // Dm7: D3 F3 A3 C4
      ...chord(4, 4, 47, 50, 53, 59),   // G7: B2 D3 F3 B3
      ...chord(8, 8, 48, 52, 55, 59),   // Cmaj7: C3 E3 G3 B3 (held twice as long)
    ]),
  progression('andalusian', 'Andalusian cadence (i–VII–VI–V)', 'Am → G → F → E: flamenco\u2019s descending walk.',
    ['The bass falls one step per chord: A → G → F → E. That stairway down IS the progression.',
     'The last chord is E MAJOR in an A-minor world — the borrowed G# is the exotic color.',
     'Try: make the E minor instead and hear the Spanish flavor evaporate.'],
    16, [
      ...chord(0, 4, 57, 60, 64),   // Am
      ...chord(4, 4, 55, 59, 62),   // G
      ...chord(8, 4, 53, 57, 60),   // F
      ...chord(12, 4, 52, 56, 59),  // E major (G#)
    ]),
  progression('blues-12', '12-bar blues (I7–IV7–V7)', 'Three dominant chords, twelve bars, a century of songs.',
    ['Every chord is a dominant 7th — permanently "unresolved". In blues, that tension is home.',
     'The shape: four bars of I, two of IV, two of I, then V–IV–I–V. The last V is the turnaround that loops you back.',
     'Try: play the four-on-the-floor recipe under it and swing the hats.'],
    48, [
      ...chord(0, 16, 48, 52, 55, 58),   // C7 ×4 bars
      ...chord(16, 8, 53, 57, 60, 63),   // F7 ×2
      ...chord(24, 8, 48, 52, 55, 58),   // C7 ×2
      ...chord(32, 4, 55, 59, 62, 65),   // G7
      ...chord(36, 4, 53, 57, 60, 63),   // F7
      ...chord(40, 4, 48, 52, 55, 58),   // C7
      ...chord(44, 4, 55, 59, 62, 65),   // G7 turnaround
    ]),
]

/** Materializes a recipe into a clip for a given track, with fresh ids. */
export function buildRecipeClip(recipe: PracticeRecipe, trackId: string, startBeat: number): MidiClip {
  const spec = recipe.build()
  return {
    kind: 'midi',
    id: crypto.randomUUID(),
    trackId,
    name: recipe.title,
    startBeat,
    durationBeats: spec.durationBeats,
    isDrumClip: spec.isDrumClip,
    notes: spec.notes.map(n => ({ ...n, id: crypto.randomUUID() })),
    stretchNotes: true,
    rootNote: 0,  // all recipes are authored in C / A minor
    ...(spec.usePreset ? { presetId: defaultPresetId() ?? undefined } : {}),
  }
}
