'use client'

import { useEffect, useState } from 'react'

/**
 * Window-chrome state for the Electron desktop app.
 *
 * `padTrafficLights` is true only when the macOS traffic lights are actually
 * occupying the top-left corner — i.e. running in the Mac desktop app and NOT
 * fullscreen (macOS hides the lights with the menu bar in fullscreen). Use it
 * to gate the extra left padding on top bars.
 *
 * Feature-detects the fullscreen bridge so a newer web deploy keeps working
 * inside an older desktop binary (it just always pads, as before).
 */
export function useElectronChrome(): { isElectronMac: boolean; isFullscreen: boolean; padTrafficLights: boolean } {
  const [isElectronMac, setIsElectronMac] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)

  useEffect(() => {
    const api = window.electronAPI
    if (!api || !navigator.platform.startsWith('Mac')) return
    // Defer the initial flip out of the effect body (lint: no sync setState in effects)
    const t = window.setTimeout(() => setIsElectronMac(true), 0)
    if (typeof api.isFullScreen !== 'function' || typeof api.onFullScreenChanged !== 'function') {
      return () => window.clearTimeout(t)
    }
    api.isFullScreen().then(setIsFullscreen).catch(() => {})
    const unsub = api.onFullScreenChanged(setIsFullscreen)
    return () => { window.clearTimeout(t); unsub() }
  }, [])

  return { isElectronMac, isFullscreen, padTrafficLights: isElectronMac && !isFullscreen }
}
