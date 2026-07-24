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
  {
    slug: 'code',
    title: 'Generate a Track from Code',
    description: 'Use the Code panel in the 100Lights studio to generate a synth track from a few lines of math — scales, chords, euclidean rhythms, seeded randomness.',
    tagline: 'A few lines of math become a playable synth track.',
    steps: [
      { text: 'Open the Code panel (the </> icon). Write a short script that returns a synth patch and a list of notes — scales, chords, and euclidean rhythms are built in.', helpId: 'sound-code' },
      { text: 'Run it and it drops in as a poly-synth track you can play and edit like any other. Or select a clip to load its patch and notes back as editable code.' },
    ],
  },
  {
    slug: 'jam',
    title: 'Never Lose a Take: Jam Capture',
    description: 'Jam Capture in the 100Lights studio keeps the last 30 seconds of everything you play, so a great unrecorded take is never lost.',
    tagline: 'Grab the last 30 seconds you played — even without recording.',
    steps: [
      { text: 'Everything you play while the transport runs is held in a rolling 30-second buffer, even when you are not recording.', helpId: 'jam' },
      { text: 'Played something great you did not capture? Hit JAM and those last seconds drop straight into the arrangement as a clip.' },
    ],
  },
  {
    slug: 'record-session',
    title: 'Record Your Screen and Studio Audio',
    description: 'Record your screen with the studio’s own audio (and optionally your mic) in 100Lights — clean, with no notifications or other tabs in the take.',
    tagline: 'Screen + studio audio, straight from the mixer.',
    steps: [
      { text: 'Open Capture to record your screen together with the studio’s audio, taken from the mixer — so notifications and other tabs never end up in the take. (It grabs annotated screenshots too.)', helpId: 'capture' },
      { text: 'Optionally record your mic too, to talk over what you’re doing. Preview it and save the video when you stop — great for demos and tutorials.' },
    ],
  },
  {
    slug: 'tuner',
    title: 'Tune Your Sounds',
    description: 'Open the tuner in the 100Lights studio to check and adjust the pitch of pads and instruments so everything agrees on one reference.',
    tagline: 'Check pitch so every layer agrees.',
    steps: [
      { text: 'Open the tuner to check and nudge the pitch of pads and instruments, so all your sounds reference the same tuning.', helpId: 'tuner' },
      { text: 'Handy when layering a sampled sound against synths — small tuning differences are what make a stack sound cheap.' },
    ],
  },
  {
    slug: 'time-signature',
    title: 'Change the Time Signature',
    description: 'Set the project’s time signature in the 100Lights studio — the ruler, grid, metronome, and bar numbering all follow the meter you choose.',
    tagline: 'Work in 3/4, 5/4, or 7/8 — not just 4/4.',
    steps: [
      { text: 'Click the time signature to change the project’s meter. The ruler, snap grid, metronome, and bar numbering all follow it.', helpId: 'time-sig' },
      { text: 'Most music is in four, but a waltz is in three and plenty of interesting music lives in five or seven — switch it here and the whole grid re-counts.' },
    ],
  },
  {
    slug: 'navigate',
    title: 'Zoom and Fit the Timeline',
    description: 'Zoom in for detailed edits and fit the whole arrangement to the window in the 100Lights studio.',
    tagline: 'Get in close, then see the whole song.',
    steps: [
      { text: 'Zoom in for fine, detailed edits — your position stays anchored as you zoom.', helpId: 'zoom-in' },
      { text: 'Zoom out for a bird’s-eye view of the whole arrangement.', helpId: 'zoom-out' },
      { text: 'Or hit Fit to Window (also the F key) to instantly scale the entire song to the visible area.', helpId: 'fit-window' },
    ],
  },
  {
    slug: 'snap',
    title: 'Snap to the Grid, and Ripple Edits',
    description: 'Control the grid clips snap to in the 100Lights studio, and use ripple editing to keep everything after an edit glued together.',
    tagline: 'Choose the grid — and keep edits from leaving gaps.',
    steps: [
      { text: 'Choose the grid clips snap to while dragging — off, 1/16, 1/8, beat, or bar. Hold Alt mid-drag to bypass the grid entirely.', helpId: 'snap' },
      { text: 'Turn on Ripple and moving or trimming a clip shifts everything to its right by the same amount — so an edit never leaves a hole.', helpId: 'ripple' },
    ],
  },
  {
    slug: 'masking',
    title: 'Spot Frequency Clashes',
    description: 'The masking detector in the 100Lights studio shows which tracks compete for the same frequencies, so you can EQ or pan them apart.',
    tagline: 'See which tracks fight for the same frequencies.',
    steps: [
      { text: 'Run the masking detector and it analyzes your mix, showing which tracks are competing for the same frequency bands.', helpId: 'masking' },
      { text: 'Then EQ or pan the clashing tracks apart for a cleaner result — the fast way to find what’s making a mix muddy.' },
    ],
  },
  {
    slug: 'varispeed',
    title: 'Slow Down with Varispeed',
    description: 'Tape-style speed control in the 100Lights studio — pitch rises and falls with playback speed, exactly like a reel-to-reel.',
    tagline: 'Tape-style speed — the pitch moves with it.',
    steps: [
      { text: 'Varispeed is tape-style speed control from a quarter-speed crawl to double time — pitch rises and falls with the speed, exactly like slowing a reel-to-reel.', helpId: 'varispeed' },
      { text: 'Great for learning a fast part slowly, or for the deliberately dragged, detuned sound of a slowed-down sample.' },
    ],
  },
  {
    slug: 'piano-roll',
    title: 'Write Notes in the Piano Roll',
    description: 'Open the piano roll in the 100Lights studio to draw, move, and resize MIDI notes on a grid, with your project’s key highlighted.',
    tagline: 'Draw a melody without touching a keyboard.',
    steps: [
      { text: 'Select a melodic clip and click EDITOR to open it in the piano roll (a drum clip opens the step sequencer instead).', helpId: 'editor' },
      { text: 'Draw notes with the mouse, drag to move or resize them, and the notes in your project’s key are highlighted — so a wrong one is hard to hit.' },
      { text: 'Everything you record from the pads or a MIDI keyboard lands here too, ready to fix up by hand.' },
    ],
  },
  {
    slug: 'automation',
    title: 'Automate a Parameter Over Time',
    description: 'Add automation lanes in the 100Lights studio to change volume, pan, filter, and more over time, drawn as editable curves under a track.',
    tagline: 'Draw volume rides, filter sweeps, and pan moves.',
    steps: [
      { text: 'Add an automation lane to a track to change a parameter over time — a volume ride, a pan sweep, a slow filter open — drawn as an editable curve right under the clips.', helpId: 'automation' },
      { text: 'This is what turns a static loop into a song: bring an element in, sweep a filter across a build, duck a pad under a vocal.' },
    ],
  },
  {
    slug: 'session',
    title: 'Jam with Scenes in Session View',
    description: 'Session view in the 100Lights studio is a grid of clips you launch scene by scene, then capture straight into the arrangement timeline.',
    tagline: 'Launch clips live, then capture the jam.',
    steps: [
      { text: 'Session view is a grid of clips. Add a scene — a row that launches together as one unit — and build your idea up scene by scene.', helpId: 'add-scene' },
      { text: 'Perform by launching scenes, and Capture to Arrangement stamps what you play straight onto the timeline — turning a live jam into a structured song.', helpId: 'capture-arrangement' },
    ],
  },
  {
    slug: 'instrument',
    title: 'Pick a Synth or Drum Kit',
    description: 'Choose the instrument a MIDI track plays in the 100Lights studio — a synth, drum kit, or sampler — and browse presets with instant preview.',
    tagline: 'Choose what a track plays, and audition presets.',
    steps: [
      { text: 'Open a track’s devices, switch to the Instrument tab, and choose the synth, drum kit, or sampler it plays.', helpId: 'bottom-instrument' },
      { text: 'Browse presets with an instant middle-C preview before you commit, then play it live from the pads, your computer keyboard, or a MIDI controller.' },
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
