'use client'

import { usePathname } from 'next/navigation'
import Sidebar from '@/components/layout/Sidebar'
import { UpgradeModalProvider } from '@/components/UpgradeModal'

export default function AppLayoutClient({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const isEditor = pathname === '/new' || (pathname.startsWith('/projects/') && pathname !== '/projects')

  if (isEditor) {
    return (
      <UpgradeModalProvider>
        <div className="h-full">{children}</div>
      </UpgradeModalProvider>
    )
  }

  return (
    <UpgradeModalProvider>
      <div className="flex h-full">
        <Sidebar />
        <main className="flex-1 overflow-hidden flex flex-col" style={{ background: 'var(--bg-base)' }}>
          {children}
        </main>
      </div>
    </UpgradeModalProvider>
  )
}
