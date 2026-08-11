'use client'

// Voice → Instrument: bespoke Home first, then the tool. The wrapper adds a Home button
// so the tool component itself stays untouched.
import { useState } from 'react'
import { ChevronLeft } from 'lucide-react'
import VoiceMidi from '@/components/apps/VoiceMidi'
import VoiceMidiHome from '@/components/apps/VoiceMidiHome'

export default function VoiceMidiApp() {
  const [view, setView] = useState<'home' | 'tool'>('home')
  if (view === 'home') return <VoiceMidiHome onStart={() => setView('tool')} />
  return (
    <div style={{ maxWidth: 672, margin: '0 auto', padding: '14px 18px 48px' }}>
      <button type="button" onClick={() => setView('home')}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginBottom: 14, padding: '7px 12px', borderRadius: 9, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
        <ChevronLeft size={16} /> Home
      </button>
      <VoiceMidi />
    </div>
  )
}
