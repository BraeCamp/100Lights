// Background library for the Lightning Bug live visualizer.
//
// Two kinds of clip:
//  • Bundled generative backgrounds (public/bg/generative/), gen by scripts/gen-bg-*.mjs.
//    Real, detailed, work offline NOW. Ones in MOTION also have an animated <id>.webm loop
//    (scripts/gen-bg-videos.mjs) → kind:'video' with the <id>.jpg as its poster; the rest
//    are static kind:'image'.
//  • kind:'video' nature clips (Aerial/Beach/Mountains/Animals/City). These ship a bundled,
//    offline, procedurally-animated loop at public/bg/nature/<id>.webm with a poster
//    <id>.jpg (both from scripts/gen-bg-videos.mjs) — so they always play, never blank. If
//    NEXT_PUBLIC_BG_CDN is set they upgrade to real hosted footage at CDN/<id>.mp4 instead.
//
// Adding a clip = add a row here (no code change). Hosting the nature clips + a CSP
// media-src for the CDN are the ops step; the bundled images need neither.

export type Energy = 'calm' | 'mid' | 'hot'

import { BRIGHTNESS_MAP, type Brightness } from './bg-brightness'
import { MOTION_MAP, TRANSITION_CLIPS, type Speed } from './bg-motion'
export type { Brightness, Speed }
export { TRANSITION_CLIPS }

export interface BgClip {
  id: string
  category: BgCategory
  title: string
  kind: 'image' | 'video'
  preview: string   // thumbnail / poster (same-origin, cached offline)
  src: string       // full asset (image is same-origin; video streams from the CDN)
  tint: string      // gradient shown until the asset loads (and if it 404s)
  energy?: Energy   // used to match the song's energy when auto-shuffling (default: by category)
  brightness?: Brightness   // overrides the measured poster brightness (BRIGHTNESS_MAP); for the dark-room filter
  speed?: Speed     // overrides MOTION_MAP (catalog clips carry their own tagged speed)
}

// Measured, flash-aware brightness of the clip (see scripts/tag-bg-clips.mjs). Lets users filter
// to dark scenes so a dark room doesn't get flash-banged. Defaults to 'mid' for anything not yet
// measured (e.g. a brand-new clip before `npm run bg:tag` is re-run).
export const clipBrightness = (c: BgClip): Brightness => c.brightness ?? BRIGHTNESS_MAP[c.id] ?? 'mid'
export const BRIGHTNESS_LABEL: Record<Brightness, string> = { dark: 'Dark', mid: 'Mid', bright: 'Bright' }

// Measured motion/speed of the clip (mean inter-frame change). Slow clips are the calm scenes
// the idle/between-songs transition mode plays. Defaults to 'standard' when unmeasured.
export const clipSpeed = (c: BgClip): Speed => c.speed ?? MOTION_MAP[c.id] ?? 'standard'
export const SPEED_LABEL: Record<Speed, string> = { slow: 'Slow', standard: 'Standard', fast: 'Fast' }

// Artistic themes first: the library leans music-video by default.
export const BG_CATEGORIES = ['Abstract', 'Light', 'Neon', 'Film', 'Night', 'Streets', 'Cozy', 'Nature', 'Patterns', 'Aerial', 'Beach', 'Mountains', 'Animals', 'City', 'Ambient'] as const
export type BgCategory = typeof BG_CATEGORIES[number]

// Default energy per category when a clip doesn't override it.
const CATEGORY_ENERGY: Record<BgCategory, Energy> = {
  Abstract: 'mid', Light: 'calm', Neon: 'hot', Film: 'mid',
  Patterns: 'mid', Streets: 'mid', Night: 'hot', Cozy: 'calm', Nature: 'calm',
  Aerial: 'mid', Beach: 'calm', Mountains: 'calm', Animals: 'calm', City: 'hot', Ambient: 'calm',
}
export const clipEnergy = (c: BgClip): Energy => c.energy ?? CATEGORY_ENERGY[c.category]

import { FETCHED_NATURE } from './bg-fetched'
import { CDN_CLIPS } from './bg-cdn'

const CDN = (process.env.NEXT_PUBLIC_BG_CDN || '').replace(/\/$/, '')
const CDN_SET = new Set(CDN_CLIPS)

