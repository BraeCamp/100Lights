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
  /** Genre folder in the library (see RECIPE_GENRES for built-in assignments). */
  genre?: string
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
  progression('mixolydian-rock', 'The rock lift (I–♭VII–IV)', 'C → B♭ → F: stadium rock’s favorite borrowed chord.',
    ['♭VII (B♭) isn’t in the key of C at all — it’s borrowed from the parallel minor, and that rule-break is the swagger.',
     'All three chords are major, so it stays triumphant even while it wanders off-key.',
     'Try: hold each chord 8 beats instead of 4 and it turns from rock riff into anthem outro.'],
    16, [
      ...chord(0, 4, 60, 64, 67),   // C
      ...chord(4, 4, 58, 62, 65),   // B♭
      ...chord(8, 4, 53, 57, 60),   // F
      ...chord(12, 4, 60, 64, 67),  // C
    ]),
  progression('rhythm-turnaround', 'The turnaround (I–vi–ii–V)', 'C → Am → Dm → G: the loop that ends a thousand jazz and soul tunes.',
    ['Cousin of the doo-wop changes, but ii instead of IV gives the bass a smoother circle-of-fifths walk: A → D → G → C.',
     'Each root is a fifth below the last — the strongest pull in harmony, four times in a row.',
     'Try: turn every chord into a seventh and it’s instantly a jazz standard ending.'],
    16, [
      ...chord(0, 4, 60, 64, 67),   // C
      ...chord(4, 4, 57, 60, 64),   // Am
      ...chord(8, 4, 53, 57, 62),   // Dm/F
      ...chord(12, 4, 55, 59, 62),  // G
    ]),
  progression('emotional-iv', 'The big-chorus loop (IV–I–V–vi)', 'F → C → G → Am: the pop progression rotated to start away from home.',
    ['Same four chords as I–V–vi–IV, but opening on IV makes the arrival at I in bar two feel like a sigh of relief.',
     'Ending each cycle on the minor vi keeps it circling — resolution is always one bar away.',
     'Try: compare it side by side with the pop progression and the axis progression: same chords, three moods.'],
    16, [
      ...chord(0, 4, 53, 57, 60),   // F
      ...chord(4, 4, 52, 55, 60),   // C/E
      ...chord(8, 4, 55, 59, 62),   // G
      ...chord(12, 4, 57, 60, 64),  // Am
    ]),
  progression('minor-rise', 'The epic minor rise (i–♭VI–♭VII)', 'Am → F → G: the slow-burn build under countless trailers and synthwave tracks.',
    ['Only three chords, and two of them are major — the minor home chord does all the brooding.',
     'F to G is a step-wise climb that never resolves upward to A major, so the tension keeps stacking.',
     'Try: double every duration and add a rising melody on top — it’s an instant final chorus.'],
    16, [
      ...chord(0, 8, 57, 60, 64),   // Am (held)
      ...chord(8, 4, 53, 57, 60),   // F
      ...chord(12, 4, 55, 59, 62),  // G
    ]),
  progression('neo-soul-vamp', 'The two-chord vamp (Imaj7–IVmaj7)', 'Cmaj7 → Fmaj7: neo-soul’s entire harmonic budget.',
    ['Two chords, both major sevenths — the 7ths blur the line between them so neither feels like a destination.',
     'With no V chord anywhere there’s no tension to resolve; the music just floats.',
     'Try: this is the progression to practice melodies over — nothing you play can clash.'],
    16, [
      ...chord(0, 4, 48, 52, 55, 59),   // Cmaj7
      ...chord(4, 4, 53, 57, 60, 64),   // Fmaj7
      ...chord(8, 4, 48, 52, 55, 59),   // Cmaj7
      ...chord(12, 4, 53, 57, 60, 64),  // Fmaj7
    ]),
  progression('ragtime-turnaround', 'The parlor turnaround (I–VI7–ii–V7)', 'C → A7 → Dm → G7: ragtime, gospel, and every Christmas song bridge.',
    ['A7 is the surprise: it doesn’t belong to the key, it’s borrowed to point straight at Dm (a "secondary dominant").',
     'The C# inside A7 is the tell — one foreign note that makes the old-timey magic.',
     'Try: revert A7 to plain Am and hear it become the ordinary turnaround.'],
    16, [
      ...chord(0, 4, 60, 64, 67),        // C
      ...chord(4, 4, 57, 61, 64, 67),    // A7: A3 C#4 E4 G4
      ...chord(8, 4, 53, 57, 62),        // Dm/F
      ...chord(12, 4, 55, 59, 62, 65),   // G7
    ]),
  progression('lydian-lift', 'The dreamer’s lift (I–II)', 'C → D: two major chords a step apart — instant wonder.',
    ['D major doesn’t belong in the key of C: its F# is the fourth scale degree raised, the "lydian" note.',
     'Because both chords are major and neither resolves, it hangs in the air — film scores use it for flight and space.',
     'Try: alternate slowly with a sustained pad preset; speed it up and it turns playful.'],
    16, [
      ...chord(0, 4, 60, 64, 67),   // C
      ...chord(4, 4, 62, 66, 69),   // D: D4 F#4 A4
      ...chord(8, 4, 60, 64, 67),   // C
      ...chord(12, 4, 62, 66, 69),  // D
    ]),
  progression('line-cliche', 'The descending line (C–C/B–Am–Am/G–F–F/E–Dm–G)', 'A bassline that walks down the whole scale while the harmony shadows it.',
    ['The chords barely change — it’s the bass stepping down C B A G F E D that carries the song.',
     'This is the skeleton of "A Whiter Shade of Pale" and half the ballads of 1967–73.',
     'Try: mute the top notes and play only the lowest note of each chord — the progression still works.'],
    32, [
      ...chord(0, 4, 48, 60, 64, 67),   // C
      ...chord(4, 4, 47, 60, 64, 67),   // C/B
      ...chord(8, 4, 45, 57, 60, 64),   // Am
      ...chord(12, 4, 43, 57, 60, 64),  // Am/G
      ...chord(16, 4, 41, 57, 60, 65),  // F
      ...chord(20, 4, 40, 57, 60, 65),  // F/E
      ...chord(24, 4, 38, 53, 57, 62),  // Dm
      ...chord(28, 4, 43, 55, 59, 62),  // G
    ]),
  progression('uplift', 'The slow climb (I–iii–IV–V)', 'C → Em → F → G: every chord a step higher than the last.',
    ['The whole progression only moves upward — root motion C E F G — so it feels like ascending stairs.',
     'iii is the quiet one: shares two notes with C, so bar two is a shadow of bar one before the real climb.',
     'Try: put a rising bass note under each chord and it doubles the lift.'],
    16, [
      ...chord(0, 4, 60, 64, 67),   // C
      ...chord(4, 4, 52, 55, 59),   // Em
      ...chord(8, 4, 53, 57, 60),   // F
      ...chord(12, 4, 55, 59, 62),  // G
    ]),
]

