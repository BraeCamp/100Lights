'use client'

import { useState, useRef } from 'react'
import Link from 'next/link'
import { Film, AudioLines, FileText, Newspaper, PanelsTopBottom, ArrowLeft, ArrowRight, Check } from 'lucide-react'
import type { ModuleKey } from '@/lib/editor-types'
import { MODULE_DEFS } from '@/lib/editor-types'
import ProjectEditor from '@/components/editor/ProjectEditor'

const ICONS: Record<ModuleKey, React.ComponentType<{ size?: number; color?: string }>> = {
  video: Film,
  audio: AudioLines,
  transcript: FileText,
  content: Newspaper,
  storyboard: PanelsTopBottom,
}

export default function NewProjectPage() {
  const [phase, setPhase] = useState<'pick' | 'edit'>('pick')
  const [projectName, setProjectName] = useState('')
  const [selected, setSelected] = useState<ModuleKey[]>([])
  const nameRef = useRef<HTMLInputElement>(null)

  function toggle(key: ModuleKey) {
    setSelected(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key])
  }

  if (phase === 'edit') {
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <ProjectEditor
          projectName={projectName.trim() || 'New Project'}
          modules={selected}
          allowImport
        />
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100%', background: 'var(--bg-base)', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ height: 44, display: 'flex', alignItems: 'center', padding: '0 20px', borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)', gap: 12, flexShrink: 0 }}>
        <Link
          href="/dashboard"
          style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-muted)', fontSize: 12, textDecoration: 'none' }}
        >
          <ArrowLeft size={13} /> Dashboard
        </Link>
        <div style={{ width: 1, height: 16, background: 'var(--border)' }} />
        <span style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 500 }}>New Project</span>
      </div>

      {/* Content */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '52px 24px 40px', overflowY: 'auto' }}>
        <div style={{ width: '100%', maxWidth: 860 }}>

          {/* Project name */}
          <div style={{ marginBottom: 44 }}>
            <label style={{
              display: 'block', fontSize: 10, fontWeight: 700,
              letterSpacing: '0.12em', textTransform: 'uppercase',
              color: 'var(--text-muted)', marginBottom: 10,
            }}>
              Project name
            </label>
            <input
              ref={nameRef}
              value={projectName}
              onChange={e => setProjectName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && selected.length > 0) setPhase('edit') }}
              placeholder="Untitled"
              autoFocus
              style={{
                width: '100%', maxWidth: 440,
                background: 'var(--bg-card)', border: '1px solid var(--border)',
                borderRadius: 8, padding: '11px 14px',
                color: 'var(--text-primary)', fontSize: 15,
                outline: 'none', display: 'block',
              }}
              onFocus={e => { e.currentTarget.style.borderColor = 'var(--accent)' }}
              onBlur={e => { e.currentTarget.style.borderColor = 'var(--border)' }}
            />
          </div>

          {/* Module picker */}
          <div style={{ marginBottom: 44 }}>
            <label style={{
              display: 'block', fontSize: 10, fontWeight: 700,
              letterSpacing: '0.12em', textTransform: 'uppercase',
              color: 'var(--text-muted)', marginBottom: 16,
            }}>
              Modules
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(155px, 1fr))', gap: 10 }}>
              {MODULE_DEFS.map(mod => {
                const Icon = ICONS[mod.key]
                const active = selected.includes(mod.key)
                return (
                  <button
                    key={mod.key}
                    onClick={() => toggle(mod.key)}
                    style={{
                      textAlign: 'left', padding: 0, cursor: 'pointer',
                      border: `2px solid ${active ? mod.color : 'var(--border)'}`,
                      borderRadius: 10,
                      background: active ? `color-mix(in srgb, ${mod.color} 8%, var(--bg-card))` : 'var(--bg-card)',
                      transition: 'border-color 0.12s, background 0.12s',
                      overflow: 'hidden',
                      display: 'flex', flexDirection: 'column',
                    }}
                  >
                    {/* Icon strip */}
                    <div style={{
                      padding: '18px 16px 14px',
                      display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
                      background: active ? `color-mix(in srgb, ${mod.color} 12%, transparent)` : 'transparent',
                    }}>
                      <Icon size={20} color={active ? mod.color : 'var(--text-muted)'} />
                      <div style={{
                        width: 16, height: 16, borderRadius: '50%', flexShrink: 0,
                        border: `1.5px solid ${active ? mod.color : 'var(--border)'}`,
                        background: active ? mod.color : 'transparent',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        transition: 'all 0.12s',
                      }}>
                        {active && <Check size={9} color="#fff" strokeWidth={3} />}
                      </div>
                    </div>
                    {/* Body */}
                    <div style={{ padding: '0 16px 16px', flex: 1 }}>
                      <div style={{
                        fontSize: 11, fontWeight: 700, letterSpacing: '0.08em',
                        textTransform: 'uppercase', marginBottom: 3,
                        color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                      }}>
                        {mod.label}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 10 }}>
                        {mod.tagline}
                      </div>
                      <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 3 }}>
                        {mod.features.map(f => (
                          <li key={f} style={{
                            fontSize: 10, lineHeight: 1.4,
                            color: active ? 'var(--text-secondary)' : 'var(--text-muted)',
                            display: 'flex', alignItems: 'baseline', gap: 5,
                          }}>
                            <span style={{ color: active ? mod.color : 'var(--border-light)', fontSize: 7, flexShrink: 0 }}>▸</span>
                            {f}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Manifest bar */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 16,
            paddingTop: 20, borderTop: '1px solid var(--border)',
          }}>
            <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--text-muted)', flexShrink: 0 }}>
                {selected.length === 0 ? 'nothing selected' : 'load:'}
              </span>
              {selected.map(key => {
                const def = MODULE_DEFS.find(m => m.key === key)!
                return (
                  <span key={key} style={{
                    fontSize: 10, fontFamily: 'monospace', fontWeight: 600,
                    padding: '2px 8px', borderRadius: 4,
                    background: `color-mix(in srgb, ${def.color} 12%, transparent)`,
                    color: def.color,
                    border: `1px solid color-mix(in srgb, ${def.color} 30%, transparent)`,
                  }}>
                    {key}
                  </span>
                )
              })}
            </div>
            <button
              onClick={() => { if (selected.length > 0) setPhase('edit') }}
              disabled={selected.length === 0}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
                padding: '10px 22px', borderRadius: 8, border: 'none', cursor: selected.length === 0 ? 'not-allowed' : 'pointer',
                background: selected.length === 0 ? 'var(--bg-card)' : 'var(--accent)',
                color: selected.length === 0 ? 'var(--text-muted)' : '#fff',
                fontSize: 13, fontWeight: 600, transition: 'opacity 0.12s',
                opacity: selected.length === 0 ? 0.5 : 1,
              }}
            >
              Load <ArrowRight size={14} />
            </button>
          </div>

        </div>
      </div>
    </div>
  )
}
