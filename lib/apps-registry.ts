// Registry of the standalone apps — the focused tools that live at /<slug> as
// first-class citizens of the site. Single source of truth: the admin
// Apps inventory reads this, lib/lights-registry.ts composes it into the
// site-wide constellation (launcher, ⌘K, sitemap, proxy, redirects), and the
// sound-target `app_slug` keys point back at these slugs.
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
  /** Where the app lives. Top-level: `/<slug>`. */
  href: string
  /** Ship state — omit for live. */
  status?: MiniAppStatus
  /** Emoji glyph for the launcher / ⌘K rows. */
  icon?: string
  /** Accent color for cards and chips. */
  color?: string
  /** Keep out of the sitemap + mark noindex (pre-launch apps). */
  noindex?: boolean
}

export const MINI_APPS: MiniApp[] = [
  {
    slug: 'firefly',
    title: 'Firefly',
    tagline: 'Sketch a song with your voice, finish it in the studio.',
    description: 'A voice-first sketchpad: hum a melody into playable notes, add a beat underneath, then open the whole sketch in the 100Lights studio to produce it. Catch the idea now, finish later.',
    href: '/firefly',
    icon: '🪰',
    color: '#facc15',
    status: 'live',
  },
  {
    slug: 'sheetmusic',
    title: 'Hear Sheet Music',
    tagline: 'Upload a score; hear it played back.',
    description: 'Turn a photo, PDF, or MusicXML of sheet music into sound — it reads the notes and plays them on any instrument, then lets you open the piece in the studio or export WAV/MIDI.',
    href: '/sheetmusic',
    icon: '🎼',
    color: '#38bdf8',
    status: 'live',
  },
  {
    slug: 'lightningbug',
    title: 'Lightning Bug',
    tagline: 'Light up your music with live visuals.',
    description: 'Turn any track into a glowing live visual — reactive bars and radial glow, artsy video backgrounds, cinematic look modes, and auto-shuffling scenes. Full-screen it for a party, or lay visuals over your own video. Runs on your device.',
    href: '/lightningbug',
    icon: '✨',
    color: '#a78bfa',
    status: 'beta',
  },
  {
    slug: 'transcribe',
    title: 'Audio to MIDI',
    tagline: 'Turn audio into editable MIDI notes.',
    description: 'Upload an audio file or record a melody line and the pitch detector turns it into MIDI notes — hear them on any instrument, then open in the studio or export WAV/MIDI. Handles a single melody line, and detects chords too.',
    href: '/transcribe',
    icon: '🎙️',
    color: '#34d399',
    status: 'live',
  },
  {
    slug: 'captions',
    title: 'Captions',
    tagline: 'Speech → timed captions for your videos.',
    description: 'Drop in audio or a video and get timed captions on-device (free, private, no upload). Edit the words, export SRT/VTT/TXT, or send them straight to the video editor to caption your clip. The local-first Whisper hybrid keeps it cheap; hard audio can escalate in the editor.',
    href: '/captions',
    icon: '💬',
    color: '#f472b6',
    status: 'beta',
  },
  {
    slug: 'voicemidi',
    title: 'Voice → Instrument',
    tagline: 'Hum or sing a line; hear it played back on any instrument.',
    description: 'Records your voice, detects the pitch of every note, and replays the melody on a chosen instrument preset — turning a hummed idea into playable notes with no keyboard.',
    href: '/voicemidi',
    icon: '🎤',
    color: '#fb923c',
    status: 'live',
  },
  {
    slug: 'beatmaker',
    title: 'Beat Maker',
    tagline: 'Tap out a drum pattern in seconds.',
    description: 'A tiny step sequencer — place kick, snare, hats and more on the grid, pick a kit, and loop it. The fastest path from an empty page to a beat.',
    href: '/beatmaker',
    icon: '🥁',
    color: '#f87171',
    status: 'live',
  },
  {
    slug: 'autotune',
    title: 'Autotune',
    tagline: 'Snap a vocal to the nearest note in key.',
    description: 'Pitch-corrects a recorded or uploaded vocal to a chosen scale, from gentle tuning to the hard-snap effect — a focused take on the studio pitch tools.',
    href: '/autotune',
    icon: '🎯',
    color: '#22d3ee',
    status: 'beta',
  },
  {
    slug: 'apollo',
    title: 'Apollo',
    tagline: 'A full hybrid synthesizer — design any sound.',
    description: 'A professional wavetable / sample / granular / spectral synthesizer in the browser: dual filters, deep modulation, a full effects rack, and an arp — and it doubles as an instrument inside the studio.',
    href: '/apollo',
    status: 'beta',
    icon: '☀️',
    color: '#f59e0b',
    noindex: true,
  },
]

/** Look up a mini-app by its slug. */
export const bySlug = (slug: string): MiniApp | undefined =>
  MINI_APPS.find(a => a.slug === slug)