// ── Community-imported recipes ────────────────────────────────────────────────
// Recipes downloaded from the community page live in localStorage and merge
// into the same catalog the library tab, drag-drop, and Practice Room read.

const IMPORTED_KEY = '100lights-imported-recipes'

export interface StoredRecipeSpec {
  id: string
  title: string
  tagline: string
  annotation: string[]
  genre?: string
  spec: ReturnType<PracticeRecipe['build']>
}

export function getImportedRecipes(): PracticeRecipe[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = JSON.parse(localStorage.getItem(IMPORTED_KEY) || '[]') as StoredRecipeSpec[]
    return raw.map(r => ({ id: r.id, title: r.title, tagline: r.tagline, annotation: r.annotation ?? [], genre: r.genre, build: () => r.spec }))
  } catch { return [] }
}

export function importRecipe(stored: StoredRecipeSpec): void {
  const raw = (() => { try { return JSON.parse(localStorage.getItem(IMPORTED_KEY) || '[]') as StoredRecipeSpec[] } catch { return [] } })()
  const next = [...raw.filter(r => r.id !== stored.id), stored]
  localStorage.setItem(IMPORTED_KEY, JSON.stringify(next))
}

// ── Signature synth sounds (from the darkwave/dark-pop starter songs) ─────────
// These recipes carry the full instrument patch (not a preset), so dropping one
// onto a track gives you that exact SOUND plus a short demo phrase. Clear the
// notes and play your own — the sound stays.
const soundRecipe = (
  id: string, title: string, tagline: string, annotation: string[],
  params: Record<string, unknown>, durationBeats: number, notes: Omit<MidiNote, 'id'>[],
): PracticeRecipe => ({
  id, title, tagline, annotation, genre: 'Electronic',
  build: () => ({
    trackName: title,
    instrument: { type: 'poly', params } as TrackInstrument,
    isDrumClip: false, durationBeats, usePreset: false, notes,
  }),
})

