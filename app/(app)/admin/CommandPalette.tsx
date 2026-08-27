'use client'

// ⌘K / Ctrl-K launcher for the admin. Jump to any panel, run a quick action,
// or find any user — from one keystroke, keyboard-first.

import { isPaid, type Plan } from '@/lib/entitlements'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, CornerDownLeft } from 'lucide-react'
import type { AdminTab } from './AdminTabs'

interface UserHit { userId: string; email: string; effectivePlan: string; giftPlan: string | null; giftUntil: string | null; codeUntil: string | null; stripePlan: string; status: string; hasRecord?: boolean }

type Item =
  | { kind: 'nav'; label: string; hash: string }
  | { kind: 'action'; label: string; run: () => void }
  | { kind: 'link'; label: string; url: string }
  | { kind: 'user'; label: string; user: UserHit }

const LINKS: { label: string; url: string }[] = [
  { label: 'Open Stripe dashboard', url: 'https://dashboard.stripe.com' },
  { label: 'Open Neon database', url: 'https://console.neon.tech' },
  { label: 'Open Clerk dashboard', url: 'https://dashboard.clerk.com' },
  { label: 'Open PostHog analytics', url: 'https://app.posthog.com' },
  { label: 'Open Sentry errors', url: 'https://sentry.io' },
  { label: 'Open Cloudflare R2', url: 'https://dash.cloudflare.com' },
]

export default function CommandPalette({ tabs }: { tabs: AdminTab[] }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [users, setUsers] = useState<UserHit[]>([])
  const [active, setActive] = useState(0)
  const [flash, setFlash] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const nav = useMemo<Item[]>(() =>
    tabs.flatMap(t => t.subtabs.map(s => ({ kind: 'nav' as const, label: `${t.label} → ${s.label}`, hash: `#${t.id}/${s.id}` }))), [tabs])

  const actions = useMemo<Item[]>(() => [
    { kind: 'action', label: 'Ping search engines (IndexNow)', run: async () => { await fetch('/api/admin/indexnow', { method: 'POST' }).catch(() => {}); setFlash('Pinged Bing/Yandex ✓') } },
    ...LINKS.map(l => ({ kind: 'link' as const, label: l.label, url: l.url })),
  ], [])

  // Global ⌘K / Ctrl-K toggle.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen(o => !o) }
      else if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => { if (open) { setQ(''); setUsers([]); setActive(0); setFlash(''); setTimeout(() => inputRef.current?.focus(), 20) } }, [open])

  // Debounced user search (min 2 chars).
  useEffect(() => {
    if (!open) return
    const term = q.trim()
    if (term.length < 2) { setUsers([]); return }
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/admin/users?q=${encodeURIComponent(term)}`)
        if (r.ok) setUsers(((await r.json()).users as UserHit[]).slice(0, 6))
      } catch { /* ignore */ }
    }, 220)
    return () => clearTimeout(t)
  }, [q, open])

  const match = (label: string) => label.toLowerCase().includes(q.trim().toLowerCase())
  const filteredStatic = q.trim() ? [...nav, ...actions].filter(i => match(i.label)) : nav.slice(0, 6)
  const userItems: Item[] = users.map(u => ({ kind: 'user', label: u.email || u.userId, user: u }))
  const items: Item[] = [...userItems, ...filteredStatic]

  useEffect(() => { if (active >= items.length) setActive(0) }, [items.length, active])

  function run(it: Item) {
    if (it.kind === 'nav') { window.location.hash = it.hash }
    else if (it.kind === 'link') { window.open(it.url, '_blank', 'noopener') }
    else if (it.kind === 'action') { it.run() }
    else if (it.kind === 'user') {
      // Stash the target so the Users panel picks it up even if it mounts lazily
      // *after* this event fires (first open of the tab); the event covers the
      // already-mounted case.
      ;(window as unknown as { __adminPendingUser?: UserHit }).__adminPendingUser = it.user
      window.location.hash = '#general/users'
      window.dispatchEvent(new CustomEvent('admin:open-user', { detail: it.user }))
    }
    if (it.kind !== 'action') setOpen(false)
  }

  if (!open) return null
  return (
    <div onClick={() => setOpen(false)}
      style={{ position: 'fixed', inset: 0, zIndex: 12000, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '12vh' }}>
      <div onClick={e => e.stopPropagation()}
        style={{ width: 560, maxWidth: '92vw', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden', boxShadow: '0 24px 70px rgba(0,0,0,0.5)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderBottom: '1px solid var(--border)' }}>
          <Search size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          <input ref={inputRef} value={q}
            onChange={e => { setQ(e.target.value); setActive(0) }}
            onKeyDown={e => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(items.length - 1, a + 1)) }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(0, a - 1)) }
              else if (e.key === 'Enter') { e.preventDefault(); const it = items[active]; if (it) run(it) }
            }}
            placeholder="Jump to a panel, a user, or an action…"
            style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: 'var(--text-primary)', fontSize: 15 }} />
          <kbd style={{ fontSize: 10, color: 'var(--text-muted)', border: '1px solid var(--border)', borderRadius: 5, padding: '1px 6px', flexShrink: 0 }}>esc</kbd>
        </div>

        <div style={{ maxHeight: '52vh', overflowY: 'auto', padding: 6 }}>
          {items.length === 0 && <div style={{ padding: '18px 12px', fontSize: 13, color: 'var(--text-muted)' }}>{q.trim().length >= 2 ? 'No matches.' : 'Type to search…'}</div>}
          {items.map((it, i) => {
            const on = i === active
            // Show the real tier, not 'pro'/'free' — a Max subscriber reading as 'free'
            // in the admin list is how a support conversation goes wrong.
            const badge = it.kind === 'user' ? String(it.user.effectivePlan) : it.kind === 'nav' ? 'go' : it.kind === 'link' ? 'open ↗' : 'run'
            return (
              <button key={i}
                onMouseEnter={() => setActive(i)} onClick={() => run(it)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', padding: '9px 10px', borderRadius: 8, border: 'none', cursor: 'pointer', background: on ? 'rgba(124,92,255,0.14)' : 'transparent', color: 'var(--text-primary)' }}>
                <span style={{ fontSize: 13.5, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {it.kind === 'user' && <span style={{ color: 'var(--text-muted)', marginRight: 6 }}>@</span>}{it.label}
                </span>
                <span className="mono" style={{ fontSize: 10, color: it.kind === 'user' && isPaid(it.user.effectivePlan as Plan) ? 'var(--accent-light)' : 'var(--text-muted)', border: '1px solid var(--border)', borderRadius: 5, padding: '1px 6px', flexShrink: 0 }}>{badge}</span>
                {on && <CornerDownLeft size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />}
              </button>
            )
          })}
        </div>

        {flash && <div style={{ padding: '8px 14px', borderTop: '1px solid var(--border)', fontSize: 12, color: '#34d399' }}>{flash}</div>}
      </div>
    </div>
  )
}
