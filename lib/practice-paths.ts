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
]
