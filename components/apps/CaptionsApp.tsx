'use client'

// Captions: bespoke Home first, then the full-screen editor. Opening a saved set passes it
// into the editor via the `open` prop; the editor's header shows a Home button.
import { useState } from 'react'
import Captions from '@/components/apps/Captions'
import CaptionsHome from '@/components/apps/CaptionsHome'

export default function CaptionsApp() {
  const [view, setView] = useState<'home' | 'editor'>('home')
  const [open, setOpen] = useState<{ data?: unknown; nonce: number }>({ nonce: 0 })

  if (view === 'home') {
    return (
      <CaptionsHome
        onNew={() => setView('editor')}
        onOpen={data => { setOpen(p => ({ data, nonce: p.nonce + 1 })); setView('editor') }}
      />
    )
  }
  return <Captions open={open} onHome={() => setView('home')} />
}
