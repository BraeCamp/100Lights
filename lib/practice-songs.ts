// ── Practice Room: guided song builds ───────────────────────────────────────
// A PracticeSong is a full multi-track section (Drums, Bass, Chords/Rhythm,
// Lead) I composed, built part by part in the user's real project. Each part
// drops onto its own track at beat 0 so the parts stack and play together;
// the Practice Room walks the user through loading them and highlights the
// controls to play/shape the result. Pick a genre — Pop, Rock, or Metal — and
// practice building the kind of music you actually want to make.

import type { MidiNote, MidiClip, TrackInstrument, PolyInstrumentParams } from './daw-types'

const N = (pitch: number, startBeat: number, durationBeats: number, velocity = 100): Omit<MidiNote, 'id'> =>
  ({ pitch, startBeat, durationBeats, velocity })

// Drum pitches — match DRUM_LANES in the piano roll.
const KICK = 36, SNARE = 38, CHAT = 42, OHAT = 46, CRASH = 49

const DRUMS: TrackInstrument = { type: 'drum', params: { pack: 'synth' } }

// Fill in a full poly patch from a short override.
const poly = (p: Partial<PolyInstrumentParams>): TrackInstrument => ({
  type: 'poly',
  params: {
    waveform: 'sawtooth', attack: 0.01, decay: 0.15, sustain: 0.6, release: 0.2, detune: 0,
    filterType: 'lowpass', filterCutoff: 1800, filterResonance: 1.2,
    lfoEnabled: false, lfoRate: 4, lfoDepth: 0.2, lfoTarget: 'filter', lfoWaveform: 'sine',
    ...p,
  } as PolyInstrumentParams,
})

export interface SongPart {
  id: string
  /** Role label — also the clip name (e.g. "Drums", "Bass"). */
  title: string
  /** What this part is and what to do once it's in. */
  instruction: string
  /** Editor control to glow via "Show me where". */
  helpId?: string
  build: () => { instrument: TrackInstrument; isDrumClip: boolean; durationBeats: number; notes: Omit<MidiNote, 'id'>[] }
}

export interface PracticeSong {
  id: string
  genre: 'Pop' | 'Rock' | 'Metal'
  title: string
  tagline: string
  tempo: number
  parts: SongPart[]
}

const LEN = 16  // every part is a 4-bar section

type PartSpec = ReturnType<SongPart['build']>

// ── POP — "Neon Sunrise" (I–V–vi–IV, C major) ────────────────────────────────
const popDrums = (): PartSpec => {
  const notes: Omit<MidiNote, 'id'>[] = []
  for (let bar = 0; bar < 4; bar++) {
    const b = bar * 4
    notes.push(N(KICK, b, 0.25, 112), N(KICK, b + 2, 0.25, 104))
    notes.push(N(SNARE, b + 1, 0.25, 96), N(SNARE, b + 3, 0.25, 96))
    for (let e = 0; e < 8; e++) notes.push(N(CHAT, b + e * 0.5, 0.18, e % 2 === 0 ? 76 : 58))
    notes.push(N(OHAT, b + 3.5, 0.25, 82))
  }
  return { instrument: DRUMS, isDrumClip: true, durationBeats: LEN, notes }
}

