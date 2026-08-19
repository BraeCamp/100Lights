import type { Metadata } from 'next'
import dynamic from 'next/dynamic'

const NeonGrid = dynamic(() => import('@/components/apps/apollo/shells/NeonGrid'))

export const metadata: Metadata = {
  title: 'Apollo Grid',
  robots: { index: false, follow: false },
}

export default function ApolloTest3Page() {
  return <NeonGrid />
}
