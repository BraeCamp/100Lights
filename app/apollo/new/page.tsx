'use client'
// /apollo/new — a clean slate on demand: wipes the autosaved patch, then lands
// in Apollo fresh. Saved presets are untouched.

import { useEffect } from 'react'

export default function ApolloNewPage() {
  useEffect(() => {
    try { localStorage.removeItem('apollo_current_patch_v1') } catch { /* fine */ }
    window.location.replace('/apollo')
  }, [])
  return (
    <div style={{ minHeight: '100vh', background: '#0a0c0f', color: '#8b96a5', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13 }}>
      Starting fresh…
    </div>
  )
}
