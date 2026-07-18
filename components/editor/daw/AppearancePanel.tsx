'use client'

import { useState } from 'react'
import { createPortal } from 'react-dom'
import { X, RotateCcw, Save, Upload, Trash2, Check, ExternalLink } from 'lucide-react'
import { useWorkshopTheme } from '../WorkshopThemeProvider'
import { shareTheme } from '@/lib/community'
import {
  THEME_COLOR_KEYS, THEME_COLOR_LABELS, PATTERN_TYPES, BUILTIN_PRESETS,
  DEFAULT_TRACK_PALETTE, resolveColor, contrastWarnings, autoTextTokens,
  getUserPresets, saveUserPreset, deleteUserPreset,
  type WorkshopTheme, type ThemeColorKey, type PatternType, type SavedPreset,
} from '@/lib/workshop-theme'

const TEXT_KEYS: ThemeColorKey[] = ['textPrimary', 'textSecondary', 'textMuted']

export default function AppearancePanel({ onClose }: { onClose: () => void }) {
  const { theme, setTheme, update, reset, isSignedIn } = useWorkshopTheme()
  const [userPresets, setUserPresets] = useState<SavedPreset[]>(() => getUserPresets())
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [busy, setBusy] = useState<null | 'save' | 'share'>(null)
  const [flash, setFlash] = useState<string | null>(null)

  const warns = contrastWarnings(theme)

  const setColor = (key: ThemeColorKey, val: string) =>
    update({ colors: { ...theme.colors, [key]: val } })
  const clearColor = (key: ThemeColorKey) => {
    const next = { ...theme.colors }; delete next[key]
    update({ colors: next })
  }
  const setPattern = (patch: Partial<WorkshopTheme['pattern']>) =>
    update({ pattern: { ...theme.pattern, ...patch } })
  const palette = theme.trackPalette ?? DEFAULT_TRACK_PALETTE
  const setPalette = (arr: string[]) => update({ trackPalette: arr })

  const toast = (msg: string) => { setFlash(msg); setTimeout(() => setFlash(null), 2200) }

  function savePreset() {
    const p = saveUserPreset(name || theme.name || 'My theme', theme)
    setUserPresets(getUserPresets())
    setBusy(null)
    toast(`Saved “${p.name}” to your themes`)
  }
  function removePreset(id: string) {
    deleteUserPreset(id); setUserPresets(getUserPresets())
  }
  async function share() {
    if (!isSignedIn) { toast('Sign in to share themes'); return }
    setBusy('share')
    try {
      await shareTheme(theme, name || theme.name || 'My theme', desc)
      toast('Shared to the community 🎉')
      setName(''); setDesc('')
    } catch { toast('Share failed — try again') }
    finally { setBusy(null) }
  }

  const label: React.CSSProperties = { fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)', margin: '0 0 8px' }
  const section: React.CSSProperties = { padding: '14px 16px', borderBottom: '1px solid var(--border)' }

  return createPortal(
    <div
      onMouseDown={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 70, display: 'flex', justifyContent: 'flex-end', background: 'rgba(0,0,0,0.35)' }}
    >
      <div
        onMouseDown={e => e.stopPropagation()}
        style={{
          width: 340, maxWidth: '92vw', height: '100%', overflowY: 'auto',
          background: 'var(--bg-surface)', borderLeft: '1px solid var(--border)',
          display: 'flex', flexDirection: 'column',
        }}
      >
        {/* Header */}
        <div style={{ position: 'sticky', top: 0, zIndex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)' }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>Customize workshop</span>
          <button onClick={onClose} title="Close" style={{ padding: 4, borderRadius: 6, color: 'var(--text-muted)', background: 'transparent', border: 'none', cursor: 'pointer' }}>
            <X size={16} />
          </button>
        </div>

        {flash && (
          <div style={{ padding: '8px 16px', fontSize: 12, color: 'var(--text-primary)', background: 'var(--accent-subtle)', borderBottom: '1px solid var(--border)' }}>{flash}</div>
        )}

        {/* Presets */}
        <div style={section}>
          <p style={label}>Presets</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {BUILTIN_PRESETS.map(p => <PresetSwatch key={p.id} preset={p} onApply={() => setTheme(p)} />)}
          </div>
          {userPresets.length > 0 && (
            <>
              <p style={{ ...label, margin: '14px 0 8px' }}>My themes</p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {userPresets.map(p => (
                  <PresetSwatch key={p.id} preset={p.theme} onApply={() => setTheme(p.theme)} onDelete={() => removePreset(p.id)} />
                ))}
              </div>
            </>
          )}
          <a href="/community?kind=theme" target="_blank" rel="noreferrer"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 12, fontSize: 12, color: 'var(--accent-light)', textDecoration: 'none' }}>
            Browse community themes <ExternalLink size={12} />
          </a>
        </div>

        {/* Contrast warnings */}
        {warns.length > 0 && (
          <div style={{ ...section, background: 'rgba(245,158,11,0.08)' }}>
            <p style={{ ...label, color: 'var(--warning)' }}>Low contrast</p>
            {warns.map(w => (
              <div key={w.pair} style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>{w.pair}: {w.ratio}:1</div>
            ))}
          </div>
        )}

        {/* Palette */}
        <div style={section}>
          <p style={label}>Palette</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {THEME_COLOR_KEYS.map(key => {
              const autoText = theme.autoContrast !== false && TEXT_KEYS.includes(key)
              const auto = autoText ? autoTextTokens(resolveColor(theme, 'bgSurface')) : null
              const val = auto
                ? (key === 'textPrimary' ? auto.primary : key === 'textSecondary' ? auto.secondary : auto.muted)
                : resolveColor(theme, key)
              const overridden = !autoText && !!theme.colors?.[key]
              return (
                <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 10, opacity: autoText ? 0.55 : 1 }}>
                  <label style={{ position: 'relative', width: 26, height: 26, borderRadius: 6, overflow: 'hidden', border: '1px solid var(--border-light)', cursor: autoText ? 'default' : 'pointer', flexShrink: 0, background: val }}>
                    {!autoText && <input type="color" value={val} onChange={e => setColor(key, e.target.value)}
                      style={{ position: 'absolute', inset: -4, width: 40, height: 40, border: 'none', padding: 0, background: 'transparent', cursor: 'pointer', opacity: 0 }} />}
                  </label>
                  <span style={{ flex: 1, fontSize: 12, color: 'var(--text-secondary)' }}>{THEME_COLOR_LABELS[key]}</span>
                  {autoText ? (
                    <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.05em', color: 'var(--text-muted)', padding: '3px 6px', borderRadius: 5, border: '1px solid var(--border)' }}>AUTO</span>
                  ) : (
                    <input value={val} onChange={e => { const v = e.target.value; if (/^#?[0-9a-fA-F]{0,6}$/.test(v)) setColor(key, v.startsWith('#') ? v : '#' + v) }}
                      style={{ width: 74, fontSize: 11, fontFamily: 'var(--font-mono)', padding: '3px 6px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)' }} />
                  )}
                  {overridden && (
                    <button onClick={() => clearColor(key)} title="Reset to default" style={{ padding: 2, color: 'var(--text-muted)', background: 'transparent', border: 'none', cursor: 'pointer' }}>
                      <RotateCcw size={12} />
                    </button>
                  )}
                </div>
              )
            })}
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, fontSize: 12, color: 'var(--text-secondary)', cursor: 'pointer' }}>
            <input type="checkbox" checked={theme.autoContrast !== false} onChange={e => update({ autoContrast: e.target.checked })} />
            Auto-contrast text &amp; symbols
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, fontSize: 12, color: 'var(--text-secondary)', cursor: 'pointer' }}>
            <input type="checkbox" checked={theme.accentSync} onChange={e => update({ accentSync: e.target.checked })} />
            Auto-derive accent shades
          </label>
        </div>

        {/* Pattern */}
        <div style={section}>
          <p style={label}>Pattern</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {PATTERN_TYPES.map(pt => (
              <button key={pt.type} onClick={() => setPattern({ type: pt.type as PatternType })}
                style={{ padding: '5px 10px', fontSize: 11.5, borderRadius: 6, cursor: 'pointer',
                  border: `1px solid ${theme.pattern.type === pt.type ? 'var(--accent)' : 'var(--border)'}`,
                  background: theme.pattern.type === pt.type ? 'var(--accent-subtle)' : 'var(--bg-card)',
                  color: theme.pattern.type === pt.type ? 'var(--accent-light)' : 'var(--text-secondary)' }}>
                {pt.label}
              </button>
            ))}
          </div>
          {theme.pattern.type !== 'none' && (
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)', width: 54 }}>Color</span>
                <label style={{ position: 'relative', width: 26, height: 26, borderRadius: 6, overflow: 'hidden', border: '1px solid var(--border-light)', cursor: 'pointer', background: theme.pattern.color ?? resolveColor(theme, 'border') }}>
                  <input type="color" value={theme.pattern.color ?? resolveColor(theme, 'border')} onChange={e => setPattern({ color: e.target.value })}
                    style={{ position: 'absolute', inset: -4, width: 40, height: 40, border: 'none', padding: 0, background: 'transparent', cursor: 'pointer', opacity: 0 }} />
                </label>
              </div>
              <Slider label="Opacity" min={0} max={1} step={0.05} value={theme.pattern.opacity} onChange={v => setPattern({ opacity: v })} fmt={v => `${Math.round(v * 100)}%`} />
              <Slider label="Scale" min={6} max={80} step={1} value={theme.pattern.scale} onChange={v => setPattern({ scale: v })} fmt={v => `${v}px`} />
              {theme.pattern.type === 'diagonal' && (
                <Slider label="Angle" min={0} max={180} step={5} value={theme.pattern.angle ?? 45} onChange={v => setPattern({ angle: v })} fmt={v => `${v}°`} />
              )}
            </div>
          )}
        </div>

        {/* Track colors */}
        <div style={section}>
          <p style={label}>Track colors</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
            {palette.map((c, i) => (
              <label key={i} style={{ position: 'relative', width: 24, height: 24, borderRadius: 6, overflow: 'hidden', border: '1px solid var(--border-light)', cursor: 'pointer', background: c }}>
                <input type="color" value={c} onChange={e => setPalette(palette.map((x, j) => j === i ? e.target.value : x))}
                  style={{ position: 'absolute', inset: -4, width: 36, height: 36, border: 'none', padding: 0, background: 'transparent', cursor: 'pointer', opacity: 0 }} />
              </label>
            ))}
            {palette.length < 24 && (
              <button onClick={() => setPalette([...palette, '#888888'])} title="Add color"
                style={{ width: 24, height: 24, borderRadius: 6, border: '1px dashed var(--border-light)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 14, lineHeight: 1 }}>+</button>
            )}
          </div>
          {theme.trackPalette && (
            <button onClick={() => update({ trackPalette: undefined })} style={{ marginTop: 10, fontSize: 11, color: 'var(--text-muted)', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}>
              Reset to default palette
            </button>
          )}
        </div>

        {/* Save / share */}
        <div style={{ ...section, borderBottom: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <p style={label}>Save & share</p>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Theme name"
            style={{ fontSize: 12, padding: '7px 9px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)' }} />
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={savePreset} disabled={busy === 'save'}
              style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 12, fontWeight: 600, padding: '8px', borderRadius: 7, border: '1px solid var(--border-light)', background: 'var(--bg-card)', color: 'var(--text-primary)', cursor: 'pointer' }}>
              <Save size={13} /> Save theme
            </button>
            <button onClick={share} disabled={busy === 'share'}
              style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 12, fontWeight: 600, padding: '8px', borderRadius: 7, border: 'none', background: 'var(--accent)', color: 'var(--accent-contrast)', cursor: 'pointer', opacity: busy === 'share' ? 0.7 : 1 }}>
              {busy === 'share' ? <Check size={13} /> : <Upload size={13} />} Share
            </button>
          </div>
          <input value={desc} onChange={e => setDesc(e.target.value)} placeholder="Description (for sharing)"
            style={{ fontSize: 12, padding: '7px 9px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)' }} />
          <button onClick={reset}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 4, fontSize: 12, padding: '7px', borderRadius: 7, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer' }}>
            <Trash2 size={13} /> Reset to default
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function PresetSwatch({ preset, onApply, onDelete }: { preset: WorkshopTheme; onApply: () => void; onDelete?: () => void }) {
  const bg = resolveColor(preset, 'bgBase')
  const card = resolveColor(preset, 'bgCard')
  const accent = resolveColor(preset, 'accent')
  const text = resolveColor(preset, 'textPrimary')
  return (
    <div style={{ position: 'relative' }}>
      <button onClick={onApply} title={preset.name}
        style={{ width: '100%', textAlign: 'left', padding: 8, borderRadius: 8, border: '1px solid var(--border)', background: bg, cursor: 'pointer' }}>
        <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
          <span style={{ width: 16, height: 16, borderRadius: 4, background: card }} />
          <span style={{ width: 16, height: 16, borderRadius: 4, background: accent }} />
          <span style={{ width: 16, height: 16, borderRadius: 4, background: text }} />
        </div>
        <span style={{ fontSize: 10.5, fontWeight: 600, color: text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>{preset.name ?? 'Theme'}</span>
      </button>
      {onDelete && (
        <button onClick={onDelete} title="Delete" style={{ position: 'absolute', top: 3, right: 3, padding: 2, borderRadius: 4, background: 'rgba(0,0,0,0.4)', border: 'none', color: '#fff', cursor: 'pointer', lineHeight: 0 }}>
          <Trash2 size={11} />
        </button>
      )}
    </div>
  )
}

function Slider({ label, min, max, step, value, onChange, fmt }: { label: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void; fmt: (v: number) => string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <span style={{ fontSize: 12, color: 'var(--text-secondary)', width: 54 }}>{label}</span>
      <input type="range" className="cf-slider" min={min} max={max} step={step} value={value} onChange={e => onChange(parseFloat(e.target.value))} style={{ flex: 1 }} />
      <span style={{ fontSize: 11, color: 'var(--text-muted)', width: 38, textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{fmt(value)}</span>
    </div>
  )
}
