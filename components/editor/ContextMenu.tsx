'use client'

import { useEffect, useRef } from 'react'

export interface ContextMenuItem {
  id: string
  label: string
  shortcut?: string
  disabled?: boolean
  danger?: boolean
  separator?: true
  /** Color-swatch row — renders inline dots instead of a text button */
  colors?: string[]
  onColor?: (color: string) => void
  onClick?: () => void
}

interface Props {
  x: number
  y: number
  items: ContextMenuItem[]
  onClose: () => void
}

export default function ContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)

  const safeX = typeof window !== 'undefined' ? Math.min(x, window.innerWidth - 210) : x
  const safeY = typeof window !== 'undefined' ? Math.min(y, window.innerHeight - items.length * 32 - 16) : y

  useEffect(() => {
    function handle(e: MouseEvent | KeyboardEvent) {
      if (e instanceof KeyboardEvent) { if (e.key === 'Escape') onClose(); return }
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    window.addEventListener('mousedown', handle)
    window.addEventListener('keydown', handle)
    return () => {
      window.removeEventListener('mousedown', handle)
      window.removeEventListener('keydown', handle)
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed', left: safeX, top: safeY, zIndex: 9999,
        minWidth: 200, background: 'var(--bg-card)',
        border: '1px solid var(--border-light)', borderRadius: 8,
        padding: '4px 0',
        boxShadow: '0 8px 32px rgba(0,0,0,0.5), 0 2px 8px rgba(0,0,0,0.3)',
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item, i) => {
        if (item.separator) {
          return <div key={i} style={{ height: 1, background: 'var(--border)', margin: '3px 8px' }} />
        }

        if (item.colors && item.onColor) {
          const onColor = item.onColor
          return (
            <div key={item.id} className="px-3 py-2 flex items-center gap-2">
              <span className="text-xs mr-1" style={{ color: 'var(--text-muted)', minWidth: 40 }}>{item.label}</span>
              {item.colors.map(c => (
                <button
                  key={c}
                  title={c}
                  onClick={() => { onColor(c); onClose() }}
                  style={{
                    width: 16, height: 16, borderRadius: '50%',
                    background: c, border: '2px solid rgba(255,255,255,0.12)',
                    flexShrink: 0, cursor: 'pointer',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.transform = 'scale(1.25)')}
                  onMouseLeave={e => (e.currentTarget.style.transform = '')}
                />
              ))}
            </div>
          )
        }

        return (
          <button
            key={item.id}
            onClick={() => { if (!item.disabled && item.onClick) { item.onClick(); onClose() } }}
            disabled={item.disabled}
            className="w-full flex items-center justify-between px-3 py-1.5 text-xs"
            style={{
              color: item.disabled ? 'var(--text-muted)' : item.danger ? '#f87171' : 'var(--text-primary)',
              background: 'transparent',
              cursor: item.disabled ? 'default' : 'pointer',
              textAlign: 'left',
            }}
            onMouseEnter={e => { if (!item.disabled) (e.currentTarget as HTMLButtonElement).style.background = 'var(--border)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent' }}
          >
            <span style={{ opacity: item.disabled ? 0.5 : 1 }}>{item.label}</span>
            {item.shortcut && <span style={{ color: 'var(--text-muted)', marginLeft: 24 }}>{item.shortcut}</span>}
          </button>
        )
      })}
    </div>
  )
}
