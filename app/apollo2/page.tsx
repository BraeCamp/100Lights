import type { Metadata } from 'next'
import dynamic from 'next/dynamic'

const Apollo2 = dynamic(() => import('@/components/apps/Apollo2'))

// The approachability experiment: /apollo recomposed around new users
// (Play mode first, full Design mode one click away). Hidden while the
// two versions are compared side by side on production.
export const metadata: Metadata = {
  title: 'Apollo 2',
  robots: { index: false, follow: false },
}

export default function Apollo2Page() {
  return <Apollo2 />
}
