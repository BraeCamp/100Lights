import type { Metadata } from 'next'
import dynamic from 'next/dynamic'

const Apollo2 = dynamic(() => import('@/components/apps/Apollo2'))

// The restructured minimal UI: voice-chain layout, "+"-grown inventories,
// quick-mod knobs, three tabs, Movement drawer, signal-flow glow. Same engine
// and state as /apollo (which keeps the original UI for comparison).
export const metadata: Metadata = {
  title: 'Apollo 2',
  robots: { index: false, follow: false },
}

export default function Apollo2Page() {
  return <Apollo2 />
}
