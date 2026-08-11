// Interactive guided tours for the /apps mini-apps. Instead of a static "how-to"
// sheet, the shell (AppChrome) spotlights a real element on screen and coaches the
// user through the basics one step at a time — auto-playing the first time an app
// opens. Steps point at elements by a `data-tour="<key>"` attribute the app puts on
// the thing being highlighted; a step with no target shows a centered message.
//
// This is intentionally simple data so tours are quick to edit and reorder as the
// apps change. Add a slug's steps here + `data-tour` keys in that app's component.

export interface TourStep {
  /** data-tour key of the element to spotlight. Omit for a centered message. */
  target?: string
  /** Optional bold lead-in. */
  title?: string
  /** The coaching line shown at the bottom of the screen. */
  body: string
}

export const APP_TOURS: Record<string, TourStep[]> = {
  beatmaker: [
    { body: 'Welcome to Beat Maker — let’s build a beat in a few taps.' },
    { target: 'play', body: 'This plays your beat on a loop. Try Play to start your beat.' },
    { target: 'grid', body: 'Each row is a drum and each column is a step in the bar. Tap the squares to add or remove hits.' },
    { target: 'bpm', body: 'BPM is the tempo the beat plays at — higher is faster. Try changing it now.' },
    { target: 'kit', body: 'A kit changes the sound of every drum at once. Pick one you like.' },
    { target: 'pads-tab', body: 'The Pads tab lets you tap the drums live — arm Record and your taps become a sequence here.' },
    { target: 'bars', body: 'Need a longer beat? Add bars here, then duplicate a section to build it out.' },
    { target: 'save', body: 'When it sounds good, Save it — your beats wait for you in History. That’s the basics!' },
  ],
}

APP_TOURS.voicemidi = [
  { body: 'Sing or hum a melody and hear it played back on any instrument — here’s the gist.' },
  { target: 'record', body: 'Tap Record and hum a tune. Your singing stays silent so you can focus; the detected note shows as you go.' },
  { target: 'instrument', body: 'Pick the instrument your melody plays back on.' },
  { body: 'Then Play to hear your take, turn on the metronome to keep time, and Quantize to snap it to the beat.' },
]

APP_TOURS.autotune = [
  { body: 'Snap a vocal to the nearest note in a key — a quick tour.' },
  { target: 'record', body: 'Record a take or upload a vocal here.' },
  { target: 'key', body: 'Set the key and scale your part is in — notes outside it get pulled to the nearest one.' },
  { body: 'Then dial Strength from a subtle touch-up to the hard-tuned effect, A/B original vs corrected, and download a WAV.' },
]

APP_TOURS.transcribe = [
  { body: 'Turn audio into editable MIDI notes — here’s how.' },
  { target: 'record', body: 'Upload an audio file or record a melody line here.' },
  { body: 'The pitch detector turns it into MIDI notes you can hear on any instrument, then export MIDI/WAV or open in the studio.' },
]

APP_TOURS.sheetmusic = [
  { body: 'Hear a printed score played back — a quick tour.' },
  { target: 'upload', body: 'Upload a photo, PDF, or MusicXML of the sheet music here.' },
  { body: 'It reads the notes; pick any instrument and press play, then export WAV/MIDI or open the piece in the studio.' },
]

APP_TOURS.captions = [
  { body: 'Caption a video with clean, editable, animated text — here’s the flow.' },
  { target: 'upload', body: 'Add a video (or audio) straight from your device here — everything stays on-device.' },
  { target: 'transcribe', body: 'Hit Transcribe and the words appear with timings.' },
  { body: 'Edit the words, regroup lines, animate snippets in Subtitle style, then Save video to burn them onto the clip.' },
]

export const tourFor = (slug?: string): TourStep[] | null =>
  (slug && APP_TOURS[slug]) || null
