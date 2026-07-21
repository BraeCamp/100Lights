import { Guitar, Gauge, Piano } from 'lucide-react'

/** The free tools, for cross-promo strips. One source so /learn and elsewhere agree. */
export const TOOL_PROMOS = [
  { href: '/tools/tuner', icon: Guitar, title: 'Tuner', hook: 'Tune by ear', from: '#f472b6', to: '#a855f7' },
  { href: '/tools/metronome', icon: Gauge, title: 'Metronome', hook: 'Tap the tempo', from: '#38bdf8', to: '#3b82f6' },
  { href: '/tools/chord-progressions', icon: Piano, title: 'Chord Teacher', hook: 'Hear & transpose', from: '#34d399', to: '#10b981' },
] as const
