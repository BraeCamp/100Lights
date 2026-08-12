// Genre "Looks" for the Music Video live visualizer — a full scene per music type.
//
// A Look sets the whole visualizer (style, palette, feel, filters, match/EQ) AND
// constrains the BACKGROUND to a genre-appropriate pool of background ids — bundled
// generative IMAGES (render now, offline), nature VIDEOS (render once hosted), and
// ambient gradients. Applying a Look (or "Shuffle background") picks one at random,
// so a genre stays on-theme but never looks the same twice.
//
// First-pass presets — meant to be corrected by ear. Ids: image/video ids come from
// BG_LIBRARY (lib/bg-library); ambient ids come from AMBIENTS; palette ids from PALETTES.

import { type BgCategory } from '@/lib/bg-library'

export interface GenreLook {
  id: string
  name: string
  desc: string
  style: 'bars' | 'radial' | 'wave'
  palette: string
  mode: 'solid' | 'spectrum' | 'random'
  gain: number
  smoothing: number
  mirror: boolean
  glow: boolean
  trail: boolean
  match: boolean
  eq: boolean
  filters: { blur: number; brightness: number; saturate: number; hue: number }
  // Random background pool (mix of image ids, video ids, ambient ids). `browse` =
  // the library category to preselect for manual picking.
  bg: { pool: string[]; browse: BgCategory }
}

export const GENRE_LOOKS: GenreLook[] = [
  {
    id: 'lofi', name: 'Lo-fi', desc: 'Warm, hazy, laid-back',
    style: 'bars', palette: 'sunset', mode: 'spectrum', gain: 1.0, smoothing: 0.9,
    mirror: true, glow: true, trail: true, match: true, eq: false,
    filters: { blur: 2, brightness: 0.85, saturate: 1.05, hue: 0 },
    bg: { pool: ['artsy-film-grain', 'artsy-projector', 'artsy-smoke-dance', 'artsy-particles-float', 'artsy-god-rays', 'artsy-honey', 'ember-glow', 'cozy-fireplace', 'city-night', 'sunset'], browse: 'Artsy' },
  },
  {
    id: 'chill', name: 'Chill', desc: 'Smooth and floaty',
    style: 'wave', palette: 'aurora', mode: 'spectrum', gain: 1.1, smoothing: 0.9,
    mirror: false, glow: true, trail: true, match: true, eq: false,
    filters: { blur: 1, brightness: 0.95, saturate: 1.1, hue: 0 },
    bg: { pool: ['artsy-slow-water', 'artsy-marble-ink', 'artsy-ink-water', 'artsy-galaxy', 'artsy-smoke-dance', 'artsy-crystal', 'aurora-teal', 'ocean-deep', 'nature-underwater', 'aurora'], browse: 'Artsy' },
  },
  {
    id: 'edm', name: 'EDM', desc: 'Punchy, bright, reactive',
    style: 'bars', palette: 'neon', mode: 'spectrum', gain: 1.7, smoothing: 0.6,
    mirror: true, glow: true, trail: false, match: true, eq: true,
    filters: { blur: 0, brightness: 1.05, saturate: 1.4, hue: 0 },
    bg: { pool: ['artsy-neon-grid', 'artsy-strobe', 'artsy-disco', 'artsy-laser', 'artsy-neon-tunnel', 'artsy-powder', 'artsy-plasma-ball', 'particles-cyan', 'nebula-violet', 'city-night', 'nebula'], browse: 'Artsy' },
  },
  {
    id: 'hiphop', name: 'Hip-hop', desc: 'Bold and heavy',
    style: 'bars', palette: 'fire', mode: 'spectrum', gain: 1.5, smoothing: 0.75,
    mirror: true, glow: true, trail: true, match: true, eq: true,
    filters: { blur: 1, brightness: 0.95, saturate: 1.2, hue: 0 },
    bg: { pool: ['artsy-neon-signs', 'artsy-light-trails', 'artsy-city-bokeh-night', 'artsy-smoke-dance', 'artsy-liquid-metal', 'artsy-spotlight', 'city-timelapse', 'night-neon', 'liquid-magma', 'nebula'], browse: 'Artsy' },
  },
  {
    id: 'rock', name: 'Rock', desc: 'Raw and driving',
    style: 'bars', palette: 'fire', mode: 'solid', gain: 1.6, smoothing: 0.55,
    mirror: false, glow: true, trail: false, match: false, eq: true,
    filters: { blur: 0, brightness: 1.0, saturate: 1.3, hue: 0 },
    bg: { pool: ['artsy-vhs-static', 'artsy-strobe', 'artsy-powder', 'artsy-light-leaks', 'artsy-lens-flare', 'artsy-fireworks', 'ember-glow', 'liquid-magma', 'city-timelapse', 'sunset'], browse: 'Artsy' },
  },
  {
    id: 'focus', name: 'Ambient / Focus', desc: 'Calm and slow',
    style: 'radial', palette: 'ice', mode: 'spectrum', gain: 0.9, smoothing: 0.92,
    mirror: false, glow: true, trail: true, match: true, eq: false,
    filters: { blur: 2, brightness: 0.9, saturate: 0.95, hue: 0 },
    bg: { pool: ['artsy-galaxy', 'artsy-particles-float', 'artsy-slow-water', 'artsy-smoke-dance', 'artsy-crystal', 'artsy-god-rays', 'ocean-deep', 'starfield-deep', 'nature-underwater', 'ocean'], browse: 'Artsy' },
  },
  {
    id: 'pop', name: 'Pop', desc: 'Bright and playful',
    style: 'bars', palette: 'candy', mode: 'spectrum', gain: 1.3, smoothing: 0.75,
    mirror: true, glow: true, trail: true, match: true, eq: true,
    filters: { blur: 0, brightness: 1.05, saturate: 1.25, hue: 0 },
    bg: { pool: ['artsy-bubbles', 'artsy-glitter', 'artsy-holographic', 'artsy-disco', 'artsy-liquid-color', 'artsy-lens-flare', 'bokeh-lights', 'particles-cyan', 'beach-sunset', 'aurora'], browse: 'Artsy' },
  },
]
