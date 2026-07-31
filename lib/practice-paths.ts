// ── Practice Room: skill paths (the in-app lessons) ─────────────────────────
// A lesson is a short sequence of steps completed by actually DOING the thing
// in the editor: each step names a control to glow (data-help-id) and a
// predicate over live project/transport state that marks it done. No quizzes —
// the project state IS the verification. Steps are sequential and sticky.
//
// Written as a fresh, from-zero curriculum: the first lessons assume the user
// doesn't know where the Play button is, and difficulty ramps up from there.
// Each step is ONE short instruction (quick to follow) with an optional
// `detail` the reader can expand for the why + more. Lessons are tiered so
// Simplified mode shows only the basics; Standard/Everything reveal more.

import type { UITier } from './ui-tiers'

export interface PracticeSnapshot {
  trackCount: number
  arrangementClipCount: number
  sessionClipCount: number
  playing: boolean
  recording: boolean
  metronome: boolean
  loopEnabled: boolean
  view: string
  anySolo: boolean
  anyMute: boolean
  anyVolumeChanged: boolean
  anyTrackEffect: boolean
  anyArmed: boolean
  // MIDI / editors
  midiClipCount: number
  maxClipNotes: number
  pianoRollOpen: boolean
  stepSeqOpen: boolean
  // Sound design
  anyPolyTrack: boolean
  polyMaxNotes: number
  anyPolyBright: boolean
  anyPolyPad: boolean
  // Sends & returns
  returnCount: number
  anySend: boolean
  anyReturnEffect: boolean
}

export interface PracticeStep {
  id: string
  title: string
  /** One short sentence telling the user what to do. */
  instruction: string
  /** Optional deeper explanation — shown behind a "Learn more" toggle so the
   *  lesson stays quick by default. */
  detail?: string
  /** Control to glow via highlightHelpTargets when the user asks "show me". */
  helpId?: string
  /** Live check against editor state — true marks the step complete (sticky). */
  done: (s: PracticeSnapshot) => boolean
}

export type PracticeCategory = 'Getting Started' | 'Making Music' | 'Mixing' | 'Advanced'

export const PRACTICE_CATEGORY_ORDER: PracticeCategory[] =
  ['Getting Started', 'Making Music', 'Mixing', 'Advanced']

export interface PracticePath {
  id: string
  title: string
  tagline: string
  category: PracticeCategory
  /** Studio tier (beginner = free & Simplified). */
  tier?: UITier
  steps: PracticeStep[]
}