// Bundled generative images — render immediately, offline, no hosting.
const GENERATIVE: { id: string; title: string; tint: string }[] = [
  { id: 'nebula-violet', title: 'Nebula', tint: 'linear-gradient(135deg,#4c1d95,#db2777)' },
  { id: 'aurora-teal', title: 'Aurora', tint: 'linear-gradient(135deg,#0ea5e9,#34d399)' },
  { id: 'sunset-haze', title: 'Sunset haze', tint: 'linear-gradient(135deg,#f59e0b,#f43f5e)' },
  { id: 'ocean-deep', title: 'Deep ocean', tint: 'linear-gradient(135deg,#082f49,#22d3ee)' },
  { id: 'ember-glow', title: 'Ember', tint: 'linear-gradient(135deg,#7c2d12,#f97316)' },
  { id: 'bokeh-lights', title: 'Bokeh lights', tint: 'linear-gradient(135deg,#4c1d95,#22d3ee)' },
  { id: 'bokeh-warm', title: 'Warm bokeh', tint: 'linear-gradient(135deg,#7c2d12,#fbbf24)' },
  { id: 'synthwave-grid', title: 'Synthwave', tint: 'linear-gradient(135deg,#7c3aed,#db2777)' },
  { id: 'particles-cyan', title: 'Particles', tint: 'linear-gradient(135deg,#0891b2,#a78bfa)' },
  { id: 'waves-blue', title: 'Blue waves', tint: 'linear-gradient(135deg,#0369a1,#38bdf8)' },
  { id: 'liquid-magma', title: 'Magma', tint: 'linear-gradient(135deg,#7c2d12,#fbbf24)' },
  { id: 'starfield-deep', title: 'Starfield', tint: 'linear-gradient(135deg,#1e1b4b,#db2777)' },
  { id: 'plasma-neon', title: 'Plasma', tint: 'linear-gradient(135deg,#22d3ee,#f472b6)' },
  { id: 'plasma-sunset', title: 'Sunset plasma', tint: 'linear-gradient(135deg,#f59e0b,#7c3aed)' },
  { id: 'mountains-dusk', title: 'Mountains', tint: 'linear-gradient(135deg,#7c3aed,#fbbf24)' },
]

