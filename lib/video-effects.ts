// Video clip EFFECTS — a registry of named looks/grades expressed as CSS filter chains. The compositor
// applies these via ctx.filter (buildClipGradeFilter), so ONE definition works in both the live preview
// AND the exported render. Adding a new effect is a one-liner: append `{ id, name, css }` below.
//
// The cinematic grades are ported from Lightning Bug's VIDEO_LOOKS (components/apps/LightningBug) so the
// video module shares LB's visual identity; the rest are new. Overlay-/shader-based LB looks (grain,
// vignette, ink, oil, glitch…) need the compositor's overlay layer and land in a later pass — these are
// the pure color grades, which carry most of the look and are export-safe today.

export interface VideoEffect {
  id: string
  name: string
  css: string                 // a CSS filter chain (brightness/contrast/saturate/sepia/hue-rotate/…)
  category: 'Cinematic' | 'Color' | 'Mood' | 'Stylize'
}

export const VIDEO_EFFECTS: VideoEffect[] = [
  // ── Cinematic (ported from Lightning Bug) ─────────────────────────────────
  { id: 'film',        name: 'Film',        category: 'Cinematic', css: 'contrast(1.05) saturate(1.05) sepia(0.12)' },
  { id: 'dream',       name: 'Dream',       category: 'Cinematic', css: 'brightness(1.05) saturate(1.1)' },
  { id: 'noir',        name: 'Noir',        category: 'Cinematic', css: 'grayscale(1) contrast(1.32) brightness(1.02)' },
  { id: 'warm',        name: 'Warm',        category: 'Cinematic', css: 'sepia(0.25) saturate(1.3) contrast(1.05) brightness(1.03)' },
  { id: 'cool',        name: 'Cool',        category: 'Cinematic', css: 'saturate(1.15) hue-rotate(-12deg) brightness(1.02)' },
  { id: 'blockbuster', name: 'Blockbuster', category: 'Cinematic', css: 'contrast(1.1) saturate(1.12) brightness(1.02)' },
  { id: 'neonnoir',    name: 'Neon-noir',   category: 'Cinematic', css: 'saturate(1.5) contrast(1.32) brightness(0.9)' },
  { id: 'bleach',      name: 'Bleach',      category: 'Cinematic', css: 'saturate(0.42) contrast(1.4) brightness(1.05)' },
  { id: 'giallo',      name: 'Giallo',      category: 'Cinematic', css: 'saturate(1.65) contrast(1.16) hue-rotate(-6deg) brightness(1.02)' },
  { id: 'lean',        name: 'Lean',        category: 'Cinematic', css: 'sepia(0.5) hue-rotate(215deg) saturate(1.5) contrast(1.05)' },
  { id: 'spotlight',   name: 'Spotlight',   category: 'Cinematic', css: 'contrast(1.32) brightness(0.97) saturate(1.05)' },

  // ── Color ─────────────────────────────────────────────────────────────────
  { id: 'vibrant',     name: 'Vibrant',     category: 'Color', css: 'saturate(1.4) contrast(1.08) brightness(1.02)' },
  { id: 'punch',       name: 'Punch',       category: 'Color', css: 'saturate(1.55) contrast(1.28)' },
  { id: 'muted',       name: 'Muted',       category: 'Color', css: 'saturate(0.7) contrast(0.96) brightness(1.03)' },
  { id: 'golden',      name: 'Golden hour', category: 'Color', css: 'sepia(0.3) saturate(1.25) brightness(1.05) hue-rotate(-8deg)' },
  { id: 'icy',         name: 'Icy',         category: 'Color', css: 'hue-rotate(14deg) saturate(1.12) brightness(1.05) contrast(1.04)' },
  { id: 'dusk',        name: 'Dusk',        category: 'Color', css: 'hue-rotate(-18deg) saturate(1.2) brightness(0.95) contrast(1.06)' },
  { id: 'crimson',     name: 'Crimson',     category: 'Color', css: 'hue-rotate(-24deg) saturate(1.4) contrast(1.1)' },

  // ── Mood ──────────────────────────────────────────────────────────────────
  { id: 'moody',       name: 'Moody',       category: 'Mood', css: 'brightness(0.9) contrast(1.16) saturate(0.95)' },
  { id: 'faded',       name: 'Faded',       category: 'Mood', css: 'contrast(0.88) saturate(0.85) brightness(1.06)' },
  { id: 'washed',      name: 'Washed',      category: 'Mood', css: 'brightness(1.1) contrast(0.84) saturate(0.68)' },
  { id: 'vintage',     name: 'Vintage',     category: 'Mood', css: 'sepia(0.35) contrast(1.1) saturate(0.9) brightness(1.02)' },
  { id: 'bright',      name: 'Bright & airy', category: 'Mood', css: 'brightness(1.1) contrast(0.95) saturate(1.08)' },

  // ── Stylize ───────────────────────────────────────────────────────────────
  { id: 'mono',        name: 'B&W',         category: 'Stylize', css: 'grayscale(1) contrast(1.12) brightness(1.02)' },
  { id: 'sepia',       name: 'Sepia',       category: 'Stylize', css: 'sepia(0.85) contrast(1.05) brightness(1.03)' },
  { id: 'infrared',    name: 'Infrared',    category: 'Stylize', css: 'hue-rotate(90deg) saturate(2) contrast(1.1)' },
  { id: 'negative',    name: 'Negative',    category: 'Stylize', css: 'invert(1)' },
  { id: 'thermal',     name: 'Thermal',     category: 'Stylize', css: 'hue-rotate(150deg) saturate(2.4) contrast(1.2) brightness(1.05)' },
]

const BY_ID = new Map(VIDEO_EFFECTS.map(e => [e.id, e]))

export const getEffect = (id?: string | null): VideoEffect | undefined => (id ? BY_ID.get(id) : undefined)

/** The CSS filter chain for an effect id ('' when none / unknown). Appended after the clip's own grade. */
export function effectCss(id?: string | null): string {
  return getEffect(id)?.css ?? ''
}

/** Effects grouped by category, for a picker UI. */
export function effectsByCategory(): { category: VideoEffect['category']; effects: VideoEffect[] }[] {
  const cats: VideoEffect['category'][] = ['Cinematic', 'Color', 'Mood', 'Stylize']
  return cats.map(category => ({ category, effects: VIDEO_EFFECTS.filter(e => e.category === category) }))
}