export const PRACTICE_PATHS: PracticePath[] = [
  // ─────────────────────── GETTING STARTED (basics) ───────────────────────
  {
    id: 'find-your-way',
    tier: 'beginner',
    title: 'Find your way around',
    category: 'Getting Started',
    tagline: 'Play, stop, and the click — the three buttons everything starts with.',
    steps: [
      {
        id: 'play', title: 'Press Play',
        instruction: 'Find the ▶ Play button at the top and click it.',
        detail: 'Play starts the music from the beginning. You can also just tap the Spacebar. Nothing will sound yet — the project is empty — but the playhead line will start moving.',
        helpId: 'play',
        done: s => s.playing,
      },
      {
        id: 'stop', title: 'Stop it',
        instruction: 'Press the same button again to stop.',
        detail: 'Play and Stop are the same button — it turns into ■ while playing. The Spacebar toggles it too.',
        helpId: 'play',
        done: s => !s.playing,
      },
      {
        id: 'metronome', title: 'Turn on the click',
        instruction: 'Click the metronome so you hear a steady tick.',
        detail: 'The metronome ticks on every beat to keep you in time. Press Play again and you’ll hear it. Turn it off once your own rhythm is playing.',
        helpId: 'metronome',
        done: s => s.metronome,
      },
    ],
  },
  {
    id: 'add-first-track',
    tier: 'beginner',
    title: 'Add your first track',
    category: 'Getting Started',
    tagline: 'Tracks are the building blocks — make a couple.',
    steps: [
      {
        id: 'add-1', title: 'Add a track',
        instruction: 'Click "+ Track" to add your first track.',
        detail: 'A track is one lane that holds one sound — a drum kit, a bass, a voice. A whole song is just a few tracks stacked and played together.',
        helpId: 'add-track',
        done: s => s.trackCount >= 1,
      },
      {
        id: 'add-2', title: 'Add another',
        instruction: 'Add a second track.',
        detail: 'Give every instrument its own track, so you can turn each one up, down, or off on its own later.',
        helpId: 'add-track',
        done: s => s.trackCount >= 2,
      },
    ],
  },
  {
    id: 'first-sound',
    tier: 'beginner',
    title: 'Make your first sound',
    category: 'Getting Started',
    tagline: 'From an empty track to something you can hear.',
    steps: [
      {
        id: 'track', title: 'Add a track',
        instruction: 'Add a track to hold a sound.',
        helpId: 'add-track',
        done: s => s.trackCount >= 1,
      },
      {
        id: 'clip', title: 'Make a clip',
        instruction: 'Double-click the empty lane (or hit EDITOR) to create a clip.',
        detail: 'A clip is a block of music sitting on a track. Opening it gives you a grid where you place the actual notes or drum hits.',
        helpId: 'editor',
        done: s => s.midiClipCount >= 1,
      },
      {
        id: 'notes', title: 'Place a few notes',
        instruction: 'Click in the grid to add at least 3 notes.',
        detail: 'Every square you click becomes a sound. Higher up the grid is a higher pitch.',
        helpId: 'editor',
        done: s => s.maxClipNotes >= 3,
      },
      {
        id: 'hear', title: 'Hear it',
        instruction: 'Press Play and listen to what you made.',
        detail: 'It loops around so you can keep tweaking while it plays.',
        helpId: 'play',
        done: s => s.playing && s.maxClipNotes >= 3,
      },
    ],
  },

  // ─────────────────────────── MAKING MUSIC ───────────────────────────────
  {
    id: 'make-a-beat',
    tier: 'beginner',
    title: 'Make a beat',
    category: 'Making Music',
    tagline: 'Build a drum groove on the beat grid.',
    steps: [
      {
        id: 'drum-track', title: 'Add a track',
        instruction: 'Add a track for your drums.',
        helpId: 'add-track',
        done: s => s.trackCount >= 1,
      },
      {
        id: 'beat-grid', title: 'Open the beat grid',
        instruction: 'Open a drum clip so you get the pad grid.',
        detail: 'Drum clips open as a grid: kick, snare, and hats run down the side, and time runs across the top. Tap a square to place a hit.',
        helpId: 'editor',
        done: s => s.stepSeqOpen || s.midiClipCount >= 1,
      },
      {
        id: 'kick', title: 'Lay down a kick',
        instruction: 'Tap the kick row on each of the four beats.',
        detail: 'The kick is the low thump. One on every beat is the "four-on-the-floor" heartbeat under most dance music.',
        done: s => s.maxClipNotes >= 4,
      },
      {
        id: 'snare-hats', title: 'Add snare and hats',
        instruction: 'Add a snare on beats 2 and 4, and some hats in between.',
        detail: 'The snare backbeat (2 and 4) is what makes people nod. Hats fill the gaps and add drive.',
        done: s => s.maxClipNotes >= 8,
      },
      {
        id: 'play-beat', title: 'Play your beat',
        instruction: 'Press Play and let it loop.',
        helpId: 'play',
        done: s => s.playing && s.maxClipNotes >= 8,
      },
    ],
  },
  {
    id: 'write-a-melody',
    tier: 'beginner',
    title: 'Write a melody',
    category: 'Making Music',
    tagline: 'Draw notes in the piano roll and hear them back.',
    steps: [
      {
        id: 'midi-clip', title: 'Make a clip',
        instruction: 'Double-click a lane (or hit PIANO ROLL) to make a clip.',
        helpId: 'editor',
        done: s => s.midiClipCount >= 1,
      },
      {
        id: 'open-roll', title: 'Open the piano roll',
        instruction: 'Open your clip in the piano roll.',
        detail: 'The piano roll is a grid with pitch up the side (a keyboard turned on its side) and time across the top.',
        helpId: 'piano-roll',
        done: s => s.pianoRollOpen,
      },
      {
        id: 'draw', title: 'Draw a phrase',
        instruction: 'Click to place at least 4 notes in a row.',
        detail: 'Keep the notes close together in pitch for a smooth, singable line. Big jumps sound dramatic — use them sparingly.',
        helpId: 'piano-roll',
        done: s => s.maxClipNotes >= 4,
      },
      {
        id: 'play-melody', title: 'Play it back',
        instruction: 'Press Play and listen.',
        helpId: 'play',
        done: s => s.playing && s.maxClipNotes >= 4,
      },
    ],
  },
  {
    id: 'loop-a-section',
    tier: 'intermediate',
    title: 'Loop a section',
    category: 'Making Music',
    tagline: 'Repeat a part hands-free while you work on it.',
    steps: [
      {
        id: 'loop-on', title: 'Turn on Loop',
        instruction: 'Click the Loop button.',
        detail: 'Loop repeats a chosen section over and over, so you can dial in sounds and levels without reaching for Play every few seconds.',
        helpId: 'loop',
        done: s => s.loopEnabled,
      },
      {
        id: 'loop-play', title: 'Play the loop',
        instruction: 'Press Play — it now repeats.',
        detail: 'Drag across the timeline to set exactly which bars loop; double-click the Loop button to loop the whole project.',
        helpId: 'play',
        done: s => s.playing && s.loopEnabled,
      },
    ],
  },

  // ───────────────────────────── MIXING ───────────────────────────────────
  {
    id: 'balance-your-mix',
    tier: 'intermediate',
    title: 'Balance your mix',
    category: 'Mixing',
    tagline: 'Solo, mute, and set levels so every part fits.',
    steps: [
      {
        id: 'solo', title: 'Solo a track',
        instruction: 'Click "S" on a track to hear just it.',
        detail: 'Solo silences everything except the tracks you solo — the fastest way to check one part on its own.',
        helpId: 'solo',
        done: s => s.anySolo,
      },
      {
        id: 'mute', title: 'Mute a track',
        instruction: 'Click "M" to silence a track.',
        detail: 'Mute drops a track out of the mix. Muting parts one at a time tells you what each is really adding.',
        helpId: 'mute',
        done: s => s.anyMute,
      },
      {
        id: 'level', title: 'Set a level',
        instruction: 'Drag a track’s volume slider to balance it.',
        detail: 'Turn loud parts DOWN rather than everything else up — it leaves headroom for a clean, loud final master.',
        done: s => s.anyVolumeChanged,
      },
    ],
  },
  {
    id: 'add-an-effect',
    tier: 'intermediate',
    title: 'Add an effect',
    category: 'Mixing',
    tagline: 'Shape a sound with reverb, EQ, or compression.',
    steps: [
      {
        id: 'effect', title: 'Add an effect',
        instruction: 'Open a track’s ⚙ devices and add an effect — try Reverb or EQ.',
        detail: 'Effects sit in a chain on each track and reshape its sound: Reverb adds space, EQ tames or brightens tone, a Compressor evens out the loudness.',
        helpId: 'add-device',
        done: s => s.anyTrackEffect,
      },
      {
        id: 'hear-fx', title: 'Hear the difference',
        instruction: 'Press Play, then toggle the effect’s Bypass to A/B it.',
        detail: 'Flipping an effect on and off while it plays is the fastest way to learn what it actually does.',
        helpId: 'play',
        done: s => s.playing && s.anyTrackEffect,
      },
    ],
  },

  // ───────────────────────────── ADVANCED ─────────────────────────────────
  {
    id: 'record-yourself',
    tier: 'intermediate',
    title: 'Record yourself',
    category: 'Advanced',
    tagline: 'Arm a track and capture a take.',
    steps: [
      {
        id: 'arm', title: 'Arm a track',
        instruction: 'Click the ● record-arm button on a track.',
        detail: 'Arming tells that track to capture sound when you record. Pick its input (mic) next to the arm button. You can arm several tracks at once.',
        helpId: 'arm',
        done: s => s.anyArmed,
      },
      {
        id: 'record', title: 'Hit Record',
        instruction: 'Press the ● Record button up top and play/sing.',
        detail: 'Record captures your input onto the armed track. Turn on the metronome first so your take lands in time. Press Record again to stop.',
        helpId: 'record',
        done: s => s.recording,
      },
    ],
  },
  {
    id: 'shape-the-space',
    tier: 'full',
    title: 'Shape the space',
    category: 'Advanced',
    tagline: 'One shared reverb for the whole mix, with sends and returns.',
    steps: [
      {
        id: 'return', title: 'Add a return track',
        instruction: 'Click "+Ret" to create a return.',
        detail: 'A return is a shared effects lane. Instead of loading reverb on every track, put it on a return once and send tracks to it — cleaner and more cohesive.',
        helpId: 'add-return',
        done: s => s.returnCount >= 1,
      },
      {
        id: 'send', title: 'Send a track to it',
        instruction: 'In the Mixer, turn up a track’s send to your return.',
        detail: 'The send sets how much of that track feeds the return’s effect. Small amounts glue a mix together; large amounts wash it out.',
        done: s => s.anySend,
      },
      {
        id: 'return-fx', title: 'Add reverb on the return',
        instruction: 'Drop a Reverb on the return.',
        detail: 'Now every track you send shares one space — the pro way to add depth without muddying anything.',
        helpId: 'add-device',
        done: s => s.anyReturnEffect,
      },
    ],
  },
  {
    id: 'sound-from-code',
    tier: 'full',
    title: 'Design a sound with code',
    category: 'Advanced',
    tagline: 'Generate a synth voice from a tiny script.',
    steps: [
      {
        id: 'code-track', title: 'Generate a synth',
        instruction: 'Open the Code panel, pick a template, and press Add track.',
        detail: 'The Code panel builds an instrument from a tiny script instead of a preset. Every generated voice is fully editable afterwards.',
        helpId: 'sound-code',
        done: s => s.anyPolyTrack,
      },
      {
        id: 'code-hear', title: 'Hear the voice',
        instruction: 'Press Play and listen to what your script made.',
        helpId: 'play',
        done: s => s.anyPolyTrack && s.playing,
      },
      {
        id: 'code-shape', title: 'Shape it',
        instruction: 'Add a Filter, Reverb, or Delay and hear it change.',
        detail: 'The same effects you use on any track work on a coded voice too — layer them to make the sound your own.',
        helpId: 'add-device',
        done: s => s.anyPolyTrack && s.anyTrackEffect,
      },
    ],
  },
]
