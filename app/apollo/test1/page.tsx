import type { Metadata } from 'next'
import dynamic from 'next/dynamic'

const AmberConsole = dynamic(() => import('@/components/apps/apollo/shells/AmberConsole'))

export const metadata: Metadata = {
  title: 'Apollo Console',
  robots: { index: false, follow: false },
}

export default function ApolloTest1Page() {
  return <AmberConsole />
}
