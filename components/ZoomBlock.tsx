'use client'

import { useEffect } from 'react'

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
