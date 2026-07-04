'use client'

import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import Sidebar from '@/components/layout/Sidebar'
import { UpgradeModalProvider } from '@/components/UpgradeModal'

export default function AppLayoutClient({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [isElectronMac, setIsElectronMac] = useState(false)

  useEffect(() => {
    setIsElectronMac(!!window.electronAPI && navigator.platform.startsWith('Mac'))
  }, [])

  const isEditor = pathname === '/new' || (pathname.startsWith('/projects/') && pathname !== '/projects')
  const isLauncher = pathname === '/launcher'

  if (isEditor || isLauncher) {
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
        <main className="flex-1 overflow-hidden flex flex-col" style={{ background: 'var(--bg-base)', position: 'relative' }}>
          {/* Drag zone spanning the top of the main content area on Electron/Mac.
              Pages all have ≥32px of non-interactive top padding, so this strip
              sits in empty space and doesn't block any clicks. */}
          {isElectronMac && (
            <div
              className="electron-drag"
              style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 32, zIndex: 1 }}
            />
          )}
          {children}
        </main>
      </div>
    </UpgradeModalProvider>
  )
}
