'use client'

// Burn-in caption style controls. Edits the SAME CaptionStyle the video module + export use, so the
// look you set here is exactly what gets rendered onto the video. Reusable in either surface.
import { AlignEndVertical, AlignCenterVertical, AlignStartVertical } from 'lucide-react'
import type { CaptionStyle } from '@/lib/editor-types'

const POSITIONS: { key: CaptionStyle['position']; icon: typeof AlignEndVertical; label: string }[] = [
  { key: 'top', icon: AlignStartVertical, label: 'Top' },
  { key: 'center', icon: AlignCenterVertical, label: 'Middle' },
  { key: 'bottom', icon: AlignEndVertical, label: 'Bottom' },
]

const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8 }
const label: React.CSSProperties = { fontSize: 11, color: 'var(--text-muted)', width: 62, flexShrink: 0 }

export default function CaptionStylePanel({ style, onChange }: { style: CaptionStyle; onChange: (s: CaptionStyle) => void }) {
  const set = (p: Partial<CaptionStyle>) => onChange({ ...style, ...p })
  const noBox = style.bg === 'none'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
      <div style={row}>
        <span style={label}>Size</span>
        <input type="range" min={0.6} max={2} step={0.1} value={style.size} onChange={e => set({ size: +e.target.value })} style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: 'var(--text-secondary)', width: 30, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{style.size.toFixed(1)}×</span>
      </div>
      <div style={row}>
        <span style={label}>Text</span>
        <input type="color" value={style.color} onChange={e => set({ color: e.target.value })} style={swatch} />
        <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 'auto' }}>Box</span>
        <input type="color" disabled={noBox} value={noBox ? '#000000' : rgbaToHex(style.bg)} onChange={e => set({ bg: hexToRgba(e.target.value, 0.75) })} style={{ ...swatch, opacity: noBox ? 0.4 : 1 }} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text-secondary)', cursor: 'pointer' }}>
          <input type="checkbox" checked={noBox} onChange={e => set({ bg: e.target.checked ? 'none' : 'rgba(0,0,0,0.75)' })} /> none
        </label>
      </div>
      <div style={row}>
        <span style={label}>Position</span>
        <div style={{ display: 'flex', gap: 4 }}>
          {POSITIONS.map(({ key, icon: Icon, label: l }) => (
            <button key={key} onClick={() => set({ position: key })} title={l}
              style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, padding: '5px 8px', borderRadius: 6, cursor: 'pointer', border: '1px solid var(--border)', background: style.position === key ? 'var(--accent)' : 'var(--bg-card)', color: style.position === key ? '#fff' : 'var(--text-secondary)' }}>
              <Icon size={13} />{l}
            </button>
          ))}
        </div>
      </div>
      <div style={row}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-secondary)', cursor: 'pointer' }}>
          <input type="checkbox" checked={style.karaoke} onChange={e => set({ karaoke: e.target.checked })} /> Highlight current word
        </label>
        {style.karaoke && <input type="color" value={style.highlightColor} onChange={e => set({ highlightColor: e.target.value })} style={{ ...swatch, marginLeft: 'auto' }} />}
      </div>
    </div>
  )
}

const swatch: React.CSSProperties = { width: 26, height: 22, padding: 0, border: '1px solid var(--border)', borderRadius: 5, background: 'none', cursor: 'pointer' }

// The color <input> needs a #rrggbb; CaptionStyle.bg is an rgba() string. Convert both ways, keeping alpha.
function rgbaToHex(rgba: string): string {
  const m = rgba.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
  if (!m) return '#000000'
  return '#' + [1, 2, 3].map(i => Number(m[i]).toString(16).padStart(2, '0')).join('')
}
function hexToRgba(hex: string, a: number): string {
  const n = parseInt(hex.replace('#', ''), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}
