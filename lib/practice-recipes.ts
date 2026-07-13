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
    ...(spec.usePreset ? { presetId: defaultPresetId() ?? undefined } : {}),
  }
}