export const SOUND_RECIPES: PracticeRecipe[] = [
  soundRecipe('snd-darkwave-lead', 'Darkwave Lead',
    'The moody square-wave lead from “Hollow Cathedral” — with a slow pitch vibrato.',
    ['A hollow square wave through a low-pass filter (1.5 kHz), with a gentle 5 Hz vibrato on the pitch.',
     'Clear the demo melody and play your own — the sound is what travels.'],
    { waveform: 'square', attack: 0.01, decay: 0.2, sustain: 0.55, release: 0.4, detune: 7, filterType: 'lowpass', filterCutoff: 1500, filterResonance: 3, lfoEnabled: true, lfoRate: 5, lfoDepth: 0.12, lfoTarget: 'pitch', lfoWaveform: 'sine' },
    16, [
      N(78, 0, 1.5), N(81, 1.5, 0.5), N(73, 2, 2), N(83, 6, 1), N(81, 7, 1),
      N(78, 8, 2), N(73, 12, 1), N(76, 13, 1), N(73, 14, 2),
    ]),
  soundRecipe('snd-cold-pad', 'Cold Pad',
    'The wide, slow-swelling darkwave pad — detuned saw with a drifting filter.',
    ['Two saw layers an octave apart, opened by a slow LFO on the filter for that cold “breathing” motion.',
     'Long attack and release make it a bed — hold whole-note chords under everything.'],
    { waveform: 'sawtooth', attack: 1.1, decay: 0.6, sustain: 0.7, release: 0.9, detune: -12, filterType: 'lowpass', filterCutoff: 1000, filterResonance: 2.2, lfoEnabled: true, lfoRate: 0.22, lfoDepth: 0.25, lfoTarget: 'filter', lfoWaveform: 'sine' },
    16, [
      N(54, 0, 4), N(57, 0, 4), N(61, 0, 4),   N(50, 4, 4), N(54, 4, 4), N(57, 4, 4),
      N(57, 8, 4), N(61, 8, 4), N(64, 8, 4),   N(52, 12, 4), N(56, 12, 4), N(59, 12, 4),
    ]),
  soundRecipe('snd-sequencer-arp', 'Sequencer Arp',
    'The tight, plucky EBM-style arp — a short square stab that dies fast.',
    ['Zero sustain and a fast release give it that staccato “tick” — perfect for 8th- or 16th-note sequences.',
     'Play it as steady 8ths and let the filter/reverb do the rest.'],
    { waveform: 'square', attack: 0.002, decay: 0.18, sustain: 0.0, release: 0.16, detune: 12, filterType: 'lowpass', filterCutoff: 2200, filterResonance: 3.2, lfoEnabled: false, lfoRate: 4, lfoDepth: 0, lfoTarget: 'filter', lfoWaveform: 'sine' },
    8, [
      N(66, 0, 0.4), N(69, 0.5, 0.4), N(73, 1, 0.4), N(78, 1.5, 0.4), N(73, 2, 0.4), N(69, 2.5, 0.4), N(66, 3, 0.4), N(69, 3.5, 0.4),
      N(66, 4, 0.4), N(69, 4.5, 0.4), N(73, 5, 0.4), N(78, 5.5, 0.4), N(73, 6, 0.4), N(69, 6.5, 0.4), N(66, 7, 0.4), N(73, 7.5, 0.4),
    ]),
  soundRecipe('snd-reese-bass', 'Reese Bass',
    'The growling detuned-saw bass — resonant and dark, for driving 8th-note lines.',
    ['A detuned sawtooth through a resonant low-pass (620 Hz, Q 6) — that’s the “Reese” growl.',
     'Keep it low and busy; it locks with the kick.'],
    { waveform: 'sawtooth', attack: 0.006, decay: 0.12, sustain: 0.75, release: 0.2, detune: 9, filterType: 'lowpass', filterCutoff: 620, filterResonance: 6, lfoEnabled: false, lfoRate: 4, lfoDepth: 0.3, lfoTarget: 'filter', lfoWaveform: 'sine' },
    8, [
      N(42, 0, 0.42), N(42, 0.5, 0.42), N(49, 1, 0.42), N(42, 1.5, 0.42), N(42, 2, 0.42), N(54, 2.5, 0.42), N(49, 3, 0.42), N(42, 3.5, 0.42),
      N(42, 4, 0.42), N(42, 4.5, 0.42), N(49, 5, 0.42), N(42, 5.5, 0.42), N(42, 6, 0.42), N(54, 6.5, 0.42), N(49, 7, 0.42), N(42, 7.5, 0.42),
    ]),
  soundRecipe('snd-808-sub', '808 Sub Bass',
    'The deep sine sub from the heavier tracks — long, round, and felt more than heard.',
    ['A pure sine with a long tail — the tonal 808. Pair it with the 808 drum kick for weight.',
     'Slide between roots by leaving no gap between notes.'],
    { waveform: 'sine', attack: 0.006, decay: 0.2, sustain: 0.92, release: 0.4, detune: 0, filterType: 'lowpass', filterCutoff: 3000, filterResonance: 1, lfoEnabled: false, lfoRate: 4, lfoDepth: 0.3, lfoTarget: 'filter', lfoWaveform: 'sine' },
    8, [
      N(30, 0, 2.4), N(30, 2.5, 1), N(42, 3.5, 0.5),
      N(30, 4, 2.4), N(30, 6.5, 1), N(42, 7.5, 0.5),
    ]),
]

