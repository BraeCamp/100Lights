import type { Metadata } from 'next'
import dynamic from 'next/dynamic'

const Apollo = dynamic(() => import('@/components/apps/Apollo'))

export const metadata: Metadata = {
  title: 'Apollo',
  robots: { index: false, follow: false },
}

export default function ApolloPage() {
  return <Apollo />
}