const POP: PracticeSong = {
  id: 'song-pop-neon-sunrise',
  genre: 'Pop',
  title: 'Neon Sunrise',
  tagline: 'Bright four-chord pop — the I–V–vi–IV loop under a thousand hits.',
  tempo: 116,
  parts: [
    {
      id: 'pop-drums', title: 'Drums',
      instruction: 'A dance-pop backbeat: kick on 1 and 3, snare on 2 and 4, hats keeping time. Press ▶ to feel the pulse.',
      helpId: 'track-lane',
      build: () => popDrums(),
    },
    {
      id: 'pop-bass', title: 'Bass',
      instruction: 'Root notes walking C → G → Am → F, with an octave hop each bar. It locks to the kick.',
      helpId: 'track-lane',
      build: () => {
        const roots = [36, 43, 45, 41] // C2 G2 A2 F2
        const notes: Omit<MidiNote, 'id'>[] = []
        for (let bar = 0; bar < 4; bar++) {
          const r = roots[bar], b = bar * 4
          notes.push(N(r, b, 1, 100), N(r, b + 1, 1, 92), N(r, b + 2, 1, 100), N(r + 12, b + 3, 1, 90))
        }
        return { instrument: poly({ waveform: 'triangle', decay: 0.15, sustain: 0.85, release: 0.18, filterCutoff: 1100, filterResonance: 1 }), isDrumClip: false, durationBeats: LEN, notes }
      },
    },
    {
      id: 'pop-chords', title: 'Chords',
      instruction: 'The four chords held a bar each — C, G, Am, F. A warm pad glues the track together.',
      helpId: 'track-lane',
      build: () => {
        const voic = [[60, 64, 67], [59, 62, 67], [57, 60, 64], [57, 60, 65]]
        const notes: Omit<MidiNote, 'id'>[] = []
        for (let bar = 0; bar < 4; bar++) for (const p of voic[bar]) notes.push(N(p, bar * 4, 4, 68))
        return { instrument: poly({ waveform: 'sawtooth', attack: 0.35, decay: 0.5, sustain: 0.75, release: 0.6, detune: -8, filterCutoff: 1500, filterResonance: 1.4, lfoEnabled: true, lfoRate: 0.3, lfoDepth: 0.15 }), isDrumClip: false, durationBeats: LEN, notes }
      },
    },
    {
      id: 'pop-lead', title: 'Lead',
      instruction: 'A singable topline over the chords. Now hit ▶ — that\'s a pop song. Try muting parts to hear each one.',
      helpId: 'play',
      build: () => ({
        instrument: poly({ waveform: 'square', attack: 0.01, decay: 0.18, sustain: 0.5, release: 0.2, detune: 5, filterCutoff: 2800, filterResonance: 2 }),
        isDrumClip: false, durationBeats: LEN,
        notes: [
          N(64, 0, 1), N(67, 1, 1), N(72, 2, 2),
          N(74, 4, 1), N(71, 5, 1), N(67, 6, 2),
          N(72, 8, 1), N(76, 9, 1), N(69, 10, 2),
          N(77, 12, 1), N(72, 13, 1), N(69, 14, 2),
        ],
      }),
    },
  ],
}