/** Genre folders shown in the library, in display order. */
export const RECIPE_GENRE_ORDER = ['Pop', 'Rock', 'Jazz', 'Blues', 'Soul', 'Electronic', 'Classical', 'Cinematic', 'World', 'Other'] as const

/** Genre assignments for the built-in recipes (imported/user recipes carry their own). */
const RECIPE_GENRES: Record<string, string> = {
  'pop-progression':    'Pop',
  'royal-road':         'Pop',
  'axis-minor':         'Pop',
  'emotional-iv':       'Pop',
  'uplift':             'Pop',
  'creep-move':         'Rock',
  'mixolydian-rock':    'Rock',
  'line-cliche':        'Rock',
  'minor-251':          'Jazz',
  'jazz-251':           'Jazz',
  'rhythm-turnaround':  'Jazz',
  'ragtime-turnaround': 'Jazz',
  'walking-bass':       'Jazz',
  'blues-12':           'Blues',
  'doo-wop':            'Soul',
  'neo-soul-vamp':      'Soul',
  'minor-rise':         'Electronic',
  'four-on-floor':      'Electronic',
  'canon':              'Classical',
  'lydian-lift':        'Cinematic',
  'andalusian':         'World',
}

/** Built-in chord recipes plus anything imported from the community. */
export function getAllChordRecipes(): PracticeRecipe[] {
  return [...CHORD_RECIPES, ...SOUND_RECIPES, ...getImportedRecipes()].map(r => r.genre ? r : { ...r, genre: RECIPE_GENRES[r.id] })
}

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
