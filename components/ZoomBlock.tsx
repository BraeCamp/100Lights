'use client'

import { useEffect } from 'react'

// Mounted by EDITOR routes only (create/, projects/[id]/, lab/), next to their
// zoom-locking `viewport` export: pinch and ctrl+wheel are editing gestures
// there. Ordinary pages keep browser zoom (WCAG 1.4.4).
export default function ZoomBlock() {
  useEffect(() => {
    const onWheel = (e: WheelEvent) => { if (e.ctrlKey || e.metaKey) e.preventDefault() }
    const onGesture = (e: Event) => e.preventDefault()
    document.addEventListener('wheel', onWheel, { passive: false })
    document.addEventListener('gesturestart', onGesture)
    document.addEventListener('gesturechange', onGesture)
    return () => {
      document.removeEventListener('wheel', onWheel)
      document.removeEventListener('gesturestart', onGesture)
      document.removeEventListener('gesturechange', onGesture)
    }
  }, [])
  return null
}
