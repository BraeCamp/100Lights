'use client'
// Global ⌘K / Ctrl+K switcher — jump to any constellation destination (module,
// app, tool, game) or core page from anywhere. Registry-driven, dependency-free
// overlay; mounted once in the root layout. Renders nothing until opened, so it
// costs no static-page bytes beyond the listener.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { visibleLights, type LightEntry } from '@/lib/lights-registry'

interface Row { href: string; label: string; hint: string; icon: string }

const CORE: Row[] = [
  { href: '/dashboard', label: 'Dashboard', hint: 'page', icon: '🏠' },
  { href: '/create', label: 'New project', hint: 'page', icon: '➕' },
  { href: '/projects', label: 'All projects', hint: 'page', icon: '📂' },
  { href: '/library', label: 'Sound Library', hint: 'page', icon: '📚' },
  { href: '/community', label: 'Community', hint: 'page', icon: '🌐' },
  { href: '/learn', label: 'Learn', hint: 'page', icon: '🎓' },
  { href: '/apps', label: 'All apps', hint: 'page', icon: '✳️' },
  { href: '/store', label: 'Store', hint: 'page', icon: '🛒' },
]

const KIND_HINT: Record<LightEntry['kind'], string> = {
  module: 'studio', app: 'app', tool: 'tool', game: 'game',
}

export default function CommandK() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const rows = useMemo<Row[]>(() => [
    ...visibleLights().map(e => ({ href: e.href, label: e.name, hint: `${KIND_HINT[e.kind]} — ${e.tagline}`, icon: e.icon })),
    ...CORE,
  ], [])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return rows.slice(0, 12)
    return rows.filter(r =>
      r.label.toLowerCase().includes(needle) || r.hint.toLowerCase().includes(needle) || r.href.includes(needle),
    ).slice(0, 12)
  }, [q, rows])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        // Not while a studio is open. The editors have their own ⌘K, and both
        // handlers sit on window, so the shortcut was opening BOTH: the studio
        // palette at z-3000 and this sheet at z-400 behind it. Dismissing the
        // palette left this one covering the whole studio, swallowing every
        // click on the track underneath — which reads as the studio freezing.
        // It went unnoticed while the studio palette was nearly empty; making
        // it useful made this an every-⌘K problem.
        if (document.querySelector('[data-editor="true"]')) return
        e.preventDefault()
        setOpen(o => !o); setQ(''); setSel(0)
      } else if (e.key === 'Escape') {
        setOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => { if (open) inputRef.current?.focus() }, [open])

  const go = useCallback((href: string) => {
    setOpen(false)
    router.push(href)
  }, [router])

  if (!open) return null

  return (
    <div
      onClick={() => setOpen(false)}
      style={{ position: 'fixed', inset: 0, zIndex: 400, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '14vh', backdropFilter: 'blur(2px)' }}
    >
      <div
        role="dialog" aria-label="Quick switcher"
        onClick={e => e.stopPropagation()}
        style={{ width: 'min(560px, calc(100vw - 32px))', borderRadius: 14, overflow: 'hidden', background: 'var(--bg-surface, #131316)', border: '1px solid var(--border)', boxShadow: '0 24px 80px rgba(0,0,0,0.55)' }}
      >
        <input
          ref={inputRef}
          value={q}
          onChange={e => { setQ(e.target.value); setSel(0) }}
          onKeyDown={e => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(s + 1, filtered.length - 1)) }
            if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => Math.max(s - 1, 0)) }
            if (e.key === 'Enter' && filtered[sel]) go(filtered[sel].href)
          }}
          placeholder="Jump to a studio, app, or tool…"
          aria-label="Search destinations"
          style={{ width: '100%', padding: '15px 18px', fontSize: 15, background: 'transparent', border: 'none', outline: 'none', color: 'var(--text-primary)', borderBottom: '1px solid var(--border)' }}
        />
        <div style={{ maxHeight: 380, overflowY: 'auto', padding: 6 }}>
          {filtered.length === 0 && (
            <div style={{ padding: '18px 14px', fontSize: 13, color: 'var(--text-muted)' }}>No matches.</div>
          )}
          {filtered.map((r, i) => (
            <button
              key={r.href + r.label}
              onClick={() => go(r.href)}
              onMouseEnter={() => setSel(i)}
              style={{
                display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left',
                padding: '10px 12px', borderRadius: 9, border: 'none', cursor: 'pointer',
                background: i === sel ? 'color-mix(in srgb, var(--accent, #8b5cf6) 14%, transparent)' : 'transparent',
              }}
            >
              <span style={{ fontSize: 17, width: 24, textAlign: 'center' }} aria-hidden="true">{r.icon}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 13.5, fontWeight: 600, color: 'var(--text-primary)' }}>{r.label}</span>
                <span style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.hint}</span>
              </span>
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{r.href}</span>
            </button>
          ))}
        </div>
        <div style={{ padding: '8px 14px', borderTop: '1px solid var(--border)', fontSize: 10.5, color: 'var(--text-muted)', display: 'flex', gap: 14 }}>
          <span>↑↓ navigate</span><span>↵ open</span><span>esc close</span>
        </div>
      </div>
    </div>
  )
}
