// How much room the studio's chrome takes, without removing any of it.
//
// This is NOT the tier system. Tiers hide controls you don't need yet; density
// keeps every single control and makes the frame around them thinner. The two
// compose — "Everything" at "Dense" is the full studio in the least space.
//
// Two constraints shaped the implementation:
//
// 1. NO scaling. A per-tier CSS `zoom` used to live in lib/ui-tiers and was
//    removed because zoom shifts the pointer coordinate space, so clicks in the
//    piano roll and timeline landed down-and-right by the zoom factor. Density
//    only ever changes padding, font-size and fixed heights, never the geometry
//    of an interactive surface.
//
// 2. `!important`, because the studio is styled with inline styles — Transport
//    alone has 110 of them and almost no classNames. An ordinary rule loses to
//    a style attribute; this is the same reason tierVisibilityCss uses it.
//
// Track rows scale too, and that is where most of the space actually is — but
// only at RENDER time. A track's height is stored ON the track, inside the
// project, so writing to it would mean a view preference on one machine quietly
// resizing the song for everyone who opens it.

export type UIDensity = 'comfortable' | 'compact' | 'dense'
export const UI_DENSITIES: UIDensity[] = ['comfortable', 'compact', 'dense']

export const DENSITY_INFO: Record<UIDensity, { label: string; blurb: string }> = {
  comfortable: { label: 'Comfortable', blurb: 'Default spacing.' },
  compact:     { label: 'Compact',     blurb: 'Tighter chrome — same controls, more room for the song.' },
  dense:       { label: 'Dense',       blurb: 'As small as the controls go while staying clickable.' },
}

export function isUIDensity(v: unknown): v is UIDensity {
  return typeof v === 'string' && (UI_DENSITIES as string[]).includes(v)
}

/**
 * How much of its stored height a track row draws at.
 *
 * This is where the space actually is. The chrome — toolbars, buttons, tab bar —
 * is about 140px of an 860px window, so tightening all of it buys ~16px. Eight
 * tracks at 64px are 512px of the same window. Scaling the row is worth more
 * than everything else here put together.
 *
 * Applied at RENDER time only. `track.height` is stored on the track, inside the
 * project, so writing to it would mean a view preference on one machine quietly
 * resizing the song for everyone who opens it.
 */
export const DENSITY_ROW_SCALE: Record<UIDensity, number> = {
  comfortable: 1,
  compact: 0.82,
  dense: 0.72,
}

/** Per-level scale factors. 1 = leave it alone. */
const LEVELS: Record<Exclude<UIDensity, 'comfortable'>, {
  bar: number; pad: number; font: number; gap: number; minTouch: number
}> = {
  compact: { bar: 40, pad: 0.7, font: 0.92, gap: 0.75, minTouch: 24 },
  dense:   { bar: 32, pad: 0.5, font: 0.85, gap: 0.55, minTouch: 20 },
}

/**
 * The density stylesheet.
 *
 * Scoped to the audio editor so nothing leaks into the rest of the site, and
 * every rule keeps a minimum hit target — a control small enough to be hard to
 * click is not "denser", it is broken.
 */
export function densityCss(): string {
  const out: string[] = []
  for (const [level, v] of Object.entries(LEVELS)) {
    const S = `[data-ui-density="${level}"] [data-editor-kind="audio"]`
    out.push(
      // The top transport bar is a fixed height and the single biggest strip.
      `${S} .electron-drag-container{height:${v.bar}px!important;min-height:${v.bar}px!important}`,
      // Buttons and selects everywhere inside the editor: thinner, never smaller
      // than a finger. Width is left alone so labels never clip.
      `${S} button,${S} select{padding-top:${(5 * v.pad).toFixed(1)}px!important;padding-bottom:${(5 * v.pad).toFixed(1)}px!important;min-height:${v.minTouch}px!important}`,
      // Type in the top bar comes down a notch, floored so nothing is unreadable.
      `${S} .electron-drag-container button,${S} .electron-drag-container select{font-size:max(10px,${(12 * v.font).toFixed(1)}px)!important}`,
      // Any row that opts in. Nothing carries this yet — it is the extension
      // point for tightening a specific strip without touching everything.
      `${S} [data-ui-chrome]{padding-top:${(6 * v.pad).toFixed(1)}px!important;padding-bottom:${(6 * v.pad).toFixed(1)}px!important;gap:${(8 * v.gap).toFixed(1)}px!important}`,
    )
  }
  return out.join('\n')
}
