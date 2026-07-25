'use client'

// Shared viewport check so desktop feature components can switch to touch-sized,
// reflowed layouts on a phone. SSR-safe: starts false, updates on mount, so
// desktop rendering is untouched and only <breakpoint viewports get the mobile
// branch. Changing to mobile only affects the studio when actually on a phone.
//
// ForceMobileContext lets a container (the mobile studio at /m, /new, and opened
// projects) declare "everything inside me is mobile" so the shared components
// (Mixer, ArrangementView, PadInput, …) render their mobile layout even when the
// window happens to be ≥ breakpoint (desktop browser, tablet, wide window).

import { createContext, useContext, useEffect, useState } from 'react'

export const ForceMobileContext = createContext(false)

export function useIsMobile(breakpoint = 760): boolean {
  const forced = useContext(ForceMobileContext)
  const [mobile, setMobile] = useState(false)
  useEffect(() => {
    const check = () => {
      const w = window.innerWidth, h = window.innerHeight
      // A phone rotated to landscape is wide but has a short side — keep it on
      // the mobile UI (a coarse/touch pointer + short side), not just width, so
      // "widescreen" phones don't fall through to the desktop layout.
      const coarse = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches
      setMobile(w < breakpoint || (coarse && Math.min(w, h) < breakpoint))
    }
    check()
    window.addEventListener('resize', check)
    window.addEventListener('orientationchange', check)
    return () => {
      window.removeEventListener('resize', check)
      window.removeEventListener('orientationchange', check)
    }
  }, [breakpoint])
  return forced || mobile
}
