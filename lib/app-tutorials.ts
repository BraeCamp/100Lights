// Per-app learning paths for the /apps mini-apps. The shared AppChrome reads
// this by slug and renders a step-by-step tutorial ("Learn") sheet — the same
// content can seed an SEO tutorial page later. Pure data, no deps.

export interface TutorialStep {
  /** Short imperative title. */
  title: string
  /** One or two plain sentences. */
  body: string
}

export interface AppTutorial {
  /** One-line "what you'll make" promise shown at the top of the sheet. */
  intro: string
  /** ~3–6 ordered steps. */
  steps: TutorialStep[]
  /** Optional closing tip. */
  tip?: string
}

export const APP_TUTORIALS: Record<string, AppTutorial> = {
  beatmaker: {
    intro: 'Build a looping drum beat from an empty grid in under a minute.',
    steps: [
      { title: 'Pick a kit', body: 'Choose a drum kit up top — it re-voices the whole grid, so you can swap the sound of a groove without redrawing it.' },
      { title: 'Tap the grid', body: 'Each row is a drum, each column a 16th-note step. Click cells to place hits. Try kick on 1 and 3, snare on 2 and 4, hats on every step.' },
      { title: 'Play & feel it', body: 'Hit Play to loop the bar. Add a little swing for a laid-back feel, and set the tempo to taste.' },
      { title: 'Record live (optional)', body: 'Press Record and tap the pads in time — your hits land on the grid, quantized to the step.' },
      { title: 'Save or export', body: 'Save the beat to your history to come back to it, or export MIDI/WAV to drop into any DAW.' },
    ],
    tip: 'Turn on play animations in Settings — every pad lights up as it fires. Set them to Random for a fresh look each session.',
  },
  captions: {
    intro: 'Turn a phone video into a clip with clean, animated, editable captions.',
    steps: [
      { title: 'Add your video', body: 'Drop in a video straight from your camera roll (or audio). Everything transcribes on-device — nothing is uploaded.' },
      { title: 'Let it transcribe', body: 'Words appear with timings. The local model is fast and private; tricky audio can escalate for a cleaner pass.' },
      { title: 'Edit the words', body: 'Fix any misheard words, and drag to regroup how words break across caption lines so each one reads well.' },
      { title: 'Style & animate', body: 'Pick a caption look, then animate specific words or lines — pop, fade, or bounce a snippet to punch a moment.' },
      { title: 'Save or export', body: 'Save the captioned video to your device, export SRT/VTT/TXT, or send it to the video editor. Members can sync it online too.' },
    ],
    tip: 'Short, 2–4 word caption groups read best on phones — regroup long lines so nothing gets cut off.',
  },
  musicvideo: {
    intro: 'Give any track a synced visual — falling notes, shapes, and color that move to the music.',
    steps: [
      { title: 'Choose your source', body: 'Add a video to overlay visuals onto, generate pure visuals for a track, or turn on Live mode to visualize whatever is playing on the device.' },
      { title: 'Pick a visual', body: 'Choose a style — falling notes, flowing shapes, radial bursts — then set colors and fonts to match the vibe.' },
      { title: 'Sync it up', body: 'The melody drives the motion. In Live mode, nudge the lag slider if you are streaming to a TV or projector over Bluetooth so visuals line up with the sound.' },
      { title: 'Play or export', body: 'Run it full-screen for a party, or export the rendered video to share.' },
    ],
    tip: 'Live mode is great for parties — point it at a big screen, start your playlist, and let the room react.',
  },
  firefly: {
    intro: 'Catch a song idea by voice and finish it in the full studio later.',
    steps: [
      { title: 'Hum a melody', body: 'Tap Record and sing or hum a line. Firefly detects each note and turns it into playable pitches.' },
      { title: 'Add a beat', body: 'Switch to the beat tab and tap out a simple groove underneath your melody.' },
      { title: 'Shape the sound', body: 'Pick an instrument for your voice line and balance the levels between melody and beat.' },
      { title: 'Open in the studio', body: 'When the idea feels right, open the whole sketch in the 100Lights studio to produce it properly.' },
    ],
    tip: 'Save sketches to your history so a half-formed idea is waiting for you next time.',
  },
  sheetmusic: {
    intro: 'Hear a printed score played back, then take it into the studio.',
    steps: [
      { title: 'Upload a score', body: 'Add a photo, PDF, or MusicXML of sheet music. It reads the notes off the page.' },
      { title: 'Choose an instrument', body: 'Pick any instrument to play the piece back on and press play to hear it.' },
      { title: 'Open or export', body: 'Open the piece in the studio to arrange it, or export it as WAV or MIDI.' },
    ],
  },
  transcribe: {
    intro: 'Turn a recorded or uploaded melody into editable MIDI notes.',
    steps: [
      { title: 'Add audio', body: 'Record a line or upload an audio file with a clear single melody.' },
      { title: 'Detect the notes', body: 'The pitch detector converts it to MIDI notes — it handles a melody line and can pick out chords too.' },
      { title: 'Hear & refine', body: 'Play the notes back on any instrument and tidy up anything the detector missed.' },
      { title: 'Open or export', body: 'Open in the studio or export WAV/MIDI.' },
    ],
  },
  voicemidi: {
    intro: 'Sing or hum a line and hear it played back on any instrument.',
    steps: [
      { title: 'Record your voice', body: 'Tap Record and hum a melody — no keyboard needed.' },
      { title: 'Pick an instrument', body: 'Choose an instrument preset to replay your melody on.' },
      { title: 'Play it back', body: 'Hear your hummed idea become real notes, then keep the ones you like.' },
    ],
  },
  autotune: {
    intro: 'Snap a vocal to the nearest note in a chosen key.',
    steps: [
      { title: 'Add a vocal', body: 'Record or upload a vocal take.' },
      { title: 'Set the key', body: 'Choose the scale to tune to — the notes outside it get pulled in.' },
      { title: 'Dial the amount', body: 'Go from gentle correction to the hard-snap effect, and preview as you tune.' },
    ],
  },
}

export const tutorialFor = (slug?: string): AppTutorial | undefined =>
  slug ? APP_TUTORIALS[slug] : undefined
