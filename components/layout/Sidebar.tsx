'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, PlusCircle, FolderOpen, Settings, Zap, Trash2 } from 'lucide-react'
import { UserButton, useUser } from '@clerk/nextjs'
import { useEffect, useState } from 'react'
import { useUpgradeModal } from '@/components/UpgradeModal'

interface Usage {
  plan: 'free' | 'pro'
  aiGenerations: { used: number; limit: number }
  transcriptions: { used: number; limit: number }
}

const navItems = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/new', label: 'New Project', icon: PlusCircle },
  { href: '/projects', label: 'All Projects', icon: FolderOpen },
]

function UsageMeter({ used, limit, label }: { used: number; limit: number; label: string }) {
  const pct = Math.min(100, Math.round((used / limit) * 100))
  const nearLimit = pct >= 80
  const atLimit = used >= limit
  const color = atLimit ? 'var(--error)' : nearLimit ? 'var(--warning)' : 'var(--accent-light)'

  return (
    <div className="mb-2">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{label}</span>
        <span className="text-xs tabular-nums" style={{ color: atLimit ? 'var(--error)' : 'var(--text-muted)' }}>
          {used}/{limit}
        </span>
      </div>
      <div className="h-1 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
    </div>
  )
}

export default function Sidebar() {
  const pathname = usePathname()
  const { user } = useUser()
  const { showUpgrade } = useUpgradeModal()
  const [usage, setUsage] = useState<Usage | null>(null)

  useEffect(() => {
    fetch('/api/usage')
      .then(r => r.ok ? r.json() : null)
      .then((d: Usage | null) => setUsage(d))
      .catch(() => {})
  }, [])

  const isPro = usage?.plan === 'pro'
  const aiAtLimit = usage && usage.aiGenerations.used >= usage.aiGenerations.limit
  const transcribeAtLimit = usage && usage.transcriptions.used >= usage.transcriptions.limit

  return (
    <aside
      className="flex flex-col w-60 shrink-0 h-screen sticky top-0"
      style={{ background: 'var(--bg-surface)', borderRight: '1px solid var(--border)' }}
    >
      <div className="flex items-center gap-2.5 px-5 py-5" style={{ borderBottom: '1px solid var(--border)' }}>
        <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'var(--accent)' }}>
          <Zap size={14} color="#fff" fill="#fff" />
        </div>
        <span className="font-semibold text-sm tracking-tight" style={{ color: 'var(--text-primary)' }}>
          100Lights
        </span>
      </div>

      <nav className="flex-1 px-3 py-4 flex flex-col gap-0.5">
        {navItems.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || (href !== '/dashboard' && pathname.startsWith(href))
          return (
            <Link
              key={href}
              href={href}
              className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all"
              style={{
                background: active ? 'var(--accent-subtle)' : 'transparent',
                color: active ? 'var(--accent-light)' : 'var(--text-secondary)',
                fontWeight: active ? '500' : '400',
              }}
            >
              <Icon size={16} />
              {label}
            </Link>
          )
        })}
      </nav>

      {/* AI usage meter */}
      {usage && (
        <div className="mx-3 mb-3 px-3 py-3 rounded-xl" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>AI usage</span>
            {!isPro && (
              <span className="text-xs px-1.5 py-0.5 rounded-md font-medium" style={{ background: 'var(--bg-surface)', color: 'var(--text-muted)' }}>
                Free
              </span>
            )}
          </div>
          <UsageMeter used={usage.aiGenerations.used} limit={usage.aiGenerations.limit} label="Generations" />
          <UsageMeter used={usage.transcriptions.used} limit={usage.transcriptions.limit} label="Transcriptions" />
          {!isPro && (aiAtLimit || transcribeAtLimit) && (
            <button
              onClick={() => showUpgrade('You\'ve used your free monthly AI credits. Upgrade to Pro for 10× more.')}
              className="w-full mt-2 py-1.5 rounded-lg text-xs font-semibold"
              style={{ background: 'var(--accent)', color: '#fff' }}
            >
              Upgrade to Pro
            </button>
          )}
          {!isPro && !aiAtLimit && !transcribeAtLimit && (
            <button
              onClick={() => showUpgrade()}
              className="w-full mt-2 py-1.5 rounded-lg text-xs"
              style={{ color: 'var(--accent-light)' }}
            >
              Upgrade for more →
            </button>
          )}
        </div>
      )}

      <div className="px-3 pb-4 flex flex-col gap-1" style={{ borderTop: '1px solid var(--border)', paddingTop: '1rem' }}>
        <Link
          href="/settings"
          className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all"
          style={{ color: pathname === '/settings' ? 'var(--text-secondary)' : 'var(--text-muted)' }}
        >
          <Settings size={16} />
          Settings
        </Link>
        <Link
          href="/trash"
          className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all"
          style={{ color: pathname === '/trash' ? 'var(--text-secondary)' : 'var(--text-muted)' }}
        >
          <Trash2 size={16} />
          Trash
        </Link>
        {user && (
          <div className="flex items-center gap-3 px-3 py-2">
            <UserButton appearance={{ elements: { avatarBox: 'w-6 h-6' } }} />
            <span className="text-xs truncate max-w-[120px]" style={{ color: 'var(--text-muted)' }}>
              {user.firstName ?? user.emailAddresses[0]?.emailAddress}
            </span>
          </div>
        )}
        <div className="flex gap-3 px-3 pt-1">
          <Link href="/legal/terms" className="text-xs" style={{ color: 'var(--text-muted)' }}>Terms</Link>
          <Link href="/legal/privacy" className="text-xs" style={{ color: 'var(--text-muted)' }}>Privacy</Link>
        </div>
      </div>
    </aside>
  )
}
