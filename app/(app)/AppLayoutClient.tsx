'use client'

import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Menu, X } from 'lucide-react'
import Sidebar from '@/components/layout/Sidebar'
import { UpgradeModalProvider } from '@/components/UpgradeModal'
import { useIsMobile } from '@/lib/use-is-mobile'

export default function AppLayoutClient({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const isMobile = useIsMobile()
  const [drawer, setDrawer] = useState(false)
  const [isElectronMac, setIsElectronMac] = useState(false)

  useEffect(() => {
    setIsElectronMac(!!window.electronAPI && navigator.platform.startsWith('Mac'))
  }, [])

  // Close the mobile drawer whenever the route changes (a nav link was tapped).
  useEffect(() => { setDrawer(false) }, [pathname])

  // The editor opens at /new, /projects/[id], AND the canonical pretty URL
  // /@user/slug-code (a two-segment @-path). All three are the full-screen
  // editor — the global dashboard sidebar must NOT render on any of them.
  // (/@user alone is the user profile page, which keeps the sidebar.)
  const isVanityProject = /^\/@[^/]+\/[^/]+/.test(pathname)
  const isEditor = pathname === '/new' || (pathname.startsWith('/projects/') && pathname !== '/projects') || isVanityProject
  const isLauncher = pathname === '/launcher'

  if (isEditor || isLauncher) {
    return (
      <UpgradeModalProvider>
        <div className="h-full">{children}</div>
      </UpgradeModalProvider>
    )
  }

  // Mobile: the fixed 224px sidebar ate most of the screen, so it becomes a
  // slide-in drawer behind a hamburger and the page gets the full width. Same
  // URL, device-adaptive — no /m redirect.
  if (isMobile) {
    return (
      <UpgradeModalProvider>
        <div className="flex flex-col h-full">
          <header style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', paddingTop: 'calc(10px + env(safe-area-inset-top))', borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)', flexShrink: 0 }}>
            <button onClick={() => setDrawer(true)} aria-label="Menu" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 38, height: 38, borderRadius: 9, border: 'none', background: 'transparent', color: 'var(--text-primary)', cursor: 'pointer' }}>
              <Menu size={22} />
            </button>
            <strong style={{ fontSize: 15, letterSpacing: '-0.01em' }}>100Lights</strong>
          </header>
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', position: 'relative', background: 'var(--bg-base)' }}>
            {children}
          </div>
          {drawer && (
            <div onClick={() => setDrawer(false)} style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.55)', display: 'flex' }}>
              <div onClick={e => e.stopPropagation()} style={{ height: '100%', boxShadow: '2px 0 24px rgba(0,0,0,0.6)', position: 'relative' }}>
                <Sidebar />
                <button onClick={() => setDrawer(false)} aria-label="Close menu" style={{ position: 'absolute', top: 14, right: 12, width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8, border: 'none', background: 'var(--bg-card)', color: 'var(--text-muted)', cursor: 'pointer' }}>
                  <X size={16} />
                </button>
              </div>
            </div>
          )}
        </div>
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