// Curated nature clips — stream online; poster cached offline.
const NATURE: { id: string; category: BgCategory; title: string; tint: string; energy?: Energy }[] = [
  { id: 'aerial-coastline', category: 'Aerial', title: 'Coastline from above', tint: 'linear-gradient(135deg,#0e7490,#22d3ee)' },
  { id: 'aerial-forest', category: 'Aerial', title: 'Forest canopy', tint: 'linear-gradient(135deg,#065f46,#34d399)' },
  { id: 'aerial-desert', category: 'Aerial', title: 'Desert dunes', tint: 'linear-gradient(135deg,#b45309,#fbbf24)' },
  { id: 'beach-waves', category: 'Beach', title: 'Rolling waves', tint: 'linear-gradient(135deg,#0369a1,#38bdf8)' },
  { id: 'beach-sunset', category: 'Beach', title: 'Beach sunset', tint: 'linear-gradient(135deg,#c2410c,#f59e0b)' },
  { id: 'mountains-peaks', category: 'Mountains', title: 'Windy peaks', tint: 'linear-gradient(135deg,#334155,#94a3b8)' },
  { id: 'mountains-valley', category: 'Mountains', title: 'Misty valley', tint: 'linear-gradient(135deg,#1e3a5f,#64748b)' },
  { id: 'animals-birds', category: 'Animals', title: 'Birds in flight', tint: 'linear-gradient(135deg,#0c4a6e,#7dd3fc)' },
  { id: 'animals-jellyfish', category: 'Animals', title: 'Jellyfish drift', tint: 'linear-gradient(135deg,#4c1d95,#c084fc)' },
  { id: 'city-night', category: 'City', title: 'City at night', tint: 'linear-gradient(135deg,#111827,#a78bfa)' },
  { id: 'city-timelapse', category: 'City', title: 'Traffic trails', tint: 'linear-gradient(135deg,#7c2d12,#f97316)' },
  // Streets — daylight, people, movement
  { id: 'street-golden', category: 'Streets', title: 'Golden-hour street', tint: 'linear-gradient(135deg,#7c2d12,#fbbf24)' },
  { id: 'street-crosswalk', category: 'Streets', title: 'Busy crosswalk', tint: 'linear-gradient(135deg,#334155,#e2e8f0)' },
  { id: 'street-cafe', category: 'Streets', title: 'Café terrace', tint: 'linear-gradient(135deg,#7c2d12,#fde68a)' },
  // Night — streetlights, neon, rain
  { id: 'night-streetlamps', category: 'Night', title: 'Streetlamps & walkers', tint: 'linear-gradient(135deg,#111827,#fbbf24)' },
  { id: 'night-neon', category: 'Night', title: 'Neon alley', tint: 'linear-gradient(135deg,#0b1020,#22d3ee)' },
  { id: 'night-rain-neon', category: 'Night', title: 'Rainy neon', tint: 'linear-gradient(135deg,#0b1020,#7c3aed)' },
  { id: 'night-aurora', category: 'Night', title: 'Aurora sky', tint: 'linear-gradient(135deg,#052e2b,#a78bfa)' },
  // Cozy — lofi / indoor warmth
  { id: 'cozy-rain-window', category: 'Cozy', title: 'Rain on glass', tint: 'linear-gradient(135deg,#1e293b,#38bdf8)' },
  { id: 'cozy-fireplace', category: 'Cozy', title: 'Fireplace', tint: 'linear-gradient(135deg,#3b1106,#fbbf24)' },
  { id: 'cozy-coffee', category: 'Cozy', title: 'Coffee steam', tint: 'linear-gradient(135deg,#3b2415,#d6b48a)' },
  // Nature — daylight scenic
  { id: 'nature-sunbeams', category: 'Nature', title: 'Forest sunbeams', tint: 'linear-gradient(135deg,#14532d,#fde047)' },
  { id: 'nature-flowers', category: 'Nature', title: 'Flower field', tint: 'linear-gradient(135deg,#be185d,#fde047)' },
  { id: 'nature-clouds', category: 'Nature', title: 'Cloud drift', tint: 'linear-gradient(135deg,#1e3a8a,#e0f2fe)' },
  { id: 'nature-underwater', category: 'Nature', title: 'Sun-dappled water', tint: 'linear-gradient(135deg,#083344,#67e8f9)' },
  // ── More real footage across the nature categories (bundled locally via bg:fetch)
  { id: 'street-market2', category: 'Streets', title: 'Street market', tint: 'linear-gradient(135deg,#7c2d12,#fbbf24)' },
  { id: 'street-rain-day', category: 'Streets', title: 'Rainy day street', tint: 'linear-gradient(135deg,#334155,#94a3b8)' },
  { id: 'street-alley', category: 'Streets', title: 'Old town alley', tint: 'linear-gradient(135deg,#7c2d12,#d6b48a)' },
  { id: 'night-highway', category: 'Night', title: 'Highway lights', tint: 'linear-gradient(135deg,#111827,#f59e0b)' },
  { id: 'night-bridge', category: 'Night', title: 'Bridge at night', tint: 'linear-gradient(135deg,#0b1020,#38bdf8)' },
  { id: 'night-market', category: 'City', title: 'Night market', tint: 'linear-gradient(135deg,#3b0764,#f472b6)' },
  { id: 'cozy-tea', category: 'Cozy', title: 'Tea steam', tint: 'linear-gradient(135deg,#3b2415,#d6b48a)' },
  { id: 'cozy-books', category: 'Cozy', title: 'Library nook', tint: 'linear-gradient(135deg,#3b2415,#a8a29e)' },
  { id: 'cozy-snow-window', category: 'Cozy', title: 'Snow at the window', tint: 'linear-gradient(135deg,#1e293b,#e0f2fe)' },
  { id: 'nature-waterfall', category: 'Nature', title: 'Waterfall', tint: 'linear-gradient(135deg,#065f46,#a5f3fc)' },
  { id: 'nature-autumn', category: 'Nature', title: 'Autumn leaves', tint: 'linear-gradient(135deg,#7c2d12,#f59e0b)' },
  { id: 'nature-desert-night', category: 'Nature', title: 'Desert stars', tint: 'linear-gradient(135deg,#0b1020,#a78bfa)' },
  { id: 'aerial-mountains2', category: 'Aerial', title: 'Mountain range', tint: 'linear-gradient(135deg,#334155,#cbd5e1)' },
  { id: 'aerial-ocean', category: 'Aerial', title: 'Open ocean', tint: 'linear-gradient(135deg,#0e7490,#67e8f9)' },
  { id: 'beach-palm', category: 'Beach', title: 'Palm breeze', tint: 'linear-gradient(135deg,#0e7490,#fde68a)' },
  { id: 'beach-aerial', category: 'Beach', title: 'Tropical aerial', tint: 'linear-gradient(135deg,#0369a1,#67e8f9)' },
  { id: 'mountains-snow', category: 'Mountains', title: 'Snowy peaks', tint: 'linear-gradient(135deg,#334155,#e0f2fe)' },
  { id: 'mountains-lake', category: 'Mountains', title: 'Mountain lake', tint: 'linear-gradient(135deg,#1e3a5f,#7dd3fc)' },
  { id: 'animals-fish', category: 'Animals', title: 'Coral reef fish', tint: 'linear-gradient(135deg,#0e7490,#fde68a)' },
  { id: 'animals-deer', category: 'Animals', title: 'Forest deer', tint: 'linear-gradient(135deg,#14532d,#a8a29e)' },
  { id: 'city-rooftop', category: 'City', title: 'Rooftop view', tint: 'linear-gradient(135deg,#334155,#7dd3fc)' },
  { id: 'city-aerial-traffic', category: 'City', title: 'Aerial traffic', tint: 'linear-gradient(135deg,#111827,#f59e0b)' },
  // ── Abstract — fluid, textural, macro (music-video textures). Poster-only → R2.
  { id: 'artsy-ink-water', category: 'Abstract', title: 'Ink in water', tint: 'linear-gradient(135deg,#0b1020,#6366f1)', energy: 'calm' },
  { id: 'artsy-marble-ink', category: 'Abstract', title: 'Marble ink', tint: 'linear-gradient(135deg,#1e1b4b,#22d3ee)', energy: 'mid' },
  { id: 'artsy-liquid-color', category: 'Abstract', title: 'Liquid color', tint: 'linear-gradient(135deg,#be185d,#0ea5e9)', energy: 'mid' },
  { id: 'artsy-oil-macro', category: 'Abstract', title: 'Oil & water', tint: 'linear-gradient(135deg,#0c4a6e,#22d3ee)', energy: 'calm' },
  { id: 'artsy-paint-mix', category: 'Abstract', title: 'Paint mixing', tint: 'linear-gradient(135deg,#be185d,#f59e0b)', energy: 'mid' },
  { id: 'artsy-smoke', category: 'Abstract', title: 'Colored smoke', tint: 'linear-gradient(135deg,#1e1b4b,#f472b6)', energy: 'mid' },
  { id: 'artsy-powder', category: 'Abstract', title: 'Powder burst', tint: 'linear-gradient(135deg,#111827,#f472b6)', energy: 'hot' },
  { id: 'artsy-bubbles', category: 'Abstract', title: 'Iridescent bubbles', tint: 'linear-gradient(135deg,#0e7490,#f0abfc)', energy: 'mid' },
  { id: 'artsy-honey', category: 'Abstract', title: 'Honey pour', tint: 'linear-gradient(135deg,#7c2d12,#fcd34d)', energy: 'calm' },
  { id: 'artsy-silk', category: 'Abstract', title: 'Flowing silk', tint: 'linear-gradient(135deg,#4c1d95,#f0abfc)', energy: 'calm' },
  { id: 'artsy-lava-lamp', category: 'Abstract', title: 'Lava lamp', tint: 'linear-gradient(135deg,#7c2d12,#f97316)', energy: 'calm' },
  { id: 'artsy-liquid-metal', category: 'Abstract', title: 'Liquid metal', tint: 'linear-gradient(135deg,#334155,#e2e8f0)', energy: 'mid' },
  { id: 'artsy-holographic', category: 'Abstract', title: 'Holographic', tint: 'linear-gradient(135deg,#0ea5e9,#f0abfc)', energy: 'mid' },
  // ── Light — prisms, particles, flares, bokeh
  { id: 'artsy-light-leaks', category: 'Light', title: 'Light leaks', tint: 'linear-gradient(135deg,#7c2d12,#fb7185)', energy: 'hot' },
  { id: 'artsy-prism', category: 'Light', title: 'Prism light', tint: 'linear-gradient(135deg,#0ea5e9,#f0abfc)', energy: 'mid' },
  { id: 'artsy-crystal', category: 'Light', title: 'Crystal light', tint: 'linear-gradient(135deg,#0ea5e9,#e0f2fe)', energy: 'calm' },
  { id: 'artsy-lens-flare', category: 'Light', title: 'Lens flare', tint: 'linear-gradient(135deg,#1e1b4b,#f59e0b)', energy: 'mid' },
  { id: 'artsy-god-rays', category: 'Light', title: 'God rays', tint: 'linear-gradient(135deg,#1e293b,#fde68a)', energy: 'calm' },
  { id: 'artsy-gold-particles', category: 'Light', title: 'Gold particles', tint: 'linear-gradient(135deg,#3b2415,#fcd34d)', energy: 'mid' },
  { id: 'artsy-glitter', category: 'Light', title: 'Glitter', tint: 'linear-gradient(135deg,#3b2415,#fcd34d)', energy: 'mid' },
  { id: 'artsy-particles-float', category: 'Light', title: 'Floating dust', tint: 'linear-gradient(135deg,#1e293b,#fde68a)', energy: 'calm' },
  { id: 'artsy-water-caustics', category: 'Light', title: 'Water caustics', tint: 'linear-gradient(135deg,#0e7490,#a5f3fc)', energy: 'calm' },
  { id: 'artsy-slow-water', category: 'Light', title: 'Water ripple', tint: 'linear-gradient(135deg,#0c4a6e,#7dd3fc)', energy: 'calm' },
  { id: 'artsy-bokeh-drift', category: 'Light', title: 'Bokeh drift', tint: 'linear-gradient(135deg,#1e1b4b,#22d3ee)', energy: 'mid' },
  { id: 'artsy-galaxy', category: 'Light', title: 'Galaxy', tint: 'linear-gradient(135deg,#0b1020,#a78bfa)', energy: 'calm' },
  // ── Neon — electric, night, punchy (shorter clips)
  { id: 'artsy-neon-signs', category: 'Neon', title: 'Neon signs', tint: 'linear-gradient(135deg,#0b1020,#f472b6)', energy: 'hot' },
  { id: 'artsy-light-trails', category: 'Neon', title: 'Light trails', tint: 'linear-gradient(135deg,#0b1020,#f59e0b)', energy: 'hot' },
  { id: 'artsy-neon-tunnel', category: 'Neon', title: 'Neon tunnel', tint: 'linear-gradient(135deg,#3b0764,#22d3ee)', energy: 'hot' },
  { id: 'artsy-laser', category: 'Neon', title: 'Laser show', tint: 'linear-gradient(135deg,#0b1020,#a3e635)', energy: 'hot' },
  { id: 'artsy-rain-neon', category: 'Neon', title: 'Neon rain', tint: 'linear-gradient(135deg,#0b1020,#7c3aed)', energy: 'hot' },
  { id: 'artsy-city-bokeh-night', category: 'Neon', title: 'City bokeh', tint: 'linear-gradient(135deg,#111827,#38bdf8)', energy: 'hot' },
  { id: 'artsy-plasma-ball', category: 'Neon', title: 'Plasma ball', tint: 'linear-gradient(135deg,#1e1b4b,#e879f9)', energy: 'hot' },
  { id: 'artsy-neon-grid', category: 'Neon', title: 'Synthwave grid', tint: 'linear-gradient(135deg,#3b0764,#22d3ee)', energy: 'hot' },
  { id: 'artsy-disco', category: 'Neon', title: 'Disco lights', tint: 'linear-gradient(135deg,#3b0764,#f472b6)', energy: 'hot' },
  { id: 'artsy-strobe', category: 'Neon', title: 'Strobe', tint: 'linear-gradient(135deg,#0b1020,#e2e8f0)', energy: 'hot' },
  { id: 'artsy-fireworks', category: 'Neon', title: 'Fireworks', tint: 'linear-gradient(135deg,#111827,#fbbf24)', energy: 'hot' },
  // ── Film — cinematic, moody, retro
  { id: 'artsy-film-grain', category: 'Film', title: 'Film grain', tint: 'linear-gradient(135deg,#292524,#a8a29e)', energy: 'calm' },
  { id: 'artsy-vhs-static', category: 'Film', title: 'VHS static', tint: 'linear-gradient(135deg,#1e1b4b,#22d3ee)', energy: 'hot' },
  { id: 'artsy-silhouette-dance', category: 'Film', title: 'Dancer silhouette', tint: 'linear-gradient(135deg,#111827,#fb7185)', energy: 'mid' },
  { id: 'artsy-spotlight', category: 'Film', title: 'Spotlight smoke', tint: 'linear-gradient(135deg,#111827,#a78bfa)', energy: 'mid' },
  { id: 'artsy-projector', category: 'Film', title: 'Projector dust', tint: 'linear-gradient(135deg,#0b1020,#e2e8f0)', energy: 'mid' },
  { id: 'artsy-smoke-dance', category: 'Film', title: 'Backlit smoke', tint: 'linear-gradient(135deg,#0b1020,#a78bfa)', energy: 'calm' },
  // ── More artistic fill (published to R2)
  { id: 'artsy-acrylic-pour', category: 'Abstract', title: 'Acrylic pour', tint: 'linear-gradient(135deg,#be185d,#22d3ee)', energy: 'mid' },
  { id: 'artsy-alcohol-ink', category: 'Abstract', title: 'Alcohol ink', tint: 'linear-gradient(135deg,#4c1d95,#22d3ee)', energy: 'mid' },
  { id: 'artsy-frost', category: 'Abstract', title: 'Frost crystals', tint: 'linear-gradient(135deg,#0e7490,#e0f2fe)', energy: 'calm' },
  { id: 'artsy-mercury', category: 'Abstract', title: 'Mercury drops', tint: 'linear-gradient(135deg,#334155,#cbd5e1)', energy: 'mid' },
  { id: 'artsy-star-bokeh', category: 'Light', title: 'Star bokeh', tint: 'linear-gradient(135deg,#1e1b4b,#fde68a)', energy: 'mid' },
  { id: 'artsy-light-painting', category: 'Light', title: 'Light painting', tint: 'linear-gradient(135deg,#0b1020,#22d3ee)', energy: 'hot' },
  { id: 'artsy-sparks', category: 'Light', title: 'Sparks', tint: 'linear-gradient(135deg,#111827,#f59e0b)', energy: 'hot' },
  { id: 'artsy-dappled', category: 'Light', title: 'Dappled light', tint: 'linear-gradient(135deg,#14532d,#fde68a)', energy: 'calm' },
  { id: 'artsy-neon-heart', category: 'Neon', title: 'Neon heart', tint: 'linear-gradient(135deg,#0b1020,#fb7185)', energy: 'hot' },
  { id: 'artsy-led-wall', category: 'Neon', title: 'LED wall', tint: 'linear-gradient(135deg,#0b1020,#22d3ee)', energy: 'hot' },
  { id: 'artsy-glow-sticks', category: 'Neon', title: 'Glow sticks', tint: 'linear-gradient(135deg,#0b1020,#a3e635)', energy: 'hot' },
  { id: 'artsy-old-film', category: 'Film', title: 'Old film', tint: 'linear-gradient(135deg,#292524,#a8a29e)', energy: 'mid' },
  { id: 'artsy-super8', category: 'Film', title: 'Super 8', tint: 'linear-gradient(135deg,#3b2415,#fcd34d)', energy: 'calm' },
  { id: 'artsy-noir-blinds', category: 'Film', title: 'Noir blinds', tint: 'linear-gradient(135deg,#111827,#94a3b8)', energy: 'mid' },
  { id: 'artsy-rain-window-cine', category: 'Film', title: 'Rainy window', tint: 'linear-gradient(135deg,#0b1020,#38bdf8)', energy: 'calm' },
  { id: 'artsy-silhouette-crowd', category: 'Film', title: 'Crowd silhouette', tint: 'linear-gradient(135deg,#111827,#a78bfa)', energy: 'hot' },
  // ── More artistic fill across the themes (R2)
  { id: 'artsy-ferrofluid', category: 'Abstract', title: 'Ferrofluid', tint: 'linear-gradient(135deg,#0b1020,#6366f1)', energy: 'mid' },
  { id: 'artsy-water-drop', category: 'Abstract', title: 'Water drop', tint: 'linear-gradient(135deg,#0c4a6e,#67e8f9)', energy: 'calm' },
  { id: 'artsy-clay', category: 'Abstract', title: 'Morphing clay', tint: 'linear-gradient(135deg,#be185d,#f59e0b)', energy: 'mid' },
  { id: 'artsy-fiber-optic', category: 'Light', title: 'Fiber optics', tint: 'linear-gradient(135deg,#1e1b4b,#22d3ee)', energy: 'mid' },
  { id: 'artsy-sun-flare', category: 'Light', title: 'Sun flare', tint: 'linear-gradient(135deg,#7c2d12,#fde68a)', energy: 'calm' },
  { id: 'artsy-candles', category: 'Light', title: 'Candlelight', tint: 'linear-gradient(135deg,#3b1106,#fbbf24)', energy: 'calm' },
  { id: 'artsy-neon-palm', category: 'Neon', title: 'Neon palms', tint: 'linear-gradient(135deg,#3b0764,#f472b6)', energy: 'hot' },
  { id: 'artsy-club-lights', category: 'Neon', title: 'Club lights', tint: 'linear-gradient(135deg,#0b1020,#e879f9)', energy: 'hot' },
  { id: 'artsy-vapor-street', category: 'Neon', title: 'Vapor street', tint: 'linear-gradient(135deg,#3b0764,#22d3ee)', energy: 'hot' },
  { id: 'artsy-super8-city', category: 'Film', title: 'Super 8 city', tint: 'linear-gradient(135deg,#3b2415,#d6b48a)', energy: 'mid' },
  { id: 'artsy-grain-warm', category: 'Film', title: 'Warm grain', tint: 'linear-gradient(135deg,#292524,#d6b48a)', energy: 'calm' },
  { id: 'artsy-flicker', category: 'Film', title: 'Projector flicker', tint: 'linear-gradient(135deg,#0b1020,#e2e8f0)', energy: 'mid' },
]

