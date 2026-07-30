/**
 * Studio UI complexity tiers.
 *
 * Three versions of the studio, from fewest controls to all of them. The user
 * picks one on their first project (see the first-run prompt) and can switch
 * any time. Switching is instant and loses no work — controls are hidden with
 * CSS, never unmounted.
 *
 * HOW GATING WORKS: almost every studio control already carries a stable
 * `data-help-id`. This file maps those ids (plus a few `data-ui-el` ids added
 * where a control had none) to the MINIMUM tier that shows them. The provider
 * turns this map into one stylesheet. To move a control between tiers, edit
 * ELEMENT_MIN_TIER below — nothing else. Anything not listed is "essential" and
 * shows in every tier.
 */

export type UITier = 'beginner' | 'intermediate' | 'full'

export const UI_TIERS: UITier[] = ['beginner', 'intermediate', 'full']

export const TIER_RANK: Record<UITier, number> = { beginner: 0, intermediate: 1, full: 2 }

export function tierAtLeast(current: UITier, required: UITier): boolean {
  return TIER_RANK[current] >= TIER_RANK[required]
}

export function isUITier(v: unknown): v is UITier {
  return v === 'beginner' || v === 'intermediate' || v === 'full'
}

export interface TierInfo {
  id: UITier
  name: string       // short label for the switcher
  tagline: string    // one-liner
  description: string // shown in the first-run prompt — says what it means for the UI
  shows: string      // plain-language summary of what's visible
}

export const TIER_INFO: Record<UITier, TierInfo> = {
  beginner: {
    id: 'beginner',
    name: 'Simple',
    tagline: 'Just the essentials',
    description: 'A clean, focused studio. You get everything you need to play, record, make beats, and save your song — and nothing else in the way while you learn.',
    shows: 'Play & record · instruments · beats · save & export',
  },
  intermediate: {
    id: 'intermediate',
    name: 'Standard',
    tagline: 'The everyday toolkit',
    description: 'Most of the studio: looping, snapping, key & scale, effects on tracks, the mixer, the step sequencer, version history, and screen capture. A few experimental and pro tools stay tucked away.',
    shows: 'Everything in Simple + loop, snap, key/scale, mixer, effects, version history',
  },
  full: {
    id: 'full',
    name: 'Everything',
    tagline: 'Every control, nothing hidden',
    description: 'The complete studio with every tool unlocked — performance FX, varispeed, spectral morphing, masking analysis, ripple editing, transient slicing, the code panel, and all the rest.',
    shows: 'Everything in Standard + performance FX, varispeed, spectral & masking tools, code panel',
  },
}

/**
 * Minimum tier that SHOWS each control. Keyed by `data-help-id` (existing) or
 * `data-ui-el` (added where a control had no help-id). Tune freely.
 */
export const ELEMENT_MIN_TIER: Record<string, UITier> = {
  // ── Show from Standard up (hidden for beginners) ──
  'loop': 'intermediate',
  'snap': 'intermediate',
  'key-scale': 'intermediate',
  'time-sig': 'intermediate',
  'tap-tempo': 'intermediate',
  'fx-lane': 'intermediate',
  'capture': 'intermediate',
  'versions': 'intermediate',
  'view-mixer': 'intermediate',
  'automation': 'intermediate',

  // ── Show only in Everything (hidden for beginner + standard) ──
  'jam': 'full',
  'perf-fx': 'full',
  'swing': 'full',
  'varispeed': 'full',
  'tuner': 'full',
  'masking': 'full',
  'ripple': 'full',
  'split-transients': 'full',
  'morph': 'full',
  'wf-zoom': 'full',
  'sound-code': 'full',
  'my-mix': 'full',
  'takes': 'full',
  'add-return': 'full',
  'practice': 'full',
  'inspect': 'full',
  'duplicate-cleanup': 'full',
}

/**
 * Generate the stylesheet that hides each control for the tiers below its
 * minimum. Matches both `data-help-id` and `data-ui-el` so existing controls
 * are gated with no new markup.
 */
export function tierVisibilityCss(): string {
  const out: string[] = []
  for (const [key, min] of Object.entries(ELEMENT_MIN_TIER)) {
    for (const t of UI_TIERS) {
      if (TIER_RANK[t] < TIER_RANK[min]) {
        out.push(
          `[data-ui-tier="${t}"] [data-help-id="${key}"],` +
          `[data-ui-tier="${t}"] [data-ui-el="${key}"]{display:none!important}`,
        )
      }
    }
  }
  return out.join('\n')
}
