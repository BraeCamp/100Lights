'use client'

import Link from 'next/link'
import { useElectronChrome } from '@/lib/use-electron-chrome'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, FolderOpen, Settings, Trash2, MessageSquare, Film, AudioLines, Palette, Download, LogIn, Library, ChevronsLeft, ChevronsRight, Sparkles, Globe2 } from 'lucide-react'
import { UserButton, useUser } from '@clerk/nextjs'
import { useEffect, useState } from 'react'
import { useUpgradeModal } from '@/components/UpgradeModal'
import { MODULE_DEFS } from '@/lib/editor-types'
import { moduleEntry } from '@/lib/lights-registry'
import type { ModuleKey } from '@/lib/editor-types'
import { LogoMark } from '@/components/Logo'

interface Usage {
  plan: 'free' | 'pro'
}

const APP_ICONS: Record<ModuleKey, React.ComponentType<{ size?: number; color?: string }>> = {
  video: Film,
  audio: AudioLines,
  image: Palette,
}


export default function Sidebar() {
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const pathname = usePathname()
  const { user } = useUser()
  const { showUpgrade } = useUpgradeModal()
  const [usage, setUsage] = useState<Usage | null>(null)
  const [enabledModules, setEnabledModules] = useState<string[]>(['audio'])
  const [isElectron, setIsElectron] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const { padTrafficLights: isElectronMac } = useElectronChrome()

  useEffect(() => {
    setIsElectron(typeof window !== 'undefined' && !!window.electronAPI)
    try { setCollapsed(localStorage.getItem('sidebar-collapsed') === '1') } catch { /* ignore */ }
  }, [])
  const toggleCollapsed = () => setCollapsed(c => { const n = !c; try { localStorage.setItem('sidebar-collapsed', n ? '1' : '0') } catch { /* ignore */ } return n })

  function fetchUsage() {
    fetch('/api/usage')
      .then(r => r.ok ? r.json() : null)
      .then((d: Usage | null) => setUsage(d))
      .catch(() => {})
  }

  useEffect(() => {
    fetchUsage()
    const id = setInterval(fetchUsage, 60_000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    fetch('/api/platform-flags')
      .then(r => r.ok ? r.json() : null)
      .then((d: { enabledModules?: string[] } | null) => { if (d?.enabledModules) setEnabledModules(d.enabledModules) })
      .catch(() => {})
  }, [])

  const isPro = usage?.plan === 'pro'

  function navLink(href: string, label: string, Icon: React.ComponentType<{ size?: number; color?: string }>) {
    const active = pathname === href
    return (
      <Link
        key={href}
        href={href}
        aria-current={active ? 'page' : undefined}
        title={collapsed ? label : undefined}
        className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all"
        style={{
          background: active ? 'var(--accent-subtle)' : 'transparent',
          color: active ? 'var(--accent-light)' : 'var(--text-secondary)',
          fontWeight: active ? '500' : '400',
          justifyContent: collapsed ? 'center' : 'flex-start',
        }}
      >
        <Icon size={15} />
        {!collapsed && label}
      </Link>
    )
  }

  return (
    <aside
      className={`flex flex-col ${collapsed ? 'w-16' : 'w-56'} shrink-0 h-screen sticky top-0`}
      aria-label="Application sidebar"
      style={{ background: 'var(--bg-surface)', borderRight: '1px solid var(--border)' }}
    >
      {/* Home + collapse toggle — shifts right on Electron/Mac to clear traffic lights */}
      <div
        className={isElectronMac ? 'electron-drag' : undefined}
        style={{ borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 6, paddingTop: 16, paddingBottom: 16, paddingLeft: isElectronMac ? 80 : (collapsed ? 12 : 20), paddingRight: 12 }}
      >
        <Link
          href={isElectron ? '/launcher' : '/dashboard'}
          title="Home"
          className={isElectronMac ? 'electron-nodrag' : undefined}
          style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none', flex: 1, minWidth: 0, justifyContent: collapsed ? 'center' : 'flex-start' }}
        >
          <LogoMark size={26} />
          {!collapsed && <span className="font-semibold text-sm tracking-tight" style={{ color: 'var(--text-primary)' }}>100Lights</span>}
        </Link>
        {!collapsed && (
          <button onClick={toggleCollapsed} aria-label="Collapse sidebar" title="Collapse"
            className="electron-nodrag"
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 26, borderRadius: 7, border: 'none', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', flexShrink: 0 }}>
            <ChevronsLeft size={16} />
          </button>
        )}
      </div>
      {collapsed && (
        <button onClick={toggleCollapsed} aria-label="Expand sidebar" title="Expand"
          className="electron-nodrag"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 30, margin: '6px 8px 0', borderRadius: 7, border: 'none', background: 'var(--bg-card)', color: 'var(--text-muted)', cursor: 'pointer' }}>
          <ChevronsRight size={16} />
        </button>
      )}

      <nav className="flex-1 px-3 py-3 flex flex-col gap-0.5 overflow-y-auto" aria-label="Main navigation">
        {/* Workspace */}
        {!collapsed && (
          <div style={{ padding: '2px 12px 6px', fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
            Workspace
          </div>
        )}
        {navLink(isElectron ? '/launcher' : '/dashboard', 'Home', LayoutDashboard)}
        {navLink('/projects', 'All Projects', FolderOpen)}
        {navLink('/library', 'Sound Library', Library)}

        {/* Studios — the flagship modules, by their light names */}
        {!collapsed && (
          <div style={{ padding: '14px 12px 6px', fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
            Studios
          </div>
        )}
        {collapsed && <div style={{ height: 10 }} />}
        {MODULE_DEFS.filter(mod => enabledModules.includes(mod.key)).map(mod => {
          const Icon = APP_ICONS[mod.key]
          const light = moduleEntry(mod.key)
          const href = light.href
          const active = pathname === href || pathname.startsWith(`${href}/`)
          return (
            <Link
              key={mod.key}
              href={href}
              aria-current={active ? 'page' : undefined}
              title={collapsed ? light.name : `${light.name} — ${mod.tagline}`}
              className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all"
              style={{
                background: active ? `color-mix(in srgb, ${mod.color} 12%, transparent)` : 'transparent',
                color: active ? mod.color : 'var(--text-secondary)',
                fontWeight: active ? '500' : '400',
                justifyContent: collapsed ? 'center' : 'flex-start',
              }}
            >
              {/* Colored dot */}
              <div style={{
                width: 18, height: 18, borderRadius: 5, flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: active
                  ? `color-mix(in srgb, ${mod.color} 18%, transparent)`
                  : 'transparent',
              }}>
                <Icon size={13} color={active ? mod.color : 'var(--text-muted)'} />
              </div>
              {!collapsed && light.name}
            </Link>
          )
        })}

        {/* Explore — the rest of the constellation */}
        {!collapsed && (
          <div style={{ padding: '14px 12px 6px', fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
            Explore
          </div>
        )}
        {collapsed && <div style={{ height: 10 }} />}
        {navLink('/apps', 'Apps', Sparkles)}
        {navLink('/community', 'Community', Globe2)}
      </nav>

      {!isPro && usage && !collapsed && (
        <div className="mx-3 mb-3 px-3 py-2.5 rounded-xl" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
          <button
            onClick={() => showUpgrade()}
            className="w-full py-1.5 rounded-lg text-xs font-semibold"
            style={{ background: 'var(--accent)', color: '#fff' }}
          >
            Upgrade to Pro
          </button>
        </div>
      )}

      <div className="px-3 pb-4 flex flex-col gap-1" style={{ borderTop: '1px solid var(--border)', paddingTop: '1rem' }}>
        <Link
          href="/settings"
          title={collapsed ? 'Settings' : undefined}
          className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all"
          style={{ color: pathname === '/settings' ? 'var(--text-secondary)' : 'var(--text-muted)', justifyContent: collapsed ? 'center' : 'flex-start' }}
        >
          <Settings size={15} />
          {!collapsed && 'Settings'}
        </Link>
        <Link
          href="/trash"
          title={collapsed ? 'Trash' : undefined}
          className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all"
          style={{ color: pathname === '/trash' ? 'var(--text-secondary)' : 'var(--text-muted)', justifyContent: collapsed ? 'center' : 'flex-start' }}
        >
          <Trash2 size={15} />
          {!collapsed && 'Trash'}
        </Link>
        {user ? (
          <div className="flex items-center gap-3 px-3 py-2" aria-label="User menu" style={{ justifyContent: collapsed ? 'center' : 'flex-start' }}>
            <UserButton appearance={{ elements: { avatarBox: 'w-6 h-6' } }} />
            {!collapsed && (
              <span className="text-xs truncate max-w-[120px]" style={{ color: 'var(--text-muted)' }}>
                {user.firstName ?? user.emailAddresses[0]?.emailAddress}
              </span>
            )}
          </div>
        ) : (
          <Link
            href="/sign-in"
            title={collapsed ? 'Sign in' : undefined}
            className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all"
            style={{ background: 'var(--accent)', color: '#fff', margin: '0 0 2px', justifyContent: collapsed ? 'center' : 'flex-start' }}
          >
            <LogIn size={14} />
            {!collapsed && 'Sign in'}
          </Link>
        )}
        {!isElectron && !collapsed && (
          <Link
            href="/download"
            className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all"
            style={{ color: 'var(--text-muted)' }}
          >
            <Download size={15} />
            Get Desktop App
          </Link>
        )}
        <button
          onClick={() => setFeedbackOpen(true)}
          title={collapsed ? 'Send feedback' : undefined}
          className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all"
          style={{ color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', width: '100%', textAlign: 'left', justifyContent: collapsed ? 'center' : 'flex-start' }}
        >
          <MessageSquare size={15} />
          {!collapsed && 'Send feedback'}
        </button>
        {feedbackOpen && <FeedbackModal onClose={() => setFeedbackOpen(false)} />}
        {!collapsed && (
          <div className="flex gap-3 px-3 pt-1">
            <Link href="/legal/terms" className="text-xs" style={{ color: 'var(--text-muted)' }}>Terms</Link>
            <Link href="/legal/privacy" className="text-xs" style={{ color: 'var(--text-muted)' }}>Privacy</Link>
          </div>
        )}
      </div>
    </aside>
  )
}


function FeedbackModal({ onClose }: { onClose: () => void }) {
  const [message, setMessage] = useState('')
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle')

  async function submit() {
    if (!message.trim()) return
    setState('busy')
    try {
      const r = await fetch('/api/feedback', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, page: window.location.pathname }),
      })
      if (!r.ok) throw new Error()
      setState('done')
      setTimeout(onClose, 1400)
    } catch { setState('error') }
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 1001, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 420, maxWidth: 'calc(100vw - 40px)', background: '#161616', border: '1px solid var(--border)', borderRadius: 12, padding: 20 }}>
        <p style={{ fontSize: 14, fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 4px' }}>Send feedback</p>
        <p style={{ fontSize: 11.5, color: 'var(--text-muted)', margin: '0 0 12px' }}>Bugs, ideas, confusion — everything helps. It goes straight to the team.</p>
        <textarea
          autoFocus value={message} onChange={e => setMessage(e.target.value)}
          placeholder="What happened / what would make this better?"
          style={{ width: '100%', height: 110, resize: 'none', boxSizing: 'border-box', background: '#101010', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-primary)', fontSize: 12.5, padding: '10px 12px', outline: 'none' }}
        />
        {state === 'error' && <p style={{ color: '#ef4444', fontSize: 11, margin: '8px 0 0' }}>Could not send — try again.</p>}
        <button
          onClick={submit} disabled={state === 'busy' || state === 'done' || !message.trim()}
          style={{ marginTop: 12, width: '100%', padding: '9px 0', borderRadius: 8, border: 'none', cursor: 'pointer', background: state === 'done' ? '#16a34a' : 'var(--accent)', color: '#fff', fontSize: 12.5, fontWeight: 700, opacity: state === 'busy' ? 0.6 : 1 }}
        >{state === 'done' ? 'Sent — thank you!' : state === 'busy' ? 'Sending…' : 'Send'}</button>
      </div>
    </div>
  )
}
