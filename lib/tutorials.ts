// Feature tutorials — the single source of truth for /tutorial/[slug].
//
// Each tutorial's steps drive THREE things so they can never drift apart:
//   1. the illustrated page (app/tutorial/[slug]/page.tsx) — text + a generated
//      red-circled screenshot per step (public/tutorial/<slug>/<n>.png),
//   2. the live "Do it in the studio" mode (components/editor/StudioGuide.tsx) —
//      which glows each step's control via the Help system, and
//   3. the capture script (scripts/capture-tutorials.mjs) — which knows, from a
//      step's helpId, which control to photograph.
//
// A step's `helpId` is a data-help-id present in the editor (see the registry in
// components/editor/daw/HelpButton.tsx). Steps without a helpId are text-only
// (no screenshot, no glow). To add a tutorial: add an entry here, add a driver
// for its slug in scripts/capture-tutorials.mjs, then `npm run capture-tutorials`.

export interface TutorialStep {
  text: string
  /** data-help-id of the control this step points at. Omit for a text-only step. */
  helpId?: string
}

export interface Tutorial {
  slug: string
  title: string
  description: string
  /** One-line summary — index card + page subtitle. */
  tagline: string
  steps: TutorialStep[]
}

export const TUTORIALS: Tutorial[] = [
  {
    slug: 'fx',
    title: 'Add and Use an Effect',
    description: 'Add an effect to a track in the 100Lights studio, then use Bypass to hear it on versus off — the fastest way to learn what any effect actually does.',
    tagline: 'Put an effect on a track and A/B it by ear.',
    steps: [
      { text: 'Add a track to hold your sound. Every effect lives on a track, so you need one first.', helpId: 'add-track' },
      { text: "Open that track's devices with its gear (⚙) button. This is where effects stack up in a chain.", helpId: 'track-settings' },
      { text: 'Add an effect to the chain, and pick one — try an EQ, a reverb, or a compressor.', helpId: 'add-device' },
      { text: 'Now play the track and toggle the effect’s Bypass on and off. That instant before-and-after is how you learn what an effect really does — the same blind-test idea, on your own sound.' },
    ],
  },
  {
    slug: 'transport',
    title: 'Play, Loop, and Move Around',
    description: 'Control playback in the 100Lights studio — start and stop, loop a section to work on it, and jump back to the top.',
    tagline: 'Start, stop, loop a section, and navigate your project.',
    steps: [
      { text: 'Press Play to start from the playhead — or just hit the spacebar from anywhere. Play again (or Space) to stop.', helpId: 'play' },
      { text: 'Turn on Loop to repeat a section over and over while you tweak sounds and levels underneath it.', helpId: 'loop' },
      { text: 'Jump the playhead straight back to the start of the project with Rewind — or press the Home key.', helpId: 'rewind' },
    ],
  },
  {
    slug: 'tempo',
    title: 'Set Your Tempo',
    description: 'Set the project tempo in the 100Lights studio — type an exact BPM or tap it in — and turn on the metronome.',
    tagline: 'Dial in the BPM, tap a tempo, and toggle the click.',
    steps: [
      { text: 'Click the BPM readout and type an exact tempo. The grid, the metronome, and playback all follow it.', helpId: 'bpm' },
      { text: 'Not sure of the tempo? Hit TAP along to a track and 100Lights measures the BPM from the timing of your taps.' },
      { text: 'Toggle the Metronome to hear a click on every beat while you play or record. Press M to flip it from anywhere.', helpId: 'metronome' },
    ],
  },
  {
    slug: 'views',
    title: 'Session, Arrangement, and Mixer Views',
    description: 'The three ways to see a project in the 100Lights studio — a clip grid for jamming, a timeline for building, and a mixer for balancing.',
    tagline: 'The three views, and when to use each.',
    steps: [
      { text: 'Session view is a grid of clips you launch scene by scene — great for sketching ideas and jamming before you commit anything.', helpId: 'view-session' },
      { text: 'Arrangement view is the timeline where clips sit on tracks against bars and beats — where you build the actual song.', helpId: 'view-arrangement' },
      { text: 'Mixer view gives every track a fader, pan, mute/solo, and meters — the place to balance the whole mix in one screen.', helpId: 'view-mixer' },
    ],
  },
  {
    slug: 'sounds',
    title: 'Find and Add Sounds',
    description: 'Browse the built-in sound library in the 100Lights studio and drop sounds straight onto your tracks.',
    tagline: 'Browse the library and drop sounds onto tracks.',
    steps: [
      { text: 'Open the Sound Library (or press B) to browse thousands of built-in sounds, organized into folders.', helpId: 'sound-library' },
      { text: 'Drag any sound straight onto a track in the arrangement and it drops in as a clip. Save your own captures back into the library too.' },
    ],
  },
  {
    slug: 'export',
    title: 'Export Your Finished Track',
    description: 'Render a project to an audio file in the 100Lights studio — a lossless WAV to master, or a compact file to share.',
    tagline: 'Render your project to an audio file.',
    steps: [
      { text: 'Click Export to render your project to audio — a lossless WAV for mastering and distribution, or a compact file for quick web sharing.', helpId: 'export' },
      { text: 'Exporting asks you to make a free account first, so the render is saved to your projects and nothing gets lost.' },
    ],
  },
  {
    slug: 'swing',
    title: 'Give Your Beat Some Swing',
    description: 'Use the global swing control in the 100Lights studio to loosen up rigid, quantized timing into a human groove.',
    tagline: 'Turn stiff, on-the-grid timing into a groove.',
    steps: [
      { text: 'Drag the Swing control to the right to push every off-beat slightly later — turning a stiff, on-the-grid pattern into a shuffling groove. Drag left for straight timing.', helpId: 'swing' },
      { text: 'A little goes a long way: most grooves live between a subtle nudge and a full triplet shuffle. Trust your ears over the number.' },
    ],
  },
  {
    slug: 'tracks',
    title: 'Arm, Mute, and Solo a Track',
    description: 'The per-track controls in the 100Lights studio — record-enable, mute, solo, and the gear that opens a track’s devices.',
    tagline: 'The per-track controls: record-enable, silence, isolate.',
    steps: [
      { text: 'Each track header has an arm (record-enable) button. Armed tracks capture audio when you hit record — and several tracks can record at once.', helpId: 'arm' },
      { text: 'M mutes a track, silencing just it. Press it again to bring it back.', helpId: 'mute' },
      { text: 'S solos a track — silencing everything else so you can hear that part in context. Solo several at once to audition a group.', helpId: 'solo' },
      { text: 'The gear (⚙) opens the track’s devices and instrument in the panel below; right-click the header for rename, color, freeze, and more.', helpId: 'track-settings' },
    ],
  },
  {
    slug: 'returns',
    title: 'Add a Reverb Send (Return Track)',
    description: 'Add a return track in the 100Lights studio so one shared reverb or delay serves every channel — the clean way to add space to a mix.',
    tagline: 'One shared effect any track can send to.',
    steps: [
      { text: 'Add a return track with +Ret. Put a reverb or delay on it once, and any track can send signal to it — instead of loading the same effect on every channel.', helpId: 'add-return' },
      { text: 'Then each track’s send sets how much of it goes to the return. That’s how you give a whole mix one cohesive space without muddying it.' },
    ],
  },
  {
    slug: 'key-scale',
    title: 'Set the Key and Scale',
    description: 'Set the project key and scale in the 100Lights studio so instruments, pads, and pitch tools all stay in tune together.',
    tagline: 'Lock the project to a key so everything stays in tune.',
    steps: [
      { text: 'Set the project’s root note and scale here. Instruments, pads, and the pitch tools all reference it, so what you play and program stays in key together.', helpId: 'key-scale' },
      { text: 'Working in A minor? Set it once and the piano roll highlights the in-key notes, so wrong notes are much harder to hit by accident.' },
    ],
  },
]

export function getTutorial(slug: string): Tutorial | undefined {
  return TUTORIALS.find(t => t.slug === slug)
}

/** Public path of a step's generated screenshot (1-based file naming). */
export function stepImagePath(slug: string, stepIndex: number): string {
  return `/tutorial/${slug}/${stepIndex + 1}.png`
}
