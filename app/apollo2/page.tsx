import type { Metadata } from 'next'
import dynamic from 'next/dynamic'

const Apollo = dynamic(() => import('@/components/apps/Apollo'))

// The UI experiment copy: currently identical to /apollo. UI restructuring
// (progressive disclosure, signal-chain grouping) lands HERE first so the two
// can be compared on production; /apollo stays stable.
export const metadata: Metadata = {
  title: 'Apollo 2',
  robots: { index: false, follow: false },
}

export default function Apollo2Page() {
  return <Apollo />
}
