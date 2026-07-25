'use client'

// Shared viewport check so desktop feature components can switch to touch-sized,
// reflowed layouts on a phone. SSR-safe: starts false, updates on mount, so
// desktop rendering is untouched and only <breakpoint viewports get the mobile
// branch. Changing to mobile only affects the studio when actually on a phone.

import { useEffect, useState } from 'react'

export function useIsMobile(breakpoint = 760): boolean {
  const [mobile, setMobile] = useState(false)
  useEffect(() => {
    const check = () => setMobile(window.innerWidth < breakpoint)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [breakpoint])
  return mobile
}
