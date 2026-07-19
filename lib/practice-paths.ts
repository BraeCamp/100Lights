// ── Practice Room: skill paths ──────────────────────────────────────────────
// A skill path is a sequence of steps completed by actually doing the thing in
// the editor: each step names a control to glow (data-help-id) and a predicate
// over live project/transport state that marks it done. No quizzes — the
// project state IS the verification.

export interface PracticeSnapshot {
  trackCount: number
  arrangementClipCount: number
  sessionClipCount: number
  playing: boolean
  metronome: boolean
  view: string
  anySolo: boolean
  anyMute: boolean
  anyTrackEffect: boolean
  anyArmed: boolean
  // MIDI / piano-roll
  midiClipCount: number
  maxClipNotes: number
  pianoRollOpen: boolean
  // Sound design
  anyPolyTrack: boolean
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
  /** Control to glow via highlightHelpTargets when the user asks "show me". */
  helpId?: string
  /** Live check against editor state — true marks the step complete (sticky). */
  done: (s: PracticeSnapshot) => boolean
}

export interface PracticePath {
  id: string
  title: string
  tagline: string
  steps: PracticeStep[]
}

export const PRACTICE_PATHS: PracticePath[] = [
  {
    id: 'first-take',
    title: 'Your first take',
    tagline: 'From an empty session to a captured recording.',
    steps: [
      {
        id: 'add-track', title: 'Add a track',
        instruction: 'Create an audio track to work on.',
        helpId: 'add-track',
        done: s => s.trackCount >= 1,
      },
      {
        id: 'metronome', title: 'Turn on the metronome',
        instruction: 'Give yourself a pulse to play against.',
        helpId: 'metronome',
        done: s => s.metronome,
      },
      {
        id: 'play', title: 'Start playback',
        instruction: 'Press Play (or Space) and listen to the click.',
        helpId: 'play',
        done: s => s.playing,
      },
      {
        id: 'capture', title: 'Capture a take with JAM',
        instruction: 'Hit JAM — the last 30 seconds you played land in the arrangement as a clip.',
        helpId: 'jam',
        done: s => s.arrangementClipCount >= 1 || s.sessionClipCount >= 1,
      },
      {
        id: 'stop', title: 'Stop and look at your take',
        instruction: 'Stop the transport. That clip is a real recording — zoom in and study its waveform.',
        helpId: 'play',
        done: s => !s.playing && (s.arrangementClipCount >= 1 || s.sessionClipCount >= 1),
      },
    ],
  },
  {
    id: 'mix-basics',
    title: 'Mix basics',
    tagline: 'Hear what solo, mute, and effects actually do.',
    steps: [
      {
        id: 'mixer', title: 'Open the Mixer',
        instruction: 'Switch to the Mixer view — every track becomes a channel strip.',
        helpId: 'view-mixer',
        done: s => s.view === 'mixer',
      },
      {
        id: 'solo', title: 'Solo a track',
        instruction: 'Solo one track and notice everything else drop away.',
        helpId: 'solo',
        done: s => s.anySolo,
      },
      {
        id: 'mute', title: 'Mute a track',
        instruction: 'Mute a track and listen to the hole it leaves in the mix.',
        helpId: 'mute',
        done: s => s.anyMute,
      },
      {
        id: 'effect', title: 'Add an effect',
        instruction: 'Put an effect on a track — try an EQ or a Reverb — and hear the difference.',
        helpId: 'add-device',
        done: s => s.anyTrackEffect,
      },
    ],
  },
  {
    id: 'write-melody',
    title: 'Write a melody',
    tagline: 'Draw notes in the piano roll and hear them back.',
    steps: [
      {
        id: 'midi-clip', title: 'Make a MIDI clip',
        instruction: 'Double-click an empty track lane (or hit PIANO ROLL) to create a MIDI clip.',
        helpId: 'piano-roll',
        done: s => s.midiClipCount >= 1,
      },
      {
        id: 'open-roll', title: 'Open the piano roll',
        instruction: 'Open your clip in the piano roll — the grid where you place notes.',
        helpId: 'piano-roll',
        done: s => s.pianoRollOpen,
      },
      {
        id: 'draw-notes', title: 'Draw a few notes',
        instruction: 'Click into the grid to place at least four notes — a short phrase.',
        helpId: 'piano-roll',
        done: s => s.maxClipNotes >= 4,
      },
      {
        id: 'hear-melody', title: 'Play your melody',
        instruction: 'Press Play (or Space) and listen back to what you wrote.',
        helpId: 'play',
        done: s => s.playing && s.maxClipNotes >= 4,
      },
    ],
  },
  {
    id: 'sound-from-code',
    title: 'Design a sound with code',
    tagline: 'Generate a synth voice from a tiny script, then shape it.',
    steps: [
      {
        id: 'code-track', title: 'Generate a synth from code',
        instruction: "Open the Code panel in the left rail, pick a template under 'Add new', and press Add track.",
        helpId: 'sound-code',
        done: s => s.anyPolyTrack,
      },
      {
        id: 'code-hear', title: 'Hear the voice',
        instruction: 'Press Play and listen to the notes your script generated.',
        helpId: 'play',
        done: s => s.anyPolyTrack && s.playing,
      },
      {
        id: 'code-shape', title: 'Shape it with an effect',
        instruction: 'Add a Filter, Reverb, or Delay on the track and hear how it changes the character.',
        helpId: 'add-device',
        done: s => s.anyPolyTrack && s.anyTrackEffect,
      },
    ],
  },
  {
    id: 'shape-the-space',
    title: 'Shape the space',
    tagline: 'Sends and returns — one shared reverb for the whole mix.',
    steps: [
      {
        id: 'add-return', title: 'Add a return track',
        instruction: 'Click +Ret to create a return — a shared effects bus every track can feed.',
        helpId: 'add-return',
        done: s => s.returnCount >= 1,
      },
      {
        id: 'send', title: 'Send a track to it',
        instruction: "In the Mixer, turn up a track's send to your return.",
        done: s => s.anySend,
      },
      {
        id: 'return-fx', title: 'Add reverb on the return',
        instruction: 'Drop a Reverb on the return so every send shares one space — the pro way to add depth.',
        helpId: 'add-device',
        done: s => s.anyReturnEffect,
      },
    ],
  },
]
