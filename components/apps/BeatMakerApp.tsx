'use client'

// Beat Maker as a small app: its bespoke Home screen first, then the tool. "New beat",
// a groove, or a saved beat all open the tool with the right starting state; the tool's
// Home button returns here.
import { useEffect, useRef, useState } from 'react'
import BeatMaker, { type BeatData } from '@/components/apps/BeatMaker'
import BeatMakerHome from '@/components/apps/BeatMakerHome'
import { useAppShell } from '@/components/apps/AppChrome'

type Open = { data?: BeatData | null; presetId?: string; nonce: number }

export default function BeatMakerApp() {
  const shell = useAppShell()
  const [view, setView] = useState<'home' | 'tool'>('home')
  const [open, setOpen] = useState<Open>({ nonce: 0 })
  const go = (o: Omit<Open, 'nonce'>) => { setOpen(p => ({ ...o, nonce: p.nonce + 1 })); setView('tool') }

  // The tour's targets live in the tool — auto-play it the first time the user gets there.
  const toured = useRef(false)
  useEffect(() => {
    if (view === 'tool' && !toured.current) { toured.current = true; setTimeout(() => shell.startTour(false), 350) }
  }, [view, shell])

  if (view === 'home') {
    return <BeatMakerHome onNew={() => go({ data: null })} onPreset={id => go({ presetId: id })} onOpen={data => go({ data })} />
  }
  return (
    <div style={{ maxWidth: 780, margin: '0 auto', padding: '18px 16px 48px' }}>
      <BeatMaker open={open} onHome={() => setView('home')} />
    </div>
  )
}
