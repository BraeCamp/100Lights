'use client'

// In-app notification bell — the community's retention loop. Polls for unread
// notifications, shows a dropdown, and marks them read on open. Renders nothing
// for signed-out visitors (the API 401s and we stay quiet).

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useUser } from '@clerk/nextjs'
import { Bell } from 'lucide-react'

interface Notification {
  id: string
  type: string
  itemId: string | null
  actorName: string
  body: string
  read: boolean
  createdAt: string
}

function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d`
  return new Date(iso).toLocaleDateString()
}

export default function NotificationBell() {
  const { isSignedIn } = useUser()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<Notification[]>([])
  const [unread, setUnread] = useState(0)
  const boxRef = useRef<HTMLDivElement | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/notifications')
      if (!res.ok) return
      const data = await res.json() as { notifications: Notification[]; unread: number }
      setItems(data.notifications)
      setUnread(data.unread)
    } catch { /* offline — leave last known state */ }
  }, [])

  // Poll while signed in (every 60s), and once on mount.
  useEffect(() => {
    if (!isSignedIn) return
    void load()
    const t = window.setInterval(load, 60_000)
    return () => window.clearInterval(t)
  }, [isSignedIn, load])

  // Close on outside click.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false) }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open])

  const toggle = async () => {
    const next = !open
    setOpen(next)
    if (next && unread > 0) {
      setUnread(0)
      setItems(list => list.map(n => ({ ...n, read: true })))
      try { await fetch('/api/notifications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'read' }) }) } catch { /* ok */ }
    }
  }

  if (!isSignedIn) return null

  return (
    <div ref={boxRef} style={{ position: 'relative', display: 'flex' }}>
      <button onClick={toggle} aria-label={`Notifications${unread > 0 ? ` (${unread} unread)` : ''}` } style={{
        position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center',
        width: 32, height: 32, borderRadius: 8, cursor: 'pointer',
        background: 'transparent', border: 'none', color: 'var(--text-muted, #a3a2b5)',
      }}>
        <Bell size={17} />
        {unread > 0 && (
          <span style={{
            position: 'absolute', top: 2, right: 2, minWidth: 15, height: 15, padding: '0 3px',
            borderRadius: 999, background: '#ef4444', color: '#fff', fontSize: 9.5, fontWeight: 800,
            display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1,
          }}>{unread > 9 ? '9+' : unread}</span>
        )}
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 40, right: 0, width: 320, maxHeight: 420, overflowY: 'auto', zIndex: 200,
          background: 'var(--bg-surface, #17151f)', border: '1px solid var(--border, #26262b)', borderRadius: 12,
          boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
        }}>
          <div style={{ padding: '11px 14px', borderBottom: '1px solid var(--border, #26262b)', fontSize: 12.5, fontWeight: 800, color: 'var(--text-primary, #f1f0ff)' }}>Notifications</div>
          {items.length === 0 ? (
            <div style={{ padding: '22px 14px', fontSize: 12, color: 'var(--text-muted, #a3a2b5)', textAlign: 'center' }}>Nothing yet — you’ll hear when someone comments on your shares.</div>
          ) : (
            items.map(n => {
              const inner = (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '10px 14px', borderBottom: '1px solid var(--border, #26262b)', background: n.read ? 'transparent' : 'rgba(139,92,246,0.08)' }}>
                  <div style={{ fontSize: 12.5, color: 'var(--text-primary, #f1f0ff)', lineHeight: 1.4 }}>{n.body}</div>
                  <div style={{ fontSize: 10.5, color: 'var(--text-muted, #a3a2b5)' }}>{timeAgo(n.createdAt)} ago</div>
                </div>
              )
              return n.itemId
                ? <Link key={n.id} href={`/community/${n.itemId}`} onClick={() => setOpen(false)} style={{ textDecoration: 'none', display: 'block' }}>{inner}</Link>
                : <div key={n.id}>{inner}</div>
            })
          )}
        </div>
      )}
    </div>
  )
}
