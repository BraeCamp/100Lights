// Genre "Looks" for the Music Video live visualizer — a full scene per music type.
//
// A Look sets the whole visualizer (style, palette, feel, filters, match/EQ) AND
// constrains the BACKGROUND to genre-appropriate sources: it lists allowed library
// categories + ambient gradients, and the app picks one at RANDOM when the Look is
// applied (and re-rolls on "Shuffle background"). So a genre stays on-theme but
// never looks the same twice.
//
// First-pass presets — meant to be corrected by ear. Palette ids match PALETTES,
// ambient ids match AMBIENTS, categories match BG_CATEGORIES.

import { type BgCategory } from '@/lib/bg-library'

export interface GenreLook {
  id: string
  name: string
  desc: string
  style: 'bars' | 'radial' | 'wave'
  palette: string                              // PALETTES id
  mode: 'solid' | 'spectrum' | 'random'
  gain: number                                 // 0.5–2.6
  smoothing: number                            // 0–0.95
  mirror: boolean
  glow: boolean
  trail: boolean
  match: boolean                               // tint background toward palette
  eq: boolean                                  // filters react to audio
  filters: { blur: number; brightness: number; saturate: number; hue: number }
  bg: { categories: BgCategory[]; ambients: string[] }   // random pool for this genre
}

export const GENRE_LOOKS: GenreLook[] = [
  {
    id: 'lofi', name: 'Lo-fi', desc: 'Warm, hazy, laid-back',
    style: 'bars', palette: 'sunset', mode: 'spectrum', gain: 1.0, smoothing: 0.9,
    mirror: true, glow: true, trail: true, match: true, eq: false,
    filters: { blur: 2, brightness: 0.85, saturate: 1.05, hue: 0 },
    bg: { categories: ['Ambient', 'City', 'Beach'], ambients: ['sunset', 'nebula'] },
  },
  {
    id: 'chill', name: 'Chill', desc: 'Smooth and floaty',
    style: 'wave', palette: 'aurora', mode: 'spectrum', gain: 1.1, smoothing: 0.9,
    mirror: false, glow: true, trail: true, match: true, eq: false,
    filters: { blur: 1, brightness: 0.95, saturate: 1.1, hue: 0 },
    bg: { categories: ['Aerial', 'Beach', 'Ambient'], ambients: ['aurora', 'ocean'] },
  },
  {
    id: 'edm', name: 'EDM', desc: 'Punchy, bright, reactive',
    style: 'bars', palette: 'neon', mode: 'spectrum', gain: 1.7, smoothing: 0.6,
    mirror: true, glow: true, trail: false, match: true, eq: true,
    filters: { blur: 0, brightness: 1.05, saturate: 1.4, hue: 0 },
    bg: { categories: ['City', 'Ambient'], ambients: ['nebula', 'aurora'] },
  },
  {
    id: 'hiphop', name: 'Hip-hop', desc: 'Bold and heavy',
    style: 'bars', palette: 'fire', mode: 'spectrum', gain: 1.5, smoothing: 0.75,
    mirror: true, glow: true, trail: true, match: true, eq: true,
    filters: { blur: 1, brightness: 0.95, saturate: 1.2, hue: 0 },
    bg: { categories: ['City', 'Aerial'], ambients: ['sunset', 'nebula'] },
  },
  {
    id: 'rock', name: 'Rock', desc: 'Raw and driving',
    style: 'bars', palette: 'fire', mode: 'solid', gain: 1.6, smoothing: 0.55,
    mirror: false, glow: true, trail: false, match: false, eq: true,
    filters: { blur: 0, brightness: 1.0, saturate: 1.3, hue: 0 },
    bg: { categories: ['City', 'Mountains'], ambients: ['sunset', 'nebula'] },
  },
  {
    id: 'focus', name: 'Ambient / Focus', desc: 'Calm and slow',
    style: 'radial', palette: 'ice', mode: 'spectrum', gain: 0.9, smoothing: 0.92,
    mirror: false, glow: true, trail: true, match: true, eq: false,
    filters: { blur: 2, brightness: 0.9, saturate: 0.95, hue: 0 },
    bg: { categories: ['Aerial', 'Mountains', 'Ambient'], ambients: ['ocean', 'forest', 'aurora'] },
  },
  {
    id: 'pop', name: 'Pop', desc: 'Bright and playful',
    style: 'bars', palette: 'candy', mode: 'spectrum', gain: 1.3, smoothing: 0.75,
    mirror: true, glow: true, trail: true, match: true, eq: true,
    filters: { blur: 0, brightness: 1.05, saturate: 1.25, hue: 0 },
    bg: { categories: ['Beach', 'City', 'Aerial'], ambients: ['sunset', 'aurora'] },
  },
]
