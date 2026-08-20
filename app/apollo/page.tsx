import type { Metadata } from 'next'
import dynamic from 'next/dynamic'

const Apollo = dynamic(() => import('@/components/apps/Apollo2'))

// The one Apollo UI (the former /apollo2 experiment, merged back).
export const metadata: Metadata = {
  title: 'Apollo',
  robots: { index: false, follow: false },
}

export default function ApolloPage() {
  return <Apollo />
}
