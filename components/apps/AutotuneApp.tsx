'use client'

// Autotune: bespoke Home first, then the tool. The wrapper adds a Home button and starts
// the guided tour the first time the tool opens.
import { useEffect, useRef, useState } from 'react'
import { ChevronLeft } from 'lucide-react'
import Autotune from '@/components/apps/Autotune'
import AutotuneHome from '@/components/apps/AutotuneHome'
import { useAppShell } from '@/components/apps/AppChrome'

export default function AutotuneApp() {
  const shell = useAppShell()
  const [view, setView] = useState<'home' | 'tool'>('home')
  const toured = useRef(false)
  useEffect(() => {
    if (view === 'tool' && !toured.current) { toured.current = true; setTimeout(() => shell.startTour(false), 400) }
  }, [view, shell])

  if (view === 'home') return <AutotuneHome onStart={() => setView('tool')} />
  return (
    <div style={{ maxWidth: 672, margin: '0 auto', padding: '14px 18px 48px' }}>
      <button type="button" onClick={() => setView('home')}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginBottom: 14, padding: '7px 12px', borderRadius: 9, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
        <ChevronLeft size={16} /> Home
      </button>
      <Autotune />
    </div>
  )
}
