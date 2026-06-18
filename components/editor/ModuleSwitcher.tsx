'use client'

import { useState, useRef, useEffect } from 'react'
import { Layers, Check } from 'lucide-react'
import type { ModuleKey } from '@/lib/editor-types'
import { MODULE_DEFS } from '@/lib/editor-types'

interface Props {
  activeModules: ModuleKey[]
  onModulesChange: (modules: ModuleKey[]) => void
}

export default function ModuleSwitcher({ activeModules, onModulesChange }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function close(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  function toggle(key: ModuleKey) {
    const next = activeModules.includes(key)
      ? activeModules.filter(k => k !== key)
      : [...activeModules, key]
    if (next.length === 0) return
    setOpen(false)
    onModulesChange(next)
  }

  return (
    <div ref={ref} style={{ position: 'relative', flexShrink: 0 }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: 5,
          fontSize: 11, padding: '4px 10px', borderRadius: 5,
          background: open ? 'var(--bg-card-hover)' : 'var(--bg-card)',
          border: '1px solid var(--border)', color: 'var(--text-secondary)', cursor: 'pointer',
        }}
        title="Add or remove modules"
      >
        <Layers size={11} /> Modules
      </button>

      {open && (
        <div style={{
          position: 'absolute', right: 0, top: '100%', marginTop: 4,
          background: 'var(--bg-surface)', border: '1px solid var(--border)',
          borderRadius: 8, zIndex: 200, minWidth: 210,
          boxShadow: '0 4px 20px rgba(0,0,0,0.35)', overflow: 'hidden',
        }}>
          <div style={{
            padding: '8px 12px 6px', fontSize: 10, fontWeight: 700,
            letterSpacing: '0.1em', textTransform: 'uppercase',
            color: 'var(--text-muted)', borderBottom: '1px solid var(--border)',
          }}>
            Active modules
          </div>

          {MODULE_DEFS.map(mod => {
            const active = activeModules.includes(mod.key)
            const isLast = active && activeModules.length === 1
            return (
              <button
                key={mod.key}
                onClick={() => !isLast && toggle(mod.key)}
                title={isLast ? 'Cannot remove the last module' : undefined}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  width: '100%', padding: '8px 12px', textAlign: 'left',
                  background: 'none', border: 'none',
                  cursor: isLast ? 'not-allowed' : 'pointer',
                  opacity: isLast ? 0.38 : 1,
                }}
                onMouseEnter={e => { if (!isLast) (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-card-hover)' }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent' }}
              >
                <div style={{
                  width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                  background: active ? mod.color : 'var(--border)',
                  transition: 'background 0.1s',
                }} />
                <span style={{ flex: 1, fontSize: 12, color: active ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                  {mod.label}
                </span>
                <span style={{ fontSize: 10, color: 'var(--text-muted)', marginRight: 4 }}>
                  {mod.tagline}
                </span>
                {active && <Check size={11} color="var(--text-muted)" />}
              </button>
            )
          })}

          <div style={{
            padding: '6px 12px', fontSize: 10, color: 'var(--text-muted)',
            borderTop: '1px solid var(--border)',
          }}>
            Changes save automatically
          </div>
        </div>
      )}
    </div>
  )
}
