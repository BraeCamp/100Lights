// Registry of the standalone "Mini-Apps" — the small, focused tools that live at
// /apps/<slug> alongside the full studio. Single source of truth: the admin
// Apps → Mini-Apps inventory reads this, a future public launcher will read it,
// and the sound-target `app_slug` keys point back at these slugs.
//
// Pure and dependency-free so it can be imported from anywhere (client panels,
// server routes, and — via the export bridge — the Node pipeline).

export type MiniAppStatus = 'live' | 'beta'

export interface MiniApp {
  slug: string
  /** Display name. */
  title: string
  /** One-line hook under the title. */
  tagline: string
  /** Longer description of what the app does. */
  description: string
  /** Where the app lives. Always `/apps/<slug>`. */
  href: string
  /** Ship state — omit for live. */
  status?: MiniAppStatus
}

export const MINI_APPS: MiniApp[] = [
  {
    slug: 'firefly',
    title: 'Firefly',
    tagline: 'Sketch a song with your voice, finish it in the studio.',
    description: 'A voice-first sketchpad: hum a melody into playable notes, add a beat underneath, then open the whole sketch in the 100Lights studio to produce it. Catch the idea now, finish later.',
    href: '/apps/firefly',
    status: 'live',
  },
  {
    slug: 'sheetmusic',
    title: 'Hear Sheet Music',
    tagline: 'Upload a score; hear it played back.',
    description: 'Turn a photo, PDF, or MusicXML of sheet music into sound — it reads the notes and plays them on any instrument, then lets you open the piece in the studio or export WAV/MIDI.',
    href: '/apps/sheetmusic',
    status: 'live',
  },
  {
    slug: 'musicvideo',
    title: 'Music Video',
    tagline: 'Turn a video into a music visual.',
    description: 'Upload a video and its melody becomes a visual overlay synced to playback — falling notes, flowing shapes, colors, and fonts. Melody detection is AI-light; tweaking the visuals is free.',
    href: '/apps/musicvideo',
    status: 'beta',
  },
  {
    slug: 'transcribe',
    title: 'Audio to MIDI',
    tagline: 'Turn audio into editable MIDI notes.',
    description: 'Upload an audio file or record a melody line and the pitch detector turns it into MIDI notes — hear them on any instrument, then open in the studio or export WAV/MIDI. Handles a single melody line, and detects chords too.',
    href: '/apps/transcribe',
    status: 'live',
  },
  {
    slug: 'captions',
    title: 'Captions',
    tagline: 'Speech → timed captions for your videos.',
    description: 'Drop in audio or a video and get timed captions on-device (free, private, no upload). Edit the words, export SRT/VTT/TXT, or send them straight to the video editor to caption your clip. The local-first Whisper hybrid keeps it cheap; hard audio can escalate in the editor.',
    href: '/apps/captions',
    status: 'beta',
  },
  {
    slug: 'voicemidi',
    title: 'Voice → Instrument',
    tagline: 'Hum or sing a line; hear it played back on any instrument.',
    description: 'Records your voice, detects the pitch of every note, and replays the melody on a chosen instrument preset — turning a hummed idea into playable notes with no keyboard.',
    href: '/apps/voicemidi',
    status: 'live',
  },
  {
    slug: 'beatmaker',
    title: 'Beat Maker',
    tagline: 'Tap out a drum pattern in seconds.',
    description: 'A tiny step sequencer — place kick, snare, hats and more on the grid, pick a kit, and loop it. The fastest path from an empty page to a beat.',
    href: '/apps/beatmaker',
    status: 'live',
  },
  {
    slug: 'autotune',
    title: 'Autotune',
    tagline: 'Snap a vocal to the nearest note in key.',
    description: 'Pitch-corrects a recorded or uploaded vocal to a chosen scale, from gentle tuning to the hard-snap effect — a focused take on the studio pitch tools.',
    href: '/apps/autotune',
    status: 'beta',
  },
]

/** Look up a mini-app by its slug. */
export const bySlug = (slug: string): MiniApp | undefined =>
  MINI_APPS.find(a => a.slug === slug)
