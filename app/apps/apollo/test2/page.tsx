import type { Metadata } from 'next'
import dynamic from 'next/dynamic'

const Porcelain = dynamic(() => import('@/components/apps/apollo/shells/Porcelain'))

export const metadata: Metadata = {
  title: 'Apollo Porcelain',
  robots: { index: false, follow: false },
}

export default function ApolloTest2Page() {
  return <Porcelain />
}
