// UI scale — Live's "Zoom Display" — for the studio's chrome.
//
// 50–200 %, in steps of ten. It scales the frame around the music: the top
// bar, toolbars and tab bars, the type on buttons, selects and labels, the
// status bar, the track headers' text. It does NOT scale the interactive
// surfaces — the timeline lanes, the ruler, the note grid, knobs, faders —
// whose pointer math maps screen pixels to beats and values through their
// layout size; a CSS `zoom` (tried once, lib/ui-tiers.ts) or a transform on
// those shifts every click by the factor. So the geometry the pointer
// reasons about stays at 1:1 and everything that only has to be READ grows.
//
// Applied like density (lib/ui-density.ts): a generated stylesheet with
// `!important`, because the studio is styled inline, scoped to the audio
// editor, keyed off `data-ui-scale` on the document root so nothing remounts
// when it changes. Type has floors so 50 % is small, not unreadable.

import { UI_SCALE_MIN, UI_SCALE_MAX, clampUiScale } from './display-settings'

export const UI_SCALE_STEPS = Array.from({ length: (UI_SCALE_MAX - UI_SCALE_MIN) / 10 + 1 }, (_, i) => UI_SCALE_MIN + i * 10)

const S = '[data-editor="true"][data-editor-kind="audio"]'

/** A CSS length: `base` px scaled, floored at `min`. */
const px = (base: number, scale: number, min: number) => `${Math.max(min, Math.round(base * scale * 10) / 10)}px`

/**
 * The stylesheet for one scale. 100 % is empty — nothing to override.
 * Everything here is chrome; nothing here is a lane, a grid, a knob or a
 * fader (their sizes are inline and stay).
 */
export function uiScaleCss(pct: number): string {
  const p = clampUiScale(pct)
  if (p === 100) return ''
  const k = p / 100
  const root = `:root[data-ui-scale="${p}"]`
  const out: string[] = [
    // Buttons and selects everywhere in the editor — larger type and height,
    // never below a finger. Width is left alone so labels never clip. FIRST,
    // so the more specific rules below (the top bar's) win the tie on
    // !important by coming later.
    `${root} ${S} button:not([role="slider"]),${root} ${S} select{font-size:${px(11, k, 9)}!important;min-height:${px(22, k, 18)}!important}`,
    // The top bar.
    `${root} ${S} .electron-drag-container{height:${px(46, k, 30)}!important;min-height:${px(46, k, 30)}!important}`,
    `${root} ${S} .electron-drag-container button,${root} ${S} .electron-drag-container select{font-size:${px(12, k, 9)}!important;min-height:${px(28, k, 20)}!important}`,
    // Toolbars, tab bars, the status bar and the mixer row's header opt in
    // with data-ui-chrome or are known by their help ids.
    `${root} ${S} [data-help-id="status-bar"]{height:${px(22, k, 18)}!important;font-size:${px(10.5, k, 9)}!important}`,
    `${root} ${S} [data-help-id="detail-device"] button,${root} ${S} [data-help-id="arrangement-mixer"] select,${root} ${S} [data-help-id="arrangement-mixer-section"]{font-size:${px(11, k, 9)}!important}`,
    // Plain text in the chrome: labels, readouts, headings in panels.
    `${root} ${S} [data-ui-chrome] span,${root} ${S} [data-help-id="detail-clip"] span,${root} ${S} [data-help-id="track-head"] span{font-size:${px(11, k, 8.5)}!important}`,
    // Inputs (clip name, typed values).
    `${root} ${S} input[type="text"],${root} ${S} input:not([type]){font-size:${px(12, k, 9)}!important}`,
  ]
  return out.join('\n')
}

/** Write the scale onto the document and (re)build its stylesheet. */
export function applyUiScale(pct: number): void {
  if (typeof document === 'undefined') return
  const p = clampUiScale(pct)
  document.documentElement.setAttribute('data-ui-scale', String(p))
  document.documentElement.style.setProperty('--ui-scale', String(p / 100))
  let el = document.getElementById('ui-scale') as HTMLStyleElement | null
  if (!el) { el = document.createElement('style'); el.id = 'ui-scale'; document.head.appendChild(el) }
  el.textContent = uiScaleCss(p)
}

/** The next step up or down, clamped. */
export function stepUiScale(pct: number, dir: 1 | -1): number {
  return clampUiScale(clampUiScale(pct) + dir * 10)
}
