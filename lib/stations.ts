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
  genre?: string          // resolved genre family (lib/genre-map) → feeds the visual classifier prior
  /** Set when `url` is a CORS-enabled public mirror (Cloudflare R2) → the client fetches it DIRECTLY
   *  (no /api/broadcast/audio proxy), so it's zero egress to us. Added by the playlist route from the
   *  radio_audio_mirror table (lib/radio-mirror). Unmirrored remote tracks stay proxied (direct unset). */
  direct?: boolean
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
  // Auto-editing (how busy the visuals get) — the same knobs as the app's Auto panel. Leave a field
  // unset to keep the app default. For a calm radio (study/ambient) turn autoEdit off + editRate low;
  // for a hype station (edm/cinematic) turn them up.
  autoEdit?: boolean       // the auto-editor: beat-driven cuts + effects (default on)
  editRate?: number        // cut/edit RATE multiplier, 0.5 (slow) … 2 (fast); default 1
  autoSpeed?: boolean       // let it ramp clip playback speed to the music (default on)
  beatColor?: boolean      // cycle palette colours on each beat (default off)
  /** Server-streamer load mode (broadcast-streamer/render.mjs), lightest last:
   *  'reactive' (default) = audio-reactive visualiser, ~0.7 core/~2.6 Mbps;
   *  'loop' = slow gradient drift streamed with -c:v copy, ~0.05 core/~0.5 Mbps;
   *  'still' = near-static palette card at a few fps, ~audio-only cost (~15 radios per 1 TB box).
   *  Only affects the 24/7 server stream — the in-browser Lightning Bug view is always fully live. */
  renderer?: 'reactive' | 'loop' | 'still'
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
  /** Where this station pushes to. `rtmpUrl` = the ingest (default YouTube's live2; can be a Twitch
   *  URL etc.); `channel` = the account/channel it belongs to (used to FOLDER stations by account in
   *  the admin). `streamKey` = the platform stream key. ⚠️ SENSITIVE: it's stored in the config so you
   *  can paste it in the admin, but it's NEVER returned by any PUBLIC route (playlist/stations/live) —
   *  only the Clerk-gated admin GET and the token-gated agent sync see it. */
  rtmpUrl?: string
  channel?: string
  streamKey?: string
  /** Full Lightning Bug scene authored in the real UI (the "broadcast project"). A superset of
   *  `scene` — when present, the broadcast applies ALL of it (loadScene), so you're not limited to
   *  the admin panel's subset. Kept loose (it's the app's internal Scene shape) since it round-trips
   *  through the app, not this file. Authored via /apps/lightningbug?broadcastEdit=<slug>. */
  fullScene?: Record<string, unknown>
}

// Large auto-curated playlists live in their own module (keeps this file readable). The only edge back
// to here is the BroadcastTrack TYPE, which is erased at compile time — so there's no runtime cycle.
import { CALM_ORCHESTRAL } from './broadcast-playlists'

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
    slug: 'calm-orchestral',
    title: 'Calm Orchestral — Peaceful Classical Radio',
    tagline: 'Gentle strings and piano — soft, slow, royalty-free.',
    // The calm counterpart to `cinematic`: soft aurora palette, a slow painterly "living" drift with a
    // dreamy haze grade over light/ambient/nature footage, and a single unhurried wave that breathes
    // with the music. No beat-cuts, no speed ramps, no colour flashing — energy-match off so it stays
    // even and peaceful for hours.
    scene: { style: 'wave', paletteId: 'aurora', videoMode: 'living', videoLook: 'dream', videoSet: ['Light', 'Ambient', 'Nature', 'Aerial'], brightnessSet: ['mid', 'dark'], speedSet: ['slow'], matchEnergy: false, reactive: true, autoEdit: false, editRate: 0.5, autoSpeed: false, beatColor: false, renderer: 'still' },
    // ~186 curated calm classical/orchestral tracks from TWO CC-attributed artists — Kevin MacLeod
    // (CC BY 3.0) + Scott Buckley (CC BY 4.0) — every URL HEAD-verified (see lib/broadcast-playlists).
    // Static so it plays reliably right now; the `jamendo` tags below LAYER ON TOP (merged + deduped by
    // the playlist route) so the pool auto-grows past 200 with fresh variety whenever Jamendo's API is
    // reachable. Swap/add tracks in the radio admin any time.
    tracks: CALM_ORCHESTRAL,
    jamendo: { tags: 'classical+relaxing', order: 'popularity_total', limit: 80 },
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

// ── Scene option ids (for the admin control panel's dropdowns) ─────────────────
// These MIRROR the ids in components/apps/LightningBug.tsx (PALETTES / VIDEO_LOOKS /
// VIDEO_MODES / the style union) — kept here so the React-free admin can offer them
// without importing the whole visualizer. The panel also tolerates an unknown saved
// id (shows it as an extra option), so a new app id never silently drops a station's value.
export const STATION_STYLES = ['none', 'bars', 'area', 'rings', 'dots', 'radial', 'wave'] as const
export const STATION_PALETTES = ['aurora', 'sunset', 'ocean', 'neon', 'fire', 'ice', 'candy', 'mono'] as const
export const STATION_LOOKS = ['none', 'vignette', 'film', 'dream', 'noir', 'warm', 'cool', 'blockbuster', 'neonnoir', 'bleach', 'giallo', 'lean', 'spotlight', 'halo'] as const
export const STATION_MODES = ['none', 'anime', 'comic', 'ink', 'oil', 'cartoon', 'neonedge', 'thermal', 'infrared', 'vhs', 'glitch', 'living', 'super8', 'chroma', 'datamosh', 'fisheye'] as const
export const STATION_BRIGHTNESS = ['bright', 'mid', 'dark'] as const
export const STATION_SPEEDS = ['fast', 'standard', 'slow'] as const
