// Apollo's chrome grammar, expressed in Beacon's theme variables.
//
// Apollo (components/apps/apollo) has a specific visual language: condensed
// uppercase section titles with wide letter-spacing, 22px controls on a 5px
// radius, a panel/header/inset layering, and dense seams instead of gaps.
// Beacon should read as the same instrument — but Beacon is theme-driven
// (workshop theming), so this module maps Apollo's METRICS onto Beacon's CSS
// variables rather than copying Apollo's hex palette. That way the two look
// like one product and a user's custom theme still applies to both.
//
// Apollo's own reference values, for anyone comparing:
//   title   10px / 800 / letter-spacing 1.4 / uppercase / condensed
//   header  min-height 26, padding 5px 9px
//   control height 22, radius 5, 10.5px / 600
import type { CSSProperties } from 'react'

/** Section title — the small condensed caps Apollo uses on every module. */
export const apTitle: CSSProperties = {
  fontSize: 10,
  fontWeight: 800,
  letterSpacing: 1.4,
  textTransform: 'uppercase',
  fontStretch: 'condensed',
  color: 'var(--text-secondary)',
  whiteSpace: 'nowrap',
}

/** The bar a module hangs under: header fill + a single seam beneath it. */
export const apHeader: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  minHeight: 26,
  padding: '5px 9px',
  background: 'var(--bg-surface)',
  borderBottom: '1px solid var(--border)',
}

/** Apollo's resting control: 22px tall, 5px radius, quiet until touched. */
export const apControl: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 4,
  height: 22,
  padding: '0 8px',
  fontSize: 10.5,
  fontWeight: 600,
  borderRadius: 5,
  background: 'var(--bg-card)',
  border: '1px solid var(--border)',
  color: 'var(--text-secondary)',
  cursor: 'pointer',
  flexShrink: 0,
}

/** Engaged state — accent fill with auto-contrast text (theme-provided). */
export const apControlOn: CSSProperties = {
  ...apControl,
  background: 'var(--accent)',
  border: '1px solid var(--accent)',
  color: 'var(--accent-contrast)',
  fontWeight: 700,
}

/** Square icon button (transport-sized), same grammar as apControl. */
export const apIcon: CSSProperties = {
  ...apControl,
  width: 26,
  height: 26,
  padding: 0,
}

export const apIconOn: CSSProperties = {
  ...apControlOn,
  width: 26,
  height: 26,
  padding: 0,
}

/** Apollo's dropdowns. */
export const apSelect: CSSProperties = {
  height: 22,
  padding: '0 6px',
  fontSize: 10.5,
  fontWeight: 600,
  borderRadius: 5,
  background: 'var(--bg-surface)',
  color: 'var(--text-primary)',
  border: '1px solid var(--border)',
  cursor: 'pointer',
  outline: 'none',
  minWidth: 0,
}

/** A seam, not a gap — Apollo separates controls with a hairline. */
export const apDivider: CSSProperties = {
  width: 1,
  height: 22,
  background: 'var(--border)',
  flexShrink: 0,
  margin: '0 3px',
}

/** Readouts (BPM, position): inset panel, tabular figures. */
export const apReadout: CSSProperties = {
  height: 22,
  display: 'flex',
  alignItems: 'center',
  padding: '0 8px',
  fontSize: 11,
  fontWeight: 700,
  fontVariantNumeric: 'tabular-nums',
  borderRadius: 5,
  background: 'var(--bg-base)',
  border: '1px solid var(--border)',
  color: 'var(--text-primary)',
}

/** LED dot used beside section titles. */
export const apLed = (on: boolean): CSSProperties => ({
  width: 7,
  height: 7,
  borderRadius: '50%',
  background: on ? 'var(--accent)' : 'var(--border-light)',
  display: 'inline-block',
  flexShrink: 0,
})
