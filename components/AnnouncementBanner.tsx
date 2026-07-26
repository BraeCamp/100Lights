'use client'

import { useEffect, useState } from 'react'

interface Ann {
  id: number
  message: string
  level: 'info' | 'success' | 'warn'
  href: string | null
  href_label: string | null
  dismissible: boolean
}

const STYLES: Record<Ann['level'], { bg: string; border: string; fg: string }> = {
  info:    { bg: 'rgba(139,92,246,0.14)', border: 'rgba(139,92,246,0.45)', fg: '#ddd6fe' },
  success: { bg: 'rgba(16,185,129,0.14)', border: 'rgba(16,185,129,0.45)', fg: '#a7f3d0' },
  warn:    { bg: 'rgba(245,158,11,0.16)', border: 'rgba(245,158,11,0.5)',  fg: '#fde68a' },
}

const DISMISS_KEY = 'dismissed-announcements'

function dismissed(): number[] {
  try { return JSON.parse(localStorage.getItem(DISMISS_KEY) || '[]') } catch { return [] }
}

// A slim, dismissible broadcast banner pinned to the bottom of the viewport.
// Renders nothing when there's nothing active, so it's inert on every page by
// default. Mounted once in the root layout → reaches desktop and mobile alike.
export default function AnnouncementBanner() {
  const [items, setItems] = useState<Ann[]>([])
  const [hidden, setHidden] = useState<number[]>([])

  useEffect(() => {
    setHidden(dismissed())
    let alive = true
    fetch('/api/announcements', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : { announcements: [] })
      .then(d => { if (alive) setItems(Array.isArray(d.announcements) ? d.announcements : []) })
      .catch(() => {})
    return () => { alive = false }
  }, [])

  const visible = items.filter(a => !hidden.includes(a.id))
  if (visible.length === 0) return null

  const hide = (id: number) => {
    const next = [...new Set([...dismissed(), id])].slice(-100)
    try { localStorage.setItem(DISMISS_KEY, JSON.stringify(next)) } catch { /* private mode */ }
    setHidden(next)
  }

  // Show only the newest un-dismissed announcement to avoid a stacked wall.
  const a = visible[0]
  const s = STYLES[a.level] ?? STYLES.info

  return (
    <div role="status" aria-live="polite"
      style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 90, display: 'flex', justifyContent: 'center', pointerEvents: 'none', padding: '0 12px 12px' }}>
      <div style={{ pointerEvents: 'auto', display: 'flex', alignItems: 'center', gap: 12, maxWidth: 760, width: '100%',
        background: s.bg, border: `1px solid ${s.border}`, color: s.fg, borderRadius: 12,
        padding: '10px 14px', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
        boxShadow: '0 8px 30px rgba(0,0,0,0.35)', fontSize: 13.5, lineHeight: 1.4 }}>
        <span style={{ flex: 1 }}>{a.message}</span>
        {a.href && (
          <a href={a.href} target={a.href.startsWith('http') ? '_blank' : undefined} rel="noopener noreferrer"
            style={{ flexShrink: 0, fontWeight: 700, color: s.fg, textDecoration: 'underline', textUnderlineOffset: 3 }}>
            {a.href_label || 'Learn more'} →
          </a>
        )}
        {a.dismissible && (
          <button onClick={() => hide(a.id)} aria-label="Dismiss"
            style={{ flexShrink: 0, background: 'none', border: 'none', color: s.fg, cursor: 'pointer', fontSize: 18, lineHeight: 1, opacity: 0.7, padding: '0 2px' }}>
            ×
          </button>
        )}
      </div>
    </div>
  )
}
