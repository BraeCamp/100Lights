// A tiny persistent clipboard for piano-roll sound settings (RollFx), so a
// sound shaped on one clip can be pasted onto another — even across sessions
// and projects. Backed by localStorage; a 'sound-clipboard' window event lets
// open panels refresh their Paste button.

import type { RollFx } from './daw-types'
import { FX_FIELDS, fieldIsSet } from './roll-fx'

const KEY = '100lights-sound-clipboard-v1'
export const SOUND_CLIPBOARD_EVENT = 'sound-clipboard'

/** How many parameters a bag actually sets (drives button labels/enablement). */
export function countSetFields(fx: RollFx | null | undefined): number {
  if (!fx) return 0
  return FX_FIELDS.filter(f => fieldIsSet(f.key, fx[f.key])).length
}

export function copySound(fx: RollFx | undefined | null): void {
  try {
    // Always store — even an empty (unchanged) clip, so it can be pasted onto a
    // modified clip to reset it back to defaults.
    localStorage.setItem(KEY, JSON.stringify(fx ?? {}))
  } catch { /* storage unavailable */ }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(SOUND_CLIPBOARD_EVENT))
}

export function getCopiedSound(): RollFx | null {
  try {
    const s = localStorage.getItem(KEY)
    return s ? (JSON.parse(s) as RollFx) : null
  } catch {
    return null
  }
}
