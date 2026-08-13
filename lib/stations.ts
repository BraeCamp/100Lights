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
    // Sweeping aerials/mountains under an ink engraving + film grain; a radial visualiser breathes
    // with the orchestral swells. Cool, dark, dramatic.
    scene: { style: 'radial', paletteId: 'ice', videoMode: 'ink', videoLook: 'film', videoSet: ['Aerial', 'Mountains', 'Film', 'Abstract'], brightnessSet: ['dark', 'mid'], speedSet: ['slow', 'standard'], matchEnergy: true, reactive: true },
    tracks: ['Prelude and Action', 'The Descent', 'Impact Prelude', 'At Rest', 'Anguish', 'Killers', 'Crossing the Chasm', 'Ossuary 1 - A Beginning', 'Volatile Reaction', 'Despair and Triumph', 'Hitman', 'Echoes of Time', 'Heavy Interlude'].map(km),
    shuffle: true,
    showNowPlaying: true,
  },
  {
    slug: 'dnd-tavern',
    title: 'D&D Tavern — Ambience Radio',
    tagline: 'Warm firelit tavern: lute, hearth, and low murmur.',
    // Cozy hearth footage turned into a moving oil painting, warm sepia grade, no visualiser — pure
    // firelit ambience. Sunset palette keeps the incidental glow warm.
    scene: { style: 'none', paletteId: 'sunset', videoMode: 'oil', videoLook: 'warm', videoSet: ['Cozy', 'Film'], brightnessSet: ['dark', 'mid'], speedSet: ['slow'], matchEnergy: false, reactive: true },
    jamendo: { tags: 'medieval+folk+acoustic', order: 'popularity_total', limit: 40 },
    shuffle: true,
    showNowPlaying: true,
  },
  {
    slug: 'dnd-dungeon',
    title: 'D&D Dungeon — Dark Ambience',
    tagline: 'Tense exploration: drones, drips, and distant echoes.',
    // Grim and desaturated: ink etch + noir grade over dark abstract/night footage (no Neon — that
    // read too upbeat), mono palette, a barely-there wave. Constant dread, so energy-match stays off.
    scene: { style: 'wave', paletteId: 'mono', videoMode: 'ink', videoLook: 'noir', videoSet: ['Abstract', 'Night', 'Aerial'], brightnessSet: ['dark'], speedSet: ['slow'], matchEnergy: false, reactive: true },
    jamendo: { tags: 'dark+ambient+cinematic', order: 'popularity_total', limit: 40 },
    shuffle: true,
    showNowPlaying: true,
  },
  {
    slug: 'study-lofi',
    title: 'Study / Focus — Lofi Radio',
    tagline: 'Lo-fi beats to study and chill to, with soft visuals.',
    // Warm hazy lofi: sunset palette, soft "living" motion + warm grade over cozy rooms and rainy
    // streets, gentle dots that drift with the beat.
    scene: { style: 'dots', paletteId: 'sunset', videoMode: 'living', videoLook: 'warm', videoSet: ['Cozy', 'Streets', 'Film'], brightnessSet: ['dark', 'mid'], speedSet: ['slow', 'standard'], matchEnergy: true, reactive: true },
    jamendo: { tags: 'lofi+chillhop+instrumental', order: 'popularity_total', limit: 50 },
    shuffle: true,
    showNowPlaying: true,
  },
  {
    slug: 'deep-focus',
    title: 'Deep Focus — Ambient',
    tagline: 'Minimal ambient pads for deep work.',
    // Cool and still: ice palette, faint "living" drift + cool grade over light/ambient/abstract
    // fields, one slow wave. Nothing that pulls the eye off the work.
    scene: { style: 'wave', paletteId: 'ice', videoMode: 'living', videoLook: 'cool', videoSet: ['Light', 'Ambient', 'Abstract'], brightnessSet: ['dark'], speedSet: ['slow'], matchEnergy: false, reactive: true },
    jamendo: { tags: 'ambient+drone+meditation', order: 'popularity_total', limit: 40 },
    shuffle: true,
    showNowPlaying: true,
  },
]

export const getStation = (slug?: string | null): Station | undefined =>
  slug ? STATIONS.find(s => s.slug === slug) : undefined