// ── ROCK — "Redline" (I–♭VII–IV–I mixolydian, power chords) ───────────────────
const ROCK: PracticeSong = {
  id: 'song-rock-redline',
  genre: 'Rock',
  title: 'Redline',
  tagline: 'Driving mixolydian rock — C → B♭ → F power chords with a pentatonic lead.',
  tempo: 148,
  parts: [
    {
      id: 'rock-drums', title: 'Drums',
      instruction: 'A driving rock beat with a crash on the downbeat and a busier kick. Press ▶ for the drive.',
      helpId: 'track-lane',
      build: () => {
        const notes: Omit<MidiNote, 'id'>[] = []
        for (let bar = 0; bar < 4; bar++) {
          const b = bar * 4
          notes.push(N(KICK, b, 0.25, 115), N(KICK, b + 2, 0.25, 104), N(KICK, b + 2.5, 0.22, 94))
          notes.push(N(SNARE, b + 1, 0.25, 108), N(SNARE, b + 3, 0.25, 108))
          for (let e = 0; e < 8; e++) notes.push(N(CHAT, b + e * 0.5, 0.18, e % 2 ? 70 : 84))
          if (bar === 0) notes.push(N(CRASH, b, 0.5, 112))
        }
        return { instrument: DRUMS, isDrumClip: true, durationBeats: LEN, notes }
      },
    },
    {
      id: 'rock-bass', title: 'Bass',
      instruction: 'Eighth-note root drive under the riff: C, B♭, F, C. A gritty saw bass that pushes forward.',
      helpId: 'track-lane',
      build: () => {
        const roots = [36, 34, 41, 36] // C2 B♭1 F2 C2
        const notes: Omit<MidiNote, 'id'>[] = []
        for (let bar = 0; bar < 4; bar++) {
          const r = roots[bar], b = bar * 4
          for (let i = 0; i < 8; i++) notes.push(N(r, b + i * 0.5, 0.42, i % 2 ? 92 : 104))
        }
        return { instrument: poly({ waveform: 'sawtooth', detune: 9, decay: 0.12, sustain: 0.7, release: 0.14, filterCutoff: 850, filterResonance: 4 }), isDrumClip: false, durationBeats: LEN, notes }
      },
    },
    {
      id: 'rock-rhythm', title: 'Rhythm guitar',
      instruction: 'Palm-muted power chords chugging in eighths — root + fifth + octave. The backbone of the song.',
      helpId: 'track-lane',
      build: () => {
        const chords = [[48, 55, 60], [46, 53, 58], [41, 48, 53], [48, 55, 60]] // C5 B♭5 F5 C5
        const notes: Omit<MidiNote, 'id'>[] = []
        for (let bar = 0; bar < 4; bar++) {
          const ch = chords[bar], b = bar * 4
          for (let i = 0; i < 8; i++) for (const p of ch) notes.push(N(p, b + i * 0.5, i % 2 ? 0.18 : 0.24, i % 2 ? 82 : 104))
        }
        return { instrument: poly({ waveform: 'sawtooth', detune: 10, attack: 0.002, decay: 0.12, sustain: 0.45, release: 0.1, filterCutoff: 1900, filterResonance: 1.4 }), isDrumClip: false, durationBeats: LEN, notes }
      },
    },
    {
      id: 'rock-lead', title: 'Lead',
      instruction: 'A pentatonic lead with a bluesy B♭. Hit ▶ for the full band — then add a Reverb on the lead to taste.',
      helpId: 'play',
      build: () => ({
        instrument: poly({ waveform: 'sawtooth', detune: 6, sustain: 0.6, filterCutoff: 3000, filterResonance: 2.4 }),
        isDrumClip: false, durationBeats: LEN,
        notes: [
          N(67, 0, 0.5), N(70, 0.5, 0.5), N(72, 1, 1), N(70, 2, 0.5), N(67, 2.5, 0.5), N(65, 3, 1),
          N(67, 4, 0.5), N(70, 4.5, 0.5), N(72, 5, 1), N(74, 6, 2),
          N(72, 8, 0.5), N(70, 8.5, 0.5), N(67, 9, 1), N(65, 10, 0.5), N(63, 10.5, 0.5), N(60, 11, 1),
          N(60, 12, 0.5), N(63, 12.5, 0.5), N(65, 13, 0.5), N(67, 13.5, 0.5), N(70, 14, 2),
        ],
      }),
    },
  ],
}

