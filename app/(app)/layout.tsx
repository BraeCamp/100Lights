import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import AppLayoutClient from './AppLayoutClient'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { userId } = await auth()
  if (!userId) redirect('/sign-in')
  return <AppLayoutClient>{children}</AppLayoutClient>
}
