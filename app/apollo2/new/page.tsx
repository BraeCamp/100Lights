'use client'
// /apollo2/new — a clean slate on demand: wipes the autosaved patch (and the
// shell's remembered mode/pin prefs stay), then lands in Apollo 2 fresh. The
// current sound is only in localStorage autosave; anything worth keeping
// should be Saved as a preset first (undo history does not survive reloads).

import { useEffect } from 'react'

export default function Apollo2NewPage() {
  useEffect(() => {
    try { localStorage.removeItem('apollo_current_patch_v1') } catch { /* fine */ }
    window.location.replace('/apollo2')
  }, [])
  return (
    <div style={{ minHeight: '100vh', background: '#0a0c0f', color: '#8b96a5', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13 }}>
      Starting fresh…
    </div>
  )
}
