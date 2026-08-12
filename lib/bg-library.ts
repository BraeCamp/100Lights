// Background library for the Music Video live visualizer.
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

export interface BgClip {
  id: string
  category: BgCategory
  title: string
  kind: 'image' | 'video'
  preview: string   // thumbnail / poster (same-origin, cached offline)
  src: string       // full asset (image is same-origin; video streams from the CDN)
  tint: string      // gradient shown until the asset loads (and if it 404s)
  energy?: Energy   // used to match the song's energy when auto-shuffling (default: by category)
}

export const BG_CATEGORIES = ['Patterns', 'Artsy', 'Streets', 'Night', 'Cozy', 'Nature', 'Aerial', 'Beach', 'Mountains', 'Animals', 'City', 'Ambient'] as const
export type BgCategory = typeof BG_CATEGORIES[number]

// Default energy per category when a clip doesn't override it.
const CATEGORY_ENERGY: Record<BgCategory, Energy> = {
  Patterns: 'mid', Artsy: 'mid', Streets: 'mid', Night: 'hot', Cozy: 'calm', Nature: 'calm',
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
  // Artsy — abstract, textural, cinematic. Poster-only (streamed from R2 when the CDN is set).
  { id: 'artsy-ink-water', category: 'Artsy', title: 'Ink in water', tint: 'linear-gradient(135deg,#0b1020,#6366f1)', energy: 'calm' },
  { id: 'artsy-light-leaks', category: 'Artsy', title: 'Light leaks', tint: 'linear-gradient(135deg,#7c2d12,#fb7185)', energy: 'hot' },
  { id: 'artsy-smoke', category: 'Artsy', title: 'Colored smoke', tint: 'linear-gradient(135deg,#1e1b4b,#f472b6)', energy: 'mid' },
  { id: 'artsy-prism', category: 'Artsy', title: 'Prism light', tint: 'linear-gradient(135deg,#0ea5e9,#f0abfc)', energy: 'mid' },
  { id: 'artsy-oil-macro', category: 'Artsy', title: 'Oil & water', tint: 'linear-gradient(135deg,#0c4a6e,#22d3ee)', energy: 'calm' },
  { id: 'artsy-paint-mix', category: 'Artsy', title: 'Paint mixing', tint: 'linear-gradient(135deg,#be185d,#f59e0b)', energy: 'mid' },
  { id: 'artsy-fireworks', category: 'Artsy', title: 'Fireworks', tint: 'linear-gradient(135deg,#111827,#fbbf24)', energy: 'hot' },
  { id: 'artsy-water-caustics', category: 'Artsy', title: 'Water caustics', tint: 'linear-gradient(135deg,#0e7490,#a5f3fc)', energy: 'calm' },
  { id: 'artsy-gold-particles', category: 'Artsy', title: 'Gold particles', tint: 'linear-gradient(135deg,#3b2415,#fcd34d)', energy: 'mid' },
  { id: 'artsy-silk', category: 'Artsy', title: 'Flowing silk', tint: 'linear-gradient(135deg,#4c1d95,#f0abfc)', energy: 'calm' },
  { id: 'artsy-lava-lamp', category: 'Artsy', title: 'Lava lamp', tint: 'linear-gradient(135deg,#7c2d12,#f97316)', energy: 'calm' },
  { id: 'artsy-bokeh-drift', category: 'Artsy', title: 'Bokeh drift', tint: 'linear-gradient(135deg,#1e1b4b,#22d3ee)', energy: 'mid' },
  // Artsy — night / neon, punchy. Shorter clips (quick changes hold attention).
  { id: 'artsy-neon-signs', category: 'Artsy', title: 'Neon signs', tint: 'linear-gradient(135deg,#0b1020,#f472b6)', energy: 'hot' },
  { id: 'artsy-light-trails', category: 'Artsy', title: 'Light trails', tint: 'linear-gradient(135deg,#0b1020,#f59e0b)', energy: 'hot' },
  { id: 'artsy-neon-tunnel', category: 'Artsy', title: 'Neon tunnel', tint: 'linear-gradient(135deg,#3b0764,#22d3ee)', energy: 'hot' },
  { id: 'artsy-laser', category: 'Artsy', title: 'Laser show', tint: 'linear-gradient(135deg,#0b1020,#a3e635)', energy: 'hot' },
  { id: 'artsy-rain-neon', category: 'Artsy', title: 'Neon rain', tint: 'linear-gradient(135deg,#0b1020,#7c3aed)', energy: 'hot' },
  { id: 'artsy-city-bokeh-night', category: 'Artsy', title: 'City bokeh', tint: 'linear-gradient(135deg,#111827,#38bdf8)', energy: 'hot' },
  { id: 'artsy-plasma-ball', category: 'Artsy', title: 'Plasma ball', tint: 'linear-gradient(135deg,#1e1b4b,#e879f9)', energy: 'hot' },
  { id: 'artsy-holographic', category: 'Artsy', title: 'Holographic', tint: 'linear-gradient(135deg,#0ea5e9,#f0abfc)', energy: 'mid' },
  { id: 'artsy-liquid-metal', category: 'Artsy', title: 'Liquid metal', tint: 'linear-gradient(135deg,#334155,#e2e8f0)', energy: 'mid' },
  { id: 'artsy-glitter', category: 'Artsy', title: 'Glitter', tint: 'linear-gradient(135deg,#3b2415,#fcd34d)', energy: 'mid' },
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