// ── METAL — "Iron Verdict" (Andalusian i–VII–VI–V, E minor) ───────────────────
const METAL: PracticeSong = {
  id: 'song-metal-iron-verdict',
  genre: 'Metal',
  title: 'Iron Verdict',
  tagline: 'Fast, dark, and heavy — a double-kick gallop under a low palm-muted Andalusian riff.',
  tempo: 168,
  parts: [
    {
      id: 'metal-drums', title: 'Drums',
      instruction: 'A double-kick gallop with a hard backbeat and an opening crash. Press ▶ — this is the engine room.',
      helpId: 'track-lane',
      build: () => {
        const notes: Omit<MidiNote, 'id'>[] = []
        for (let bar = 0; bar < 4; bar++) {
          const b = bar * 4
          for (let e = 0; e < 8; e++) notes.push(N(KICK, b + e * 0.5, 0.14, e % 2 ? 90 : 104))
          notes.push(N(KICK, b + 1.75, 0.12, 88), N(KICK, b + 3.75, 0.12, 88))
          notes.push(N(SNARE, b + 1, 0.2, 112), N(SNARE, b + 3, 0.2, 112))
          for (let q = 0; q < 4; q++) notes.push(N(CHAT, b + q, 0.16, 66))
          if (bar === 0) notes.push(N(CRASH, b, 0.5, 118))
        }
        return { instrument: DRUMS, isDrumClip: true, durationBeats: LEN, notes }
      },
    },
    {
      id: 'metal-bass', title: 'Bass',
      instruction: 'Low eighth-note roots tracking the riff down: E → D → C → B. Felt more than heard.',
      helpId: 'track-lane',
      build: () => {
        const lowRoots = [28, 26, 24, 23] // E1 D1 C1 B0
        const notes: Omit<MidiNote, 'id'>[] = []
        for (let bar = 0; bar < 4; bar++) {
          const r = lowRoots[bar], b = bar * 4
          for (let i = 0; i < 8; i++) notes.push(N(r, b + i * 0.5, 0.42, 100))
        }
        return { instrument: poly({ waveform: 'sawtooth', detune: 5, decay: 0.1, sustain: 0.75, release: 0.14, filterCutoff: 700, filterResonance: 5 }), isDrumClip: false, durationBeats: LEN, notes }
      },
    },
    {
      id: 'metal-rhythm', title: 'Rhythm guitar',
      instruction: 'A palm-muted 16th chug on the low root with power-chord stabs. The Andalusian descent E → D → C → B is the whole riff.',
      helpId: 'track-lane',
      build: () => {
        const lowRoots = [28, 26, 24, 23] // E1 D1 C1 B0
        const notes: Omit<MidiNote, 'id'>[] = []
        for (let bar = 0; bar < 4; bar++) {
          const lr = lowRoots[bar], b = bar * 4
          for (let i = 0; i < 16; i++) notes.push(N(lr, b + i * 0.25, 0.11, i % 4 === 0 ? 116 : 76))
          const chord = [lr + 12, lr + 19, lr + 24] // power chord (root+5+octave), mid octave
          for (const p of chord) { notes.push(N(p, b, 0.4, 110)); notes.push(N(p, b + 2, 0.4, 100)) }
        }
        return { instrument: poly({ waveform: 'sawtooth', detune: 12, attack: 0.001, decay: 0.09, sustain: 0.4, release: 0.07, filterCutoff: 1500, filterResonance: 1.8 }), isDrumClip: false, durationBeats: LEN, notes }
      },
    },
    {
      id: 'metal-lead', title: 'Lead',
      instruction: 'A fast E-minor run over the riff. Hit ▶ for the full track — then push the rhythm guitar\'s filter for more bite.',
      helpId: 'play',
      build: () => ({
        instrument: poly({ waveform: 'square', detune: 8, decay: 0.14, sustain: 0.55, filterCutoff: 3200, filterResonance: 3 }),
        isDrumClip: false, durationBeats: LEN,
        notes: [
          N(64, 0, 0.5), N(67, 0.5, 0.5), N(71, 1, 0.5), N(76, 1.5, 0.5), N(74, 2, 0.5), N(72, 2.5, 0.5), N(71, 3, 1),
          N(62, 4, 0.5), N(66, 4.5, 0.5), N(69, 5, 0.5), N(74, 5.5, 0.5), N(72, 6, 1), N(71, 7, 1),
          N(60, 8, 0.5), N(64, 8.5, 0.5), N(67, 9, 0.5), N(72, 9.5, 0.5), N(71, 10, 1), N(67, 11, 1),
          N(59, 12, 0.5), N(62, 12.5, 0.5), N(66, 13, 0.5), N(71, 13.5, 0.5), N(69, 14, 1), N(64, 15, 1),
        ],
      }),
    },
  ],
}

export const PRACTICE_SONGS: PracticeSong[] = [POP, ROCK, METAL]

/** Stable track name for a loaded song part (also used to detect completion). */
export const songTrackName = (song: PracticeSong, part: SongPart): string => `${song.title} · ${part.title}`

/** Materialize a song part into a MIDI clip at the top of the timeline. */
export function buildSongClip(part: SongPart, trackId: string): MidiClip {
  const spec = part.build()
  return {
    kind: 'midi',
    id: crypto.randomUUID(),
    trackId,
    name: part.title,
    startBeat: 0,
    durationBeats: spec.durationBeats,
    isDrumClip: spec.isDrumClip,
    notes: spec.notes.map(n => ({ ...n, id: crypto.randomUUID() })),
    stretchNotes: false,
    rootNote: 0,
  }
}