// Generative styles that also have an animated WebM loop (scripts/gen-bg-videos.mjs).
const MOTION = new Set(['nebula-violet', 'aurora-teal', 'ocean-deep', 'ember-glow', 'bokeh-lights', 'particles-cyan', 'waves-blue', 'liquid-magma', 'starfield-deep'])

export const BG_LIBRARY: BgClip[] = [
  ...GENERATIVE.map(g => {
    const motion = MOTION.has(g.id)
    return {
      id: g.id, category: 'Patterns' as BgCategory, title: g.title,
      kind: (motion ? 'video' : 'image') as 'video' | 'image',
      preview: `/bg/generative/${g.id}.jpg`,                              // static poster (offline)
      src: `/bg/generative/${g.id}.${motion ? 'webm' : 'jpg'}`,          // animated loop when available
      tint: g.tint,
    }
  }),
  ...NATURE.map(c => ({
    ...c, kind: 'video' as const,
    preview: `/bg/nature/${c.id}.jpg`,                                   // bundled poster (offline, never blank)
    // Priority: published to R2 (CDN set) → real footage fetched locally → procedural loop.
    // Poster-only clips (artsy) have no local mp4/webm, so off-CDN they show their poster.
    src: CDN && CDN_SET.has(c.id) ? `${CDN}/bg/${c.id}.mp4`
      : FETCHED_NATURE.includes(c.id) ? `/bg/nature/${c.id}.mp4`
        : `/bg/nature/${c.id}.webm`,
  })),
]

export const clipsByCategory = (cat: BgCategory): BgClip[] => BG_LIBRARY.filter(c => c.category === cat)
export const clipById = (id: string): BgClip | undefined => BG_LIBRARY.find(c => c.id === id)
