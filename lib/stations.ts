// Broadcast "stations" — themed radio-with-visuals presets for the 24/7 streaming mode
// (/apps/lightningbug?station=<slug>&broadcast=1). Each = a visual scene + a way to get its audio.
// See STREAMING.md for how this drives YouTube/Twitch. Pure data + types (no React), so the
// server playlist route and the client both import it.

export interface BroadcastTrack {
  title: string
  artist?: string
  /** Audio URL. Same-origin ("/broadcast/<slug>/<file>") plays directly; remote (http…) is
   *  streamed through /api/broadcast/audio so Web Audio can analyse it (CORS-safe). */
  url: string
  license?: string        // e.g. "CC BY 3.0", "Jamendo commercial", "Pixabay Content License"
  attribution?: string    // shown in the now-playing overlay; also put this in the video description
}

// Visual look for a station — a light subset of the full scene; everything else stays at defaults.
// String/array types (not the component's internal enums) so this file stays React-free.
export interface StationScene {
  style?: string                 // none | bars | area | rings | dots | radial | wave
  paletteId?: string             // a colour palette id (e.g. 'aurora', 'ember', 'noir')
  videoMode?: string             // full-frame mode (e.g. 'none', 'ink', 'living')
  videoLook?: string             // grade (e.g. 'none', 'noir', 'warm', 'dream')
  videoSet?: string[]            // background categories to draw from ([] = all)
  brightnessSet?: ('bright' | 'mid' | 'dark')[]   // e.g. ['dark'] for a dark-room stream
  speedSet?: ('fast' | 'standard' | 'slow')[]     // e.g. ['slow'] for calm motion
  matchEnergy?: boolean
  reactive?: boolean
}

export interface Station {
  slug: string
  title: string
  tagline: string
  scene: StationScene
  /** Static playlist, if you want to hard-code tracks. Usually leave empty and either drop files
   *  in public/broadcast/<slug>/ or set `jamendo` tags. */
  tracks?: BroadcastTrack[]
  /** Dynamic playlist from the Jamendo API (needs JAMENDO_CLIENT_ID). Great for endless variety;
   *  for legally-clean monetized broadcast, buy a Jamendo commercial radio licence. */
  jamendo?: { tags: string; order?: string; limit?: number }
  shuffle?: boolean
  showNowPlaying?: boolean
}

// Kevin MacLeod (incompetech.com) — CC BY 3.0. We control the playlist, so the credit is stored
// per track (no recognition/AudD needed — that's only for unknown audio). Streams through the
// broadcast audio proxy (incompetech is allow-listed). Put the full credit in the video description.
const km = (title: string): BroadcastTrack => ({
  title,
  artist: 'Kevin MacLeod',
  url: `https://incompetech.com/music/royalty-free/mp3-royaltyfree/${encodeURIComponent(title)}.mp3`,
  license: 'CC BY 3.0',
  attribution: `“${title}” by Kevin MacLeod (incompetech.com) · CC BY 3.0`,
})

export const STATIONS: Station[] = [
  {
    slug: 'cinematic',
    title: 'Cinematic — Epic & Orchestral Radio',
    tagline: 'Sweeping, dramatic instrumentals — royalty-free (Kevin MacLeod, CC BY).',
    scene: { style: 'none', videoMode: 'none', videoLook: 'noir', videoSet: ['Abstract', 'Film', 'Aerial'], brightnessSet: ['dark', 'mid'], speedSet: ['slow', 'standard'], matchEnergy: true, reactive: true },
    tracks: ['Prelude and Action', 'The Descent', 'Impact Prelude', 'At Rest', 'Anguish', 'Killers', 'Crossing the Chasm', 'Ossuary 1 - A Beginning', 'Volatile Reaction', 'Despair and Triumph', 'Hitman', 'Echoes of Time', 'Heavy Interlude'].map(km),
    shuffle: true,
    showNowPlaying: true,
  },
  {
    slug: 'dnd-tavern',
    title: 'D&D Tavern — Ambience Radio',
    tagline: 'Warm firelit tavern: lute, hearth, and low murmur.',
    scene: { style: 'none', videoLook: 'warm', videoSet: ['Cozy', 'Film'], brightnessSet: ['dark', 'mid'], speedSet: ['slow'], matchEnergy: false, reactive: true },
    jamendo: { tags: 'medieval+folk+acoustic', order: 'popularity_total', limit: 40 },
    shuffle: true,
    showNowPlaying: true,
  },
  {
    slug: 'dnd-dungeon',
    title: 'D&D Dungeon — Dark Ambience',
    tagline: 'Tense exploration: drones, drips, and distant echoes.',
    scene: { style: 'none', videoMode: 'ink', videoSet: ['Abstract', 'Neon', 'Night'], brightnessSet: ['dark'], speedSet: ['slow'], matchEnergy: false, reactive: true },
    jamendo: { tags: 'dark+ambient+cinematic', order: 'popularity_total', limit: 40 },
    shuffle: true,
    showNowPlaying: true,
  },
  {
    slug: 'study-lofi',
    title: 'Study / Focus — Lofi Radio',
    tagline: 'Lo-fi beats to study and chill to, with soft visuals.',
    scene: { style: 'dots', paletteId: 'aurora', videoLook: 'dream', videoSet: ['Cozy', 'Abstract'], brightnessSet: ['dark', 'mid'], speedSet: ['slow', 'standard'], matchEnergy: true, reactive: true },
    jamendo: { tags: 'lofi+chillhop+instrumental', order: 'popularity_total', limit: 50 },
    shuffle: true,
    showNowPlaying: true,
  },
  {
    slug: 'deep-focus',
    title: 'Deep Focus — Ambient',
    tagline: 'Minimal ambient pads for deep work.',
    scene: { style: 'wave', videoMode: 'none', videoSet: ['Abstract', 'Light'], brightnessSet: ['dark'], speedSet: ['slow'], matchEnergy: false, reactive: true },
    jamendo: { tags: 'ambient+drone+meditation', order: 'popularity_total', limit: 40 },
    shuffle: true,
    showNowPlaying: true,
  },
]

export const getStation = (slug?: string | null): Station | undefined =>
  slug ? STATIONS.find(s => s.slug === slug) : undefined
