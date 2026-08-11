// Curated background-video library for the Music Video live visualizer.
//
// The full clips STREAM online from a CDN/R2 bucket; a small poster image per clip
// lives same-origin under /public/bg/previews so it caches for offline use (the
// service worker keeps images) — offline you see the low-res preview, online the
// clip plays. Set NEXT_PUBLIC_BG_CDN to the bucket base (e.g. https://cdn.100lights.com/bg);
// upload each clip as <id>.mp4 and its poster as public/bg/previews/<id>.jpg.
//
// Adding clips = add a row here (no code change). The picker degrades gracefully:
// a missing poster shows a gradient placeholder, a clip that can't stream falls
// back to its poster.

export interface BgClip {
  id: string
  category: BgCategory
  title: string
  /** Low-res poster, same-origin, cached offline. */
  preview: string
  /** Full clip, streamed online. */
  src: string
  /** Fallback gradient shown until the poster loads (and if it 404s). */
  tint: string
}

export const BG_CATEGORIES = ['Aerial', 'Beach', 'Mountains', 'Animals', 'City', 'Ambient'] as const
export type BgCategory = typeof BG_CATEGORIES[number]

const CDN = (process.env.NEXT_PUBLIC_BG_CDN || '').replace(/\/$/, '')

const SEED: { id: string; category: BgCategory; title: string; tint: string }[] = [
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
  { id: 'ambient-ink', category: 'Ambient', title: 'Ink in water', tint: 'linear-gradient(135deg,#1e1b4b,#db2777)' },
  { id: 'ambient-smoke', category: 'Ambient', title: 'Slow smoke', tint: 'linear-gradient(135deg,#0f172a,#22d3ee)' },
]

export const BG_LIBRARY: BgClip[] = SEED.map(c => ({
  ...c,
  preview: `/bg/previews/${c.id}.jpg`,
  src: CDN ? `${CDN}/${c.id}.mp4` : `/bg/clips/${c.id}.mp4`,
}))

export const clipsByCategory = (cat: BgCategory): BgClip[] => BG_LIBRARY.filter(c => c.category === cat)
