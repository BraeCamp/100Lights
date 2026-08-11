// A light haptic "tap" for tactile controls (drum pads, cells, big buttons).
// Uses @capacitor/haptics — real haptics inside the native app, and its web
// implementation falls back to navigator.vibrate in the browser (a no-op where
// vibration isn't supported, e.g. desktop Safari). All calls are best-effort.
import { Haptics, ImpactStyle } from '@capacitor/haptics'

export function tapHaptic(style: 'light' | 'medium' = 'light') {
  try {
    void Haptics.impact({ style: style === 'medium' ? ImpactStyle.Medium : ImpactStyle.Light }).catch(() => {})
  } catch { /* unsupported / SSR */ }
}
