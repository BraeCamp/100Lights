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
import { useEffect, useState } from 'react'
import type { ApolloTheme } from './ApolloContext'

/** Every custom property the workshop theme can set. Mirrored onto the Apollo
 *  window so its subtree inherits the user's palette. */
const THEME_VARS = [
  '--bg-base', '--bg-surface', '--bg-card', '--bg-card-hover',
  '--border', '--border-light',
  '--text-primary', '--text-secondary', '--text-muted',
  '--accent', '--accent-hover', '--accent-light', '--accent-subtle',
  '--accent-rgb', '--accent-contrast',
  '--success', '--warning', '--error',
  '--workshop-pattern', '--workshop-pattern-size',
]

/**
 * Where Beacon's theme actually lives.
 *
 * WorkshopThemeProvider scopes its custom properties to [data-editor="true"],
 * NOT to :root — so reading documentElement gets the stock palette from
 * globals.css and misses every customization the user has made. This finds the
 * themed element, falling back to the document (standalone Apollo, or any page
 * with no editor on it).
 */
export function themeSource(): Element | null {
  if (typeof document === 'undefined') return null
  return document.querySelector('[data-editor="true"]') ?? document.documentElement
}

/** The theme's variables, ready to spread onto an element's inline style. */
export function beaconThemeVars(): Record<string, string> {
  const src = themeSource()
  if (!src || src === document.documentElement) return {}
  const cs = getComputedStyle(src)
  const out: Record<string, string> = {}
  for (const name of THEME_VARS) {
    const v = cs.getPropertyValue(name).trim()
    if (v) out[name] = v
  }
  return out
}

/**
 * Re-render when the workshop theme changes.
 *
 * The Apollo window is portalled to document.body, which puts it OUTSIDE the
 * [data-editor] subtree the theme is scoped to — so it inherits nothing and
 * would never notice a change either. Watching the provider's own <style>
 * element keeps this free of any import from Beacon (which the dependency rule
 * forbids) while still tracking every edit the customizer makes.
 */
export function useBeaconThemeVersion(): number {
  const [v, setV] = useState(0)
  useEffect(() => {
    if (typeof document === 'undefined') return
    const bump = () => setV(n => n + 1)
    const obs = new MutationObserver(bump)
    const style = document.getElementById('workshop-theme')
    if (style) obs.observe(style, { childList: true, characterData: true, subtree: true })
    // The style element is created lazily, and the editor can change kind
    // (which switches which override block applies), so watch for both.
    obs.observe(document.head, { childList: true })
    const host = document.querySelector('[data-editor="true"]')
    if (host) obs.observe(host, { attributes: true, attributeFilter: ['data-editor-kind', 'style', 'class'] })
    return () => obs.disconnect()
  }, [])
  return v
}

/**
 * Read any colour a CSS variable might hold.
 *
 * Not just #rrggbb: a hand-written theme can perfectly well say `#222`, and
 * getComputedStyle hands back `rgb(...)` for some values. The 6-digit-only
 * version silently returned the input unchanged, which collapsed every derived
 * shade — knob faces, insets and panel gradients all landed on the same colour
 * as the surface behind them.
 */
export function parseColor(input: string): [number, number, number] | null {
  const s = (input || '').trim()
  const short = /^#?([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(s)
  if (short) return [short[1], short[2], short[3]].map(c => parseInt(c + c, 16)) as [number, number, number]
  const long = /^#?([0-9a-f]{6})$/i.exec(s)
  if (long) {
    const n = parseInt(long[1], 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  }
  const fn = /^rgba?\(([^)]+)\)$/i.exec(s)
  if (fn) {
    const parts = fn[1].split(/[,\s/]+/).filter(Boolean).slice(0, 3).map(Number)
    if (parts.length === 3 && parts.every(n => Number.isFinite(n))) return parts as [number, number, number]
  }
  return null
}

/** Nudge a hex toward black/white — Apollo layers panel/header/inset shades
 *  that Beacon has no exact variable for, so they are derived instead of
 *  guessed. `amt` > 0 lightens, < 0 darkens. */
export function shade(hex: string, amt: number): string {
  const rgb = parseColor(hex)
  if (!rgb) return hex
  const ch = rgb.map(c => {
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
  const src = themeSource()
  if (!src) return null
  const cs = getComputedStyle(src)
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
