'use client'

// Apollo wearing Beacon's colours.
//
// The two halves of the visual language were only ever joined in one
// direction: components/editor/daw/apollo-chrome maps Apollo's METRICS
// (condensed caps, 22px controls, 5px radius, dense seams) onto Beacon's CSS
// variables, so Beacon reads as the same instrument. But Apollo's own palette
// is a module of hardcoded hex, so the Apollo window sitting inside Beacon kept
// its own greys and blue accent no matter what theme Beacon was wearing — two
// programs in one window.
//
// This closes the loop. Apollo's UI palette is RESOLVED from Beacon's live
// theme variables, so a workshop theme applies to both surfaces at once.
//
// Resolved to concrete colours rather than left as var() strings on purpose:
// Apollo draws its scopes, wavetables and clip roll on canvas, and
// ctx.fillStyle = 'var(--accent)' is not a colour — it fails silently and the
// visualisation goes black. Every value here has to survive being handed to a
// canvas context.

// Type-only: a runtime import would close a cycle, since ApolloContext imports
// beaconPalette back.
import type { ApolloTheme } from './ApolloContext'

/** Nudge a hex toward black/white — Apollo layers panel/header/inset shades
 *  that Beacon has no exact variable for, so they are derived instead of
 *  guessed. `amt` > 0 lightens, < 0 darkens. */
export function shade(hex: string, amt: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return hex
  const n = parseInt(m[1], 16)
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(c => {
    const t = amt > 0 ? 255 : 0
    return Math.round(c + (t - c) * Math.abs(amt))
  })
  return `#${ch.map(c => c.toString(16).padStart(2, '0')).join('')}`
}

/**
 * Read Beacon's theme off the document and express Apollo's palette in it.
 *
 * Returns null when there is nothing to read (SSR, or a page that does not
 * define Beacon's variables) so the caller keeps Apollo's own defaults —
 * standalone /apollo must look exactly as it always has.
 */
export function beaconPalette(): ApolloTheme | null {
  if (typeof window === 'undefined' || typeof document === 'undefined') return null
  const cs = getComputedStyle(document.documentElement)
  const v = (name: string): string => cs.getPropertyValue(name).trim()

  const base = v('--bg-base')
  const surface = v('--bg-surface')
  const card = v('--bg-card')
  const border = v('--border')
  const borderLight = v('--border-light')
  const text = v('--text-primary')
  const muted = v('--text-muted')
  const accent = v('--accent')
  // Beacon's variables are absent on pages that never load its theme.
  if (!base || !card || !accent) return null

  return {
    bg: base,
    panel: card,
    header: surface,
    inset: shade(base, -0.25),
    border,
    borderLight: borderLight || shade(border, 0.15),
    blue: accent,
    blueDim: shade(accent, -0.35),
    text,
    dim: muted,
    // Knob faces sit just above the panel so the arc reads against them.
    knob: shade(card, 0.06),
    knobHi: shade(card, 0.18),
    knobMid: shade(card, 0.02),
    knobLo: shade(card, -0.12),
    panelLo: shade(card, -0.1),
    headerLo: shade(surface, -0.08),
    // green/yellow are VIZ colours, not chrome — waveform traces and playheads
    // read as instrument-standard and are deliberately left alone. Retheming
    // them to the accent would make a scope indistinguishable from a control.
  }
}
