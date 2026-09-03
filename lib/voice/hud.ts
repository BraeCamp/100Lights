'use client'
// ── Everything but the song ─────────────────────────────────────────────────
//
// Brae: "Add a button that toggles HUD. When that is pressed, it will get rid of
// everything but the song and Apollo's sound visuals."
//
// Done the same way the complexity tiers are done — an attribute on the editor
// root and one stylesheet — rather than by threading a boolean through forty
// components. The studio has a lot of chrome and every piece of it lives
// somewhere different; a prop would have to reach all of them, and the ones it
// failed to reach would be exactly the ones nobody noticed until the HUD was on.
//
// What is marked is the chrome that goes away, not the song that stays.

const HUD_KEY = 'beacon.voice.hud'

/**
 * Marks chrome that HUD mode puts away.
 *
 * What is marked is what GOES, not what stays: the arrangement and the sound
 * visuals need to know nothing about this mode, so a new part of the timeline
 * cannot forget to opt in and vanish.
 */
export const HUD_HIDE = 'data-hud-hide'

export function hudOn(): boolean {
  try { return localStorage.getItem(HUD_KEY) === 'on' } catch { return false }
}

export function setHud(on: boolean): void {
  try { localStorage.setItem(HUD_KEY, on ? 'on' : 'off') } catch { /* private mode */ }
  applyHud(on)
}

/**
 * Put the studio into (or out of) HUD mode.
 *
 * Applied to every open editor rather than a remembered one, because there is
 * only ever one on screen and finding it by attribute is more robust than
 * holding a ref to it across a mode that deliberately unmounts things.
 */
export function applyHud(on: boolean): void {
  if (typeof document === 'undefined') return
  for (const el of document.querySelectorAll('[data-editor="true"]')) {
    if (on) el.setAttribute('data-hud', 'on')
    else el.removeAttribute('data-hud')
  }
}

/**
 * The stylesheet.
 *
 * A curated HIDE-list rather than the inverted "hide everything, re-show what is
 * marked" rule that looked cleaner on paper. Inverting it hides the studio's own
 * transport bar, and the button that turns HUD off lives there — a mode you
 * cannot leave from inside is a trap, and the first person to find that out
 * would be whoever pressed the button.
 *
 * The trade is real and worth stating: chrome added later is NOT hidden
 * automatically, so a new panel needs the attribute. That is a smaller failure
 * (something extra on screen) than the alternative (no way out), and it shows
 * itself the moment anybody uses the mode.
 */
export function hudCss(): string {
  return `
[data-editor="true"][data-hud="on"] [${HUD_HIDE}] { display: none !important; }
[data-editor="true"][data-hud="on"] { background-image: none !important; }
`.trim()
}
