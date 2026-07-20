'use client'

import { useEffect, useState } from 'react'

/**
 * Whether ⌥ Option is currently held.
 *
 * Native `<input type="range">` fires `onChange` without modifier state, so a
 * slider that behaves differently under ⌥ has to track the key separately.
 * Drag-based controls (see Knob.tsx) read `ev.altKey` off the move event and
 * don't need this.
 *
 * Also clears on blur: alt-tabbing away can otherwise swallow the keyup and
 * leave the flag stuck on after the user comes back.
 */
export function useAltKey(): boolean {
  const [alt, setAlt] = useState(false)
  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (e.altKey) setAlt(true) }
    const up = (e: KeyboardEvent) => { if (!e.altKey) setAlt(false) }
    const clear = () => setAlt(false)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', clear)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', clear)
    }
  }, [])
  return alt
}
