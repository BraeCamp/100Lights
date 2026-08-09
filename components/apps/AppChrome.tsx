'use client'

// Shared chrome for the /apps mini-apps: applies the user's Workshop theme (so a theme set in one
// app or the studio follows everywhere) and adds a floating Customize control. Wrap an app's page
// content in <AppChrome> to give it the same themed, customizable shell Firefly has.
import { useState } from 'react'
import { Palette, X, RotateCcw } from 'lucide-react'
import { WorkshopThemeProvider, useWorkshopTheme } from '@/components/editor/WorkshopThemeProvider'
import { BUILTIN_PRESETS, PATTERN_TYPES, resolveColor } from '@/lib/workshop-theme'

export default function AppChrome({ children }: { children: React.ReactNode }) {
  return (
    <WorkshopThemeProvider>
      <Shell>{children}</Shell>
    </WorkshopThemeProvider>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div data-editor="true" style={{ minHeight: '100dvh', background: 'var(--bg-base)', backgroundImage: 'var(--workshop-pattern, none)', backgroundSize: 'var(--workshop-pattern-size, auto)' }}>
      {children}
      <button
        type="button" onClick={() => setOpen(true)} aria-label="Customize appearance"
        style={{ position: 'fixed', top: 'calc(12px + env(safe-area-inset-top))', right: 12, zIndex: 25, display: 'grid', placeItems: 'center', width: 40, height: 40, borderRadius: 11, background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-secondary)', cursor: 'pointer', boxShadow: '0 2px 10px rgba(0,0,0,0.18)' }}
      >
        <Palette size={18} />
      </button>
      {open && <CustomizeSheet onClose={() => setOpen(false)} />}
    </div>
  )
}

// The mobile Customize sheet — same shared theme model + persistence as the studio.
export function CustomizeSheet({ onClose }: { onClose: () => void }) {
  const { theme, update, setTheme, reset } = useWorkshopTheme()
  const accent = resolveColor(theme, 'accent')
  const bg = resolveColor(theme, 'bgBase')
  return (
    <Sheet onClose={onClose} title="Customize">
      <Section label="Presets">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: 8 }}>
          {BUILTIN_PRESETS.map(p => {
            const a = resolveColor(p, 'accent'), b = resolveColor(p, 'bgBase')
            return (
              <button key={p.id} type="button" onClick={() => setTheme({ ...p, id: theme.id })} style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 10, borderRadius: 11, border: '1px solid var(--border)', background: b, cursor: 'pointer', textAlign: 'left' }}>
                <span style={{ display: 'flex', gap: 4 }}>
                  <i style={{ width: 16, height: 16, borderRadius: 5, background: a }} />
                  <i style={{ width: 16, height: 16, borderRadius: 5, background: resolveColor(p, 'border') }} />
                </span>
                <span style={{ fontSize: 11.5, fontWeight: 700, color: resolveColor(p, 'textPrimary') }}>{p.name}</span>
              </button>
            )
          })}
        </div>
      </Section>
      <Section label="Colors">
        <div style={{ display: 'flex', gap: 18 }}>
          <ColorField label="Accent" value={accent} onChange={v => update({ colors: { ...theme.colors, accent: v } })} />
          <ColorField label="Background" value={bg} onChange={v => update({ colors: { ...theme.colors, bgBase: v } })} />
        </div>
      </Section>
      <Section label="Pattern">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
          {PATTERN_TYPES.map(pt => {
            const active = (theme.pattern?.type ?? 'none') === pt.type
            return (
              <button key={pt.type} type="button" onClick={() => update({ pattern: { ...theme.pattern, type: pt.type } })} style={{ padding: '8px 13px', borderRadius: 999, fontSize: 13, fontWeight: 700, cursor: 'pointer', border: '1px solid var(--border)', background: active ? 'var(--accent)' : 'var(--bg-base)', color: active ? '#0e0d12' : 'var(--text-secondary)' }}>
                {pt.label}
              </button>
            )
          })}
        </div>
      </Section>
      <button type="button" onClick={reset} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, marginTop: 6, padding: '9px 14px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-base)', color: 'var(--text-secondary)', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
        <RotateCcw size={14} /> Reset to default
      </button>
    </Sheet>
  )
}

// Shared bottom-sheet chrome (also used by Firefly's export/sketches sheets).
export function Sheet({ onClose, title, children }: { onClose: () => void; title: string; children: React.ReactNode }) {
  return (
    <div role="dialog" aria-label={title} onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 30, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-end' }}>
      <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxHeight: '82dvh', overflowY: 'auto', background: 'var(--bg-card)', borderTopLeftRadius: 20, borderTopRightRadius: 20, border: '1px solid var(--border)', borderBottom: 'none', padding: '10px 18px calc(24px + env(safe-area-inset-bottom))' }}>
        <div style={{ width: 40, height: 4, borderRadius: 999, background: 'var(--border)', margin: '4px auto 14px' }} />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h2 style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" style={{ display: 'grid', placeItems: 'center', width: 34, height: 34, borderRadius: 9, background: 'var(--bg-base)', border: '1px solid var(--border)', color: 'var(--text-secondary)', cursor: 'pointer' }}><X size={17} /></button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 20 }}>
      <p style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted, var(--text-secondary))', margin: '0 0 10px' }}>{label}</p>
      {children}
    </section>
  )
}

export function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12.5, fontWeight: 700, color: 'var(--text-secondary)' }}>
      {label}
      <input type="color" value={value} onChange={e => onChange(e.target.value)} style={{ width: 56, height: 40, padding: 0, border: '1px solid var(--border)', borderRadius: 9, background: 'none', cursor: 'pointer' }} />
    </label>
  )
}
