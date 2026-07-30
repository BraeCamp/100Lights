'use client'

// Compact control to move between studio UI tiers. Always visible (it's the way
// back to a fuller layout), so it is never tier-gated itself.

import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { SlidersHorizontal, Check } from 'lucide-react'
import { useUITier } from '../UITierProvider'
import { UI_TIERS, TIER_INFO } from '@/lib/ui-tiers'
import { clampToViewport } from './menu-clamp'

export default function UITierSwitcher() {
  const { tier, setTier } = useUITier()
  const [open, setOpen] = useState(false)
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (popRef.current?.contains(e.target as Node)) return
      if (btnRef.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  useEffect(() => {
    if (open && popRef.current && anchor) clampToViewport(popRef.current, anchor)
  }, [open, anchor])

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => {
          if (open) { setOpen(false); return }
          const r = btnRef.current!.getBoundingClientRect()
          setAnchor({ x: r.right - 280, y: r.bottom + 6 })
          setOpen(true)
        }}
        title={`Studio setup: ${TIER_INFO[tier].name} — click to change how many controls you see`}
        style={{
          display: 'flex', alignItems: 'center', gap: 5, height: 24, padding: '0 8px',
          borderRadius: 6, border: '1px solid var(--border)', cursor: 'pointer',
          background: open ? 'var(--accent-subtle)' : 'transparent',
          color: open ? 'var(--accent-light)' : 'var(--text-secondary)', fontSize: 11, fontWeight: 700,
        }}
      >
        <SlidersHorizontal size={12} />
        {TIER_INFO[tier].name}
      </button>

      {open && anchor && createPortal(
        <div
          ref={popRef}
          onClick={e => e.stopPropagation()}
          style={{
            position: 'fixed', left: anchor.x, top: anchor.y, zIndex: 1600, width: 280,
            background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10,
            padding: 6, boxShadow: '0 12px 32px rgba(0,0,0,0.7)',
            display: 'flex', flexDirection: 'column', gap: 4,
          }}
        >
          <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)', padding: '4px 8px 2px' }}>
            Studio setup
          </div>
          {UI_TIERS.map(id => {
            const t = TIER_INFO[id]
            const active = id === tier
            return (
              <button
                key={id}
                onClick={() => { setTier(id); setOpen(false) }}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: 8, textAlign: 'left',
                  padding: '8px 8px', borderRadius: 8, cursor: 'pointer', border: 'none',
                  background: active ? 'var(--accent-subtle)' : 'transparent',
                }}
                onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--bg-card)' }}
                onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent' }}
              >
                <span style={{ width: 14, flexShrink: 0, marginTop: 1, color: 'var(--accent-light)' }}>
                  {active && <Check size={13} />}
                </span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>{t.name}</span>
                  <span style={{ display: 'block', fontSize: 10.5, color: 'var(--text-muted)', lineHeight: 1.4, marginTop: 1 }}>{t.tagline}</span>
                </span>
              </button>
            )
          })}
        </div>,
        document.body,
      )}
    </>
  )
}
