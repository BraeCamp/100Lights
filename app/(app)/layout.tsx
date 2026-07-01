import AppLayoutClient from './AppLayoutClient'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppLayoutClient>{children}</AppLayoutClient>
}
