'use client'
// Popups that fit on the screen, and leave as tidily as they arrive.
//
// Brae: "On most pages, the voice and type controls are on the bottom right of
// the screen so their menus go down and off of the viewport. Make them go up on
// pages that they are on the bottom or make the menus open dynamically to fit
// the viewport."
//
// ⚠️ A FIXED DIRECTION IS A GUESS ABOUT WHERE THE BUTTON IS. Every one of these
// panels was written as `top: 100%` — correct in the transport bar, where the
// control sits near the top of a tall editor, and useless in the corner it sits
// in on every other page, where "below" is off the bottom of the screen. The
// direction is a fact about the anchor's position at the moment it opens, so it
// is measured rather than chosen.

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'

/** Layout effects warn during SSR; nothing here runs on the server anyway. */
const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

export type DropDirection = 'down' | 'up'

/**
 * Which way should a panel of roughly `height` open from this anchor?
 *
 * Measured when it opens, and again on resize — not on scroll, because these
 * anchors are fixed to the viewport and a scroll cannot move them. Falls back
 * to 'down' whenever there is room, so nothing changes in the place this
 * already worked.
 */
export function useDropDirection(
  open: boolean,
  height: number,
  anchor: RefObject<HTMLElement | null>,
  gap = 12,
): DropDirection {
  const [dir, setDir] = useState<DropDirection>('down')

  useIsoLayoutEffect(() => {
    if (!open) return
    const measure = () => {
      const el = anchor.current
      if (!el) return
      const r = el.getBoundingClientRect()
      const below = window.innerHeight - r.bottom - gap
      const above = r.top - gap
      // ⚠️ Only flip when going up is genuinely better. A panel taller than the
      // whole viewport does not fit either way, and flipping it then would trade
      // a clipped bottom for a clipped top while moving the part you were
      // reading off screen.
      setDir(below < height && above > below ? 'up' : 'down')
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [open, height, gap, anchor])

  return dir
}

/**
 * Keep a popup mounted long enough to animate away.
 *
 * ⚠️ Unmounting on close is why closing looked abrupt while opening looked
 * considered: an element removed from the tree cannot animate. This holds it for
 * the length of the exit and reports `leaving` so the right class can be put on
 * it. Opening is unchanged — it mounts and animates in immediately.
 */
export function useMountTransition(open: boolean, exitMs = 110): { mounted: boolean; leaving: boolean } {
  const [mounted, setMounted] = useState(open)
  const [leaving, setLeaving] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
    if (open) { setLeaving(false); setMounted(true); return }
    if (!mounted) return
    setLeaving(true)
    timer.current = setTimeout(() => { setMounted(false); setLeaving(false) }, exitMs)
    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [open, exitMs, mounted])

  return { mounted, leaving }
}

/** The class pair for a popup opening in `dir` — see globals.css. */
export function popClass(dir: DropDirection, leaving: boolean): string {
  if (dir === 'up') return leaving ? 'menu-pop-up-out' : 'menu-pop-up'
  return leaving ? 'menu-pop-out' : 'menu-pop'
}
