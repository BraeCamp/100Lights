// Distinct App Store / Play Store listing copy per app — the single source of truth.
//
// Why this file exists: shipping several sibling music utilities from one publisher
// is exactly what App Review Guideline 4.3 (spam / duplicate apps) flags. The #1
// defense (besides a distinct in-app UI, which each app now has) is a genuinely
// DIFFERENT listing per app — its own subtitle, description, and keywords, written
// in its own voice, with no shared boilerplate and no keyword stuffing.
//
// `scripts/gen-store-metadata.mjs` turns each entry into Fastlane `deliver` metadata
// files (fastlane/metadata/<slug>/en-US/*.txt) so the copy is version-controlled and
// uploadable — never hand-retyped per submission.
//
// Rules baked in here: subtitle ≤ 30 chars, keywords string ≤ 100 chars (comma-
// separated, no spaces wasted, no repeats of the app name), promotional_text ≤ 170.
// Every description foregrounds what's TRUE and specific to that app (on-device,
// no sign-in) — nothing invented.

const SUPPORT = 'https://100lights.com/support'
const MARKETING = (slug) => `https://100lights.com/apps/${slug}`

export const STORE_META = {
  studio: {
    name: '100Lights',
    subtitle: 'Make music on your phone',
    keywords: 'music maker,beat maker,daw,song maker,midi,mixing,loops,synth,drums',
    promotional_text: 'The full touch studio — sketch a beat, lay a melody, mix it, and export. No sign-in to start.',
    description: `100Lights is a full music studio that fits your thumbs. Build a beat on the pad grid, play melodies with real and AI-sampled instruments, arrange your parts, and mix with EQ, reverb, and compression — then export a WAV or MIDI to take anywhere.

Everything runs on-device and you can start making sound without an account. When you sign in, your projects and sounds follow you across devices.

• A real step sequencer and piano roll
• Instruments, drum kits, and effects
• Arrange, mix, and export WAV / MIDI
• Works offline; no sign-in to begin`,
    marketing_url: 'https://100lights.com',
    support_url: SUPPORT,
  },

  firefly: {
    name: 'Firefly',
    subtitle: 'Catch a song idea by voice',
    keywords: 'songwriting,melody,hum to song,voice memo,idea,sketch,music notes,tune',
    promotional_text: 'Hum a melody, tap a beat under it, and open the whole sketch in the studio later. Never lose an idea.',
    description: `Firefly is a voice-first sketchpad for songs. Hum or sing a melody and it becomes playable notes; add a simple beat underneath; then open the whole sketch in the 100Lights studio when you're ready to produce it.

It's the fastest way to catch an idea the moment it arrives — no keyboard, no theory, no account needed.

• Sing or hum → playable notes
• Add a beat and pick an instrument
• Open the sketch in the full studio
• On-device; nothing uploaded`,
    marketing_url: 'https://100lights.com/apps/firefly',
    support_url: SUPPORT,
  },

  beatmaker: {
    name: 'Beat Maker',
    subtitle: 'Drum machine & sequencer',
    keywords: 'drum machine,step sequencer,beat maker,drum pads,groove,midi drums,rhythm',
    promotional_text: 'Tap out a groove on the step grid, play the pads live, expand to more bars, and export MIDI or WAV.',
    description: `A drum machine that gets you from an empty grid to a beat in seconds. Place kick, snare, and hats on the step sequencer, or switch to the pads and tap a groove in live — with Record on, your taps land on the grid, quantized.

Pick a kit to re-voice the whole pattern, expand the sequencer to more bars, duplicate a section to build it out, then export MIDI or a WAV loop for any DAW.

• Step sequencer + playable drum pads
• Live record with quantize
• Expand to multiple bars; duplicate sections
• Export MIDI / WAV; works offline`,
    marketing_url: MARKETING('beatmaker'),
    support_url: SUPPORT,
  },

  voicemidi: {
    name: 'Sing to Instrument',
    subtitle: 'Hum a line, hear a piano',
    keywords: 'hum to midi,pitch to midi,singing,melody maker,vocal to piano,note detect',
    promotional_text: 'Hum a melody and hear it played back on piano, strings, or synth — with a metronome and quantize.',
    description: `Hum or sing a melody and hear it come back on the instrument you choose — piano, strings, synth, and more. The pitch of every note is detected as you go, so a tune in your head becomes real, playable notes without touching a keyboard.

Turn on the metronome to keep time, then quantize your take to snap it to the beat. Your raw take is always kept, so you can toggle quantize off anytime.

• Sing/hum → notes on any instrument
• Live pitch detection, metronome, quantize
• On-device — nothing is recorded to a server`,
    marketing_url: MARKETING('voicemidi'),
    support_url: SUPPORT,
  },

  transcribe: {
    name: 'Audio to MIDI',
    subtitle: 'Turn audio into MIDI',
    keywords: 'audio to midi,transcribe,pitch detection,wav to midi,melody extractor,notes',
    promotional_text: 'Upload a recording or hum a line and get editable MIDI notes you can hear on any instrument.',
    description: `Turn a recording or a hummed line into editable MIDI notes. The pitch detector reads a single melody line — and picks out chords too — then lets you hear the result on any instrument, tidy it up, and export.

It runs entirely on your device: no upload, no sign-in. Export MIDI or WAV, or open the notes in the 100Lights studio to keep building.

• Audio file or live recording → MIDI
• Hear it on any instrument; edit the notes
• Export MIDI / WAV or open in the studio
• On-device pitch detection`,
    marketing_url: MARKETING('transcribe'),
    support_url: SUPPORT,
  },

  sheetmusic: {
    name: 'Hear Sheet Music',
    subtitle: 'Upload a score, hear it',
    keywords: 'sheet music player,scan sheet music,musicxml,score to audio,note reader,pdf',
    promotional_text: 'Turn a photo, PDF, or MusicXML of a score into sound — then open the piece in the studio.',
    description: `Upload a photo, PDF, or MusicXML of sheet music and hear it played. It reads the notes off the page and plays them on any instrument you pick, so you can check how a piece sounds without playing it yourself.

From there, export a WAV or MIDI, or open the piece in the 100Lights studio to arrange it.

• Photo / PDF / MusicXML → playback
• Choose any instrument
• Export WAV / MIDI or open in the studio
• Reads the notes on your device`,
    marketing_url: MARKETING('sheetmusic'),
    support_url: SUPPORT,
  },

  autotune: {
    name: 'Autotune',
    subtitle: 'Snap a vocal to key',
    keywords: 'autotune,pitch correction,vocal tuner,key snap,voice tuner,singing,scale',
    promotional_text: 'Record a vocal, pick a key, and hear it snapped to the nearest note — subtle to hard-tuned.',
    description: `Record or upload a vocal and hear it pitch-corrected to the nearest note in a key you choose. Compare the original with the corrected take, then dial the strength from a gentle touch-up all the way to the hard-tuned effect.

Everything happens in your browser — nothing is recorded to a server. Download the result as a WAV when you like it.

• Record or upload a vocal
• Choose key + scale; adjust strength
• A/B original vs corrected; download WAV
• Runs on-device, no upload`,
    marketing_url: MARKETING('autotune'),
    support_url: SUPPORT,
  },

  captions: {
    name: 'Captions',
    subtitle: 'On-device video captions',
    keywords: 'video captions,subtitles,srt,auto captions,caption maker,transcribe,vtt',
    promotional_text: 'Caption a video from your camera roll on-device — edit, animate, and burn the captions right on.',
    description: `Add clean, animated captions to a video straight from your camera roll — transcribed on your device, so nothing is uploaded and it works offline.

Edit the words, control how they group into lines, and animate specific snippets. Export SRT, VTT, or TXT, or save the finished video with the captions burned right onto it.

• On-device transcription — private, no upload
• Editable words and line grouping
• Per-snippet animations and styles
• Export SRT / VTT / TXT or a captioned video`,
    marketing_url: MARKETING('captions'),
    support_url: SUPPORT,
  },

  musicvideo: {
    name: 'Music Video',
    subtitle: 'Reactive visuals for music',
    keywords: 'music visualizer,audio visualizer,party visuals,reactive video,live visuals',
    promotional_text: 'Put reactive visuals on a video, or turn the room’s music into a live show for a party.',
    description: `Give music a visual. Add a video and its melody becomes a synced overlay — falling notes, flowing shapes, and color you can tune. Or switch to Live mode and let the room's music drive a full-screen show on your TV or projector, great for parties.

It all runs on your device: no upload, no AI. Tweak colors, fonts, and the visual style freely.

• Reactive overlays synced to a video
• Live party visuals from the room's sound
• Full-screen for a TV or projector
• On-device — no upload`,
    marketing_url: MARKETING('musicvideo'),
    support_url: SUPPORT,
  },
}

// Guardrails Apple enforces — the generator checks these so a listing never fails on length.
export const LIMITS = { subtitle: 30, keywords: 100, promotional_text: 170 }
