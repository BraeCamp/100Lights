'use client'

// Highlights the download button matching the visitor's OS on the client, so
// the /download page can stay static (no server-side user-agent sniffing).

import { useEffect } from 'react'

export default function PlatformHighlight() {
  useEffect(() => {
    const ua = navigator.userAgent
    const plat = /Mac|iPhone|iPad/.test(ua) ? 'mac' : /Win/.test(ua) ? 'win' : null
    if (!plat) return
    const el = document.querySelector<HTMLElement>(`a[data-dl="${plat}"]`)
    if (el) {
      el.style.background = '#6366f1'
      el.style.border = 'none'
      el.style.boxShadow = '0 4px 24px rgba(99,102,241,0.4)'
    }
  }, [])
  return null
}
